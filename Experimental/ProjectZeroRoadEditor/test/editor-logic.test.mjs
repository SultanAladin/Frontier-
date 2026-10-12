// Editor state logic without a GPU: a RoadEditor instance is built on a real RoadWorld
// with the overlay and camera stubbed. Covers generation, drawing, snapping, props,
// lanes, structures, deletion, undo/redo and node drags.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoadEditor } from '../src/editor/editor.js';
import { RoadWorld } from '../src/render/world.js';
import { createProject, findRoad, serialize } from '../src/core/model.js';

function makeEditor() {
  const ed = Object.create(RoadEditor.prototype);
  Object.assign(ed, {
    canvas: null,
    onChange: () => {},
    onMessage: () => {},
    world: new RoadWorld({ add() {} }, {}),
    stage: { camera: { position: { x: 0, y: 0, z: 0 } } },
    fly: { pos: { set() {} }, keys: new Set(), speed: 80, looking: false, focus() {} },
    tool: 'select',
    drawKind: 'local',
    drawOptions: { busLanes: true, bikeLanes: true, parking: true },
    propKind: 'speedBump',
    roundaboutRadius: 14,
    snapOn: true,
    gridSize: 2,
    showNodes: true,
    selection: null,
    draw: { points: [] },
    cursor: null,
    hover: null,
    drag: null,
    undoStack: [],
    redoStack: [],
    junctions: null,
    project: createProject('test'),
  });
  ed.refreshOverlays = () => {};
  return ed;
}

function drawRoad(ed, kind, pts) {
  ed.setDrawKind(kind);
  ed.draw.points = [];
  for (const [x, z] of pts) ed.drawClick({ x, z });
  ed.finishDraw();
  const last = ed.project.roads.at(-1);
  return last;
}

test('generate is one undoable step and undo/redo restore the map', () => {
  const ed = makeEditor();
  ed.generate({ seed: 3, cols: 3, rows: 3, block: 120 });
  const n = ed.project.roads.length;
  assert.ok(n > 10, `expected a city, got ${n} roads`);
  assert.equal(ed.undoStack.length, 1);
  ed.undo();
  assert.equal(ed.project.roads.length, 0);
  ed.redo();
  assert.equal(ed.project.roads.length, n);
});

test('drawing creates a road with shared nodes and snaps to existing nodes', () => {
  const ed = makeEditor();
  const a = drawRoad(ed, 'local', [[0, 0], [100, 0]]);
  assert.equal(Object.keys(ed.project.nodes).length, 2);
  const b = drawRoad(ed, 'collector', [[100, 0], [100, 80]]);
  // Clicking the node at (100,0) must reuse it: 3 nodes total, not 4.
  assert.equal(Object.keys(ed.project.nodes).length, 3);
  assert.equal(a.end, b.start);
  assert.ok(ed.world.junctions.pads.has(a.end), 'shared node gets a junction pad');
});

test('a road ending on another road splits it into a T-junction', () => {
  const ed = makeEditor();
  drawRoad(ed, 'avenue', [[0, 0], [200, 0]]);
  const spur = drawRoad(ed, 'local', [[100, 40], [100, 0]]);
  assert.equal(ed.project.roads.length, 3, 'the avenue was split at the spur');
  assert.ok(findRoad(ed.project, spur.id));
  assert.ok(spur.end, 'spur end is attached to a node');
});

test('finishing with fewer than two distinct points is rejected', () => {
  const ed = makeEditor();
  let msg = '';
  ed.onMessage = (t) => { msg = t; };
  ed.setDrawKind('local');
  ed.drawClick({ x: 0, z: 0 });
  ed.finishDraw();
  assert.equal(ed.project.roads.length, 0);
  assert.match(msg, /two distinct points/);
});

test('props: add, update, remove, and undo', () => {
  const ed = makeEditor();
  const road = drawRoad(ed, 'local', [[0, 0], [200, 0]]);
  const before = ed.undoStack.length;
  const prop = ed.addPropToRoad(road.id, 'speedBump', 50);
  assert.ok(prop && prop.id);
  assert.equal(findRoad(ed.project, road.id).props.length, 1);
  assert.deepEqual(ed.selection, { type: 'prop', id: road.id, propId: prop.id });

  ed.updateProp(road.id, prop.id, { s: 80, height: 0.12 });
  assert.equal(findRoad(ed.project, road.id).props[0].s, 80);

  ed.removePropById(road.id, prop.id);
  assert.equal(findRoad(ed.project, road.id).props.length, 0);
  assert.equal(ed.undoStack.length, before + 3);

  ed.undo();
  assert.equal(findRoad(ed.project, road.id).props.length, 1);
});

test('range props use absolute distances and carry spacing', () => {
  const ed = makeEditor();
  const road = drawRoad(ed, 'local', [[0, 0], [200, 0]]);
  const p = ed.addPropToRoad(road.id, 'bollards');
  assert.equal(p.spacing, 1.2);
  assert.equal(p.s0, undefined);
});

