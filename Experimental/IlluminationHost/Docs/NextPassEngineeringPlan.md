# IlluminationHost — Next-Pass Engineering Plan

This document details the architecture and implementation plan for the next engineering pass on `Experimental/IlluminationHost`, covering the six physics/rendering/VFX upgrades and the Jolt Physics integration roadmap.

---

## 0. Physics Engine Status: Are We Using Jolt Physics?

* **Native C++ Engine (`Engine/`, `Projects/Project-Drive/`)**: **Yes** — the native C++ codebase builds and links against **Jolt Physics** (configured via `Tools/Build/BuildJolt.sh`).
* **Browser WebGPU Prototype (`Experimental/IlluminationHost/`)**: **Not currently** — the browser exhibit currently runs two pure JavaScript ES-module solvers so it can load with zero WASM/bundler build steps:
  1. `Source/VehicleSolver.js`: A 480 Hz substep 6-DOF rigid-body chassis solver with 4 suspension struts, Pacejka Magic Formula 6.1 combined-slip tyre forces, and ~700 hull contact points (`HullStructure.js`).
  2. `Source/RigidBodyWorld.js`: A 120 Hz sequential-impulse Gauss–Seidel solver with Separating Axis Theorem (SAT) convex-hull collision for Voronoi fracture debris (`FractureSequence.js`) and slalom cones (`ConeSequence.js`).
* **Optional Jolt WASM Upgrade (Next Turn)**: If desired in the browser prototype as well, `jolt-physics` (the official WebAssembly distribution of Jolt) can be wired into `RigidBodyWorld.js` (`Jolt.BodyInterface`, `Jolt.ConvexHullShapeSettings` for Voronoi fragments, `Jolt.StaticCompoundShape` for course obstacles) and `VehicleSolver.js` (`Jolt.VehicleConstraint` / `Jolt.WheeledVehicleController`).

---

## 1. Remove Vertex Tyre Deformation (`TyreCarcassSolver` / `TyreCarcass.wgsl`)

### Problem
The 96-node flexible-ring vertex deformation (`TyreCarcassSolver.js` + `DeformTyre` in `Shader/TyreCarcass.wgsl`) is visually noisy on the tyre mesh topology and requires a per-pixel normal bend guard in `SurfaceRaster.wgsl`.

### Implementation Plan
1. **`Shader/TyreCarcass.wgsl`**:
   * Remove `DeformTyre`, `DeformTyrePosition`, `SampleCarcassDeflection`, `ResolveTyrePoint`, and the 96-node `TyreCarcass` array from `VehicleRecord`.
   * Replace with a lightweight rigid-wheel helper `ProjectWheelVertex(WheelIndex, Position, Normal)`:
     * When a tyre is intact or flat, return the authored rigid tyre/rim vertex and normal unmodified.
     * When a tyre is shredded (`Shredded == 1`), collapse only the outer rubber vertices (`length(Position.xz) > RimRadius`) onto the rim barrel radius so a shredded wheel visibly rides on its bare metal rim.
   * Keep `TurnSteeringWheel`, `PlaceCockpit`, `IsExteriorShellFamily`, `ResolveScanFactor`, and `ResolveRippleBlend`.
2. **`Shader/SurfaceRaster.wgsl`, `Shader/ForwardRaster.wgsl`, `Shader/ShadowRaster.wgsl`**:
   * Remove the soft-tyre normal bend guard in `SurfaceRaster.wgsl` (`if (Varying.Vehicle == 1u && Varying.Family == TyreFamily ...)`).
   * Call `ProjectWheelVertex` in place of `DeformTyre` / `DeformTyrePosition`.
3. **`Source/TyreCarcassSolver.js`, `Source/IlluminationHost.js`, `Source/InspectorPages.js`**:
   * Remove the 3600 Hz 96-node PDE ring integration loop in `TyreCarcassSolver.Advance`, shrinking `VehicleRecord` from `1888 B` to `176 B` (10 header `vec4f`s + 1 `vec4f` of per-wheel shredded flags).
   * Keep the physical tyre pressure & radial spring stiffness $K = K_0 + \kappa \cdot p$ in `VehicleSolver.js` and `TyreThermalSolver.js` so punctures, blowouts, and inflation pressures still affect ride height and handling.
   * Remove the `"Soft tyres"` switch and `"Deformation ×"` slider from `InspectorPages.js`.

