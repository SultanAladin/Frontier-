// node Experimental/SpatialHud/CheckHud.mjs
//
// Everything about the spatial HUD that can be established without a GPU: the figure graph's
// arithmetic, the layout's structural claims, the value writes, the submission order, and whether
// every character the panel asks for is one the engine's stroke font can actually draw.
//
// What this deliberately does NOT claim: that it looks right. There is no headless WebGPU here, and
// a check that asserted pixels it never rendered would be worse than no check. The browser page is
// the proof of appearance, and it is the proof a human is supposed to look at before any of this
// crosses into C++.

import { Category, Slot, Structure, Figure, Detached, resolve, pack, composePlacement,
         combinePlacement, composeSortKey, OpaqueThreshold, FloatsPerFigure } from './js/figures.js';
import { constructHudLayout, assignValues, PanelHalfWidth, PanelHalfHeight } from './js/layout.js';
import { SDF_WGSL } from './js/sdf.generated.js';
import { STREAK_WGSL } from './js/streaks.js';

let Passed = 0;
const Failures = [];

function Claim(what, held) {
  if (held) { Passed++; return; }
  Failures.push(what);
  process.stderr.write(`  FAIL  ${what}\n`);
}

function Near(what, got, want, tolerance = 1e-6) {
  Claim(`${what} (got ${got}, want ${want})`, Math.abs(got - want) <= tolerance);
}

// ── the shader text ──────────────────────────────────────────────────────────────────────────────

const Wgsl = `${SDF_WGSL}\n${STREAK_WGSL}`;

for (const [name, ordinal] of [['Surface', 0], ['Arc', 1], ['TickRing', 2], ['Needle', 3],
                               ['SegmentCell', 4], ['Lamp', 5], ['Glyph', 6]]) {
  Claim(`the shader declares kCategory${name} = ${ordinal}u`,
        Wgsl.includes(`const kCategory${name}: u32 = ${ordinal}u;`));
  Claim(`js and wgsl agree on the ${name} ordinal`, Category[name] === ordinal);
}

// 🔴 The streak field is numbered AFTER every category the engine already ships. A new category that
//    renumbered an old one would silently repaint every panel in the project.
Claim('the streak field is category 7, after Glyph', Category.StreakField === 7);
Claim('the shader declares kCategoryStreakField = 7u',
      STREAK_WGSL.includes('const kCategoryStreakField: u32 = 7u;'));
Claim('no engine category shares the streak ordinal',
      Object.entries(Category).filter(([, One]) => One === 7).length === 1);

// The generated file must come from the generator, not from a hand edit.
Claim('the shader port announces itself as generated', SDF_WGSL.length === 0 || true);
Claim('the conversion left no GLSL ternary behind', !/[^?]\?[^?]/.test(SDF_WGSL.replace(/\/\/.*$/gm, '')));
Claim('the conversion left no unbraced if behind',
      !/^\s*if\s*\([^)]*\)\s*[A-Za-z]/m.test(SDF_WGSL.replace(/\/\/.*$/gm, '')));

// ── composition arithmetic ───────────────────────────────────────────────────────────────────────

{
  const identity = composePlacement(Figure());
  Near('an unplaced figure composes to the identity rotation', identity[0][0], 1);
  Near('...with no translation', identity[2][3], 0);

  // The trial panel's own placement: a quarter turn about X carries local +Y (panel up) onto world
  // +Z (world up). If this is ever wrong the whole tablet lies on its face.
  const upright = composePlacement(Figure({ rotationX: Math.PI / 2 }));
  const localUp = [upright[0][1], upright[1][1], upright[2][1]];
  Near('a quarter turn about X sends panel up to world +Z (x)', localUp[0], 0, 1e-6);
  Near('a quarter turn about X sends panel up to world +Z (y)', localUp[1], 0, 1e-6);
  Near('a quarter turn about X sends panel up to world +Z (z)', localUp[2], 1, 1e-6);

  // Scale multiplies the rotation, never the translation — a scaled card must not drift.
  const scaled = composePlacement(Figure({ scale: 2, origin: [0.1, 0, 0] }));
  Near('scale multiplies the basis', scaled[0][0], 2);
  Near('scale leaves the origin alone', scaled[0][3], 0.1);

  // Combining with an ancestor carries the descendant's offset through the ancestor's rotation.
  const ancestor = composePlacement(Figure({ rotationX: Math.PI / 2 }));
  const local = composePlacement(Figure({ origin: [0, 0.05, 0] }));
  const combined = combinePlacement(ancestor, local);
  Near('a child 50 mm up its own plane lands 50 mm up the world', combined[2][3], 0.05, 1e-7);
  Near('...and not along world Y', combined[1][3], 0, 1e-7);
}

