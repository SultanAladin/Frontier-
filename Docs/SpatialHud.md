# The spatial HUD tablet

`Experimental/SpatialHud/` — the Project-Zero trial panel reworked as a car fascia, with the particle
editor's light streaks behind it. WebGPU only.

```
python3 Tools/Build/ServeExperiments.py --port 8099
```

then open `/Experimental/SpatialHud/index.html`.

🔴 **Serve it with that, not with `python3 -m http.server`.** The plain handler sends no
`Cache-Control` at all, so a browser applies a heuristic and may reuse a response without
revalidating. These pages are ES modules that import each other, which means the browser will
cheerfully load a new `index.html` against an `app.js` from five minutes ago. That failure is silent
and looks like an impossible bug: the first time it happened here the symptom was a black canvas and
an untouched readout, caused by nothing worse than a control attribute renamed in markup the cached
script had never seen. `ServeExperiments.py` sends `no-store`, refuses to answer `304`, and knows
that `.mjs` is JavaScript.

This is the browser stage. Nothing here has crossed into C++ yet, by the standing rule that a UI is
designed where it can be looked at before it is ported.

## What it is

`Projects/Project-Zero/Source/InterfaceTrialSequence.cpp` already builds a 3D panel out of the
engine's spatial interface: a housing, two buttons, a toggle, a progress bar, an arc meter with a
spring needle and a two-digit readout, at 0.36 × 0.22 m — a panel its own header calls "roughly a
large tablet". This is the same vocabulary composed as a fascia screen instead, at 0.46 × 0.27 m, in
the three bands a car cluster actually uses:

| band | what is in it |
|---|---|
| left | boost dial — tick ring, lit arc, redline band, spring needle |
| middle | speed, three seven-segment cells, `KM/H` under it |
| right | `SPORT` toggle, `REGEN` slider, a two-cell percentage |
| strips | title above, four breathing telltales below |

Behind all of it, filling the face, the streak field.

Still one `draw(4, instances)`. Twenty-odd figures, no vertex buffer, no texture, nothing
re-tessellated when a value moves.

## The browser shader is generated, not transcribed

`Tools/Build/GenerateHudShader.py` converts `Engine/Shaders/InterfaceSignedDistance.slang` into
`Experimental/SpatialHud/js/sdf.generated.js`. An arc in the browser *is* the engine's arc, because
it is the engine's text with its types rewritten — there is no second authority to drift from.

The converter is narrow on purpose and fails loudly rather than emitting plausible WGSL. Four things
GLSL permits and WGSL does not, each of which it had to learn:

- the ternary operator → `select(falseValue, trueValue, condition)`, scanned rather than
  regex-matched. The first attempt turned
  `(Offset - Span) < (kInterfaceTau - Offset) ? Span : 0.0` into
  `select(0.0, Span, kInterfaceTau - Offset)` — valid WGSL, wrong arc, and nothing downstream could
  have caught it. The three conversions this file needs are pinned as a self-test.
- single-statement `if` bodies, on the same line and on the next one → braces.
- `atan(y, x)` → `atan2`.
- GLSL declarations → `var`, and a function-scope `const` → `let`.

`--check` fails if the written file is stale; CI runs it.

## The backdrop ladder

The backdrop has three rungs, switchable in the page, because one answer cannot serve a panel you are
pressing your nose against and a panel reflected in a windscreen forty metres away.

| rung | what it is | for |
|---|---|---|
| **Live** | the particle editor's real 3D Bézier fibres, as geometry | the panel being looked at |
| **Field** | an analytic field evaluated in the panel's plane | distant panels, and reflections |
| **Average** | one colour — the existing `Low` tier | far reflections |

### Live — the real fibres, and why it is not a render target

