import Earcut from 'earcut';
import PolygonClipping from 'polygon-clipping';

const Epsilon = 1e-7;
const Clamp = (Value, Min, Max) => Math.max(Min, Math.min(Max, Value));
const Lerp = (A, B, T) => A + (B - A) * T;
const Distance2 = (A, B) => Math.hypot(A[0] - B[0], A[2] - B[2]);
const Normalize2 = (Vector) => {
  const Length = Math.hypot(Vector[0], Vector[1]) || 1;
  return [Vector[0] / Length, Vector[1] / Length];
};
const Point2 = (Point) => [Point[0], Point[2]];
const Copy3 = (Point) => [Point[0], Point[1], Point[2]];

function CubicPoint(P0, P1, P2, P3, T) {
  const One = 1 - T;
  const A = One * One * One;
  const B = 3 * One * One * T;
  const C = 3 * One * T * T;
  const D = T * T * T;
  return [0, 1, 2].map((Axis) => A * P0[Axis] + B * P1[Axis] + C * P2[Axis] + D * P3[Axis]);
}

function CubicTangent(P0, P1, P2, P3, T) {
  const One = 1 - T;
  return [0, 1, 2].map((Axis) => 3 * One * One * (P1[Axis] - P0[Axis]) + 6 * One * T * (P2[Axis] - P1[Axis]) + 3 * T * T * (P3[Axis] - P2[Axis]));
}

function Normalize3XZ(Vector) {
  const Length = Math.hypot(Vector[0], Vector[2]) || 1;
  return [Vector[0] / Length, Vector[1] / Length, Vector[2] / Length];
}

export function MeasureRoadWidth(Road) {
  const Lanes = Math.max(1, Number(Road.laneCount) || 1);
  const LaneWidth = Math.max(2.5, Number(Road.laneWidth) || 3.5);
  const Median = Math.max(0, Number(Road.median) || 0);
  const Shoulder = Math.max(0, Number(Road.shoulder) || 0);
  const ParkingWidth = Road.parking ? 2.25 : 0;
  return Lanes * LaneWidth + Median + 2 * (Shoulder + ParkingWidth);
}

function MakeRailSamples(Rail) {
  const P0 = Copy3(Rail.start);
  const P1 = Copy3(Rail.controlStart);
  const P2 = Copy3(Rail.controlEnd);
  const P3 = Copy3(Rail.end);
  const Chord = Distance2(P0, P3);
  const ControlLength = Distance2(P0, P1) + Distance2(P1, P2) + Distance2(P2, P3);
  const SegmentCount = Clamp(Math.ceil(Math.max(Chord, ControlLength) / 2.8), 32, 280);
  const Samples = [];
  let Distance = 0;
  let PreviousPoint = null;
  for (let Index = 0; Index <= SegmentCount; Index++) {
    const T = Index / SegmentCount;
    const Point = CubicPoint(P0, P1, P2, P3, T);
    const Tangent = Normalize3XZ(CubicTangent(P0, P1, P2, P3, T));
    if (PreviousPoint) Distance += Math.hypot(Point[0] - PreviousPoint[0], Point[1] - PreviousPoint[1], Point[2] - PreviousPoint[2]);
    Samples.push({ t: T, s: Distance, point: Point, tangent: Tangent, normal: [Tangent[2], 0, -Tangent[0]] });
    PreviousPoint = Point;
  }
  return { road: Rail, samples: Samples, length: Distance, start: P0, end: P3 };
}

function MakeRoadSamples(Project, Road) {
  const Nodes = new Map(Project.nodes.map((Node) => [Node.id, Node]));
  const StartNode = Nodes.get(Road.start);
  const EndNode = Nodes.get(Road.end);
  if (!StartNode || !EndNode) return null;
  const P0 = StartNode.position;
  const P1 = Copy3(Road.controlStart);
  const P2 = Copy3(Road.controlEnd);
  const P3 = EndNode.position;
  if (Road.structure === 'bridge') {
    const DeckHeight = Math.max(4, Number(Road.deckHeight) || 8.8);
    P1[1] = Math.max(P1[1], P0[1] + DeckHeight);
    P2[1] = Math.max(P2[1], P3[1] + DeckHeight);
  } else if (Road.structure === 'tunnel') {
    const Depth = Math.max(4, Number(Road.tunnelDepth) || 6);
    P1[1] = Math.min(P1[1], P0[1] - Depth);
    P2[1] = Math.min(P2[1], P3[1] - Depth);
  }
  const Chord = Distance2(P0, P3);
  const ControlLength = Distance2(P0, P1) + Distance2(P1, P2) + Distance2(P2, P3);
  const SegmentCount = Clamp(Math.ceil(Math.max(Chord, ControlLength) / 3.5), 24, 220);
  const Samples = [];
  let Distance = 0;
  let PreviousPoint = null;
  for (let Index = 0; Index <= SegmentCount; Index++) {
    const T = Index / SegmentCount;
    const Point = CubicPoint(P0, P1, P2, P3, T);
    const Tangent = Normalize3XZ(CubicTangent(P0, P1, P2, P3, T));
    if (PreviousPoint) Distance += Math.hypot(Point[0] - PreviousPoint[0], Point[1] - PreviousPoint[1], Point[2] - PreviousPoint[2]);
    Samples.push({ t: T, s: Distance, point: Point, tangent: Tangent, normal: [Tangent[2], 0, -Tangent[0]] });
    PreviousPoint = Point;
  }
  return { road: Road, samples: Samples, length: Distance, start: Copy3(P0), end: Copy3(P3) };
}

function SampleAtDistance(RoadData, Distance) {
  const Samples = RoadData.samples;
  const Target = Clamp(Distance, 0, RoadData.length);
  let Low = 0;
  let High = Samples.length - 1;
  while (Low < High) {
    const Mid = Math.floor((Low + High) / 2);
    if (Samples[Mid].s < Target) Low = Mid + 1;
    else High = Mid;
  }
  const Upper = Samples[Low];
  const Lower = Samples[Math.max(0, Low - 1)];
  const Span = Upper.s - Lower.s;
  const T = Span > Epsilon ? (Target - Lower.s) / Span : 0;
  const Point = [0, 1, 2].map((Axis) => Lerp(Lower.point[Axis], Upper.point[Axis], T));
  const Tangent = Normalize3XZ([0, 1, 2].map((Axis) => Lerp(Lower.tangent[Axis], Upper.tangent[Axis], T)));
  return { s: Target, t: Lerp(Lower.t, Upper.t, T), point: Point, tangent: Tangent, normal: [Tangent[2], 0, -Tangent[0]] };
}

