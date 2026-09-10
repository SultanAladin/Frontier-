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

### Polygon & slots
**Polygon**: click centre → click radius → **scroll** to change the side count (3–20, shown in the prompt) → click / Enter to confirm. While drawing, construction spokes, the central angle arc, side length, radius and interior angle are shown. **Polyline** shows the segment length and the turn angle at each joint (first segment: angle from the plane's U axis). **Polyline Slot** (new tile): click a chain of centres, Enter / right-click to finish — the outline is a round-capped, round-joined offset of the chain with the slot radius from the options.

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
