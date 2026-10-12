// Riverside local-road spacing: preserve the generated junction graph while clearing paved overlaps.
import assert from 'node:assert/strict';
import { generateCity, spaceLocalRoadsNearRiverside } from '../src/road/cityGen.js';
import { getProfile, layout } from '../src/road/profiles.js';
import { RoadNetwork } from '../src/road/network.js';

const city = generateCity({ seed: 1337 });
assert.equal(city.nodes.size, 1192, 'spacing does not add or remove generated junction nodes');
assert.equal(city.edges.size, 1629, 'spacing does not add or remove generated road segments');

const sharedJunctions = (firstName, secondName) => [...city.nodes.keys()].filter(nodeId => {
  const names = city.nodeEdges(nodeId).map(edge => edge.name);
  return names.includes(firstName) && names.includes(secondName);
}).length;
assert.equal(sharedJunctions('Whitney Drive', 'North Riverside Drive'), 3,
  'Whitney Drive keeps all three existing connections to North Riverside Drive');
assert.equal(sharedJunctions('Broadway Loop', 'South Riverside Drive'), 4,
  'Broadway Loop keeps all four existing connections to South Riverside Drive');

const riversideDrives = [...city.edges.values()]
  .filter(edge => edge.name === 'North Riverside Drive' || edge.name === 'South Riverside Drive')
  .map(edge => ({ curve: city.centerline(edge), halfWidth: layout(getProfile(edge)).total / 2 }));
const targetEdges = [...city.edges.values()].filter(edge => {
  if (edge._cls !== 'local') return false;
  const mid = city.centerline(edge).frameAt(city.centerline(edge).length / 2);
  return (edge.name === 'Whitney Drive' && mid.x > 1000 && mid.x < 1500 && mid.z > 100 && mid.z < 260)
    || (edge.name === 'Broadway Loop' && mid.x > 1600 && mid.x < 2000 && mid.z > 90 && mid.z < 250);
});
assert.equal(targetEdges.length, 6, 'the seed fixture includes the three Whitney and three Broadway links beside the drives');

for (const edge of targetEdges) {
  const curve = city.centerline(edge);
  const halfWidth = layout(getProfile(edge)).total / 2;
  let minPavedGap = Infinity;
  let parallelSamples = 0;
  for (let s = 24; s <= curve.length - 24; s += 4) {
    const frame = curve.frameAt(s);
    let nearest = null;
    for (const drive of riversideDrives) {
      const point = drive.curve.nearest(frame.x, frame.z);
      if (!nearest || point.d < nearest.point.d) nearest = { ...drive, point };
    }
    const driveFrame = nearest.curve.frameAt(nearest.point.s);
    const parallel = Math.abs(frame.tx * driveFrame.tx + frame.tz * driveFrame.tz);
    if (parallel < 0.76) continue;
    parallelSamples++;
    minPavedGap = Math.min(minPavedGap,
      nearest.point.d - halfWidth - nearest.halfWidth);
  }
  assert(parallelSamples > 0, `${edge.name} fixture has a parallel run beside a riverside drive`);
  assert.ok(minPavedGap >= 3,
    `${edge.name} (${edge.id}) keeps at least 3 m between paved envelopes after the junction taper; got ${minPavedGap.toFixed(2)} m`);
}

// Exercise the geometry-only helper directly and pin its graph contract independently of
// the city fixture: centerlines move, but endpoint nodes, edges, and adjacency do not.
const net = new RoadNetwork();
const driveA = net.addNode({ id: 'drive-a', x: 0, z: -120 });
const driveB = net.addNode({ id: 'drive-b', x: 0, z: 120 });
const localA = net.addNode({ id: 'local-a', x: 18, z: -120 });
const localB = net.addNode({ id: 'local-b', x: 18, z: 120 });
net.addEdge({ id: 'riverside-drive', a: driveA.id, b: driveB.id, profile: 'collector', name: 'North Riverside Drive' });
const local = net.addEdge({
  id: 'local-link', a: localA.id, b: localB.id, profile: 'local', name: 'Test Local Street',
  features: [{ type: 'hump', s: 120, kind: 'table' }],
});
local._cls = 'local';
net.river = { pts: [[-100, 0], [100, 0]], width: 80 };
const beforeLength = net.centerline(local).length;
const beforeFeature = local.features[0].s;
const beforeTopology = () => ({
  nodes: [...net.nodes].map(([id, node]) => [id, node.x, node.y, node.z]),
  edges: [...net.edges].map(([id, edge]) => [id, edge.a, edge.b, edge.profile, edge.name]),
  adjacency: [...net.adj].map(([id, links]) => [id, [...links].sort()]),
});
const topology = beforeTopology();
const originalPoint = net.centerline(local).frameAt(120);
const originalDrivePoint = net.centerline(net.edges.get('riverside-drive')).nearest(originalPoint.x, originalPoint.z);
const originalClearance = originalDrivePoint.d
  - (layout(getProfile(local)).total + layout(getProfile(net.edges.get('riverside-drive'))).total) / 2;

assert.equal(spaceLocalRoadsNearRiverside(net), 1, 'the nearby local edge receives a geometry adjustment');
assert.deepEqual(beforeTopology(), topology, 'road nodes, endpoints, edge identities, and graph links are unchanged');
const afterLength = net.centerline(local).length;
assert.notEqual(afterLength, beforeLength, 'the local centerline geometry changes');
assert.ok(Math.abs(local.features[0].s / afterLength - beforeFeature / beforeLength) < 1e-8,
  'feature distances are rescaled with the updated centerline length');
const adjustedPoint = net.centerline(local).frameAt(afterLength / 2);
const adjustedDrivePoint = net.centerline(net.edges.get('riverside-drive')).nearest(adjustedPoint.x, adjustedPoint.z);
const adjustedClearance = adjustedDrivePoint.d
  - (layout(getProfile(local)).total + layout(getProfile(net.edges.get('riverside-drive'))).total) / 2;
assert.ok(adjustedClearance > originalClearance, 'the adjusted street gains paved-envelope clearance');
assert.ok(adjustedClearance >= 6, 'the test street receives the intended clear gap away from its end junctions');

console.log('riverside spacing checks passed: 6 named overlaps cleared, 7 m spacing target and road topology preserved');
