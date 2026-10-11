import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildRoadNetwork, ValidateGeometryResult } from '../src/geometry.js';
import { CreateJunctionPreset, CreateRoadFromAnchors, CreateStarterProject, MoveNode, ReplaceRoad } from '../src/model.js';
import { ClampTrafficVehicleCount, MaxTrafficVehicles } from '../src/traffic.js';

function CreateAcuteApproachProject() {
  return {
    id: 'acute-junction-test',
    name: 'Acute junction test',
    units: 'metres',
    nodes: [
      { id: 'center', name: 'Center', position: [0, 0, 0], radius: 8, kind: 'merge', signalized: false, crossings: false },
      { id: 'east', name: 'East', position: [90, 0, 0], radius: 5, kind: 'terminal', signalized: false, crossings: false },
      { id: 'acute', name: 'Acute', position: [90, 0, 16], radius: 5, kind: 'terminal', signalized: false, crossings: false },
      { id: 'west', name: 'West', position: [-90, 0, 0], radius: 5, kind: 'terminal', signalized: false, crossings: false },
    ],
    roads: [
      { id: 'east-road', name: 'East road', start: 'center', end: 'east', controlStart: [30, 0, 0], controlEnd: [60, 0, 0], laneCount: 2, laneWidth: 3.4, median: 0.4, shoulder: 0.3, sidewalk: 1.2, markings: true, crosswalks: false, structure: 'surface' },
      { id: 'acute-road', name: 'Acute approach', start: 'center', end: 'acute', controlStart: [28, 0, 3.5], controlEnd: [63, 0, 12], laneCount: 2, laneWidth: 3.4, median: 0.4, shoulder: 0.3, sidewalk: 1.2, markings: true, crosswalks: false, structure: 'surface' },
      { id: 'west-road', name: 'West road', start: 'center', end: 'west', controlStart: [-30, 0, 0], controlEnd: [-60, 0, 0], laneCount: 2, laneWidth: 3.4, median: 0.4, shoulder: 0.3, sidewalk: 1.2, markings: true, crosswalks: false, structure: 'surface' },
    ],
    railRoutes: [],
    revision: 1,
  };
}

test('starter network builds finite quad road spans and triangulated junctions', () => {
  const Project = CreateStarterProject();
  const Result = BuildRoadNetwork(Project);
  assert.equal(Result.stats.roads, Project.roads.length);
  assert.equal(Result.junctions.length, 3);
  assert.equal(Result.stats.railRoutes, 1);
  assert.equal(Result.stats.railCrossings, 1);
  assert.equal(Result.railCrossings[0].roadId, 'road-north');
  assert.ok(Result.geometry.rails && Result.geometry.sleepers);
  assert.ok(Result.stats.triangles > 1000);
  assert.deepEqual(ValidateGeometryResult(Result), []);
  const Core = Result.junctions.find((Junction) => Junction.nodeId === 'node-core');
  assert.ok(Core);
  assert.equal(Core.asphalt.length, 1, 'the four approaches meet in one boolean-unioned road surface');
  assert.ok(Core.paving.length > 0, 'footway apron is triangulated around the asphalt patch');
  for (const RoadId of ['road-west', 'road-east', 'road-north', 'road-south']) {
    const Trim = Result.trimByRoad.get(RoadId);
    assert.ok(Trim.start + Trim.end > 0, `${RoadId} is trimmed to the intersection patch`);
  }
});

test('acute three-arm junction stays finite and reports its angle', () => {
  const Result = BuildRoadNetwork(CreateAcuteApproachProject());
  assert.deepEqual(ValidateGeometryResult(Result), []);
  assert.ok(Result.junctions.some((Junction) => Junction.nodeId === 'center' && Junction.smallestAngle < Math.PI / 9));
  assert.ok(Result.diagnostics.some((Issue) => Issue.code === 'tight-approach' && Issue.featureId === 'center'));
  const Center = Result.junctions.find((Junction) => Junction.nodeId === 'center');
  assert.equal(Center.asphalt.length, 1, 'acute approach strips are unioned rather than left as overlapping center quads');
});

