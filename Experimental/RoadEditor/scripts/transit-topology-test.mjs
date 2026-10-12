import assert from 'node:assert/strict';
import { Group } from 'three';
import { RoadNetwork } from '../src/road/network.js';
import { NetworkBuilder } from '../src/road/builder.js';
import { deriveRailTopology } from '../src/road/railTopology.js';
import { computeJunction } from '../src/road/junction.js';
import { buildJunction } from '../src/road/geom/junctionMesh.js';
import { TransitFleet } from '../src/render/transit.js';
import { Editor } from '../src/editor/editor.js';

const route = (id, mode, pts) => ({
  id, mode, tracks: 1,
  pts: pts.map(([x, y, z]) => ({ x, y, z })),
});
const railGraph = deriveRailTopology(new Map([
  ['east', route('east', 'mainline', [[-20, 0, 0], [20, 0, 0]])],
  ['north', route('north', 'mainline', [[0, 0, -20], [0, 0, 20]])],
  ['over', route('over', 'suspended', [[-20, 13, 0], [20, 13, 0]])],
]));
assert([...railGraph.nodes.values()].some(n => n.degree === 4 && n.y === 0), 'at-grade rail crossing should create a four-way track node');
assert([...railGraph.nodes.values()].every(n => n.mode === 'mainline' || n.mode === 'suspended'), 'rail nodes retain their system layer');
assert.equal(railGraph.edges.size, 5, 'two intersecting mainline routes split into four segments; elevated route stays separate');
assert(![...railGraph.nodes.values()].some(n => n.degree > 1 && n.mode === 'suspended'), 'suspended crossing must not connect to at-grade track');

function profile(lanesEachWay) {
  return {
    id: 'test', name: 'Test cross-section', category: 'arterial', surface: 'asphalt',
    lanes: [
      ...Array.from({ length: lanesEachWay }, () => ({ type: 'drive', width: 3.4, dir: -1 })),
      ...Array.from({ length: lanesEachWay }, () => ({ type: 'drive', width: 3.4, dir: 1 })),
    ],
  };
}
const net = new RoadNetwork();
const center = net.addNode({ id: 'J', x: 0, z: 0 });
const west = net.addNode({ id: 'W', x: -90, z: 0 });
const east = net.addNode({ id: 'E', x: 90, z: 28 });
net.addEdge({ id: 'in-2', a: west.id, b: center.id, profile: 'custom', custom: profile(2) });
net.addEdge({ id: 'out-3', a: center.id, b: east.id, profile: 'custom', custom: profile(3) });
const junction = computeJunction(net, center.id);
assert.equal(junction.kind, 'junction', 'lane-count transition should be treated as a designed junction');
const out = buildJunction(net, junction, { markings: true, props: false });
assert.equal(out.laneTopology.addedLanes, 1, 'two-to-three expansion receives a new-lane taper');
assert.equal(out.laneTopology.droppedLanes, 1, 'three-to-two contraction receives a merge taper');
assert(out.laneTopology.connectors >= 2, 'angled merge has shaped lane connectors in both directions');
assert(out.mesh.markWhite?.i.length > 0, 'transition markings and merge gore are emitted');
for (const [material, mesh] of Object.entries(out.mesh)) {
  assert(mesh.p.every(Number.isFinite), `${material} contains only finite vertices`);
}

const skyNet = new RoadNetwork();
skyNet.addRail({
  id: 'sky-test', mode: 'suspended', tracks: 1, trains: 1, height: 13.2,
  pts: [{ x: -180, y: 13.2, z: 0 }, { x: -60, y: 13.2, z: 3 }, { x: 60, y: 13.2, z: 3 }, { x: 180, y: 13.2, z: 0 }],
});
const builder = new NetworkBuilder(skyNet);
await builder.buildAll();
assert(builder.outs.get('sky-test')?.supports > 0, 'suspended guideway places clearance-checked supports');
assert(builder.outs.get('sky-test')?.mesh.guideway?.i.length > 0, 'suspended route emits its guideway mesh');
const mockWorld = { roads: new Group(), frameCbs: new Set(), settings: { trains: true, view: 'lit' } };
const fleet = new TransitFleet(mockWorld);
fleet.rebuild(skyNet, builder);
assert(fleet.actors.some(a => a.mode === 'suspended'), 'suspended rolling stock is generated for the route');
fleet.update(0.5);
assert(fleet.actors.every(a => Number.isFinite(a.object.position.x) && Number.isFinite(a.object.position.y)), 'train animation remains finite');
fleet.dispose();

const editor = new Editor();
editor.net = new RoadNetwork();
editor.builder = new NetworkBuilder(editor.net);
editor.world = { applyUpdate() {}, setSelection() {} };
const created = editor.addRailRoute([
  { x: 0, y: 0, z: 0 }, { x: 80, y: 0, z: 30 }, { x: 160, y: 0, z: 0 },
]);
assert(created && editor.net.rails.has(created.id), 'rail tool commits a new editable route');
assert.equal(editor.undoStack.length, 1, 'rail creation is captured as an undo transaction');
editor.undo();
assert(!editor.net.rails.has(created.id), 'undo removes the new railway and its derived topology');
editor.redo();
assert(editor.net.rails.has(created.id), 'redo restores the editable railway');

console.log('transit topology: switches, grade separation, suspended trains, rail undo and angled 2↔3 lane tapers pass');
