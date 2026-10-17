# Empty documents and interactive sketch construction

## Reference retained alongside the editor

`Reference/index.html` is an unchanged snapshot of the configured GitHub Pages source for
https://sultanaladin.github.io/Frontier-/solidarc/ . Its pinned commit, SHA-256, provenance
and source-vs-deployment distinction are in `Reference/README.md`. Open
`http://<editor-preview>/Reference/index.html` to inspect it without replacing the GPU editor.

## Browser / HTML workflow

* Fresh storage starts with **zero figures**, not Mount. Examples remain explicit choices.
* A recoverable autosave offers **Welcome back → Continue previous / New document / Open .arc**.
* New Document retains a previous recovery copy. Construct → **Restore previous document**
  reopens it; it is also available after drawing in the new document.
* Autosave is debounced 600 ms after edits. Native `/native` action `snapshot` returns only the
  `.arc` journal, not a scene/frame packet. It does not mark the UI busy, rasterize, upload
  geometry or redraw. Camera navigation/drawing defers it. Storage failures warn the user;
  explicitly save an `.arc` before closing important work. This is browser-origin storage,
  **not cloud persistence**, and is not a crash-proof last-keystroke guarantee.
* Construct → Reference → **Workplane** chooses XY/XZ/YZ and a normal offset in metres.
  Drawing intersects that plane, not an arbitrary screen-depth or a ring of preset positions.
* Construct → Sketch Draw arms a tool; **nothing is authored until the required clicks finish**.
  - Line: start, end.
  - Rectangle: first corner, opposite corner. Centre rectangle: centre, corner.
  - Circle: centre, radius; the Defined by selector also offers diameter endpoints.
  - Arc: centre, start, end (counter-clockwise).
  - Ellipse: centre, major-axis end, minor radius.
  - Slot: first centre, second centre; end radius is editable in the prompt.
  - Polygon: centre, radius, then click/Enter to confirm; wheel or field changes side count.
  - Polyline/spline/control curve: successive points; Enter/right-click finishes.
* Esc cancels a draft without an edit; Backspace removes the last point. Construction and
  closed-polyline switches are available in the prompt. Alt-drag/middle navigation remains
  available while drawing. Tab/right-click opens Construct; L/R/C/A/P and Shift+L/Shift+E
  arm the corresponding sketch tools when not typing in a field/dialog.
* Width/height, length, radius/diameter, ellipse axes, polygon sides and arc angle appear as
  spatial live dimensions. Geometry/guide strokes use the existing **WebGL2 segment pipeline**;
  HTML text uses the same locally bundled **DM Sans** as the UI. No Canvas2D image is uploaded.
* Solid/surface tiles now open explicit numeric/command controls instead of inserting a
  hardcoded-sized object at a random/ring location. Their full click-to-draw tools are not
  part of this pass.

`WorkspaceFlow.js` owns UI/recovery/modal sequencing. `DrawingSequence.js` produces only
transient rubber-band presentation; spline/control-curve previews currently show the control
polygon, not an exact live NURBS evaluation. Native `draw <tool> (u,v)...` validates the whole
sequence, uses **the existing C++ ToolSession/NURBS builders**, and edits once, so Undo removes
one completed drawing. No browser mesh becomes the saved model. New draw journals require
this updated native binary; the retained legacy WASM module was not rebuilt.

## Native C++ / ImGui counterpart

`SolidArcEditorHost` now connects the actual viewport Construct chip to a modal catalogue,
with Reference workplane controls and the same native sketch tools. Tool input is still
`ToolSession`, fed by `ConsoleHost::ReceiveInput`, not HTML geometry code. Native Slot has
an additional radius click; native Polygon completes on its radius click and uses Up/Down
or numeric entry for sides. These are documented differences from the browser prompt flow.

`ToolPreview::Dimensions` contains world-space dimension strokes and labels. Both injected
GPU-command devices and the CPU raster receive the strokes; ImGui draws text with the UI
font. The headless editor proof explicitly loads the same `DMSans-Regular.ttf` as the browser.

Native **New document** clears figures, dimensions, named planes, constraints, undo and
journal via `StartEmptyDocument`; the old script-oriented `reset` behavior remains intact.
Recovery uses `_AgentScratch/autosave/SolidArc.arc` and `.previous.arc`, or the path specified
by `SOLIDARC_RECOVERY_FILE`. On an empty native startup, an existing recovery file offers
Welcome back / Continue / New. Native autosave waits for stable geometry for 600 ms and does
not run during a live tool/gizmo drag. The interactive C++ mirror now starts empty/recoverable;
only the noninteractive regression proof seeds example geometry. The thin CPU mirror advances
only on input, so its recovery timing is tick-driven; it is not a background desktop event loop.

The exact C++ HTML mirror remains a **CPU-reference transport**, not the browser GPU editor:

```sh
python3 Tools/Build/RunSolidArcEditorProof.py
python3 Tools/Build/ServeSolidArcMirror.py --port 8082
```

## Verification

From `Experimental/SolidArc`, with the native service and Vite running:

```sh
npm test                       # 17 native tests, including atomic draw, all sketch builders, .arc replay, snapshot
npm run verify:workflow        # 9 real browser workflow groups
npm run verify:browser         # 12 existing integration groups, example explicitly loaded by fixture
npm run verify:interaction     # 8 navigation/gizmo/layout groups
npm run verify:gpu             # 8 GPU/resource/appearance groups
npm run verify:performance     # native camera parity + no per-motion HTTP/uploads/readbacks
npm run verify:transport       # 3 startup/error-path groups
npm run test:transport         # 6 packet-contract tests
npm run build
```

Set `BROWSER_EXECUTABLE` for Chromium, `SOLIDARC_URL` for the editor URL, and optionally
`BROWSER_ARTIFACTS` for screenshots/proofs. The native headless proof additionally verifies
the actual Construct button, an empty document with no leftover dimensions, real rectangle
pointer preview/completion, spatial W/H labels, shared font and undo. Images are generated
under ignored `Exhibits/Gallery/Editor/EditorProof_SolidArc_{Empty,Construct,Drawing}.png`.

## Deliberate boundaries

This is the requested startup + core 2D drafting pass, **not a claim that the entire reference
application has been ported**. Datum/sketch points, polyline slot, workplane tilt/extent/face
attachment, object snapping in browser drafts, clockwise arc mode, constraint/modify/pattern
catalogues, and the complete reference solid-tool workflow remain unported. Exact spline
rubber bands, native/browser prompt parity and persistent editable dimensions on modal-drawn
NURBS are also follow-up work. Existing numeric native modeling tools remain available.
Physical-GPU/embedded frame rate, native Vulkan completion, fresh WASM and publishing remain
unverified/unfinished as recorded in `RENDERING_REPAIR_STATUS.md`. No commit or push was made.

## Native C++ mouse-path evidence (15 October 2026)

Run `python3 Tools/Build/RunSolidArcEditorProof.py` from the repository root.
The rectangle regression now clicks the actual native **Construct** button, finds the
native **Rectangle** tile's item bounds, clicks that tile, and sends both corner clicks
through `ImGuiIO::AddMousePosEvent` / `AddMouseButtonEvent`. It no longer executes a
`tool rect` or `point` command from the test. Native UI callbacks naturally dispatch
commands into the existing C++ tool session; pointer events go through the editor's
`AdvanceInput` and `ConsoleHost::ReceiveInput` path. Moving to the second corner leaves
the document empty and produces two live dimensions; the second click authors one
rectangle, with a single undo transaction. Test setup still uses commands for camera
and the separate pre-existing gizmo fixture.

Generated C++ visual evidence in `Exhibits/Gallery/Editor/`:
- `EditorProof_SolidArc_Empty.png`: native empty workspace.
- `EditorProof_SolidArc_Construct.png`: real native selectable catalogue.
- `EditorProof_SolidArc_Drawing.png`: native preview, DM Sans width/height labels.
- `EditorProof_SolidArc_Completed.png`: completed native document.
- `EditorProof_SolidArc_Scene.png`: scene-only C++ raster, without UI composition.

The shell now follows the approved browser workspace's tab/header, three rounded
panels, Geometry collection, Bodies/Sketches census, Construct section/tile catalogue,
empty Inspector and viewport camera controls, using actual shared C++ panels. It does
not embed a browser or paint a browser screenshot. **This is not exact UI parity yet:**
the native host remains single-document (the plus action starts a replacement document),
solid/surface construction uses an editable native command-parameter popup rather than
the browser's field forms, and workplane reference controls are simplified. Browser-only
catalogue/dimension editing gaps listed above still apply. The approved browser CSS
has not been changed for this native-shell work.

These images are native **CPU reference** evidence, not proof of native Vulkan rendering
or physical-GPU performance. The proof uses a fixed simulated frame timestep; on-screen
FPS readouts are not a benchmark. Inputs are native ImGui IO events in a headless executable,
not evidence of a physical OS window/input backend. No `CLAUDE.md`/`claud.md` was found
in this checkout. Native Vulkan, exact remaining UI parity and physical desktop input
verification remain outstanding.

