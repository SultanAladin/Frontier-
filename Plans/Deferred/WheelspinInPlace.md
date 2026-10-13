# Wheelspin in place (stationary burnout) — deferred

Deferred 2026-10-13, at the user's direction, after the driving vehicle was judged
complete and the programme moved on to the interior / HMI work.

**What it is:** the car held stationary (brakes / line-lock) while the driven
wheels spin against the ground — a standing burnout. Heat builds in the driven
tyres, smoke starts from the contact patch, the car itself does not creep.

## Why this is safe to defer

Every load-bearing piece already exists on `arena/215a6f39-frontier`; what is
missing is a *mode* plus tuning plus validation, not new physics:

- `VehicleSolver` runs `DrivingScheme::PacejkaDrivetrain`: engine → clutch →
  gearbox → diff → wheel-spin → Pacejka slip forces. Wheel spin state is real,
  not animated.
- `BrakingSystem` / `MaxBrakeTorquePerWheel` / `HandbrakeTorque` can hold the
  chassis while tractive torque exceeds driven-axle grip — the exact force
  balance a burnout is.
- `ThermalIntegrator` already couples per-wheel tyre thermals (`7fa53e5`), and
  `VehicleInstanceSequence` owns the on-demand world-space smoke domain
  (`DriftSmokeEnabled`, `7fa53e5` / `d13ab5a` / `d563c44`).
- `DriverInputIntegrator` is the documented extension point for new input modes
  (keyboard / gamepad / wheel already; burnout is throttle + hold, i.e. another
  mapping, not another device).

Nothing in the interior/HMI work assumes burnouts exist, and nothing in the
driving work blocks them: the tyre thermal → smoke path is shared with drifting,
which already works.

## What is known to need work

Recorded now so it is not redesigned from zero later.

| Area | What is missing or unknown |
|---|---|
| Input mode | No burnout/line-lock mapping in `DriverInputIntegrator`. Open: dedicated key/combo (e.g. hold brake + throttle = line-lock fronts, spin rears) vs an explicit HMI/drive-mode toggle. The HMI drive-mode page (see `Docs/CarHmiReport.md`) should own the toggle once it exists. |
| Hold balance | Front-brake torque must exceed tractive torque at the held axle while rears break loose. `HandbrakeTorque` (4200 N·m, rear) is the wrong axle for a RWD burnout — this needs a front-hold path (line-lock), not the handbrake. |
| Clutch/drivetrain | Standing start with spinning rears exercises clutch slip + AMT logic (`UpshiftRPM`/`DownshiftRPM`/cooldown) in a regime the driving validation never visits. Expect the auto-shift to need a burnout inhibit (hold gear). |
| Thermals | `TyreConditionsEnabled` / `TyreIgnitionEnabled` fixtures cover rolling cases. Stationary spin dumps heat into one patch spot with no rolling cooldown — the ignition/sustained-overheat path needs a stationary case or it will either never smoke or ignite instantly. |
| Smoke source | Drift smoke emits from a moving contact patch. A stationary patch needs a continuous source at fixed world position with correct accumulation/buoyancy, not a trail. `GasEmission` batching (`CompletedEmissions`, 384) must be checked against a long hold. |
| Ground | XPBD nodes contact the heightfield directly (no raycast). Prolonged slip in one spot must not dig/ring the contact solver or overheat the friction iteration count. Needs a timed soak, not just a snapshot. |
| Validation | No `CheckDrive*` covers stationary wheelspin. Minimum: hold-position bound (car does not creep past X m over T s), spin-rate vs throttle curve, patch temperature vs time, smoke onset time, and a no-NA/no-explosion soak at 240 Hz substeps. |

## What must not change without revisiting

1. **No arcade flag.** Wheelspin must fall out of Pacejka slip vs brake torque,
   not out of a `DoBurnout=true` that scales forces. A scripted mode would
   disagree with the thermal/smoke coupling about what the tyre is doing.
2. **The 240 Hz substep budget is shared.** Any extra iteration (contact,
   thermal) is charged to the same frame the driving validation measured.
3. **Smoke stays on-demand.** A burnout must not create a second smoke domain or
   a second emission path — it drives the existing `DriftSmokeEnabled` domain
   from a stationary source.

## Resuming

1. Add the line-lock/hold mapping to `DriverInputIntegrator` (behind the HMI
   drive-mode toggle if the HMI exists by then).
2. Add AMT burnout inhibit (hold gear while active).
3. Tune front-hold torque vs rear tractive torque until the hold-position bound
   passes.
4. Add the stationary thermal case + continuous-source smoke check.
5. Add `Tools/Tests/CheckDriveBurnout.py` + exhibit, following the
   `CheckDriveSmoke` / `RunDriveSmokeExhibit` pattern.
