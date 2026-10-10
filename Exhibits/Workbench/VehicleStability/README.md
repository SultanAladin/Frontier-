# Vehicle stability proof: curb strike, spin, and energy audit

Headless run of the real `VehicleSolver` (soft XPBD tyres, Pacejka slip, drivetrain, struts, anti-roll bars) with the
production geometry from `ApplyGeometry(config, VehicleGeometry{})`. The chassis is a **mock rigid box** with the same
integrator as `VehicleDrivingChecks.cpp`, not Jolt. These results prove the tyre and solver layers only.

## Files
- `VehicleStabilityProof.cpp` — harness (`./vstab out full` and `./vstab out sweep`).
- `build_vehicle_proofs.py` — builds charts, GIFs and `out/vehicle_summary_table.md` from the CSVs (matplotlib + Pillow).
- `out/*.csv` — per-frame data at 240 Hz: pose, speed, the energy split, wheel contacts, loads, and solver residuals.
- `out/chart_curb_energy.png`, `out/chart_curb_roll_pitch_lift.png`, `out/chart_sweep_convergence.png`, `out/chart_spin_energy_bound.png`.
- `out/curb_strike_15ms_0deg.gif` (side view x–z and rear view y–z), `out/spin_arena_12ms.gif` (arena top view).
- `out/run_full.log` — console output of the full run.

## Engine change (read-only)
`XPBDSoftTyre` gained two const accessors, `StoredEdgeEnergy()` and `NodeKineticEnergy()`, so the audit can read the
carcass energy. The solver's behaviour is unchanged.

## Results

**Stability and rollover (curb, 0.12 m high, 0.10 m wide; 5–20 m/s; 0° and 20° to the curb):** no run tipped
(max |roll| 2.8°, max |pitch| 2.8°), none pinned (speed never fell below 20 % of entry), none diverged, all values finite.
Wheels briefly lost contact during the strike (50–136 frames of 961, including bounce).

**Spin in the arena:**
- Power oversteer, 12 m/s rolling start, throttle 1.0 for 4 s with steer: max yaw rate 129 °/s, max speed 16.1 m/s.
  E_total never exceeds E(0) + P_peak·t, where P_peak = 393 kW from the torque curve. The bound is not exceeded.
- Coasting spin, no driver input (kick to 57 °/s at 12 m/s, and 86 °/s at 20 m/s): energy only falls at 4 and 16 sweeps.
  At the default 1 sweep, a spike of +3.4 kJ (12 m/s) and +1.9 kJ (20 m/s) appears in the first 20 ms, from the tyres.

**Artificial energy from the tyres (the key finding):**
Coasting over the curb with no throttle or brake, E_total rises above its starting value by 15–75 kJ at the default
1 sweep (max rises: 5 m/s +27 kJ, 10 m/s +42 kJ, 15 m/s +75 kJ, 20 m/s +66 kJ on 0°; 20° runs +15 to +40 kJ).
The rise appears as spikes in tyre spring energy, while chassis kinetic energy hardly changes. The chassis rises only
about 2 cm, so the energy has no physical source here.

Sweep study (same curb, 10 m/s, 0°, only `SolverIterations` changed):

| XPBD sweeps per substep | max(E−E0) [J] |
|---|---|
| 1 (solver default) | +41,614 |
| 4 | +8,287 |
| 16 | +947 |

The coasting spin shows the same pattern: +3,383 J at 1 sweep, 0 J at 4 and 0 J at 16. The spike shrinks as the
solver converges, which points to a convergence artefact of the one-sweep schedule. The solver's own residual
telemetry agrees: the constraint residual rises to about 60–86 mm in the curb strike and about 8–13 mm in the spin
kick, while contact penetration stays near 0.1 mm. The solver's comment already notes that one sweep leaves the
ground reaction short of convergence. The energy evidence says this shortfall is not only a force error but also
creates energy.

**What is not in the audit:** gas-pressure (PV) work inside the carcass (gas volume is private), and the ground's
contact work beyond the nodes' own energy. Energy for the engine uses the crank-power bound, not a measured engine
work. The bound on the power run is conservative but not exact.

## Harness fixes made during the work (kept for honesty)
1. Setting the chassis velocity directly left the wheels unrolled. The tyres locked and braked the car by about 4 m/s
   before the curb. The runs now start with a rolling start under throttle (`RollUp`).
2. The energy baseline is taken at the start of each recorded window, not at settle.

## Not done
- `VehicleSceneValidation.cpp` still fails to compile (the `WheelMount` initializers predate `SuspensionMount`). It is not
  used by this exhibit.
- The GPU has not been run here. Everything above is CPU-only.
- Mesh SDF GI render and ReSTIR BVH check are not covered by this exhibit.