function SliceRoad(RoadData, Start, End) {
  const From = Clamp(Start, 0, RoadData.length);
  const To = Clamp(End, From, RoadData.length);
  const Slice = [SampleAtDistance(RoadData, From)];
  for (const Sample of RoadData.samples) {
    if (Sample.s > From + 1e-4 && Sample.s < To - 1e-4) Slice.push(Sample);
  }
  const Last = SampleAtDistance(RoadData, To);
  if (To > From + 1e-4) Slice.push(Last);
  return Slice;
}

function SignedArea(Ring) {
  let Area = 0;
  for (let Index = 0; Index < Ring.length - 1; Index++) {
    Area += Ring[Index][0] * Ring[Index + 1][1] - Ring[Index + 1][0] * Ring[Index][1];
  }
  return Area * 0.5;
}

function CloseRing(Ring) {
  const Clean = [];
  for (const Point of Ring) {
    const Previous = Clean[Clean.length - 1];
    if (!Previous || Math.hypot(Point[0] - Previous[0], Point[1] - Previous[1]) > 1e-5) Clean.push([Point[0], Point[1]]);
  }
  if (Clean.length > 2 && Math.hypot(Clean[0][0] - Clean[Clean.length - 1][0], Clean[0][1] - Clean[Clean.length - 1][1]) > 1e-5) Clean.push([...Clean[0]]);
  if (Clean.length < 4) return null;
  return Clean;
}

function RoadOffsetPoint(Sample, Offset, Height = 0) {
  return [Sample.point[0] + Sample.normal[0] * Offset, Sample.point[1] + Height, Sample.point[2] + Sample.normal[2] * Offset];
}

function GetRoadArms(Project, RoadDataById) {
  const ArmsByNode = new Map(Project.nodes.map((Node) => [Node.id, []]));
  for (const Road of Project.roads) {
    const RoadData = RoadDataById.get(Road.id);
    if (!RoadData) continue;
    const Width = MeasureRoadWidth(Road);
    const HalfWidth = Width * 0.5;
    const Footway = Math.max(0, Number(Road.sidewalk) || 0);
    const Curb = Footway > 0 ? 0.22 : 0;
    const OuterHalf = HalfWidth + Footway + Curb;
    for (const [AtStart, NodeId] of [[true, Road.start], [false, Road.end]]) {
      const RoadNodeArms = ArmsByNode.get(NodeId);
      if (!RoadNodeArms) continue;
      const AtNode = SampleAtDistance(RoadData, AtStart ? 0 : RoadData.length);
      const OutwardTangent = AtStart ? AtNode.tangent : AtNode.tangent.map((Value) => -Value);
      const Direction2 = Normalize2([OutwardTangent[0], OutwardTangent[2]]);
      RoadNodeArms.push({
        road: Road,
        data: RoadData,
        atStart: AtStart,
        nodeId: NodeId,
        halfWidth: HalfWidth,
        outerHalf: OuterHalf,
        sidewalk: Footway,
        curbWidth: Curb,
        angle: Math.atan2(Direction2[1], Direction2[0]),
        tangent: OutwardTangent,
      });
    }
  }
  return ArmsByNode;
}

function AngleSeparation(A, B) {
  let Delta = Math.abs(A - B) % (Math.PI * 2);
  if (Delta > Math.PI) Delta = Math.PI * 2 - Delta;
  return Delta;
}

function PlanJunctions(Project, ArmsByNode, RoadDataById) {
  const NodeById = new Map(Project.nodes.map((Node) => [Node.id, Node]));
  const TrimByRoad = new Map(Project.roads.map((Road) => [Road.id, { start: 0, end: 0 }]));
  const Junctions = [];
  for (const [NodeId, Arms] of ArmsByNode.entries()) {
    if (Arms.length < 2) continue;
    const Node = NodeById.get(NodeId);
    if (!Node) continue;
    const Gaps = [];
    for (let A = 0; A < Arms.length; A++) {
      for (let B = A + 1; B < Arms.length; B++) Gaps.push(AngleSeparation(Arms[A].angle, Arms[B].angle));
    }
    const SmallestAngle = Math.max(8 * Math.PI / 180, Math.min(...Gaps));
    const SinHalf = Math.max(0.18, Math.sin(SmallestAngle * 0.5));
    const LargestOuterHalf = Math.max(...Arms.map((Arm) => Arm.outerHalf));
    const Desired = Math.max(Number(Node.radius) * 0.58, LargestOuterHalf / SinHalf);
    Junctions.push({ node: Node, nodeId: NodeId, arms: Arms, smallestAngle: SmallestAngle, cutDistance: Clamp(Desired, 4.5, 19), asphalt: [], outer: [], paving: [] });
  }
  for (const Junction of Junctions) {
    for (const Arm of Junction.arms) {
      const RoadTrim = TrimByRoad.get(Arm.road.id);
      const AvailableCut = Math.min(Junction.cutDistance, Math.max(2, Arm.data.length * 0.35));
      if (Arm.atStart) RoadTrim.start = Math.max(RoadTrim.start, AvailableCut);
      else RoadTrim.end = Math.max(RoadTrim.end, AvailableCut);
    }
  }
  for (const Road of Project.roads) {
    const Trim = TrimByRoad.get(Road.id);
    const RoadData = RoadDataById.get(Road.id);
    if (!Trim || !RoadData) continue;
    const MaxTotal = Math.max(0, RoadData.length * 0.76);
    const Total = Trim.start + Trim.end;
    if (Total > MaxTotal && Total > Epsilon) {
      const Scale = MaxTotal / Total;
      Trim.start *= Scale;
      Trim.end *= Scale;
    }
  }
  for (const Junction of Junctions) {
    for (const Arm of Junction.arms) {
      const Trim = TrimByRoad.get(Arm.road.id);
      const Cut = Arm.atStart ? Trim.start : Trim.end;
      const AsphaltArm = MakeArmPolygon(Arm, Cut, 0);
      const OuterArm = MakeArmPolygon(Arm, Cut, Arm.sidewalk + Arm.curbWidth);
      if (AsphaltArm) Junction.asphalt.push(AsphaltArm);
      if (OuterArm) Junction.outer.push(OuterArm);
    }
    Junction.asphalt = UnionArmPolygons(Junction.asphalt);
    Junction.outer = UnionArmPolygons(Junction.outer);
    Junction.paving = DifferencePolygons(Junction.outer, Junction.asphalt);
  }
  return { trimByRoad: TrimByRoad, junctions: Junctions };
}

