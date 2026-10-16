# Native CAD UI parity — work in progress

Reference: approved `Experimental/SolidArc/src/WorkspacePanel.{js,css}` and pinned
published source `Experimental/SolidArc/Reference/index.html` (CAT / CONS_TYPES).
The approved browser styling is unchanged. No full-parity claim is made.

## Implemented native/shared changes

- Opt-in shared `OutlinerPanel::AssignCadPresentation` keeps game defaults unchanged.
  CAD rows prioritize the name, render a short classification and persistent eye,
  omit game metadata/status columns and Sun/Moons footer, and disable UI-only tree
  reparenting that would otherwise desynchronize document bindings.
- CAD adapter builds actual rows directly, rather than building six empty buckets
  and flattening them in the host. It retains dimensions and constraints, uses
  stable identities, returns zero rows for an empty document, and preserves the
  default bucket layout for existing callers. Geometry collection is a caption/root,
  never an invented figure. Empty documents have an explicit instruction.
- Reusable native `CadWidgets::ToolTile` gives the catalogue icon-above-label tiles.
- Shared Inspector has opt-in CAD presentation without game footer/status/notes.
- Native viewport no longer prints simulated FPS; camera labels resync after native
  document/camera changes. Catalogue section clicks no longer close the popup.
- Real native Polyline Slot, Datum Point and Point entries added alongside Spline
  and Control Curve. Correct source-tool names survive completion (previously the
  callback consulted the already-cleared tool and named control curves “Spline”).
- Polyline Slot uses analytic NURBS lines/arcs, round outer joins/end caps and mitered
  inner joins, matching the reference algorithm. Duplicate/reversing spines and
  nonpositive radii refuse. No general self-intersection cleanup is claimed.
- Native Inspector supplies circle centre/diameter, arc CW/CCW, polygon
  inscribed/circumscribed and sides, polyline closure and slot radius controls.
  Slot uses two centre clicks with a radius field. These settings are journalled
  through `tool-options`; deterministic defaults and slot save/replay are tested.
- Points use the existing native Empty/transform-handle representation at the clicked
  workplane location; Datum Point is construction geometry, Point is not. This is
  not yet a distinct sketch-point classification or a full sketch constraint binding.

## Remaining published catalogue/UI work

| Area | Outstanding native UI work |
| --- | --- |
| Workspace | Real multi-document state; remaining selected Inspector cards/forms |
| Reference | Workplane rotation, extent, viewport visibility and face attachment |
| Sketch Draw | Reference polygon confirmation phase; construction-geometry switches on all applicable tools |
| Sketch Modify | Reference-style mouse workflows for Select, Offset/Inset, Fill, Mirror, Linear Pattern, Circular Pattern, Trim, Cut, Fillet and Chamfer |
| Constrain | Reference selectable constraint palette / pick flows / editable dimensions (coincident, horizontal, vertical, parallel, perpendicular, equal, tangent, concentric, midpoint, fixed, point-on-line, dimension); backend capabilities vary |
| Solid | Reference Extrude, Inset face and Loft pick/drag/parameter workflows; current primitive command popup is not equivalent |
| Boolean | Published reference labels it “soon”; do not fabricate working reference tools |

No inert entries have been added to imply those flows work. Existing kernel commands
for several operations are not equivalent to completed native reference UI workflows.

## Validation / evidence

`python3 Tools/Build/RunSolidArcEditorProof.py` passes device contract, camera/gizmo,
mouse-only rectangle, live dimensions, one-step undo, mouse-selected Polyline Slot /
Spline / Control Curve + Enter, native datum/sketch point clicks + undo, actual roster
names/IDs/capacity, analytic straight/left/right/collinear slots on XZ, invalid spine
refusals, atomic invalid settings, and configured-slot .arc save/replay.

`python3 Tools/Build/GenerateSolidArcProofGallery.py` embeds ten generated PNGs in
`Exhibits/Gallery/Editor/SolidArcProofs.html`. All evidence is native CPU reference,
not native Vulkan, physical desktop input or GPU performance evidence. Generated
PNGs/HTML and caches follow the existing ignored-gallery convention. No commits/pushes.

