# SolidArc Panel — Outliner · Viewport · Inspector (HTML)

Single-file UI (`index.html`, no build step) for exercising SolidArc through a UI before the
C++ console host is bridged. Same visual language as the Celestial panel on GitHub Pages
(glass panels, Outfit / JetBrains Mono, tick-track sliders, presence grid, stat tiles) — but the
three panels are **separate floating cards**: Outliner (left), Viewport (centre), Inspector (right).

Run: `python3 -m http.server 8080` in this folder → http://localhost:8080/

| Panel | What works today (JS model) | Hook-up point for the C++ host |
|---|---|---|
| Outliner | groups by figure kind (Sketches → curves, Bodies, Surfaces, Construction, Dimensions), search, kind filter chips, visibility eye, multi-select (⇧), status tiles, undo counter | `doc.figures` ← `SceneDocument` listing |
| Viewport | software raster (Z-up orbit camera, ortho/persp, canonical views), wire/flat/plastic/matcap, lattice, dimension lines, GizmoPRO stub, axis triad, prompt bar for modal tools (L/C/R/B/Y), pick, body/face/edge/vertex mode | replace `draw()` with the PNG/stream from `SoftwareRaster`; forward pointer/keys as `InputEvent` |
| Inspector | hero card (volume/area/length + B-rep stats), presence grid (Visible/Locked/Construction/Dims), transform XYZ steppers + rotation, live parameter sliders that rebuild derived figures, recipe chain, sketch curves + constraint summary, dimensions list (+ add/remove), duplicate/isolate/delete, command line (`box`, `cylinder`, `extrude`, `dim on|off`, `hide`, `show`, `select`, `view`) | `runCmd()` ← send verb to `ConsoleHost`; sliders ← `FigureRecipe` param edit |

