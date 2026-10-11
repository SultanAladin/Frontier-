import * as THREE from 'three/webgpu';
import * as LegacyThree from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { BuildRoadNetwork, MeasureRoadWidth } from './geometry.js';
import { ClampTrafficVehicleCount, MaxTrafficVehicles } from './traffic.js';
import Earcut from 'earcut';
import PolygonClipping from 'polygon-clipping';

const TrafficPalette = ['#dca46f', '#c96f5c', '#738996', '#c6c5bb', '#647c70', '#d2c9b4', '#5f6062'];
const Clamp = (Value, Min, Max) => Math.max(Min, Math.min(Max, Value));

function SamplePath(Data, Distance) {
  const Target = Clamp(Distance, 0, Data.length);
  let Low = 0;
  let High = Data.samples.length - 1;
  while (Low < High) {
    const Mid = (Low + High) >> 1;
    if (Data.samples[Mid].s < Target) Low = Mid + 1;
    else High = Mid;
  }
  const B = Data.samples[Low];
  const A = Data.samples[Math.max(0, Low - 1)];
  const Span = B.s - A.s;
  const T = Span > 1e-8 ? (Target - A.s) / Span : 0;
  const Point = A.point.map((Value, Axis) => Value + (B.point[Axis] - Value) * T);
  const Tangent = A.tangent.map((Value, Axis) => Value + (B.tangent[Axis] - Value) * T);
  const Length = Math.hypot(Tangent[0], Tangent[2]) || 1;
  Tangent[0] /= Length;
  Tangent[1] /= Length;
  Tangent[2] /= Length;
  return { s: Target, point: Point, tangent: Tangent, normal: [Tangent[2], 0, -Tangent[0]] };
}

function BuildNoiseTexture(Seed, ColorA, ColorB, TileSize = 512, TextureKind = 'asphalt') {
  const Canvas = document.createElement('canvas');
  Canvas.width = TileSize;
  Canvas.height = TileSize;
  const Context = Canvas.getContext('2d', { alpha: false });
  const Image = Context.createImageData(TileSize, TileSize);
  let State = Seed >>> 0;
  const Random = () => {
    State = (1664525 * State + 1013904223) >>> 0;
    return State / 4294967296;
  };
  const Start = new THREE.Color(ColorA);
  const Finish = new THREE.Color(ColorB);
  for (let Index = 0; Index < TileSize * TileSize; Index++) {
    const Grain = Math.pow(Random(), TextureKind === 'paving' ? 0.7 : 1.6);
    const Mix = Clamp(0.15 + Grain * 0.66 + (Random() - 0.5) * 0.22, 0, 1);
    const Color = Start.clone().lerp(Finish, Mix).convertLinearToSRGB();
    const Pixel = Index * 4;
    Image.data[Pixel] = Math.round(Color.r * 255);
    Image.data[Pixel + 1] = Math.round(Color.g * 255);
    Image.data[Pixel + 2] = Math.round(Color.b * 255);
    Image.data[Pixel + 3] = 255;
  }
  Context.putImageData(Image, 0, 0);
  if (TextureKind === 'asphalt') {
    Context.globalAlpha = 0.18;
    for (let Index = 0; Index < 240; Index++) {
      Context.fillStyle = Random() > 0.5 ? '#121617' : '#c2c0b7';
      const X = Random() * TileSize;
      const Y = Random() * TileSize;
      Context.fillRect(X, Y, 0.7 + Random() * 1.2, 0.7 + Random() * 1.2);
    }
  } else {
    Context.globalAlpha = 0.14;
    Context.strokeStyle = '#202726';
    Context.lineWidth = 1;
    for (let Index = 0; Index <= 8; Index++) {
      const Position = Index * TileSize / 8;
      Context.beginPath();
      Context.moveTo(Position, 0);
      Context.lineTo(Position, TileSize);
      Context.moveTo(0, Position);
      Context.lineTo(TileSize, Position);
      Context.stroke();
    }
  }
  Context.globalAlpha = 1;
  const Texture = new THREE.CanvasTexture(Canvas);
  Texture.colorSpace = THREE.SRGBColorSpace;
  Texture.wrapS = THREE.RepeatWrapping;
  Texture.wrapT = THREE.RepeatWrapping;
  Texture.anisotropy = 4;
  return Texture;
}

function BufferGeometryFromData(Data) {
  const Geometry = new THREE.BufferGeometry();
  Geometry.setAttribute('position', new THREE.BufferAttribute(Data.positions, 3));
  Geometry.setAttribute('uv', new THREE.BufferAttribute(Data.uvs, 2));
  Geometry.setIndex(new THREE.BufferAttribute(Data.indices, 1));
  Geometry.computeVertexNormals();
  Geometry.computeBoundingSphere();
  return Geometry;
}

function BuildHorizontalGrid() {
  const Positions = [];
  const MajorPositions = [];
  const Limit = 360;
  const Step = 10;
  for (let Position = -Limit; Position <= Limit; Position += Step) {
    const IsMajor = Position % 50 === 0;
    const Target = IsMajor ? MajorPositions : Positions;
    Target.push(-Limit, -0.16, Position, Limit, -0.16, Position);
    Target.push(Position, -0.16, -Limit, Position, -0.16, Limit);
  }
  const MinorGeometry = new THREE.BufferGeometry();
  MinorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(Positions, 3));
  const MinorMaterial = new THREE.LineBasicMaterial({ color: '#424c4c', transparent: true, opacity: 0.2, depthWrite: false });
  const Minor = new THREE.LineSegments(MinorGeometry, MinorMaterial);
  const MajorGeometry = new THREE.BufferGeometry();
  MajorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(MajorPositions, 3));
  const Major = new THREE.LineSegments(MajorGeometry, new THREE.LineBasicMaterial({ color: '#52605f', transparent: true, opacity: 0.36, depthWrite: false }));
  const Axes = new THREE.Group();
  const XAxis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-360, -0.14, 0), new THREE.Vector3(360, -0.14, 0)]), new THREE.LineBasicMaterial({ color: '#77604a', transparent: true, opacity: 0.42 }));
  const ZAxis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.13, -360), new THREE.Vector3(0, -0.13, 360)]), new THREE.LineBasicMaterial({ color: '#4a6d70', transparent: true, opacity: 0.36 }));
  Axes.add(XAxis, ZAxis);
  return { minor: Minor, major: Major, axes: Axes };
}

