# Browser light panel → native C++ port register

Reference: **`Experimental/ProjectZeroEditor/index.html`**, the 4.87 MB self-contained bundle, confirmed by the
author on 2026-10-08. Built by `Build.mjs` from the sources beside it. The light panel is `LightPanel.js` +
`LightPanel.css` + `LightProjection.js`, with its transform block from `EmitterPanel.jsx` → `TransformPanel.jsx`.

## History

The panel was first built from `Experimental/FrontierEditor` and then from `InspectorDepot/panels/lights.js`;
both were wrong. `Engine/Editor/LightDepotSurface.h` has been deleted and `LightInspectorPanel.cpp` rewritten
against `LightPanel.js`.

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
| Native chrome port — all six blocks, seven styles | Done — `LightInspectorPanel.cpp` |
| `ProjectLight` illustrations, seven styles | Done — `PaintStudy` |
| `ProjectResponse` plot and sections | Done — `PaintResponse` |
| Superseded InspectorDepot conversion removed | Done — `LightDepotSurface.h` deleted |
| Header source glyph (`lp-source-icon`) | Done — shipped artwork, baked for the harness |
| Control interaction (drag, click, write-back) | Outstanding — the port draws, it does not yet edit |
| Fog cards (`FogPanel.jsx`, `FogShapePanel.jsx`) | Not started |

### The source glyph

`LightPanel.js` prepends a 25 x 25 `img` into each card header, `LightIcons[Style]` from
`LightSpecification.js`: `editor-point-light`, `editor-spotlight`, `editor-dome-light`, `editor-area-light`,
`light-area-2d`, `light-point-2d`, `slate-ring-light`. All seven are real `IconSymbol` entries, so the panel
asks for the shipped artwork rather than redrawing it, through the `LightGlyphSource` hook declared in
`LightInspectorPanel.h`. The editor answers that from `IconArt` / ThorVG.

The harness cannot — this sandbox has no SVG rasteriser, `rsvg-convert` is absent and ImageMagick's SVG
delegate fails. `BakeLightGlyphs.mjs` rasterises the same seven SVGs with `@resvg/resvg-js` to straight-alpha
RGBA8 at 2x into `Glyphs/*.rgba`, which the harness reads with a plain `fread` and hands to the CPU backend as
its one custom sheet. Re-bake with `node Exhibits/Workbench/Lighting/BakeLightGlyphs.mjs` after
`npm i @resvg/resvg-js`; the baked files are committed so the proof runs without node.

### Two fills ImGui cannot do directly

`AddConvexPolyFilled` silently misdraws concave shapes. The area under a 1 / d^n illuminance curve is filled as
one quad per segment, and a photometric lobe — star-shaped about the origin but not convex — as a triangle fan
from the centre. Both looked plausible but wrong before this was caught by eye.

Acceptance test: the scripts already beside the sources — `CheckLightDesign.mjs`, `CheckLighting.mjs`,
`CheckInspectorLayout.mjs`, `CheckSharedCards.mjs`.

### The controls drive the sheet, they do not only draw it

`Adopt` takes a snapshot of the published properties, so writing to that snapshot would be discarded at the top
of the next frame. `Bind(Sheet, Label)` resolves the live `EditorProperty` behind a label and every control
takes one:

| Control | Browser behaviour reproduced | Native |
|---|---|---|
| Range | `input[type=range]` — pressing anywhere on the track seeks to it, a drag keeps following | `InvisibleButton` over the track, value from the pointer's share of the span, snapped to the field's step and clamped to its range |
| Switch | `.lp-switch` click toggles | 38 x 21 `InvisibleButton` flipping `On` |
| Profile cell | the pressed cell is the picked one | per-cell `InvisibleButton` setting `Picked` |
| Transform axis | `TransformPanel.jsx`'s drag ref — horizontal pointer travel scrubs the axis | horizontal `MouseDelta.x * Step`, clamped per row: Position +/-100000 step 0.01, Rotation +/-36000 step 0.1, Scale 0.001-1000 step 0.01 |

Every control is gated on `Editable`, so a read-only property stays inert.

Three of the harness's checks prove this rather than asserting it: they feed ImGui synthetic mouse events and
then read the sheet back, so a control that draws correctly but is wired to nothing fails the proof.

## Fog cards