---

## 2. Dynamic Emissive Lighting from Sparks and Derez / Rez Cubes

### Problem
Currently, only burning tyres contribute a dynamic point light to the scene (`Frame.FireLightPosition / Intensity / Colour / Reach` evaluated in `Shader/FireIllumination.wgsl`). Rim sparks (`SparkSequence.js`) and Derez/Rez cubes (`EffectSequence.js`) are self-emissive on their own pixels (`SparkRaster.wgsl`, `EffectRaster.wgsl`), but do not cast dynamic light onto the road, nearby obstacles, or the vehicle body.

### Implementation Plan
1. **Clustered Dynamic Emitter Buffer (`EmitterLightRecord`)**:
   * Add a compact 8-light array (`array<EmitterLight, 8>`, 256 bytes total: `PositionAndReach: vec4f`, `Radiance: vec4f`) to `FrameDescriptor.wgsl` (or a dedicated uniform binding shared by `DirectRadiance.wgsl`, `DisplayRecombination.wgsl`, and `CardDirect.wgsl`).
2. **Spark Light Aggregation (`Source/SparkSequence.js`)**:
   * Each frame in `SparkSequence.Advance(Step)`, cluster live sparks into up to 4 spatial centroids (typically grouped by emitting wheel hub or impact cluster).
   * Sum the instantaneous radiant intensity of sparks in each cluster weighted by their blackbody temperature $(T_i / 2200)^4 \cdot \text{Area}_i$, with high-frequency stochastic shimmer (`2.5–3.8 m` reach) so showers of sparks visibly light up the asphalt under the car and adjacent barriers.
