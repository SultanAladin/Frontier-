# The spatial HUD tablet

`Experimental/SpatialHud/` — the Project-Zero trial panel reworked as a car fascia, with the particle
editor's light streaks behind it. Serve the repository root and open
`/Experimental/SpatialHud/index.html`. WebGPU only.

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

## The streak field

A new category, ordinal **7**, after every category the engine already ships. It has no native
counterpart yet, so it is the one shader written by hand, in `js/streaks.js`.

**Why it is not the particle editor's actual particles.** The obvious build is to run the light-streak
pass into a render target and bind it as the background. The spatial interface binds no texture at
all, and `InterfacePanelSample.slang` gives the reason: a sampled background means a sampler binding,
a texture lifetime and a second pass whose result a reflection ray cannot cheaply query. A panel that
is a lit surface in a room has to be answerable at a hit point, not only at a screen pixel. So the
streaks are a field — one more branch in the fragment shader that was already running.

**What that cost.** The preset's fibres are cubic Béziers in 3D sampled over 72 segments: fine as
geometry, hopeless per fragment, where the nearest point on a Bézier has no closed form. Each strand
here is an explicit curve `y = f(x)` of two summed harmonics, so the distance to it is the vertical
gap corrected by the slope — first order, exact on the curve, about twenty instructions. **A strand
cannot double back on itself.** For light running across a panel that is not a loss; for the preset's
root-cluster-to-reach spray it would be. This is a sibling of that effect, not a port of it.

Everything that makes the preset read as light streaks is kept, because none of it needed the Bézier:
the running head, the exponential wake behind it, the hard leading edge, the spark at the head,
per-strand phase and pace from the editor's own hash (`fbHash`, bit for bit), and one additive tone
map at the end.

Eight parameters ride in two vectors rather than in `ScalarAlpha`/`ScalarBeta`: strands, amplitude,
waves, speed, tail, seed, intensity, core. Six do not fit in two floats, and a parameter smuggled into
another one's slot is how a slot stops meaning anything. **The native 112-byte instance slot will have
to grow the same way** — that is the first real cost of this category and it should be decided
deliberately, not discovered.

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
node Experimental/SpatialHud/CheckHud.mjs            # PASS 87
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

## Still open

- Nothing is ported to C++ yet. The order would be: the streak field into
  `InterfaceSignedDistance.slang`, the slot growth for its eight parameters, the sort-key decision
  above, then the composition into a new project-side sequence beside `InterfaceTrialSequence`.
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