The fog card family already existed natively in `Engine/Editor/FogInspectorPanel.cpp` — header, `Fog settings`,
`Visibility through fog`, `Medium`, a model-specific technical card and `Wind binding`. Three visuals inside it
were missing or had drifted from the reference, and only those three were converted.

| Browser source | Native | State before |
|---|---|---|
| `FogPanel.jsx` `FogBeamChamber` | `FogCards::PaintChamber` | Existed, drifted |
| `HeightFogVisual.jsx` | `FogCards::PaintProfile` | A different graph entirely |
| `FogShapePanel.jsx` | `FogCards::PaintVolume` | Absent |

Card order, read off `Inspectors.jsx`: `Fog settings` (142) · `Visibility through fog` (435) · a two-column grid
of `Medium` (416, with the chamber at its foot) and the technical card · `Wind binding`. The technical card is
`Height and tint` for height fog, `Spectral transmission` for aerial, and — in the shipped bundle — **`Fog volume
shape`** for local fog. The native panel titled that card `Local bounds`, which is the *cloud* card's title;
`CheckFogCards.mjs` still expects the old name and is stale against `index.html`, so the bundle won.

### What had drifted in the beam chamber

| Quantity | Reference | Native before |
|---|---|---|
| Samples | 70 rects, width 4.2 | 68 lines, width 3.2 |
| Half height | `3 + f² (11 + Spread·24)` | `3 + f² (11 + Spread·22)` |
| Exposure | `0.32 + 0.68·T^0.15` | `0.35 + 0.65·T^0.15` |
| Opacity | `(0.1 + Spread·0.2)·Exposure` | `(0.13 + min(2,Spread)·0.2)·Exposure` |
| 2 % marker | always drawn, clamped to the span | drawn only when inside the span |
| Footer | `2% · 208 m` / `10% PHYSICAL AT 120 m` | `2% range inside diagnostic span` |

Extinction is `LiveGraph.jsx`'s `FogDensity` with `AuthoredPreview` set, so a disabled medium still previews its
authored curve: height folds the density to a 25 m probe, aerial scales by a thousandth, local multiplies density
by coverage and divides by a hundred.

### The density profile is an editor, not a graph

`HeightFogVisual.jsx` is a 300 x 210 space, `preserveAspectRatio="none"`, plotting density against altitude —
the axes the old native sketch had swapped. Pressing it authors **both** values at once: falloff from the X
position (`10 + share·2990`, rounded to the metre) and density from the Y position (`share·0.2`, rounded to four
decimals), which is why the check asserts both moved from one press.

### Volume shape

`FogShape.js` is reproduced branch for branch so the vertex indices match: Box, Custom and Prism/Cylinder extrude
a ring; Cone fans 48 base vertices to an apex with a spoke every sixth; Diamond is six points; Sphere and
Ellipsoid sweep 13 latitudes by 24 longitudes. The preview is the same isometric,
`[(x−y)/√2, (x+y)/√6 − z·√(2/3)]`, fitted to 270 x 190 and centred at 160, 120. Bounds are the mesh extremes plus
Centre; Size is the mesh alone.

Two deviations, both forced and both recorded here rather than hidden:

- **Ear clipping for the caps.** A Custom outline extrudes to concave end caps, and `AddConvexPolyFilled`
  misdraws those silently — the same trap the light response curve hit. The caps are triangulated instead.
- **The `<select>` cycles.** A native popup list would have to be styled by ImGui, and the CSS says nothing about
  a dropdown's appearance, so clicking the control advances to the next entry in `FogShapes`.

Text keeps CSS letter-spacing through a per-codepoint `Tracked` helper; ImGui has no tracking of its own and the
8 px uppercase micro-labels are unreadable without it. Anisotropic glyph scaling is the one thing the stretched
profile cannot reproduce — positions and glyph height are exact, glyph width is natural.

Acceptance test: `python3 Exhibits/Workbench/Fog/RunNativeFogCards.py`, 56 checks, captures in
`Exhibits/Gallery/FogNative/`.

## Wind binding card

`WindPanel.jsx` ships `WindBinding` as a card (`data-card="Wind binding"`); the native side carried only
`Engine/Editor/WindBindingControls.h`, a bare `SeparatorText` + `Checkbox` + `BeginCombo` stub. The fog panel
already drew a card *titled* "Wind binding" with that stub inside it, so only the card's contents were missing.

