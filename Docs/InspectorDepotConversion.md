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

## Still to convert

| Item                        | Source                                   | Status      |
| --------------------------- | ---------------------------------------- | ----------- |
| Point and spot light panel  | `panels/lights.js`                       | Not started |
| IES / area / tube panel     | `panels/advancedLights.js`               | Not started |
| Fog cards                   | `panels/fog.js`                          | Not started |
| Card note                   | `mp-note`, used in fog, folder, sun, wind, moon | Not started |
| Transform grid              | `TransformPanel.jsx` — Position m, Rotation deg, Scale × | Not started |

`Engine/Editor/LightInspectorPanel.cpp` currently draws the FrontierEditor card set and does not match any of
the above. It is to be rebuilt against `lights.js` and `advancedLights.js`.

## Correction history

The first conversion was built from `Experimental/FrontierEditor`, which has no light family at all, so five
emitters were invented there and converted. That was the wrong editor. The native panel inherited the invented
design, and the C071/C072 cards that did match this reference — `Statistics` and the LED-strip electrical
panel — were deleted as though they were the approximation. Both judgements were wrong and are recorded here
so the next pass does not repeat them.
