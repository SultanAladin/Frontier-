# IlluminationHost — vehicle/HMI prototype · distance-field GI · ReSTIR GI (WebGPU)

This is the browser/WebGPU vehicle and HMI prototype to iterate on before a future native C++ port; it is intentionally
kept under `Experimental/` and is not yet wired into the C++ runtime.

A self-contained WebGPU exhibit inside the **Frontier Editor** UI: one scene distance field (four camera-centred
toroidal cascades), a surface cache of oriented cards with multi-bounce radiosity, a ReSTIR GI final gather traced
through that field, SVGF reconstruction, glossy reflections — and the Project-Drive ControlVehicle (a port of its
struts, MF6.1 tyres and GT-R powertrain) on the **Frontier proving grounds** and its **training arena** (timed
drills, 136 knockable cones), with GPU drift smoke and tyre fire, burnouts that lay sharp-edged rubber, breakable
props whose debris are convex rigid bodies in the distance field, and a derez / rez effect for every respawn.

**Provenance.** Imported verbatim from `SultanAladin/Slate`, branch `arena/c6cba543-slate`, commit
`e7c4ea47` ("Add WebGPU distance-field GI exhibit: one scene distance field, surface cards, ReSTIR GI,
ControlVehicle"). The later screen-trace commit `194ce3aa` is deliberately not included. Everything after the
import in this folder was developed here. The editor look comes from `Experimental/FrontierEditor` (tokens in
`Docs/FrontierEditorComponents.md`); the fracture algorithm and its material table from `Experimental/FractureEditor`
(Frontier-, `arena/215a6f39-frontier`); the derez presets from `Experimental/ParticleEditor` (same branch); tyre heat
and failure from Frontier's `Engine/VolumetricDynamics`. The current Slate cabin/HMI, GPU plume solver and tyre-source
pattern are integrated from commit `3c987f33c71c2477bd73ca29c69d5bd0ee484d1a`.

The former patch is reconstructed here as ordinary source files; no `.patch` file is needed to run the prototype.
The three `Archive/*.facet` streams are reproducible with `Archive/FacetArchiveCodec.py` from the authored vehicle INL
archives (the script validates wheel/rim topology before writing them). The local DM Sans TTF assets are bundled under
`Style/Fonts/` with the OFL notice.

## Running

Any static file server works; WebGPU needs a current Chrome or Edge (Safari 26+, Firefox with WebGPU enabled).

```sh
cd Experimental/IlluminationHost
npm --prefix Tools ci       # installs the exact Jolt browser bundle; also required for headless validation
python3 -m http.server 8080 --bind 0.0.0.0
# open http://localhost:8080/
```

## The editor

The page is laid out like the native Frontier editor — **Outliner · Viewport · Inspector** columns with tab
headers and a status bar — in the browser editor's styling (DM Sans, the card/metric/slider/switch vocabulary,
lucide glyphs; `Style/FrontierEditor.css`, `Source/EditorShell.js`, `Source/EditorControls.js`). The outliner
groups the scene; selecting an entry rebuilds the inspector (`Source/InspectorPages.js`):

| Outliner entry | Inspector |
| --- | --- |
| **Render settings** | resolution & quality grade, trace resolution, render scale; ReSTIR temporal/spatial reuse, visibility validation, M limit, indirect intensity; exposure, shadows, reflections, SVGF, TAA; debug views; frame timing and GPU pass timings |
| Global distance field · Surface cache | cascade state and freezing, slice inset; card radiosity and relighting budget |
| Sun & sky | presets (Noon · Golden · Dusk · Night), sun direction, solar / sky / emitter intensity |
| ControlVehicle · Tyre marks | telemetry, **burnout / line lock**, **tyres** (pressures per axle, soft carcass and its **Deformation ×** exaggeration, wear, failure, puncture / blowout / shred buttons, deflection · patch · tread readouts), ignition, thermal grip, **camera rigs**; rubber deposit |
| **Cabin · HMI** | Slate steering wheel, dashboard, binnacle cluster, tablet and interior; live HMI apps and **Garage** body/rim material application, **Solid / Ghost / Wire** preview, HMI-only display scaling, see-through glass, mirrors and interior cameras |
| **Smoke & fire** | Slate GPU plume transport and depth-aware rendering; tyre slip/temperature sources, soot and fire, four quality grades, wind/optics controls and a test emitter |
| **Derez · VFX** | the Particle Editor's Derez cube · Reverse derez · Glitch dissolve presets, cube timing and motion, **the car's own colours or the palette**, face glow, **momentum**, recovery triggers, test buttons |
| **Fracture** · each breakable prop | debris (rigid bodies, distance-field admission, respawn); per prop the Fracture editor: Material, Impact, Fragment quality, Bake, Geometry receipt |
| **Training arena** · Cones | the ten drills with Start buttons, last result and best time; arena reset; the cones |
| Proving grounds · Stress test | zone teleports and the scene budget; the stress pool |

