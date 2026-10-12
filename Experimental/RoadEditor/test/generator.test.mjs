import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, generateCountryside, generateOffroad } from '../src/generator.js';
import { planarize, validateTopology } from '../src/geometry.js';
import { buildLanes } from '../src/profiles.js';
import { buildRoadMeshes } from '../src/mesh.js';
import { makeRng } from '../src/geometry.js';

function withProfiles(roads) {
  return roads.map((r) => {
    const profile = buildLanes(r.typeId, makeRng(r.seed));
    return { ...r, profile, kind: profile.type.kind };
  });
}

for (const [name, gen] of [['city', () => generateCity(3)], ['countryside', () => generateCountryside(7)], ['offroad', () => generateOffroad(11)]]) {
  test(`${name} network plans into a clean, validated topology`, () => {
    const roads = gen();
    assert.ok(roads.length > 10, `${name} should have many roads (got ${roads.length})`);
    const graph = planarize(withProfiles(roads));
    const v = validateTopology(graph);
    assert.ok(graph.nodes.length > 0 && graph.edges.length > 0);
    assert.equal(v.problems.filter((p) => p.type === 'unmerged-crossing').length, 0,
      `unmerged crossings: ${JSON.stringify(v.problems.slice(0, 3))}`);
  });
}

test('generated roads are unique: every road has a distinct seed and id', () => {
  const roads = generateCity(5);
  const seeds = new Set(roads.map((r) => r.seed));
  const ids = new Set(roads.map((r) => r.id));
  assert.equal(seeds.size, roads.length);
  assert.equal(ids.size, roads.length);
});

test('generation is deterministic for the same seed', () => {
  const a = generateCity(9).map((r) => r.points.length);
  const b = generateCity(9).map((r) => r.points.length);
  assert.deepEqual(a, b);
});

test('mesh builder emits finite geometry for a city', () => {
  const roads = withProfiles(generateCity(3));
  const graph = planarize(roads);
  const result = buildRoadMeshes(graph);
  assert.ok(result.counts.triangles > 1000);
  for (const b of result.chunks) {
    assert.ok(b.positions.every(Number.isFinite), `${b.key} positions finite`);
    assert.ok(b.normals.every(Number.isFinite), `${b.key} normals finite`);
    assert.ok(b.indices.every((i) => i < b.positions.length / 3), `${b.key} indices in range`);
  }
  const materials = new Set(result.chunks.map((c) => c.material));
  for (const mat of ['asphalt', 'paint_white', 'curb', 'concrete']) assert.ok(materials.has(mat), `has ${mat}`);
});
