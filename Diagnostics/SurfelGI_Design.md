# Frontier mesh Surfel GI

## What is implemented

`PhotometricIllumination/SurfelGlobalIllumination.*` is a CPU reference implementation of a mesh-only surfel irradiance cache. It samples the visible mesh/G-buffer into surfels, gathers nearby surfels, optionally tests each gather with a ray-traced shadow callback, and reprojects the result to the current frame. It does **not** allocate an SDF, voxel grid, signed-distance texture, or probe volume.

The CMake target includes the implementation. The UI dashboard also has a **Surfel GI** quick tile. Its state is stored as `document.documentElement.dataset.giBackend` (`surfel` or `raytraced`) and in local storage; a future Vulkan/UI bridge should consume that same value.

## Planned renderer integration

1. Build a mesh acceleration structure once per static scene (BVH first; hardware ray query later). The callback passed to `SurfelGlobalIllumination::Integrate` should return whether the segment from `Origin` to `Target` is unoccluded.
2. Run direct lighting and ray-traced shadows as usual. The direct buffer seeds the surfel cache; surfels do not invent an additional light source.
3. Run the surfel gather at a reduced internal resolution (`SurfelStride`), then reproject with the current visibility buffer. Temporal accumulation and disocclusion rejection should be added before shipping.
4. Use `RayLightingSettings::ReflectionBounceCount` for both reflection and GI bounce count. The quick tile changes only `GlobalIlluminationMode`; it does not silently change reflection bounces or shadow quality.
5. Use a per-frame budget: surfel count, gather radius, and shadow rays should scale with the existing fidelity classifier. Dynamic/deforming meshes invalidate or update their surfels; static meshes can persist them.

## Surfel GI vs Unreal-style SDF GI

| Area | Mesh Surfel GI | Unreal SDF-based GI (high-level) |
|---|---|---|
| Scene representation | Samples actual triangles/mesh surfaces | Signed-distance fields / distance volumes derived from meshes |
| Small geometric detail | Preserves detail where surfels are sampled; can be sparse or leak if undersampled | SDF resolution and conservative distance representation can erase thin/small features |
| Dynamic meshes | Requires surfel rebuild/update, but can update only changed surfaces | Requires updating/rebuilding affected distance fields; often designed around particular dynamic-object paths |
| Indirect lighting | Local surface-to-surface gather, naturally surface aware | Fast distance queries plus tracing through distance representation |
| Occlusion | Can use exact mesh ray-traced shadows (the demo-style hybrid) | SDF tracing is approximate; separate hardware/software shadow path may be used |
| Memory | Surfels plus mesh acceleration structure; budget is explicit | 3D distance data can be substantial, especially at high quality/large worlds |
| Low-end suitability | Good with half/quarter-resolution surfels, one bounce, and temporal reuse; CPU reference is not final performance | Good when SDF generation and tracing fit the GPU budget, but quality/resolution trade-offs are less mesh-exact |
| Failure modes | Sparse-cache holes, light leaking, temporal ghosts, over-dark gathers | SDF light leaking, missing thin geometry, distance-field build cost and cascaded resolution limits |
| Best use | Mesh-first renderer that wants scalable indirect diffuse light without an SDF pipeline | Large-world GPU pipeline optimized around distance-field queries |

Surfel GI is not automatically cheaper: a naïve all-to-all gather is expensive. The production path needs tiled/clustered surfels, a BVH or spatial hash, temporal reuse, and a strict shadow-ray budget. The checked-in implementation is intentionally a correctness/reference path and should not be treated as the final low-end GPU implementation.

## Are ray-traced shadows part of the demo?

The surfel idea does not require ray tracing. It can gather unoccluded surfels, use raster shadow maps, or use a ray query. For Frontier, the recommended hybrid is **surfel GI for diffuse indirect light plus ray-traced mesh shadows for visibility**, when hardware permits. On low-end hardware, the same callback can be backed by a CPU/GPU BVH or raster shadow map. Reflections remain a separate ray-traced feature, while GI and reflections share the same bounce setting.
