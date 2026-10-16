// Isolated GPU tests of the shared render/collision profile. No CPU physics fallback.
import { fetchShader } from "./runtime-assets.js?release=tyre-gpu-20261016-r3";
export async function runRoadCases() {
  const adapter = await navigator.gpu.requestAdapter(),
    device = await adapter.requestDevice();
  const queries = new Float32Array([
    0.08, 0, 0, 0, 0.08, 0, 0.045, 0, -0.62, 0, 0.045, 0.7, 0.125, 0, 0.045, 0,
    0.08, 0.5, 0.045, 0, -0.62, 0, 0.045, 3.7,
  ]);
  const b = (size, usage) => device.createBuffer({ size, usage });
  const input = b(
      queries.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    ),
    output = b(6 * 32, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC),
    read = b(6 * 32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  device.queue.writeBuffer(input, 0, queries);
  const module = device.createShaderModule({
    code:
      (await fetchShader("terrain.wgsl")) +
      `
 @group(0) @binding(0) var<storage,read> queries:array<vec4f>;
 @group(0) @binding(1) var<storage,read_write> output:array<vec4f>;
 @compute @workgroup_size(8) fn main(@builtin(global_invocation_id) gid:vec3u){
  if(gid.x>=6u){return;}let q=queries[gid.x];let p=roadProfile(q.xy,q.z,q.w);let n=roadNormal(p);
  output[gid.x*2]=vec4f(p,0);output[gid.x*2+1]=vec4f(n,0);
 }`,
  });
  try {
    const pipeline = await device.createComputePipelineAsync({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: input } },
        { binding: 1, resource: { buffer: output } },
      ],
    });
    const e = device.createCommandEncoder(),
      pass = e.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(1);
    pass.end();
    e.copyBufferToBuffer(output, 0, read, 0, 6 * 32);
    device.queue.submit([e.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(read.getMappedRange()),
      result = Array.from({ length: 6 }, (_, i) => ({
        height: data[i * 8],
        dx: data[i * 8 + 1],
        dz: data[i * 8 + 2],
        normal: Array.from(data.slice(i * 8 + 4, i * 8 + 7)),
      }));
    read.unmap();
    return result;
  } finally {
    device.destroy();
  }
}