### Native CAD follow-up

The native name-first outliner, direct document roster, icon tiles, Polyline Slot,
point tools and journalled tool settings are now implemented and covered by the
native proof. The old gaps list above is historical; the current detailed inventory
and remaining parity work are in
`Editor/AuthoringTools/Modelling/SolidArc/NATIVE_UI_PARITY.md`.
Regenerate the self-contained offline evidence page with
`python3 Tools/Build/GenerateSolidArcProofGallery.py` after running the native proof.


The latest native proof now mouse-tests 14 Sketch/Reference Construct tools using
816 interpolated native pointer moves plus placement clicks, preview/non-commit
checks, completion and undo. `GenerateSolidArcProofGallery.py` now embeds a native-frame
rectangle APNG, 26 still rasters and the JSON results, with lossless PNG compression.
Filter, Orbit and projection share the black/grey colour variant. Remaining operation
scope and the CPU/headless evidence limits are recorded in `NATIVE_UI_PARITY.md`.

### Native orbit animation and Inspector counterpart — 15 October 2026

The C++ counterpart now follows `RefreshInspector()`'s selected geometry cards,
counts, three tabs, Dimensions, world Bounds, Operations and Presentation, plus
its empty-state Box / Circle / Rectangle / Extrude roster. No browser layout/CSS
was changed. Native transforms include world position, rotation, axis and uniform
scale; they currently commit with Apply rather than the HTML's immediate fields.
Native solver actions still use explicit command-parameter popups; the complete
HTML operation-specific forms and precise icon/spacing parity remain unfinished.

`Exhibits/Gallery/Editor/SolidArcProofs.html` is offline/self-contained and begins
with `SolidArcOrbit.gif`: 10 C++ captures from a 32-step native RMB mouse orbit,
about 50 degrees yaw. Native Inspector screenshots follow in the same gallery.
A native widget test renames/restores a body, types X=0.25, applies it, checks the
geometry delta, and undoes it. The 14-tool Construct sweep still passes.

Reproduce the full suite with `python3 Tools/Build/RunSolidArcEditorProof.py`.
For a focused rerun after building:
`.cache/solidarc-editor/SolidArcEditorProof --inspector-orbit-only`.
GIF packaging needs Pillow (`python3 -m pip install --target .cache/proof-python Pillow`),
then `python3 Tools/Build/GenerateSolidArcProofGallery.py`. GIF palette encoding is
lossy; still PNG packaging is lossless. Playback is illustrative native-input/CPU
proof, not a native GPU performance measurement. The live mirror must be restarted
after rebuilding; `/version` must report `restartRequired: false`.

### Visible animations and same-origin GPU drawing preview

The native mirror homepage now opens on the **orbit GIF itself**, not the live CPU
image with a difficult-to-find gallery link. The **Construct + drawing** tab shows
`SolidArcGpuDrawing.gif` (Construct menu, rectangle preview/commit, circle
preview/commit), followed by clearly labelled native CPU catalogue/drawing evidence.
The **Open GPU drawing editor** link opens this unchanged HTML workspace at `/gpu/`.
Build with `npm run build -- --base=/gpu/`; run `Native/ServeSequence.py` on 8081
alongside `Tools/Build/ServeSolidArcMirror.py --port 8082`. Browser `/native` requests
are proxied on the same origin, never to browser-local localhost.

`Tools/Build/RunSolidArcGpuDrawingProof.mjs` records actual menu and pointer input,
checks native figure commits and WebGL calls, and stores renderer/input evidence.
The gallery generator encodes its screenshots into the drawing GIF. Sandbox capture
uses SwiftShader and labels it as software WebGL2; physical GPU and native Vulkan
are **not** claimed. The GPU path draws geometry/grid/overlays through shaders,
with zero CPU scene-RGBA uploads. Tests also checked that both homepage GIFs are
visible and actually change pixels, and that `/gpu/` starts empty without JS errors.

### All-view grids and drawing-plane placement

HTML was implemented/tested first, then the C++ editor counterpart. Named camera
views now select the matching drawing plane: **Top/Bottom → XY**, **Front/Back →
XZ**, **Right/Left → YZ**. X is red, Y green, Z blue. Isometric and free orbit retain
the active workplane rather than switching it during camera motion. Custom
workplane offsets affect both grid rendering and shape placement. Changing named
views cancels incomplete drawings so old UV points cannot move to another plane.

The same plane basis is used by the shared `.slang` lattice shader, the HTML
mouse-ray intersection, live GPU preview strokes and native C++ geometry commit.
Grid depth is computed from its world-space ray intersection. Axis strokes are
slightly stronger than minor grid lines for visibility. This is drawing **on the
plane at the mouse position**; no new quantized snapping mode is implied.

Run `node Tools/Build/RunSolidArcViewGridProof.mjs` from the repository root with
Playwright Chromium (optional `BROWSER_EXECUTABLE` / JSON `BROWSER_ARGS`). The test
covers all six standard views, Isometric retaining YZ, framebuffer axis colours,
preview/noncommit, native bounds at the mouse locations, and an offset plane.
The matching C++ proof is `.cache/solidarc-editor/SolidArcEditorProof --view-grid-only`
after building it. Native tests also verify all points are coplanar, save/reopen
and one-step undo. Full 14-tool native regression remains passing.

The mirror homepage's **View grids + drawing** tab now presents the HTML animation
first and the native counterpart next; the gallery generator embeds these GIFs
when their test captures exist. The HTML recording uses sandbox software WebGL2;
the C++ recording uses CPU SlangMirror. Neither is physical-GPU or native Vulkan
proof. The actual browser drawing route continues to use WebGL2 draw calls without
CPU scene-image uploads. Both services must be restarted after rebuilding C++.

## 16 October: reference dimensions, shape kinds and orientation cube

The retained reference was rechecked against the configured Pages source and has the
same SHA-256 (`fb769872…169b695`). Live dimensions now use white 1 px strokes, filled
7 × 6 px arrowheads, 18 px black/.72 capsules with radius 9, and 11 px UI text
(DM Sans, as permitted). Display values convert the native metre coordinates to mm;
the kernel's units have not changed. Radius/diagonal diameter, rectangle offsets,
polygon spokes/central and interior angle annotations and warm angle guides are
presentation, not authored constraints. The shared lattice shader now uses subdued
reference-style minor/major grid contrast, retaining all-view colored axes and planes.
This is a styling/workflow match, not a claim of whole-page pixel-identical rendering.

The bottom-right orientation widget is now a projected 3D cube with hidden-face
rejection, six selectable faces and a colored camera-linked axis triad. HTML submits
cube surface triangles and line streams to the existing WebGL2/shared Slang path;
native `ViewportPanel` submits projected cube triangles through the shared ImGui
UI (rendered by its GPU backend in an engine build). A face selects the appropriate
standard view **and workplane**. Native cube dragging retains its orbit interaction;
browser orbit remains the existing viewport mouse interaction. The selected-object
transform gizmo is independent and is not replaced. Native screenshots are headless
CPU raster proofs, not verified native Vulkan execution.

`SceneFigure::ShapeKind` records authoring identity independently of the editable name.
Both outliners choose per-shape glyphs from the exported kind, rather than calling every
curve a spline or guessing from names. Copy, undo and journal replay preserve it.
Construct adds Polyline Slot, Point, Datum Point, three-point Circle and three-point Arc;
Diameter Circle remains available through Circle's mode selector (and its native tile).
Three-point Arc uses **start, end, through**, matching native ToolSession. Polyline Slot
uses repeated centre clicks, an editable radius, and Enter/right-click completion.
HTML rubber bands are non-authoritative presentation; committed NURBS come from C++.

Verification:
- `python3 Experimental/SolidArc/Native/GeometryMetrics.py`: 18 checks, including all
  27 catalogue entries and kind preservation after rename/save/reopen/undo.
- `node Experimental/SolidArc/src/WorkflowMetrics.mjs`: nine workflow checks.
- `node Tools/Build/RunSolidArcCurveCubeProof.mjs`: five new mouse-selected tools,
  native commits, registered icons, undo/redo, six face clicks, orbit-linked cube;
  WebGL2/SwiftShader, zero CPU fragments/RGBA uploads, no JS errors.
- `python3 Tools/Build/RunSolidArcEditorProof.py`: 17 native mouse-selected tools,
  1,008 interpolated moves, valid NURBS, one-step undo.
- `.cache/solidarc-editor/SolidArcEditorProof --orientation-only`: six native face
  clicks, each required to correct an intentionally wrong workplane.
- `python3 Tools/Build/GenerateSolidArcProofGallery.py`: embeds current evidence in
  `Exhibits/Gallery/Editor/SolidArcProofs.html`, viewable without publishing.