| Browser | Native | Note |
| --- | --- | --- |
| `WindBinding` (`WindPanel.jsx`) | `WindCards::PaintBindingBody` | select, editor shortcut, preview, note |
| `WindCanvas` (`WindPanel.jsx`) | `WindCards::PaintCanvas` | heat field, lattice, arrows, flow strokes |
| `ResolveWind` / `EvaluateWind` (`WindSpecification.js`) | `WindCards::Resolve` / `Evaluate` | clamps and four kinds |

New file `Engine/Editor/WindPanelSurface.h` (namespace `Frontier::WindCards`). Mounted from
`FogInspectorPanel.cpp` inside the existing card; the native-only "Own wind component" switch is kept beneath
the preview as a supplement, so no native capability was removed.

### Measurements

Card chrome comes from **Editor.css** `.property-card` (padding 23/24/22, radius 22, border `#343434`,
`linear-gradient(135deg,#252525,#202020)`), not from the light or fog card rules: `h3` 12 px `#cacaca` with a
28 px drop, `> p` 11 px `#919191`, body text 13 px `#f0f0f0`. From **WindPanel.css**: the select is full width,
32 px tall, radius 16, margin `10px 0 18px`; the wide button is full width at 12 px padding with a 14 px drop;
the canvas is 180 px tall in this card (280 px elsewhere), radius 14, border `#ffffff12`; the legend is a 10 px
row with a 4 px bar running `#306e7c → #58a56e → #d3b565`; the caption is 10 px `#83948e`.

### The flow field

Canvas clear `#111b20`. A 64 × 48 speed field is drawn back at canvas size with `imageSmoothingEnabled` at
`globalAlpha .5`; bilinear smoothing between texel centres is reproduced with four-corner gradient quads. The
32 px lattice is `#ffffff09`. 190 motes are seeded deterministically from two coprime strides
(`(i·73 % 151)/151`, `(i·43 % 149)/149`), advected at eight times real time, and drawn as trails that walk five
steps upstream and fade from the tail. Speed colours are `hsl(190 − s·150, 48%, 32% + s·28%)` for
`s = min(1, speed/30)`: teal `(42,108,121)` at rest, green `(70,174,61)` at 15 m/s, gold `(202,169,104)` at 30.

### Recorded deviations

- A canvas clips its own `border-radius`; an ImGui clip rectangle cannot, so the four corner notches are
  repainted in the backdrop colour with a triangle fan (`RoundNotch`). `AddConvexPolyFilled` cannot fill them —
  each notch is concave.
- ImGui cannot fade a stroke's alpha along its length, so every trail leg is cut into four graded pieces.
- The `<select>` cycles on click rather than opening a popup, as the fog shape select already does.
- `WindEditor` — the modal "place and combine components" window, `wind-editor` in the bundle — is **not** ported.
  The shortcut button is drawn and returns its hit rectangle, but nothing is mounted behind it yet.
### Mounted in both panels

`FogInspectorPanel.cpp` reuses the card it already drew. `CloudsInspectorPanel.cpp` previously called the stub
bare at the top of the function — before the panel chrome and before its own property guard; the card now sits
**last**, which is where `WindPanel.jsx` puts `WindBinding` in the clouds branch.

One semantic correction came out of the clouds wiring: native `Wind Source` entry 0 is `WindNames[0]`,
**"Global wind"** — the shared field, not the browser's still-air blank. The native select therefore always
resolves to a named field, so both panels pass `Assigned` and the option text straight through. The
still-air and dangling-id states remain implemented and proved, they simply cannot arise from this sheet.

77 checks: `python3 Exhibits/Workbench/Wind/RunNativeWindCards.py` → `Exhibits/Gallery/WindNative`.

## The wind panel — which half actually ships

The earlier note that `InspectorDepot/` is "the wrong half" is true for lights and **false for wind**, and the
reason is one line of the build.

`Build.mjs` has two entry points. The second one is `InspectorHost.js`, and that host mounts the depot panels:

```js
import { CUSTOM_PANELS } from "./InspectorDepot/panels/index.js";
CUSTOM_PANELS[Type] = { ...CUSTOM_PANELS[Type], build: LightPanel };
```

It replaces exactly one family — lights — with `LightPanel.js`. Every other depot panel ships as written. So the
wind panel the bundle mounts is `InspectorDepot/panels/wind.js`, which is why `Anemometer` and `Beaufort` are in
`index.html` at all. Verify per family before porting; do not generalise from the light case in either direction.

