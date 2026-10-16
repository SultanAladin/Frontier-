import test from "node:test";
import assert from "node:assert/strict";
import {
  makeSolverPlan,
  substepsFor,
  MAX_SUBSTEPS,
  assertSolverInputs,
} from "./solver-plan.js";
import { makeTyre } from "./mesh.js";
const mesh = makeTyre();
test("active uploads are linear in records, not quadratic; staging is reused", () => {
  const p = makeSolverPlan(mesh);
  assert.equal(p.records, 39);
  assert.equal(p.activeBytes(4), 39936);
  assert.equal(p.bytes, MAX_SUBSTEPS * p.records * 256);
  const identity = p.staging;
  p.writeStep(0, {
    dt: 1 / 240,
    angle: 0,
    height: 0.48,
    speed: 0,
    stiffness: 1,
    friction: 0.8,
    model: 1,
    obstacle: 0,
  });
  assert.equal(p.staging, identity);
  assert.equal(p.ints[8], mesh.rest.length);
  for (let s = 0; s < MAX_SUBSTEPS; s++)
    for (let r = 0; r < p.records; r++) {
      const at = (s * p.records + r) * 64;
      assert.equal(p.ints[at + 12], s);
      if (r) {
        assert.equal(p.ints[at + 14], p.batches[r - 1].start);
        assert.equal(p.ints[at + 15], p.batches[r - 1].count);
      }
    }
});
test("immutable colour/substep records do not alias", () => {
  const p = makeSolverPlan(mesh, 256);
  const x = {
    dt: 1 / 240,
    angle: 0.2,
    height: 0.45,
    speed: 1,
    stiffness: 1,
    friction: 0.5,
    model: 0,
    obstacle: 0.02,
  };
  p.writeStep(0, x);
  p.writeStep(1, { ...x, angle: 1, model: 1 });
  assert(Math.abs(p.floats[1] - 0.2) < 1e-6);
  assert.equal(p.floats[p.records * 64 + 1], 1);
  assert.equal(p.ints[11], 0);
  assert.equal(p.ints[p.records * 64 + 11], 1);
  assert.throws(() => p.writeStep(MAX_SUBSTEPS, x));
});
test("adaptive temporal budget is bounded and opt-in", () => {
  assert.equal(substepsFor(5), 4);
  assert.equal(substepsFor(0, true), 4);
  assert.equal(substepsFor(2, true), 8);
  assert.equal(substepsFor(5, true), 16);
});

test("bad programmatic inputs cannot poison GPU state", () => {
  const s = {
    compression: 38,
    speed: 0,
    stiffness: 1,
    friction: 0.8,
    iterations: 4,
    obstacle: 0,
    model: 1,
    view: 0,
  };
  assertSolverInputs(s);
  for (const patch of [
    { speed: NaN },
    { stiffness: 0 },
    { iterations: 4.5 },
    { speed: Infinity },
    { compression: 100 },
    { model: 2 },
  ])
    assert.throws(() => assertSolverInputs({ ...s, ...patch }));
});
test("heatmap writes are opt-in, model bit stays separate", () => {
  const p = makeSolverPlan(mesh);
  p.writeStep(0, {
    dt: 1 / 240,
    angle: 0,
    height: 0.48,
    speed: 0,
    stiffness: 1,
    friction: 0.8,
    model: 1,
    obstacle: 0,
    view: 1,
  });
  assert.equal(p.ints[11], 3);
  assert.equal(p.ints[11] & 1, 1);
  assert.equal(p.dynamicOffsets[39], 39 * 256);
});
