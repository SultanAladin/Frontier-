# Mesh SDF pipeline: import-time bake, local instance sampling, dirty cells (CPU exact)

**Status: GPU kernels compiled to SPIR-V, Vulkan host written and syntax-checked, CPU exact mirror verified (proof GREEN, 19 checks plus Part D).
Nothing has run on a GPU yet. The engine still runs the old per-frame path (see "Not done").**

## What is built and verified here

| Part | Where | Verified by |
|---|---|---|
| Import-time bake: one `.fsdf` per unique mesh, named by a FNV-1a hash of source, resolution, padding and format version | `Tools/Bake/TriangleFieldImport.cpp`, `Engine/GeometricRaster/TriangleField.h` | Tool run: first call bakes, second call is a cache hit, new resolution gets a new file, missing input exits 1 |
| Exact closest-point bake (Ericson), sign from face normal, file round trip | `TriangleField.h` | proof Part A: bake matches the analytic box within 1.5 cells, sign correct, round trip identical |
| Per-instance local sampling through the inverse world matrix; the field never changes when the instance moves | `SampleInstance`, `MakeAffine` | proof Part A: moved, scaled (x2) and rotated instance matches the exact box within 1.5 cells x scale; non-uniform scale is conservative |
| Clipmap dirty cells: footprint of an instance's old and new bounds, per level | `DirtyCellsForMove`, `RangeOf` | proof Part B, per frame |
| Exposed slabs only on a camera shift (no full refill) | `ExposedCellsOnShift` | proof Part B, per frame |
| Static / movable split (Unreal's approach) | counts in Part B: the car never writes the static field | proof Part B: 3000 frames with the car moving and no camera shift write 0 static cells |
| Culling instances by bounds keeps the composited minimum exact | Part B cull check | 1267 points compared, 0 mismatches |
| Import step over a content tree: `TriangleFieldImport --dir` bakes each `.obj` once and writes `sdf_index.tsv` (source path, hash, file, resolution) | `ProjectDirectory` in `TriangleField.h` | proof Part C: 3 meshes baked, second import is 3 cache hits |
| Runtime loader: load only, never bake. Stale (source edited after import) and missing entries are reported, not rebuilt | `RuntimeLoad` | proof Part C: a.obj loads identical; edited c.obj reported stale; d.obj reported with no entry; bake counter unchanged at runtime |

## GPU kernels and Vulkan host (compiled, not executed)

Host: `Engine/GeometricRaster/TriangleFieldVulkanExchange.h/.cpp` picks a device (discrete preferred, every candidate logged), creates the two
pipelines, and submits each dispatch with a fence. Its device check is `Tools/Bake/TriangleFieldDeviceCheck.cpp`: it bakes a unit cube at 32^3
and composites three instances on the device, then compares both with the CPU reference at 1e-3. Status: **not run** (no Vulkan
driver in the build sandbox); it has only passed a syntax-only compile.

Source: `Engine/GeometricRaster/Shaders/TriangleField.slang`. Build gate: `Tools/Build/BuildTriangleFieldSpirv.py`, which compiles both entries
to SPIR-V through the Slang C API. Slang validates the SPIR-V inside the compile, and the gate writes
`Engine/GeometricRaster/Generated/TriangleFieldSpirv.inc`. The gate is GREEN, and both modules are 6,692 and 6,256 bytes.

| Entry | Work | Mirror |
|---|---|---|
| `ProjectGridMain` (import time) | one thread per grid node of one mesh; exact closest triangle; sign from the closest face normal | `TriangleFieldDeviceMirror::ProjectGrid` |
| `ClipMinimumMain` (per frame, dirty cells only) | one thread per dirty cell of one clip level; minimum over the culled instance list through each instance's inverse transform | `TriangleFieldDeviceMirror::ClipMinimumDirty` |

`TriangleFieldDeviceMirror.h` follows each shader line for line on the same flat buffers. Proof Part D checks it:
- the mirror's bake equals the CPU bake at all 32,768 nodes (max difference 0);
- the composite writes exactly the 891 dirty cells and no others;
- the composite equals the CPU per-instance minimum over those cells (max difference 0).

These differences are exact only because the mirror and the CPU use the same arithmetic. A GPU will differ in rounding (fused
multiply-add, sqrt precision), so the device comparison must use a tolerance. That tolerance is not yet set, because no device run has
happened.

## Results (CPU exact cell counts, 3600 frames, 3 clip levels of 32^3, one moving car, camera at 1.5 m/s)

| Metric | Old build | New build |
|---|---:|---:|
| Cells written, total | 353,894,400 | 2,225,844 |
| Cells written per frame (mean) | 98,304.0 | 618.3 |
| Cells written per frame (max) | 98,304 | 7,505 |
| Frames with a full rebuild | 3,600 | 0 |
| Reduction in cells written | 1.0x | 159.0x |

Charts and GIF:
- `chart_cells_per_frame.png`: per-frame cell writes, old vs new, and the new split by field.
- `chart_cumulative_writes.png`: cumulative writes over 60 s.
- `dirty_cells.gif`: cumulative writes filling in over 60 s.
- `dirty_cells_table.md`: the table above.

These are **cell counts**, not GPU milliseconds. The decision cost on the CPU is about 200 to 300 ns per frame. No GPU or FPS number is claimed.

## Not done (say so before anyone ships this)

0. **Device run.** The Vulkan host and `TriangleFieldDeviceCheck.cpp` exist, but nothing has executed them. The build sandbox has no Vulkan
   driver, so the device check needs a run on the user's RX 9060 XT before any GPU number is claimed.

1. **GPU compositing kernel.** The compute shader that writes only the dirty cells, and the toroidal slab fill on the GPU, are not written.
2. **Engine switch-over.** `DistanceFieldStructure::RefreshInstances` and `DistanceFieldConstruct.slang` still rebuild the whole volume on every change. The new kernels are not wired into the running engine.
3. **Import hook in the editor and content build.** `TriangleFieldImport --dir` exists, but nothing in the editor or the content build runs it yet. The engine's glTF, FBX and OBJ decoders are not hooked, and the runtime loader is not called by the renderer. The hook is deliberately not placed in the runtime decoder, because that would bake at runtime.
4. **Two physical fields.** The static / movable split is counted here, but the engine has one field.
5. **The fourth step** in the request was cut off in the message ("4."). Not built. Please restate it.

## Reproduce

```
g++ -std=c++20 -O2 -I../../../Engine/GeometricRaster proof.cpp -o proof && ./proof > run.log
/tmp/venv/bin/python build_proofs.py   # needs matplotlib, numpy, pillow
# Device run (not yet performed): see Tools/Bake/TriangleFieldDeviceCheck.cpp for the build line
PATH=/tmp/venv/bin:$PATH python3 ../../../Tools/Build/BuildTriangleFieldSpirv.py   # Slang SPIR-V gate
python3 build_proofs.py
g++ -std=c++20 -O2 ../../../Tools/Bake/TriangleFieldImport.cpp -o bake && ./bake --dir <content root> <cache dir>
g++ -std=c++20 -O2 ../../../Tools/Bake/TriangleFieldImport.cpp -o bake && ./bake out/unit_cube.obj /tmp/sdf-cache 32 0.1
```

The proof writes `out/` (the test cube and its `.fsdf`). That folder is git-ignored.