Live mirror: port 8081; browser GPU route `/gpu/`, native CPU-input mirror `/cpp`,
embedded gallery `/proofs`, same-origin native geometry service on 8083.
Rebuild **and restart both services** after native changes; a new gallery alone does not
refresh a running native executable. No commits or pushes were made for this work.

### Viewport rotation and face UV correction

Viewport mouse navigation now uses screen-space orbit: an axis/angle rotates the eye
**and camera up** together around the existing fixed target. It no longer just adds
world yaw and clamped elevation, which spun horizontally at Top/Bottom and prevented
smooth pole crossings. Pivot, eye-to-pivot distance, drawing plane and object geometry
are unchanged. The camera carries a roll value solely to retain its orientation through
these transitions; it is not an independent "tilt camera" gesture. Native and predicted
HTML matrices agree, including nonzero roll. Named views reset roll to zero.

`CameraProjection::OrbitScreen` mirrors `MoveCamera(..., "orbit")`; right/up and view
matrices use that orientation. Browser/native vertical drag signs and sensitivity now
match. Native input journals accept legacy 19-field records and new 20-field records
containing roll; browser/native synchronization and recovery preserve roll too.
The legacy console `view orbit` angle command retains its yaw/elevation semantics.

Cube labels now follow each face's actual U/V directions. HTML maps its UI-font label
square through the projected face basis; native ImGui remaps real font glyph vertices
through the same face basis. Text rotates, shears and foreshortens with its face rather
than remaining a floating screen-facing label. The axis-tip letters remain billboards.

Additional checks:
- `node Tools/Build/VerifySolidArcOrbit.mjs`: 28 native/HTML camera steps over all seven
  named views, fixed target/radius, pole escape, full ViewClip/ViewWorld/ClipView parity.
- `node Tools/Build/RunSolidArcOrbitUvProof.mjs`: real browser mouse drags from Top,
  Bottom and Iso; fixed target/distance, face-label affine mapping, zero CPU uploads.
- Native `--orientation-only`: six cube face clicks plus a horizontal mouse orbit
  from Top (24 moves), verifying eye motion on the target sphere and no pivot drift.
- `python3 Tools/Build/GenerateSolidArcOrbitUvProof.py`: embeds fresh browser GIF/stills
  and C++ CPU proof images in `Exhibits/Gallery/Editor/SolidArcOrbitUvProof.html`.

### Correction: RIGHT-button rotation axes

Right-drag is explicitly **CAD turntable rotation**, not the screen-up/free-orbit mode:
- Horizontal RMB motion changes yaw around world Z only; elevation is unchanged.
- Vertical RMB motion changes elevation around the horizontal camera-right axis only.
- Roll is zero; pivot, distance and object geometry do not change.
- Middle-drag or Shift+right-drag pans. Plain RMB must NOT be classified as pan.
- Left/Alt free-orbit and the UV-mapped cube labels are unchanged.

The browser previously classified button 2 as pan, and the native RMB path used the
screen-space orbit function from the previous correction. Both are now explicitly
mapped to the same `turntable`/`CameraProjection::Orbit` path. Browser buttons number
RMB as 2; native ImGui numbers it as 1. Both native transport and local prediction
use the corrected mapping. Active drawing tools still reserve RMB to finish/cancel.

`RunSolidArcRightDragProof.mjs` tests actual right-button mouse drags from Iso, Front
and Right, independently checking each axis, no pan/roll, fixed radius and Shift+RMB
pan. `VerifySolidArcOrbit.mjs` adds ten native/HTML axis-isolation cases. Native
`--orientation-only` now tests RMB horizontal/vertical axes separately; its pole
escape test uses Alt+left free-orbit. Evidence distinguishes WebGL2/SwiftShader from
native C++ CPU raster; neither is physical-GPU execution evidence.

### Superseding correction: upright navigation for EVERY drag (screenshot regression)

The screen-up/free-orbit path introduced above was incorrect for the requested CAD
navigation: it could produce the rolled Front view shown in the user's screenshot.
It is now removed, **including left and Alt-left**, not merely bypassed for RMB.
All orbit entry points use world-Z yaw / camera-right elevation with no roll.
`OrbitScreen` is a backwards-compatible alias for upright `Orbit`, not arcball.
Horizontal-only movement leaves elevation unchanged, including named Top/Bottom.
World Z remains screen-up (camera-right Z component exactly zero), elevation is
clamped before crossing a pole, and the orbit centre/distance remain unchanged.
The UV-mapped cube text is retained; cube vertical edges track the same upright basis.

Legacy browser camera copies, native camera synchronization and old 20-field input
records discard roll. Native rendering also ignores any legacy roll field. This
prevents an old recovery/journal camera from resurrecting the tilted orientation.

Current evidence: `RunSolidArcUprightProof.mjs` checks 12 combinations (Iso/Front/
Top/Bottom × RMB/LMB/Alt-LMB), at 12 actual mouse moves per combination, asserting
zero roll, world-Z screen-up and fixed pivot/distance; injected legacy roll also
restores upright. WebGL2/SwiftShader, zero CPU frame uploads. Native matrix parity
and mouse input checks pass too. Older free-orbit/pole-escape descriptions and images
above are historical and superseded by this correction.

## Explicit curve drawing and catalogue scrolling (2026-10-16)

Sketch Draw now contains **Hermite, Bézier, B-spline and NURBS** as separate
interactive tools (31 catalogue entries total). They are also in the native ImGui
Construct catalogue. Both catalogues have constrained scroll containers; browser
flex/grid minimum heights no longer push lower tiles outside the popover.

- Hermite: click start, end, start tangent handle, incoming end tangent handle.
  The cubic uses derivatives `H0 - P0` and `P1 - H1`; its Bézier controls are
  `P0`, `P0 + (H0-P0)/3`, `P1 + (H1-P1)/3`, `P1`.
- Bézier: click two or more control points; Enter/right-click finishes.
- B-spline: click control points, select degree 1–7, Enter/right-click finishes.
  Clamped uniform knots; effective degree is at most point count minus one.
- NURBS: the B-spline workflow plus comma-separated positive weights, exactly
  one per control point. Empty weights use all ones. Browser weights update the
  preview immediately; the native weights field applies on Enter.

Final curves are built by C++ `ToolSession` in a single undoable transaction;
`Vec4::Weighted` gives actual rational geometry. The browser samples mathematical
rubber bands and dashed control/tangent guides into the existing WebGL2 segment
pipeline; those strokes are not authored geometry. This updates the default native
transport; optional `VITE_SOLIDARC_TRANSPORT=wasm` deployments must rebuild the
runtime with Emscripten before using the new commands (the retained WASM binary
has not been regenerated here).

Validation: `Native/GeometryMetrics.py` passes 19 tests, including all 31 catalogue
commands, four curve transactions, weighted versus unit-weight sampled geometry,
and invalid weights/degrees without scene mutation. `SolidArcEditorProof` passes
21 own-mouse native tool cases / 1,392 interpolated pointer moves, native wheel
scrolling, per-tool geometry validation and undo. `RunSolidArcCurveDrawingProof.mjs`
uses browser wheel input and real canvas clicks for all four explicit curves,
checks every point is registered, the pole counts, undo/redo and zero RGBA uploads.
`GenerateSolidArcCurveProof.py` embeds the actual images and JSON in
`Exhibits/Gallery/Editor/SolidArcCurveProof.html`.
The browser proof uses software SwiftShader WebGL2; native raster evidence is the
C++ CPU reference, not a claim of hardware GPU execution.

## Ordered selection and contextual loft Inspector (2026-10-16)

Whole-figure selection now carries a native click-order stamp. `OrderedSelection`
feeds both the Inspector and native `loft selected` / `sweep selected` collection;
the most recently selected remaining figure is active. Browser native selection
journal persistence preserves this order rather than silently sorting back into
document order. Selection order is included in render and undo fingerprints.

Selected curve strokes are **green for active** and **blue for other selected**
curves, with no orange shader highlight blend applied to those strokes. The same
DrawRecord tints reach WebGL2 and the native CPU/GPU raster interface. Browser
outliner badges and the Inspector show numbered operands and the active item.
Inspector rename/visibility/topology target the active figure, not the first
section. Both Inspectors provide **Reverse order**.

`ConsoleHost::CurveSelectionOperations()` is the shared eligibility source:
- one whole curve: Extrude, Revolve, Pipe;
- two or more whole curves: Loft;
- exactly two: Sweep (profile, then path), Ruled Surface;
- exactly two open curves: Bridge;
- endpoint-connected curves accepted by `ProfileSolver::Joined`: Join.
Mixed/locked/hidden/sub-element curve selections do not advertise these operations.
Eligibility checks operand contracts; modelling solvers still validate geometry
on Apply and report refusals. The native Inspector uses the same list as browser
`description.selectionOperations`; it is not a browser-only operation catalogue.

