# Mesh SDF pipeline: import-time bake, local instance sampling, dirty cells (CPU exact)

**Status: CPU-verified foundation. The engine still runs the old per-frame path until the GPU compositing kernel is built and run
on a device (see "Not done").**

## What is built and verified here

| Part | Where | Verified by |
|---|---|---|
| Import-time bake: one `.fsdf` per unique mesh, named by a FNV-1a hash of source, resolution, padding and format version | `Tools/Bake/BakeMeshSdf.cpp`, `Engine/GeometricRaster/MeshDistanceField.h` | Tool run: first call bakes, second call is a cache hit, new resolution gets a new file, missing input exits 1 |
| Exact closest-point bake (Ericson), sign from face normal, file round trip | `MeshDistanceField.h` | proof Part A: bake matches the analytic box within 1.5 cells, sign correct, round trip identical |
| Per-instance local sampling through the inverse world matrix; the field never changes when the instance moves | `SampleInstance`, `MakeAffine` | proof Part A: moved, scaled (x2) and rotated instance matches the exact box within 1.5 cells x scale; non-uniform scale is conservative |
| Clipmap dirty cells: footprint of an instance's old and new bounds, per level | `DirtyCellsForMove`, `RangeOf` | proof Part B, per frame |
| Exposed slabs only on a camera shift (no full refill) | `ExposedCellsOnShift` | proof Part B, per frame |
| Static / movable split (Unreal's approach) | counts in Part B: the car never writes the static field | proof Part B: 3000 frames with the car moving and no camera shift write 0 static cells |
| Culling instances by bounds keeps the composited minimum exact | Part B cull check | 1267 points compared, 0 mismatches |
| Import step over a content tree: `BakeMeshSdf --dir` bakes each `.obj` once and writes `sdf_index.tsv` (source path, hash, file, resolution) | `BakeDirectory` in `MeshDistanceField.h` | proof Part C: 3 meshes baked, second import is 3 cache hits |
| Runtime loader: load only, never bake. Stale (source edited after import) and missing entries are reported, not rebuilt | `RuntimeLoad` | proof Part C: a.obj loads identical; edited c.obj reported stale; d.obj reported with no entry; bake counter unchanged at runtime |

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

1. **GPU compositing kernel.** The compute shader that writes only the dirty cells, and the toroidal slab fill on the GPU, are not written.
2. **Engine switch-over.** `DistanceFieldStructure::RefreshInstances` and `DistanceFieldConstruct.slang` still rebuild the whole volume on every change. The new path is not wired into the running engine.
3. **Import hook in the editor and content build.** `BakeMeshSdf --dir` exists, but nothing in the editor or the content build runs it yet. The engine's glTF, FBX and OBJ decoders are not hooked, and the runtime loader is not called by the renderer. The hook is deliberately not placed in the runtime decoder, because that would bake at runtime.
4. **Two physical fields.** The static / movable split is counted here, but the engine has one field.
5. **The fourth step** in the request was cut off in the message ("4."). Not built. Please restate it.

## Reproduce

```
g++ -std=c++20 -O2 -I../../../Engine/GeometricRaster proof.cpp -o proof && ./proof
python3 build_proofs.py
g++ -std=c++20 -O2 ../../../Tools/Bake/BakeMeshSdf.cpp -o bake && ./bake --dir <content root> <cache dir>
g++ -std=c++20 -O2 ../../../Tools/Bake/BakeMeshSdf.cpp -o bake && ./bake out/unit_cube.obj /tmp/sdf-cache 32 0.1
```

The proof writes `out/` (the test cube and its `.fsdf`). That folder is git-ignored.