function MakeArmPolygon(Arm, CutDistance, AdditionalWidth) {
  const Samples = [];
  const Count = Math.max(8, Math.ceil(CutDistance / 1.8));
  for (let Index = 0; Index <= Count; Index++) {
    const OutwardDistance = CutDistance * Index / Count;
    const AlongRoad = Arm.atStart ? OutwardDistance : Arm.data.length - OutwardDistance;
    const Sample = SampleAtDistance(Arm.data, AlongRoad);
    const Tangent = Arm.atStart ? Sample.tangent : Sample.tangent.map((Value) => -Value);
    const Normal = [Tangent[2], 0, -Tangent[0]];
    Samples.push({ point: Sample.point, normal: Normal });
  }
  const Left = Samples.map((Sample) => [Sample.point[0] + Sample.normal[0] * (Arm.halfWidth + AdditionalWidth), Sample.point[2] + Sample.normal[2] * (Arm.halfWidth + AdditionalWidth)]);
  const Right = Samples.slice().reverse().map((Sample) => [Sample.point[0] - Sample.normal[0] * (Arm.halfWidth + AdditionalWidth), Sample.point[2] - Sample.normal[2] * (Arm.halfWidth + AdditionalWidth)]);
  const Ring = CloseRing([...Left, ...Right]);
  if (!Ring) return null;
  if (Math.abs(SignedArea(Ring)) < 1e-5) return null;
  return [Ring];
}

function UnionArmPolygons(Polygons) {
  const Valid = Polygons.filter(Boolean);
  if (Valid.length === 0) return [];
  try {
    const Result = PolygonClipping.union(...Valid);
    return Array.isArray(Result) ? Result : [];
  } catch (Error) {
    // Keep a valid component instead of emitting crossed, non-finite geometry.
    // The affected junction remains editable and the warning is surfaced in diagnostics.
    return Valid.slice(0, 1);
  }
}

function DifferencePolygons(A, B) {
  if (!A.length || !B.length) return A;
  try {
    return PolygonClipping.difference(A, B);
  } catch (Error) {
    return [];
  }
}

function NewBuilder() {
  return { positions: [], uvs: [], indices: [] };
}

function AddRibbon(Builder, Samples, LeftOffset, RightOffset, Height = 0, UVScale = 0.25) {
  if (!Samples || Samples.length < 2) return;
  const Base = Builder.positions.length / 3;
  for (const Sample of Samples) {
    const Left = RoadOffsetPoint(Sample, LeftOffset, Height);
    const Right = RoadOffsetPoint(Sample, RightOffset, Height);
    Builder.positions.push(...Left, ...Right);
    Builder.uvs.push(0, Sample.s * UVScale, 1, Sample.s * UVScale);
  }
  for (let Index = 0; Index < Samples.length - 1; Index++) {
    const A = Base + Index * 2;
    const B = A + 1;
    const C = A + 2;
    const D = A + 3;
    Builder.indices.push(A, B, D, A, D, C);
  }
}

function AddPointQuad(Builder, A, B, C, D, UVScale = 1) {
  AddTriangle(Builder, A, B, C, [0, 0, UVScale, 0, UVScale, UVScale]);
  AddTriangle(Builder, A, C, D, [0, 0, UVScale, UVScale, 0, UVScale]);
}

function AddTriangle(Builder, A, B, C, UVs = [0, 0, 1, 0, 1, 1], FaceUp = true) {
  let P1 = B;
  let P2 = C;
  let T1 = [UVs[2], UVs[3]];
  let T2 = [UVs[4], UVs[5]];
  if (FaceUp) {
    const NormalY = (P1[2] - A[2]) * (P2[0] - A[0]) - (P1[0] - A[0]) * (P2[2] - A[2]);
    if (NormalY < 0) {
      P1 = C;
      P2 = B;
      T1 = [UVs[4], UVs[5]];
      T2 = [UVs[2], UVs[3]];
    }
  }
  const Base = Builder.positions.length / 3;
  Builder.positions.push(...A, ...P1, ...P2);
  Builder.uvs.push(UVs[0], UVs[1], ...T1, ...T2);
  Builder.indices.push(Base, Base + 1, Base + 2);
}

function AddPolygon(Builder, MultiPolygon, Height = 0.035, UVScale = 0.08) {
  let TriangleCount = 0;
  for (const Polygon of MultiPolygon || []) {
    if (!Polygon.length) continue;
    const Rings = Polygon.map((Ring) => CloseRing(Ring)).filter(Boolean);
    if (!Rings.length) continue;
    const Flat = [];
    const HoleIndices = [];
    const CleanRings = [];
    let VertexCount = 0;
    for (let RingIndex = 0; RingIndex < Rings.length; RingIndex++) {
      const Ring = Rings[RingIndex].slice(0, -1);
      if (Ring.length < 3) continue;
      if (RingIndex > 0) HoleIndices.push(VertexCount);
      CleanRings.push(Ring);
      for (const Point of Ring) {
        Flat.push(Point[0], Point[1]);
        VertexCount++;
      }
    }
    if (VertexCount < 3) continue;
    const Triangles = Earcut(Flat, HoleIndices, 2);
    for (let Index = 0; Index + 2 < Triangles.length; Index += 3) {
      const A2 = [Flat[Triangles[Index] * 2], Flat[Triangles[Index] * 2 + 1]];
      const B2 = [Flat[Triangles[Index + 1] * 2], Flat[Triangles[Index + 1] * 2 + 1]];
      const C2 = [Flat[Triangles[Index + 2] * 2], Flat[Triangles[Index + 2] * 2 + 1]];
      AddTriangle(Builder, [A2[0], Height, A2[1]], [B2[0], Height, B2[1]], [C2[0], Height, C2[1]], [A2[0] * UVScale, A2[1] * UVScale, B2[0] * UVScale, B2[1] * UVScale, C2[0] * UVScale, C2[1] * UVScale]);
      TriangleCount++;
    }
  }
  return TriangleCount;
}

function AddCurbFace(Builder, Samples, Side, HalfWidth, CurbWidth, CurbHeight) {
  if (Samples.length < 2 || CurbWidth <= 0 || CurbHeight <= 0) return;
  for (let Index = 0; Index < Samples.length - 1; Index++) {
    const A = Samples[Index];
    const B = Samples[Index + 1];
    const InnerA = RoadOffsetPoint(A, Side * HalfWidth, 0);
    const OuterA = RoadOffsetPoint(A, Side * (HalfWidth + CurbWidth), 0);
    const InnerATop = RoadOffsetPoint(A, Side * HalfWidth, CurbHeight);
    const OuterATop = RoadOffsetPoint(A, Side * (HalfWidth + CurbWidth), CurbHeight);
    const InnerB = RoadOffsetPoint(B, Side * HalfWidth, 0);
    const OuterB = RoadOffsetPoint(B, Side * (HalfWidth + CurbWidth), 0);
    const InnerBTop = RoadOffsetPoint(B, Side * HalfWidth, CurbHeight);
    const OuterBTop = RoadOffsetPoint(B, Side * (HalfWidth + CurbWidth), CurbHeight);
    AddPointQuad(Builder, InnerA, InnerATop, InnerBTop, InnerB);
    AddPointQuad(Builder, OuterA, OuterB, OuterBTop, OuterATop);
    AddPointQuad(Builder, InnerATop, OuterATop, OuterBTop, InnerBTop);
  }
}