Edits apply live. The eye toggles switch an entity off (smoke, fracture, a single prop, tyre marks).

## HMI Garage: live vehicle configurator

Open **Cabin · HMI → Garage** on the tablet (or enter the cockpit and click the tablet). The paint and rim swatches
come from `Experimental/interactive-vehicle-hmi-configurator`: choose a surface and finish, then tap a colour or drag
its swatch onto the car preview. This writes the shared `MaterialRecords` buffer, so the body coat or wheel-hub/rim material changes on the actual ControlVehicle,
in its mirrors, and in the Garage preview. The affected vehicle surface cards are recaptured so indirect lighting
tracks the material edit. Gloss and matte update the roughness/clear-coat response, not just the UI highlight.

The Garage preview also has **Solid**, **Ghost**, and **Wire** modes. Ghost is a translucent cyan scan with edge
highlighting; Wire is an x-ray line view built from the same live vehicle facets and the same steering/tyre vertex
transforms. These modes are intentionally scoped to the Garage's studio preview; the main proving-grounds renderer
remains in its normal physically shaded mode.

## Controls

| Key | Action |
| --- | --- |
| W / S | throttle / brake (S reverses once stopped) |
| **W + S** | burnout — line lock holds the front brakes, the rears spin on the limiter; lift S to launch |
| A / D | steer |
| Space | handbrake |
| R | derez and rez at the running drill's start, or the start grid (the rez brings fresh tyres) |
| **C** / Shift+C | camera rigs: chase → cockpit → passenger → hood → tyre FL → tyre RL |
| T | reset the arena: knocked cones rez back onto their marks, broken props are rebuilt |
| F or F8 | free camera (WASD, Q/E, Shift) |
| drag / wheel | orbit / zoom the chase camera; inside the car drag to look around, click the tablet to use it |
| H · I · P | readout · distance-slice inset · editor columns |
| V | clean view — hides every overlay; V again restores exactly what was open |

## The proving grounds

`Source/LevelStructure.js` declares the level, `Source/CourseStructure.js` its analytic relief (kerbs, the jump ramp),
which the tyres, the fragments and the smoke all read. A 216 × 120 m asphalt pad in a grass surround — the original
120 m square in the west, the training arena in the east:

- **main straight** with red-and-white kerbs, a jump ramp, a start strip, FRONTIER painted on the road and a gravel
  run-off with a tyre wall;
- **skidpad** — a painted 14 m drift ring with cones;
- **burnout box** — a concrete apron with its outline and BURNOUT painted, a tyre wall behind;
- **smash alley** — thirteen breakable props between jersey barriers: wooden crates, an annealed and a tempered
  glass pane in steel frames, octagonal concrete pillars, ABS barriers, a stone wall, a concrete block;
- **hangar** — 28 × 16 × 8 m, open to the south, crimson back wall, a slatted roof that lets sun stripes in and lamp
  strips that light it at night: the bounce-light showcase;
- **container yard**, a **control tower**, a **lit tunnel**, and light poles whose emissive heads light the night
  through the surface cards.

Shapes are authored long-side-on-x and turned into place, tall thin poles, gantry posts and signs are rastered only,
and large structures take coarse volumes and sparse cards, so the occupant distance space stays near 70 MB.

## The training arena

The east wing is Apex Legends' Firing Range for driving (`TrainingDrills` in `Source/LevelStructure.js`,
`Source/TrainingSequence.js`). Every station is live: drive through its start gate (or into its zone) and the drill
starts, the HUD at the top of the viewport runs it, and the result — with a best time kept in the browser — lands
in the HUD and on the Training page. Starting a drill from the page derezzes the car to its start and rezzes the
cones the last run knocked over back onto their marks.

