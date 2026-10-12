// Bridge-type quality gate: every style meshes without NaN, builds its signature
// structure, and survives a save round-trip. Fixture: 4 arterials crossing a 72 m
// test river (arch / cable / truss / beam control) + a generator spot-check.
// Exit code 1 if any check fails.
import { RoadNetwork } from '../src/road/network.js';
import { NetworkBuilder } from '../src/road/builder.js';
import { generateCity } from '../src/road/cityGen.js';

let fails = 0, checked = 0;
const ok = (cond, msg) => { checked++; if (!cond) { console.log('  FAIL ' + msg); fails++; } else console.log('  ok ' + msg); };

const net = new RoadNetwork();
net.river = { pts: [[-400, 0], [400, 0]], width: 72, name: 'Test River' };
const edges = [];
['arch', 'cable', 'truss', null].forEach((st, i) => {
  const x = -150 + i * 100;
  const a = net.addNode({ x, z: -120, y: 0 }), b = net.addNode({ x, z: 120, y: 0 });
  edges.push(net.addEdge({
    a: a.id, b: b.id, profile: 'arterial', bridge: st,
    pts: [{ x, z: -40, y: 1.2 }, { x, z: 0, y: 2.4 }, { x, z: 40, y: 1.2 }],
  }));
});
const b = new NetworkBuilder(net, { trees: false, markings: false, props: true });
await b.buildAll();
const outs = edges.map(e => b.outs.get(e.id));
const tri = (o, k) => (o && o.mesh[k] ? o.mesh[k].i.length / 3 : 0);
const yRange = (o, k) => {
  const m = o && o.mesh[k]; if (!m) return [0, 0];
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < m.p.length; i += 3) { if (m.p[i] < lo) lo = m.p[i]; if (m.p[i] > hi) hi = m.p[i]; }
  return [lo, hi];
};
const props = (o, k) => (o && o.props[k] ? o.props[k].length / 8 : 0);
const [arch, cable, truss, beam] = outs;
// --- signature structure
ok(tri(cable, 'steel') > tri(beam, 'steel') + 200, `cable stays mesh (${tri(cable, 'steel')} vs ${tri(beam, 'steel')} beam steel tris)`);
ok(tri(truss, 'steel') > tri(beam, 'steel') + 400, `truss lattice meshes (${tri(truss, 'steel')} vs ${tri(beam, 'steel')} beam steel tris)`);
ok(tri(arch, 'concrete') > tri(beam, 'concrete') + 300, `arch ribs add concrete (${tri(arch, 'concrete')} vs ${tri(beam, 'concrete')} tris)`);
const [, cableTop] = yRange(cable, 'concrete');
ok(cableTop > 15, `cable pylon rises over the deck (top y=${cableTop.toFixed(1)})`);
const [, trussTop] = yRange(truss, 'steel');
ok(trussTop > 5 && trussTop < 10, `truss portals clear traffic (top y=${trussTop.toFixed(1)})`);
const [archLo] = yRange(arch, 'concrete');
const [beamLo] = yRange(beam, 'concrete');
ok(archLo < beamLo - 1, `arch ribs dip below the beam line (${archLo.toFixed(1)} vs ${beamLo.toFixed(1)})`);
// --- no deck left floating: every style stands on bents (props) or pylons
const cols = o => props(o, 'pierCol') + props(o, 'pierColWide');
ok(cols(beam) > 0, `beam stands on bents (${cols(beam)} columns)`);
ok(cols(truss) > 0, `truss stands on bents (${cols(truss)} columns)`);
ok(cols(arch) > 0, `arch spans stand on piers (${cols(arch)} columns)`);
// --- NaN scan
{
  let nan = 0;
  for (const o of outs) for (const k in o.mesh) for (const v of o.mesh[k].p) if (!Number.isFinite(v)) { nan++; break; }
  ok(nan === 0, 'no NaN vertices in any bridge mesh');
}
// --- save round-trip preserves the style and rebuilds identically
{
  const json = JSON.parse(JSON.stringify(net.toJSON()));
  const { RoadNetwork: RN } = await import('../src/road/network.js');
  const n2 = RN.fromJSON(json);
  const got = [...n2.edges.values()].map(e => e.bridge || null);
  ok(JSON.stringify(got) === JSON.stringify(['arch', 'cable', 'truss', null]), `styles survive save/load (${got})`);
  const b2 = new NetworkBuilder(n2, { trees: false, markings: false, props: true });
  await b2.buildAll();
  const same = edges.every((e, i) => {
    const a = b2.outs.get(e.id), o = outs[i];
    return a && Object.keys(o.mesh).every(k => tri(a, k) === tri(o, k));
  });
  ok(same, 'rebuilt geometry identical after reload');
}
// --- generator spot-check: river cities build all three styles
{
  const g = generateCity({ seed: 7, size: 4000 });
  const st = {};
  for (const e of g.edges.values()) if (e.bridge) st[e.bridge] = (st[e.bridge] || 0) + 1;
  ok((st.arch || 0) >= 2, `city builds arch viaducts (${st.arch || 0})`);
  ok(st.cable === 1, `city builds one cable-stayed landmark (${st.cable || 0})`);
  ok((st.truss || 0) >= 1, `freeway river span is a truss (${st.truss || 0})`);
  const bg = new NetworkBuilder(g, { trees: false, markings: false, props: true });
  await bg.buildAll();
  let nan = 0;
  for (const e of g.edges.values()) {
    if (!e.bridge) continue;
    const o = bg.outs.get(e.id);
    for (const k in o.mesh) for (const v of o.mesh[k].p) if (!Number.isFinite(v)) { nan++; break; }
  }
  ok(nan === 0, 'generated bridges mesh without NaN');
}

console.log(fails ? `\n${fails}/${checked} FAILED` : `\nall ${checked} checks passed`);
process.exit(fails ? 1 : 0);