function CreateGround(TunnelCutouts = []) {
  let Geometry;
  if (!TunnelCutouts.length) {
    Geometry = new THREE.PlaneGeometry(1800, 1800, 1, 1);
    Geometry.rotateX(-Math.PI * 0.5);
    Geometry.translate(0, -0.22, 0);
  } else {
    const Border = [[-900, -900], [900, -900], [900, 900], [-900, 900], [-900, -900]];
    let Surface = [[Border]];
    try {
      const Cutouts = PolygonClipping.union(...TunnelCutouts);
      Surface = PolygonClipping.difference(Surface, Cutouts);
    } catch (Error) {
      console.warn('RoadForge: could not subtract a tunnel trench from terrain.', Error);
    }
    const Positions = [];
    const UVs = [];
    const Indices = [];
    for (const Polygon of Surface) {
      const Flat = [];
      const Holes = [];
      let VertexCount = 0;
      for (let RingIndex = 0; RingIndex < Polygon.length; RingIndex++) {
        const Ring = Polygon[RingIndex].slice(0, -1);
        if (Ring.length < 3) continue;
        if (RingIndex > 0) Holes.push(VertexCount);
        for (const Point of Ring) {
          Flat.push(Point[0], Point[1]);
          Positions.push(Point[0], -0.22, Point[1]);
          UVs.push(Point[0] / 42, Point[1] / 42);
          VertexCount++;
        }
      }
      const Triangles = Earcut(Flat, Holes, 2);
      const Base = Indices.length ? Positions.length / 3 - VertexCount : 0;
      for (let Index = 0; Index < Triangles.length; Index += 3) {
        let A = Triangles[Index] + Base;
        let B = Triangles[Index + 1] + Base;
        let C = Triangles[Index + 2] + Base;
        const P0 = [Positions[A * 3], Positions[A * 3 + 2]];
        const P1 = [Positions[B * 3], Positions[B * 3 + 2]];
        const P2 = [Positions[C * 3], Positions[C * 3 + 2]];
        const NormalY = (P1[1] - P0[1]) * (P2[0] - P0[0]) - (P1[0] - P0[0]) * (P2[1] - P0[1]);
        if (NormalY < 0) [B, C] = [C, B];
        Indices.push(A, B, C);
      }
    }
    Geometry = new THREE.BufferGeometry();
    Geometry.setAttribute('position', new THREE.Float32BufferAttribute(Positions, 3));
    Geometry.setAttribute('uv', new THREE.Float32BufferAttribute(UVs, 2));
    Geometry.setIndex(Indices);
    Geometry.computeVertexNormals();
    Geometry.computeBoundingSphere();
  }
  const Material = new THREE.MeshStandardMaterial({ color: '#303936', roughness: 0.98, metalness: 0, side: THREE.DoubleSide });
  const Ground = new THREE.Mesh(Geometry, Material);
  Ground.receiveShadow = true;
  Ground.name = 'Terrain plane';
  return Ground;
}

function BuildGeometryMesh(Data, Material, Name, FeatureType) {
  if (!Data) return null;
  const Mesh = new THREE.Mesh(BufferGeometryFromData(Data), Material);
  Mesh.name = Name;
  Mesh.userData.layer = FeatureType;
  Mesh.castShadow = FeatureType !== 'markings';
  Mesh.receiveShadow = true;
  return Mesh;
}

function DisposeGroupGeometry(Group, DisposeMaterials = false) {
  Group.traverse((Object) => {
    Object.geometry?.dispose();
    if (DisposeMaterials && Object.material) {
      const Materials = Array.isArray(Object.material) ? Object.material : [Object.material];
      Materials.forEach((Material) => Material.dispose());
    }
  });
  Group.clear();
}

function BuildPickMesh(RoadData, Road, Trim) {
  const HalfWidth = MeasureRoadWidth(Road) * 0.5;
  const Start = Trim?.start ?? 0;
  const End = Math.max(Start, RoadData.length - (Trim?.end ?? 0));
  const Samples = RoadData.samples.filter((Sample) => Sample.s >= Start && Sample.s <= End);
  const First = RoadData.samples.find((Sample) => Sample.s >= Start);
  const Last = RoadData.samples.findLast((Sample) => Sample.s <= End);
  if (First && Samples[0] !== First) Samples.unshift(First);
  if (Last && Samples.at(-1) !== Last) Samples.push(Last);
  if (Samples.length < 2) return null;
  const Positions = [];
  const Indices = [];
  for (const Sample of Samples) {
    Positions.push(
      Sample.point[0] + Sample.normal[0] * HalfWidth, Sample.point[1] + 0.06, Sample.point[2] + Sample.normal[2] * HalfWidth,
      Sample.point[0] - Sample.normal[0] * HalfWidth, Sample.point[1] + 0.06, Sample.point[2] - Sample.normal[2] * HalfWidth,
    );
  }
  for (let Index = 0; Index < Samples.length - 1; Index++) {
    const A = Index * 2;
    Indices.push(A, A + 1, A + 3, A, A + 3, A + 2);
  }
  const Geometry = new THREE.BufferGeometry();
  Geometry.setAttribute('position', new THREE.Float32BufferAttribute(Positions, 3));
  Geometry.setIndex(Indices);
  Geometry.computeVertexNormals();
  const Mesh = new THREE.Mesh(Geometry, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, colorWrite: false }));
  Mesh.name = `Road pick · ${Road.name}`;
  Mesh.userData.selection = { type: 'road', id: Road.id };
  return Mesh;
}

function AddRoadPickMeshes(Group, Project, BuildResult) {
  const Roads = new Map(Project.roads.map((Road) => [Road.id, Road]));
  for (const [RoadId, RoadData] of BuildResult.roadData) {
    const Road = Roads.get(RoadId);
    const Trim = BuildResult.trimByRoad.get(RoadId);
    const PickMesh = Road ? BuildPickMesh(RoadData, Road, Trim) : null;
    if (PickMesh) Group.add(PickMesh);
  }
}

function MakePillarGeometry() {
  const Geometry = new THREE.CylinderGeometry(0.11, 0.18, 6.2, 8);
  Geometry.translate(0, 3.1, 0);
  return Geometry;
}