3. **Derez / Rez Wavefront & Cube Burst Lights (`Source/EffectSequence.js`)**:
   * While `MaskMode != 0` (vehicle derez or rez) or active cube emitters (`Emitters[0..7]`) are in flight:
     * Emit up to 4 dynamic point lights tracking the advancing Derez/Rez release wavefront plane on the vehicle (`BodyLocal` wavefront transformed to world space) and the centroid of airborne cube bursts (`BurstTyre`, `BurstCone`, vehicle dissolve).
     * Colour each emitter using `DerezPalette.Glow` / `DerezPalette.Hot` (or the vehicle's active `BodyCoat` albedo when `Faces` mode is enabled), scaled by `Effect.Settings.Intensity` (`5.0–8.5 m` reach).
4. **Direct & Surface-Card Evaluation (`Shader/FireIllumination.wgsl`, `Shader/DirectRadiance.wgsl`, `Shader/CardDirect.wgsl`)**:
   * Extend `EvaluateFireLight` in `FireIllumination.wgsl` with `EvaluateDynamicEmitters(Position, Normal, View, Surface)` so both primary screen pixels (`DirectRadiance.wgsl`) and Surface Cards (`CardDirect.wgsl`) receive diffuse + GGX specular illumination from sparks and derez cubes, with distance-field soft shadow raymarching (`TraceFireShadow`) on the primary derez/spark emitters.

---

## 3. Spark Collision Against World Geometry

### Problem
`SparkSequence.Advance` (`Source/SparkSequence.js`, line 151) currently only tests `ResolveCourseHeight(Spark.Position[0], Spark.Position[1])`, so sparks pass straight through walls, concrete barriers, shipping containers, breakable props, cones, and rigid-body debris.

### Implementation Plan
1. **World Collider Feed (`Source/SparkSequence.js` & `Source/IlluminationHost.js`)**:
   * Pass the static obstacle list (`Scene.QueryObstacleBounds()`) and dynamic rigid-body world (`this.Bodies`) into `SparkSequence`.
   * Build a lightweight 2D uniform grid spatial hash (`8 m × 8 m` cells) over the static AABBs/OBBs at bring-up so per-spark obstacle queries are $O(1)$.
2. **Segment–Volume Swept Collision in `SparkSequence.Advance(Step)`**:
   * For each spark substep from $\mathbf{p}_0$ to $\mathbf{p}_1 = \mathbf{p}_0 + \mathbf{v}\,\Delta t$:
     1. Test segment $\mathbf{p}_0 \to \mathbf{p}_1$ against the course heightfield `ResolveCourseHeight(x, y)` (returning ground height and surface normal).
     2. Query the spatial hash cell at $\mathbf{p}_1$ and test against static obstacle AABBs/OBBs (walls, hangar pillars, ramps, containers, intact breakables) and nearby awake rigid bodies (`Bodies`).
     3. On earliest contact at parameter $t \in [0, 1]$ with outward surface normal $\mathbf{n}$:
        * Place the spark at $\mathbf{p}_{\text{hit}} + 0.004\,\mathbf{n}$.
        * Decompose velocity into normal $v_n = \mathbf{v} \cdot \mathbf{n}$ and tangential $\mathbf{v}_t = \mathbf{v} - v_n \mathbf{n}$.
        * Apply restitution $e \in [0.30, 0.58]$ and tangential friction $\mu \approx 0.22$ with roughness scatter around $\mathbf{n}$.
        * Add impact re-heating $\Delta T \in [90, 220]\,\text{K}$ and, when $|v_n| > 5.0\,\text{m/s}$ and the spark has not yet split, spawn 1–2 small secondary child sparks (`Generation = 1`) for realistic sparkler branching on hard concrete/steel impacts.

---

## 4. Realistic Spark Colour Progression

### Problem
Currently, `SparkSequence.js` initializes sparks at `1500..2100 K` and `ResolveSparkRadiance(Kelvin)` clamps `Red = 1.0` while `Blue = 0.0` below `1900 K`. As a result, sparks start saturated yellow (`[1.0, 0.45, 0.0]`) and turn orange, lacking the incandescent white-yellow birth and cherry-red ember tail of real grinding metal sparks.

### Implementation Plan
1. **Physical Oxidation & Cooling Curve (`Source/SparkSequence.js`)**:
   * Real steel/alloy friction sparks undergo exothermic iron-carbon oxidation in air right after detachment, peaking at **2800–3300 K** before radiative ($T^4$) and convective cooling brings them down through **1000 K**.
   * Update initial spark temperature to **2750–3300 K** with a brief exothermic oxidation boost during the first `40 ms` of flight, followed by radiative + convective cooling down to `950 K` (`MinimumTemperature = 950 K`).
2. **True Blackbody Chromaticity Without Premature Red Clamping (`ResolveSparkRadiance`)**:
   * Replace the clamped Helland approximation with a physically normalized Planckian radiator curve mapped across four perceptual regimes:
     * **2800–3300 K (Birth / Exothermic Peak)**: Incandescent **white / straw-white** (`[1.0, 0.94, 0.84]`).
     * **2100–2700 K (Early Flight)**: Brilliant **warm white to golden yellow** (`[1.0, 0.76, 0.34]`).
     * **1500–2000 K (Mid-Flight Cooling)**: Vivid **luminous orange** (`[1.0, 0.38, 0.05]`).
     * **950–1450 K (Dying Ember)**: Deep **cherry red / crimson ember** (`[0.75, 0.06, 0.005]`).
3. **Hot-Core / Coloured-Corona Streak Shader (`Shader/SparkRaster.wgsl`)**:
   * In `SparkFragment`, separate the ribbon profile into an intense white-shifted core (`Core = exp(-Across * Across * 8.5)`) and a wider blackbody-coloured corona (`Corona = exp(-Across * Across * 2.5)`), so high-temperature sparks have a crisp white-hot filament centre inside a golden/orange/crimson glow.

---

## 5. Rim Scrape Marks Instead of Rubber Skid Marks When Tyres Are Shredded

### Problem
`TyreMarkDepot.Advance` (`Source/TyreMarkDepot.js`) currently deposits `CourseMaterial.TyreRubber` (black rubber with 4 tread grooves) whenever `Reading.SlidingPower > PowerFloor`, even when `Reading.Shredded == true` and the wheel is running on its bare metal rim.

### Implementation Plan
1. **New Material Family (`CourseMaterial.RimScrape`)**:
   * Add `CourseMaterial.RimScrape` in `Source/MaterialSpecification.js`: an abraded light-grey/metallic gouge material (`Albedo: [0.26, 0.27, 0.29]`, `Roughness: 0.34`, `Metalness: 0.48`, `SpecularLevel: 0.06`) representing scored asphalt aggregate and deposited aluminium/steel rim metal.
2. **Dual-Mode Deposit Encoding in `Source/TyreMarkDepot.js`**:
   * The `4096 × 2340` `rg8unorm` deposit texture stores deposit density in `.r` (`[0, 1]`) and across-patch encoding in `.g` (`[0, 1]`).
   * Partition channel `.g` into two regimes:
     * **Intact / Flat Rubber Tyre (`!Reading.Shredded`)**: Map across-tread coordinate $u \in [-1, 1]$ into `.g` $\in [0.004, 0.48]$ (existing 4-groove rubber tread).
     * **Shredded Bare Rim (`Reading.Shredded`)**: Stamp along the rim's contact patch width (`2 * RimHalfWidth ≈ 0.306 m`) and map across-rim coordinate $u \in [-1, 1]$ into `.g` $\in [0.52, 1.0]$. Weight deposit rate by rim contact load and sliding speed (`Reading.RimContact`).
3. **Rim Gouge Profile in `Shader/SurfaceRaster.wgsl`**:
   * In `SampleTyreMark(WorldXY, Footprint)` (replacing `SampleTyreRubber`):
     * When `Texel.g <= 0.5`: evaluate the 4-groove rubber tread profile and switch pixel `Family` to `TyreMarkFamily` (`CourseMaterial.TyreRubber`).
     * When `Texel.g > 0.5`: decode across-rim coordinate $u = (\text{Texel.g} - 0.76) / 0.24 \in [-1, 1]$, evaluate a **twin-flange metallic gouge profile** (two sharp parallel score lines at $|u| \approx 0.86$ corresponding to the inner and outer rim flanges plus light centre chatter marks), and switch pixel `Family` to `RimScrapeFamily` (`CourseMaterial.RimScrape`).

---

## 6. Steering Auto-Correct (Self-Aligning Torque & Drift Counter-Steer)

### Problem
`DriverInputIntegrator.js` currently ramps `this.Steer` linearly toward `0.0` at a constant `SteerReturnRate = 5.0 /s` whenever no steering key is pressed, regardless of vehicle speed, front tyre load, or slip angle.

### Implementation Plan
1. **Physics-Driven Self-Aligning Torque (SAT) Model (`Source/DriverInputIntegrator.js` & `Source/VehicleSolver.js`)**:
   * In a real vehicle with positive caster trail $t_m$ and pneumatic trail $t_p$, the front wheels experience a self-aligning torque $M_z = -(t_m + t_p)\,F_{y,\text{front}}$ that rotates the steering rack toward the **front axle's velocity vector** $\mathbf{v}_F = \mathbf{v} + \boldsymbol{\omega} \times \mathbf{r}_F$.
   * Compute the front-axle travel angle in the chassis frame:
     $$\beta_F = \operatorname{atan2}\!\left(v_{\text{lat}} + a \cdot \omega_z,\; \max(|v_{\text{long}}|, 1.2)\right)$$
   * Compute the speed & load authority factor:
     $$A(v, F_z) = \operatorname{smoothstep}(0.4,\, 5.5,\, |\mathbf{v}|) \cdot \operatorname{clamp}\!\left(\frac{F_{z,\text{FL}} + F_{z,\text{FR}}}{2 \cdot F_{z,\text{nom}}},\, 0.0,\, 1.3\right)$$
2. **Behavior Across Driving Regimes**:
   * **Standstill ($|\mathbf{v}| < 0.4\,\text{m/s}$)**: $A \approx 0$ — the steering wheel stays turned where the driver left it (no artificial return-to-centre while parked).
   * **Forward Driving / Corner Exit**: When the driver releases `A`/`D`, the steering smoothly self-centres toward $\delta = 0$ at a rate proportional to rolling speed and front tyre load.
   * **Oversteer / Drift Counter-Steer**: When the rear steps out ($\beta_F \neq 0$), releasing or lightening steering input lets the front wheels automatically **counter-steer into the drift** ($\delta_{\text{target}} = \operatorname{clamp}(-\beta_F / \delta_{\max},\, -1,\, 1)$) to catch the slide, then straighten out as the chassis yaw rate settles.
3. **Inspector Controls (`Source/InspectorPages.js`)**:
   * Add a `"Steering self-align (SAT)"` toggle and `"Self-align authority"` slider (`0.0–2.0×`) to the `ControlVehicle` Handling inspector card.
