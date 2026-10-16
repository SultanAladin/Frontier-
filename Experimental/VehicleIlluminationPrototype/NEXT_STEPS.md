# Vehicle prototype — next iteration

## Current physics (not Jolt)
This browser prototype uses `VehicleSolver.js` (custom strut / tyre / drivetrain integration),
`TyreSlipSolver.js` and `RigidBodyWorld.js` (custom debris bodies). It does not load Jolt.
Keep a Jolt WASM integration as a separate, measured migration: use rigid chassis, world collision,
constraints and debris first; preserve the existing tyre/drivetrain forces until handling parity is tested.
Do not describe the current demo as Jolt-powered. The native C++ integration is a separate phase.

## Ordered work plan (not implemented in this change)
1. **Remove tyre deformation.** Remove the soft-carcass visual deformation and exaggeration controls
   from main, shadow, mirror and Garage passes. Keep pressure, temperature, grip, wear and explicit
   punctured/blown/shredded states. Test that wheel contacts and ride heights remain stable.
2. **Sparks and derez illumination.** Feed bounded emissive spark and derez light proxies into direct
   lighting and GI, not just bright raster sprites. Pool/cap lights, use short lifetimes and verify nearby
   ground/body surfaces actually receive light at night without unstable exposure.
3. **World-geometry spark collisions.** Sweep previous-to-next particle positions against world geometry
   (not merely the ground plane). Resolve contact normals, restitution and friction; prevent tunnelling,
   damp after each bounce and expire settled particles. Cover ramps, walls, containers and moving debris.
4. **Realistic spark colour.** Use temperature-driven radiance: a small hot white/yellow core cools
   through orange/red and fades. Avoid a large uniformly yellow sprite that abruptly switches orange;
   tune physical cooling time, size and exposure together with captured grinding-reference footage.
5. **Rim marks after shredding.** Stop rubber/skid deposits for shredded wheels. Add a distinct narrow
   metal scrape/gouge material/decal path with contact-pressure and slip-dependent density. Spawn sparks
   only at metal contact; preserve ordinary rubber marks for intact tyres. Test mixed wheel states.
6. **Steering assist / auto-countersteer.** Keyboard self-centring already exists in DriverInputIntegrator.
   Add optional bounded, speed-aware countersteering from lateral velocity/yaw error, with a visible
   strength setting, dead zone and smooth blending. Driver input must override it; reverse driving must
   not invert the assist accidentally. Compare disabled/enabled slalom, drift recovery and hands-off tests.
7. **Jolt migration spike.** Pin a maintained Jolt WASM build and its license, load it locally, define
   metre/axis/timestep conventions, use fixed-step simulation with interpolated rendering, implement
   chassis/ground collision and debris contacts, then benchmark and regression-test before replacing solvers.

## Acceptance checks
Run `Tools/VehicleStability.mjs`, Dawn shader/pipeline validation and browser visual checks after each
step. Include intact, flat and shredded tyres, burnout, reverse, wall/ramp impacts and night lighting.