Browser loft parameters include degree 1–7 and automatic solid/sheet versus forced
sheet. Both Inspectors activate the result using the journalled `--select-result`
flag, inside the operation's undo transaction (not a separate selection undo step).
The native Inspector retains its explicit native parameter editor. The retained
optional WASM binary must be rebuilt with Emscripten to acquire these new exports;
the live/default transport uses the freshly built native C++ service.

Validation: 23 `Native/GeometryMetrics.py` tests; native
`SolidArcEditorProof --loft-only` mouse-selects two profile fixtures, Shift-adds,
reverses in the Inspector, clicks Loft and Apply, validates the resulting solid,
and checks one-step undo/redo. `RunSolidArcLoftProof.mjs` tests actual browser
outliner AND viewport selection, native green/blue draw packets, compatible
buttons, ordered dialog operands, loft Apply, result selection and undo/redo.
`GenerateSolidArcLoftProof.py` embeds browser/native PNGs and JSON in
`Exhibits/Gallery/Editor/SolidArcLoftProof.html`. Browser evidence uses software
SwiftShader WebGL2; native screenshots use the C++ CPU reference renderer.

## Contextual face extrusion / E (2026-10-16)

- **Face mode (3) → select one face / Shift-select multiple → Inspector Extrude or E.**
  Both browser and actual native ImGui open parameters before any geometry edit. Escape
  cancels; typing E in fields, an existing modal or an active sketch does not start extrusion.
  E on one selected sketch profile preserves curve extrusion; the browser also exposes
  workplane/world-axis direction and automatic solid/sheet versus forced-sheet output.
- `faceExtrusion` metadata comes from C++ `FaceExtrusionSelection` / `CanPushFaces`.
  Normal region requires parallel outward normals; differing normals select Individual and
  disable Normal. Normal moves internal selected-selected seams with the cap and builds
  walls only on region boundaries. Individual builds separate cap/wall extrusions per face.
- Command: `extrudefaces selected 0.5 --mode=normal|individual`, or explicit targets such as
  `extrudefaces #1:f1 #2:f1 0.5 --mode=normal`. The codec recognises hash-prefixed topology
  operands without confusing them with comments. `key e` / `extrude-options` requests the
  native parameter panel, not the former unimplemented `tool extrude` tool; that legacy
  spelling now forwards to the parameter request. UI requests aren't journaled.
- Kernel operations are actual B-rep edits, not browser vertex offsets: they use the existing
  exact planar `DirectPlanarPush` / native `PushFace` routes and a shared-region boundary
  builder. All body results are staged before committing. Existing body IDs/cap selection
  remain; blueprint/recipe is detached and dimensions regenerated. One Apply = one Undo.
- Supported: positive-distance planar faces/regions and existing supported individual
  cylinder/cone face push routes. Arbitrary curved multi-face regions, averaged normals,
  inward cuts, locked/hidden/mixed selections and invalid/duplicate operands refuse
  without partial source edits. Native curved-source eligibility is a preliminary check;
  the solver can still refuse unsupported trimmed cylinder/cone configurations on Apply.
- **27/27 native metrics pass**, including shared-rim seams, atomic multi-body failures,
  individual normals, non-mutating E, save/reopen and undo/redo. Actual browser mouse and
  native C++ own-mouse E/Inspector proofs pass, as do existing native/browser loft and
  upright orbit regressions. Proof adapters: browser software SwiftShader WebGL2 (zero
  CPU fragments/RGBA uploads); native C++ CPU-reference raster, not physical GPU proof.
- Reproduce: `python3 Experimental/SolidArc/Native/GeometryMetrics.py`,
  `python3 Tools/Build/RunSolidArcEditorProof.py --build-only`,
  `.cache/solidarc-editor/SolidArcEditorProof --extrude-only`,
  `BROWSER_EXECUTABLE=/path/to/chromium node Tools/Build/RunSolidArcExtrudeProof.mjs`,
  `python3 Tools/Build/GenerateSolidArcExtrudeProof.py`.
  Portable, embedded screenshots and check data:
  `Exhibits/Gallery/Editor/SolidArcExtrudeProof.html`.

## Disabled operation eligibility / coplanar solid loft

Inspector operation metadata now includes `enabled` (default true). Browser buttons use
native `disabled` / `aria-disabled` and grey styling; native ImGui uses `BeginDisabled`.
Both retain the operation and show its reason as a tooltip instead of hiding it. Direct
browser `OpenTool` calls also respect disabled metadata.

Closed profiles all lying in one support plane disable the default **solid Loft** action:
the result would have zero thickness. `SkinSolver::CoplanarClosedSections` tests rational
control points against a real support plane within merge tolerance; this works for XY,
vertical and oblique profiles, and does not mistake equal Z bounds for coplanarity. Moving
a section out of the plane re-enables Loft. The same predicate rejects default solid loft
inside the C++ solver, preserving atomic refusal even for direct console/recipe calls.
Open coplanar profiles remain eligible for sheets; intentional closed-profile sheet output
is still available explicitly with `loft selected --sheet`.

30/30 native metrics pass. Additional native own-mouse proof:
`.cache/solidarc-editor/SolidArcEditorProof --loft-disabled-only`.
Browser proof: `node Tools/Build/RunSolidArcLoftEligibilityProof.mjs` (with configured Chromium).
Both verify disabled clicks do nothing, separation re-enables Loft, and enabled Apply
creates a real solid. Existing browser loft and native/browser face Extrude proofs pass.
`python3 Tools/Build/GenerateSolidArcLoftEligibilityProof.py` generates the portable embedded
`Exhibits/Gallery/Editor/SolidArcLoftEligibilityProof.html`.

## Bottom sketch toolbar: Cut / Trim

The floating monochrome **Select / Cut / Trim** toolbar follows the bottom of the viewport
in browser and native ImGui (including docked/moved viewports). These are sketch-curve
edits, not body booleans or surface-face trims. No additional placeholder tools were added.

- Cut → click a curve: exact `NurbsCurve::Split` at its closest picked parameter. Open curves
  become two pieces. Closed curves split at the click **and their existing seam**; clicking
  a seam/endpoint refuses rather than creating zero-length geometry.
- Trim → click inside the interval to remove: existing `ProfileSolver::Trimmed` intersects
  the curve with other visible curves and removes that interval, retaining cutters. Open
  ends can also bound intervals. Clicking an intersection boundary refuses.
- Select / Escape exits. Dragging does not edit. Browser Alt-drag navigation remains
  available while armed. Existing sketch drawing disables editing buttons; Select cancels
  the draft explicitly. No pointer edit is performed just by arming a toolbar button.
- `SketchTools()` supplies cached native `cut` / `trim` eligibility and tooltip reasons.
  No editable visible curve → Cut disabled; no trimmable crossing interval → Trim disabled.
  Hidden/locked targets are rejected; locked visible curves may still serve as references.
- Both UI paths use `SketchEditAtPixel`: coarse native curve tessellation narrows candidates,
  then exact curve evaluation refines the screen parameter. No CPU framebuffer is rendered
  for browser picking. Native ImGui supplies its own mouse inputs. Browser `sketchEdit`
  transport invokes the same C++ helper with scale-aware pixel tolerance.
- The helper executes a canonical world-point `cut` / `trim` command, not a pixel-dependent
  journal event. Replay does not require the original viewport/camera. All pieces validate
  before mutation; the first piece keeps the original ID, extra pieces keep construction,
  feature/material metadata, and obsolete recipes/blueprints detach. Source dimensions
  regenerate. Both resulting pieces are selected within the same undo transaction.
- Commands: `cut #1 (0,0,0) --select-result`,
  `trim #1 (0,0,0) --by=#2,#3 --select-result` (or omit `--by` for other visible curves).
  This first toolbar pass targets the current native transport; the retained legacy WASM
  bundle has not been rebuilt and does not advertise these toolbar capabilities.

**Verification:** 35/35 native metrics pass (split, exact arcs, interval trim, preserved
cutters, refusals, hidden geometry, canonical replay and undo/redo). Actual native own-mouse
and browser toolbar/viewport tests pass. Native also verifies locked eligibility; browser
also checks drag cancellation, armed navigation and drawing-mode protection. Existing
native/browser face Extrude and disabled Loft proofs, plus upright orbit tests, pass.

Reproduce with `python3 Experimental/SolidArc/Native/GeometryMetrics.py`,
`python3 Tools/Build/RunSolidArcEditorProof.py --build-only`,
`.cache/solidarc-editor/SolidArcEditorProof --sketch-tools-only`,
`BROWSER_EXECUTABLE=/path/to/chromium node Tools/Build/RunSolidArcSketchToolsProof.mjs`,
and `python3 Tools/Build/GenerateSolidArcSketchToolsProof.py`.
Embedded screenshots and check data: `Exhibits/Gallery/Editor/SolidArcSketchToolsProof.html`.
Browser proof uses software SwiftShader WebGL2 (zero CPU fragments/RGBA uploads); native
proof is C++ CPU-reference raster / ImGui, not a hardware GPU claim.