## Docked-shell correction

The user's latest layout direction supersedes the fixed three-rounded-panel shell:
- `Untitled.arc` is a genuine patched trapezoidal ImGui tab, not a pill button.
- Outliner, Viewport and Inspector occupy real docking nodes with their own tabs.
  The dock builder supplies only the initial layout; no fixed panel seating is applied per frame.
- The extra Workspace, Examples, Save .arc and Open document controls were removed.
- Viewport header owns Construct, Orbit/view choice and a real Perspective/Orthographic
  dropdown. Empty/tool and selected Inspector paths both draw a header.
- Native proof checks the document tab object, dock nodes/tab bars and enabled docking;
  native mouse input undocks Inspector, then the fixture restores its dock. Existing
  rectangle, multi-point curves, points, undo and save/replay tests still pass.
- Gallery now contains eleven embedded images, including the floating Inspector proof.

There is still only one document. This restores document-tab presentation, not a
claim of implemented multi-document state. Physical desktop input and native Vulkan
remain outside the CPU headless proof's scope.

### Trapezoid content correction

Patch F (`Tools/Build/Patches/PatchF-TabContentInsets.patch`) measures and renders
slanted-tab content with the same safe inset, clearing both sloped ends and overlap.
Labels and close buttons are vertically centered; close buttons are hidden rather
than spilling out when the available rectangle is too small. The stock zero-slant
and circular tab-button paths keep their previous layout. Both patch applicators
(Python and PowerShell), plus the native proof builder, include F after A–E.
CAD dock roots explicitly disable ImGui's window-menu caret and floating CAD panels
use NoCollapse. Native proof asserts label/close space and absence of dock carets.

### Monochrome panel tabs; document strip removed

The latest direction removes the single Untitled.arc tab entirely. The dockspace
now uses that space directly. All trapezoidal tab states (selected, dimmed, hovered
and overlines) use equal RGB channels: black/grey backgrounds and white/grey text
and accents. Semantic geometry colours elsewhere are unchanged. Native proof checks
that the document tab bar is absent and that all tab-state colours are monochrome.

### Shared theme and dropdown unification

Normal/selected/dimmed tabs now take their panel-body background directly; the
Outliner CAD panel uses the same body token too. Hover follows the common button
hover token. Tab overlines have zero thickness and alpha, and the outer workspace
border is suppressed. `Engine/Editor/EditorTheme.h` supplies the same tab/control
states to both Frontier's EditorHost and SolidArc's host.

`ControlPanel` now owns the Filter-style dropdown trigger, popup, and option rows.
The outliner Filter and single-select dropdowns share those primitives, replacing
split-arrow controls in the viewport, circle/workplane settings, property sheets,
Moon instance selector, and cloud/fog wind-source selectors. Filter's semantic dots
and multi-filter behavior remain intact; its count badge gets enough width rather
than overlapping the caption. Selected/hover/open states are neutral and consistent.

Native proof mouse-tests camera Top and both projection options, toggles Filter,
checks matching popup rounding/padding, exact body/tab colours, and no overline.
Gallery contains twelve embedded images. The native proof builds the changed shared
panels, but the full Frontier EditorHost application build is not verified here:
a standalone syntax check is blocked by the absent toml++ include dependency.

## Native Construct mouse sweep and animated proof

Filter, Orbit and projection now all use the same black label / grey arrow colours.
The shared selector implementation opts into the same colour variant as Filter.

The native proof sweeps 14 Sketch/Reference tools: Line, Polyline, Rectangle,
Centre Rectangle, Slot, Polyline Slot, Circle, Arc, Ellipse, Polygon, Spline,
Control Curve, Point and Datum Point. Every test clicks the real Construct button,
section and tile, then sends 24 interpolated native pointer moves per requested
point and native corner/centre clicks. Multi-point tools finish with native Enter.
There are 816 interpolated moves and 34 geometry-point clicks overall (menu clicks
are additional). Movement must keep the document empty; completion must produce
exactly one figure, valid NURBS for curves, and a single undo transaction.
Fixture reset and camera setup are separate from the tool/point path. No browser
UI, tool commands or point commands are used to drive these catalogue test cases.