function AddMarkingSegment(Builder, RoadData, Start, End, Offset, Width, Height = 0.045) {
  if (End - Start < 0.08) return;
  const A = SampleAtDistance(RoadData, Start);
  const B = SampleAtDistance(RoadData, End);
  const ALeft = RoadOffsetPoint(A, Offset + Width * 0.5, Height);
  const ARight = RoadOffsetPoint(A, Offset - Width * 0.5, Height);
  const BLeft = RoadOffsetPoint(B, Offset + Width * 0.5, Height);
  const BRight = RoadOffsetPoint(B, Offset - Width * 0.5, Height);
  AddPointQuad(Builder, ALeft, ARight, BRight, BLeft, Math.max(1, End - Start) * 0.25);
}

function AddMarkingDashes(Builder, RoadData, Start, End, Offset, Width, Dash = 3, Gap = 5) {
  let Distance = Start;
  while (Distance + 0.1 < End) {
    const Finish = Math.min(End, Distance + Dash);
    AddMarkingSegment(Builder, RoadData, Distance, Finish, Offset, Width);
    Distance += Dash + Gap;
  }
}

function AddRoadMarkings(Builder, Road, RoadData, Trim) {
  if (!Road.markings) return;
  const From = Trim.start + 0.9;
  const To = RoadData.length - Trim.end - 0.9;
  if (To - From < 4) return;
  const LaneCount = Math.max(1, Math.round(Number(Road.laneCount) || 1));
  const LaneWidth = Math.max(2.5, Number(Road.laneWidth) || 3.5);
  const Median = Math.max(0, Number(Road.median) || 0);
  const HalfLaneCount = Math.floor(LaneCount / 2);
  const SideHalfWidth = HalfLaneCount * LaneWidth;
  const LaneEdgeOffset = Median * 0.5 + SideHalfWidth + (LaneCount % 2 === 1 ? LaneWidth * 0.5 : 0);
  const HalfRoadWidth = MeasureRoadWidth(Road) * 0.5;
  const Shoulder = Math.max(0, Number(Road.shoulder) || 0);
  const MarkWidth = Road.roadClass === 'motorway' ? 0.15 : 0.12;
  const OuterLineOffset = Road.parking ? HalfRoadWidth - 0.22 : LaneEdgeOffset - 0.24;
  AddMarkingSegment(Builder, RoadData, From, To, OuterLineOffset, MarkWidth, 0.04);
  AddMarkingSegment(Builder, RoadData, From, To, -OuterLineOffset, MarkWidth, 0.04);
  if (Road.parking) {
    const SeparatorOffset = LaneEdgeOffset + Shoulder + 0.12;
    AddMarkingSegment(Builder, RoadData, From, To, SeparatorOffset, 0.13, 0.045);
    AddMarkingSegment(Builder, RoadData, From, To, -SeparatorOffset, 0.13, 0.045);
    const BayInner = LaneEdgeOffset + Shoulder + 0.2;
    const BayOuter = HalfRoadWidth - 0.22;
    for (const Side of [-1, 1]) {
      for (let Distance = From + 5; Distance < To - 1; Distance += 6.1) {
        const A = SampleAtDistance(RoadData, Distance - 0.075);
        const B = SampleAtDistance(RoadData, Distance + 0.075);
        const InnerA = RoadOffsetPoint(A, Side * BayInner, 0.052);
        const OuterA = RoadOffsetPoint(A, Side * BayOuter, 0.052);
        const InnerB = RoadOffsetPoint(B, Side * BayInner, 0.052);
        const OuterB = RoadOffsetPoint(B, Side * BayOuter, 0.052);
        AddPointQuad(Builder, InnerA, OuterA, OuterB, InnerB, 1);
      }
    }
  }
  if (LaneCount >= 2 && Median > 0.35) {
    const CenterOffset = Median * 0.5 - 0.15;
    AddMarkingSegment(Builder, RoadData, From, To, CenterOffset, 0.12, 0.045);
    AddMarkingSegment(Builder, RoadData, From, To, -CenterOffset, 0.12, 0.045);
  } else if (LaneCount === 1) {
    AddMarkingDashes(Builder, RoadData, From, To, 0, 0.12, 3, 5);
  }
  for (let Lane = 1; Lane < HalfLaneCount; Lane++) {
    const Offset = Median * 0.5 + Lane * LaneWidth;
    AddMarkingDashes(Builder, RoadData, From, To, Offset, 0.11, 3, 5);
    AddMarkingDashes(Builder, RoadData, From, To, -Offset, 0.11, 3, 5);
  }
  if (LaneCount % 2 === 1 && LaneCount >= 3) {
    AddMarkingDashes(Builder, RoadData, From, To, 0, 0.11, 3, 5);
  }
}

function AddCrosswalk(Builder, Arm, TrimDistance, NodeHeight) {
  if (!Arm || !Arm.road.crosswalks) return;
  const RoadData = Arm.data;
  const Road = Arm.road;
  const Width = MeasureRoadWidth(Road);
  const Shoulder = Math.max(0, Number(Road.shoulder) || 0);
  const HalfSpan = Math.max(1.2, Width * 0.5 - Shoulder - 0.3);
  const CenterDistance = TrimDistance + 4.3;
  const StripeCount = 9;
  const StripeLength = 0.48;
  const Gap = 0.34;
  const Total = StripeCount * StripeLength + (StripeCount - 1) * Gap;
  for (let Stripe = 0; Stripe < StripeCount; Stripe++) {
    const LateralOffset = -Total * 0.5 + Stripe * (StripeLength + Gap);
    const CenterAlong = CenterDistance + LateralOffset;
    const RoadCenterS = Arm.atStart ? CenterAlong : RoadData.length - CenterAlong;
    const A = SampleAtDistance(RoadData, RoadCenterS - StripeLength * 0.5);
    const B = SampleAtDistance(RoadData, RoadCenterS + StripeLength * 0.5);
    if ((Arm.atStart && RoadCenterS < TrimDistance) || (!Arm.atStart && RoadCenterS > RoadData.length - TrimDistance)) continue;
    const ALeft = RoadOffsetPoint(A, HalfSpan, 0.075);
    const ARight = RoadOffsetPoint(A, -HalfSpan, 0.075);
    const BLeft = RoadOffsetPoint(B, HalfSpan, 0.075);
    const BRight = RoadOffsetPoint(B, -HalfSpan, 0.075);
    AddPointQuad(Builder, ALeft, ARight, BRight, BLeft, 1);
  }
}

