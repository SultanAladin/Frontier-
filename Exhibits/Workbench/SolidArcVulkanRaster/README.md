# SolidArc · Vulkan raster pipelines · CPU exact-mirror proof

**What this is.** Visual and timing proof for the three SolidArc raster pipelines of the Vulkan path: **Surface**, **Line** and
**Point**. Each pipeline is driven in isolation over one full 72-frame turntable orbit (5° per frame) at 480×300.

**What it is not.** No GPU was available when this was produced (no Vulkan ICD in the build sandbox). **These are CPU timings of the
exact mirror, not GPU frame rates.** No GPU FPS is claimed or modelled here. The Vulkan path
(`Presentation/VulkanRaster.cpp`) has been compiled against the Vulkan headers and its SPIR-V checked, but it has **not been executed
on a device**. Its parity with this mirror is therefore unmeasured.

## Files

| File | Content |
|---|---|
| `three_pipelines.png` | One still per pipeline (frame 18) |
| `surface_orbit.gif`, `line_orbit.gif`, `point_orbit.gif` | 72-frame orbits, 80 ms per frame |
| `surface_still.png`, `line_still.png`, `point_still.png` | Frame 0 of each orbit, full size |
| `chart_frame_time.png` | Distribution of CPU frame time per pipeline |
| `chart_cpu_fps.png` | Mean CPU-mirror frames per second per pipeline |
| `chart_workload.png` | Exact per-frame counts (triangles, segments, points, fragments) |
| `timings_summary.tsv` | All numbers behind the charts |
| `checks.txt` | Self-checks run by the harness |

## Timings (CPU exact mirror, one run, warm-up of 3 frames excluded)

| Pipeline | Shader | Mean ms | Median ms | p95 ms | Mean CPU FPS | Triangles | Segments | Points | Fragments / frame (mean) |
|---|---|---|---|---|---|---|---|---|---|
| Surface | `SurfaceVS / SurfaceFS` | 7.49 | 7.13 | 9.34 | 133.6 | 9,216 | 0 | 0 | 53,115 |
| Line | `LineVS / LineFS` | 12.34 | 11.99 | 14.10 | 81.0 | 18,432 | 9,216 | 0 | 110,811 |
| Point | `PointVS / PointFS` | 5.23 | 5.04 | 6.88 | 191.1 | 2,048 | 0 | 1,024 | 82,944 |

Measured on: x86_64, CPython 3.11.2 for the plotting step only; the
timed code is the C++ harness built with `g++ -O2`.

## Self-checks (`checks.txt`)

```
PASS  surface: identical bytes for an identical view
PASS  line: identical bytes for an identical view
PASS  point: identical bytes for an identical view
PASS  surface pick identity 42 is reported somewhere in the frame
PASS  pick is 0 where nothing is drawn
PASS  a plane behind the torus leaves the torus depth untouched
PASS  a plane behind the torus leaves the torus colour untouched
```

## Honest limits

* The mirror (`SoftwareRaster`) runs the same `.slang` bodies as C++. The GPU runs them as SPIR-V. Identical source text does not
  prove identical pixels; that needs a device run of `VulkanRaster` against this mirror, which has not happened.
* Matcap studios: the mirror samples pre-rendered 128×128 layers; the GPU evaluates the analytic studio per fragment.
* The mirror uses 4-tap supersampling for the lattice and analytic shaders; the GPU path reproduces the same taps in
  `LatticeFS` but does not supersample surfaces, lines or points.
* Fragment, depth-reject and back-face tallies are CPU-side counts. The Vulkan path does not read them back.

## Reproduce

```
bash run_proof.sh          # builds the C++ harness at -O2, runs it, then runs build_proofs.py
```