## Interactive Bevel / Chamfer · B (2026-10-16)

Both frontends now drive the **same native C++ bevel feature/session**, not the old
immediate `fillet selected 0.25` binding or body-only parameter dialogs.

- Select solid body edges in mode **2**, whole planar sketch curves, or actual sharp
  sketch corner vertices in mode **1**. Whole-curve selection bevels every corner;
  vertex selection only bevels the chosen corners. Separate lines must first be joined
  into a cornered curve. Smooth curves, surfaces, filled regions, hidden/locked targets
  and mixed invalid selections refuse with an explanation.
- **B** opens rounded fillet; **Shift+B** opens flat chamfer. Move horizontally to
  adjust signed distance: positive = fillet radius, negative = chamfer setback.
  **Shift** scales each pointer increment for fine adjustment without a size jump.
  Type directly or click the size field; `250mm`, `-25cm`, `0.25m`, `1in`, `1ft`
  and scientific notation work. Numeric entry pins the preview. **Mouse adjust**
  resumes pointer adjustment. History editing starts pinned to avoid accidental changes
  while moving from the Inspector to the viewport.
- **Enter / Apply / viewport left-click** commits; **Esc / Cancel / viewport
  right-click** cancels. Alt-left orbit and middle-button pan remain navigation gestures.
  Invalid sizes disable Apply. Preview uses a separately staged scene through the existing
  native rendering path: it never mutates the authored scene, undo stack or save journal.
- Apply retains the source object ID/name, records one undo transaction, and adds a real
  `BevelFeature` with mode, size, targets, geometric bindings and exact pre-operation
  curve/body snapshots. The **Bevel history** Inspector card and additional bottom-history
  feature buttons reopen these properties; they are not relabelled undo entries.
- Editing an earlier feature reconstructs it and replays the rest of that object's
  attached bevel chain. Target matching uses unique sampled geometry; straight edges
  may rebind along the same overlapping spine. Moved/ambiguous downstream targets refuse
  atomically. All selected objects are staged before applying a new multi-object bevel.
- `.arc` stores explicit canonical `beveladd` / `beveledit` commands, never temporary
  session events. Save/reopen, undo/redo, multiple bevel steps and property changes work.
  Exact feature snapshots are included in the undo geometry-memory budget.

**Honest boundaries:** constant-radius fillet and equal-setback chamfer only in this UI;
no pretend variable-radius, asymmetric-distance or G2 knobs. Kernel support is bounded,
not universal. Rounded sketch corners require straight adjacent supports. The profile
solver now refuses overlapping setbacks, invalid connectors and failed joins rather than
silently leaving requested corners sharp or returning only a partial chain. Selected
corners cannot cut past unselected neighbours. Source creation recipes/blueprints are
intentionally detached when the snapshot-based bevel takes ownership of its geometry.
Rigid/uniform transforms update bevel input snapshots and sizes; nonuniform or unrelated
geometry edits make the affected earlier properties read-only rather than silently erase
those edits. Adding a bevel after an outside edit starts a new attached chain and retains
older feature rows as read-only. This is not a general replay system for every modelling
operation. The retained legacy WASM bundle is unchanged; interactive bevel requires the
current native transport and the legacy path does not advertise these capabilities.

**Verification:** 50/50 native feature/geometry metrics, 5/5 numeric input tests; real
browser/native own-mouse bevel proofs pass. They cover solid-edge and sketch-corner picks,
B, signed adjustment, unit typing without first clicking a field, disabled invalid Apply,
confirmation/cancellation, editable history, independent feature sizes, multi-object
atomicity, multiple solid/sketch steps, rational sketch arcs and single-step undo/redo.
Browser additionally verifies bottom-history editing and editable save/reopen. Existing
native/browser Select/Cut/Trim, face Extrude and disabled Loft, plus upright orbit checks,
remain passing. Browser proof renderer: WebGL2/software SwiftShader, zero CPU fragments
and RGBA framebuffer uploads. Native proof renderer: C++ CPU reference / real ImGui input.

Reproduce:
```
python3 Experimental/SolidArc/Native/BevelMetrics.py
(cd Experimental/SolidArc && npm run test:bevel-input && npm run build -- --base=/gpu/)
python3 Tools/Build/RunSolidArcEditorProof.py --build-only
.cache/solidarc-editor/SolidArcEditorProof --bevel-only
BROWSER_EXECUTABLE=/path/to/chromium node Tools/Build/RunSolidArcBevelProof.mjs
python3 Tools/Build/GenerateSolidArcBevelProof.py
```
Portable embedded evidence: `Exhibits/Gallery/Editor/SolidArcBevelProof.html`.

### Connected mixed arc/line cap rim (actual user-corner repair)

The shared native kernel now treats explicitly selected circular rim segments and their tangent line/arc continuation as **one cap blend**, rather than splitting the chain into independent rolls and rejecting its shared vertex. `Kernel/CapRimBlend.cpp` constructs exact rational torus/cylinder patches for round mode and conical-revolution/plane patches for flat mode, retains original support surfaces, trims surviving loops, and inserts matching end sections. It validates closed oriented topology, cap self-intersections, finite size, prismatic support, endpoint clearance and curvature-aware removal volume. New roll faces use their exact natural patch boundaries; extrusion and revolution have different parameter orderings, which must be reflected in their initial face reversal before `Orient()`.

Reproduction: `Native/Fixtures/MixedCapCorner.arc` is a minimized version of the actual captured live journal, with the same extrusion dimensions/face displacements and the earlier radii 0.25820216770000004 and 0.19306934379268867. Select arc 14 and line 15, **B**, enter `20.2791507347mm`, Apply. Negative input produces chamfer. Result: V16/E25/F11, Euler 2, genus 0; both UI feature histories contain all three operations. An explicit arc also carries its tangent line when selected alone. Ordinary old single-line journal commands deliberately keep their previous semantics, so replay does not silently alter earlier operations or invalidate the user's selected rim.

Earlier local rolls could retain a collapsed cutter seam. The local-roll rebuild now compacts only truly collapsed seams, preserving surviving finite edges/faces. Fillet construction no longer silently returns a flat chamfer if neither round candidate is admissible.

This is a bounded prismatic cap-rim route, **not** universal arbitrary-surface/multi-branch filleting. Arc sweeps above a half-circle, oblique/unsupported terminations, consumed clearances and unsupported intersections refuse. Editing feature 2 to 180 mm successfully replays feature 3; changing feature 1 can still refuse if downstream geometric bindings cease to match uniquely. Refusal is atomic. The live user's pending 1.552277 m chamfer remains too large; that is not the successfully demonstrated 20.2791507347 mm value.

Re-run proofs from repository root:

```sh
python3 Experimental/SolidArc/Native/BevelMetrics.py   # 55 tests, includes concurrent session exchange
python3 Tools/Build/VerifySolidArcCapRim.py             # geometry/support/G1/volume/rotation proof
python3 Tools/Build/RunSolidArcEditorProof.py --build-only
.cache/solidarc-editor/SolidArcEditorProof --bevel-corner-only
BROWSER_EXECUTABLE=/path/to/chromium node Tools/Build/RunSolidArcCornerProof.mjs
python3 Tools/Build/GenerateSolidArcCornerProof.py
```

`SOLIDARC_CORNER_FIXTURE` optionally supplies the original captured journal instead of the minimized fixture. Actual original-journal proof was run in an isolated browser session on the existing 8081/8083 server, never committed into the live user's document. Browser screenshots are WebGL2/software SwiftShader; native screenshots use the C++ CPU-reference raster and its own ImGui mouse/keyboard, not physical GPU evidence. Self-contained evidence is served at **`/proofs/bevel-corner`** on the same app server.

The development native service accepts an optional trusted local `--recover-sessions <JSON>` checkpoint mapping session IDs to journal text, camera and pending bevel metadata, so a deliberate server/kernel upgrade need not clear a user's current session. This is not an HTTP file-loading capability. Checkpoints stay under ignored scratch storage. Native imports, exports and recovery snapshots now use process-private exchange directories: concurrent browser/metric processes previously shared fixed filenames and could overwrite each other's journal during open/save.


## Continuous Hermite and rail/profile fender study

- HTML: `/gpu/?example=fender`, or Examples → **Fender · rail/profile loft**.
  Creates a separate document; default `/gpu/` remains empty/recovery-first.
  Source journal: `public/examples/Fender.arc` (also executable by native C++).
- Hermite: click start, end, outgoing start handle, incoming end handle. Continue
  with an endpoint/incoming-handle pair per span, then Enter/right-click/Finish.
  The reflected incoming handle sets the next outgoing derivative. One joined
  cubic NURBS curve is authored, with C1 continuity at non-degenerate joins.
  An incomplete pair cannot commit; Backspace removes the last input.
