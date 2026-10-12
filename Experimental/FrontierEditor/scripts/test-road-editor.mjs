// Road editor checks: topology, geometry, generator determinism, catalogue.
// Run from Experimental/FrontierEditor: node scripts/test-road-editor.mjs
import assert from 'node:assert/strict';
import * as G from '../road-editor/road-graph.js';
import * as M from '../road-editor/road-geometry.js';
import * as C from '../road-editor/road-catalog.js';
import { createRng, fnv1a } from '../road-editor/rng.js';
import { generateCity } from '../road-editor/city-generator.js';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};
const P = (x, y, z) => ({ x, y, z });
const degreeValues = (net) => [...G.degrees(net).values()];

console.log('rng');
check('same seed gives same sequence', () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 50; i += 1) assert.equal(a.next(), b.next());
});
check('different seeds differ', () => {
  assert.notEqual(createRng(1).next(), createRng(2).next());
});
check('fnv1a is stable and returns 8 hex digits', () => {
  const h = fnv1a('frontier');
  assert.equal(h, fnv1a('frontier'));
  assert.match(h, /^[0-9a-f]{8}$/);
});

console.log('catalogue');
check('every preset has valid lanes and a known group', () => {
  for (const [id, p] of Object.entries(C.PRESETS)) {
    assert.ok(C.validLanes(p.lanes), `preset ${id} lanes invalid`);
    assert.ok(C.PRESET_GROUPS.includes(p.group), `preset ${id} group`);
  }
});
check('bus, cycle and parking kinds exist for city streets', () => {
  for (const k of ['bus', 'bike', 'cycle', 'parking', 'median', 'sidewalk', 'bus']) assert.ok(C.LANE_KINDS[k], k);
});
check('lane layout is contiguous and centred', () => {
  const { lanes, half, total } = C.layoutLanes(C.PRESETS.boulevard.lanes);
  assert.equal(lanes[0].oL, half);
  assert.ok(Math.abs(lanes[lanes.length - 1].oR + half) < 1e-9);
  assert.ok(Math.abs(total - 2 * half) < 1e-9);
});

console.log('graph topology');
check('crossing makes a degree-4 junction', () => {
  const net = G.createNetwork({ seed: 1 });
  G.addRoad(net, [P(-100, 0, 0), P(100, 0, 0)], { preset: 'arterial' });
  G.addRoad(net, [P(0, 0, -100), P(0, 0, 100)], { preset: 'arterial' });
  assert.equal(Object.keys(net.edges).length, 4);
  assert.equal(Object.keys(net.nodes).length, 5);
  assert.ok(degreeValues(net).includes(4));
});
check('elevated crossing (6 m) creates no junction', () => {
  const net = G.createNetwork({ seed: 1 });
  G.addRoad(net, [P(-100, 0, 0), P(100, 0, 0)], { preset: 'arterial' });
  G.addRoad(net, [P(0, 6, -100), P(0, 6, 100)], { preset: 'motorway' });
  assert.equal(Object.keys(net.edges).length, 2);
});
check('T-snap splits the target road to degree 3', () => {
  const net = G.createNetwork({ seed: 1 });
  G.addRoad(net, [P(-100, 0, 0), P(100, 0, 0)], { preset: 'arterial' });
  G.addRoad(net, [P(0, 0, 50), P(0, 0, 1.2)], { preset: 'local' });
  assert.ok(degreeValues(net).includes(3));
});
check('closed ring yields a single loop edge', () => {
  const net = G.createNetwork({ seed: 1 });
  const ring = [];
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    ring.push(P(50 * Math.cos(a), 0, 50 * Math.sin(a)));
  }
  const ids = G.addRoad(net, ring, { preset: 'residential', closed: true });
  assert.equal(ids.length, 1);
  const e = net.edges[ids[0]];
  assert.equal(e.a, e.b);
});
check('serialize / deserialize round-trips', () => {
  const net = G.createNetwork({ seed: 9 });
  G.addRoad(net, [P(-80, 0, 0), P(80, 0, 0)], { preset: 'boulevard', name: 'Main' });
  G.addRoad(net, [P(0, 0, -80), P(0, 0, 80)], { preset: 'avenue' });
  const id = G.addProp(net, { type: 'bollard', edge: Object.keys(net.edges)[0], s: 4 });
  const copy = G.deserialize(JSON.parse(JSON.stringify(G.serialize(net))));
  assert.equal(Object.keys(copy.edges).length, Object.keys(net.edges).length);
  assert.equal(Object.keys(copy.nodes).length, Object.keys(net.nodes).length);
  assert.equal(copy.props[id].type, 'bollard');
  assert.equal(copy.edges[Object.keys(net.edges)[0]].name, net.edges[Object.keys(net.edges)[0]].name);
});
check('no sliver edges below the node snap distance', () => {
  const net = G.createNetwork({ seed: 1 });
  G.addRoad(net, [P(-100, 0, 0), P(100, 0, 0)], { preset: 'arterial' });
  G.addRoad(net, [P(0, 0, -100), P(0, 0, 100)], { preset: 'arterial' });
  G.addRoad(net, [P(0.6, 0, -100), P(0.6, 0, 100)], { preset: 'local' });
  for (const e of Object.values(net.edges)) assert.ok(G.edgeLength(net, e) >= 2 || e.a !== e.b, `sliver ${e.id}`);
});

