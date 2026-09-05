# SolidArc — parametric NURBS modelling tool (C++20, console + rasterised proofs)

Folder: `ParametricSketcher/`. Application name: **SolidArc**.

A standalone modelling tool that lives beside `Engine/` and `Projects/` and depends on neither. Every piece of
geometry is a NURBS curve or surface; every solid is a B-rep of trimmed NURBS faces; every visual is drawn by a
GPU-shaped renderer (software rasteriser here, Vulkan on a machine with a GPU). No UI toolkit: all data goes to the
console, all visuals go to PNG proofs in `Proofs/`.

## Build & verify

```bash
cd ParametricSketcher
cmake -B build -G Ninja
cmake --build build
ctest --test-dir build --output-on-failure      # or run ./build/KernelVerification directly for the full table
```

No external packages. `-Wall -Wextra -Wpedantic -Werror`.

## Layout

| Folder | Role | Status |
|---|---|---|
| `Kernel/` | Pure geometry, zero dependencies (port target for anything) | **Phase 1 ✓** |
| `Interaction/` | `CameraProjection` · `SnapResolution` (grid/endpoint/midpoint/centre/quadrant/on-curve/perpendicular/tangent/intersection/axis, pixel radius + priority) · `InputEvent` · `HotkeyChart` (Plasticity + Blender defaults, rebindable) · `ToolSession` (modal prompts, numeric entry, axis/plane locks, rubber-band preview, G/R/S) · `TransformGizmo` (GizmoPRO per `References/Gizmo.html`: cone/puck/plane/sector per axis, billboarded ring, analytic picking, Ctrl snapping) | **Phase 3 ✓** |
| `Presentation/` | `RasterExchange` seam · `SoftwareRaster` (CPU, pick + depth, PNG with own deflate) · Slang shaders compiled twice: by Slang for Vulkan later, by the C++ compiler through `SlangMirror.h` today · `ScenePresentation` (kernel → streams) · `MatcapStudio.slang` (ten procedural studios baked once to a layer array; one matcap **per object**, switchable flat / plastic / matcap) | **Phase 2 ✓** |
| `Console/` | `CommandCodec` (`.arc` grammar) · `ConsoleHost` (sketch, primitives, extrude/revolve/loft, scene, view, `render`, `pick`) · `SolidArc` executable (script / `-c` / REPL) | **Phase 2 ✓** |
| `Document/` | `SceneDocument` — named items with stable identities (pick id = item ⊕ pole index), per-item pole selection · `HistoryLedger` — snapshot undo / redo with a change fingerprint | **Phase 4 ✓** |
| `Verification/` | One console-proof executable per phase, registered with ctest | ongoing |
| `Scripts/` | Reproducible `.arc` scripts (the visual test suite) | Phase 3+ |
| `Proofs/` | PNG outputs shown after each phase | Phase 2+ |

### Kernel (Phase 1)

| Unit | Contents |
|---|---|
| `ScalarCriteria.h` | The one tolerance policy (`KernelTolerance 1e-9`, `MergeTolerance 1e-6`, `AngularTolerance 1e-7`), `Refusal` / `Deliver<T>` fail-fast values |
| `VectorSpecification.h` | `Vec2/3/4`, `Quat`, column-major `Mat4` (Vulkan clip conventions, Z-up right-handed), `Plane`, `Workplane`, `Ray`, `Box3` |
| `CurveSpecification` | `NurbsCurve`: exact rational Line / Arc / Circle / 3-pt arc / Ellipse / Rectangle (+rounded) / Polygon / Slot, Bézier, control-point B-spline (open + periodic), global interpolation; de Boor, derivatives, curvature, length, closest point (Newton), knot insertion, Bézier decomposition, degree elevation, split / trim / reverse / join, adaptive tessellation |
| `SurfaceSpecification` | `NurbsSurface`: exact Plane / Sphere / Cylinder / Cone / Torus, B-spline patch, Extrusion, Revolution, Ruled, Loft (homogeneous skinning so circles stay exact); derivatives, outward normals (degenerate poles handled), iso-curves, closest point, knot insertion / split in U and V, curvature-adaptive tessellation with CCW triangles |

Winding contract: for every closed primitive `∂S/∂u × ∂S/∂v` points **outward**; tessellations are CCW seen from
outside. Verified numerically in `KernelVerification` — this is what booleans and back-face tinting rely on later.

## Phase plan