function BuildStreetFurniture(Project, BuildResult, Materials) {
  const Group = new THREE.Group();
  Group.name = 'Street furniture';
  const Roads = new Map(Project.roads.map((Road) => [Road.id, Road]));
  const PoleGeometry = MakePillarGeometry();
  const PoleInstances = [];
  const HeadInstances = [];
  const BollardInstances = [];
  for (const [RoadId, Data] of BuildResult.roadData) {
    const Road = Roads.get(RoadId);
    if (!Road || (Number(Road.sidewalk) || 0) <= 0 || Road.structure !== 'surface') continue;
    const Trim = BuildResult.trimByRoad.get(RoadId) || { start: 0, end: 0 };
    const HalfWidth = MeasureRoadWidth(Road) * 0.5;
    const Span = Data.length - Trim.start - Trim.end;
    const Count = Math.floor(Span / 36);
    for (let Index = 1; Index <= Count; Index++) {
      const Distance = Trim.start + Span * Index / (Count + 1);
      const Sample = SamplePath(Data, Distance);
      const Side = Index % 2 === 0 ? -1 : 1;
      const Offset = HalfWidth + Math.max(0.6, Number(Road.sidewalk) * 0.72);
      const X = Sample.point[0] + Sample.normal[0] * Offset * Side;
      const Z = Sample.point[2] + Sample.normal[2] * Offset * Side;
      PoleInstances.push({ position: new THREE.Vector3(X, Sample.point[1], Z), direction: new THREE.Vector3(Sample.tangent[0], 0, Sample.tangent[2]), scale: 1 });
      HeadInstances.push({ position: new THREE.Vector3(X, Sample.point[1] + 6.2, Z), direction: new THREE.Vector3(Sample.tangent[0], 0, Sample.tangent[2]), scale: 1 });
    }
  }
  if (PoleInstances.length) {
    const Poles = new THREE.InstancedMesh(PoleGeometry, Materials.pole, PoleInstances.length);
    const Matrix = new THREE.Matrix4();
    const Quaternion = new THREE.Quaternion();
    PoleInstances.forEach((Instance, Index) => {
      Matrix.compose(Instance.position, Quaternion, new THREE.Vector3(1, 1, 1));
      Poles.setMatrixAt(Index, Matrix);
    });
    Poles.castShadow = true;
    Group.add(Poles);
  }
  const HeadGeometry = new THREE.BoxGeometry(0.35, 0.12, 0.9);
  if (HeadInstances.length) {
    const Heads = new THREE.InstancedMesh(HeadGeometry, Materials.lamp, HeadInstances.length);
    const Matrix = new THREE.Matrix4();
    const Quaternion = new THREE.Quaternion();
    HeadInstances.forEach((Instance, Index) => {
      Quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(Instance.direction.x, Instance.direction.z));
      Matrix.compose(Instance.position, Quaternion, new THREE.Vector3(1, 1, 1));
      Heads.setMatrixAt(Index, Matrix);
    });
    Group.add(Heads);
  }
  for (const [RoadId, Data] of BuildResult.roadData) {
    const Road = Roads.get(RoadId);
    if (!Road?.billboard) continue;
    const Trim = BuildResult.trimByRoad.get(RoadId) || { start: 0, end: 0 };
    const Distance = (Trim.start + Data.length - Trim.end) * 0.5;
    const Sample = SamplePath(Data, Distance);
    const Side = Road.trafficSide === 'right' ? -1 : 1;
    const Offset = MeasureRoadWidth(Road) * 0.5 + (Number(Road.sidewalk) || 0) + 2.5;
    const Billboard = new THREE.Group();
    const PostGeometry = new THREE.CylinderGeometry(0.14, 0.18, 5.2, 10);
    for (const LocalX of [-3.1, 3.1]) {
      const Post = new THREE.Mesh(PostGeometry, Materials.pole);
      Post.position.set(LocalX, 2.6, 0);
      Billboard.add(Post);
    }
    const Panel = new THREE.Mesh(new THREE.BoxGeometry(7.5, 2.35, 0.2), Materials.billboard);
    Panel.position.set(0, 5.15, 0);
    Billboard.add(Panel);
    const Inset = new THREE.Mesh(new THREE.BoxGeometry(7.1, 1.95, 0.035), Materials.billboardFace);
    Inset.position.set(0, 5.15, 0.12);
    Billboard.add(Inset);
    Billboard.position.set(Sample.point[0] + Sample.normal[0] * Offset * Side, Sample.point[1], Sample.point[2] + Sample.normal[2] * Offset * Side);
    Billboard.rotation.y = Math.atan2(-Sample.tangent[2], Sample.tangent[0]);
    Billboard.name = `Roadside billboard · ${Road.name}`;
    Group.add(Billboard);
  }
  for (const Junction of BuildResult.junctions || []) {
    if (!Junction.node.crossings) continue;
    for (const Arm of Junction.arms) {
      if (!Arm.road.crosswalks) continue;
      const Trim = BuildResult.trimByRoad.get(Arm.road.id) || { start: 0, end: 0 };
      const JunctionTrim = Arm.atStart ? Trim.start : Trim.end;
      const OutwardDistance = JunctionTrim + 4.3;
      const AlongRoad = Arm.atStart ? OutwardDistance : Arm.data.length - OutwardDistance;
      const Sample = SamplePath(Arm.data, AlongRoad);
      const Tangent = Arm.atStart ? Sample.tangent : Sample.tangent.map((Value) => -Value);
      const Normal = [Tangent[2], 0, -Tangent[0]];
      for (const Side of [-1, 1]) {
        const Offset = Arm.outerHalf + 0.58;
        const X = Sample.point[0] + Normal[0] * Offset * Side;
        const Z = Sample.point[2] + Normal[2] * Offset * Side;
        BollardInstances.push({ position: new THREE.Vector3(X, Sample.point[1] + 0.43, Z) });
      }
    }
  }
  if (BollardInstances.length) {
    const Geometry = new THREE.CylinderGeometry(0.075, 0.12, 0.86, 10);
    const Bollards = new THREE.InstancedMesh(Geometry, Materials.bollard, BollardInstances.length);
    const Matrix = new THREE.Matrix4();
    const Quaternion = new THREE.Quaternion();
    BollardInstances.forEach((Instance, Index) => {
      Matrix.compose(Instance.position, Quaternion, new THREE.Vector3(1, 1, 1));
      Bollards.setMatrixAt(Index, Matrix);
    });
    Group.add(Bollards);
  }
  for (const Node of Project.nodes.filter((Entry) => Entry.signalized)) {
    for (const [SideA, SideB] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const Pole = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 4.2, 8), Materials.pole);
      Pole.position.set(Node.position[0] + SideA * 9.6, Node.position[1] + 2.1, Node.position[2] + SideB * 9.6);
      Group.add(Pole);
      const Signal = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.12, 0.26), Materials.signalHousing);
      Signal.position.set(Pole.position.x, Node.position[1] + 4.2, Pole.position.z);
      Group.add(Signal);
      for (let Lamp = 0; Lamp < 3; Lamp++) {
        const Bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), Materials.signalBulbs[Lamp]);
        Bulb.position.set(Signal.position.x, Signal.position.y + 0.33 - Lamp * 0.32, Signal.position.z + 0.145);
        Group.add(Bulb);
      }
    }
  }
  const RoadById = new Map(Project.roads.map((Road) => [Road.id, Road]));
  for (const Crossing of BuildResult.railCrossings || []) {
    const Road = RoadById.get(Crossing.roadId);
    if (!Road) continue;
    const Tangent = Crossing.roadTangent;
    const Normal = [Tangent[2], -Tangent[0]];
    const Offset = MeasureRoadWidth(Road) * 0.5 + 1.65;
    for (const Side of [-1, 1]) {
      const X = Crossing.point[0] + Normal[0] * Offset * Side;
      const Z = Crossing.point[2] + Normal[1] * Offset * Side;
      const Post = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.105, 3.6, 8), Materials.pole);
      Post.position.set(X, Crossing.point[1] + 1.8, Z);
      Group.add(Post);
      const Sign = new THREE.Group();
      const BarA = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.13, 0.07), Materials.crossingSign);
      const BarB = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.13, 0.07), Materials.crossingSign);
      BarA.rotation.z = Math.PI * 0.25;
      BarB.rotation.z = -Math.PI * 0.25;
      Sign.add(BarA, BarB);
      Sign.position.set(X, Crossing.point[1] + 3.35, Z);
      Sign.rotation.y = Math.atan2(-Crossing.railTangent[2], Crossing.railTangent[0]);
      Group.add(Sign);
      for (const LensSide of [-1, 1]) {
        const Lens = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), Materials.crossingLamp);
        Lens.position.set(X + Normal[0] * LensSide * 0.29, Crossing.point[1] + 2.72, Z + Normal[1] * LensSide * 0.29);
        Group.add(Lens);
      }
    }
  }
  return Group;
}

