# Distance Field GI: card-history restarts, old build vs new build (CPU exact)

**What is measured.** How often the Distance Field GI stage restarts its accumulated card history
(`DistanceFieldGIStage::RecordFrame`, `Reset`), and how much history survives between restarts.
A restart clears both card images, so this count is the direct driver of the per-frame cost the
user reported.

**What is not measured.** GPU milliseconds and FPS. No GPU is available in this sandbox, so no
frame-rate or GPU timing is claimed here. The CPU column is the cost of the restart decision only.

## Builds compared

| Build | Predicate | Baseline |
|---|---|---|
| `old_exact` (1784c86) | byte-exact `memcmp` of the 12-float lighting block | stored **every frame** |
| `new_tolerant` (this change) | `DistanceFieldLightingDrift::LightingChanged`: sun direction within 0.25°, radiance / colour / ambient / exposure within 2% | stored **at the last reset** |

The new predicate is the real header the stage compiles, not a copy. The old predicate is the
byte compare from 1784c86, modelled exactly.

## Scenarios (3600 frames = 60 s at 60 fps, fixed seed)

- `sun_realtime`: sun at real day speed (360° / 24 min), exposure steady.
- `sun_demo_1dps`: sun at 1°/s, exposure steady.
- `auto_exposure`: sun static, exposure hunts ±0.3% per frame, one preset change at frame 1800.

## Results (`history_table.md`, `history_summary.tsv`)

| Scenario | Build | Restarts (60 s) | Restarts / frame | Mean history run (frames) | Longest run (frames) | Decision ns / frame (CPU) |
|---|---|---:|---:|---:|---:|---:|
| sun_realtime | old_exact | 3600 | 1.0000 | 0.0 | 0 | 38.2 |
| sun_realtime | new_tolerant | 1 | 0.0003 | 1799.5 | 2532 | 69.6 |
| sun_demo_1dps | old_exact | 3600 | 1.0000 | 0.0 | 0 | 24.0 |
| sun_demo_1dps | new_tolerant | 227 | 0.0631 | 14.8 | 15 | 74.5 |
| auto_exposure | old_exact | 3600 | 1.0000 | 0.0 | 0 | 24.2 |
| auto_exposure | new_tolerant | 65 | 0.0181 | 53.6 | 317 | 69.7 |

Reading the table:
- The old build restarted history on every frame in all three scenarios. Its card images were cleared 3600 times per minute.
- The new build restarts about 0.0003 to 0.06 times per frame. For a real-speed sun it restarts once in the whole minute.
- The preset change restarts history exactly once in the new build, which is what the check requires.
- The decision itself costs a few tens of nanoseconds in both builds, so the saving is in GPU work (card clears and lost accumulation), not CPU time. The new predicate is slightly slower per call (about 70 ns against 24 to 38 ns), but that is negligible.
- The 1°/s demo sun still restarts about 4 times per second. A smoother transition would need interpolated history, which is not implemented.

## Limits

- The GPU cost of a card clear is not measured. Turning restarts into milliseconds needs a device run.
- The moving-object path (`DistanceFieldStructure::RefreshInstances`) is **not** fixed. Any instance transform change still reprojects every facet, bumps the revision, and reconstructs the whole volume on the GPU. That is the separate remaining cause of per-frame rebuilds.
- The held baseline means a visible sun change can lag by up to 0.25° or 2% until the next restart.

## Files

- `proof.cpp`: the harness (real predicate, exact old predicate).
- `build_proofs.py`: builds the charts, GIF and table from the TSVs.
- `history_summary.tsv`, `restarts_per_second.tsv`: data.
- `chart_restarts_summary.png`, `chart_restarts_per_second.png`: charts.
- `history_restarts.gif`: 60-second animation of cumulative restarts.
- `history_table.md`: table above.

Reproduce:
```
g++ -std=c++20 -O2 -I../../../Engine/DeviceExchange proof.cpp -o proof && ./proof
python3 build_proofs.py
```