- Loft: select two **open longitudinal rails**; Inspector → Loft → cross-profile
  IDs, e.g. `3,4,5`. Native Inspector has the same field. First/last profiles join
  rail endpoints; optional interior profiles must meet both rails in order.
  Command: `loft WheelArch EngineRail --profiles=StartProfile,CrownProfile,EndProfile --sheet`.
  Curve names work in native commands; the HTML field accepts numeric IDs.
- Bounded solver: cubic Coons spans, harmonised into **one NURBS surface** with
  C0 interior station joins (not guaranteed G1/C1 or class-A automotive surfacing).
  Rational rims are fitted, not retained analytically: fit target `1e-5 m`;
  final rail/profile checks sample 65 points per constraint and refuse distances
  above `8e-5 m`. This is a sampled check, not a global error certificate.
  Unsupported degrees/loops, disconnected/crossing/incomplete stations refuse.
  Profile/guide dependencies participate in regeneration and source discovery;
  save/open replays the native construction journal. Profile mode does not expose
  an ineffective degree dimension.
- Tests: `python3 Native/GeometryMetrics.py` (39 tests),
  `.cache/solidarc-editor/SolidArcEditorProof --fender-only` (from repo root),
  `node Tools/Build/RunSolidArcCurveDrawingProof.mjs`, and
  `node Tools/Build/RunSolidArcFenderProof.mjs` (from repo root, browser env as above).
  Native own-mouse Hermite proof checks matching derivatives, plus 325 fender
  boundary/station distance checks. Browser verifies separate-document and recovery
  preservation, Inspector profile loft, real WebGL2 draws and zero CPU RGBA uploads.
  Screenshots: `EditorProof_SolidArc_{ContinuousHermite,Fender,HtmlFender}.png`.
  Native captures are CPU reference; automated browser uses SwiftShader software
  WebGL2, not proof of a physical GPU. The retained WASM reference is not rebuilt
  by these native builds; file-backed studies run on the current C++ service.

### Simplified viewing overlays

Normal viewing/whole-figure selection does not show control poles or their cage.
Surface iso-lines remain thin and solid. Explicit `show cages on` shows a thin
solid control net without markers; select a figure and enter `selectmode control`
to expose small circular, individually pickable editing handles. Returning to
`selectmode whole` hides handles again. The fender example defaults to cages off.
This changes presentation only, not its 132-pole NURBS geometry. GeometryMetrics
now has 40 tests, including marker-free viewing and circular control-edit glyphs;
the browser fender proof checks for no point packets or dashed cages by default.

## Solidify / Pipe / Revolve live demonstrations

Open `/gpu/?example=operations` to create three independent tabs, initially showing
Solidify. Also available individually with `?example=solidify`, `?example=pipe`,
and `?example=revolve`, or through Examples. Opening the group requires three
free tabs (four live documents maximum); no existing document is replaced.

Sources are `public/examples/{Solidify,Pipe,Revolve}.arc`:

- Solidify: original planar sheet alongside a 4 x 3 x 0.45 m plate. The native
  kernel now sews separate exact boundary-edge walls between both translated
  caps, rather than returning the old open three-face shell. The result has six
  faces and volume 5.4 m³. Directional thickening along the centre normal is not
  a general curved-surface constant-normal-offset solver. Thickness is an
  undoable construction command, not a live thickness feature/dimension.
- Pipe: capped circular solid sweep along a spatial Bézier, radius 0.22 m.
  Inspector radius can be edited; edit/undo and closed-solid validation tested.
- Revolve: closed XZ section rotated 360° around Z into a stepped collar with
  through-bore. Inspector angle can be edited; 270° and undo back to 360° tested.

`python3 Native/GeometryMetrics.py` now runs 42 tests, including demo save/open,
closed/manifold/oriented validation, Solidify volume, invalid-thickness refusal
and one-step undo/redo. `Tools/Build/RunSolidArcOperationsDemoProof.mjs` tests the
live three-tab bundle, topology, parameter edits/undo, a fourth preserved document,
clean overlays and zero CPU RGBA uploads. Browser proof uses software WebGL2.
Screenshots and JSON are generated in the ignored proof gallery folder.

### Native Inspector operation proofs

The C++ Inspector now exposes Solidify for a single open surface (closed-U/V
surfaces are disabled), and dedicated numeric thickness/radius/angle fields for
Solidify/Pipe/Revolve. Invalid non-finite/non-positive values disable Apply;
revolution angles are limited to 360 degrees. Native Inspector Revolve explicitly
uses world Z through the origin, matching the HTML demo. These edits remain native
kernel operations and single undoable transactions, not browser wrappers.

Run from repo root:

```
python3 Tools/Build/RunSolidArcEditorProof.py --build-only
.cache/solidarc-editor/SolidArcEditorProof --operations-only
python3 Tools/Build/GenerateSolidArcNativeOperationsProof.py
```

`/proofs/operations` serves the self-contained native result/parameter screenshots
and `SolidArcNativeOperationsProof.json` data. Source fixtures use native setup
commands; native mouse buttons, wheel scrolling and keyboard numeric entry invoke
Inspector Apply. The harness does not directly execute the modelling command.
Each case verifies disabled zero, selected valid solid, positive volume and
single-step undo/redo. Result V/E/F: Solidify 8/12/6, Pipe 2/3/3, Revolve 8/16/8
(genus 1 bore). Captures are native ImGui plus C++ CPU-reference raster, not HTML
or physical-GPU/Vulkan evidence. Native geometry 42 tests and own-mouse Loft
regression also pass.

## 2026-10-16 — ordered two-profile 2D booleans

- Two whole sketch curves expose Union/Subtract/Intersect through shared native `selectionOperations` in HTML and C++ Inspector. Eligibility validates closed, planar, non-self-crossing profiles on the same physical plane; invalid pairs remain grey with a reason. Exact eligibility is cached by authored geometry/selection fingerprint, not recomputed on every mouse frame.
- Subtract is first-clicked minus second-clicked; existing Reverse order swaps operands. Apply consumes inputs in one undo transaction; all output loops are selected/ordered (not just the final hole). Empty and disconnected results are intentional. Holes/disconnected regions are individual closed curve figures, not a new compound-profile object type. Further compound-object grouping/editable boolean feature history is not implemented here. Existing command grammar can address multiple loops on either side.
- Reuse native exact-NURBS profile algebra. Fix physical plane-offset rejection (parallel planes are not coplanar), infer profile normals from source geometry rather than the active drawing plane, and bound identical rational Bézier-span intersection through exact coincident control-net detection. Identical single-loop boolean results are resolved before intersection subdivision.
- Live example `/gpu/?example=booleans2d` opens a separate document without replacing the current drawing. Native startup remains empty/recovery-based; proof fixtures do not become user documents.
- Native proof: `.cache/solidarc-editor/SolidArcEditorProof --booleans2d-only` uses actual ImGui mouse/Shift/wheel selection, Reverse order, operation button and Apply; checks areas 20/8/4/8, selected closed output and single-step undo/redo. Open-curve disabled button ignores a mouse click. Actual native captures are CPU-reference renders, not GPU evidence.
- Browser proof: `LD_LIBRARY_PATH="$PWD/.cache/browser/libs/lib" BROWSER_EXECUTABLE=/tmp/chromium node Tools/Build/RunSolidArcBooleans2DProof.mjs` uses actual outliner Shift-click, reverse/button/Apply, native area reports, undo/redo, and invalid open/different-plane button checks. PASS; zero CPU RGBA uploads, no JS errors; WebGL2 SwiftShader software.
- `python3 Experimental/SolidArc/Native/GeometryMetrics.py`: 44/44 PASS, including 24 2D boolean operation scenarios: overlapping rectangles/circles, shared/adjacent edges, disjoint, nested holes, identical circles, and XZ profiles with active XY workplane. Includes save/reopen and invalid-pair atomic refusal checks. Native Loft and Solidify/Pipe/Revolve own-input regressions also PASS.
- `python3 Tools/Build/GenerateSolidArcBooleans2DProof.py` builds portable `Exhibits/Gallery/Editor/SolidArcBooleans2DProof.html`; served at `/proofs/booleans2d`, linked from the native mirror. Generated captures/reports stay ignored like existing proof artifacts.
- Before upgrading backend/native processes, checkpointed the active 4-figure HTML user session to `_AgentScratch/autosave/BeforeBooleans2D.json`, retained the prior other-session fallback, and relaunched backend with that explicit recovery file. Current live binary and proof route refreshed. Recovery preserves authored geometry/selection/camera, not in-memory undo history.
- Next separate phase: 3D body boolean eligibility/interaction proofs and supported-intersection coverage. This change does not claim general 3D boolean robustness or arbitrary compound-profile object semantics.

## 2026-10-16 — preview outage / gateway error recovery

