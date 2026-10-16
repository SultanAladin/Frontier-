# IlluminationHost — distance-field GI exhibit (WebGPU)

A self-contained WebGPU application inside a Frontier editor workspace: one camera-centred scene distance field (four
toroidal cascades), Lumen-style surface cards with radiosity, a ReSTIR GI final gather, SVGF, glossy reflections,
cascaded shadows, sky, TAA and eye adaptation — around the Project-Drive ControlVehicle in a drift yard with tyre
smoke and fire on a cell lattice, line-lock burnouts, tyre wear, rubber on the asphalt and props that fracture.

## Provenance

| Item            | Value                                                                                       |
|-----------------|---------------------------------------------------------------------------------------------|
| Source          | `SultanAladin/Slate`, `Exhibits/IlluminationHost`                                           |
| Branch · commit | `arena/c6cba543-slate` · `e7c4ea47b9a8880f476f31b79863d7b8b2dcaff6`                         |
| Excluded        | `194ce3a` (screen traces), the later commit on that branch                                  |
| Import          | the first Frontier commit adding this folder is byte-identical to `e7c4ea4`                 |
| Editor UI       | `Experimental/ProjectZeroEditor`, `Experimental/FractureEditor` (`arena/215a6f39-frontier`) |
| Gas reference   | `Experimental/Fluid` (burnout sample) and `Engine/VolumetricDynamics/`, same branch         |

The vehicle archives in `Archive/` were encoded by `Archive/FacetArchiveCodec.py` from Frontier's
`Projects/Project-Drive` sources, which live on the Project-Drive branches of `SultanAladin/Frontier-` rather than
on this one.

## Running

```sh
node Experimental/IlluminationHost/ExhibitExchange.mjs --port 8080
```

Open `http://localhost:8080/` in a WebGPU browser (current Chrome or Edge). The exchange serves this folder only,
with `Cache-Control: no-store`, so an edited shader or module is picked up by a reload. The workspace font (DM Sans)
loads from Google Fonts; offline it falls back to the system sans.

| Query parameter         | Effect                                                                         |
|-------------------------|--------------------------------------------------------------------------------|
| `quality=low` … `high`  | GI grade: `low`, `medium`, `balanced`, `high` (default), also in the inspector |
| `plume=0` … `3`         | smoke-and-fire grade: Low, Medium, High, Ultra, also a live slider             |
| `scale=0.5`             | render scale override, 0.25–2                                                  |
| `preset=Golden`         | lighting preset: `Noon`, `Golden`, `Dusk`, `Night`                             |
| `inspection=10`         | start in a display mode (10 shows the smoke-and-fire cells)                    |
| `omit=Resampling,Plume` | diagnostic: leave named stages out of the frame                                |
| `capture=1`             | diagnostic: present through a read-back canvas (headless software adapters)    |

## Controls

| Input        | Action                                                                |
|--------------|-----------------------------------------------------------------------|
| W / S, A / D | throttle, brake (reverse once stopped), steer                         |
| Space        | handbrake                                                             |
| B (hold)     | line lock — front brakes held, rears free: throttle for a burnout     |
| R            | respawn the vehicle at the burnout box                                |
| F8 or F      | free camera (WASD, Q/E, Shift) / chase camera                         |
| H            | bare view: hide both docks and every debug window, or bring them back |
| drag, wheel  | orbit the chase camera, zoom                                          |

## The workspace

The page is the Project-Zero editor's three-dock layout rebuilt without React (`WorkspacePanel.js`,
`WorkspacePanel.css`, `InspectorPanel.js`): the outliner lists the yard, the viewport carries the canvas, the
inspector builds the page of the selection with the editor's own controls — gradient cards, pill sliders with split
value fields, green toggles, segmented buttons, quick tiles, metrics.

| Outliner row         | Inspector page                                                                       |
|----------------------|--------------------------------------------------------------------------------------|
| ControlVehicle       | telemetry, burnout, tyres (heat, tread, grip), ignition, exhaust and rubber          |
| Smoke & fire         | the Frontier gas card stack: domain preview, budget and quality, source, appearance, |
|                      | lighting, forces and turbulence, looks                                               |
| Sun & sky            | presets, sun, sky, emission, exposure                                                |
| Global illumination  | the render settings the editor lacked: grade, ReSTIR, distance field, cards, display |
| Smash zone, barriers | fracture for every breakable; each prop opens its own Fracture card                  |
| Stress test          | +64 / +256 / +1024 occupants, as before                                              |

A breakable's Fracture card has the editor's ↗: the expanded Fracture editor (`FracturePanel.js`) with the object
column, a live preview of the fragments the recipe makes (orbit, separation, wireframe; fragments, occupied volume,
worst triangle quality, closure) and the material, impact and quality cards.

## The drift yard

