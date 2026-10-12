// Dedicated tram alignments: track slabs, crossings, power equipment, supports and transit actors.
import assert from 'node:assert/strict';
import { Group } from 'three';
import { RoadNetwork } from '../src/road/network.js';
import { NetworkBuilder } from '../src/road/builder.js';
import { deriveRailTopology } from '../src/road/railTopology.js';
import { TransitFleet } from '../src/render/transit.js';
import { Editor } from '../src/editor/editor.js';

const tramRoute = (id, pts, extra = {}) => ({
  id, mode: 'tram', tracks: 2, trains: 2,
  pts: pts.map(([x, y, z]) => ({ x, y, z })),
  ...extra,
});

// Dedicated tram layers connect to one another but remain distinct from mainline railway.
const graph = deriveRailTopology(new Map([
  ['tram-east', tramRoute('tram-east', [[-60, 0, 0], [60, 0, 0]])],
  ['tram-north', tramRoute('tram-north', [[0, 0, -60], [0, 0, 60]])],
  ['mainline', { id: 'mainline', mode: 'mainline', tracks: 1, pts: [{ x: 0, y: 0, z: -60 }, { x: 0, y: 0, z: 60 }] }],
]));
assert([...graph.nodes.values()].some(n => n.degree === 4 && n.mode === 'tram'), 'crossing tram routes form a tram-only junction');
assert(![...graph.nodes.values()].some(n => n.mode === 'mainline' && n.degree > 1), 'tram tracks do not silently connect to mainline rail');

// At grade, the route crosses the road with flush panels, grooved rails and overhead power,
// without adding railway gates/signals to an ordinary tramway crossing.
const net = new RoadNetwork();
const west = net.addNode({ id: 'west', x: -110, z: 0, y: 0 });
const east = net.addNode({ id: 'east', x: 110, z: 0, y: 0 });
net.addEdge({ id: 'road-crossing', a: west.id, b: east.id, profile: 'local' });
net.addRail({
  ...tramRoute('tram-at-grade', [[0, 0, -110], [0, 0, 110]]),
  supportSpacing: 30,
  electrified: true,
});
const builder = new NetworkBuilder(net);
await builder.buildAll();
const atGrade = builder.outs.get('tram-at-grade');
assert.equal(atGrade.mode, 'tram', 'the independent tram builder is selected by route mode');
assert.equal(atGrade.tramCrossings, 1, 'the route detects its at-grade road crossing');
assert.ok(atGrade.mesh.concrete?.i.length > 0, 'the dedicated route has a concrete track slab');
assert.ok(atGrade.mesh.steel?.i.length > 0, 'grooved rails and overhead wires are generated');
assert.ok(atGrade.mesh.crossPanel?.i.length > 0, 'the crossing has flush flangeway panels');
assert.ok((atGrade.props.catenaryMast?.length || 0) > 0, 'the route receives alternating overhead masts');
assert.equal(atGrade.props.gateArm, undefined, 'tram road crossings do not receive mainline level-crossing gates');
assert.equal(atGrade.props.crossbuck, undefined, 'tram road crossings do not receive railway crossbucks');
assert.equal(atGrade.supports, 0, 'an at-grade tramway does not create viaduct supports');
for (const [material, mesh] of Object.entries(atGrade.mesh)) {
  assert(mesh.p.every(Number.isFinite), `at-grade tramway ${material} vertices stay finite`);
}

const world = { roads: new Group(), frameCbs: new Set(), settings: { trains: true, view: 'lit' } };
const fleet = new TransitFleet(world);
fleet.rebuild(net, builder);
assert.equal(fleet.actors.filter(actor => actor.mode === 'tram').length, 2, 'tram rolling stock uses the independent tram route and track count');
fleet.update(0.5);
assert(fleet.actors.filter(actor => actor.mode === 'tram').every(actor => Number.isFinite(actor.object.position.y)), 'tram animation stays finite');
fleet.dispose();

// Elevated routes skip surface crossings and carry their own concrete viaduct/load path.
const elevatedNet = new RoadNetwork();
const a = elevatedNet.addNode({ id: 'a', x: -110, z: 0, y: 0 });
const b = elevatedNet.addNode({ id: 'b', x: 110, z: 0, y: 0 });
elevatedNet.addEdge({ id: 'under-road', a: a.id, b: b.id, profile: 'local' });
elevatedNet.addRail({
  ...tramRoute('tram-elevated', [[0, 8, -110], [0, 8, 110]]),
  supportSpacing: 24,
});
const elevatedBuilder = new NetworkBuilder(elevatedNet);
await elevatedBuilder.buildAll();
const elevated = elevatedBuilder.outs.get('tram-elevated');
assert.equal(elevated.tramCrossings, 0, 'a grade-separated tramway does not create an at-grade crossing');
assert.ok(elevated.supports > 0, 'the elevated tram deck rests on clearance-checked concrete supports');
assert.ok(elevated.mesh.concrete?.i.length > 0, 'elevated track slab and viaduct supports use concrete geometry');
assert.ok(elevated.props.catenaryMast?.length > 0, 'elevated catenary is installed above the tram deck');
for (const mesh of Object.values(elevated.mesh)) assert(mesh.p.every(Number.isFinite), 'elevated tramway geometry stays finite');

const restored = RoadNetwork.fromJSON(net.toJSON());
assert.equal(restored.rails.get('tram-at-grade').mode, 'tram', 'dedicated tram mode survives save/load');
assert.equal(restored.rails.get('tram-at-grade').supportSpacing, 30, 'tram infrastructure settings survive save/load');

const editor = new Editor();
editor.net = new RoadNetwork();
editor.builder = new NetworkBuilder(editor.net);
editor.world = { applyUpdate() {}, setSelection() {} };
editor.setRailMode('tram');
const created = editor.addRailRoute([{ x: 0, y: 0, z: -50 }, { x: 0, y: 0, z: 50 }]);
assert.equal(created.mode, 'tram', 'the rail drawing tool can create a tram route');
assert.equal(created.name, 'Tramway 1', 'dedicated tram routes get a distinct name');
assert.equal(created.supportSpacing, 30, 'new tram routes receive an infrastructure spacing default');
assert.equal(created.electrified, true, 'new tram routes are electrified by default');

console.log('tramway regression checks passed: independent topology, flush crossings, catenary, viaduct supports, transit animation and persistence');