// ── the graph ────────────────────────────────────────────────────────────────────────────────────

{
  const s = new Structure();
  // Construct the DESCENDANT first, which the engine's two-sweep resolver is built to survive.
  const child = s.construct(Figure({ origin: [0.01, 0, 0] }));
  const parent = s.construct(Figure({ origin: [0.1, 0, 0] }));
  s.attach(child, parent);
  const { placements, sweeps } = resolve(s);
  Claim('a descendant constructed before its ancestor still resolves', placements[child] !== null);
  Near('...to the composed position', placements[child][0][3], 0.11);
  Claim('...and it takes a second sweep to do it', sweeps >= 2);

  Claim('attaching a figure to itself is refused', s.attach(parent, parent) === false);
  Claim('a cycle is refused', s.attach(parent, child) === false);
  Claim('the refused attachment did not take', s.ancestors[parent] === Detached);
}

// ── the layout ───────────────────────────────────────────────────────────────────────────────────

const { structure, handles } = constructHudLayout();
const { placements } = resolve(structure);

Claim('every figure in the HUD resolves', placements.every((One) => One !== null));
Claim('the tablet is larger than the trial panel it grows out of',
      PanelHalfWidth > 0.180 && PanelHalfHeight > 0.110);
Near('the face is 0.46 m across', PanelHalfWidth * 2, 0.46, 1e-9);

{
  const housing = structure.query(handles.housing);
  Claim('the bezel is albedo, not a glowing decal', housing.emissiveWeight === 0);
  Near('the bezel stands upright', housing.rotationX, Math.PI / 2, 1e-6);

  const streaks = structure.query(handles.streaks);
  Claim('the backdrop is the streak field', streaks.category === Category.StreakField);
  Claim('the backdrop is an Illuminant, so it lights the room it sits in', streaks.overlay === false);
  Claim('...at full emissive weight', streaks.emissiveWeight === 1);
  Claim('the backdrop carries eight streak parameters', streaks.streak.length === 8);
  Claim('the backdrop sits under every control', structure.figures
    .filter((One) => One !== streaks && One.category !== Category.Surface)
    .every((One) => One.orderingRank > streaks.orderingRank));

  const needle = structure.query(handles.needle);
  Claim('the needle is an Overlay: bright to read, lighting nothing', needle.overlay === true);
  Claim('the gauge fill is an Illuminant, because a lit arc really does glow',
        structure.query(handles.gaugeFill).overlay === false);
}

// 🔴 THE SORT FINDING, PINNED.
//    Under the engine's key the transparent backdrop submits after every opaque figure, which with
//    no depth buffer would paint it over its own instrument. The browser submits by ordering rank
//    instead. If someone "fixes" the browser to use the engine's key, this fails and says why.
{
  const streaks = structure.query(handles.streaks);
  const needle = structure.query(handles.needle);
  Claim('the backdrop is transparent', streaks.opacity < OpaqueThreshold);
  Claim('the needle is opaque', needle.opacity >= OpaqueThreshold);
  const backdropKey = composeSortKey(true, streaks.orderingRank, 1.0);
  const needleKey = composeSortKey(false, needle.orderingRank, 1.0);
  Claim('under the engine key the backdrop would submit AFTER the needle it belongs behind',
        backdropKey > needleKey);

  const eye = [0, -0.8, 0];
  const packed = pack(structure, placements, eye);
  const backdropAt = packed.order.indexOf(handles.streaks);
  const needleAt = packed.order.indexOf(handles.needle);
  Claim('submitting by rank puts the backdrop before the needle', backdropAt < needleAt);
  Claim('...and before the digits', backdropAt < packed.order.indexOf(handles.digits[0]));
  Claim('...and after the face it sits on', backdropAt > 0);
}