`js/fibres.js` ports `fbHash`, `fbUnit`, `fbBezier`, `fbPulse`, `fbRamp`, `fbColourAt` and both the
fibre and spark stages out of `Experimental/ParticleEditor/js/shaders.js`, keeping the editor's own
uniform slot numbering so the two can be read side by side. Not ported: ribbon and trail. A trail
needs the arc-length path table as a storage buffer and a ribbon is a sheet rather than a volume, so
the packer **refuses** any shape but `streak` instead of quietly falling back to it.

The obvious way to put a 3D world behind a UI panel is to render it offscreen and sample the texture.
That is a sampler binding, a texture lifetime, a second pass, and a result a reflection ray cannot
cheaply ask about — the objection `InterfacePanelSample.slang` already makes.

But the engine has the mechanism a portal actually needs: the ⑥ **shader clip**, "a rounded rectangle
in the figure's own plane ... works under any transform, unlike a scissor rectangle". So the fibres
are drawn **in the same render pass**, in the panel's own local space, clipped by the panel's rounded
rectangle in the fragment shader. Own pipeline, own vertex program, own geometry — a custom raster in
every way that matters — and no offscreen target.

An offscreen target earns its cost for exactly three things, none of which is "3D": **bloom**, a
**camera of its own**, or a **resolution and refresh rate decoupled** from the panel's. Bloom is the
real one, and part of why the editor's own streaks look as good as they do. Add it when it is wanted.

Two things are new, because a fibre in a panel is not a fibre in a scene. The curve is built in
**panel-local metres** and carried to the world by the panel's own transform rows, so moving the
tablet moves the light inside it. And depth is handled at both ends: a strand dims with distance
behind the glass (the cue that makes a volume read as a volume), and dims again over a 15 mm band as
it approaches the surface, because a strand must not cross the glass and hang in the room — and a
hard cut at the plane would show as a bright edge the moment the tablet is tilted.

🔴 **The hull bound caught a real bug.** A cubic Bézier lies in the convex hull of its control points,
so the volume can be bounded from the preset's numbers alone — no hash, no sampling, and no second
copy of `fbBezier` to drift from the shader's. At the preset's own `spread` 1.2 and `amplitude` 2.4
that hull reached about 0.14 m perpendicular to the axis, which through the curve-to-panel mapping put
strands **ten centimetres in front of the glass** — light glowing in the room outside the tablet,
where the lateral clip could not see it. They are 0.9 and 1.3 here, and `CheckHud` fails if the volume
ever escapes forward again.

The interface is still one `draw(4, instances)`; the world is inserted between its two halves —
housing, face and field rung, then the fibres and sparks, then every control.

### Field — the analytic rung

A new category, ordinal **7**, after every category the engine already ships, hand-written in
`js/streaks.js`.

It is **flat by construction**: every strand sits at the same depth, so it slides with the surface
instead of swimming behind it, and the eye reads that as paint rather than as light in a volume. That
is not a tuning problem and no parameter work fixes it.

It is kept anyway, because it is the only form of this backdrop that **can be answered at a hit
point** — a closed-form function of a plane coordinate, which geometry is not. A reflection of the
tablet, or a tablet at forty metres, gets this rung.

Each strand is an explicit curve `y = f(x)` of two summed harmonics, so the distance to it is the
vertical gap corrected by the slope — about twenty instructions, and **a strand cannot double back on
itself**. Everything that makes the preset read as light streaks is kept, because none of it needed
the Bézier: the running head, the exponential wake, the hard leading edge, the spark, per-strand phase
and pace from the editor's own hash (`fbHash`, bit for bit), and one additive tone map.

Eight parameters ride in two vectors rather than in `ScalarAlpha`/`ScalarBeta`. Six do not fit in two
floats, and a parameter smuggled into another one's slot is how a slot stops meaning anything. **The
native 112-byte instance slot will have to grow the same way** — the first real cost of this category,
and it should be decided deliberately rather than discovered.

### Either way, it is light

The backdrop is an **Illuminant**, not an Overlay: it is light inside the glass, it feeds the panel's
scene luminaire and pools on whatever the tablet stands on. A backdrop that lit nothing would read as
a sticker the moment the room went dark. Drop the ambient slider to see the bezel sink while the
streaks, the arc and the lit knob stay.

