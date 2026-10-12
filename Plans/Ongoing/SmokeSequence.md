# Tyre heat, pressure and world-space drifting smoke

Started: 2026-10-12. Standing: ongoing. Approved in chat by the user; implementation begins on
`arena/215a6f39-frontier` from `9b4c615`.

## Scope

Connect per-wheel thermal conditions, pressure, grip and smoke to the existing native vehicle and gas facilities.
One vehicle owns one logical smoke domain with up to four wheel injection locations. Storage is acquired on
emission demand, not at vehicle spawn. Existing smoke stays in world space while the vehicle translates and turns.
Occasional tyre fire follows sustained overheating and available combustible material, not a random timer.

SDF tyre deformation is deferred. Existing XPBD carcass deformation remains active. Preserve the current brake,
rotor/contact solve and shared host/project ownership. Do not add a project window or a replacement renderer.

## Inspected starting point

- Pacejka evaluates slip, load and camber; tyre temperature and pressure are not connected to force evaluation.
- Brake disc temperature/fade is separate and optional. It must not be relabelled as tyre temperature.
- XPBD measures enclosed volume and applies isothermal inflation pressure; heat is not part of that gas law.
- Tyre authoring and solver defaults differ in pressure and units. Preserve selected authoring; no silent retune.
- Gas emitters, coarse transport, obstruction, ray integration and residency exist, but live Drive smoke is unconnected.
- Existing burnout activation considers longitudinal slip only. A lateral drift needs combined sliding dissipation.
- Changing the coarse field origin alone drags its contents. Resetting that field destroys the trail.

## A. Per-wheel conditions and telemetry

Retain surface, carcass and internal-gas temperatures; gas quantity and reference conditions; combustible material;
wear/overheat exposure and ignition condition. Physical conditions continue to advance when visual storage is absent.
Internal units are kelvin, pascals, cubic metres, joules and seconds. Show Celsius and gauge pressure in readouts.
Selected cold gauge pressure and tyre specification supply initial conditions independently for each wheel.

Shared Pacejka coefficients stay immutable. Apply per-wheel conditions without changing another wheel's coefficients.
Nominal/disabled conditions reproduce existing force and pressure behaviour. Reset and respawn reinitialise conditions.

## B. Heat, pressure and mechanical coupling

Existing fixed-step order:

```text
Previous wheel condition
  -> XPBD pressure/contact/deformation
  -> measured load, contact geometry and slip velocities
  -> powered Pacejka or coupled coast/brake response
  -> final applied sliding dissipation
  -> thermal transfer, wear and gas-temperature advancement
  -> world-space smoke/fire injections
```

Partition actual sliding losses between tyre and road. Include longitudinal, lateral and spin losses consistently.
Do not heat from static support forces, normal impact impulses or stored elastic energy. Brake work heats discs;
brake-to-rim/carcass transfer must be separately declared. Instrument rolling/carcass losses before reusing them as
heat.

Start with explicit fixed-step thermal coupling. Surface/carcass/gas heat capacities and transfer coefficients are
calibrated inputs. Ground contact and relative airspeed affect cooling. Surface heat must not instantly heat the gas.

Extend pressure to `p_absolute = n * R * T_gas / V_XPBD`, then subtract ambient pressure. Evaluate against current
substep volume without rebuilding particles. Preserve the nominal isothermal route when thermal coupling is disabled.
Update thermal/gas diagnostic accounting; an old isothermal potential does not prove conservation with heat exchange.
No claim that this closes the existing whole-vehicle hard-landing energy account.

Use the same per-wheel condition in powered response and passive friction capacity. Avoid double normal stiffness,
double lateral traction, artificial radius/velocity clamps and extra stabilising damping.

## C. Content-preserving world-space transport

Acquire one domain when any wheel requests smoke or fire. Use a world-axis-aligned extent independent of car rotation.
Guard bands trigger translation in whole-cell increments. Retained density, temperature and world velocities are
reindexed unchanged. Clear newly exposed cells; refresh affected obstruction. Keep advance numbering continuous.

Fixed cell size/span during a live domain is the first delivery. Resizing or quality changes require explicit remapping.
Finite extents have a stated retention distance/lifetime; no unlimited-trail claim. Sparse tiles inside one logical
vehicle domain are a later optimisation if a long dense extent cannot resolve tyre-sized sources affordably.

