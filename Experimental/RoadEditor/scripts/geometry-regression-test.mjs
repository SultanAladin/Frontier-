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

console.log('geometry regression checks passed: single centered median noses and centered roundabout island');