## Transform gizmo (port of Slate `References/Gizmo.html`, Blender behaviour)
Select a body and the gizmo appears at its **centre** (bounding-box middle, like Blender's median pivot), oriented with the body, ~92 px on screen at any zoom. It has three modes, chosen with the **Move / Rotate / Scale** segment in the toolbar or **G / R / S** — only the handles of the current mode are shown:
- **Move** — cone per axis (X red, Y green, Z blue) + corner quad per plane (cyan / magenta / yellow).
- **Rotate** — full ring per axis (back half faded) + white outer ring for rotation about the view axis.
- **Scale** — capped cylinder per axis. Rotation and scale act about the pivot, so the body stays centred.

Hover highlights white; drag applies live. The readout at the top (`X move  12.50 mm`, `Y scale 1.100 ×`, `Z rotate 15.0 °`) has an **editable value**: click it or press **Tab / Enter / =** during a drag or modal, type an exact number, **Enter** commits, **Esc** cancels. Hold **Ctrl** to snap (5 mm / 0.1× / 5°). Every operation is one undo step.

Modal (Blender): **G / R / S** with a body selected, move the mouse; **X / Y / Z** lock an axis (again = clear; an axis line is drawn); type digits for an exact amount; **LMB / Enter** confirm; **RMB / Esc** cancel. `R` with no body selected still starts the rectangle tool.

### Curves have their own transform
Clicking a drawn shape selects **that curve**, not its sketch (the sketch is still selectable from the Outliner and moves everything). A curve's gizmo is in-plane: Move = two cones + plane quad, Rotate = ring about the plane normal (+ view ring), Scale = two cylinders. Curve position/rotation/scale are stored in plane (u,v) space and composed with the sketch transform.

Curves can also be lifted off their plane: the Z cone / `G Z` moves along the plane normal (stored as the curve's third coordinate).

### Constraints, dimensions, variables (the "parametric" part)
Every sketch carries `cons_`, solved by a damped Gauss-Newton solver over all curve control points + radii (numeric Jacobian, Cholesky). Open **Tab → Constrain**: Coincident, Horizontal, Vertical, Parallel, Perpendicular, Equal, Tangent, Concentric, Midpoint, Point-on-line, Fix — select vertices/edges (modes 3–4, shift-click) then click the tile. Constraint glyphs appear beside the geometry; the sketch/curve inspector lists them with the DOF count; `×` or `⌫` removes.

**Dimension tool** (`⇧D` or the Dimension tile): click a line → drag → release where you want the label. Click a circle/arc for ⌀/R, two lines for an angle, two points for a distance — while dragging between two points the tool infers **aligned / horizontal / vertical** from where you drag (Fusion style). Drag an existing label to re-place it; double-click it (or click the constraint in the inspector) to edit.

**Per-object dimensions.** Each curve/sketch inspector lists every dimension on it with an inline **name** field (type a name, ⏎) — an object can carry as many dimension lines as you like; `+ dimension` starts the tool on that object. Named dimensions are variables.

**Slots are one entity.** Both Slot and Polyline Slot keep their centre *spine* + radius; the outline is regenerated from them. Picking anywhere on the outline selects the whole slot (one edge), vertices are the slot centres, a length dimension on a slot drives the centre distance, and the inspector exposes the slot radius.

**Editing = variables.** The label editor takes a number or an expression: `W/2 + 3`, `sqrt(2)*R`, `min(A,B)`. Give the dimension a *name* and it becomes a variable other dimensions can use (drawn in blue). **Constrain → Variables** manages free variables. Changing any variable re-solves every sketch. Dragging a constrained vertex pins it and lets the solver move the rest live.

### Select (Q) · Offset/Inset (O) · Fill (⇧F)
- **Select — Q** leaves whatever tool is active (draw, dimension, trim/cut/fillet, offset, fill, gizmo modal) and returns to plain selection. Also a tile in *Sketch Modify*.
- **Offset / Inset — O** hover a curve, click, then drag: the side follows the cursor (inside a closed loop = inset, outside = outset; open curves offset toward the cursor). Type a number for an exact distance, ⏎ / click applies. Circles stay true circles; everything else becomes a mitred polyline. Result is a new curve, ready for a second Fill/extrude.
- **Fill — ⇧F** the sketch is a *planar arrangement*: every closed loop is split at its intersections and the resulting faces are regions (concentric circles → ring + disc; overlapping circles → A, B, lens). Default is even-odd (ring filled, inner disc empty → extrude gives a **pipe**). Hover highlights a region, click toggles it. Fills are stored per sketch (`regions_`); the profile / extrude / area follow the filled regions, so booleans-by-fill work in 2D before any solid boolean exists.

### Sketch Modify — Trim · Cut · Fillet · Chamfer
Tab → *Sketch Modify*, or hotkeys **T** trim, **K** cut, **B** fillet, **⇧B** chamfer. Plasticity-style: no pre-selection, the tool stays live until Esc / right-click.
- **Trim** — hover a curve and the span between its neighbouring intersections lights red; click (or press-and-drag across several) to remove it. End spans shorten the curve, middle spans split it in two, closed loops open, a curve with no intersections is deleted.
- **Cut** — hover a curve, click to split it there; the cursor snaps to nearby intersections (shown as dots). Closed loops become an open polyline at the cut.
- **Fillet / Chamfer** — click a corner (polyline vertex or two curve ends that meet), drag to set radius / distance, or type a number; ⏎ or click applies. Tab flips between fillet and chamfer while dragging. Value is clamped to the corner's maximum. Extra vertices pre-selected on the same curve receive the same fillet. Two touching curves are merged into one polyline.
Modified curves are baked to polylines; constraints that referenced them are dropped (logged).

### Workplanes follow their transform
A workplane's Position / Rotation / Scale (inspector or G/R/S gizmo) now transform the plane *and everything on it* — sketches, curves, dimensions, picking, the drawing tool. `planeBasis()` composes the plane's own transform over its base axis / offset / in-plane rotation. The plane inspector is a workplane editor: base axis (XY/XZ/YZ), offset, in-plane rotation, extent, the sketches on it, and "make active"; no radius or generic dimension controls.

### Select modes · topology layer (B-rep-ready)
**Body / Face / Edge / Vertex** (`1–4`) — **Shift-click** a mode button (or `⇧1–4`) to combine modes, e.g. Vertex + Edge. Every figure exposes `topo(f)` → `{verts, edges, faces}` with stable indices: curves give their control points (poly vertices, line ends, circle centre + radius handle, ellipse centre + two axis handles) and a face when the loop is closed *and planar*; bodies derive unique vertices / edges / coplanar faces from the mesh. The B-rep kernel will later replace `topo()` and `moveCurveVertex()` only — selection, gizmo, inspector and overlay are written against that interface.

Sub-selection: click / shift-click any mix of vertices, edges and faces (even across figures). A translate gizmo appears at the selection centre; drag it, or press **G** (with X/Y/Z lock, typed numbers, Ctrl snap). All selected elements move together; an edge moves its two vertices, a face all of its vertices. Inspector shows the selection list, an editable world position (single vertex) or centre (multi), **flatten to plane**, and **delete vertices** (`⌫`).

Polyline vertices can be lifted off the sketch plane (`vz` per vertex; a dashed drop line shows the offset). The closed-loop fill is only drawn while the loop stays **planar** — lifting one corner removes the fill and flags `loop not planar · no face`; lifting a whole edge (two adjacent vertices) tilts the plane and the fill stays.

### Polygon & slots
**Polygon**: click centre → click radius → **scroll** to change the side count (3–20, shown in the prompt) → click / Enter to confirm. While drawing, construction spokes, the central angle arc, side length, radius and interior angle are shown. **Polyline** shows the segment length and the turn angle at each joint (first segment: angle from the plane's U axis). **Polyline Slot**: click a chain of centres, Enter / right-click to finish — the outline is a proper offset of the chain: round caps at both ends, round arcs on the outer side of each joint and mitre intersections on the inner side, so it reads as circles joined by straight slots with no self-overlap.

### Closed loops, fill, resolution
Closed curves (circle, ellipse, closed polyline/rectangle/polygon/slot, arc with *Closed loop* on) get a semi-transparent fill and are clickable inside. Inspector → **Curve display**: *Closed loop* (polyline / arc), *Fill when closed*, *Segments* (per-curve). Document → Presentation → **Curve resolution** multiplies every circle/arc/ellipse tessellation (0.25×–4×); arcs scale their count by sweep so wide arcs stay smooth.

## Live dimensions while drawing
Every 2-D tool shows its dimensions as dimension lines while you draw: circle `R` and `⌀`, arc `R` + sweep angle, ellipse `a` / `b`, line length, rectangle width × height, polyline last-segment length, polygon / slot overall width.

## Construction catalogue (Tab / right-click / **Construct** button)
Boxier 12 px corners, 560×440 by default, **resizable** from the bottom-right grip (or the native resize corner); the rail/grid/options fill whatever size you give it.
Popup by default (closes after you pick), **pin** it to keep it open as a panel. Rail on the left (Reference · Sketch Draw live; the rest greyed until we port them), tile grid, click → options slide, double-click / **Start drawing** → tool. Tiles are **gated** by document state: sketch tools are disabled with a "set a workplane" fix-chip until a workplane exists; header chips show the active plane and the sketch curves will go into.

Tools: Workplane (XY/XZ/YZ + offset + rotation, no picks) · Datum Point · Line · Polyline · Rectangle · Centre Rect · Slot · Circle (centre/diameter) · Arc (centre-start-end, CCW/CW) · Ellipse · Polygon (inscribed/circumscribed) · Point. Every curve is registered under a Sketch on the active plane in the Outliner; the live preview draws in plane-space with a snapping cursor readout.

The document starts **empty**; `?demo` in the URL loads the sample scene.

Keyboard: `1–4` select mode · `5` ortho · numpad `1/3/7` front/right/top · `L ⇧L R C A E P` sketch tools · `⇧W` workplane · `Tab` catalogue · `Enter` finish polyline · `G R S` move/rotate/scale (Blender modal) · `H` hide · `Alt+H` unhide all · `F` frame · `D` dims · `⌫` delete · `Ctrl+Z / Ctrl+Shift+Z` undo/redo · `Esc` cancel/deselect.
