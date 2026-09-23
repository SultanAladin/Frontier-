# First device run of the editor selection build — GTX 1650 SUPER, 2026-09-22

The owner ran commit `ec284e6` (GPU picking, silhouette outline, reference gizmo, applied drags) on the
Windows Vulkan build. This file keeps the bring-up log verbatim and a digest of the telemetry, plus the
three faults observed at the desk — each with the root cause found in source the same day.

## Bring-up (verbatim)

```
[INFO] [Bootstrap] Project-Zero windowed ReSTIR renderer starting.
[INFO] [Scene] Showcase: 229506 triangles, 499 instances, 2045 clusters, 241 materials, 3368 luminaires, bounds [-40.00 -40.00 0.00]..[40.00 40.00 6.00] m
[INFO] [Materials] Materials: 241 descriptors -> 241 records, 241 slabs (limit 1, 0 folded), 499 placements, 0 cameras, 0 punctual lights
[SwapchainExchange] Window created: 1280x720
[SwapchainExchange] Using GPU: NVIDIA GeForce GTX 1650 SUPER (queue family 0)
[SwapchainExchange] Ray tracing: supported = Software BVH, requested = Auto, using = Software BVH  [AS ext 0 feat 0 | RQ ext 0 feat 0 | RP ext 0 | BDA 1 | bindless 1 | subgroup 32]  driver: NVIDIA 576.40
[SwapchainExchange] Reservoirs: 2 x 70 MB (80 B/px temporal DI state, D10 identity included).
[SwapchainExchange] Indirect pool: 2 x 70 MB (80 B/px first-bounce-vertex state, kFeatureGiReuse; D10 identity included).
[VisibilityExchange] Loaded SPIR-V: Engine/Shaders/SelectionOutline.spv
[INFO] [Traversal] CWBVH: 229508 triangles -> 39627 nodes, 3095.9 KB nodes + 16137.3 KB leaves (85.8 B/tri), SAH 13.84, built in 1589.9 ms (spatial splits)
[INFO] [Traversal] Two-level: 500 instances -> 500 BLASes over 229508 triangles, top level 598 nodes, shared blobs 2631.4 KB + 10758.2 KB, built in 678.0 ms
[GizmoExchange] Loaded SPIR-V: .../Engine/Shaders/GizmoRaster.vert.spv
[GizmoExchange] Loaded SPIR-V: .../Engine/Shaders/GizmoRaster.frag.spv
[GizmoExchange] Ready: capacity 4864 vertices, 2 cycle slots.
[INFO] [Gizmo] Transform gizmo ready: G/R/S over a picked object, exactly the reference's pieces.
```

Every editor-selection SPIR-V loaded and initialised on the device: SelectionOutline, GizmoRaster pair,
GizmoExchange with 4864-vertex capacity and 2 cycle slots. No validation errors in the log.

## Telemetry digest (over the captured window)

| figure | range seen |
|---|---|
| CPU frame | 24.6 – 47.7 ms (20.9 – 50.6 fps), worst 100 ms |
| GPU frame | 21.98 – 46.88 ms, GPU-BOUND nearly every report |
| ReSTIR pass | 19.14 – 42.38 ms — 69 – 94 % of the GPU frame |
| raster | 1.49 – 9.79 ms; cull ≤ 0.12 ms; post ≈ 0.25 ms |
| dials | 963 kpx × (1 candidate + 0 extra + 0 spatial taps), 4 denoise levels, FIFO |
| resident memory | 644 MiB climbing to 1347 MiB, easing back to ≈ 960 MiB |

Dial reading: the run was at 1 candidate / 0 taps — the floor setting. Every soft-shadow observation below
must be read against that (one shadow ray per pixel per frame).

## The three faults observed, and their causes (found in source)

1. **The gizmo draws at the scene's centre, not the object's.** `GameExecution.cpp` seats the pose origin
   from the FIRST instance's World translation column (W[12..14]). The showcase's instances carry their
   geometry mostly in world-space vertices with near-identity instance worlds, so the translation column is
   ~0,0,0 — the scene centre. The Cornell proof scene never showed it because its spans are seated the same
   way the drag rewrites them. Fix: seat the origin at the picked span's world-space bounds centroid.

2. **Picking answers one click late** (select object 2 → object 1 highlights). `VisibilityExchange` marks
   `PickRecorded[Slot] = true` at command-RECORD time, and `SwapchainExchange::QueryPickedVisibility` reads
   the mapped readback with no completion check. At 30–45 ms GPU frames the CPU wins that race every time:
   the mapped buffer still holds the PREVIOUS tap's texel when the flag is first seen. Fix: only trust a
   recorded slot after its cycle fence has been waited since the record (a per-slot generation stamp).

3. **G/R stuck — mode locks on S.** `SwapchainExchange::OnKey` maps only W/A/S/D/Q/E/Shift/Escape into
   `InputExchange`. `GLFW_KEY_G` and `GLFW_KEY_R` are NEVER assigned, so `IsKeyPressed(KeyG/KeyR)` is
   forever false; S reaches the mode switch only because the WASD map carries `KeyS`. Once Scale is chosen
   nothing can choose anything else. The Ctrl keys are also unmapped, so drag snapping cannot engage in the
   windowed build either. Fix: map G, R, and both Ctrls in `OnKey`.