## 🔴 A finding about the native sort key

`ComposeInterfaceSortKey` puts transparency in the **top** bit, so every transparent figure submits
after every opaque one whatever its ordering rank. That is correct when a depth buffer is doing the
occlusion. It is wrong the moment a large *transparent* figure has to sit *under* opaque ones — which
is exactly what the streak field is: rank 2, opacity 0.85, beneath an opaque needle at rank 7 and
opaque digits at rank 9. Under the engine's key the backdrop submits last and paints over its own
instrument.

The browser submits by ordering rank instead (every figure in this composition is coplanar to within
three millimetres, so a depth test would resolve nothing and z-fight instead). `CheckHud.mjs` pins
both halves: that the engine's key really does order them wrongly, and that rank ordering does not.

**The native side has to answer this when the category crosses over:** either the backdrop becomes
opaque, or transparency stops being the most significant bit of the key.

## Checks

```
python3 Tools/Build/GenerateHudShader.py --check     # the WGSL port is current
node Experimental/SpatialHud/CheckHud.mjs            # PASS 120
```

Both run in `frontier-build.yml`. `CheckHud` covers the composition arithmetic (a quarter turn about
X really does send panel-up to world-up), the two-sweep resolver and its cycle refusal, the layout's
structural claims, that no figure reaches past the bezel, the sort finding, the value writes, and the
packed buffer.

Two of its checks are worth naming:

- **Every character on the panel has a glyph.** The stroke font draws *nothing* for a character it
  does not know, by design — "a missing label is obvious, a wrong one is not". That makes a typo
  invisible in the source and invisible in review, so the supported set is read out of the shader
  text and the labels are checked against it rather than against a list maintained by hand.
- **A blank leading digit, not a zero.** `007 KM/H` is a clock, not a speedometer. The engine gives
  blank its own code (10); the check holds `7`, `42`, `180`, an over-range value and a negative one.

What `CheckHud` does **not** claim is that it looks right. There is no headless WebGPU here, and a
check asserting pixels it never rendered would be worse than none. The page is the proof of
appearance.

## When the page is blank

Every path into `start()` ends somewhere visible now — a thrown error, a rejected promise, or a throw
inside the animation callback all print into the red box over the canvas instead of leaving a black
rectangle. The readout reports on the **first** frame rather than after half a second, so a page that
renders once and then dies still says what it managed. A control missing from the markup warns and is
skipped rather than taking the whole panel down.

If the box is empty and the readout still says `starting`, the script never ran at all: check the
browser console for a module that failed to load.

## Still open

- Nothing is ported to C++ yet. The order would be: the fibre stages as a second pipeline beside the
  interface raster (they are already the editor's own code, which the engine does not yet have at
  all), the field rung into `InterfaceSignedDistance.slang`, the slot growth for its eight
  parameters, the sort-key decision above, then the composition into a new project-side sequence
  beside `InterfaceTrialSequence`.
- **Bloom.** The one thing that would justify an offscreen target. The Live rung is additive glow in
  the main pass, which gets most of the way and not all of it.
- **Which rung, chosen by what.** The ladder exists but nothing selects between its rungs
  automatically — the page has three buttons. Native, this wants the same treatment as the gas
  quality ladder: a distance and a budget, not a switch.
- **The panel is not interactive.** `InterfacePointerProjection` already exists natively and the
  trial panel already handles a pointer contact; the browser page drives values from sliders and a
  scripted cycle instead. Pressing the toggle and dragging the slider *on the panel* is the next
  thing it needs.
- The telltales are decoration — they breathe on a timer and mean nothing.
- The redline band is a second arc rotated to start where the warning does. That works and costs
  nothing, but a dial that wanted several bands would want them as one figure.
- Glyph labels are per-character figures. Twenty-six of the panel's figures are letters, which is
  fine at this size and would not be at paragraph length — the stroke font is for labels and units,
  as its own header says.