`YardStructure.js` lays out a 120 m asphalt pad: a burnout box at the spawn, a figure eight, a 40 × 24 m warehouse
with an open door, skylights and strip lights, a two-high wall of ISO containers in trade colours, a barrier
straight, floodlights, kerbs, the ramp on the west run-up and a smash zone. Walls and roofs are 8 m modules, so each
distance volume keeps a 10 cm voxel; volumes are now shelf-packed (37 MB where stacking along z alone needed 109 MB).
The surface raster writes a per-pixel albedo factor for the road — patches, grain, stains, worn paint, and the rubber
from `TyreMarkSpace.js`.

## Smoke and fire

The C++ reference is Frontier's vehicle gas path (Project-Drive branches): `Engine/VolumetricDynamics/`
(`CoarseGasField.h`, `SmokeSequence.h`, `SmokeSpace.h`, `SmokeOnsetClassifier.h`, `GasVehicleIntake.h`),
`Engine/Shaders/SmokeTransport.slang`, `SmokeViewport.slang`, and the tyre heat model
`Engine/PhysicalDynamics/Vehicle/ThermalIntegrator.h`.

- **Ported verbatim:** sliding power as dissipated patch work, the three-capacity tyre heat model, the onset
  hysteresis, the wheel emission rates and the transport constants.
- **Done differently, cheaper:** the whole solve stays on the device; both lattices are toroidal, so the window
  follows the car without relocation copies; pressure sweeps are warm-started; obstruction is one sample of the scene
  distance field; nothing is recorded once the plume has faded; the march runs at trace resolution, clipped to a
  coverage box, reading a per-step transmittance lattice instead of marching toward the sun per sample.
- **Realism:** two particulates — white rubber smoke (albedo ≈ 0.9) and black soot (≈ 0.05) — mixed per sample;
  flames that keep heating their gas and shed soot as they burn; sun light in three scattering octaves weighted by
  the albedo; sky light occluded by the smoke above; burning tyres and exhaust pops as fire lights inside the smoke
  and on the car and road; blackbody flame colour between tip and core temperatures; sub-grid buoyant rise and
  two-octave turbulence scaled by activity; sub-cell detail erosion from a tiling noise volume; embers and sparks
  carried by the lattice (`EmberIntegrator.js`).
- **Sources:** a spinning tyre throws its smoke rearward along the tread and sheds more from the arch; flames burn at
  the outer sidewall and behind the tread, where the lattice is fluid and the column rises.
- **Quality:** Low 64×64×20 @ 40 cm, Medium 96×96×24 @ 30 cm, High 128×128×32 @ 25 cm, Ultra 160×160×48
  @ 20 cm — independent of the GI grade and rebuilt live.

## Burnout and tyres

Line lock holds the front calipers at 3600 N·m and releases the rears; the AMT holds its gear and the engine bounces
off the limiter. With a 49 / 51 front / rear static load the locked fronts cannot quite hold the spinning rears, so
an assist (on by default, in the vehicle page) opposes the creep with a capped planar force.

`TyreThermalIntegrator.js` adds abrasion (tread worn by sliding work, faster when hot, the vapourised share carrying
its pyrolysis heat), tread mass and a burst when it is worn through — the wheel then runs on its bare rim facet set
with rim grip and throws sparks. Ignition now waits for 450 °C (Frontier's specification says 350 °C; tyre rubber's
autoignition is quoted at 400–500 °C) held for Frontier's 4 s, with Frontier's heat gain of 1. Measured with a
constant sliding power per tyre:

| Load                        | Before (gain 2, 1.5 s, 350 °C) | Now                                 |
|-----------------------------|--------------------------------|-------------------------------------|
| 30 kW slide                 | fire after 19 s                | never                               |
| drift, 70 kW on / 10 kW off | fire within a minute           | never; tread gone after ~90 s       |
| line-lock burnout (~110 kW) | fire after ~5 s                | fire after ~20 s, burst after ~32 s |

## Fracture

`FractureStructure.js` ports the Frontier Fracture Editor's energy-limited convex partition (fragment area bought at
2·Gc per m², cut priority by nearness to the impact, eight candidate planes, sliver and size rejection, tempered
glass's stored energy, wood's grain) without three.js. `FragmentDepot.js` breaks a prop when the car's strike carries
more kinetic energy along the contact normal than the prop's break threshold — or from the editor — throws the parts
as rigid bodies of the prop's mass, parks the prop's occupant below the course, rewrites its bricks and draws every
fragment in a single call from one vertex buffer whose records name the fragment's slot (`SurfaceRaster.wgsl`,
`ShadowRaster.wgsl`). Concrete, stone and wood throw dust into the smoke lattice. Fragments are raster and dynamic:
the cascaded shadows carry them, the distance field does not.

## Stress test

Occupants are inserted at the end of the distance span, so no identity already held by the distance field or a
reservoir changes. Rigid bodies fall, settle and sleep; a sleeping body costs nothing per frame. The scatter span is
capped at 1536 objects: occupant identities are stored in an rgba16float channel, which is exact only below 2045.