function AddConeMesh(Builder, Center, Radius, Height) {
  const Segments = 10;
  const Tip = [Center[0], Center[1] + Height, Center[2]];
  for (let Index = 0; Index < Segments; Index++) {
    const A = Index / Segments * Math.PI * 2;
    const B = (Index + 1) / Segments * Math.PI * 2;
    const BaseA = [Center[0] + Math.cos(A) * Radius, Center[1], Center[2] + Math.sin(A) * Radius];
    const BaseB = [Center[0] + Math.cos(B) * Radius, Center[1], Center[2] + Math.sin(B) * Radius];
    AddTriangle(Builder, BaseA, BaseB, Tip, [0, 0, 1, 0, 0.5, 1], false);
    const BandBottomY = Center[1] + Height * 0.42;
    const BandTopY = Center[1] + Height * 0.55;
    const BandRadiusBottom = Radius * (1 - 0.42);
    const BandRadiusTop = Radius * (1 - 0.55);
    const BandA0 = [Center[0] + Math.cos(A) * BandRadiusBottom, BandBottomY, Center[2] + Math.sin(A) * BandRadiusBottom];
    const BandB0 = [Center[0] + Math.cos(B) * BandRadiusBottom, BandBottomY, Center[2] + Math.sin(B) * BandRadiusBottom];
    const BandA1 = [Center[0] + Math.cos(A) * BandRadiusTop, BandTopY, Center[2] + Math.sin(A) * BandRadiusTop];
    const BandB1 = [Center[0] + Math.cos(B) * BandRadiusTop, BandTopY, Center[2] + Math.sin(B) * BandRadiusTop];
    AddTriangle(Builder, BandA0, BandB0, BandB1, [0, 0, 1, 0, 1, 1], false);
    AddTriangle(Builder, BandA0, BandB1, BandA1, [0, 0, 1, 1, 0, 1], false);
  }
}

function AddRaisedFeatures(Builders, Road, RoadData, Trim) {
  const Available = RoadData.length - Trim.start - Trim.end;
  if (Available < 18) return;
  if (Road.speedBumps) {
    const S = Trim.start + Available * 0.55;
    const Center = SampleAtDistance(RoadData, S);
    const Half = MeasureRoadWidth(Road) * 0.5 - Math.max(0.2, Number(Road.shoulder) || 0);
    const Before = SampleAtDistance(RoadData, S - 0.45);
    const After = SampleAtDistance(RoadData, S + 0.45);
    const BumpBuilder = Builders.bumps;
    const L0 = RoadOffsetPoint(Before, Half, 0.08);
    const R0 = RoadOffsetPoint(Before, -Half, 0.08);
    const L1 = RoadOffsetPoint(After, Half, 0.08);
    const R1 = RoadOffsetPoint(After, -Half, 0.08);
    AddPointQuad(BumpBuilder, L0, R0, R1, L1, 2);
    const StripeNumber = 7;
    for (let Stripe = 0; Stripe < StripeNumber; Stripe++) {
      const Lateral = -Half + (2 * Half * (Stripe + 0.5)) / StripeNumber;
      AddMarkingSegment(Builders.marking, RoadData, S - 0.42, S + 0.42, Lateral, 0.25, 0.11);
    }
  }
  if (Road.potholes) {
    const Count = Math.max(1, Math.floor(Available / 34));
    for (let Index = 0; Index < Count; Index++) {
      const S = Trim.start + Available * (Index + 1) / (Count + 1);
      const Offset = (Index % 2 ? 1 : -1) * Math.max(0.6, Number(Road.laneWidth) * 0.25);
      const Center = RoadOffsetPoint(SampleAtDistance(RoadData, S), Offset, 0.035);
      const Ring = [];
      const Seed = Road.id.length * 119 + Index * 53;
      for (let Side = 0; Side < 16; Side++) {
        const Angle = Side / 16 * Math.PI * 2;
        const Modulation = 0.78 + 0.22 * Math.sin(Angle * 3 + Seed);
        Ring.push([Center[0] + Math.cos(Angle) * 0.72 * Modulation, Center[2] + Math.sin(Angle) * 0.48 * Modulation]);
      }
      Ring.push([...Ring[0]]);
      AddPolygon(Builders.potholes, [[Ring]], Center[1], 0.08);
    }
  }
}

function AddBridgeDetails(Builders, Road, RoadData, Trim) {
  const IsBridge = Road.structure === 'bridge';
  if (!IsBridge && !Road.guardrail) return;
  const Body = SliceRoad(RoadData, Trim.start, RoadData.length - Trim.end);
  const HalfWidth = MeasureRoadWidth(Road) * 0.5;
  if (IsBridge) AddRibbon(Builders.structure, Body, HalfWidth + 0.24, -HalfWidth - 0.24, -0.42, 0.18);
  if (Road.guardrail) {
    const RailHeight = 1.05;
    const RailOffset = HalfWidth + 0.38;
    for (const Side of [-1, 1]) {
      for (let Distance = Trim.start; Distance <= RoadData.length - Trim.end; Distance += 2.7) {
        const Sample = SampleAtDistance(RoadData, Distance);
        const Base = RoadOffsetPoint(Sample, Side * RailOffset, 0.05);
        const Top = RoadOffsetPoint(Sample, Side * RailOffset, RailHeight);
        const PostHalf = 0.07;
        AddPointQuad(Builders.structure,
          [Base[0] - PostHalf, Base[1], Base[2] - PostHalf],
          [Base[0] + PostHalf, Base[1], Base[2] - PostHalf],
          [Top[0] + PostHalf, Top[1], Top[2] - PostHalf],
          [Top[0] - PostHalf, Top[1], Top[2] - PostHalf], 1);
      }
      const RailSamples = SliceRoad(RoadData, Trim.start, RoadData.length - Trim.end).map((Sample) => ({ ...Sample, point: [Sample.point[0], Sample.point[1] + RailHeight, Sample.point[2]] }));
      const RailLeft = Side > 0 ? RailOffset + 0.05 : -RailOffset + 0.05;
      const RailRight = Side > 0 ? RailOffset - 0.05 : -RailOffset - 0.05;
      AddRibbon(Builders.structure, RailSamples, RailLeft, RailRight, 0, 0.2);
    }
  }
  if (!IsBridge) return;
  const Span = RoadData.length - Trim.start - Trim.end;
  const SupportCount = Math.floor(Span / 25);
  for (let Index = 1; Index <= SupportCount; Index++) {
    const Distance = Trim.start + Span * Index / (SupportCount + 1);
    const Sample = SampleAtDistance(RoadData, Distance);
    if (Sample.point[1] < 2.8) continue;
    const HalfX = 0.8;
    const HalfZ = 1.0;
    const Top = Sample.point[1] - 0.38;
    const Bottom = 0;
    const X = Sample.point[0];
    const Z = Sample.point[2];
    AddPointQuad(Builders.structure, [X - HalfX, Bottom, Z - HalfZ], [X + HalfX, Bottom, Z - HalfZ], [X + HalfX, Top, Z - HalfZ], [X - HalfX, Top, Z - HalfZ], 1);
    AddPointQuad(Builders.structure, [X + HalfX, Bottom, Z + HalfZ], [X - HalfX, Bottom, Z + HalfZ], [X - HalfX, Top, Z + HalfZ], [X + HalfX, Top, Z + HalfZ], 1);
    AddPointQuad(Builders.structure, [X - HalfX, Bottom, Z + HalfZ], [X - HalfX, Bottom, Z - HalfZ], [X - HalfX, Top, Z - HalfZ], [X - HalfX, Top, Z + HalfZ], 1);
    AddPointQuad(Builders.structure, [X + HalfX, Bottom, Z - HalfZ], [X + HalfX, Bottom, Z + HalfZ], [X + HalfX, Top, Z + HalfZ], [X + HalfX, Top, Z - HalfZ], 1);
  }
}