function BuildTrafficVehicles(Project, BuildResult, Materials, Count) {
  const Group = new THREE.Group();
  Group.name = 'AI traffic';
  Group.userData.maxVehicles = MaxTrafficVehicles;
  const Roads = new Map(Project.roads.map((Road) => [Road.id, Road]));
  const Eligible = [...BuildResult.roadData.entries()].filter(([RoadId, Data]) => {
    const Road = Roads.get(RoadId);
    return Road && Data.length > 44 && Road.structure !== 'tunnel';
  });
  const ActualCount = ClampTrafficVehicleCount(Count);
  for (let Index = 0; Index < ActualCount; Index++) {
    const BodyGeometry = new THREE.BoxGeometry(1.82, 0.72, 4.25);
    const RoofGeometry = new THREE.BoxGeometry(1.5, 0.62, 2.25);
    const Body = new THREE.Mesh(BodyGeometry, Materials.vehicles[Index % Materials.vehicles.length]);
    Body.position.y = 0.57;
    Body.castShadow = true;
    const Roof = new THREE.Mesh(RoofGeometry, Materials.glass);
    Roof.position.set(0, 1.18, -0.04);
    const Vehicle = new THREE.Group();
    Vehicle.add(Body, Roof);
    Vehicle.userData.index = Index;
    Vehicle.userData.phase = (Index * 0.6180339887) % 1;
    Vehicle.userData.speedFactor = 0.73 + ((Index * 13) % 9) / 20;
    Vehicle.userData.roadIndex = Index % Math.max(1, Eligible.length);
    Vehicle.userData.reverse = Index % 2 === 1;
    Group.add(Vehicle);
  }
  Group.userData.update = (Elapsed) => {
    if (!Eligible.length) return;
    Group.children.forEach((Vehicle) => {
      const [RoadId, Data] = Eligible[Vehicle.userData.roadIndex];
      const Road = Roads.get(RoadId);
      const Trim = BuildResult.trimByRoad.get(RoadId) || { start: 0, end: 0 };
      const Usable = Math.max(2, Data.length - Trim.start - Trim.end - 10);
      const TravelTime = (Elapsed * Vehicle.userData.speedFactor * (Road.speedLimit || 45) / 110 + Vehicle.userData.phase) % 1;
      const Reversed = Vehicle.userData.reverse;
      const DistanceAlong = Trim.start + 5 + (Reversed ? 1 - TravelTime : TravelTime) * Usable;
      const Sample = SamplePath(Data, DistanceAlong);
      const Direction = Reversed ? -1 : 1;
      const ForwardLaneSide = Road.trafficSide === 'right' ? -1 : 1;
      const LaneSide = Reversed ? -ForwardLaneSide : ForwardLaneSide;
      const Offset = LaneSide * ((Road.median || 0) * 0.5 + (Road.laneWidth || 3.5) * 0.5);
      Vehicle.position.set(Sample.point[0] + Sample.normal[0] * Offset, Sample.point[1] + 0.12, Sample.point[2] + Sample.normal[2] * Offset);
      Vehicle.rotation.y = Math.atan2(Sample.tangent[0] * Direction, Sample.tangent[2] * Direction);
    });
  };
  return Group;
}

function MakeTrainCar(Materials, IsLead) {
  const Car = new THREE.Group();
  const Body = new THREE.Mesh(new THREE.BoxGeometry(2.75, 1.78, 8.4), IsLead ? Materials.trainLead : Materials.trainBody);
  Body.position.y = 1.42;
  Body.castShadow = true;
  Car.add(Body);
  const Roof = new THREE.Mesh(new THREE.BoxGeometry(2.48, 0.2, 7.7), Materials.trainRoof);
  Roof.position.y = 2.42;
  Car.add(Roof);
  for (const Side of [-1, 1]) {
    for (let WindowIndex = 0; WindowIndex < 6; WindowIndex++) {
      const Window = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.58, 0.78), Materials.trainGlass);
      Window.position.set(Side * 1.385, 1.71, -2.8 + WindowIndex * 1.12);
      Car.add(Window);
    }
  }
  for (const X of [-0.91, 0.91]) {
    for (const Z of [-2.65, 2.65]) {
      const Wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 12), Materials.trainWheel);
      Wheel.rotation.z = Math.PI * 0.5;
      Wheel.position.set(X, 0.38, Z);
      Car.add(Wheel);
    }
  }
  if (IsLead) {
    for (const Side of [-1, 1]) {
      const Headlight = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), Materials.trainLamp);
      Headlight.position.set(Side * 0.82, 1.25, 4.22);
      Car.add(Headlight);
    }
  }
  return Car;
}

function BuildRailTrain(Project, BuildResult, Materials, Enabled) {
  const Group = new THREE.Group();
  Group.name = 'Optional commuter train';
  if (!Enabled || !Project.railRoutes?.length) return Group;
  const Rail = Project.railRoutes.find((Entry) => Entry.electrified !== false) || Project.railRoutes[0];
  const Data = BuildResult.railData.get(Rail.id);
  if (!Data) return Group;
  const Carriages = [];
  for (let Index = 0; Index < 4; Index++) {
    const Car = MakeTrainCar(Materials, Index === 0);
    Car.userData.offset = Index * 8.5;
    Carriages.push(Car);
    Group.add(Car);
  }
  Group.userData.update = (Elapsed) => {
    const Speed = Math.max(12, Number(Rail.speedLimit) || 65) / 3.6;
    Carriages.forEach((Car, Index) => {
      const Distance = ((Elapsed * Speed + Data.length * 0.22 - Car.userData.offset) % Data.length + Data.length) % Data.length;
      const Sample = SamplePath(Data, Distance);
      Car.position.set(Sample.point[0], Sample.point[1] + 0.13, Sample.point[2]);
      Car.rotation.y = Math.atan2(Sample.tangent[0], Sample.tangent[2]);
    });
  };
  return Group;
}

