// Scheduling/packing only. Dynamic tyre state is never solved on the CPU.
export const MAX_SUBSTEPS = 16;
export const MIN_J = 0.1;
export function substepsFor(speed, adaptive = false) {
  return adaptive
    ? Math.abs(speed) > 3
      ? 16
      : Math.abs(speed) > 1.5
        ? 8
        : 4
    : 4;
}
export function makeSolverPlan(mesh, alignment = 256) {
  if (!Number.isInteger(alignment) || alignment < 64 || alignment % 4)
    throw new Error("Invalid uniform alignment");
  const batches = [
    ...mesh.edgeBatches.map((ids) => ({
      kind: "solveEdges",
      count: ids.length,
    })),
    ...mesh.tetBatches.map((ids) => ({ kind: "solveTets", count: ids.length })),
  ];
  let start = 0;
  for (const b of batches) {
    b.start = start;
    start += b.count;
  }
  const records = 1 + batches.length,
    bytes = MAX_SUBSTEPS * records * alignment;
  const staging = new ArrayBuffer(bytes),
    floats = new Float32Array(staging),
    ints = new Uint32Array(staging),
    dynamicOffsets = Uint32Array.from(
      { length: MAX_SUBSTEPS * records },
      (_, i) => i * alignment,
    );
  for (let s = 0; s < MAX_SUBSTEPS; s++)
    for (let r = 0; r < records; r++) {
      const at = ((s * records + r) * alignment) / 4;
      ints.set(
        [mesh.rest.length, mesh.edges.length, mesh.tets.length, 0],
        at + 8,
      );
      ints[at + 12] = s;
      if (r) {
        ints[at + 14] = batches[r - 1].start;
        ints[at + 15] = batches[r - 1].count;
      }
    }
  return {
    batches,
    records,
    alignment,
    bytes,
    staging,
    floats,
    ints,
    dynamicOffsets,
    activeBytes: (steps) => steps * records * alignment,
    writeStep(
      s,
      {
        dt,
        angle,
        height,
        speed,
        stiffness,
        friction,
        model,
        obstacle,
        view = 0,
      },
    ) {
      if (s < 0 || s >= MAX_SUBSTEPS || !Number.isInteger(s))
        throw new Error("Invalid substep");
      for (let r = 0; r < records; r++) {
        const at = ((s * records + r) * alignment) / 4;
        floats[at] = dt;
        floats[at + 1] = angle;
        floats[at + 2] = height;
        floats[at + 3] = speed;
        floats[at + 4] = 1 / (1.5e5 * stiffness);
        floats[at + 5] = 1 / (2e6 * stiffness);
        floats[at + 6] = 1 / (3e5 * stiffness);
        floats[at + 7] = friction;
        ints[at + 11] = model | (view === 1 ? 2 : 0);
        floats[at + 13] = obstacle;
      }
    },
  };
}
export function assertSolverInputs(s) {
  const bounds = {
    compression: [0, 95],
    speed: [0, 5],
    stiffness: [0.25, 4],
    friction: [0, 1.5],
    iterations: [4, 8],
    obstacle: [0, 0.045],
    model: [0, 1],
    view: [0, 2],
  };
  for (const [key, [min, max]] of Object.entries(bounds))
    if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max)
      throw new Error(`Invalid solver input: ${key}`);
  for (const key of ["iterations", "model", "view"])
    if (!Number.isInteger(s[key])) throw new Error(`Expected integer ${key}`);
}
