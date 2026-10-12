// Kernel tests: run with `npm test` (node --test). No browser or GPU needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sampleCenterline, slicePoly, pointAt, polyLength, nearestOnPoly, minCurveRadius } from '../src/core/centerline.js';
import { buildRoadBuckets, buildPadBuckets, BUCKETS } from '../src/core/geometry.js';
import { computeJunctions, trimFor } from '../src/core/junctions.js';
import {
  createProject, addNode, addRoad, moveNode, splitRoadAt, ensureNodeAt, deserialize, serialize,
  centerlineOf, removeRoad, roundaboutPoints, projectStats, insertPointAt, addProp, normalizeProject,
} from '../src/core/model.js';
import { generateCity } from '../src/core/city.js';
import { presetLanes, laneOffsets, ROAD_KINDS, LANE_KINDS } from '../src/core/lanes.js';
import { mulberry32, convexHull } from '../src/core/math.js';

const finite = (arr) => arr.every((v) => Number.isFinite(v));

function assertBucketsValid(B) {
  for (const name of BUCKETS) {
    const M = B[name];
    const vertexCount = M.p.length / 3;
    assert.equal(M.n.length, M.p.length, `${name}: normals length`);
    assert.equal(M.c.length, M.p.length, `${name}: colour length`);
    assert.equal(M.uv.length / 2, vertexCount, `${name}: uv length`);
    assert.equal(M.i.length % 3, 0, `${name}: index multiple of 3`);
    assert.ok(finite(M.p), `${name}: finite positions`);
    assert.ok(finite(M.n), `${name}: finite normals`);
    for (const idx of M.i) assert.ok(idx >= 0 && idx < vertexCount, `${name}: index in range`);
  }
}

test('straight centreline keeps its true length', () => {
  const cl = sampleCenterline([{ x: 0, z: 0 }, { x: 100, z: 0 }]);
  assert.ok(Math.abs(polyLength(cl) - 100) < 1e-6);
  const p = pointAt(cl, 50);
  assert.ok(Math.abs(p.x - 50) < 1e-9 && Math.abs(p.z) < 1e-9);
  assert.ok(Math.abs(p.tx - 1) < 1e-9);
});

test('curved centreline: arc length exceeds chord and tangents are unit', () => {
  const cl = sampleCenterline([{ x: 0, z: 0 }, { x: 50, z: 50 }, { x: 100, z: 0 }]);
  assert.ok(polyLength(cl) > 100);
  for (let i = 0; i < cl.n; i++) assert.ok(Math.abs(Math.hypot(cl.tx[i], cl.tz[i]) - 1) < 1e-9);
});

test('closed centreline repeats its first sample and wraps tangents', () => {
  const ring = roundaboutPoints(0, 0, 20, 12);
  const cl = sampleCenterline(ring, { closed: true });
  assert.ok(Math.abs(cl.x[0] - cl.x[cl.n - 1]) < 1e-9 && Math.abs(cl.z[0] - cl.z[cl.n - 1]) < 1e-9);
  const circ = polyLength(cl);
  assert.ok(Math.abs(circ - 2 * Math.PI * 20) / circ < 0.02, `circumference ${circ}`);
});

test('slicePoly keeps absolute arc length and exact end points', () => {
  const cl = sampleCenterline([{ x: 0, z: 0 }, { x: 100, z: 0 }]);
  const sub = slicePoly(cl, 20.5, 40.25);
  assert.ok(Math.abs(sub.s[0] - 20.5) < 1e-9);
  assert.ok(Math.abs(sub.s[sub.n - 1] - 40.25) < 1e-9);
  assert.ok(Math.abs(sub.x[0] - 20.5) < 1e-9);
  assert.equal(slicePoly(cl, 10, 10.1), null, 'tiny slices are rejected');
});

test('nearestOnPoly finds the perpendicular foot', () => {
  const cl = sampleCenterline([{ x: 0, z: 0 }, { x: 100, z: 0 }]);
  const n = nearestOnPoly(cl, 30, 7);
  assert.ok(Math.abs(n.s - 30) < 1e-6 && Math.abs(n.dist - 7) < 1e-6);
});

test('tight bends are detected via minimum curve radius', () => {
  const gentle = sampleCenterline([{ x: 0, z: 0 }, { x: 50, z: 50 }, { x: 100, z: 0 }]);
  const tight = sampleCenterline([{ x: 0, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 8 }]);
  assert.ok(minCurveRadius(gentle) > minCurveRadius(tight));
});

test('lane offsets span the carriageway symmetrically', () => {
  for (const kind of Object.keys(ROAD_KINDS)) {
    const lanes = presetLanes(kind);
    const offs = laneOffsets(lanes);
    assert.ok(Math.abs(offs[0] + offs[offs.length - 1]) < 1e-9, `${kind} symmetric`);
    for (const l of lanes) assert.ok(LANE_KINDS[l.kind], `${kind} lane kind ${l.kind} exists`);
  }
});

