# InspectorDepot → native C++ conversion register

Reference UI: `Experimental/ProjectZeroEditor/InspectorDepot` — the vanilla-JS panel kit that carries the
light family. This supersedes `Experimental/FrontierEditor` as the conversion source; that editor is an older
UI and the lighting added to it on 2026-10-07 was reverted the same day.

Panels live in `InspectorDepot/panels/`. Shared controls are `panels/controls.js` (`tape`, `stepper`,
`pillToggle`) and `kit.js` (`el`, `colorChip`). Styling is `styles.css`.

## Light types

`LightSpecification.js` names five, and two panel modules serve them:

| Type         | Label            | Panel module          |
| ------------ | ---------------- | --------------------- |
| `pointlight` | Point light      | `lights.js`           |
| `spotlight`  | Spot light       | `lights.js`           |
| `ieslight`   | IES / automotive | `advancedLights.js`   |
| `arealight`  | Area / softbox   | `advancedLights.js`   |
| `tubelight`  | Tube light       | `advancedLights.js`   |

## `lights.js` — point and spot

Header: *"Point and spot light photometric instruments. Distribution, falloff and aim are the controls."*

| Element                       | Class                    | Content                                                                 |
| ----------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| Photometric hero              | `pcard mp-hero li-hero`  | Canvas 172 px (145 compact). Spot: cone wedge, apex at `0.22w`, dashed inner cone at `angle·(1−penumbra)`. Point: concentric discs r 70→4 step 3, rings at .25/.5/.75/1 with metre labels at .5 and 1. Radial glow r16. Corner text `0° AXIS` / `ISOTROPIC 360°` and `N cd`. |
| Caption                       | `mp-cap`                 | Left `<b>label</b>` + `PHOTOMETRIC DISTRIBUTION`; right `N° cone` or `N m reach` |
| Metric rail                   | `mp-rail` / `mp-pill`    | Intensity · At 1 m · At 10 m · Cone (spot) or Decay (point)             |
| Stat pair                     | `mp-duo` / `mp-stat`     | Exposure at 5 m · Pool at 5 m (spot) or Reach limit (point)             |
| Photometry                    | `pcard mp-metric li-photo` | Head `Photometry` / `Illuminance over distance`; `mp-num` split integer + tenth + `lx`; `At five metres — inverse power law`; log-scale chart 112 px, dashed quartile rules, filled area, white dot at 5 m, x labels 1/5/10/max |
| Output                        | `pcard mp-light li-output` | Head `Output` / `Distribution · attenuation`; tapes Intensity, then Cone angle + Penumbra (spot) or Reach + Decay exponent (point); `emission colour` chip; pills `CAST SHADOWS`, `DRAW CONE`/`SHOW GLOW` |
| Placement                     | `pcard mp-light li-place`  | Head `Aim`/`Placement` / `World coordinates[ · source to target]`; plan canvas 118 px at ±20 m; `position` X/Y/Z steppers; spot adds `target` X/Y/Z |

Photometry: `luxAt(I, d, decay) = I / max(1, d)^decay`. Spot pool at 5 m is `2·5·tan(angle/2)`.
Hero drag writes angle/reach on X and intensity on Y. Plan drag writes position, shift-drag writes target.

## `advancedLights.js` — IES, area and tube

Header: *"Automotive IES, rectangular area and tube emitters — distribution-first lighting controls."*

| Element          | Class                      | Content                                                                 |
| ---------------- | -------------------------- | ----------------------------------------------------------------------- |
| Hero             | `pcard mp-hero al-hero`    | Canvas 174 px. IES: 3.2 px candela raster over the H–V plane with per-profile shaping. Area: radial-gradient rectangle with three floor ellipses. Tube: linear-gradient capsule with 22 px bloom. Right caption `DRAG EMITTER` |
| Metric rail      | `mp-rail` / `mp-pill`      | Flux · Peak cd · Efficacy · Range                                        |
| Distribution     | `pcard mp-metric al-dist`  | Head `IES distribution` / `Candela map · homologation view`, or `Emitter geometry` / `Luminous aperture · projected solid angle`; `mp-num` lm; polar candela fan (IES) or aspect bar; IES adds six profile tag buttons |
| Photometric output | `pcard mp-light al-output` | Head `Photometric output` / `Calibrated source values`; tape Luminous flux; IES: Profile multiplier, Photometric range, Field angle, Cut-off pitch; Area: Width, Height, Beam spread; Tube: Length, Tube radius, Reach; Colour temperature except area; colour chip; pills `CAST SHADOWS`, `DRAW DISTRIBUTION`/`DRAW EMITTER`, plus `TWO SIDED` for area |
| Mounting         | `pcard mp-light al-place`  | Head `Mounting` / `World transform · optical axis`; `position` X/Y/Z; `target` X/Y/Z, or `rotation` X/Y/Z for tube |

