// Regressions for additive roadside protection, road posts, reference road shapes and parking paint.
import assert from 'node:assert/strict';
import { RoadNetwork } from '../src/road/network.js';
import { computeJunction } from '../src/road/junction.js';
import { buildEdge } from '../src/road/geom/edge.js';
import { DEFAULT_GUARDRAIL, GUARDRAIL_STYLES } from '../src/road/infrastructure.js';
import { DECALS, ATLAS_GRID, decalUV } from '../src/road/decals.js';
import { getProfile, layout } from '../src/road/profiles.js';
import { propLibrary } from '../src/render/propsLib.js';

const net = new RoadNetwork();
const a = net.addNode({ x: 0, z: 0, y: 0 });
const b = net.addNode({ x: 180, z: 0, y: 0 });
const edge = net.addEdge({ a: a.id, b: b.id, profile: 'local' });
const junctionA = computeJunction(net, a.id);
const junctionB = computeJunction(net, b.id);
const quiet = { markings: false, props: false, trees: false };
const base = buildEdge(net, edge, junctionA, junctionB, quiet);

// A guardrail is an optional infrastructure overlay: every pre-existing base-road mesh stays
// byte-for-byte identical, and only the dedicated barrier/steel piece is added.
edge.flags.roadGuardrail = { ...DEFAULT_GUARDRAIL, style: 'wbeam' };
const guarded = buildEdge(net, edge, junctionA, junctionB, quiet);
for (const [mat, mesh] of Object.entries(base.mesh)) {
  assert.deepEqual(guarded.mesh[mat], mesh, `guardrail overlay must not modify existing ${mat} road geometry`);
}
assert.ok(guarded.mesh.steel?.i.length > 0, 'W-beam produces a separate steel guardrail mesh');
assert.ok(!guarded.props.roadPost, 'the global prop toggle still hides guardrail support instances');

// All reference barrier families build finite additive geometry, with support posts except for
// the monolithic concrete profile.
for (const { id } of GUARDRAIL_STYLES) {
  edge.flags.roadGuardrail = { ...DEFAULT_GUARDRAIL, style: id, side: 'right' };
  const out = buildEdge(net, edge, junctionA, junctionB, { markings: false, props: true, trees: false });
  const guardMaterial = id === 'concrete' ? 'barrier' : id === 'parapet' ? 'concrete' : 'steel';
  assert.ok(out.mesh[guardMaterial]?.i.length > 0, `${id} creates its separate infrastructure mesh`);
  for (const mesh of Object.values(out.mesh)) assert.ok(mesh.p.every(Number.isFinite), `${id} stays finite`);
  if (id === 'concrete') assert.ok(!out.props.roadPost, 'concrete barrier has no steel support posts');
  else assert.ok((out.props.roadPost?.length || 0) > 0, `${id} includes reusable road-post support instances`);
}

// Standalone posts are saved as ordinary edge features and produce only an instanced prop.
edge.flags = {};
edge.features = [{ type: 'roadPost', s: 72, side: -1 }];
const postOut = buildEdge(net, edge, junctionA, junctionB, { markings: false, props: true, trees: false });
assert.equal(postOut.props.roadPost?.length, 8, 'a manually placed roadside post is one standard prop instance');
for (const [mat, mesh] of Object.entries(base.mesh)) {
  assert.deepEqual(postOut.mesh[mat], mesh, `standalone post must not modify ${mat} road geometry`);
}

// The preset additions cover the reference's Dutch cycle-priority street, integrated mobility
// boulevard, and one-way motorway carriageway concepts.
for (const id of ['sharedCycleStreet', 'euroMobilityBoulevard', 'motorwayCarriageway']) {
  const profile = getProfile({ profile: id });
  assert.ok(profile.lanes.length >= 4, `${id} has a complete cross-section`);
  assert.ok(layout(profile).total > 10, `${id} has a valid full-width layout`);
  edge.profile = id;
  const shapeOut = buildEdge(net, edge, computeJunction(net, a.id), computeJunction(net, b.id), { markings: true, props: false, trees: false });
  assert.ok(shapeOut.triangles > 0, `${id} produces road geometry`);
  for (const mesh of Object.values(shapeOut.mesh)) assert.ok(mesh.p.every(Number.isFinite), `${id} stays finite`);
}
edge.profile = 'local';
assert.ok(getProfile({ profile: 'sharedCycleStreet' }).cyclePriority, 'the Dutch shared-cycle preset requests cycle symbols');
assert.ok(DECALS.parking && ATLAS_GRID >= 5, 'the decal atlas has a dedicated parking stencil cell');
const parkingOut = buildEdge(net, edge, junctionA, junctionB, { markings: true, props: false, trees: false });
const [u0, v0, u1, v1] = decalUV('parking');
const parkingUVs = parkingOut.mesh.decal?.uv || [];
assert.ok(parkingUVs.some((u, i) => i % 2 === 0 && u >= u0 && u <= u1 && parkingUVs[i + 1] >= v0 && parkingUVs[i + 1] <= v1),
  'parking lanes emit the new P stencil decal');
assert.ok(propLibrary().roadPost?.length > 0, 'the new road-post model is registered in the prop library');

// Guardrail settings persist with the existing edge flags through normal JSON export/import.
edge.flags.roadGuardrail = { ...DEFAULT_GUARDRAIL, style: 'thrie', side: 'left' };
const restored = RoadNetwork.fromJSON(net.toJSON());
assert.deepEqual(restored.edges.get(edge.id).flags.roadGuardrail, edge.flags.roadGuardrail);

console.log('infrastructure regression checks passed: additive guardrails, reusable road posts, imported road profiles and parking markings');