test('lanes: change type, add, move and remove, with a minimum of one lane', () => {
  const ed = makeEditor();
  const road = drawRoad(ed, 'local', [[0, 0], [200, 0]]);
  const count = road.lanes.length;
  ed.updateLane(road.id, 0, { kind: 'bus' });
  assert.equal(findRoad(ed.project, road.id).lanes[0].kind, 'bus');
  ed.addLane(road.id, 'bike', 0);
  assert.equal(findRoad(ed.project, road.id).lanes.length, count + 1);
  assert.equal(findRoad(ed.project, road.id).lanes[0].kind, 'bike');
  ed.moveLane(road.id, 0, 1);
  assert.equal(findRoad(ed.project, road.id).lanes[1].kind, 'bike');
  ed.removeLane(road.id, 1);
  assert.equal(findRoad(ed.project, road.id).lanes.length, count);
  ed.updateLane(road.id, 0, { width: -4 });
  assert.ok(findRoad(ed.project, road.id).lanes[0].width >= 0.2, 'widths are clamped');

  // Reduce to a single lane, then refuse to remove the last one.
  while (findRoad(ed.project, road.id).lanes.length > 1) ed.removeLane(road.id, 0);
  ed.removeLane(road.id, 0);
  assert.equal(findRoad(ed.project, road.id).lanes.length, 1);
});

test('structures: bridge and underground set interior heights, surface resets them', () => {
  const ed = makeEditor();
  const road = drawRoad(ed, 'highway', [[0, 0], [100, 0], [200, 0]]);
  ed.setRoadMode(road.id, 'bridge');
  let r = findRoad(ed.project, road.id);
  assert.equal(r.points[0].h, 0);
  assert.equal(r.points[1].h, 7);
  ed.setStructureHeight(road.id, 9);
  r = findRoad(ed.project, road.id);
  assert.equal(r.points[1].h, 9);
  ed.setRoadMode(road.id, 'underground');
  r = findRoad(ed.project, road.id);
  assert.equal(r.points[1].h, -7);
  ed.setRoadMode(road.id, 'surface');
  r = findRoad(ed.project, road.id);
  assert.ok(r.points.every((p) => p.h === 0));
});

test('changing road type applies that type\'s lanes and structure', () => {
  const ed = makeEditor();
  const road = drawRoad(ed, 'local', [[0, 0], [200, 0]]);
  ed.setRoadKind(road.id, 'subway');
  const r = findRoad(ed.project, road.id);
  assert.equal(r.kind, 'subway');
  assert.equal(r.mode, 'underground');
  assert.equal(r.lanes[0].kind, 'ballast');
});

test('deleting a road removes orphan nodes and undo brings it back', () => {
  const ed = makeEditor();
  const road = drawRoad(ed, 'local', [[0, 0], [200, 0]]);
  ed.deleteRoadById(road.id);
  assert.equal(ed.project.roads.length, 0);
  assert.equal(Object.keys(ed.project.nodes).length, 0);
  ed.undo();
  assert.equal(ed.project.roads.length, 1);
  assert.equal(Object.keys(ed.project.nodes).length, 2);
});

test('undo clears a selection that no longer exists', () => {
  const ed = makeEditor();
  const road = drawRoad(ed, 'local', [[0, 0], [200, 0]]);
  ed.select({ type: 'road', id: road.id });
  ed.undo();
  assert.equal(ed.selection, null);
});

test('dragging a node moves every attached road end and is undoable', () => {
  const ed = makeEditor();
  const a = drawRoad(ed, 'local', [[0, 0], [100, 0]]);
  drawRoad(ed, 'local', [[100, 0], [100, 100]]);
  const nodeId = a.end;
  const snapshot = serialize(ed.project);
  // Same state the pointer handlers create on pointer-down, then a move and a release.
  ed.drag = { type: 'node', id: nodeId, snapshot, moved: false };
  ed.dragTo({ x: 120, z: 6 }); // snapped to the 2 m grid
  ed.drag.moved = true;
  const endPt = findRoad(ed.project, a.id).points.at(-1);
  assert.deepEqual([endPt.x, endPt.z], [120, 6]);
  ed.onPointerUp({ button: 0 });
  assert.equal(ed.undoStack.at(-1).label, 'Move node');
  ed.undo();
  const restored = findRoad(ed.project, a.id).points.at(-1);
  assert.deepEqual([restored.x, restored.z], [100, 0]);
});

test('delete tool and selection delete remove props and roads', () => {
  const ed = makeEditor();
  const road = drawRoad(ed, 'local', [[0, 0], [200, 0]]);
  const prop = ed.addPropToRoad(road.id, 'stopLine', 30);
  ed.deleteSelection();
  assert.equal(findRoad(ed.project, road.id).props.some((p) => p.id === prop.id), false, 'prop deleted');
  ed.select({ type: 'road', id: road.id });
  ed.deleteSelection();
  assert.equal(ed.project.roads.length, 0);
});

test('replaceProject keeps history so the previous map can be restored', () => {
  const ed = makeEditor();
  drawRoad(ed, 'local', [[0, 0], [200, 0]]);
  const before = ed.project.roads.length;
  ed.replaceProject(createProject('other'), 'Open file');
  assert.equal(ed.project.roads.length, 0);
  ed.undo();
  assert.equal(ed.project.roads.length, before);
});