| Station | Drill |
| --- | --- |
| **Launch** | three lanes under green and red gantries: 60 ft and 0–100 splits, the 62 m sprint and trap speed, then stop in the box (22–32 m past the brake line) for the time to count |
| **Slalom** | eight cones 11 m apart, gate to gate, +1 s per displaced cone |
| **Moose test** | the ISO 3888-2 double lane change, coned on both sides: entry speed, clean or failed |
| **Cone bowling** | fifteen pins at the end of a run-up lane, counted 3 s after the foul line |
| **Spin box** | full turns inside an 18 m box without touching a cone or leaving it |
| **Figure-8 drift** · **Skidpad** | angle × speed × time while sliding, chained with a multiplier that grows every 2 s; a cone hit loses the chain |
| **Jump** | airtime and distance past the lip, read off painted 5 m lines |
| **Smash alley** · **Burnout box** | props smashed; seconds of held burnout and the hottest tyre |

Station names are painted on the road and on double-sided signs with lit letters (a 5 × 7 block font covering
A–Z and 0–9).

**Cones** (`Source/ConeSequence.js`): 136 of a new 70 cm cone — a fluorescent PVC body with a rounded tip and two
retroreflective collars on a chamfered rubber base, weighted low (3.2 kg, centre of mass 15 cm up) so it rocks
before it topples. A cone at rest is a *sleeping* rigid body and a static occupant (in the distance field, carded,
relit round-robin), so they cost nothing until the car arrives; a knocked cone follows its body every frame until it
settles. Reset (T, or a drill start) bursts it into cubes where it lies and assembles it on its mark.

## Smoke and fire

Tyre temperatures and ignition remain local to `TyreThermalSolver.js`: tread, carcass and enclosed gas exchange heat
implicitly, with sliding work `|Fx·Vsx| + |Fy·Vsy|` accumulated by the vehicle solver. A tyre ignites only after
sustained overheating (authored 350 °C held 4 s; labelled diagnostic 160 °C held 1 s), then contributes heat, soot,
flame and fire light until it cools.

The transport and source geometry follow Slate commit `3c987f33c71c2477bd73ca29c69d5bd0ee484d1a` (`PlumeSpace.js`,
`PlumeSourceProjection.js`, and `Shader/Plume*.wgsl`), adapted to Frontier's contact readings and thermal state. A
burnout's **surface slip** flings smoke rearward from the patch; a share leaves from behind and above the hub as an
arch puff. A burning tyre has two open-air flame seats, at its outer sidewall and trailing tread, so soot and hot gas
rise instead of pooling under the wheel arch. Burst tyres add short-lived smoke/soot sources. `SourceCapacity` is 24;
slip, spin direction, contact, tread temperature and combustion power come from the live vehicle/thermal solvers.

`PlumeSpace` advances a toroidal GPU volume at up to 60 Hz: a coarse, warm-started pressure solve carries a finer
smoke/heat/flame/soot lattice; the window recentres around the vehicle without copying retained cells. Vorticity
confinement restores curls, wind steers open air, the moving vehicle and scene distance field obstruct flow, and a
periodic detail volume breaks up the cloud edges. The volume march evaluates sun/shadow, sky and fire illumination.
It runs at the trace resolution and is **depth-aware upsampled into the recombined image before TAA**, so a plume
behind the body does not wash over the vehicle silhouette. When the domain is idle, no transport or march pass is
recorded. The independent existing `SparkSequence` still handles tyre-rim and debris sparks after TAA.

Four live quality grades trade window size, cell size, pressure iterations and march samples: Low (64×64×20 at 40 cm),
Medium (96×96×24 at 30 cm), High (128×128×32 at 25 cm) and Ultra (160×160×48 at 20 cm). `?plume=0…3` selects one
at startup. `?inspection=10` isolates the smoke/fire volume. The Smoke & Fire inspector exposes source emission,
density, heat, soot and buoyancy; dissipation, cooling, vorticity, turbulence and wind; extinction, albedo, scattering,
ambient and detail; ignition, flame core/tip/decay and fire light, plus a test smoke/fire source 3 m ahead of the car.

## Burnouts and tyre marks