Profiles: ECE Low Beam, SAE Low Beam, High Beam, Fog Lamp, Parking Lamp, Custom .IES.
Peak candela: IES `flux · multiplier · 1.8`; area `flux / (width·height) · 0.45`; tube `flux / length · 0.45`.
Efficacy: `min(160, 70 + temperature/100)`.

## Conversion status

| Item                        | Source                                   | Status                                   |
| --------------------------- | ---------------------------------------- | ---------------------------------------- |
| Point and spot light panel  | `panels/lights.js`                       | Converted — `LightInspectorPanel.cpp`    |
| IES / area / tube panel     | `panels/advancedLights.js`               | Converted — `LightInspectorPanel.cpp`    |
| Tape, stepper, state pill   | `panels/controls.js`                     | Converted — `LightDepotSurface.h`        |
| pcard, hero, rail, duo, note | `inspector.js`, `styles.css`            | Converted — `LightDepotSurface.h`        |
| Fog cards                   | `panels/fog.js`                          | Not started                              |
| Transform grid              | `TransformPanel.jsx`                     | Not started                              |

### What the native panel now draws

`Engine/Editor/LightInspectorPanel.cpp` is a rewrite, not an edit: the card set it drew before came from the
wrong editor and none of it survived. It now walks one cursor down the column and emits the same elements the
reference does, in the same order, with the geometry read off `styles.css`:

- the photometric hero at 172 px for point and spot and 174 px for the shaped emitters, with the caption band,
  the cone wedge and its dashed inner cone, the concentric falloff discs and reach rings, the IES candela
  raster, the area aperture with its floor ellipses, and the bloomed tube capsule;
- the four-pill rail, the two stat tiles, the log-scale photometry chart with its five-metre marker, the
  polar candela fan and the aspect bar;
- the tape — forty-one ticks, long every tenth, lit up to the value, a triangle marker on a 1.4 px stem, and
  the range written on the strip — with its stepper, and the state pills with their 7 px status dot;
- the axis cells, the colour chip, and the collapsible card heads.

Three things the browser does that needed building rather than borrowing. CSS letter-spacing and
`text-transform` have no ImGui equivalent, so every tracked small-cap label is laid out a glyph at a time,
walking UTF-8 so the reference's degree, middot, multiplication and minus signs survive. ImGui only ships
`ShadeVertsLinearColorGradientKeepAlpha`, which is useless for a wedge that fades from .65 to .03, so the full
RGBA is interpolated across the span by hand. `createRadialGradient` has no counterpart at all, so the hero
glow is laid in as concentric discs through its three stops.

Routing: the engine's six-way Type selector folds onto the reference's five emitters. Point and Spot map
straight across; Rectangle / Area and Tube map to the shaped panel; Strip is a tube run; a Spot whose
`Distribution` names a photometric profile is the IES lamp. Directional has no counterpart in the reference
and reads out through the isotropic branch.

The property set is `world.js`, name for name and default for default — `Intensity`, `Reach`,
`Decay exponent`, `Cone angle`, `Penumbra`, `Luminous flux`, `Profile multiplier`, `Photometric range`,
`Field angle`, `Cut-off pitch`, `Width`, `Height`, `Length`, `Tube radius`, `Beam spread`,
`Colour temperature`, `Emission colour`, `Position`, `Target`, `Rotation` — so the cards bind to the
reference's own controls instead of to engine-side lookalikes. Where the feed has not published one yet the
reference default stands in, so a card always reads as the browser draws it.

### Proof

`python3 Exhibits/Workbench/Lighting/RunNativeEmitterCards.py` compiles the panel against ImGui, runs it, and
writes twelve captures to `Exhibits/Gallery/LightingNative` from real draw commands — six emitters at the two
column widths an inspector sidebar actually gets. The run asserts 27 checks, including the arithmetic the
cards print, taken from the reference: a 14 cd point reads 0.56 lx at five metres and 0.14 lx at ten, a 62 cd
key spot reads 2.48 lx and pools 2.3 m across at five metres, an ECE low beam peaks at 2970 cd, a 2 x 1 m
softbox and a 1.5 m tube both peak at 540 cd, and efficacy is `min(160, 70 + K / 100)`.

The narrow capture is 318 px because the reference is an inspector column — its canvases fall back to 290 px
when unmeasured. At that width the axis fields clip their leading digit, which is what the browser does too:
`.step .f` carries `min-width:0`, so flexbox shrinks the field past its 38 px basis and the input clips. The
420 px capture shows them whole.

## Correction history

The first conversion was built from `Experimental/FrontierEditor`, which has no light family at all, so five
emitters were invented there and converted. That was the wrong editor. The native panel inherited the invented
design, and the C071/C072 cards that did match this reference — `Statistics` and the LED-strip electrical
panel — were deleted as though they were the approximation. Both judgements were wrong and are recorded here
so the next pass does not repeat them.
