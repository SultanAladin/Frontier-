# Browser light panel → native C++ port register

Reference: **`Experimental/ProjectZeroEditor/index.html`**, the 4.87 MB self-contained bundle, confirmed by the
author on 2026-10-08. Built by `Build.mjs` from the sources beside it. The light panel is `LightPanel.js` +
`LightPanel.css` + `LightProjection.js`, with its transform block from `EmitterPanel.jsx` → `TransformPanel.jsx`.

## Superseded work — do not trust it

`Engine/Editor/LightInspectorPanel.cpp` and `Engine/Editor/LightDepotSurface.h` currently implement
`InspectorDepot/panels/lights.js` + `advancedLights.js`. **That is the wrong half of the folder.**
`InspectorDepot/` is a second, unused panel kit; the shipped panel only borrows its `el()` helper and the
`mp-rail` / `mp-pill` class names. The captures in `Exhibits/Gallery/LightingNative` show that wrong panel.
Both files and the gallery are to be replaced by the port described below.

Two earlier misses, recorded so they are not repeated: the first attempt ported `Experimental/FrontierEditor`
(an older editor with no light family, so five emitters were invented); the second ported `InspectorDepot`.
Neither is the shipped UI.

## What a light inspector is

`LightPanel.js` handles seven styles — `pointlight`, `spotlight`, `ieslight`, `arealight`, `tubelight`,
`ledlight`, `ledstrip`. The host is `div.mpanel.lighting-panel`, `display:flex; flex-direction:column; gap:12px`,
and the children are appended in this order by the final `replaceChildren`:

| # | Block | Class | Head / caption |
| --- | --- | --- | --- |
| 1 | Preview | `pcard lp-card lp-preview` | Radial falloff · Beam envelope · Photometric distribution · Luminous surface · Linear radiance · LED emitter · Ribbon light |
| 2 | Readings rail | `mp-rail lp-readings` | two tiles, type-specific |
| 3 | Scene participation | `pcard lp-card lp-participation` | caption `FLAGS` |
| 4 | Output | `pcard lp-card lp-output` | Source & colour · Driver & colour · Output per metre — caption `OUTPUT` |
| 5 | Response | `lp-response`, appended **inside** Output | Distance response · Beam section · Angular response · Aperture balance · Electrical budget · Conversion budget · Linear output — caption `ANALYTICAL` |
| 6 | Shape | `pcard lp-card lp-shape` | Attenuation · Beam shaping · Distribution profile · Package & optic · Layout & segments · Emitter dimensions — caption `OPTICS` |
| 7 | Transform | `lp-card lp-transform` | `TransformPanel.jsx`, head `Transform`, kicker `WORLD SPACE` |

The Preview header carries `lp-source-icon` (25 × 25) **prepended before the title** — this is the LED Strip
icon. It is `LightIcons[Style]` from `LightSpecification.js`, inlined as base64 SVG by `Build.mjs`.

## Geometry and palette — `LightPanel.css`

The palette is green-tinted, not the neutral grey of InspectorDepot. That alone distinguishes a correct port.

| Element | Spec |
| --- | --- |
| `.lp-card` | bg `#191919`, border `#ffffff0c`, radius 18, padding 17 × 15, `overflow:hidden` |
| `.lp-card > header` | flex, space-between, margin-bottom 15 |
| `.lp-card h3` | 14 px, weight 500, `#dedede`, no tracking, sentence case |
| `.lp-card > header > span` | 8 px, `#7c887c`, letter-spacing 1, right-aligned |
| `.lp-preview` | padding 15 / 12 / 12 |
| `.lp-primary` | 42 px, weight 300, letter-spacing −1.8, `#edf0e7`, tabular; `.lp-decimal` `#768074`; `small` 14 px `#a9b3a4` margin-left 7 |
| `.lp-primary-caption` | 10 px `#98a091`, margin-top 8 |
| `.lp-descriptor` | 10 px `#b1b9a8`, line-height 1.5, border-top `#ffffff0c`, margin-top 16, padding-top 11 |
| `.lp-canvas` | full width, radius 6; preview 260 px, response 180 px for point else 100 px |
| `.lp-study-note` | 9 px `#828d7e`, margin-top 3 |
| `.lp-readings` | grid, 2 × 1fr, gap 8 |
| `.lp-readings .mp-pill` | radius 6, min-height 80, bg `#20231f`, padding 13 × 12, **`column-reverse`** so the label sits above the value, gap 12 |
| `.lp-readings .v` | 24 px, weight 300, `#dce4d5`, letter-spacing −0.6 |
| `.lp-readings .k` | 9 px, `#9ba993`, sentence case |
| `.field` | margin 17 0; label 10 px `#999`, margin-bottom 9 |
| `.field input[type=range]` | height 26, radius 30, filled `#454545` to `--fill`, unfilled `#242424` |
| `.split-value input` | bg `#000`, width 58, 11 px |
| `.lp-colour` | flex, gap 10, 10 px `#999`, margin-top 17 |
| `.lp-profiles` | grid 1fr 1fr, gap 6; button padding 9 × 6, radius 4, bg `#242424`, `#909590`, 10 px, border `#ffffff0a` |
| `.lp-profiles button[aria-pressed=true]` | bg `#363e37`, border `#788578`, `#eef0eb` |
| `.lp-note` | 9 px `#6e756f`, line-height 1.5, margin 12 0 |
| `.lp-toggle-row` | flex, space-between, 11 px `#999`, margin 15 0 |
| `.lp-switch` | 38 × 21, radius 24, bg `#3c3c3c`, padding 2; knob 17 × 17 `#ddd`; checked bg `#32c763`, knob translateX 17 |
| `.lp-transform .transform-card` | padding 0, no background, no border — the grid sits directly in the card |