Holding W and S together at a crawl engages **line lock** (`VehicleSolver.js`): only the front calipers clamp, at
1.6 × the pedal's torque, and a clamped tyre's static-friction margin (about a third above the sliding value) holds
the car; the rears spin against them on the limiter with the gear held. The tyres heat from their real sliding work,
smoke pours off them and — held long enough — they ignite. Lift S and the car launches.

**Rubber** (`Source/TyreMarkDepot.js`): each texel of a 4096 × 2340 deposit over the whole pad (5.5 cm) gains the
sliding work per unit area a tyre does on it (60 kJ/m² is black). A burnout blackens its patch in a moment; a drift
leaves grey arcs that darken pass after pass. A second channel records where across the tread each texel lies; the
surface raster filters it among touched texels only, which puts every mark's edge exactly where the tread's was
(antialiased over one pixel, far sharper than the texels) and cuts the tread's four grooves into it — along the
path, as real marks are. The CPU copy is sparse (64² tiles where rubber has been laid). A road pixel becomes the
rubber family with probability equal to the deposit and TAA resolves that into a smooth blend — no lighting program
needed to change. Wheels riding on debris lay nothing.

## Soft tyres, pressure and failure

`Source/TyreCarcassSolver.js`, `Shader/TyreCarcass.wgsl`, `Source/VehicleSolver.js`, `Source/TyreThermalSolver.js`
— carried on from the GI-Updated-Html-Version branch, where the previous session left it. No XPBD: a cheap physical
model in the dynamics and a deformation in the vertex stage.

* **In the dynamics** each tyre is a spring in series with its strut, K = 25 kN/m (sidewalls) + 0.9 N/m per Pa (the
  air column) — 223 kN/m at 220 kPa, a 14 mm static deflection; 25 kN/m with no air (a single flat sits ~64 mm down,
  the car 14 mm lower on that corner). Each axle's two strut–tyre stacks are solved together with the anti-roll bar
  between them (bisection, three Gauss–Seidel passes): the bar pushes back on each side by k·(own − partner)
  compression — on the right exactly as on the left — so a corner's tyre deflection carries exactly the load it
  bears and a flat corner sinks onto its tyre. A wheel with nothing pushing on it (spring off its seat, tyre not yet
  touching) hangs down to the road or to full droop rather than hovering. Past the pinch the rim flange stiffens the
  stack; a topped-out corner rests on the tyre's own damping. Grip falls with pressure (0.62 + 0.38·(p / 0.75 p₀)^0.7,
  × 0.7 pinched), rolling resistance rises (up to ×4 flat), the rolling radius shrinks with the deflection.
  `node Tools/VehicleStability.mjs` holds the solvers to it without a GPU in a few seconds: rest at 220 and 60 kPa
  and on one, two and four flats (the body still), blowouts on each corner (left and right mirror each other), blowouts
  and shreds at 20–30 m/s and a weave on soft and flat tyres (upright, never airborne), donuts both ways (each
  corner's sliding work mirrors its partner's) and coasting backwards on a bare rim (the AMT's clutch opens when the
  wheels turn against the gear, so engine braking no longer spins them up).
* **What you see** is a 96-node flexible ring on an elastic foundation per wheel (tension and support from the
  pressure, the steel belt's bending), integrated at 3.6 kHz against the road: it flattens into a contact patch,
  shifts sideways under cornering and trails a standing wave past ~210 km/h (~55 km/h flat). The tyre vertices take
  the ring's deflection by their share of the sidewall height — the bead stays on the rim — and the sidewalls bow out
  where the belt is squashed, as an inextensible wall does (√(3·h·w/8), at most the 0.36·h such an arc reaches; a
  quarter of that while the air carries the load). The normal is the deformed surface's own (finite differences
  along the tangent plane), so the patch, the bulge and the squashed sidewall light as they bend. **Deformation ×**
  (Vehicle → Tyres) exaggerates what the road does not fix — roll-in and roll-out, the standing wave, the bulge, the
  sideways shift — and keeps every patch on the road (the dynamics never see it); the **Tyre FL / Tyre RL** camera
  rigs look at the patch. The rim is hard-shaded: each of its facets takes its own flat normal.