| # | Phase | Proof |
|---|---|---|
| 1 | Kernel: vectors, tolerance, NURBS curves & surfaces | `KernelVerification` — 76 checks (radius error < 1e-12, de Boor ≡ Bernstein, refinement invariance, outward normals) |
| 2 | `RasterExchange` + software rasteriser + Slang shaders (grid, line, point, surface) + camera | `Proof_02_Grid.png`, `Proof_02_Sphere.png` |
| 3 | Workplane, snap, modal input, sketch tools (Line … control-point curve) | dimensioned profile with snap markers |
| 4 | Pick pass, selection modes, records, undo/redo, hotkey table | highlighted selection, box select |
| 5 | Gizmo (GizmoPRO design) + G/R/S modal + numeric input | combined and separate T/R/S gizmos |
| 6 | B-rep topology + primitives + shell validation | all primitives, back-face tint |
| 7 | 2D booleans, fillet / chamfer / trim / offset / join | region tables, winding normalised |
| 8 | Extrude / Revolve / Loft / Sweep → solids | extruded profile with hole, revolved vase |
| 9 | Surface–surface intersection + 3D NURBS booleans | box∪box, box−cylinder, sphere∩box, coplanar subtract |
| 10 | Script suite, contact sheet, Vulkan backend hand-off notes | ctest green |

## Console quick start

```bash
./build/SolidArc Scripts/Phase2_Primitives.arc        # run a script; PNGs land in Proofs/
./build/SolidArc -c "circle (0,0) 3; sphere (0,0,1) 1; view iso; view frame; render Quick"
./build/SolidArc                                        # REPL — type help
```

Points are `(x,y)` on the active workplane or `(x,y,z)` in world. Items are addressed by name or `#id`.

## Modal input (Phase 3)

The console is the input device — the same events a window will send later:

| Command | Meaning |
|---|---|
| `tool line` / `rect` / `circle` / `arc` / `spline` / … / `move` / `rotate` / `scale` | start a modal tool (prompts print as you go) |
| `pointer x y` · `click [--right] [--shift]` · `wheel n` | synthetic pointer; tools snap and preview |
| `key g` · `key shift+x` · `key numpad7` · `key enter` · `key esc` | hotkeys (global chart) or modal keys (tool) |
| `type 4` · `type 2,5` · `type @1,1` · `type r2` · `type a45` · `type a30,2` · `type n6` · `type d2` · `type 3*2` | numeric entry: distance · absolute · relative · radius · angle · polar · sides · degree · arithmetic |
| `probe x y` · `snap …` · `hud` · `bind`/`unbind`/`bindings` | inspect snapping, toggle it, dump modal state, edit the hotkey chart |

| `gizmo on|off` · `gizmo combined|translate|rotate|scale` · `gizmo size px` · `gizmo handles` · `release` | GizmoPRO on the selection; `handles` prints every handle's pixel so scripts can grab it; `click` on a handle starts a drag, `pointer` moves it (`--ctrl` snaps 0.25 m / 0.1× / 5°), `release` commits |
| `show shading flat|plastic|matcap` · `matcap <items> <studio>` · `matcap list` · `tint <items> r g b` | shading mode for the view; per-object studio (steel chrome gold copper plastic-white plastic-red plastic-blue clay pearl carbon) |


## Selection and history (Phase 4)

| Command | Meaning |
|---|---|
| `click x y [--shift]` · `select box x0 y0 x1 y1 [--add|--subtract]` · `select all|none|invert` · `select <items>` | pick-plane selection: click, toggle, marquee (hidden items never select) |
| `selectmode control|edge|face|object|cycle` · keys `1 2 3 4`, `Tab` | Plasticity modes; control mode picks poles, `select poles <item> <i…>|all|none` |
| `hide` `H` · `hide unselected` / `isolate` `Shift+H` · `unhide all` `Alt+H` · `delete` `X` | visibility and removal |
| `duplicate [(dx,dy,dz)]` `Shift+D` · `mirror x|y|z [--copy]` `Alt+X` | copies keep the source's matcap / tint; mirrored surfaces are re-oriented so normals stay outward |
| `undo [n]` `Ctrl+Z` · `redo [n]` `Ctrl+Shift+Z` / `Ctrl+Y` · `history` | every mutating command is one entry; a gizmo drag from grab to release is one entry; selection undoes with geometry |

Gizmo in control mode moves only the selected poles (pivot = their centroid), so a cage edit is a drag.

Inside a tool: `X`/`Y`/`Z` lock an axis (again to clear), `Shift+X/Y/Z` lock a plane, `Backspace` removes the last point,
`Enter`/right-click confirm, `Esc` cancels, `↑`/`↓` change polygon sides or spline degree, `Ctrl` while moving suppresses snapping.