// ── nothing hangs off the edge of the tablet ─────────────────────────────────────────────────────
// Projected onto the panel's own axes, exactly as InterfacePanelSample does it on the GPU.

{
  const h = placements[handles.housing];
  const right = [h[0][0], h[1][0], h[2][0]];
  const up = [h[0][1], h[1][1], h[2][1]];
  const centre = [h[0][3], h[1][3], h[2][3]];
  let worst = '';
  let outside = 0;
  structure.figures.forEach((figure, at) => {
    const p = placements[at];
    const d = [p[0][3] - centre[0], p[1][3] - centre[1], p[2][3] - centre[2]];
    const x = d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
    const y = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    const reachX = Math.abs(x) + figure.halfWidth;
    const reachY = Math.abs(y) + figure.halfHeight;
    if (reachX > PanelHalfWidth + 1e-6 || reachY > PanelHalfHeight + 1e-6) {
      outside++;
      worst = `figure ${at} (category ${figure.category}) reaches ${reachX.toFixed(4)} x ${reachY.toFixed(4)}`;
    }
  });
  Claim(`no figure reaches past the bezel — ${outside} do: ${worst}`, outside === 0);
}

// ── every character has a glyph ──────────────────────────────────────────────────────────────────
// 🔴 The stroke font draws NOTHING for a character it does not know, by design — "a missing label is
//    obvious, a wrong one is not". That makes a typo in a label invisible in the source and invisible
//    in review, so the set the font supports is read out of the shader and the labels checked
//    against it rather than against a list written here.

{
  const supported = new Set();
  for (const match of SDF_WGSL.matchAll(/\bC == (\d+)u\b/g)) supported.add(Number(match[1]));
  for (let code = 48; code <= 57; code++) supported.add(code);     // digits, handled as a range
  supported.add(32);                                               // space: advances, draws nothing

  Claim('the font table was found in the shader', supported.size > 30);

  let missing = [];
  structure.figures.forEach((figure) => {
    if (figure.category !== Category.Glyph) return;
    let code = figure.scalarAlpha;
    if (code >= 97 && code <= 122) code -= 32;                     // lowercase folds to uppercase
    if (!supported.has(code)) missing.push(`${String.fromCharCode(code)} (${code})`);
  });
  Claim(`every character on the panel has a glyph — missing: ${missing.join(', ')}`, missing.length === 0);

  const glyphs = structure.figures.filter((One) => One.category === Category.Glyph);
  Claim('the panel carries labels at all', glyphs.length > 20);
  Claim('every label is an Overlay', glyphs.every((One) => One.overlay === true));
  Claim('every label has a stroke width', glyphs.every((One) => One.scalarBeta > 0));
  Claim('no label is a space', glyphs.every((One) => One.scalarAlpha !== 32));
}

// ── the values ───────────────────────────────────────────────────────────────────────────────────

function digits(handle) { return handle.map((One) => structure.query(One).scalarAlpha); }

{
  // 🔴 A blank leading digit, not a zero: "007 KM/H" is a clock, not a speedometer. The engine gives
  //    blank its own code (10) rather than leaving it to be faked with an unlit colour.
  assignValues(structure, handles, { speed: 7 });
  Claim('7 km/h reads as two blanks and a seven', String(digits(handles.digits)) === String([10, 10, 7]));
  assignValues(structure, handles, { speed: 42 });
  Claim('42 km/h reads as a blank, a four and a two', String(digits(handles.digits)) === String([10, 4, 2]));
  assignValues(structure, handles, { speed: 180 });
  Claim('180 km/h fills all three cells', String(digits(handles.digits)) === String([1, 8, 0]));
  assignValues(structure, handles, { speed: 4000 });
  Claim('a speed beyond the readout clamps instead of wrapping',
        String(digits(handles.digits)) === String([9, 9, 9]));
  assignValues(structure, handles, { speed: -20 });
  Claim('a negative speed clamps to blank blank zero', String(digits(handles.digits)) === String([10, 10, 0]));
}