## Controls per type

Flux: `ledlight` → `watts × efficacy × dimmer`; `ledstrip` → `lumensPerMetre × length × dimmer`;
point and spot → `intensity`; everything else → `lumens`.

| Type | Output fields | Shape fields | Rail tiles |
| --- | --- | --- | --- |
| point | Intensity 0–60 cd | Reach 1–120 m, Decay exponent 0–4 | At 5 m · estimate (lx), Reach (m) |
| spot | Intensity 0–200 cd | Full cone angle 2–80°, Penumbra 0–1 | Full cone (°), Soft edge (%) |
| ies | Luminous flux 0–8000 lm, Colour temperature 1800–12000 K | 8 profile buttons, note *Preset illustration · IES file import pending.*, Profile multiplier 0–4 ×, Field angle 5–100°, Cut-off pitch −5–5°, Photometric range 1–250 m | Scaled output (lm), Field angle (°) |
| area | Luminous flux 0–20000 lm | aperture Rectangle/Disk, Width 0.1–20 m, Height 0.1–20 m, Beam spread 1–180°, toggle Two-sided emission | Aperture (m²), Emission |
| tube | Luminous flux 0–12000 lm, Colour temperature | Length 0.1–20 m, Tube radius 0.01–1 m, Reach 1–120 m | Linear output (lm/m), Tube radius (mm) |
| led | Driver power 0.1–100 W, Efficacy target 10–250 lm/W, Dimmer 0–1, Colour temperature | Package diameter 5–120 mm, Emission angle 10–180° | Driver power (W), Efficacy target (lm/W) |
| strip | Flux per metre 10–4000 lm/m, Load per metre 1–50 W/m, Dimmer 0–1, Colour temperature | Strip length 0.1–20 m, Emitter density 10–240 /m, Supply voltage 5–48 V, toggle Opal diffuser | Connected load (W), Emitter count (LEDs) |

Scene participation: `Cast shadows`, plus `Draw distribution` / `Draw cone` / `Show glow` / `Draw emitter`.

Transform rows are fixed and include rotation and scale:
`["Position","m",-100000,100000,0.01]`, `["Rotation","deg",-36000,36000,0.1]`, `["Scale","×",[1,1,1],0.001,1000,0.01]`.
`LightRotation()` recovers rotation from a legacy `target` by `asin(dy/len)` pitch and `atan2(-dx,-dz)` yaw.

## Illustrations — `LightProjection.js`, 627 lines

`ProjectLight` (preview) and `ProjectResponse` (response) each branch over all seven styles and draw in a fixed
design space — the point preview centres on (190, 123) with four 24 px reach rings, twelve spokes, a glow at
`min(0.45, flux/100)` and a 6 px core, labelled `OMNIDIRECTIONAL`. The point response is an illuminance plot
with left 43, right `width − 15`, top 28, bottom `height − 30`, five gridlines at `#ffffff14` and labels in
`#929b8f`. These are a second port of comparable size to the chrome and have not been started.

## Status

| Item | Status |
| --- | --- |
| Reference identified and recorded in `CLAUDE.md` | Done |
| Card set, palette, geometry, per-type controls transcribed | Done — above |
| Native chrome port | Not started |
| `ProjectLight` / `ProjectResponse` illustrations | Not started |
| Remove the superseded InspectorDepot conversion and its gallery | Not started |
| Fog cards (`FogPanel.jsx`, `FogShapePanel.jsx`) | Not started |

Acceptance test: the scripts already beside the sources — `CheckLightDesign.mjs`, `CheckLighting.mjs`,
`CheckInspectorLayout.mjs`, `CheckSharedCards.mjs`.
