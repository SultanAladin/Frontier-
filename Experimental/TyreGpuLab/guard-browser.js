import { fetchShader } from "./runtime-assets.js?release=tyre-gpu-20261016-r4";
// Browser-only isolated tests of the ACTUAL WGSL acceptance kernels, not a CPU solver.
export async function runGuardCases() {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const errors = [];
  device.addEventListener("uncapturederror", (e) =>
    errors.push(e.error.message),
  );
  const storage =
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const buf = (size, usage = storage) => device.createBuffer({ size, usage });
  const node = buf(320),
    edge = buf(16),
    tet = buf(64),
    schedule = buf(4),
    lambda = buf(16),
    params = buf(64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    stats = buf(96),
    rotations = buf(16),
    contact = buf((2 * 4 + 3) * 16);
  const td = new ArrayBuffer(64),
    tv = new DataView(td);
  [0, 1, 2, 3].forEach((v, i) => tv.setUint32(i * 4, v, true));
  [4, 9, 14].forEach((i) => tv.setFloat32(i * 4, 1, true));
  tv.setFloat32(60, 1 / 6, true);
  device.queue.writeBuffer(tet, 0, td);
  const pd = new ArrayBuffer(64),
    pv = new DataView(pd);
  pv.setFloat32(0, 1 / 240, true);
  [4, 1, 1, 1].forEach((v, i) => pv.setUint32(32 + i * 4, v, true));
  device.queue.writeBuffer(params, 0, pd);
  const resources = [
    node,
    edge,
    tet,
    schedule,
    lambda,
    params,
    stats,
    rotations,
    contact,
  ];
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
    ["guardPartials", "guardReduce", "finish"].map((entryPoint) =>
      device.createComputePipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module, entryPoint },
      }),
    ),
  );
  const cases = [
    { name: "identity", f: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    {
      name: "rigid small rotation",
      f: [
        Math.cos(0.02),
        Math.sin(0.02),
        0,
        -Math.sin(0.02),
        Math.cos(0.02),
        0,
        0,
        0,
        1,
      ],
    },
    {
      name: "reflected proposal",
      f: [-1, 0, 0, 0, 1, 0, 0, 0, 1],
      reject: true,
    },
    {
      name: "crushed proposal",
      f: [0.01, 0, 0, 0, 0.01, 0, 0, 0, 0.01],
      reject: true,
    },
    { name: "large shear", f: [1, 0, 0, 5, 1, 0, 0, 0, 1], reject: true },
    {
      name: "nonfinite proposal",
      f: [NaN, 0, 0, 0, 1, 0, 0, 0, 1],
      reject: true,
    },
  ];
  const out = [],
    old = [
      [0, 1, 0],
      [1, 1, 0],
      [0, 2, 0],
      [0, 1, 1],
    ];
  try {
    for (const c of cases) {
      const n = new Float32Array(80);
      for (let i = 0; i < 4; i++) {
        const p = i
          ? [c.f[(i - 1) * 3], c.f[(i - 1) * 3 + 1] + 1, c.f[(i - 1) * 3 + 2]]
          : [0, 1, 0];
        n.set([...p, 1], i * 20);
        n.set([...old[i], 0], i * 20 + 4);
      }
      const sd = new Float32Array(24);
      sd[7] = 1;
      const rig = new Float32Array((2 * 4 + 3) * 4);
      rig.set([0, 1, 0, 0], 2 * 4 * 4);
      rig.set([0, 1, 0, 0], (2 * 4 + 1) * 4);
      device.queue.writeBuffer(contact, 0, rig);
      device.queue.writeBuffer(node, 0, n);
      device.queue.writeBuffer(stats, 0, sd);
      const e = device.createCommandEncoder(),
        pass = e.beginComputePass();
      pass.setBindGroup(0, bind);
      for (const p of pipelines) {
        pass.setPipeline(p);
        pass.dispatchWorkgroups(1);
      }
      pass.end();
      const read = buf(416, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
      e.copyBufferToBuffer(node, 0, read, 0, 320);
      e.copyBufferToBuffer(stats, 0, read, 320, 96);
      device.queue.submit([e.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(read.getMappedRange()),
        points = Array.from({ length: 4 }, (_, i) =>
          Array.from(data.slice(i * 20, i * 20 + 3)),
        );
      const sub = (a, b) => a.map((v, i) => v - b[i]);
      const a = sub(points[1], points[0]),
        b = sub(points[2], points[0]),
        d = sub(points[3], points[0]);
      const j =
        a[0] * (b[1] * d[2] - b[2] * d[1]) -
        a[1] * (b[0] * d[2] - b[2] * d[0]) +
        a[2] * (b[0] * d[1] - b[1] * d[0]);
      out.push({
        name: c.name,
        reject: !!c.reject,
        safe: data[80 + 8],
        j,
        finite: points.flat().every(Number.isFinite),
      });
      read.unmap();
      read.destroy();
    }
  } finally {
    device.destroy();
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return out;
}