function BuildTunnelCutout(Road, RoadData) {
  const HalfWidth = MeasureRoadWidth(Road) * 0.5 + 1.35;
  const TunnelSamples = RoadData.samples.filter((Sample) => Sample.point[1] < -0.18);
  if (TunnelSamples.length < 2) return null;
  const FirstIndex = Math.max(0, RoadData.samples.indexOf(TunnelSamples[0]) - 1);
  const LastIndex = Math.min(RoadData.samples.length - 1, RoadData.samples.indexOf(TunnelSamples.at(-1)) + 1);
  const Samples = RoadData.samples.slice(FirstIndex, LastIndex + 1);
  const Left = Samples.map((Sample) => [Sample.point[0] + Sample.normal[0] * HalfWidth, Sample.point[2] + Sample.normal[2] * HalfWidth]);
  const Right = Samples.slice().reverse().map((Sample) => [Sample.point[0] - Sample.normal[0] * HalfWidth, Sample.point[2] - Sample.normal[2] * HalfWidth]);
  const Ring = CloseRing([...Left, ...Right]);
  return Ring ? [Ring] : null;
}

function AddTunnelDetails(Builder, Road, RoadData, Trim) {
  if (Road.structure !== 'tunnel') return;
  const HalfWidth = MeasureRoadWidth(Road) * 0.5;
  const Span = SliceRoad(RoadData, Trim.start, RoadData.length - Trim.end);
  const WallOffset = HalfWidth + 1.15;
  for (let Index = 0; Index < Span.length - 1; Index++) {
    const A = Span[Index];
    const B = Span[Index + 1];
    if ((A.point[1] + B.point[1]) * 0.5 > -0.16) continue;
    for (const Side of [-1, 1]) {
      const BaseA = RoadOffsetPoint(A, Side * WallOffset, 0.12);
      const BaseB = RoadOffsetPoint(B, Side * WallOffset, 0.12);
      const TopA = [BaseA[0], 0.04, BaseA[2]];
      const TopB = [BaseB[0], 0.04, BaseB[2]];
      AddPointQuad(Builder, BaseA, BaseB, TopB, TopA, 1);
    }
  }
}

function SegmentIntersection(A, B, C, D) {
  const RX = B[0] - A[0];
  const RZ = B[2] - A[2];
  const SX = D[0] - C[0];
  const SZ = D[2] - C[2];
  const Denominator = RX * SZ - RZ * SX;
  if (Math.abs(Denominator) < 1e-7) return null;
  const QX = C[0] - A[0];
  const QZ = C[2] - A[2];
  const T = (QX * SZ - QZ * SX) / Denominator;
  const U = (QX * RZ - QZ * RX) / Denominator;
  if (T < -1e-5 || T > 1 + 1e-5 || U < -1e-5 || U > 1 + 1e-5) return null;
  return { t: Clamp(T, 0, 1), u: Clamp(U, 0, 1), point: [A[0] + RX * T, A[1] + (B[1] - A[1]) * T, A[2] + RZ * T] };
}

function AddRailCrossingBars(Builder, RoadData, CenterDistance, HalfWidth) {
  for (const Offset of [-2.2, -1.4, 1.4, 2.2]) {
    const Center = CenterDistance + Offset;
    const A = SampleAtDistance(RoadData, Center - 0.11);
    const B = SampleAtDistance(RoadData, Center + 0.11);
    const ALeft = RoadOffsetPoint(A, HalfWidth, 0.064);
    const ARight = RoadOffsetPoint(A, -HalfWidth, 0.064);
    const BLeft = RoadOffsetPoint(B, HalfWidth, 0.064);
    const BRight = RoadOffsetPoint(B, -HalfWidth, 0.064);
    AddPointQuad(Builder, ALeft, ARight, BRight, BLeft, 1);
  }
}

function BuildRailRoute(BuilderSet, Rail, RoadDataById) {
  const Data = MakeRailSamples(Rail);
  if (Data.length < 2) return { data: Data, crossings: [] };
  const Gauge = Math.max(1.2, Number(Rail.gauge) || 1.435);
  const Tracks = Clamp(Math.round(Number(Rail.trackCount) || 1), 1, 2);
  const CenterSeparation = Gauge + 1.05;
  const TrackCenters = Array.from({ length: Tracks }, (_, Index) => (Index - (Tracks - 1) * 0.5) * CenterSeparation);
  const BedHalf = Math.max(1.7, (Tracks - 1) * CenterSeparation * 0.5 + Gauge * 0.5 + 0.95);
  AddRibbon(BuilderSet.railbed, Data.samples, BedHalf, -BedHalf, -0.012, 0.24);
  for (let Distance = 0; Distance <= Data.length; Distance += 0.68) {
    const Before = SampleAtDistance(Data, Distance - 0.16);
    const After = SampleAtDistance(Data, Distance + 0.16);
    const LeftA = RoadOffsetPoint(Before, BedHalf - 0.12, 0.012);
    const RightA = RoadOffsetPoint(Before, -BedHalf + 0.12, 0.012);
    const LeftB = RoadOffsetPoint(After, BedHalf - 0.12, 0.012);
    const RightB = RoadOffsetPoint(After, -BedHalf + 0.12, 0.012);
    AddPointQuad(BuilderSet.sleepers, LeftA, RightA, RightB, LeftB, 1);
  }
  for (const Center of TrackCenters) {
    for (const Side of [-1, 1]) {
      const RailOffset = Center + Side * Gauge * 0.5;
      AddRibbon(BuilderSet.rails, Data.samples, RailOffset + 0.075, RailOffset - 0.075, 0.17, 0.25);
      AddRibbon(BuilderSet.railWeb, Data.samples, RailOffset + 0.035, RailOffset - 0.035, 0.055, 0.25);
    }
  }
  const Crossings = [];
  for (const [RoadId, RoadData] of RoadDataById) {
    const Road = RoadData.road;
    if (Road.structure !== 'surface') continue;
    let Added = false;
    for (let RailIndex = 0; RailIndex < Data.samples.length - 1 && !Added; RailIndex++) {
      const RailA = Data.samples[RailIndex];
      const RailB = Data.samples[RailIndex + 1];
      for (let RoadIndex = 0; RoadIndex < RoadData.samples.length - 1; RoadIndex++) {
        const RoadA = RoadData.samples[RoadIndex];
        const RoadB = RoadData.samples[RoadIndex + 1];
        const Intersection = SegmentIntersection(RailA.point, RailB.point, RoadA.point, RoadB.point);
        if (!Intersection) continue;
        const RoadDistance = Lerp(RoadA.s, RoadB.s, Intersection.u);
        const RailDistance = Lerp(RailA.s, RailB.s, Intersection.t);
        const Cross = { railId: Rail.id, roadId: RoadId, point: Intersection.point, railDistance: RailDistance, roadDistance: RoadDistance, railTangent: RailA.tangent, roadTangent: RoadA.tangent };
        Crossings.push(Cross);
        if (Rail.crossings !== false) AddRailCrossingBars(BuilderSet.marking, RoadData, RoadDistance, Math.max(2.8, MeasureRoadWidth(Road) * 0.5 - (Number(Road.shoulder) || 0)));
        Added = true;
        break;
      }
    }
  }
  return { data: Data, crossings: Crossings };
}

