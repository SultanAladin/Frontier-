import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planarize, validateTopology, makeRng, catmullRom, offsetPolyline, polylineLength, resampleByLength } from '../src/geometry.js';

const road = (id, points, layer = 0, extra = {}) => ({ id, layer, points, width: 7, ...extra });
const degree = (g, nodeId) => g.edges.filter((e) => e.a === nodeId || e.b === nodeId).length;

test('plus crossing becomes ONE shared 4-way node', () => {
  const g = planarize([
    road('h', [[-50, 0], [50, 0]]),
    road('v', [[0, -50], [0, 50]]),
  ]);
  assert.equal(g.nodes.length, 5, 'centre + 4 ends');
  const centre = g.nodes.find((n) => Math.abs(n.x) < 1e-6 && Math.abs(n.y) < 1e-6);
  assert.ok(centre, 'centre node exists');
  assert.equal(degree(g, centre.id), 4);
  assert.equal(g.edges.length, 4);
  assert.ok(validateTopology(g).ok);
});

test('T junction snaps the stub onto the through road', () => {
  const g = planarize([
    road('through', [[-40, 0], [40, 0]]),
    road('stub', [[0, 30], [0.1, 0.1]]), // ends 0.1m from the through road
  ]);
  const junction = g.nodes.find((n) => Math.abs(n.y) < 0.2 && Math.abs(n.x) < 0.2);
  assert.ok(junction, 'junction near (0,0)');
  assert.equal(degree(g, junction.id), 3);
  assert.ok(validateTopology(g).ok);
});

test('Y junction (three arms meeting at one point)', () => {
  const g = planarize([
    road('a', [[0, 0], [-40, 40]]),
    road('b', [[0, 0], [40, 40]]),
    road('c', [[-30, 60], [0, 0], [0, -40]]),
  ]);
  const hub = g.nodes.find((n) => Math.hypot(n.x, n.y) < 0.2);
  assert.ok(hub);
  assert.equal(degree(g, hub.id), 4, 'a, b and both halves of c meet at the hub');
  assert.ok(validateTopology(g).ok);
});

test('a bridge crossing a surface road is NOT merged', () => {
  const g = planarize([
    road('ground', [[-50, 0], [50, 0]], 0),
    road('bridge', [[0, -50], [0, 50]], 1, { kind: 'bridge' }),
  ]);
  assert.equal(g.nodes.length, 4, 'each road keeps its own ends; no crossing node');
  assert.equal(g.edges.length, 2);
  assert.ok(validateTopology(g).ok, 'grade separated crossings are valid');
});

test('a surface crossing merges with the other surface road only', () => {
  const g = planarize([
    road('ground', [[-50, 0], [50, 0]], 0),
    road('cross', [[0, -50], [0, 50]], 0),
    road('deck', [[-60, 10], [-40, 10]], 1),
  ]);
  const surfaceNodes = g.nodes.filter((n) => n.layers.includes(0));
  assert.equal(surfaceNodes.length, 5, 'surface roads form one plus junction');
  assert.ok(validateTopology(g).ok);
});

test('a road that crosses itself gets a loop node instead of an overlap', () => {
  const g = planarize([road('loop', [[0, 0], [50, -20], [50, 20], [0, -20], [0, 20]])]);
  assert.ok(validateTopology(g).ok);
  assert.ok(g.nodes.length >= 3);
});

test('validateTopology reports an unmerged crossing when given raw edges', () => {
  const fake = {
    nodes: [],
    edges: [
      { id: 0, a: 0, b: 1, layer: 0, points: [[-10, 0], [10, 0]] },
      { id: 1, a: 2, b: 3, layer: 0, points: [[0, -10], [0, 10]] },
    ],
  };
  const r = validateTopology(fake);
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].type, 'unmerged-crossing');
});

test('collinear overlapping roads are reported as overlaps', () => {
  const fake = {
    nodes: [],
    edges: [
      { id: 0, a: 0, b: 1, layer: 0, points: [[0, 0], [100, 0]] },
      { id: 1, a: 2, b: 3, layer: 0, points: [[20, 0.05], [80, 0.05]] },
    ],
  };
  const r = validateTopology(fake);
  assert.ok(r.problems.some((p) => p.type === 'overlap'));
});

test('seeded RNG is deterministic and catmullRom passes through control points', () => {
  const a = makeRng(42), b = makeRng(42);
  assert.equal(a(), b());
  const pts = catmullRom([[0, 0], [10, 0], [20, 10]], 4);
  assert.deepEqual(pts[0], [0, 0]);
  assert.deepEqual(pts[pts.length - 1], [20, 10]);
});

test('offsetPolyline keeps width on straight and curved lines', () => {
  const straight = offsetPolyline([[0, 0], [10, 0]], 3);
  assert.ok(Math.abs(straight[0][1] - 3) < 1e-9);
  const bent = offsetPolyline([[0, 0], [10, 0], [10, 10]], 2);
  assert.ok(Math.abs(bent[1][1] - 2) < 1e-9);
});

test('resampleByLength keeps the total length within a small error', () => {
  const pts = [[0, 0], [100, 0], [100, 50]];
  const r = resampleByLength(pts, 5);
  assert.ok(Math.abs(polylineLength(r) - polylineLength(pts)) < 0.5);
});