Stopping injection does not stop transport. Keep the domain while visible smoke/fire remains, then return its storage.
Rapid drift stop/start reuses the live domain. No field reset on ordinary vehicle movement or steering.

## D. Live Drive emission and presentation

Resolve four wheel contact sources into the same domain. Use actual world travel and combined sliding dissipation,
load, temperature and material condition. Smooth onset/hysteresis prevents flicker. Rolling wheels do not smoke;
airborne wheels do not generate friction smoke. Sweep fast-moving source paths rather than leave separated puffs.

Publish through the shared host seam without retaining retired DLL pointers. Presentation must respect opaque depth
and world placement. Reuse existing volume integration and lighting, with honest CPU/GPU execution descriptions.
On-demand acquisition/refusal and visibility/lifetime decisions are explicit; never silently reset/drop a live effect.

## E. Occasional fire

Ignition follows authored temperature/exposure conditions and remaining rubber. Normal driving and short drifts do not
ignite tyres. Burning consumes material, generates heat and smoke and can persist after stopping or becoming airborne.
Fresh emissions follow the current tyre; old hot smoke does not. Extinguishing/burnout releases emission demand while
remaining volume contents fade. Initial tyre-side fuel/heat accounting does not require full fluid combustion chemistry.
Calibrate ignition, heat release and cooling; diagnostic overrides are labelled, never substituted for runtime triggers.

## F. Quality and resource tuning

Physical thermal conditions are independent of visual quality, display rate and camera visibility. Reuse the existing
fixed-rate gas allowances. Charge actual acquired storage and preserve visible contents across any later quality change.
Measure domain acquisition, transport, scrolling, obstruction, upload and rendering separately. Keep large captures,
full voxel recordings, third-party installs and temporary build products in `_AgentScratch`.

## Acceptance gates

- Rolling/holding does not produce false sliding heat; drift and burnout heat the affected wheel.
- Pressure follows current volume and gas temperature, and one hot wheel does not change its neighbours.
- Disabled/nominal behaviour retains existing brake/contact regression expectations.
- Translating/turning the vehicle never rotates or drags previously emitted smoke.
- Integer shifts preserve all overlapping scalar and velocity samples at their original world locations.
- No emission demand means no expensive domain allocation; stop/start preserves a live plume.
- Lateral drift emits; friction smoke stops in the air; lingering smoke still transports and dissipates.
- Normal driving does not ignite; sustained-overheat fixtures can ignite and consume fuel.
- Pause/reset/respawn/DLL retirement do not leak domains or retain stale borrowed resources.
- Native evidence and individually pausable captures show a straight drift, a turn, scrolling, fading and ignition.
- MSVC and shared source-roster routes accompany any new compiled source; no g++-only build addition.

## Implementation standing

- A: implemented for temperatures, gas quantity, wheel-local grip, exposure/fuel and reset/respawn telemetry.
  Sliding material wear remains deferred.
- B: native heat/pressure/grip coupling implemented and checked. Thermal balance is independent of the unresolved
  whole-vehicle landing account. Compound calibration remains open.
- C: native on-demand ownership, exact integer relocation, obstruction refresh, lingering/fading and release
implemented.
- D: actual Drive wheel emission, fixed-rate source-path samples and transactional C/host-owned publication implemented.
  Fine-grid GPU residency and opaque-depth-aware shared viewport composition are not implemented.
- E: sustained-overheat/fuel ignition and hot-source emission implemented; diagnostic overrides are labelled.
  Runtime compound calibration and finished flame appearance remain open.
- F: coarse/native resource acquisition implemented; visual quality ladders, GPU budgets and separate-stage timing
remain open.

First milestone delivered: native per-wheel conditions and on-demand content-preserving drift transport with proof.
See `VisualProof/SmokeSequence/README.md` and `Exhibits/Gallery/ProjectDrive/tyre-smoke.html` for the execution
boundary.

Native checks: thermal/pressure/relocation/lifetime/refusal assertions; five vehicle fixtures; actual Drive C copying,
pause, step, reset and retirement; existing dynamics checks; moving brake matrix 14/14 PASS. Visual diagnostics use
recorded native density projections, not an integrated GPU appearance claim. Production additions are header-only
or in existing authoritative-roster compilation units; the new proof runner provides MSVC `/MD` and GCC routes.
