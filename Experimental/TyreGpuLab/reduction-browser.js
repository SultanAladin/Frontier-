import { fetchShader } from "./runtime-assets.js?release=tyre-gpu-20261016-r4";
// Synthetic reduction inputs, not a second physics implementation. Put the
// minimum after block 64 to exercise lanes' second load and the final tail.
export async function runReductionCases() {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const errors = [];
  device.addEventListener("uncapturederror", (e) =>
    errors.push(e.error.message),
  );
  const storage =
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const buffer = (size, usage = storage) =>
    device.createBuffer({ size, usage });
  const blocks = 108,
    T = blocks * 64,
    E = 1,
    colours = 24;
  const resources = [
    buffer(320),
    buffer(16),
    buffer(64),
    buffer((E + T + colours) * 4),
    buffer(16),
    buffer(64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    buffer(64 + blocks * 32),
    buffer((colours + 3) * 16),
    buffer(176),
  ];
  const params = new ArrayBuffer(64);
  new Float32Array(params)[0] = 1 / 240;
  new Uint32Array(params).set([4, E, T, 1], 8);
  device.queue.writeBuffer(resources[5], 0, params);
  device.queue.writeBuffer(
    resources[3],
    (E + T) * 4,
    Uint32Array.from({ length: colours }, (_, i) => 3 + (i % 4)),
  );
  const layout = device.createBindGroupLayout({
    entries: resources.map((_, binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: {
        type:
          binding === 5
            ? "uniform"
            : [1, 2, 3].includes(binding)
              ? "read-only-storage"
              : "storage",
      },
    })),
  });
  const bind = device.createBindGroup({
    layout,
    entries: resources.map((buffer, binding) => ({
      binding,
      resource: { buffer },
    })),
  });
  const module = device.createShaderModule({
    code: await fetchShader("physics.wgsl"),
  });
  const pipelines = await Promise.all(
    ["guardReduce", "guardPrepare"].map((entryPoint) =>
      device.createComputePipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module, entryPoint },
      }),
    ),
  );
  const results = [];
  try {
    for (const c of [
      { block: 0, safe: 0.125, j: 0.25 },
      { block: 64, safe: 0.125, j: 0.25 },
      { block: 107, safe: 0.125, j: 0.25 },
      { block: 107, safe: 1, j: 0.5 },
    ]) {
      const input = new Float32Array(16 + blocks * 8);
      input[7] = 1;
      for (let b = 0; b < blocks; b++) {
        input[16 + b * 8] = 1;
        input[17 + b * 8] = 1;
      }
      input[16 + c.block * 8] = c.safe;
      input[17 + c.block * 8] = c.j;
      device.queue.writeBuffer(resources[6], 0, input);
      const read = buffer(
        128 + (colours + 3) * 16,
        GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      );
      const encoder = device.createCommandEncoder();
      for (let k = 0; k < 2; k++) {
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipelines[k]);
        pass.setBindGroup(0, bind);
        pass.dispatchWorkgroups(1);
        pass.end();
        encoder.copyBufferToBuffer(resources[6], 0, read, k * 64, 64);
      }
      encoder.copyBufferToBuffer(
        resources[7],
        0,
        read,
        128,
        (colours + 3) * 16,
      );
      device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const mapped = read.getMappedRange(),
        floats = new Float32Array(mapped),
        uints = new Uint32Array(mapped, 128);
      results.push({
        ...c,
        reducedSafe: floats[8],
        reducedJ: floats[9],
        preparedSafe: floats[24],
        preparedJ: floats[25],
        active: floats[31] > 0,
        groups: Array.from({ length: colours + 3 }, (_, i) => uints[i * 4]),
        yz: Array.from({ length: colours + 3 }, (_, i) => [
          uints[i * 4 + 1],
          uints[i * 4 + 2],
        ]),
      });
      read.unmap();
      read.destroy();
    }
  } finally {
    device.destroy();
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return results;
}
