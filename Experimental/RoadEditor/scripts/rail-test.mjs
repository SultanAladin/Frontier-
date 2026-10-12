// Railway + transition quality gate. Builds small fixtures headlessly and checks that
// every new topology classifies, meshes without NaN, and survives a save round-trip:
//
//  taper    2+2 lanes meet 3+3 on a straight: kind 'taper', stretched apron, merge arrows
//  merge    branch joins a through road at ~30°: kind 'merge', branch yields, gore paint
//  heavy    graph railway with switch, halt, level crossing and buffer stops
//  mono     suspended guideway with a station and terminus caps, crossing over a street
//  tram     tram-lane road gets grooved rails embedded in the carriageway
//
// Exit code 1 if any check fails.
import { RoadNetwork } from '../src/road/network.js';
import { NetworkBuilder } from '../src/road/builder.js';
import { MONO_DEFAULT_Y } from '../src/road/railProfiles.js';

let fails = 0, checked = 0;
const ok = (cond, msg) => { checked++; if (!cond) { console.log('  FAIL ' + msg); fails++; } else console.log('  ok ' + msg); };

const net = new RoadNetwork();
const D = (w, dir) => ({ type: 'drive', width: w, dir });
const SW = { type: 'sidewalk', width: 3 };
// --- taper: same family, one extra lane per direction on the north leg
const narrow = { name: 't2', category: 'urban', surface: 'asphalt', lanes: [SW, D(3.4, 1), D(3.4, 1), D(3.4, -1), D(3.4, -1), SW] };
const wide = { name: 't3', category: 'urban', surface: 'asphalt', lanes: [SW, D(3.4, 1), D(3.4, 1), D(3.4, 1), D(3.4, -1), D(3.4, -1), D(3.4, -1), SW] };
const t0 = net.addNode({ x: -260, z: 0 }), t1 = net.addNode({ x: -100, z: 0 }), t2 = net.addNode({ x: 60, z: 0 });
net.addEdge({ a: t0.id, b: t1.id, profile: 'local', custom: narrow });
net.addEdge({ a: t1.id, b: t2.id, profile: 'local', custom: wide });
// --- merge: branch joins the mainline at ~30°
const m0 = net.addNode({ x: -220, z: 220 }), m1 = net.addNode({ x: -100, z: 220 }), m2 = net.addNode({ x: 20, z: 220 });
const mb = net.addNode({ x: -200, z: 280 });
net.addEdge({ a: m0.id, b: m1.id, profile: 'collector' });
net.addEdge({ a: m1.id, b: m2.id, profile: 'collector' });
const mbEdge = net.addEdge({ a: mb.id, b: m1.id, profile: 'collector' });
// --- roads the railways cross
const r0 = net.addNode({ x: -120, z: -50 }), r1 = net.addNode({ x: 120, z: -50 });
net.addEdge({ a: r0.id, b: r1.id, profile: 'local' });                       // level crossing with heavy rail
const s0 = net.addNode({ x: 200, z: 0 }), s1 = net.addNode({ x: 400, z: 0 });
net.addEdge({ a: s0.id, b: s1.id, profile: 'local' });                       // street under the mono station
// --- tram avenue
const v0 = net.addNode({ x: -260, z: -160 }), v1 = net.addNode({ x: -100, z: -160 });
const tramEdge = net.addEdge({ a: v0.id, b: v1.id, profile: 'tramAvenue' });
// --- heavy rail: buffer — halt — crossing — switch — buffer
const h0 = net.rail.addNode({ x: 0, z: -300 }), h1 = net.rail.addNode({ x: 0, z: -100 });
const h2 = net.rail.addNode({ x: 0, z: 100 });
const h3 = net.rail.addNode({ x: 140, z: 190 }), h4 = net.rail.addNode({ x: 0, z: 300 });
net.rail.addEdge({ a: h0.id, b: h1.id, profile: 'heavy2' });
const haltEdge = net.rail.addEdge({ a: h1.id, b: h2.id, profile: 'heavy2', features: [{ type: 'halt', s: 140 }] });
net.rail.addEdge({ a: h2.id, b: h4.id, profile: 'heavy2' });
net.rail.addEdge({ a: h2.id, b: h3.id, profile: 'heavy1' });
net.rail.addEdge({ a: h3.id, b: net.rail.addNode({ x: 220, z: 260 }).id, profile: 'heavy1' });
// --- suspended mono: terminus — station — terminus, over the street
const y = MONO_DEFAULT_Y;
const n0 = net.rail.addNode({ x: 300, z: -200, y }), n1 = net.rail.addNode({ x: 300, z: 0, y, station: true });
const n2 = net.rail.addNode({ x: 300, z: 200, y });
const monoE1 = net.rail.addEdge({ a: n0.id, b: n1.id, profile: 'mono2' });
const monoE2 = net.rail.addEdge({ a: n1.id, b: n2.id, profile: 'mono2' });