test('avenue presets carry bus, cycle and parking lanes; toggles remove them', () => {
  const full = presetLanes('avenue').map((l) => l.kind);
  assert.ok(full.includes('bus') && full.includes('bike') && full.includes('parking'));
  const plain = presetLanes('avenue', { busLanes: false, bikeLanes: false, parking: false }).map((l) => l.kind);
  assert.ok(!plain.includes('bus') && !plain.includes('bike') && !plain.includes('parking'));
});

test('every road kind produces valid, non-empty geometry', () => {
  for (const kind of Object.keys(ROAD_KINDS)) {
    const project = createProject('t');
    const pts = kind === 'roundabout' ? roundaboutPoints(0, 0, 12) : [{ x: 0, z: 0 }, { x: 120, z: 30 }];
    const road = addRoad(project, { kind, points: pts, closed: kind === 'roundabout', mode: ROAD_KINDS[kind].mode });
    const cl = centerlineOf(road);
    const B = buildRoadBuckets(road, cl, { start: 0, end: 0 });
    assertBucketsValid(B);
    const verts = Object.values(B).reduce((a, M) => a + M.p.length / 3, 0);
    assert.ok(verts > 0, `${kind} emits geometry`);
  }
});

test('bridge and underground modes emit their structures', () => {
  const project = createProject('t');
  const bridge = addRoad(project, {
    kind: 'avenue', mode: 'bridge',
    points: [{ x: 0, z: 0, h: 0 }, { x: 60, z: 0, h: 8 }, { x: 140, z: 0, h: 8 }, { x: 200, z: 0, h: 0 }],
  });
  const B = buildRoadBuckets(bridge, centerlineOf(bridge));
  assertBucketsValid(B);
  assert.ok(B.plain.p.length > 0, 'piers, parapets and underside present');
  const tunnel = addRoad(project, { kind: 'subway', mode: 'underground', points: [{ x: 0, z: 0 }, { x: 100, z: 0, h: -7 }] });
  const T = buildRoadBuckets(tunnel, centerlineOf(tunnel));
  assertBucketsValid(T);
  assert.ok(T.mask.p.length > 0, 'trench mask present');
});

test('junction trims road ends and produces a pad covering every arm', () => {
  const project = createProject('t');
  const c = addNode(project, 0, 0);
  const e = addNode(project, 100, 0);
  const n = addNode(project, 0, 100);
  const w = addNode(project, -100, 0);
  const arms = [
    addRoad(project, { kind: 'avenue', startNode: c, endNode: e, points: [project.nodes[c], project.nodes[e]] }),
    addRoad(project, { kind: 'local', startNode: c, endNode: n, points: [project.nodes[c], project.nodes[n]] }),
    addRoad(project, { kind: 'local', startNode: w, endNode: c, points: [project.nodes[w], project.nodes[c]] }),
  ];
  const junctions = computeJunctions(project, centerlineOf);
  assert.equal(junctions.pads.size, 1, 'one junction pad');
  const trim = trimFor(junctions, arms[0]);
  assert.ok(trim.start > 10, `avenue trims by its half width (${trim.start})`);
  const hull = junctions.pads.get(c);
  assert.ok(hull.length >= 4, 'hull has several corners');
  const hullArea = Math.abs(hull.reduce((a, p, i) => {
    const q = hull[(i + 1) % hull.length];
    return a + (p[0] * q[1] - q[0] * p[1]);
  }, 0)) / 2;
  assert.ok(hullArea > 500, `pad area ${hullArea}`);
  for (const road of arms) {
    const B = buildRoadBuckets(road, centerlineOf(road), trimFor(junctions, road));
    assertBucketsValid(B);
  }
  const pad = buildPadBuckets(hull);
  assertBucketsValid(pad);
  assert.ok(pad.asphalt.i.length > 0);
});

test('dead-end roads are not trimmed', () => {
  const project = createProject('t');
  const a = addNode(project, 0, 0);
  const b = addNode(project, 80, 0);
  const road = addRoad(project, { kind: 'local', startNode: a, endNode: b, points: [project.nodes[a], project.nodes[b]] });
  const junctions = computeJunctions(project, centerlineOf);
  assert.deepEqual(trimFor(junctions, road), { start: 0, end: 0 });
});

test('moving a shared node updates every attached road end', () => {
  const project = createProject('t');
  const a = addNode(project, 0, 0);
  const b = addNode(project, 100, 0);
  const c = addNode(project, 100, 100);
  const r1 = addRoad(project, { kind: 'local', startNode: a, endNode: b, points: [project.nodes[a], project.nodes[b]] });
  const r2 = addRoad(project, { kind: 'local', startNode: b, endNode: c, points: [project.nodes[b], project.nodes[c]] });
  moveNode(project, b, 120, 10);
  assert.deepEqual([r1.points.at(-1).x, r1.points.at(-1).z], [120, 10]);
  assert.deepEqual([r2.points[0].x, r2.points[0].z], [120, 10]);
});

