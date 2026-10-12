# Native tyre heat and world-space smoke proof

Date: 2026-10-12. First milestone only; the saved overall plan remains ongoing.

## Implemented boundary

- Independent tread, carcass and enclosed-gas heat capacities per wheel, with implicit heat transfer.
- Actual sliding dissipation, not normal impact, static support, rolling loss or brake-disc work.
- Gas compression/expansion work, ideal-gas pressure and per-wheel conditioned grip.
- XPBD pressure uses the previous completed gas temperature without rebuilding particles/rest geometry.
- Powered Pacejka and coupled passive friction use the same wheel-local condition; shared coefficients remain unchanged.
- One vehicle-owned, world-axis-aligned coarse smoke domain acquired only on emission demand.
- Whole-cell relocation retains overlapping density, temperature and world velocities exactly.
- Exposed cells/transient pressure/obstruction clear; ordinary translation/turning does not reset emitted gas.
- Four fixed-rate wheel paths share the domain. Source cessation leaves transport active and bounds stationary.
- Quiet contents fade continuously before storage release; rapid stop/start reuses the retained domain.
- Sustained authored overheat and remaining rubber control ignition, burning heat and fuel consumption.
- An optional versioned C extension publishes caller-owned arrays and independent tyre conditions.
- The shared host takes transactional, owned snapshots; no DLL scalar-array pointers survive a callback.
- Live Drive enables the conditions and emission workflow. Legacy native fixtures remain explicitly isothermal by
default.

The coarse domain is **32 cubed over 24 m**, giving **0.75 m cells**. It is not a finished tyre-detail visual volume.
Terrain obstruction is sampled from the existing ground query. Drive additionally uses a conservative chassis box
from authored body vertices; this is not exact mesh/tyre-SDF smoke obstruction.

## Executed evidence

Run the portable native proof with:

```bash
python3 Tools/Tests/CheckDriveSmoke.py --output _AgentScratch/tmp/SmokeSequence/Native
```

The runner uses the authoritative Drive source roster. Its Windows route uses C++20, UTF-8 and `/MD`;
its GCC/Clang route uses C++20 with assertions enabled. Windows/MSVC and native host graphics were not executed here.
New production facilities are header-only or additions to already-rostered compilation units; no compiled engine
source was added outside the authoritative roster.

### Thermal, pressure, transport and interchange assertions

- A 30 kW independent-wheel heat fixture reaches tread **126.91 C**, carcass **21.09 C**, gas **20.05 C** after 10 s.
- Thermal balance residual: **0.000000584 J**. An unheated independent wheel remains cold.
- Adiabatic compression raises gas temperature/pressure; airborne friction heat is excluded.
- Actual XPBD hot-gas pressure responds without replacing particle storage or rest geometry.
- A sustained-overheat diagnostic consumes fuel and can continue burning airborne.
- Shift `(3, -2, 1)` retains `29 × 30 × 31` cells exactly at their original world positions.
- No-demand acquisition, stop/start reuse, quiet world bounds, heat-only retention, fading and retirement pass.
- Lateral-only emission, airborne friction exclusion, airborne combustion and no-slip support exclusion pass.
- Invalid tuning/payloads are refused; the last completed host snapshot remains unchanged.

### Actual vehicle fixtures

Each fixture settles for 1.5 s, receives one declared initial velocity/yaw condition, then mechanically integrates
for 6 s. The turning fixture has steering input; there are no per-frame pose/velocity commands.

| Case           | Peak slip work | Wheel heat   | Acquired | Scrolls | Measured             |
|----------------|----------------|--------------|----------|---------|----------------------|
| Holding        | 0 W            | 0 J          | 0        | 0       | No heat/allocation   |
| Combined drift | 73,915.836 W   | 21,285.754 J | 1        | 2       | 24 active / 96 quiet |
| Turning drift  | 33,272.613 W   | 3,852.632 J  | 1        | 0       | Heading +1.550 rad   |
| Airborne       | 0 W            | 0 J          | 0        | 0       | No friction smoke    |
| Ignition test  | 46,375.672 W   | 8,061.451 J  | 1        | 3       | Consumes rubber      |

The ignition fixture deliberately uses 100 J/K tread capacity, 315 K ignition, 310 K extinction and 0.2 s exposure.
These are **test overrides**, not runtime compound calibration. Non-ignition fixtures use the runtime thresholds
and do not ignite. Gas cooling during inflation/expansion is physically distinct from tread sliding heat.

The actual Drive callback delivers **239 resident host snapshots** in the live-publication test. Pause, one-step
advance, fresh-car reset and retirement pass. Existing Drive dynamics/contact/possession regressions pass, and the
moving slope/brake matrix remains **14/14 PASS** with its original contact/convergence gates.

## Visual evidence

```bash
python3 Tools/Tests/RunDriveSmokeExhibit.py --input _AgentScratch/tmp/SmokeSequence/Native
```

The report is `Exhibits/Gallery/ProjectDrive/tyre-smoke.html`. Five videos start paused and allow exclusive playback.
They are fixed-world density projections from the actual recorded native volume samples, not generated imagery,
not interpolated motion and not screenshots of an integrated GPU renderer. The car rectangle is a pose guide.
Per-wheel conditions and compressed scalar traces accompany the clips. Source/capture/media hashes are published.
Large raw voxel captures, build products and disposable images remain under `_AgentScratch`.

## Deliberately unfinished

- Fine-resolution GPU transport/residency, upload and opaque-depth-aware shared viewport composition.
- Final smoke/fire lighting and tyre-scale visual detail; current captures are transport diagnostics.
- Calibrated compound heat capacities, transfer rates, pressure/grip response and ignition thresholds.
- Calibrated emission onset/hysteresis, visual resource budgets and separate stage timings.
- Sliding material wear, leaks/rupture and full fluid combustion chemistry.
- SDF tyre deformation, explicitly deferred by the user.

The thermal residual is **thermal-only**. The updated instantaneous XPBD gas potential is not a conserved
whole-vehicle energy when heat changes its temperature ratio. This work does not close or hide the previously
reported hard-landing energy/contact-accounting failures.