* **Pressure** is the gas law of the thermal model — air mass, gas temperature, leaks: set cold pressures per axle,
  or from the HMI's Tyres app. **Failure**: sliding work abrades the 1.1 kg tread (faster when hot); a tyre bursts
  when its tread is worn through, its carcass cooks past 220 °C or hot gas drives it past 650 kPa — a blowout empties
  it in a fraction of a second, with rubber chunks thrown from the wheel and a puff of smoke. A hard pinch cuts the
  carcass (a slow leak); the buttons puncture, blow out or shred any tyre. A flat rolled 150 m sheds its rubber: the
  wheel runs on its rim (radius 0.357 m, a third of the grip) and grinds sparks. The rez brings fresh tyres.

## Sparks and the body's hull

`Source/SparkSequence.js`, `Shader/SparkRaster.wgsl`, `Source/HullStructure.js`. The body no longer meets the road
and the boxes as seventeen 0.32 m spheres: ~700 points ray-cast from its own facets (underside, top, flanks, nose,
tail, mirrors, every crease vertex) are projected out of the course and the obstacle boxes, so the car sits on what
it actually touches — no gaps for a crate to nose between, no resting on air above a kerb. Every point sliding faster
than 2 m/s scrapes, and so does a rim on the road (pinched through a flat, or bare). Each scrape throws sparks at
1500–2100 K: a hull point's leave along the slide, fanned and kicked off the surface; a rim's leave its edge a little
behind the patch, where the metal has just left the road, at that point's own velocity (slip + S(1 − cos α)·F +
|S| sin α·N, S = Spin·r) — up off the trailing edge, streaming back from a rolling wheel, forward along the slide
from a locked one, back off a spinning one. They fall, cool radiatively and skip off the road, drawn after the
antialiasing as thin additive blackbody streaks (2.2 mm, at least a pixel) from where the camera saw them a frame ago
to where it sees them now, depth-tested against the scene.

## The cabin and the HMI

The cabin geometry and projected dashboard/HMI are based on Slate commit
`3c987f33c71c2477bd73ca29c69d5bd0ee484d1a`: `Source/CabinLayout.js`, `Source/CabinProjection.js`,
`Source/HMI/*` and `Shader/CabinRaster.wgsl`. The local integration retains Frontier's live tyre-pressure telemetry, glazing and mirror support facets/passes, Garage preview and pointer routing. The authored vehicle now has
the Slate steering wheel and dashboard, binnacle cluster and centre-stack tablet, with the surrounding cabin interior.

* **HMI** — the local Slate-based HMI app suite draws to its own canvases/textures. The cluster reads live speed, revs,
  gear, temperatures and tyre pressures; Telemetry and Tyres use solver data; the Tyres app can pump the tyres. The
  Garage renders this vehicle into its preview well; its body/rim colour and gloss/matte controls update the actual
  vehicle material records and surface cards, not only the picker. Solid, Ghost and Wire remain available in the studio
  preview. In the cockpit, click the tablet; the display pose and touch region share the same scale.
* **HMI size** changes only the tablet and cluster display surfaces and their touch mapping. The dashboard, wheel,
  seats, cabin geometry, mirrors and seated camera remain at authored size. Use the **Display size** slider or
  `?hmi=0.9` at startup.
* **Glass** remains see-through: glazing is overlaid on what is behind it with Fresnel reflection and transmission; the
  cabin's traced indirect light is attenuated (`Shader/CabinVolume.wgsl`).
* **Mirrors** use a separate, off-axis forward render fitted to each mirror plane; the local glass/mirror overlay remains
  in place around the Slate HMI projection.
* **Cameras**: C cycles chase, cockpit, passenger, hood and two tyre rigs (also in Vehicle → Camera and Cabin · HMI).

## Fracture

Breakable props (`Source/FractureSequence.js`) are closed convex solids with Fracture-editor recipes. The car's hull
is tested against them a frame ahead; the impact energy is ½·μ·vₙ² (μ the reduced mass of car and prop). Below the
material's threshold the prop is a collider and stops the car; above it the prop fractures with
`Source/FractureStructure.js` — the Fracture Editor's material-biased, energy-limited plane partitioning: fragment
area is bought at 2·Gc per square metre (glass 7, concrete 140, wood 320, ABS 460 J/m²), tempered glass adds its
stored stress and dices, wood splits along the grain, panes crack radially, slivers and needles are refused, and
volume is conserved to 1e-7. **Dynamic** mode cuts at the true impact point with the impact's share of energy (a
faster hit buys more pieces; one on-the-spot fracture per frame, ~5–15 ms); **Baked** uses the stored pattern.