test('splitRoadAt creates a T junction and re-homes props', () => {
  const project = createProject('t');
  const a = addNode(project, 0, 0);
  const b = addNode(project, 200, 0);
  const road = addRoad(project, { kind: 'collector', startNode: a, endNode: b, points: [project.nodes[a], project.nodes[b]] });
  addProp(project, road.id, { kind: 'speedBump', s: 50 });
  addProp(project, road.id, { kind: 'speedBump', s: 150 });
  const nid = splitRoadAt(project, road.id, 100, 0);
  assert.ok(nid && project.nodes[nid]);
  assert.equal(project.roads.length, 2);
  const [A, B] = project.roads;
  assert.equal(A.end, nid);
  assert.equal(B.start, nid);
  assert.equal(A.props.length, 1);
  assert.equal(B.props.length, 1);
  assert.ok(Math.abs(B.props[0].s - 50) < 1.5, `re-homed s ${B.props[0].s}`);
  removeRoad(project, B.id);
  assert.ok(!project.nodes[b] || project.roads.some((r) => r.end === b), 'orphan node cleaned up');
});

test('ensureNodeAt snaps to nearby nodes and splits roads it passes over', () => {
  const project = createProject('t');
  const a = addNode(project, 0, 0);
  const b = addNode(project, 200, 0);
  addRoad(project, { kind: 'local', startNode: a, endNode: b, points: [project.nodes[a], project.nodes[b]] });
  assert.equal(ensureNodeAt(project, 1, 1), a, 'snap to node');
  const mid = ensureNodeAt(project, 90, 1.5);
  assert.ok(mid && mid !== a && mid !== b, 'mid-road hit creates a node');
  assert.equal(project.roads.length, 2);
  assert.equal(ensureNodeAt(project, 90, 60), null, 'far away returns null');
});

test('insertPointAt adds a control point on the nearest segment', () => {
  const project = createProject('t');
  const a = addNode(project, 0, 0);
  const b = addNode(project, 200, 0);
  const road = addRoad(project, { kind: 'local', startNode: a, endNode: b, points: [project.nodes[a], project.nodes[b]] });
  const idx = insertPointAt(project, road.id, 60, 4);
  assert.equal(idx, 1);
  assert.equal(road.points.length, 3);
  assert.ok(Math.abs(road.points[1].x - 60) < 1e-6);
});

test('serialization round-trips and repairs unknown kinds', () => {
  const project = generateCity({ seed: 3, cols: 3, rows: 3 });
  const text = serialize(project);
  const back = deserialize(text);
  assert.equal(back.roads.length, project.roads.length);
  assert.equal(serialize(back), text);
  const repaired = normalizeProject({ roads: [{ id: 'r5', kind: 'hovercraft', points: [{ x: 0, z: 0 }, { x: 9, z: 0 }] }], nodes: {} });
  assert.equal(repaired.roads[0].kind, 'local');
  assert.ok(repaired.nextId > 5);
});

test('seeded city is deterministic, topologically clean and fully finite', () => {
  const a = generateCity({ seed: 11, cols: 6, rows: 6 });
  const b = generateCity({ seed: 11, cols: 6, rows: 6 });
  assert.equal(serialize(a), serialize(b), 'same seed, same city');
  const c = generateCity({ seed: 12, cols: 6, rows: 6 });
  assert.notEqual(serialize(a), serialize(c));

  const stats = projectStats(a);
  assert.ok(stats.roads > 60 && stats.lengthKm > 5, JSON.stringify(stats));
  assert.ok(stats.bridges === 1 && stats.tunnels === 1);

  for (const road of a.roads) {
    if (!road.closed) {
      assert.ok(road.start && a.nodes[road.start], `${road.id} start node`);
      assert.ok(road.end && a.nodes[road.end], `${road.id} end node`);
    }
  }
  const kinds = new Set(a.roads.map((r) => r.kind));
  for (const k of ['avenue', 'collector', 'local', 'highway', 'subway', 'railway', 'footpath']) assert.ok(kinds.has(k), `has ${k}`);
  const propKinds = new Set(a.roads.flatMap((r) => r.props.map((p) => p.kind)));
  for (const k of ['speedBump', 'crosswalk', 'stopLine', 'railCrossing', 'lamps']) assert.ok(propKinds.has(k), `has prop ${k}`);

  const junctions = computeJunctions(a, centerlineOf);
  assert.ok(junctions.pads.size >= 36, 'every grid intersection has a pad');
  let verts = 0;
  for (const road of a.roads) {
    const B = buildRoadBuckets(road, centerlineOf(road), trimFor(junctions, road));
    assertBucketsValid(B);
    verts += Object.values(B).reduce((acc, M) => acc + M.p.length / 3, 0);
  }
  assert.ok(verts > 100000, `city geometry ${verts} vertices`);
});

test('convex hull is counter-clockwise and drops interior points', () => {
  const hull = convexHull([[0, 0], [4, 0], [4, 4], [0, 4], [2, 2], [1, 1]]);
  assert.equal(hull.length, 4);
  const area = hull.reduce((a, p, i) => {
    const q = hull[(i + 1) % hull.length];
    return a + (p[0] * q[1] - q[0] * p[1]);
  }, 0) / 2;
  assert.ok(area > 15.9 && area < 16.1, `area ${area}`);
});

test('seeded rng is stable across calls', () => {
  const r1 = mulberry32(42);
  const r2 = mulberry32(42);
  for (let i = 0; i < 100; i++) assert.equal(r1(), r2());
});