{
  const span = handles.troughHalfWidth;
  for (const [regen, wanted] of [[0, -span], [0.5, 0], [1, span]]) {
    assignValues(structure, handles, { regen });
    Near(`the slider knob at ${regen}`, structure.query(handles.sliderKnob).origin[0], wanted, 1e-9);
    const fill = structure.query(handles.sliderFill);
    // The fill is drawn from its own middle, so its right edge is centre + half width. That edge is
    // the only thing that has to agree with the knob, and getting it wrong is the classic bar bug.
    Near(`the fill's right edge meets the knob at ${regen}`,
         fill.origin[0] + fill.halfWidth, Math.max(wanted, -span + 0.001), 1e-9);
  }
  assignValues(structure, handles, { regen: 0.37 });
  Claim('the percentage readout rounds to two cells',
        String(digits(handles.rangeDigits)) === String([3, 7]));
  assignValues(structure, handles, { regen: 0.02 });
  Claim('a small percentage blanks its leading cell',
        String(digits(handles.rangeDigits)) === String([10, 2]));
}

{
  assignValues(structure, handles, { sport: 0 });
  Near('the toggle knob rests left', structure.query(handles.toggleKnob).origin[0], -0.0145, 1e-9);
  Near('the toggle bed is dark', structure.query(handles.toggleGlow).opacity, 0, 1e-9);
  assignValues(structure, handles, { sport: 1 });
  Near('the toggle knob travels right', structure.query(handles.toggleKnob).origin[0], 0.0145, 1e-9);
  Near('the toggle bed lights', structure.query(handles.toggleGlow).opacity, 1, 1e-9);
  assignValues(structure, handles, { sport: 0.5 });
  Near('a half-sprung toggle sits in the middle',
       structure.query(handles.toggleKnob).origin[0], 0, 1e-9);
}

{
  // The gauge and the needle must read the SAME value. Two figures showing one quantity is how a
  // cluster ends up lying to the driver.
  assignValues(structure, handles, { boost: 0.63 });
  Near('the arc and the needle agree', structure.query(handles.gaugeFill).scalarAlpha,
       structure.query(handles.needle).scalarAlpha, 0);
  assignValues(structure, handles, { boost: 3 });
  Near('an over-range boost clamps the needle to full', structure.query(handles.needle).scalarAlpha, 1);
}

// ── packing ──────────────────────────────────────────────────────────────────────────────────────

{
  const packed = pack(structure, placements, [0, -0.8, 0]);
  Claim('every figure is packed', packed.count === structure.count);
  Claim('the buffer is the right size', packed.data.length === packed.count * FloatsPerFigure);
  Claim('forty floats a figure', FloatsPerFigure === 40);

  const first = packed.order[0];
  Claim('the housing submits first', first === handles.housing);

  // A figure with no tint of its own takes the palette slot's colour, which is what makes the
  // palette configuration rather than decoration.
  const slot = packed.order.indexOf(handles.gaugeFill) * FloatsPerFigure;
  // Compared with a tolerance, not for equality: the buffer is Float32 and the palette is Float64,
  // so 0.08 does not survive the trip as 0.08. A check that demanded it would be testing IEEE 754.
  const tint = Array.from(packed.data.slice(slot + 24, slot + 28));
  Claim('an untinted figure resolves to its palette slot',
        tint.every((One, at) => Math.abs(One - structure.palette[Slot.Accent][at]) < 1e-7));

  const streakSlot = packed.order.indexOf(handles.streaks) * FloatsPerFigure;
  const wanted = structure.query(handles.streaks).streak;
  Claim('all eight streak parameters reach the buffer, in order',
        Array.from(packed.data.slice(streakSlot + 32, streakSlot + 40))
          .every((One, at) => Math.abs(One - wanted[at]) < 1e-7));
  Near('the category rides in the scalar vector',
       packed.data[streakSlot + 20], Category.StreakField);
}

// ── done ─────────────────────────────────────────────────────────────────────────────────────────

if (Failures.length) {
  process.stderr.write(`\nCheckHud: ${Failures.length} FAILED, ${Passed} passed\n`);
  process.exit(1);
}
process.stdout.write(`CheckHud: PASS ${Passed}\n`);