Fragments are written into the prop's composite facet set and drawn in **one call per prop** (each vertex names its
fragment occupant) and cast shadows. The car pays the momentum of an inelastic exchange. The debris **stays where it
lands** — the prop is rebuilt by T, *Reassemble*, or (with *Respawn* switched on) after the lifetime.

**Debris physics** (`Source/RigidBodyWorld.js`, shared with the cones) uses `jolt-physics@1.1.0` as the primary rigid-body backend. Before cones or fragments are created, the host initializes Jolt with a non-moving layer and a moving layer; the pair table permits static↔dynamic and dynamic↔dynamic collisions, and the broadphase table maps both layers explicitly. Gravity is set to this simulation's Z-up `(0, 0, −9.81 m/s²)`. Course colliders and active obstacle boxes enter the static layer; each cone and fragment is a dynamic convex hull. This follows Jolt's documented setup rather than relying on default filters.

The vehicle remains in `VehicleSolver.js`; a custom contact bridge exchanges impulses with nearby Jolt bodies in both directions. The preserved `RigidBodyWorld` API (`AddBody`, `RemoveBody`, `PlaceBody`, `Wake`, `Advance`, `QuerySupport`) still serves cones, fracture debris and suspension support. Settled Jolt bodies sleep until touched; the inspector reports the active backend and timing. If WebAssembly initialization fails, the original custom sequential-impulse solver remains the fallback. `?physics=custom` selects that fallback explicitly for comparison.

The contact/support bridge retains the exhibit's behavior:

- **Car against debris, both ways**: the car hull spheres and four wheels exchange contact impulses with nearby bodies — a cone flies, a concrete slab stops the car;
- **Under the car**: strut casts read the highest hull top under each tyre, so the car **drives over** supported debris (steps up to 20 cm; anything taller is an obstacle), while tyre load and traction pin or drag the piece;
- **Fallback solver**: analytic course contacts, static obstacle boxes, convex-hull dynamic pairs, restitution/friction, split positional correction and sleeping are retained for environments where Jolt is unavailable or when `?physics=custom` is requested.

