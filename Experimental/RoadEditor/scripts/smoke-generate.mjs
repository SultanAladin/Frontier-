// Headless check: generate a city, build every element, report geometry stats and warnings.
import { generateCity } from '../src/road/cityGen.js';
import { NetworkBuilder } from '../src/road/builder.js';
const seed = +(process.argv[2] || 1337), size = +(process.argv[3] || 4096);
let t = performance.now();
const net = generateCity({ seed, size });
const tg = performance.now() - t;
const st = net.stats();
console.log(`generated in ${tg.toFixed(0)} ms: nodes ${st.nodes}, edges ${st.edges}, road ${st.km.toFixed(1)} km, lane-km ${st.lanesKm.toFixed(0)}, rail ${st.railKm.toFixed(1)} km (${st.railNodes} track nodes / ${st.railSegments} track segments), subway ${st.subKm.toFixed(1)} km`);
const b = new NetworkBuilder(net);
t = performance.now();
await b.buildAll();
console.log(`built in ${(performance.now() - t).toFixed(0)} ms`);
let tris = 0, verts = 0, props = 0, warn = 0, nan = 0;
let laneMovements = 0, laneAdds = 0, laneDrops = 0;
const kinds = {}, profs = {}, mats = {}, propTypes = {};
for (const [id, o] of b.outs) {
  if (o.laneTopology) { laneMovements += o.laneTopology.movements; laneAdds += o.laneTopology.addedLanes; laneDrops += o.laneTopology.droppedLanes; }
  for (const k in o.mesh) { const m = o.mesh[k]; tris += m.i.length / 3; verts += m.p.length / 3; mats[k] = (mats[k] || 0) + m.i.length / 3; for (const v of m.p) if (!Number.isFinite(v)) { nan++; break; } }
  for (const k in o.props) { props += o.props[k].length / 8; propTypes[k] = (propTypes[k] || 0) + o.props[k].length / 8; }
  if (o.warning) { warn++; if (warn < 8) console.log('warn', id, o.warning, net.edges.get(id)?.profile); }
}
for (const J of b.junctions.values()) kinds[J.kind] = (kinds[J.kind] || 0) + 1;
for (const e of net.edges.values()) profs[e.profile] = (profs[e.profile] || 0) + 1;
if (net.rails.size && !net.railNodes.size) throw new Error('Rail routes did not produce derived track topology');
for (const rail of net.rails.values()) if (rail.mode === 'suspended' && !(b.outs.get(rail.id)?.supports > 0)) throw new Error(`Suspended guideway ${rail.id} has no clear supports`);
console.log({ tris, verts, props, warn, nanPieces: nan, laneMovements, laneAdds, laneDrops });
console.log('junction kinds', kinds);
console.log('profiles', profs);
console.log('materials', Object.fromEntries(Object.entries(mats).map(([k, v]) => [k, Math.round(v)])));
console.log('props', propTypes);