function BuildJunctionCurbs(Builder, Junction, Height) {
  for (const Polygon of Junction.asphalt || []) {
    const Rings = Polygon || [];
    for (let RingIndex = 0; RingIndex < Rings.length; RingIndex++) {
      const Ring = CloseRing(Rings[RingIndex]);
      if (!Ring) continue;
      const Area = SignedArea(Ring);
      for (let Index = 0; Index < Ring.length - 1; Index++) {
        const A = Ring[Index];
        const B = Ring[Index + 1];
        const DX = B[0] - A[0];
        const DZ = B[1] - A[1];
        const Length = Math.hypot(DX, DZ) || 1;
        const OutSign = (RingIndex === 0 ? Math.sign(Area || 1) : -Math.sign(Area || 1));
        const OutX = OutSign * DZ / Length;
        const OutZ = -OutSign * DX / Length;
        const Width = 0.18;
        const InnerA = [A[0], Height, A[1]];
        const InnerB = [B[0], Height, B[1]];
        const OuterA = [A[0] + OutX * Width, Height, A[1] + OutZ * Width];
        const OuterB = [B[0] + OutX * Width, Height, B[1] + OutZ * Width];
        const BaseA = [A[0], Height - 0.14, A[1]];
        const BaseB = [B[0], Height - 0.14, B[1]];
        AddPointQuad(Builder, BaseA, InnerA, InnerB, BaseB, 1);
        AddPointQuad(Builder, InnerA, OuterA, OuterB, InnerB, 1);
      }
    }
  }
}

function CreateBlockPolygons() {
  const Blocks = [];
  const BlocksCenters = [
    [-50, -48], [50, -48], [-52, 49], [51, 53],
    [146, -47], [144, 48], [-142, -52], [-143, 51],
  ];
  for (const [X, Z] of BlocksCenters) {
    const HalfX = 22 + (Math.abs(X) > 100 ? 9 : 0);
    const HalfZ = 21 + (Math.abs(Z) > 100 ? 7 : 0);
    const Ring = [[X - HalfX, Z - HalfZ], [X + HalfX, Z - HalfZ], [X + HalfX, Z + HalfZ], [X - HalfX, Z + HalfZ], [X - HalfX, Z - HalfZ]];
    Blocks.push([[Ring]]);
  }
  return Blocks;
}

function ToTypedGeometry(Builder) {
  if (!Builder.positions.length || !Builder.indices.length) return null;
  return {
    positions: new Float32Array(Builder.positions),
    uvs: new Float32Array(Builder.uvs),
    indices: new Uint32Array(Builder.indices),
  };
}