- On the reported 502, process inspection found neither 8081 nor 8083 running in the restored workspace; ignored build/browser/proof caches and local autosave checkpoints were absent. Rebuilt native editor/geometry and HTML assets, restarted both services on 0.0.0.0. Did not manufacture a replacement user recovery drawing. Preview hostname changed with the workspace instance; deliver the current preview URL rather than the previous instance's URL.
- Native mirror no longer copies upstream HTML error bodies into its status bar. It reports a short HTTP-status message, exposes Reconnect, checks PNG response type, clears queued input on error, and reconnects with neutral pointer/modifier state (no automatic replay of failed modelling inputs).
- Re-ran native `--booleans2d-only` and browser `RunSolidArcBooleans2DProof.mjs`: PASS. Regenerated 10-image boolean proof page. Browser-injected HTML 502 test verified the short message and successful Reconnect back to a real native frame; all proof images decode. No physical GPU claim.

## 2026-10-16 — ordered two-body 3D booleans

- Shared `ConsoleHost::SelectionOperations()` now covers both profiles and body pairs (renamed the old curve-only entry point). Native and HTML ordered-selection cards list two bodies in click order, with active/other operand labels and Reverse order. Whole-body Union/Subtract/Intersect follow the same popup/Apply workflow as 2D.
- For a body pair, native eligibility runs each actual `IntersectionSolver::Combine` and validates closed/manifold/oriented positive-volume B-rep results. Cache keyed by document/selection geometry fingerprint plus locks avoids recomputing SSI on mouse/camera frames. Empty or unsupported results are disabled with native refusal reasons; subelement/hidden/locked/invalid-solid selections are ineligible. Apply revalidates the result before consuming either input; direct-command failures are atomic. Subtract is first minus second. Boolean results are destructive geometry with single-step undo/redo, not a replayable/editable boolean feature graph.
- Reused existing native NURBS SSI/exact special-case solvers, not mesh or browser-side booleans. General free-form intersections must be transversal; arbitrary tangent/coincident configurations are not claimed universally supported. Empty 3D results refuse (unlike accepted empty 2D regions). Disconnected unions are one multi-hull body. No new general-SSI algorithm was substituted.
- Native own-input `--booleans3d-only` proof: actual viewport mouse/Shift selection, wheel/Inspector buttons, reverse order, Apply; verified volumes 42 / 18 / 6 / 18 m3 on offset boxes, closed/manifold/oriented solid selection, one-step undo/redo. Actual disabled empty Intersect ignores a click. Added popup minimum width so wrapped explanations cannot collapse into a narrow column and push Apply outside the screen.
- `python3 Experimental/SolidArc/Native/GeometryMetrics.py`: 46/46 PASS. Includes 12 successful 3D fixture/operation cases (offset/aligned boxes, enclosed cavity, cylindrical through-bore), topology and numerical volumes, save/reopen, undo/redo, reverse order, disconnected union, identical/contained/disjoint empty refusal, edge-selection disabled and whole-selection re-enable. Existing 2D/kernel tests retained.
- `RunSolidArcBooleans3DProof.mjs`: browser Shift-click/reverse/operation/Apply/volume/undo/redo plus grey disjoint Intersect; PASS, no JS errors, zero RGBA uploads. Native own-input and browser 2D regressions also PASS. Native proof uses CPU raster, browser uses WebGL2 SwiftShader software; neither physical-GPU evidence.
- `/gpu/?example=booleans3d`: separate live document, initially two overlapping bodies selected. Preview root now opens requested 3D demo. Header “3D example” opens another document without replacing current work, “3D boolean proofs” opens the 10-image native/HTML page inline (no popup/new-tab dependence). Actual browser verified root landing, all proof images, closing dialog, and preservation of a separate KeepBody drawing when opening an example.
- Proof reproduction: `python3 Tools/Build/RunSolidArcEditorProof.py --build-only`; `.cache/solidarc-editor/SolidArcEditorProof --booleans3d-only`; `LD_LIBRARY_PATH="$PWD/.cache/browser/libs/lib" BROWSER_EXECUTABLE=/tmp/chromium node Tools/Build/RunSolidArcBooleans3DProof.mjs`; `python3 Tools/Build/GenerateSolidArcBooleans3DProof.py`. Generated portable `SolidArcBooleans3DProof.html` is served at `/proofs/booleans3d`; artifacts remain ignored.
- Restarted only native mirror on 8081 to load its current C++ binary/routes. Backend 8083 and existing HTML session processes were deliberately left alive, preserving their document sets. Newly opened HTML sessions launch the updated native geometry executable. No user drawing was replaced with proof fixtures. Work remains on the Arena branch, uncommitted.

## 2026-10-16 · Shortcuts, multiselection, native GPU ID picking, stacked boxes

- HTML and native: Ctrl+S saves (HTML download; native explicit recovery document path via `SOLIDARC_RECOVERY_FILE`, default `_AgentScratch/autosave/SolidArc.arc`). Native Ctrl+S no longer also dispatches the scale shortcut. Ctrl+A opens existing Construct; native ImGui and HTML text fields retain normal select-all. Escape closes native Construct explicitly.
- Ctrl/Shift-click additive/toggle selection in viewport and Outliner. Fixed native Outliner synchronization to carry the complete ordered selection, not merely its primary row. SolidArc Shift-click selects the clicked row, not intervening rows; other editors retain their existing range semantics. Modifier-removal rebuilds the remaining ordered selection rather than incorrectly treating `select --add` as a toggle. Active/other selection colors retained.
- Added optional native `GpuPickingRaster`: CPU-owned triangle/segment/point streams issue GLES3 draws into R32UI + depth24 framebuffer; GPU-generated IDs/readback drive native selection. Native Vulkan-style Y-down/Z[0,1] projection is explicitly converted to GL Y-up/Z[-1,1]. Fixed missing pick identity on native point/Empty glyphs. The **visible native color PNG is still CPU reference**; the sandbox's actual GLES implementation is ANGLE/SwiftShader **software**, not physical hardware and not a native Vulkan color renderer. Default without opt-in remains CPU picking; requested backend initialization errors do not silently fall back.
- `FaceContactBoxUnion` fixes a real partial-face-contact error: coordinate-arrangement exterior patches omit the internal contact interface and sew conformingly. Example base32 + top8 now returns one closed/manifold/oriented hull, volume40, exterior area80 (formerly two hulls/area88). Identical XY boxes: Z overlap union48/subtract16/intersect16; full-face touch union64/subtract32/disabled intersection; gap union64 in two hulls/subtract32/disabled intersection. Each enabled case checks volume/topology/hulls and Undo/Redo.
- `python3 Experimental/SolidArc/Native/GeometryMetrics.py`: **47 PASS, 13.303s**. Native `--booleans3d-only` with GPU picking: own-mouse PASS42/18/6/18. Native `--shortcuts-picking-only`: Ctrl+A/Escape, Ctrl viewport toggle, Ctrl/Shift Outliner, Ctrl+S dedicated save, GPU upper-face occlusion/encoded face bits/point ID PASS. Browser `RunSolidArcShortcutsPickingProof.mjs`: actual Ctrl+A/text-field selection, Ctrl+S download, Ctrl/Shift Outliner, Ctrl/Shift viewport, partial-contact Union/Subtract Apply and topology PASS; zero JS errors/CPU fragments/RGBA uploads. `topology <body> --summary` avoids losing the validation header to the transport's bounded 100-line diagnostic tail on larger solids.
- Reproduction (Linux sandbox; browser dependency setup from earlier sections):
  ```sh
  python3 Tools/Build/PrepareSolidArcNativeGpuPicking.py
  python3 Tools/Build/RunSolidArcEditorProof.py --build-only
  SOLIDARC_RECOVERY_FILE=_AgentScratch/tmp/ShortcutsProof.arc \
    SOLIDARC_GPU_PICKING_LIBRARY_DIR="$PWD/.cache/native-gpu/lib" \
    LD_LIBRARY_PATH="$PWD/.cache/browser/libs/lib:$PWD/.cache/native-gpu/lib" \
    .cache/solidarc-editor/SolidArcEditorProof --shortcuts-picking-only
  BROWSER_EXECUTABLE=/tmp/chromium LD_LIBRARY_PATH="$PWD/.cache/browser/libs/lib" \
    node Tools/Build/RunSolidArcShortcutsPickingProof.mjs
  python3 Tools/Build/GenerateSolidArcShortcutsPickingProof.py
  ```
- Portable three-image `Exhibits/Gallery/Editor/SolidArcShortcutsPickingProof.html` embeds native/browser JSON and stacked-case table. Proof binaries, downloaded libraries, images and report remain ignored. Preparation pins Chromium131.0.1 ANGLE libraries; Chromium153 sandbox libraries are stubs and unsuitable. Machine-provided compatible EGL/GLES3 libraries can instead be selected with the environment setting.
- Inspected processes, rebuilt HTML `/gpu/`, restarted only mirror8081 with current native binary and opt-in GLES picking; `/version` confirms no restart required. Geometry8083 and existing HTML document sessions remain alive. Fresh HTML session IDs launch the updated kernel; no existing document was reset by tests. All work remains on `arena/9440f4d0-frontier`, uncommitted.
- Final live check: `/input` returned HTTP200/native PNG and `/proofs/shortcuts-picking` returned HTTP200/portable report. Preparation now preserves identical libraries and uses atomic replacement for changed ones, avoiding modification of mapped shared libraries in running native processes. Mirror restarted after testing library preparation; backend8083 preserved.