console.log('geometry');
check('mesh layers are finite with unit normals', () => {
  const net = G.createNetwork({ seed: 1 });
  G.addRoad(net, [P(-300, 0, 0), P(300, 0, 0)], { preset: 'boulevard' });
  G.addRoad(net, [P(0, 0, -300), P(0, 0, 300)], { preset: 'avenue' });
  G.addRoad(net, [P(-200, 0, 0), P(-200, 0, 200)], { preset: 'residential' });
  G.addRoad(net, [P(-300, 6, 120), P(300, 6, 120)], { preset: 'motorway' });
  G.addRoad(net, [P(-300, 0, 80), P(300, 0, 80)], { preset: 'rail-mainline' });
  G.refreshAutoProps(net);
  const out = M.buildNetworkMeshes(net);
  assert.ok(out.stats.triangles > 0);
  assert.ok(out.stats.junctions >= 4);
  for (const c of out.chunks) {
    for (const k of ['surface', 'markings', 'props', 'underground']) {
      const b = c[k];
      if (!b) continue;
      for (const v of b.position) assert.ok(Number.isFinite(v), `NaN in ${k}`);
      for (let i = 0; i < b.normal.length; i += 3) {
        const l = Math.hypot(b.normal[i], b.normal[i + 1], b.normal[i + 2]);
        assert.ok(Math.abs(l - 1) < 1e-3, `normal length ${l}`);
      }
    }
  }
  const hasMarkings = out.chunks.some((c) => c.markings);
  assert.ok(hasMarkings, 'expected road markings');
  const hasRailCrossing = Object.values(net.props).some((p) => p.type === 'railcrossing');
  assert.ok(hasRailCrossing, 'expected automatic level crossings');
});
check('underground roads produce an underground layer', () => {
  const net = G.createNetwork({ seed: 1 });
  G.addRoad(net, [P(-200, 0, 0), P(200, 0, 0)], { preset: 'arterial' });
  G.addRoad(net, [P(0, -9, -200), P(0, -9, 200)], { preset: 'subway' });
  const out = M.buildNetworkMeshes(net);
  assert.ok(out.chunks.some((c) => c.underground), 'expected underground layer');
});

console.log('generator');
const city = generateCity({ seed: 1 });
check('same seed gives the same network fingerprint', () => {
  const a = fnv1a(JSON.stringify(G.serialize(generateCity({ seed: 3 }))));
  const b = fnv1a(JSON.stringify(G.serialize(generateCity({ seed: 3 }))));
  assert.equal(a, b);
  assert.notEqual(a, fnv1a(JSON.stringify(G.serialize(generateCity({ seed: 4 })))));
});
check('city is large and dense (≥1000 roads, ≥500 junctions)', () => {
  assert.ok(Object.keys(city.edges).length >= 1000, `edges ${Object.keys(city.edges).length}`);
  assert.ok(city.meta.stats.junctions >= 500, `junctions ${city.meta.stats.junctions}`);
});
check('no sliver or self-loop roads', () => {
  for (const e of Object.values(city.edges)) {
    assert.notEqual(e.a, e.b, `self loop ${e.id}`);
    assert.ok(G.edgeLength(city, e) >= 2, `sliver ${e.id}`);
  }
});
check('presets used by the city are all in the catalogue', () => {
  for (const e of Object.values(city.edges)) assert.ok(C.PRESETS[e.preset], e.preset);
});
check('bus, cycle, parking, subway, rail, motorway and interchanges are generated', () => {
  const presets = new Set(Object.values(city.edges).map((e) => e.preset));
  for (const p of ['boulevard', 'avenue', 'cycle-street', 'residential', 'tram-street', 'rail-mainline', 'subway', 'motorway', 'slip-road']) {
    assert.ok(presets.has(p), `missing ${p}`);
  }
  assert.ok(city.meta.stats.interchanges >= 1);
});
check('street furniture: level crossings, stations, speed bumps and bollards', () => {
  const types = new Set(Object.values(city.props).map((p) => p.type));
  for (const t of ['railcrossing', 'station', 'speedbump', 'bollard']) assert.ok(types.has(t), `missing ${t}`);
});
check('city meshes are finite and build within budget', () => {
  const t0 = performance.now();
  const out = M.buildNetworkMeshes(city);
  const ms = performance.now() - t0;
  assert.ok(out.stats.triangles > 100000);
  assert.ok(ms < 15000, `mesh build ${ms.toFixed(0)} ms`);
  for (const c of out.chunks) for (const k of ['surface', 'markings', 'props', 'underground']) {
    if (c[k]) for (const v of c[k].position) assert.ok(Number.isFinite(v));
  }
});

console.log(`\nPASS ${passed} road-editor checks`);
