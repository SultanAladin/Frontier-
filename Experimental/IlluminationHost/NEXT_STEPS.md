# Vehicle prototype — next-step plan

These items are planned, not implemented in this pass. The current work is limited to reconstructing the WebGPU prototype and wiring the cabin Garage material/view controls to the live vehicle.

## 1. Remove the tyre-deformation visual

- Remove the exaggerated carcass-deformation display and its `Deformation ×` UI control; keep pressure, tyre compliance, grip, wear, puncture and failure behavior separate until each is validated.
- Confirm the tyres remain correctly planted in the stability runs at normal pressure, low pressure, on a flat and on a shredded rim.
- Remove the visual-only deformation record/shader path only after the vehicle and camera tests pass without it.

**Acceptance:** no visibly warped tyre geometry, no change to the intended pressure/grip physics, and no regression in the vehicle stability checks.

## 2. Improve sparks and debris response

- Give sparks a convincing hot-to-cool temperature curve: white/yellow at the hottest point, then amber/orange/red as they cool, fading into dark. Calibrate in linear light so exposure does not turn every spark into the same yellow/orange pixel.
- Make sparks collide with world geometry (the distance field or a small collision representation) and bounce/slide or extinguish on impact rather than passing through it.
- Add a restrained emissive contribution around active sparks. Start with a small local glow/point-light approximation and measure its cost before adding many dynamic lights.
- Keep spark particles and debris as distinct systems; debris remains rigid-body geometry, while sparks are short-lived particles.

**Acceptance:** sparks hit walls/ground, their colour changes monotonically with temperature/lifetime, and nearby surfaces receive a visible but bounded glow.

## 3. Use rim marks after a tyre shreds

- Stop depositing rubber skid marks for a wheel whose tread is gone and whose rim is contacting the road.
- Add a separate narrow, metallic rim-scrape mark driven by rim contact, wheel load and relative speed; do not emit it while the intact tyre is carrying the load.
- Add a regression check that a shredded tyre leaves rim marks but no new rubber tread marks.

**Acceptance:** intact tyres lay rubber; shredded tyres running on the rim lay scrape marks only; airborne wheels lay neither.

## 4. Add steering assistance / self-correction

The likely feature name depends on the desired behavior: **self-centering steering** returns the wheel toward centre when input is released; **countersteer assist** adds a small corrective input during oversteer. Implement them as separate, opt-in assists rather than changing raw steering.

- First add self-centering with speed-sensitive caster-like return and damping when the driver releases A/D.
- If countersteer is desired, add it as a separate bounded assist based on yaw/slip error, with an adjustable strength and a clear off switch.
- Test left/right symmetry, straight-line release, slalom, donuts, and recovery from a high-slip state; never override a deliberate driver input.

**Acceptance:** the selected assist recentres smoothly, does not oscillate or steer against sustained driver input, and is independently toggleable.

## 5. Physics backend decision (Jolt)

- The browser `IlluminationHost` prototype currently uses its own JavaScript `VehicleSolver` and `RigidBodyWorld`; it does **not** use Jolt.
- The native C++ engine already contains a Jolt-backed generic `RigidBodySolver`, but the browser vehicle model is not connected to that native service.
- Before porting, decide whether Jolt should own only props/cones/debris, or whether the vehicle suspension/tyres should also become a Jolt vehicle integration. Then define the C++ adapter, unit/frame conventions, fixed timestep and replay/stability tests.

**Acceptance:** document the chosen ownership boundary and compare deterministic fixed-step vehicle/prop tests before replacing any solver.