Native ImGui renders the cursor. Rectangle preview frames show changing dimensions;
`SolidArcMouseMotion.png` is an APNG assembled from those actual C++ raster frames.
Its playback timing is illustrative, not a performance measurement. The gallery
embeds the APNG, 26 still images, and JSON test results in one offline HTML file.
PNG scanline data is compressed losslessly during packaging; no pixels are repainted.

The docking fixture was also corrected: undocking the last window can delete a
leaf node, so restoring to its stale ID made a floating dock which overlapped later
mouse tests. It now splits the surviving centre node to restore a real right dock.

This validates the current Sketch/Reference catalogue, not every planned native
Sketch Modify/constraint/profile-solid workflow listed above. Physical OS input,
native Vulkan and GPU performance remain unverified by this headless CPU proof.

## Visible native orbit GIF and HTML-aligned Inspector (15 October 2026)

- `SolidArcInspector.cpp` implements the selected-figure card layout from
  `Experimental/SolidArc/src/WorkspacePanel.js:RefreshInspector`: editable name,
  visibility, classification/counts, Geometry / Transform / Topology tabs,
  construction Dimensions, world Bounds, Operations and Presentation. Cards scroll
  inside the existing dockable Inspector; operation buttons adapt to its width.
- Empty Inspector now has the reference Box / Circle / Rectangle / Extrude roster.
  Box opens the native Solid catalogue/parameter popup; Circle and Rectangle start
  real viewport tools. Extrude is disabled until there is a profile/region.
- The world Transform table has position, rotation, per-axis and uniform scale.
  It currently uses explicit **Apply**, unlike HTML's immediate-change fields.
  Operations open editable native-command parameter popups rather than the HTML's
  full operation-specific forms. These are known parity gaps, not mock solvers.
  Topology reports actual native NURBS/body validation. Finish, rename, dimension
  editing, visibility, export and deletion dispatch to ConsoleHost.
- Fixed `CommandCodec` interpreting stable `#1` figure operands as comments.
  Pure integer identity tokens now reach Resolve; ordinary inline `# comment`
  and quoted names remain supported. The proof asserts both paths.
- Native mouse/keyboard proof selects the name field, renames and restores Body01,
  types world X=0.25, clicks Apply, checks the actual centre delta, and undoes it.
  Geometry/Transform/Topology and scrolled Operations/Presentation have native PNGs.
- Orbit proof holds RMB and injects **32 interpolated pointer positions**, with
  **10 actual native raster captures**. Camera yaw changes from -0.610865 to
  -1.49087 radians (about 50°). `SolidArcOrbitProof.json` contains the assertions.
  `SolidArcOrbit.gif` loops these captures; its 256-colour palette is GIF encoding,
  not a replacement renderer. Cursor, scene, grid, gizmo and Inspector are native.
- The offline gallery embeds **30 still PNGs, rectangle APNG and orbit GIF**;
  the orbit animation comes first. No external assets or publication required.
  Packaging requires Pillow: `python3 -m pip install --target .cache/proof-python Pillow`.
- Full native suite passed including all 14 Construct cases / 816 pointer moves /
  34 placement clicks and undo. Following the dimension-label refinement, focused
  Inspector/orbit checks passed again:
  `.cache/solidarc-editor/SolidArcEditorProof --inspector-orbit-only`.
  This subset does not rerun the catalogue tests.

Evidence remains injected native ImGui input and CPU reference rasterization,
not physical OS mouse events, native Vulkan or a GPU/60fps benchmark. The approved
HTML/CSS design remains unchanged. Generic non-figure property sheets remain available.

## Preview discoverability and WebGL2 Construct/drawing recording

