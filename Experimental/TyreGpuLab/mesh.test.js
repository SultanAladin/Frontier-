import test from "node:test";
import assert from "node:assert/strict";
import { makeTyre } from "./mesh.js";
const m = makeTyre();
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
test("periodic annular mesh, positive tetrahedra, exact inverse rest matrices", () => {
  assert.equal(m.rest.length, 1792);
  assert.equal(m.tets.length, 6912);
  m.tets.forEach((t, i) => {
    assert.equal(new Set(t).size, 4);
    const ds = t.slice(1).map((n) => sub(m.rest[n], m.rest[t[0]]));
    const v = dot(ds[0], cross(ds[1], ds[2])) / 6;
    assert(v > 1e-8);
    assert(Math.abs(v - m.tetData[i * 16 + 15]) < 1e-12);
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 3; col++) {
        const b = m.tetData.slice(i * 16 + 4 + row * 4, i * 16 + 7 + row * 4);
        assert(Math.abs(dot(b, ds[col]) - (row === col ? 1 : 0)) < 1e-10);
      }
  });
  assert(
    m.edges.some(([a, b]) => Math.abs(a - b) > m.rest.length / 2),
    "seam is connected",
  );
  assert.equal(m.pinned.filter(Boolean).length, 64 * 7);
});
test("boundary surface is closed, manifold, and uses valid nodes", () => {
  const edges = new Map();
  for (let i = 0; i < m.surface.length; i += 3) {
    const f = m.surface.slice(i, i + 3);
    for (let j = 0; j < 3; j++) {
      const a = f[j],
        b = f[(j + 1) % 3];
      assert(a >= 0 && a < m.rest.length);
      const k = [a, b].sort((a, b) => a - b).join(",");
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  assert([...edges.values()].every((v) => v === 2));
  assert.equal(m.lines.length / 2, edges.size);
});
test("every graph colour is a matching: race-free in-place GPU writes", () => {
  for (const [constraints, batches] of [
    [m.edges, m.edgeBatches],
    [m.tets, m.tetBatches],
  ]) {
    const covered = new Set();
    for (const batch of batches) {
      const used = new Set();
      for (const id of batch) {
        assert(!covered.has(id));
        covered.add(id);
        for (const node of constraints[id]) {
          assert(!used.has(node));
          used.add(node);
        }
      }
    }
    assert.equal(covered.size, constraints.length);
  }
  assert.equal(m.edgeBatches.length, 16);
  assert.equal(m.tetBatches.length, 32);
});
test("reduced topology remains valid for mesh experiments", () => {
  const small = makeTyre(16, 3, 5);
  assert.equal(small.tets.length, 16 * 2 * 4 * 6);
  assert.equal(small.rest.length, 16 * 3 * 5);
  assert(small.tetData.every(Number.isFinite));
});
