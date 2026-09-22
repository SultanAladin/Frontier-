# Project-Zero R14 — Instance traversal shadow fix proof

Date: 2026-09-20  
Branch: `arena/01a0b62f-frontier`

## 1. Baseline reset

The branch was brought back to the requested `d425de2` content before this fix was applied. The revert commit is:

- `e603a9a` — `Revert to d425de2 shadow baseline`

Tree check performed after the revert:

```text
git diff --stat d425de2 HEAD
```

returned no file differences before the R14 fix was added. So this fix is on top of the `d425de2` shadow baseline, not on top of the R12/R13 denoiser/moon/pipeline-cache changes.

## 2. Is the Claude diagnosis correct?

Yes — the **descriptor mismatch diagnosis is correct**.

The multi-object showcase uses the two-level instance traversal path:

```text
Projects/Project-Zero/Source/GameExecution.cpp
  AnimatedInstances.size() > 1
  InstanceStructure.Build(...)
  Surface.UploadInstanceTraversal(InstanceStructure)
  Integrator.AssignInstanceCount(instance count)
```

When `TlasInstanceCount > 0`, the shader does not walk the old one-piece world CWBVH. It walks the TLAS, then fetches a BLAS placement, then calls the BLAS walker with offsets into bindings 8/9:

```text
Engine/Shaders/TraversalCWBVH.slang
  TraversalBlasPlacement placement = BlasPlacements[instance.BlasIndex];
  TraceBlasClosest(..., placement.NodeOffset, placement.LeafOffset)
  TraceBlasOccluded(..., placement.NodeOffset, placement.LeafOffset)
```

Those `TraceBlas*` functions index the same `CwbvhNodes` and `CwbvhTris` buffers used by the single-world path. In `ReSTIRViewport.slang`, those are descriptor bindings:

```text
binding 8  = CwbvhNodes
binding 9  = CwbvhTris / leaf triangles
binding 27 = TLAS nodes
binding 28 = TLAS primitive list
binding 29 = TLAS instance rows
binding 30 = BLAS placements
```

Before this fix, `UploadInstanceTraversal()` uploaded only bindings `27-30`. It did **not** upload `InstanceAcceleration::QueryNodeBlob()` or `InstanceAcceleration::QueryLeafBlob()` into bindings `8/9`. Therefore the shader's two-level path combined:

- TLAS and BLAS placement offsets from `InstanceAcceleration`, with
- stale whole-scene world-space CWBVH blobs from `UploadTraversal()`.

That is not a valid descriptor set. The BLAS offsets are defined relative to the concatenated BLAS blobs, not relative to the old whole-scene tree.

This explains the historical behavior:

| Scene/path | `TlasInstanceCount` | Binding 8/9 content used by shader | Expected result |
|---|---:|---|---|
| Cornell / old single scene | `0` | whole-scene world CWBVH | shadows can work |
| Showcase / multi-object scene before fix | `>0` | wrong blob for BLAS offsets | shadow occlusion can miss/leak/break |
| Showcase / multi-object scene after fix | `>0` | concatenated BLAS node/leaf blobs | TLAS→BLAS shadow rays use matching buffers |

So the root cause is not moon-only, sun-only, emissive-only, or denoiser-only. It is a lower-level traversal upload mismatch that affects all direct-light shadow queries using the two-level path.

## 3. What was changed

File changed:

```text
Engine/DeviceExchange/SwapchainExchange.cpp
```

`SwapchainExchange::UploadInstanceTraversal()` now uploads six matching buffers:

| Binding | Buffer | Source |
|---:|---|---|
| `8` | `TraversalNodeBuffer` | `Instances.QueryNodeBlob()` |
| `9` | `TraversalLeafBuffer` | `Instances.QueryLeafBlob()` |
| `27` | `TlasNodeBuffer` | `Instances.QueryTlasNodePayload()` |
| `28` | `TlasPrimitiveBuffer` | `Instances.QueryTlasPrimitiveList()` |
| `29` | `TlasInstanceBuffer` | `Instances.QueryInstances()` |
| `30` | `BlasPlacementBuffer` | `Instances.QueryBlasPlacements()` |

It also records the binding-8/9 capacities from the BLAS blobs and marks both traversal paths resident while the instance path is active.

`SwapchainExchange::UploadTraversal()` was also corrected to clear two-level residency and null the TLAS handles when the world-space fallback owns bindings 8/9 again. This prevents stale destroyed TLAS handles from being re-described if the renderer falls back to the single-world path.

## 4. Proof added

A new static contract gate was added:

```text
Tools/Build/CheckInstanceTraversalUpload.sh
```

It proves the source-level descriptor contract:

1. `InstanceAcceleration` exposes `QueryNodeBlob()` and `QueryLeafBlob()`.
2. `UploadInstanceTraversal()` reads both BLAS blobs.
3. `UploadInstanceTraversal()` uploads those blobs into `Vulkan->TraversalNodeBuffer` and `Vulkan->TraversalLeafBuffer`.
4. Those are the buffers described at bindings `8/9`.
5. The shader's TLAS closest-hit and occlusion paths use `placement.NodeOffset` and `placement.LeafOffset` when calling `TraceBlasClosest()` and `TraceBlasOccluded()`.
6. `UploadTraversal()` clears two-level residency when reverting bindings `8/9` back to the world-space fallback.

Gate result:

```text
[InstanceTraversalUpload] GREEN — two-level TLAS now has matching BLAS blobs in bindings 8/9
```

This is a source/descriptor proof. It is not a Windows visual render proof, because this sandbox cannot run your Vulkan GPU build.

## 5. Validation run in sandbox

Passed:

```text
Tools/Build/CheckInstanceTraversalUpload.sh       GREEN
Tools/Build/CheckShaderTableParity.sh             GREEN
Tools/Build/CheckShowcaseLevel.sh                 GREEN
Tools/Build/CheckCelestialContent.sh              GREEN
Tools/Build/CheckCelestialShadow.sh               GREEN
Tools/Build/CheckTelemetryProbe.sh                GREEN
Tools/Build/CheckPerformanceTelemetry.sh          GREEN
Tools/Build/CheckBuildSourceList.sh               GREEN
git diff --check                                  GREEN
```

Skipped as expected:

```text
Tools/Build/CheckShaders.sh
```

Reason: no `slangc`, `glslc`, `glslangValidator`, or Vulkan SDK shader compiler is installed in this sandbox.

## 6. What this should fix visually

This should restore object-cast shadows in the multi-object showcase for all direct-light paths that use `TraceShadow()` over the two-level traversal:

- daylight sun direct candidates,
- emissive mesh-light direct candidates,
- moon direct candidates if/when the R13 moon reservoir change is reintroduced later.

Since the current branch was reverted to `d425de2` first, this commit does **not** include the R13 moon reservoir candidate yet. It fixes the traversal upload problem underneath sun/emissive ReSTIR shadows.

## 7. What remains separate

The blank/white moon texture issue is separate from this traversal fix. The content gate proves the moon JPEGs decode as real `2048x1024` textures, but that still does not prove the live GPU moon shader samples the expected bindless slot. That needs a separate moon texture debug view or GPU-sampled albedo readback.

The R12 denoiser/pipeline-cache and R13 moon-reservoir changes were reverted as requested. They can be re-applied selectively after the traversal shadow fix is validated on Windows.