The transport homepage now **defaults to the visible orbit GIF**, rather than
only linking to a separate gallery from a live CPU frame. Its navigation exposes:
Orbit GIF, Construct + drawing, Live native C++ (CPU reference), and Open GPU drawing
editor. `/evidence/SolidArcOrbit.gif` is a direct, non-cached GIF response. Browser
checks verified the GIF is visible immediately and its rendered pixels animate.
The Construct tab likewise visibly animates, and shows the native catalogue still
and native rectangle APNG separately from browser shader-path footage.

The same server serves the existing approved HTML renderer at `/gpu/`, with
same-origin `/native` and `/native/health` proxying the C++ vertex-command service.
This avoids browser localhost URLs and a hidden/stale second preview. No approved
workspace CSS or UI was redesigned. This is **browser WebGL2**, not a completed
native-window Vulkan implementation.

Reproduction:
1. `python3 Experimental/SolidArc/Native/CompileSequence.py --native`
2. Start `python3 Experimental/SolidArc/Native/ServeSequence.py` (port 8081).
3. In `Experimental/SolidArc`: `npm ci && npm run build -- --base=/gpu/`.
4. Start `Tools/Build/ServeSolidArcMirror.py --port 8082` as before.
5. `node Tools/Build/RunSolidArcGpuDrawingProof.mjs` with Playwright Chromium
   installed, or `BROWSER_EXECUTABLE` pointing to Chromium. Optional `BROWSER_ARGS`
   is a JSON array of driver flags; do not silently label software drivers hardware.
6. `python3 Tools/Build/GenerateSolidArcProofGallery.py` packages the recording
   into `SolidArcGpuDrawing.gif` and embeds it alongside separately labelled native
   CPU evidence. No browser installation is required just to view the GIFs.

The new recording uses actual Construct → Sketch Draw menu clicks and mouse
placement of Rectangle and Circle; camera setup alone uses a view selection.
Preview frames assert no premature native figure commits; final C++ document has
both curves. Captured evidence: 23 screenshots (GIF merges one identical frame),
330 instrumented WebGL draw calls, zero CPU image presentations, zero CPU fragments,
zero scene RGBA uploads, no GL/page errors. Grid/lines/surfaces use the existing
shared `.slang`-derived WebGL pipelines. `SolidArcGpuDrawing.json` identifies the
adapter as **SwiftShader/software** in the sandbox. This verifies the shader/draw
path, **not physical-GPU execution or performance**. The live browser selects its
own available WebGL adapter and displays software-driver status when applicable.

## View-aligned grid and mouse placement — HTML first, then C++

Implemented and tested HTML first, then the native counterpart:

| Named camera views | Active grid / sketch plane | Coloured world axes |
| --- | --- | --- |
| Top / Bottom | XY | X red, Y green |
| Front / Back | XZ | X red, Z blue |
| Right / Left | YZ | Y green, Z blue |
| Isometric / free orbit | Retain active workplane | Its two world-axis colours |

`GridSequence.js` supplies the HTML frame's drawing-plane basis. Named-view UI
selection sets the native workplane and camera together and cancels incomplete
HTML drawings, preventing mixed coordinate bases. Existing mouse ray/plane
intersection, preview strokes and native `draw` commits now all share that plane.
This is continuous mouse placement on the plane, not a new quantized grid-snap mode.
Explicit workplane origins/offsets move both the lattice and drawing plane.

The shared `LatticeProjection.slang` reconstructs rays against the supplied plane
origin/U/V, evaluates anti-aliased grid spacing in local UV, derives axis colours
from their world directions and writes depth from the world intersection. Axes
are slightly stronger than minor grid lines so both remain visible at pixel edges.
No CPU grid image or browser 2D canvas grid was introduced. `ViewRecord`, command
packets and CPU SlangMirror now carry the same three float4 plane fields.

C++ `ConsoleHost::Render` binds its real `Workplane`; the canonical `view` commands
select XY/XZ/YZ and cancel incomplete tools. `ViewportPanel` now includes Back and
Left, and sends explicit named-view choices to the CAD host (rather than trying
to infer user intent from orbit angles). Projection toggles, free orbit and
Isometric preserve the current workplane. Shared selector capacity is now eight.