test('tunnel structure receives a below-grade spline and a terrain cutout', () => {
  let Project = CreateStarterProject();
  Project = ReplaceRoad(Project, 'road-harbor', { structure: 'tunnel', tunnelDepth: 8 });
  const Result = BuildRoadNetwork(Project);
  const Tunnel = Result.roadData.get('road-harbor');
  assert.ok(Tunnel);
  assert.ok(Math.min(...Tunnel.samples.map((Sample) => Sample.point[1])) < -5.5);
  assert.equal(Result.tunnelCutouts.length, 1);
  assert.ok(Result.geometry.structure);
  assert.deepEqual(ValidateGeometryResult(Result), []);
});

test('construction, parking, pothole, and speed-table features emit valid geometry', () => {
  let Project = CreateStarterProject();
  Project = ReplaceRoad(Project, 'road-east', { construction: true, parking: true, potholes: true, speedBumps: true });
  const Result = BuildRoadNetwork(Project);
  assert.ok(Result.geometry.construction);
  assert.ok(Result.geometry.potholes);
  assert.ok(Result.geometry.bumps);
  assert.ok(Result.geometry.marking);
  assert.ok(Result.diagnostics.some((Issue) => Issue.code === 'work-zone-active'));
  assert.deepEqual(ValidateGeometryResult(Result), []);
});

test('anchor creation snaps into an existing node without duplicating it', () => {
  const Project = CreateStarterProject();
  const Next = CreateRoadFromAnchors(Project, [[1, 0, 1], [75, 0, 28]]);
  assert.equal(Next.nodes.length, Project.nodes.length + 1);
  assert.equal(Next.roads.length, Project.roads.length + 1);
  const Added = Next.roads.at(-1);
  assert.equal(Added.start, 'node-core');
  assert.ok(Next.nodes.some((Node) => Node.id === Added.end));
});

test('junction preset creates four connected arms and a merged center patch', () => {
  const Project = CreateStarterProject();
  const Next = CreateJunctionPreset(Project, [300, 0, 150]);
  const Center = Next.nodes.find((Node) => Node.name === 'New junction 1');
  assert.ok(Center);
  assert.equal(Next.roads.length, Project.roads.length + 4);
  assert.equal(Next.nodes.length, Project.nodes.length + 5);
  const Result = BuildRoadNetwork(Next);
  const Patch = Result.junctions.find((Junction) => Junction.nodeId === Center.id);
  assert.equal(Patch.arms.length, 4);
  assert.equal(Patch.asphalt.length, 1);
  assert.deepEqual(ValidateGeometryResult(Result), []);
});

test('moving a junction preserves connected spline handles by the same delta', () => {
  const Project = CreateStarterProject();
  const Original = Project.roads.find((Road) => Road.id === 'road-east');
  const Next = MoveNode(Project, 'node-core', [10, 2, -5]);
  const Moved = Next.roads.find((Road) => Road.id === 'road-east');
  assert.deepEqual(Moved.controlStart, Original.controlStart.map((Value, Index) => Value + [10, 2, -5][Index]));
  assert.deepEqual(Moved.controlEnd, Original.controlEnd);
  assert.deepEqual(Next.nodes.find((Node) => Node.id === 'node-core').position, [10, 2, -5]);
});

test('traffic instance count has a hard cap of 25', () => {
  assert.equal(MaxTrafficVehicles, 25);
  assert.equal(ClampTrafficVehicleCount(1000), 25);
  assert.equal(ClampTrafficVehicleCount(8.9), 8);
  assert.equal(ClampTrafficVehicleCount(-1), 0);
  assert.equal(ClampTrafficVehicleCount('not-a-number'), 0);
});