**Fragments in the distance field**: every fragment large enough for the field to resolve (radius ≥ 0.75 of the
finest cascade's voxel) gets a 12³ signed distance volume of its own in a 256-slot pool appended to the occupant
distance space, computed on the device the frame it is born (`Shader/FragmentDistance.wgsl`: inside, the largest face
plane distance; outside, the nearest triangle — both exact for a convex solid). It joins the union's active list
like any occupant, so the debris occludes, shadows and bounces light in the GI the frame the prop breaks. Fragments
own no surface cards; a traced ray that lands on one shades it from its packed albedo, the sun (a short traced
shadow) and the sky (the card-less fallback in `Shader/CardSampling.wgsl`).

The union no longer walks a span of occupants with inactive ones carrying empty bounds: it walks an **active list**
uploaded when activity changes, so sleeping fragment slots and disabled stress slots cost nothing.

## Derez and recovery

`Source/EffectSequence.js`, `Shader/EffectRecords.wgsl`, `Shader/EffectRaster.wgsl`, `Source/RecoveryDirector.js`.
The Particle Editor's derez presets, in the renderer: one **release clock** decides everything. A point of the car
belongs to a cell of a 16³ lattice over its bounds, whose release time is a wave across the bounds plus a hashed
jitter. The surface raster glows a car cell white-hot, then cyan, and drops it the instant its cell is released;
the effect raster launches a cube from every anchor of that cell (1 920 anchors spread over the car's facets) —
drawn into the surface projection, so the cubes are lit, glow and bounce light in the GI. Each cube's whole flight
is closed-form (gravity and linear drag solved exactly, a floor impact found by bisection, eight children that
tumble out and shrink): nothing is simulated or read back, and an emitter is 128 bytes of uniform and one instanced
draw. The car's shadow comes apart with it (a masked shadow program for its runs). Rez runs the clock backwards:
cubes fly in from a shell and each cell appears as its cubes arrive. Cones use a box emitter.

**The car's own colours**: every anchor carries the material family of the facet it was spread on, so the lime coat
comes away as lime cubes, the glass as glass, the tyres as rubber, the lamps as lamps — and the falling blocks and
their shards keep them. Cells about to go, and cubes as they leave, glow in that colour (a G-buffer glow channel the
recombination adds as albedo × glow). The palette look remains a click away. **Momentum**: the car keeps moving while
it comes apart — it coasts under the solver with nobody at the controls — and its pose is sampled at 60 Hz, so each
cube leaves from where the car is when its cell lets go, with the car's velocity (and spin) there.

**Recovery**: an overturned car (1.5 s), a car airborne 2.5 s or tumbling for 0.9 s, or one 35 m outside the grounds
derezzes, vanishes from the raster, the field and the cards, is moved — upright where it lay, or to the last safe
spot on the pad — and rezzes in on fresh tyres, held still until it is complete. R and every teleport use the same
sequence. The VFX page edits the look (presets, timing, burst, speeds, drag, life, size, style, face colours or
palette, glow, momentum) and the triggers.

## URL parameters

| Parameter | Meaning |
| --- | --- |
| `quality=low\|medium\|high` | cascade resolution, card density, traversal length, render scale (default `high`) |
| `scale=0.25…2` | override the render scale |
| `preset=Noon\|Golden\|Dusk\|Night` | lighting preset at start |
| `stress=N` | enable N stress objects at start |
| `stressmotion=0\|1\|2` | stress objects static, one in ten moving, all moving |
| `stresspool=K` | reserve K stress objects at bring-up (default 1536, clamped to the identity ceiling) |
| `plume=0…3` | smoke/fire quality grade at start (Low, Medium, High, Ultra) |
| `testplume=0…2` | diagnostic source: off, steady smoke, or steady fire + soot |
| `hmi=0.65…1.4` | HMI display scale only; cabin geometry and camera remain unchanged |
| `physics=custom` | diagnostic: use the retained custom rigid-body fallback instead of Jolt |
| `inspection=0…10` | start in a debug display; 10 isolates smoke + fire |
| `omit=Union,Cards,Shadow,Direct,Resampling,Diffuse,Reflection,Inspection,Resolve,Present,Plume` | diagnostic: leave stages out |
| `camera=Chase\|Cockpit\|Passenger\|Hood\|Tyre FL\|Tyre RL` | camera rig at start |
| `capture=1` | diagnostic: present through a read-back canvas (headless software adapters) |

## Stress test

The *Stress test* inspector adds 64 / 256 / 1024 objects, fills or clears the pool, and sets their motion. The pool
(crates, pillars, drums, balls; one in eleven emissive) is built with the scene and scattered over the free pad and
the grass beyond, so enabling objects costs no construction: the union pass walks a longer span, the draw runs grow,
the cards join the relighting lists, the vehicle gains colliders and the bricks under the objects are rewritten once.
The layout is seeded, so `?quality=high&stress=1024&stressmotion=1` reproduces the same scene on every machine. The
Frame timing card shows the average frame rate, the **1 % low** over the last 240 frames and per-pass GPU timings
(where `timestamp-query` is available).

## Headless validation

`Tools/HeadlessHarness.mjs` runs the real bring-up and frame loop — editor included — under Node with Dawn (the
`webgpu` package): on the null backend it validates every WGSL module, pipeline layout and command; with a
SwiftShader Vulkan ICD it renders real frames and writes PNG captures. A `HOOKS` module can script input (the
burnout, a run down the smash alley) and report from the host. See the file header for usage.
To exercise an active smoke or fire source as well as shader/pipeline bring-up, run the harness with
`?capture=1&testplume=1` (smoke) or `?capture=1&testplume=2` (fire + soot); `?physics=custom` checks the retained
rigid-body fallback. The default host uses Jolt when WebAssembly initializes successfully and reports the selected
backend in its inspector. `Tools/VehicleStability.mjs` needs nothing installed: it steps the vehicle, thermal and
carcass solvers in the frame loop's order on the open pad and fails on a bouncing body, a left–right asymmetry, a car
leaving the ground or a runaway wheel (see *Soft tyres, pressure and failure*).

## Licences of bundled assets

`Style/Fonts/` — DM Sans, SIL Open Font License 1.1 (`Style/Fonts/OFL.txt`). `Source/EditorIcons.js` — lucide
path data, ISC License (notice in the file).
