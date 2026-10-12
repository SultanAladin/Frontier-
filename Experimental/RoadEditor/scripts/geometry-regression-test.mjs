// Geometry regressions for central raised islands and roundabout placement.
import assert from 'node:assert/strict';
import { getProfile, layout } from '../src/road/profiles.js';
import { RoadNetwork } from '../src/road/network.js';
import { computeJunction } from '../src/road/junction.js';
import { buildEdge } from '../src/road/geom/edge.js';
import { buildJunction } from '../src/road/geom/junctionMesh.js';

const expected = {
  boulevard: { width: 5.2, total: 37.4 },
  arterialBRT: { width: 2.4, total: 30.8 },
};
for (const [id, want] of Object.entries(expected)) {
  const lay = layout(getProfile({ profile: id }));
  const medians = lay.lanes.filter(l => l.type === 'median');
  assert.equal(medians.length, 1, `${id} should have one continuous center median`);
  assert.ok(Math.abs(medians[0].width - want.width) < 1e-8, `${id} keeps the combined median width`);
  assert.ok(Math.abs((medians[0].o0 + medians[0].o1) / 2) < 1e-8, `${id} median is centered on the roadway`);
  assert.ok(Math.abs(lay.total - want.total) < 1e-8, `${id} keeps its original overall road width`);

  const net = new RoadNetwork();
  const a = net.addNode({ x: 0, z: 0, y: 0 });
  const b = net.addNode({ x: 200, z: 0, y: 0 });
  const edge = net.addEdge({ a: a.id, b: b.id, profile: id });
  const out = buildEdge(net, edge, computeJunction(net, a.id), computeJunction(net, b.id), {
    markings: false, props: false, trees: false,
  });
  const noses = (out.props.bollardSign || []).length / 8;
  assert.equal(noses, 2, `${id} should make one rounded island nose at each end, not paired pill noses`);
}

// Mismatched approaches should blend to a stable-width rounded corner instead of pinching
// across the arc from the wider sidewalk to the narrower (or absent) one.
const cornerNet = new RoadNetwork();
const cornerNode = cornerNet.addNode({ x: 0, z: 0, y: 0 });
for (const [dx, dz, profile] of [
  [1, 0, 'arterial4'], [0, 1, 'dirtRoad'], [-1, 0, 'local'], [0, -1, 'industrial'],
]) {
  const outer = cornerNet.addNode({ x: dx * 120, z: dz * 120, y: 0 });
  cornerNet.addEdge({ a: cornerNode.id, b: outer.id, profile });
}
const corners = computeJunction(cornerNet, cornerNode.id);
const mismatched = corners.gaps.filter(g => g.type === 'arc' && Math.abs(g.swA - g.swB) > 0.1);
assert(mismatched.length > 0, 'fixture includes corners with unequal sidewalk widths');
for (const g of mismatched) {
  assert(g.blendA > 0 || g.blendB > 0, 'width difference is transitioned along the approach');
  const [start, end] = g.arcRange;
  assert(end > start, 'rounded corner arc has a nonempty constant-width run');
  for (let i = start; i <= end; i++) {
    const a = g.curb[i], b = g.outer[i];
    const width = Math.hypot(b[0] - a[0], b[2] - a[2]);
    assert.ok(Math.abs(width - g.cornerWidth) < 1e-6, 'sidewalk width stays constant around the curved return');
  }
  const approachWidth = g.outer[0].map((v, i) => v - g.curb[0][i]);
  const startWidth = Math.hypot(approachWidth[0], approachWidth[2]);
  assert.ok(Math.abs(startWidth - g.swA) < 1e-6, 'corner ramp meets the approach at its original width');
  assert.ok(Math.abs(Math.hypot(g.outer.at(-1)[0] - g.curb.at(-1)[0], g.outer.at(-1)[2] - g.curb.at(-1)[2]) - g.swB) < 1e-6,
    'corner ramp returns to the adjoining approach width');
}

// A two-edge alley/one-way elbow must round both sides of the bend instead of leaving a
// straight chord that makes the connected roads look like an L-shaped collision.
const elbowNet = new RoadNetwork();
const elbow = elbowNet.addNode({ x: 0, z: 0, y: 0 });
const west = elbowNet.addNode({ x: -120, z: 0, y: 0 });
const north = elbowNet.addNode({ x: 0, z: -120, y: 0 });
elbowNet.addEdge({ a: elbow.id, b: west.id, profile: 'alley' });
elbowNet.addEdge({ a: elbow.id, b: north.id, profile: 'oneway' });
const elbowJunction = computeJunction(elbowNet, elbow.id);
assert.equal(elbowJunction.kind, 'junction');
assert.equal(elbowJunction.gaps.filter(g => g.type === 'arc').length, 2,
  'both inner and outer boundaries of a two-edge elbow should be rounded');
assert.equal(elbowJunction.gaps.filter(g => g.outerSide).length, 1,
  'the outside return uses its paired radius on the far side of the bend');
const elbowMesh = buildJunction(elbowNet, elbowJunction, { markings: false, props: false });
assert(elbowMesh.mesh.asphalt?.i.length > 0, 'rounded elbow builds a connected paved junction surface');
for (const mesh of Object.values(elbowMesh.mesh)) assert(mesh.p.every(Number.isFinite), 'elbow mesh stays finite');

// A roundabout's island must stay centered on its actual junction node, including off-origin nodes.
const net = new RoadNetwork();
const center = net.addNode({ x: 137, z: -83, y: 0, kind: 'roundabout', rbRadius: 24 });
for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
  const outer = net.addNode({ x: center.x + dx * 180, z: center.z + dz * 180, y: 0 });
  net.addEdge({ a: center.id, b: outer.id, profile: 'arterial4' });
}
const junction = computeJunction(net, center.id);
assert.equal(junction.kind, 'roundabout');
assert.ok(junction.hole?.length >= 24, 'roundabout has a closed central island ring');
for (const p of junction.hole) {
  assert.ok(Math.abs(Math.hypot(p[0] - center.x, p[2] - center.z) - junction.Ri) < 1e-7,
    'roundabout island samples remain concentric with the junction node');
}
const island = buildJunction(net, junction, { markings: false, props: false });
const grass = island.mesh.grass;
assert.ok(grass, 'roundabout island produces its grass surface');
assert.ok(Math.abs(grass.p[0] - center.x) < 1e-8 && Math.abs(grass.p[2] - center.z) < 1e-8,
  'roundabout island fill is positioned over its node, not displaced down an approach');

console.log('geometry regression checks passed: corner-width blends, rounded L elbows, single centered medians and roundabout placement');