const b = new NetworkBuilder(net);
await b.buildAll();

const J = id => b.junctions.get(id), RJ = id => b.railJunctions.get(id);
const out = id => b.outs.get(id);
const tris = o => Object.values(o.mesh).reduce((a, m) => a + m.i.length / 3, 0);
const propCount = (o, t) => (o.props[t] ? o.props[t].length / 8 : 0);

// --- taper + merge classification
ok(J(t1.id).kind === 'taper', `taper classified (got ${J(t1.id).kind}, L=${J(t1.id).taper?.L})`);
ok(J(m1.id).kind === 'merge', `merge classified (got ${J(m1.id).kind})`);
ok(J(m1.id).merge?.branch === mbEdge.id, 'merge branch identified');
{
  const { endControl } = await import('../src/road/geom/control.js');
  const JM = J(m1.id);
  const cB = endControl(JM, JM.ends.find(e => e.id === mbEdge.id), net);
  const cM = endControl(JM, JM.ends.find(e => e.id !== mbEdge.id), net);
  ok(cB.yield && !cM.yield && cM.mainline, 'branch yields, mainline flows');
  ok(tris(out(t1.id)) > 200, 'taper apron meshed');
}
// --- rail junctions
ok(RJ(h0.id).kind === 'buffer', `heavy terminus is a buffer (got ${RJ(h0.id).kind})`);
ok(RJ(h1.id).kind === 'continuation', `straight heavy joint flows through (got ${RJ(h1.id).kind})`);
ok(RJ(h2.id).kind === 'switch', `3-way heavy node is a switch (got ${RJ(h2.id).kind})`);
ok(RJ(h2.id).spec?.div && RJ(h2.id).spec?.facing, 'switch has diverging + facing legs');
ok(RJ(n1.id).kind === 'station', `flagged mono node is a station (got ${RJ(n1.id).kind})`);
ok(RJ(n0.id).kind === 'terminus', `mono line end is a terminus (got ${RJ(n0.id).kind})`);
// --- rail meshes
ok(propCount(out(h0.id), 'bufferStop') === 2, 'buffer stops on both tracks');
ok(propCount(out(monoE1.id), 'monoStop') === 2, 'terminus beam caps + stops');
ok(propCount(out(n1.id), 'monoSign') >= 2, 'station signs');
ok(propCount(out(haltEdge.id), 'haltSign') === 2, 'halt signs on both platforms');
ok(propCount(out(haltEdge.id), 'lampPost') === 6, 'halt lamps');
{
  let gates = 0;
  for (const o of b.outs.values()) gates += propCount(o, 'gatePost');
  ok(gates > 0, `level crossing gates placed (${gates})`);
}
ok(tris(out(tramEdge.id)) > 100 && (out(tramEdge.id).mesh.steel?.i.length || 0) > 0, 'tram rails embedded');
// --- pylons keep off the street, beams clear it
{
  let cols = 0, bad = 0;
  for (const e of [monoE1, monoE2]) {
    const arr = out(e.id).props.pierCol || [];
    for (let k = 0; k < arr.length; k += 8) {
      cols++;
      const px = arr[k], pz = arr[k + 2];
      if (Math.abs(pz) < 8 && px > 190 && px < 410) bad++;   // inside the street corridor
    }
  }
  ok(cols > 0 && bad === 0, `guideway pylons avoid the street (${cols} placed, ${bad} blocking)`);
}
// --- NaN / warning scan
{
  let nan = 0, warn = 0;
  for (const [id, o] of b.outs) {
    for (const k in o.mesh) { for (const v of o.mesh[k].p) if (!Number.isFinite(v)) { nan++; break; } }
    for (const k in o.props) { for (const v of o.props[k]) if (!Number.isFinite(v)) { nan++; break; } }
    if (o.warning) warn++;
  }
  ok(nan === 0, 'no NaN in rail/transition geometry');
  ok(warn === 0, 'no build warnings');
}
// --- trains run the routes and stop at stations
{
  const { TrainSystem } = await import('../src/render/trains.js');
  const THREE = await import('three');
  const scene = new THREE.Scene();
  const ts = new TrainSystem(scene, net, { railJunctions: b.railJunctions, seed: 7, counts: { heavy: 2, mono: 1, tram: 1, legacy: 0 } });
  ok(ts.trains.length === 4, `train consists spawned (${ts.trains.length})`);
  for (let i = 0; i < 600; i++) ts.update(0.1);
  let finite = 0;
  for (const t of ts.trains) for (const c of t.cars) { const p = c.group.position; if (Number.isFinite(p.x + p.y + p.z)) finite++; }
  ok(finite > 0, `train cars placed on track (${finite} finite)`);
  const mono = ts.trains.find(t => t.cars.length === 3 && t.cars[0].len === 10);
  const { walkRailRoute } = await import('../src/render/trains.js');
  const stationRoute = walkRailRoute(net.rail, b.railJunctions, monoE1, 1, () => 0.9);
  ok(stationRoute && stationRoute.stops.length === 1 && Math.abs(stationRoute.stops[0].d - 200) < 25, 'mono stops at the station');
  ok(mono && mono.cars.every(c => c.group.position.y > 4 && c.group.position.y < 9), 'cabins hang below the beam');
  const heavy = ts.trains.find(t => t.cars.length > 3);
  ok(heavy && heavy.route.total > 60 && heavy.route.stops.length > 0, 'heavy consist routes the graph with halts');
  const tram = ts.trains.find(t => t.cars.length === 2 && t.cars[0].len === 7.5);
  ok(tram && tram.route.total > 60, 'tram routes the street network');
  const ts2 = new TrainSystem(scene, net, { railJunctions: b.railJunctions, seed: 7, keep: ts.trains.map(t => ({ kind: t.kind, frac: t.route.total ? t.s / t.route.total : 0, dir: t.dir })), counts: { heavy: 2, mono: 1, tram: 1, legacy: 0 } });
  ok(ts2.trains.length === ts.trains.length && ts2.trains.every((t, i) => t.kind === ts.trains[i].kind && Math.abs(t.s - ts.trains[i].s) < 1e-6), 'route rebuild preserves train progress');
}
// --- save round-trip
{
  const json = JSON.parse(JSON.stringify(net.toJSON()));
  const n2 = (await import('../src/road/network.js')).RoadNetwork.fromJSON(json);
  const b2 = new NetworkBuilder(n2);
  await b2.buildAll();
  ok(n2.rail.edges.size === net.rail.edges.size && n2.rail.nodes.size === net.rail.nodes.size, 'rail graph survives save/load');
  ok(b2.railJunctions.get(h2.id).kind === 'switch' && b2.junctions.get(t1.id).kind === 'taper', 'topology identical after reload');
}

console.log(fails ? `\n${fails}/${checked} FAILED` : `\nall ${checked} checks passed`);
process.exit(fails ? 1 : 0);