function MakeNodeMarker(Node, IsSelected) {
  const Marker = new THREE.Mesh(
    new THREE.SphereGeometry(IsSelected ? 0.92 : 0.58, 18, 14),
    new THREE.MeshStandardMaterial({ color: IsSelected ? '#f0aa79' : '#90a7a3', emissive: IsSelected ? '#653924' : '#172627', roughness: 0.48, metalness: 0.1 }),
  );
  Marker.position.set(Node.position[0], Node.position[1] + 0.2, Node.position[2]);
  Marker.name = Node.name;
  Marker.userData.selection = { type: 'node', id: Node.id };
  return Marker;
}

function MakeSelectionRing(Node) {
  const Material = new THREE.MeshBasicMaterial({ color: '#efaa78', transparent: true, opacity: 0.86, side: THREE.DoubleSide, depthTest: false });
  const Ring = new THREE.Mesh(new THREE.TorusGeometry(Math.max(4, Number(Node.radius) || 8), 0.075, 8, 80), Material);
  Ring.rotation.x = Math.PI * 0.5;
  Ring.position.set(Node.position[0], Node.position[1] + 0.36, Node.position[2]);
  Ring.renderOrder = 20;
  return Ring;
}

export class RoadForgeViewport {
  constructor(Canvas, Options = {}) {
    this.canvas = Canvas;
    this.onSelect = Options.onSelect || (() => {});
    this.onRoadPoint = Options.onRoadPoint || (() => {});
    this.onNodeMove = Options.onNodeMove || (() => {});
    this.onRendererState = Options.onRendererState || (() => {});
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#22292a');
    this.scene.fog = new THREE.Fog('#22292a', 500, 1400);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2400);
    this.camera.position.set(184, 166, 205);
    this.camera.up.set(0, 1, 0);
    this.cameraTarget = new THREE.Vector3(57, 0, 0);
    this.renderer = null;
    this.controls = null;
    this.transform = null;
    this.transformHelper = null;
    this.transformAnchor = new THREE.Object3D();
    this.scene.add(this.transformAnchor);
    this.sceneRoot = new THREE.Group();
    this.scene.add(this.sceneRoot);
    this.ground = null;
    this.overlayRoot = new THREE.Group();
    this.scene.add(this.overlayRoot);
    this.nodeGroup = new THREE.Group();
    this.scene.add(this.nodeGroup);
    this.pickGroup = new THREE.Group();
    this.scene.add(this.pickGroup);
    this.furniture = new THREE.Group();
    this.scene.add(this.furniture);
    this.traffic = new THREE.Group();
    this.scene.add(this.traffic);
    this.train = new THREE.Group();
    this.scene.add(this.train);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.project = null;
    this.buildResult = null;
    this.selected = null;
    this.tool = 'select';
    this.draftPoints = [];
    this.layers = {};
    this.settings = { traffic: false, trafficCount: 14, trains: false, grid: true, wireframe: false, textureLayers: [] };
    this.materials = null;
    this.meshes = new Map();
    this.nodeMarkers = new Map();
    this.selectionRing = null;
    this.resizeObserver = null;
    this.animationFrame = 0;
    this.disposed = false;
    this.measureAnchor = null;
    this.measureLine = null;
    this.pointerDown = this.pointerDown.bind(this);
    this.doubleClick = this.doubleClick.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.frame = this.frame.bind(this);
  }

  async initialize() {
    this.onRendererState('Starting WebGPU…');
    try {
      this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
      await this.renderer.init();
      this.rendererState = 'WebGPU';
    } catch (Error) {
      console.warn('RoadForge: WebGPU initialization failed; using the explicit WebGL fallback.', Error);
      if (this.renderer) this.renderer.dispose();
      this.renderer = new LegacyThree.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
      this.rendererState = 'WebGL fallback';
    }
    if (this.disposed) {
      this.renderer?.dispose();
      return 'disposed';
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight('#d4e0dc', '#343b38', 2.25));
    const Key = new THREE.DirectionalLight('#f4dfc4', 3.0);
    Key.position.set(-150, 240, -100);
    Key.castShadow = true;
    Key.shadow.mapSize.set(2048, 2048);
    Key.shadow.camera.left = -300;
    Key.shadow.camera.right = 300;
    Key.shadow.camera.top = 300;
    Key.shadow.camera.bottom = -300;
    Key.shadow.bias = -0.00035;
    this.scene.add(Key);
    const Fill = new THREE.DirectionalLight('#92a7b2', 1.15);
    Fill.position.set(150, 90, 200);
    this.scene.add(Fill);
    this.ground = CreateGround();
    this.scene.add(this.ground);
    this.grid = BuildHorizontalGrid();
    this.scene.add(this.grid.minor, this.grid.major, this.grid.axes);
    this.materials = this.createMaterials();
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.copy(this.cameraTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.48;
    this.controls.zoomSpeed = 0.72;
    this.controls.panSpeed = 0.62;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 28;
    this.controls.maxDistance = 900;
    this.transform = new TransformControls(this.camera, this.canvas);
    this.transform.setMode('translate');
    this.transform.setSpace('world');
    this.transform.setSize(0.78);
    this.transform.addEventListener('dragging-changed', (Event) => {
      this.controls.enabled = !Event.value && this.tool === 'select';
      if (!Event.value && this.selected?.type === 'node') {
        this.onNodeMove(this.selected.id, [this.transformAnchor.position.x, this.transformAnchor.position.y, this.transformAnchor.position.z]);
      }
    });
    this.transformHelper = this.transform.getHelper();
    this.scene.add(this.transformHelper);
    this.canvas.addEventListener('pointerdown', this.pointerDown);
    this.canvas.addEventListener('dblclick', this.doubleClick);
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.canvas.parentElement || this.canvas);
    this.handleResize();
    this.onRendererState(this.rendererState);
    this.animationFrame = requestAnimationFrame(this.frame);
    if (this.project) {
      this.rebuild();
      this.fitView();
    }
    return this.rendererState;
  }

  createMaterials() {
    const AsphaltTexture = BuildNoiseTexture(104729, '#343839', '#757977', 512, 'asphalt');
    const PavingTexture = BuildNoiseTexture(130363, '#676a67', '#aaa79d', 512, 'paving');
    this.asphaltTexture = AsphaltTexture;
    this.pavingTexture = PavingTexture;
    const Make = (Color, Roughness, Extra = {}) => new THREE.MeshStandardMaterial({ color: Color, roughness: Roughness, metalness: 0.02, side: THREE.DoubleSide, ...Extra });
    return {
      asphalt: Make('#ffffff', 0.92, { map: AsphaltTexture }),
      pavement: Make('#ffffff', 0.88, { map: PavingTexture }),
      curb: Make('#c3bdae', 0.78),
      marking: Make('#ece8dc', 0.57, { emissive: '#28251d', emissiveIntensity: 0.06 }),
      structure: Make('#9da19c', 0.82),
      potholes: Make('#212526', 0.96),
      bumps: Make('#393c3a', 0.89),
      blocks: Make('#526359', 0.98),
      railbed: Make('#514d43', 0.98),
      sleepers: Make('#504238', 0.92),
      rails: Make('#aeb8b3', 0.28, { metalness: 0.76 }),
      railWeb: Make('#79837e', 0.36, { metalness: 0.62 }),
      construction: Make('#dc7650', 0.56),
      pole: Make('#626969', 0.66, { metalness: 0.45 }),
      lamp: Make('#d9c9a7', 0.46, { emissive: '#9b7444', emissiveIntensity: 0.42 }),
      signalHousing: Make('#414746', 0.56, { metalness: 0.25 }),
      signalBulbs: [
        Make('#c84e40', 0.24, { emissive: '#ef5245', emissiveIntensity: 2.3 }),
        Make('#d2a74c', 0.24, { emissive: '#eabb4b', emissiveIntensity: 1.2 }),
        Make('#5a9b6d', 0.24, { emissive: '#51c679', emissiveIntensity: 0.7 }),
      ],
      glass: Make('#26363b', 0.28, { metalness: 0.24 }),
      vehicles: TrafficPalette.map((Color) => Make(Color, 0.38, { metalness: 0.24 })),
      trainLead: Make('#627d7d', 0.36, { metalness: 0.2 }),
      trainBody: Make('#e1d5b9', 0.48, { metalness: 0.08 }),
      trainRoof: Make('#575f5d', 0.6),
      trainGlass: Make('#202c30', 0.24, { metalness: 0.18 }),
      trainWheel: Make('#333a39', 0.42, { metalness: 0.58 }),
      trainLamp: Make('#e8d597', 0.28, { emissive: '#e4bd60', emissiveIntensity: 1.6 }),
      crossingSign: Make('#ece2c8', 0.52),
      crossingLamp: Make('#dc5c46', 0.22, { emissive: '#ef4331', emissiveIntensity: 2.2 }),
      billboard: Make('#353d38', 0.68, { metalness: 0.12 }),
      billboardFace: Make('#53695f', 0.48, { emissive: '#1a261f', emissiveIntensity: 0.12 }),
      bollard: Make('#414844', 0.56, { metalness: 0.36 }),
    };
  }

  update(Project, Options = {}) {
    const ProjectChanged = Project !== this.project;
    const PreviousSelected = this.selected;
    const PreviousTool = this.tool;
    const PreviousLayers = this.layers;
    const PreviousTraffic = this.settings.traffic;
    const PreviousTrafficCount = this.settings.trafficCount;
    const PreviousTrains = this.settings.trains;
    this.project = Project;
    if (Options.selected !== undefined) this.selected = Options.selected;
    if (Options.tool !== undefined) this.tool = Options.tool;
    if (Options.draftPoints !== undefined) this.draftPoints = Options.draftPoints;
    if (Options.layers !== undefined) this.layers = Options.layers;
    if (Options.settings !== undefined) this.settings = { ...this.settings, ...Options.settings };
    this.applyTool();
    if (!this.renderer || !Project) return;
    if (ProjectChanged) {
      this.rebuild();
      return;
    }
    const SelectionChanged = PreviousSelected?.type !== this.selected?.type || PreviousSelected?.id !== this.selected?.id;
    if (SelectionChanged) this.createNodeMarkers();
    if (PreviousTool !== this.tool && this.selected?.type === 'node') this.transformHelper && (this.transformHelper.visible = this.tool === 'select');
    if (PreviousLayers !== this.layers) this.applyLayerVisibility();
    if (PreviousTraffic !== this.settings.traffic || PreviousTrafficCount !== this.settings.trafficCount) this.rebuildTraffic();
    if (PreviousTrains !== this.settings.trains) this.rebuildTrain();
    this.applySettings();
    this.updateDraftOverlay();
  }

  createMeshGroups() {
    DisposeGroupGeometry(this.sceneRoot);
    this.meshes.clear();
    const Result = this.buildResult;
    if (!Result) return;
    const MeshDescriptors = [
      ['asphalt', this.materials.asphalt, 'Road pavement', 'road'],
      ['pavement', this.materials.pavement, 'Footways & paving', 'pavement'],
      ['curb', this.materials.curb, 'Raised kerbs', 'pavement'],
      ['marking', this.materials.marking, 'Thermoplastic markings', 'markings'],
      ['structure', this.materials.structure, 'Structures & furniture', 'infrastructure'],
      ['potholes', this.materials.potholes, 'Road defects', 'road'],
      ['bumps', this.materials.bumps, 'Speed tables', 'road'],
      ['railbed', this.materials.railbed, 'Ballasted rail bed', 'rail'],
      ['sleepers', this.materials.sleepers, 'Rail sleepers', 'rail'],
      ['rails', this.materials.rails, 'Rail heads', 'rail'],
      ['railWeb', this.materials.railWeb, 'Rail webs', 'rail'],
      ['construction', this.materials.construction, 'Work zone props', 'infrastructure'],
      ['blocks', this.materials.blocks, 'Open city blocks', 'blocks'],
    ];
    for (const [Key, Material, Name, Layer] of MeshDescriptors) {
      const Mesh = BuildGeometryMesh(Result.geometry[Key], Material, Name, Layer);
      if (!Mesh) continue;
      Mesh.visible = this.layers[Layer] !== false;
      this.sceneRoot.add(Mesh);
      this.meshes.set(Key, Mesh);
    }
  }

  createNodeMarkers() {
    DisposeGroupGeometry(this.nodeGroup, true);
    this.nodeMarkers.clear();
    this.selectionRing = null;
    if (!this.project) return;
    for (const Node of this.project.nodes) {
      const Selected = this.selected?.type === 'node' && this.selected.id === Node.id;
      const Marker = MakeNodeMarker(Node, Selected);
      this.nodeGroup.add(Marker);
      this.nodeMarkers.set(Node.id, Marker);
    }
    const SelectedNode = this.project.nodes.find((Node) => this.selected?.type === 'node' && this.selected.id === Node.id);
    if (SelectedNode) {
      this.selectionRing = MakeSelectionRing(SelectedNode);
      this.nodeGroup.add(this.selectionRing);
      this.transformAnchor.position.fromArray(SelectedNode.position);
      this.transform.attach(this.transformAnchor);
      this.transformHelper.visible = this.tool === 'select';
    } else if (this.transform) {
      this.transform.detach();
      this.transformHelper.visible = false;
    }
  }

  createPickMeshes() {
    DisposeGroupGeometry(this.pickGroup);
    if (this.project && this.buildResult) AddRoadPickMeshes(this.pickGroup, this.project, this.buildResult);
  }

  rebuild() {
    if (!this.project || !this.materials) return;
    this.buildResult = BuildRoadNetwork(this.project);
    this.updateGround(this.buildResult.tunnelCutouts || []);
    this.createMeshGroups();
    this.createPickMeshes();
    this.createNodeMarkers();
    DisposeGroupGeometry(this.furniture);
    const FurnitureGroup = BuildStreetFurniture(this.project, this.buildResult, this.materials);
    FurnitureGroup.visible = this.layers.infrastructure !== false;
    this.furniture.add(FurnitureGroup);
    this.rebuildTraffic();
    this.rebuildTrain();
    this.applySettings();
    this.updateDraftOverlay();
    this.onRendererState(this.rendererState || 'WebGPU');
  }

  updateGround(TunnelCutouts) {
    if (!this.ground) return;
    const Previous = this.ground;
    this.scene.remove(Previous);
    Previous.geometry.dispose();
    Previous.material.dispose();
    this.ground = CreateGround(TunnelCutouts);
    this.scene.add(this.ground);
  }

  applyLayerVisibility() {
    const TextureLayers = this.settings.textureLayers || [];
    const Enabled = (Id) => TextureLayers.find((Layer) => Layer.id === Id)?.enabled !== false;
    for (const [Name, Mesh] of this.meshes) {
      const SceneVisible = this.layers[Mesh.userData.layer] !== false;
      const MaterialVisible = Name === 'asphalt' || Name === 'bumps' ? Enabled('wearing') : Name === 'potholes' ? Enabled('repaired') : Name === 'marking' ? Enabled('marking') : Name === 'pavement' || Name === 'curb' ? Enabled('paving') : true;
      Mesh.visible = SceneVisible && MaterialVisible;
    }
    this.furniture.visible = this.layers.infrastructure !== false;
    this.traffic.visible = this.layers.traffic !== false && Boolean(this.settings.traffic);
    this.train.visible = this.layers.rail !== false && Boolean(this.settings.trains);
  }

  rebuildTraffic() {
    DisposeGroupGeometry(this.traffic);
    if (this.project && this.buildResult && this.settings.traffic) {
      const TrafficGroup = BuildTrafficVehicles(this.project, this.buildResult, this.materials, ClampTrafficVehicleCount(this.settings.trafficCount || 14));
      this.traffic.add(TrafficGroup);
    }
    this.traffic.visible = this.layers.traffic !== false && Boolean(this.settings.traffic);
  }

  rebuildTrain() {
    DisposeGroupGeometry(this.train);
    if (this.project && this.buildResult && this.settings.trains) this.train.add(BuildRailTrain(this.project, this.buildResult, this.materials, true));
    this.train.visible = this.layers.rail !== false && Boolean(this.settings.trains);
  }

  applySettings() {
    if (this.grid) {
      const Enabled = this.settings.grid !== false;
      this.grid.minor.visible = Enabled;
      this.grid.major.visible = Enabled;
      this.grid.axes.visible = Enabled;
    }
    for (const Mesh of this.meshes.values()) {
      if (Mesh.material?.wireframe !== undefined) Mesh.material.wireframe = Boolean(this.settings.wireframe);
    }
    this.traffic.visible = this.layers.traffic !== false && Boolean(this.settings.traffic);
    this.train.visible = this.layers.rail !== false && Boolean(this.settings.trains);
    const TextureLayers = this.settings.textureLayers || [];
    const FindLayer = (Id) => TextureLayers.find((Layer) => Layer.id === Id);
    const Wearing = FindLayer('wearing');
    const Aggregate = FindLayer('aggregate');
    const Repair = FindLayer('repaired');
    const Marking = FindLayer('marking');
    const Paving = FindLayer('paving');
    const Damp = FindLayer('damp');
    if (Wearing && this.materials.asphalt) {
      const SurfaceColor = new THREE.Color(Wearing.color || '#ffffff');
      for (const Layer of TextureLayers.filter((Entry) => Entry.id.startsWith('custom-') && Entry.enabled)) {
        SurfaceColor.lerp(new THREE.Color(Layer.color || '#ffffff'), Clamp(Number(Layer.opacity) || 0, 0, 1));
      }
      this.materials.asphalt.color.copy(SurfaceColor);
      this.materials.asphalt.opacity = Number.isFinite(Number(Wearing.opacity)) ? Number(Wearing.opacity) : 1;
      this.materials.asphalt.transparent = Wearing.opacity < 0.99;
      let SurfaceRoughness = Number(Wearing.roughness) || 0.9;
      for (const Layer of TextureLayers.filter((Entry) => Entry.id.startsWith('custom-') && Entry.enabled)) {
        const Mix = Clamp(Number(Layer.opacity) || 0, 0, 1);
        SurfaceRoughness += ((Number(Layer.roughness) || SurfaceRoughness) - SurfaceRoughness) * Mix;
      }
      if (Aggregate?.enabled) {
        const AggregateStrength = Clamp(Number(Aggregate.opacity) || 0, 0, 1) * 0.25;
        SurfaceRoughness += ((Number(Aggregate.roughness) || SurfaceRoughness) - SurfaceRoughness) * AggregateStrength;
      }
      this.materials.asphalt.roughness = Clamp(SurfaceRoughness, 0.05, 1);
      this.materials.asphalt.map = Aggregate?.enabled === false ? null : this.asphaltTexture;
      if (this.materials.asphalt.map) this.materials.asphalt.map.repeat.set(Math.max(0.1, Number(Wearing.repeatX) || 1), Math.max(0.1, Number(Wearing.repeatY) || 1));
      this.materials.asphalt.needsUpdate = true;
    }
    if (this.materials.pavement && Paving) {
      this.materials.pavement.color.set(Paving.color || '#ffffff');
      this.materials.pavement.roughness = Number(Paving.roughness) || 0.84;
      this.materials.pavement.opacity = Number.isFinite(Number(Paving.opacity)) ? Number(Paving.opacity) : 1;
      this.materials.pavement.transparent = Paving.opacity < 0.99;
      this.materials.pavement.needsUpdate = true;
    }
    if (this.materials.marking && Marking) {
      this.materials.marking.color.set(Marking.color || '#ece8dc');
      this.materials.marking.opacity = Number.isFinite(Number(Marking.opacity)) ? Number(Marking.opacity) : 1;
      this.materials.marking.transparent = Marking.opacity < 0.99;
      this.materials.marking.needsUpdate = true;
    }
    if (this.materials.potholes && Repair) {
      this.materials.potholes.color.set(Repair.color || '#212526');
      this.materials.potholes.opacity = Number.isFinite(Number(Repair.opacity)) ? Number(Repair.opacity) : 1;
      this.materials.potholes.transparent = Repair.opacity < 0.99;
      this.materials.potholes.needsUpdate = true;
    }
    const RoadEnabled = this.layers.road !== false && Wearing?.enabled !== false;
    const PavementEnabled = this.layers.pavement !== false && Paving?.enabled !== false;
    const MarkingsEnabled = this.layers.markings !== false && Marking?.enabled !== false;
    if (this.meshes.get('asphalt')) this.meshes.get('asphalt').visible = RoadEnabled;
    if (this.meshes.get('potholes')) this.meshes.get('potholes').visible = RoadEnabled && Repair?.enabled !== false;
    if (this.meshes.get('pavement')) this.meshes.get('pavement').visible = PavementEnabled;
    if (this.meshes.get('curb')) this.meshes.get('curb').visible = PavementEnabled;
    if (this.meshes.get('marking')) this.meshes.get('marking').visible = MarkingsEnabled;
    if (Damp?.enabled && this.materials.asphalt) this.materials.asphalt.roughness = Clamp(Number(Damp.roughness) || 0.42, 0.18, 1);
    this.applyLayerVisibility();
  }

  updateDraftOverlay() {
    DisposeGroupGeometry(this.overlayRoot, true);
    if (!this.draftPoints?.length) return;
    const Points = this.draftPoints.map((Point) => new THREE.Vector3(Point[0], Point[1] + 0.2, Point[2]));
    if (Points.length >= 2) {
      const Geometry = new THREE.BufferGeometry().setFromPoints(Points);
      const Line = new THREE.Line(Geometry, new THREE.LineDashedMaterial({ color: '#e5a16f', dashSize: 1.6, gapSize: 0.8, transparent: true, opacity: 0.94 }));
      Line.computeLineDistances();
      this.overlayRoot.add(Line);
    }
    for (const [Index, Point] of Points.entries()) {
      const Marker = new THREE.Mesh(new THREE.SphereGeometry(Index === Points.length - 1 ? 0.92 : 0.55, 12, 10), new THREE.MeshBasicMaterial({ color: '#edaa79' }));
      Marker.position.copy(Point);
      this.overlayRoot.add(Marker);
    }
  }

  applyTool() {
    if (!this.controls) return;
    this.controls.enabled = this.tool === 'select';
    if (this.transformHelper) this.transformHelper.visible = this.tool === 'select' && this.selected?.type === 'node';
    this.canvas.style.cursor = this.tool === 'road' ? 'crosshair' : this.tool === 'measure' ? 'cell' : 'grab';
  }

  setSelection(Selection) {
    this.onSelect(Selection);
  }

  pointerDown(Event) {
    if (Event.button !== 0 || !this.camera || !this.project) return;
    const Bounds = this.canvas.getBoundingClientRect();
    this.pointer.x = ((Event.clientX - Bounds.left) / Bounds.width) * 2 - 1;
    this.pointer.y = -((Event.clientY - Bounds.top) / Bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.tool === 'road') {
      const Hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.groundPlane, Hit)) this.onRoadPoint([Hit.x, 0, Hit.z]);
      return;
    }
    if (this.tool === 'measure') {
      const Hit = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(this.groundPlane, Hit)) return;
      if (!this.measureAnchor) {
        this.measureAnchor = Hit.clone();
      } else {
        const Distance = this.measureAnchor.distanceTo(Hit);
        this.onRendererState(`${this.rendererState} · ${Distance.toFixed(1)} m measured`);
        if (this.measureLine) {
          this.overlayRoot.remove(this.measureLine);
          this.measureLine.geometry.dispose();
        }
        this.measureLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([this.measureAnchor, Hit]), new THREE.LineBasicMaterial({ color: '#f0a975', linewidth: 2 }));
        this.overlayRoot.add(this.measureLine);
        this.measureAnchor = null;
      }
      return;
    }
    if (this.tool !== 'select') return;
    if (this.transform?.axis !== null && this.transform?.axis !== undefined) return;
    const HitTargets = [...this.nodeGroup.children.filter((Child) => Child.userData.selection), ...this.pickGroup.children];
    const Hits = this.raycaster.intersectObjects(HitTargets, false);
    const Selection = Hits.find((Hit) => Hit.object.userData.selection)?.object.userData.selection || null;
    this.setSelection(Selection);
  }

  doubleClick(Event) {
    if (Event.button !== 0) return;
    this.fitView();
  }

  handleResize() {
    if (!this.renderer) return;
    const Rect = (this.canvas.parentElement || this.canvas).getBoundingClientRect();
    const Width = Math.max(1, Rect.width);
    const Height = Math.max(1, Rect.height);
    this.camera.aspect = Width / Height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(Width, Height, false);
  }

  frame() {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.frame);
    const Delta = Math.min(0.06, this.clock.getDelta());
    this.elapsed += Delta;
    this.controls?.update();
    this.traffic.children[0]?.userData.update?.(this.elapsed);
    this.train.children[0]?.userData.update?.(this.elapsed);
    this.renderer?.render(this.scene, this.camera);
  }

  fitView() {
    if (!this.project?.nodes.length || !this.controls) return;
    const Box = new THREE.Box3();
    for (const Node of this.project.nodes) Box.expandByPoint(new THREE.Vector3(...Node.position));
    Box.expandByScalar(30);
    const Center = Box.getCenter(new THREE.Vector3());
    const Size = Box.getSize(new THREE.Vector3());
    this.cameraTarget.copy(Center);
    this.controls.target.copy(Center);
    const MaxSize = Math.max(Size.x, Size.z, 140);
    const Distance = MaxSize * 0.72;
    this.camera.position.set(Center.x + Distance * 0.78, Center.y + Distance * 0.78, Center.z + Distance * 0.95);
    this.camera.lookAt(Center);
    this.controls.update();
  }

  setTopView() {
    if (!this.controls) return;
    this.camera.up.set(0, 0, -1);
    this.camera.position.set(this.controls.target.x, this.controls.target.y + 260, this.controls.target.z + 0.01);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  setPerspective() {
    if (!this.controls) return;
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(this.controls.target.x + 184, this.controls.target.y + 166, this.controls.target.z + 205);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('pointerdown', this.pointerDown);
    this.canvas.removeEventListener('dblclick', this.doubleClick);
    this.controls?.dispose();
    this.transform?.dispose();
    this.scene.traverse((Object) => {
      if (Object.geometry) Object.geometry.dispose();
      if (Object.material) {
        const Materials = Array.isArray(Object.material) ? Object.material : [Object.material];
        Materials.forEach((Material) => Material.dispose());
      }
    });
    this.renderer?.dispose();
  }
}