`Build.mjs` also rewrites `wind.js` and `fog.js` on load through `RecolourInstrument` in
`InstrumentSpecification.js`. **Reading `wind.js` alone gives the wrong trace.** The shipped anemometer differs
from the checked-in source in three anchored replacements, all recorded below.

### The reference wind panel, card by card

| # | Card | Class | Native today | State |
|---|------|-------|--------------|-------|
| 1 | Hero flow field | `pcard mp-hero wf-hero` | `Composite wind field` (a compass rose) | **not converted** |
| 2 | Anemometer | `pcard mp-metric wf-trace` | `Anemometer` (speed text + 10 m vector) | **converted, this pass** |
| 3 | Beaufort | `pcard mp-light wf-scale` | folded into the native Anemometer text | **not converted** |
| 4 | Steadiness | `pcard` | `Variation controls` + `Gust envelope` | **not converted** |
| 5 | Driving | `pcard` | — | **not converted** |

A four-pill rail (`Mean` · `Gust` · `From` · `Force`) and a two-card duo (`Gusting to` · `Lulling to`) sit between
cards 1 and 2. Neither exists natively. The native `Composite wind field`, `Variation controls` and `Gust envelope`
are **not in the bundle at all** — they are native inventions, and removing them is a redesign, not an addition.

### The anemometer — `Engine/Editor/WindInstrumentSurface.h`

Namespace `Frontier::WindInstrument`. Palette read from `InspectorDepot/styles.css` `:root`, which is a neutral
grey kit and shares nothing with the light family's green-tinted one: `--inset #1a1a1a`, `--field #000000`,
`--stroke rgba(255,255,255,.05)`, `--text #f0f0f0`, `--text-dim #888888`, `--text-faint #5c5c5c`, `--r-inset 18px`.

Arithmetic, straight off the source:

- `gustAt(ph) = 1 + Gust·(swell·0.55) + Turbulence·(grain·0.18)` where
  `swell = sin(ph·0.9)·0.6 + sin(ph·2.3+1.7)·0.3 + sin(ph·5.1)·0.1` and
  `grain = (sin(ph·17.3) + sin(ph·29.7+2.1))·0.5`
- the clock runs at `0.4 + Turbulence·2.2`
- 240 samples — sixty seconds at four a second — prefilled backwards from the current phase so the trace is never
  blank, then shifted one sample per quarter second with the remainder carried
- defaults `speed 4.2 · direction 214 · gust 0.3 · turbulence 0.24`

Trace geometry: `R 30 · L 2 · T 8 · B 15`, height 112 (170 when `.tall`), `top = max(2, max(trace, speed)·1.18)`,
four dashed gridlines at quarters of `top` labelled `%.1f` below 12 and `%.0f` above, a 4/4 dashed mean rule, and
`−60 s · −30 s · now` along the foot. Readouts: `floor(inst)` and `.{round(inst·10)%10}` at 46 px with the
fraction in `--text-faint`, `Mean {speed} m/s · {band}, force {n}`, and four spec tiles — gust factor `hi/speed`,
spread `hi−lo`, pressure `½·1.225·speed²`, and `km/h · kn`.

The three `RecolourInstrument` replacements, which are the shipped behaviour:

1. the green `rgba(137,224,196,.07)` gust band is replaced by a vertical wash under the trace path,
   `rgba(224,224,224,.10)` at the top inset falling to `rgba(224,224,224,.01)` at the foot
2. the trace stroke becomes `rgba(210,210,210,.36)` at 1.2 px
3. the samples that sit above the mean are re-stroked in place at `rgba(242,242,242,.95)`, and the peak and
   trough get 2.3 px dots in `#eeeeee` and `#d69a54`

Recorded deviations: a flat ImGui quad cannot carry a gradient, so the wash is banded ten deep per column; the
`.mp-x` button is drawn with its `arrowout` icon and no ground, because the CSS ground is transparent until hover.

Proof: `python3 Exhibits/Workbench/Wind/RunNativeWindInstrument.py` → **PASS 36**, four captures in
`Exhibits/Gallery/WindInstrument/`. The harness draws at 3× and box filters down — the CPU backend takes one
sample per pixel with a hard inside test, which is fine for 46 px numerals and loses thin strokes at 9 px.
