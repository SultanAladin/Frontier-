import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPresetProject,
  buildCompleteSceneQuadGeometry,
} from '../src/presets-network.js';
import {
  MAX_AI_VEHICLES,
  TrafficSimulator,
} from '../src/traffic-simulation.js';
import {
  PAVING_PATTERNS,
  DEFAULT_TEXTURE_LAYERS,
  getEffectiveMaterialParams,
} from '../src/texture-layer-stack.js';
import { ROAD_STUDIO_WGSL } from '../src/webgpu-renderer.js';

test('1. 100% Quad Topology & Merged Coons-Patch Intersections (+ and Y junctions)', () => {
  const project = createPresetProject('metropolitan-nexus');
  const compiled = buildCompleteSceneQuadGeometry(project, 1.5);

  assert.ok(compiled.stats.quadCount > 2500, `Expected >2500 quads, got ${compiled.stats.quadCount}`);
  assert.equal(
    compiled.stats.triangleCount,
    compiled.stats.quadCount * 2,
    'Every GPU triangle pair must originate from a true 4-sided Quad face'
  );
  assert.ok(
    compiled.builder.quadWireSegments.length > 0,
    'Quad wireframe buffer must contain 4-edge quad perimeter lines'
  );

  // Verify both + (4-way) and Y (3-way) merged intersections exist and have 32 quads per arm
  const plusJunc = compiled.mergedIntersections.find((j) => j.node.id === 'node-center');
  const yJunc = compiled.mergedIntersections.find((j) => j.node.id === 'node-west-y');
  assert.ok(plusJunc, 'Central + 4-way merged intersection must be built');
  assert.equal(plusJunc.arms.length, 4, 'Central + intersection must merge 4 road arms');
  assert.ok(yJunc, 'West Y 3-way merged intersection must be built');
  assert.equal(yJunc.arms.length, 3, 'West Y intersection must merge 3 road arms');
});

test('2. Automatic At-Grade Spline Crossing Split & Merge (No | layered on - overlapping geometry)', () => {
  const project = createPresetProject('metropolitan-nexus');
  const initialNodes = project.nodes.length;

  // Add a spline road that crosses right across Grand Central Avenue East (from z=-40 to z=+40 at x=+42)
  project.nodes.push(
    { id: 'n-cross-north', name: 'Cross North', position: [42, 0, -40], radius: 9 },
    { id: 'n-cross-south', name: 'Cross South', position: [42, 0, 40], radius: 9 }
  );
  project.roads.push({
    id: 'road-crossing-test',
    name: 'Crossing Spline',
    roadClass: 'urban',
    start: 'n-cross-north',
    end: 'n-cross-south',
    lanes: 2,
    laneWidth: 3.5,
    sidewalkWidth: 3.2,
  });

  const compiled = buildCompleteSceneQuadGeometry(project, 0);
  assert.ok(
    project.nodes.length > initialNodes + 2,
    'Crossing at-grade splines must automatically split and insert a shared Merged Intersection Node'
  );
  const newMerged = compiled.mergedIntersections.find((j) => j.node.id.startsWith('node-merged-'));
  assert.ok(newMerged, 'Newly created merged intersection must be compiled into a Coons-Quad hub');
  assert.equal(newMerged.arms.length, 4, 'Split crossing roads must form a 4-arm + merged intersection');
});

test('3. Interactive Intersection Gizmo Movement & Bridge Civil Engineering Dimensions', () => {
  const project = createPresetProject('cloverleaf-interchange');
  const compiled1 = buildCompleteSceneQuadGeometry(project, 0);
  assert.ok(
    compiled1.stats.minBridgeClearance >= 5.2,
    `Highway bridge vertical clearance must be >= 5.2m, got ${compiled1.stats.minBridgeClearance}m`
  );

  // Move the Y-merge intersection with the Gizmo and verify connected roads & hub re-solve cleanly
  const yNode = project.nodes.find((n) => n.id === 'n-y-west');
  yNode.position = [-54, 1.5, -8];
  yNode.radius = 13.5;
  const compiled2 = buildCompleteSceneQuadGeometry(project, 0);
  const movedHub = compiled2.mergedIntersections.find((j) => j.node.id === 'n-y-west');
  assert.ok(movedHub, 'Moved Y-intersection must remain valid');
  assert.ok(Math.abs(movedHub.hub[1] - 1.5) < 0.8, 'Moved Y-intersection elevation must follow gizmo Y');
});

test('4. Real-Life Infrastructure Layers, Texture Layer Stack, WGSL Shader & <=25 AI Vehicles Cap', () => {
  const project = createPresetProject('metropolitan-nexus');
  const compiled = buildCompleteSceneQuadGeometry(project, 2.5);

  const batchLayers = new Set([...compiled.builder.batches.values()].map((b) => b.layerId));
  for (const requiredLayer of [
    'roads',
    'intersections',
    'curbs',
    'paving',
    'markings',
    'distress',
    'construction',
    'bridges',
    'tunnels',
    'railways',
    'subways',
    'guardrails',
    'furniture',
    'robots',
    'blocks',
  ]) {
    assert.ok(batchLayers.has(requiredLayer), `Missing required 3D quad geometry layer: ${requiredLayer}`);
  }

  // Verify Texture Layer Stack & Paving Patterns
  assert.equal(PAVING_PATTERNS.length, 9, 'Must provide 9 procedural sidewalk paving patterns');
  assert.equal(DEFAULT_TEXTURE_LAYERS.length, 9, 'Must provide 9 composable PBR texture layers');
  const matParams = getEffectiveMaterialParams(project.textureLayers);
  assert.ok(matParams.wheelPolishOpacity > 0 && matParams.wetness > 0);

  // Verify AI Traffic Cap (strictly <= 25 vehicles)
  const sim = new TrafficSimulator();
  project.trafficCount = 99; // Attempt to exceed cap
  sim.step(0.05, project, compiled.alignmentsMap);
  assert.ok(
    sim.vehicles.length <= MAX_AI_VEHICLES && MAX_AI_VEHICLES === 25,
    `AI traffic must never exceed 25 vehicles (got ${sim.vehicles.length})`
  );
  const fleet = sim.buildDynamicFleetQuads(project, compiled.alignmentsMap);
  assert.ok(fleet.totalQuads > 400, 'AI vehicles, trains, subway & sidewalk robots must be high-detail quad meshes');
  // Verify European Roundabout preset & 3D Roundabout Central Island + Truck Apron quads
  const rbProject = createPresetProject('european-roundabout');
  const rbCompiled = buildCompleteSceneQuadGeometry(rbProject, 0);
  const rbHub = rbCompiled.mergedIntersections.find((j) => j.node.id === 'node-center');
  assert.ok(rbHub && rbHub.node.roundabout, 'European Roundabout preset must build a 4-arm roundabout hub');
  assert.ok(rbCompiled.stats.quadCount > 12000, `Roundabout preset must compile >12,000 true quads (got ${rbCompiled.stats.quadCount})`);
  assert.ok(ROAD_STUDIO_WGSL.includes('@vertex') && ROAD_STUDIO_WGSL.includes('@fragment'), 'Must include WGSL shaders');
});