export function BuildRoadNetwork(Project) {
  const Builders = {
    asphalt: NewBuilder(),
    pavement: NewBuilder(),
    curb: NewBuilder(),
    marking: NewBuilder(),
    structure: NewBuilder(),
    potholes: NewBuilder(),
    bumps: NewBuilder(),
    railbed: NewBuilder(),
    sleepers: NewBuilder(),
    rails: NewBuilder(),
    railWeb: NewBuilder(),
    construction: NewBuilder(),
    blocks: NewBuilder(),
  };
  const RoadDataById = new Map();
  const Diagnostics = [];
  const TunnelCutouts = [];
  for (const Road of Project.roads) {
    const RoadData = MakeRoadSamples(Project, Road);
    if (RoadData && RoadData.length > 0.25) RoadDataById.set(Road.id, RoadData);
    else Diagnostics.push({ severity: 'error', code: 'invalid-road', featureId: Road.id, message: `Road “${Road.name}” has missing endpoints or zero length.` });
  }
  const ArmsByNode = GetRoadArms(Project, RoadDataById);
  const Plan = PlanJunctions(Project, ArmsByNode, RoadDataById);
  for (const Junction of Plan.junctions) {
    if (Junction.smallestAngle < 20 * Math.PI / 180) {
      Diagnostics.push({ severity: 'warning', code: 'tight-approach', featureId: Junction.nodeId, message: `Acute approach (${Math.round(Junction.smallestAngle * 180 / Math.PI)}°): trimmed quad arms are merged into a single triangulated junction patch.` });
    }
    const GroundHeight = Number(Junction.node.position[1]) || 0;
    AddPolygon(Builders.asphalt, Junction.asphalt, GroundHeight + 0.025, 0.1);
    AddPolygon(Builders.pavement, Junction.paving, GroundHeight + 0.035, 0.08);
    BuildJunctionCurbs(Builders.curb, Junction, GroundHeight + 0.06);
  }
  for (const Road of Project.roads) {
    if (Road.structure !== 'tunnel') continue;
    const RoadData = RoadDataById.get(Road.id);
    if (!RoadData) continue;
    const Cutout = BuildTunnelCutout(Road, RoadData);
    if (Cutout) TunnelCutouts.push(Cutout);
  }
  for (const Road of Project.roads) {
    const RoadData = RoadDataById.get(Road.id);
    if (!RoadData) continue;
    const Trim = Plan.trimByRoad.get(Road.id) || { start: 0, end: 0 };
    const Body = SliceRoad(RoadData, Trim.start, RoadData.length - Trim.end);
    if (Body.length < 2) {
      Diagnostics.push({ severity: 'warning', code: 'short-connector', featureId: Road.id, message: `Road “${Road.name}” is too short to retain a trimmed quad span; its junction patches remain merged.` });
      continue;
    }
    const HalfWidth = MeasureRoadWidth(Road) * 0.5;
    AddRibbon(Builders.asphalt, Body, HalfWidth, -HalfWidth, 0.025, 0.22);
    const Sidewalk = Math.max(0, Number(Road.sidewalk) || 0);
    const CurbWidth = Sidewalk > 0 ? 0.22 : 0;
    if (Sidewalk > 0) {
      for (const Side of [-1, 1]) {
        AddCurbFace(Builders.curb, Body, Side, HalfWidth, CurbWidth, Math.max(0.05, Number(Road.curbHeight) || 0.16));
        AddRibbon(Builders.pavement, Body, Side * (HalfWidth + CurbWidth + Sidewalk), Side * (HalfWidth + CurbWidth), Math.max(0.05, Number(Road.curbHeight) || 0.16) + 0.025, 0.3);
      }
    }
    AddRoadMarkings(Builders.marking, Road, RoadData, Trim);
    AddRaisedFeatures(Builders, Road, RoadData, Trim);
    AddBridgeDetails(Builders, Road, RoadData, Trim);
    AddTunnelDetails(Builders.structure, Road, RoadData, Trim);
    if (Road.construction) {
      Diagnostics.push({ severity: 'info', code: 'work-zone-active', featureId: Road.id, message: `Construction zone active on “${Road.name}”.` });
      const Span = RoadData.length - Trim.start - Trim.end;
      const ZoneLength = Math.min(34, Span * 0.36);
      const ZoneStart = Trim.start + Span * 0.5 - ZoneLength * 0.5;
      const ZoneEnd = ZoneStart + ZoneLength;
      const ClosedLane = (Number(Road.median) || 0) * 0.5 + (Number(Road.laneWidth) || 3.5) * 0.5;
      const Repair = SliceRoad(RoadData, ZoneStart, ZoneEnd);
      AddRibbon(Builders.potholes, Repair, ClosedLane + 1.3, ClosedLane - 1.3, 0.052, 0.15);
      for (const Distance of [ZoneStart, ZoneEnd]) {
        const CrossSample = SampleAtDistance(RoadData, Distance);
        const A = SampleAtDistance(RoadData, Distance - 0.15);
        const B = SampleAtDistance(RoadData, Distance + 0.15);
        AddPointQuad(Builders.marking, RoadOffsetPoint(A, HalfWidth - 0.1, 0.08), RoadOffsetPoint(A, -HalfWidth + 0.1, 0.08), RoadOffsetPoint(B, -HalfWidth + 0.1, 0.08), RoadOffsetPoint(B, HalfWidth - 0.1, 0.08));
        for (const Side of [-1, 1]) {
          const ConeCenter = RoadOffsetPoint(CrossSample, Side * (HalfWidth + 0.95), 0.04);
          AddConeMesh(Builders.construction, ConeCenter, 0.2, 0.72);
        }
      }
      for (let Distance = ZoneStart + 5; Distance < ZoneEnd; Distance += 7) {
        const Sample = SampleAtDistance(RoadData, Distance);
        for (const Side of [-1, 1]) AddConeMesh(Builders.construction, RoadOffsetPoint(Sample, Side * (HalfWidth + 0.85), 0.04), 0.2, 0.72);
      }
    }
  }
  const RailDataById = new Map();
  const RailCrossings = [];
  for (const Rail of Project.railRoutes || []) {
    const BuiltRail = BuildRailRoute(Builders, Rail, RoadDataById);
    if (!BuiltRail.data || BuiltRail.data.length < 0.5) {
      Diagnostics.push({ severity: 'error', code: 'invalid-rail', featureId: Rail.id, message: `Rail route “${Rail.name}” has zero length.` });
      continue;
    }
    RailDataById.set(Rail.id, BuiltRail.data);
    RailCrossings.push(...BuiltRail.crossings);
  }
  for (const Block of CreateBlockPolygons()) AddPolygon(Builders.blocks, Block, -0.12, 0.08);
  for (const [NodeId, Arms] of ArmsByNode.entries()) {
    if (Arms.length < 2) continue;
    const Junction = Plan.junctions.find((Entry) => Entry.nodeId === NodeId);
    if (!Junction || !Junction.node.crossings) continue;
    for (const Arm of Arms) {
      const Trim = Plan.trimByRoad.get(Arm.road.id);
      const Distance = Arm.atStart ? Trim.start : Trim.end;
      AddCrosswalk(Builders.marking, Arm, Distance, Junction.node.position[1]);
    }
  }
  for (const Junction of Plan.junctions) {
    if (Junction.arms.length >= 5) Diagnostics.push({ severity: 'warning', code: 'complex-junction', featureId: Junction.nodeId, message: 'Five or more approaches are supported, but a simpler interchange footprint may be easier to maintain.' });
  }
  const Geometry = Object.fromEntries(Object.entries(Builders).map(([Name, Builder]) => [Name, ToTypedGeometry(Builder)]));
  return {
    geometry: Geometry,
    roadData: RoadDataById,
    railData: RailDataById,
    railCrossings: RailCrossings,
    tunnelCutouts: TunnelCutouts,
    trimByRoad: Plan.trimByRoad,
    junctions: Plan.junctions,
    diagnostics: Diagnostics,
    stats: {
      roads: RoadDataById.size,
      junctions: Plan.junctions.length,
      railRoutes: RailDataById.size,
      railCrossings: RailCrossings.length,
      vertices: Object.values(Geometry).reduce((Total, Entry) => Total + (Entry ? Entry.positions.length / 3 : 0), 0),
      triangles: Object.values(Geometry).reduce((Total, Entry) => Total + (Entry ? Entry.indices.length / 3 : 0), 0),
    },
  };
}

export function SampleRoadAt(Project, RoadId, Distance) {
  const Road = Project.roads.find((Entry) => Entry.id === RoadId);
  const Data = Road ? MakeRoadSamples(Project, Road) : null;
  return Data ? SampleAtDistance(Data, Distance) : null;
}

export function ValidateGeometryResult(Result) {
  const Issues = [];
  for (const [Name, Geometry] of Object.entries(Result.geometry)) {
    if (!Geometry) continue;
    if (Geometry.positions.length % 3 !== 0) Issues.push(`${Name}: position buffer is not xyz aligned`);
    if (Geometry.uvs.length !== Geometry.positions.length / 3 * 2) Issues.push(`${Name}: uv count does not match vertex count`);
    for (const Value of Geometry.positions) if (!Number.isFinite(Value)) { Issues.push(`${Name}: non-finite vertex`); break; }
    for (const Index of Geometry.indices) if (Index >= Geometry.positions.length / 3) { Issues.push(`${Name}: index out of range`); break; }
  }
  return Issues;
}