Verification:
- HTML `RunSolidArcViewGridProof.mjs`: six standard views plus Isometric, actual
  dropdown/tile/pointer input, framebuffer axis colours, noncommitting previews,
  native completed bounds matching mouse points, plus offset YZ x=2. Passed both
  before native changes and again with the rebuilt integrated C++ backend.
- Native `.cache/solidarc-editor/SolidArcEditorProof --view-grid-only`: eight cases
  (six standard, Isometric retaining YZ, offset YZ). Actual native menu/tile/mouse
  inputs, 16 interpolated moves per case; preview and committed control points
  lie on the active plane. Bounds match mouse location. Save/reopen and one-step
  undo pass for every case. Raster pixel checks confirm both correct coloured
  axes in all six native standard views.
- Full native regression still passes, including Inspector edits, orbit/gizmo,
  docking/dropdowns and the 14-tool / 816-move Construct sweep.

The preview now defaults to **View grids + drawing**, showing an HTML WebGL2 GIF
first and a native C++ CPU-reference GIF second. The offline gallery embeds both
(`SolidArcHtmlViewGrids.gif`, `SolidArcNativeViewGrids.gif`). Capture adapters and
CPU/native-Vulkan limits remain explicitly labelled. Both running services were
restarted after their builds; this does not claim a new native Vulkan backend.

### 16 October — dimensions / orientation / curve roster

See `Experimental/SolidArc/WORKFLOW.md` for the shared HTML/native behavior and evidence.
Native Construct now exposes 17 mouse-driven sketch/reference tools, including Circle2,
Circle3, Arc3 and Polyline Slot. The outliner uses persistent `SceneFigure::ShapeKind`
through the shared `CadWidgets::DrawShapeIcon`; names do not determine geometry icons.
The bottom-right shared ViewportPanel cube projects 3D faces using the actual camera,
rejects hidden faces, emits ImGui GPU triangle meshes and snaps both camera/workplane.
The CAD yaw convention differs from Frontier's non-CAD compass, and is explicitly mapped.
All six native face clicks are tested with an intentionally incorrect starting workplane.
Live labels use the allowed DM Sans UI font at 11 px, black/.72 radius-9 capsules,
white 1 px guides and filled arrow triangles; angle guides use the reference warm tint.
The underlying scene strokes/arrow triangles use the shared Slang bodies; native cube
and text are ImGui UI geometry, not browser screenshots. Headless evidence is CPU;
physical-GPU/native Vulkan execution remains unverified. The transform gizmo is preserved.

Viewport orbit correction: `CameraProjection::OrbitScreen` rotates eye/up together
around a fixed pivot, rather than clamping a yaw/elevation-only tilt at the poles.
Roll-aware native/HTML matrices agree over 28 test steps. Native mouse navigation
uses the same vertical direction and .006 rad/pixel scale as HTML. Standard views
clear roll; old 19-field input journals still load, new records preserve orientation.
The shared native cube now transforms its actual ImGui font glyph vertices through
face U/V, matching the HTML face-affine label mapping. The main viewport, not a selected
object, is the corrected interaction; object transform tools remain separate.

RMB axis correction: native ImGui right-drag now uses world-Z yaw / camera-right
elevation with zero roll, matching HTML's explicit `turntable` gesture. Plain browser
button 2 is no longer pan; MMB and Shift+RMB remain pan. Native button 1 maps to this
same right-drag path. The free-orbit behavior described above remains for left/Alt,
not RMB. Native mouse tests now isolate both RMB axes as well as Alt pole orbit.

Screenshot regression fix: ALL viewport drags now use the same upright Z-up turntable.
`OrbitScreen` delegates to `Orbit`; no native/HTML arcball path remains. `Right().Z`
is zero and camera up has nonnegative world-Z component. Legacy roll in browser
copies, native camera requests and input journals is discarded; rendering ignores it
as a safety invariant. Cube font UV mapping remains. This supersedes the earlier
free-orbit and pole-escape behavior documented above.