## 2026-10-16 · Repair actual HTML Z-dragged Union/Subtract refusal

- User's screenshot/live session reproduced **Union/Subtract disabled, Intersect enabled**. The exact native denial was `tangent or coincident faces (not transversal)`. Live geometry was FirstBody `(0,0,0)..(4,3,2)`, SecondBody initially `(2,0,0)..(6,3,2)` then gizmo-translated in Z by `0.88750930276237883` (earlier session `1.2890083800837226`), selected in order SecondBody → FirstBody. Previous box regressions missed non-rectangular overlap with coincident Y-side planes. No HTML enablement override is appropriate.
- Generalized exact `FaceContactBoxUnion` to `ArrangedBoxBoolean`: analytic box-plane coordinate arrangement, boolean cell membership, omit interior patches, conforming NURBS-plane sewing. Axis-aligned non-rectangular unions and non-enclosed subtraction now use this route instead of unreliable coplanar SSI trimming. Existing rectangular/slice/disconnected/contained and enclosed-cavity routes retained. Authored geometry remains exact B-rep, not voxel/mesh boolean approximation.
- Added C++ exact user-matrix regressions: both Z shifts, direct-authored versus transformed boxes, both selection orders, all three operations; enabled eligibility, closed/manifold/oriented result, one hull, analytical volume, Undo/Redo and saved-journal reopen. Also repaired full native camera-packet assignment (projection, fitted reach, FOV) discovered while restoring live checkpoints; old pose-only WASM entry remains supported. **49 geometry tests PASS, 15.797s** (`.cache/solidarc-editor/ZDraggedBoxMetrics.log`).
- `RunSolidArcZDraggedBooleansProof.mjs`: **9 HTML cases PASS**, actual mouse Z-gizmo drag + two exact recorded matrices × Union/Subtract/Intersect; actual Shift-click ordered selection, all three buttons enabled, actual Inspector Apply, analytical volumes/closed topology/Undo/Redo. Zero JS errors and RGBA uploads. Screenshots: `EditorProof_SolidArc_ZDraggedEnabled.png`, `...ZDraggedunion.png`, `...ZDraggedsubtract.png`, `...ZDraggedintersect.png`. Initial example readiness now waits for both loaded bodies, avoiding an initialization race in the test.
- Existing native own-mouse `--booleans3d-only` with GLES3 ID picking still PASS42/18/6/18. Existing HTML 3D own-input proof also PASS; topology assertions now request `--summary` because exact arrangements can exceed transport's diagnostic tail limit. No full GPU-color/physical-hardware claim.
- Inspected live processes/three active sessions, checkpointed each existing journal and view, upgraded geometry8083 via trusted `--recover-sessions _AgentScratch/tmp/ZDraggedSessionCheckpoints.json`. Verified figure arrays, selection order and full camera equal before/after for all three sessions. The user's affected existing session now returns **Union=true, Subtract=true, Intersect=true**. Original journals/checkpoints kept in ignored scratch storage. Journal recovery resets the old in-memory undo/redo stack; existing model data, ordered selection and view are preserved. Tests use separate browser sessions and do not apply booleans to the user's drawing.
- Rebuilt native editor and restarted mirror8081 with GPU picking opt-in; backend8083 uses updated geometry executable. New portable four-image report: `python3 Tools/Build/GenerateSolidArcZDraggedBooleansProof.py`, served at `/proofs/z-dragged-booleans`. Reproduce browser proof with `BROWSER_EXECUTABLE=/tmp/chromium LD_LIBRARY_PATH="$PWD/.cache/browser/libs/lib" node Tools/Build/RunSolidArcZDraggedBooleansProof.mjs`. All changes remain uncommitted on the fixed Arena branch.

## 2026-10-16 · Curved-solid failure: sphere + already-unioned body

- User correctly objected to box-only testing. Read the actual live journal: unioned the Z-dragged boxes (dz=1.4994483840546615), then `sphere (0,0,0) .75`, selected sphere #4 → Union #3. Native eligibility refused **all three** with `intersection runs into a surface singularity or seam corner (non-generic: nudge or rotate one body)`. A simpler box-corner/sphere pair likewise failed; generic off-corner sphere/box and some sphere pairs already worked. Do not claim that the box arrangement implements general CAD booleans.
- Refactored existing SSI Boolean body into `CombineInCharts`. Public `Combine` retains the original path first; on invalid/failed output, verified full untrimmed spheres can retry alternative exact rational charts around their centers. This changes seam/pole placement, **not the represented spherical solid**, and runs the same NURBS SSI/split/classify/B-rep pipeline, not a sphere-specific volume formula or mesh boolean. A successful retry must validate closed/manifold/oriented/positive finite volume. Unsupported results remain refused. Trimmed spherical faces are not recharted without a trim-coordinate remap; no blanket arbitrary-solid robustness claim.
- Fixed generic curved trimmed-face bounds: edges alone do not bound an interior spherical bulge. Such faces now use conservative positive-weight NURBS pole hulls, while trimmed planar caps retain edge bounds. These are conservative support bounds, not exact measured physical extents.
- **50 geometry tests PASS, 106.801s** under concurrent browser load. Added sphere at a three-plane pole/corner, the user's derived Union + sphere, and sphere/sphere cases, all ops/both orders; validate one closed manifold oriented hull, analytical volume comparison, exact Undo-state restoration, Redo and saved-journal reopen. Volume is tessellated quadrature: tolerance max(.003, .2% expected), not exact analytic integration. Existing box/cylinder/stacked regressions remain passing.
- Native `--curved-booleans-only`: **12 actual ImGui mouse cases PASS** (Outliner Shift-click, reverse, Inspector popup Apply); three curved fixtures × Union/Subtract/Intersect/reverse subtraction, volume/topology/Undo/Redo. Opt-in native GLES ID backend enabled; visible screenshots still CPU-reference color. Log `.cache/solidarc-editor/CurvedNativeProof.log`; JSON `SolidArcNativeCurvedBooleansProof.json`; screenshots `EditorProof_SolidArc_NativeCurved{Union,Subtract,Intersect}.png`.
- `RunSolidArcCurvedBooleansProof.mjs`: **12 HTML cases PASS**, actual Shift-Outliner/reverse/Apply, same geometry/order as user, all three buttons enabled, one valid solid, analytic volume within quadrature tolerance, exact Undo/Redo. Zero page errors/RGBA uploads. JSON `SolidArcHtmlCurvedBooleansProof.json`; screenshots `EditorProof_SolidArc_HtmlCurved{Enabled,union,subtract,intersect}.png`. Sphere-first subtraction leaves 7/8 sphere; body-first subtraction makes the spherical cut-out. Preserve/document first-minus-second semantics.
- Inspected live processes; saved all three active journals/cameras/bevel metadata to ignored `_AgentScratch/tmp/CurvedSessionCheckpoints.json`, upgraded geometry8083 with trusted `--recover-sessions`. Checked exact before/after `figures`, `selectionOrder`, `camera` equality for all sessions. The actual affected existing sphere session now reports **Union=true / Subtract=true / Intersect=true**, with inputs unchanged. Journals preserved; the old in-memory undo/redo stack is reset by recovery. Tests ran in separate sessions and never applied operations to the user's model.
- Reproduction: geometry metrics as above; `python3 Tools/Build/RunSolidArcEditorProof.py --build-only`; native GPU environment from shortcut section plus `.cache/solidarc-editor/SolidArcEditorProof --curved-booleans-only`; `BROWSER_EXECUTABLE=/tmp/chromium LD_LIBRARY_PATH="$PWD/.cache/browser/libs/lib" node Tools/Build/RunSolidArcCurvedBooleansProof.mjs`; `python3 Tools/Build/GenerateSolidArcCurvedBooleansProof.py`. Portable five-image report served at `/proofs/curved-booleans`. Native mirror rebuilt/restarted separately; geometry sessions preserved. Work uncommitted on the fixed Arena branch.

## Spherical Boolean-corner bevel repair (October 17)

The native C++ OCCT blend route is provisioned by
`python3 Tools/Build/BuildSolidArcOcctBlend.py` and automatically discovered by
`Native/ServeSequence.py`. Live HTML preview remains on 8083 with native backend
on 8081. Verified all six sharp sphere-minus-box edges in both modes at .0375
through actual native own-pointer and HTML B-popup inputs (12 + 12 cases),
undo/redo/save/reopen, plus 70 existing enabled-backend regressions.
See [OCCT_BLEND.md](Native/OCCT_BLEND.md) for dependency notices, validation bounds,
reproduction and the remaining larger-radius edge-1 refusal. Do not claim every
arbitrary Boolean fillet / radius is supported.
