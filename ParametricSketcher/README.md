# SolidArc — parametric NURBS modelling tool (C++20, console + rasterised proofs)

Folder: `ParametricSketcher/`. Application name: **SolidArc**.

A standalone modelling tool that lives beside `Engine/` and `Projects/` and depends on neither. Every piece of
geometry is a NURBS curve or surface; every solid is a B-rep of trimmed NURBS faces; every visual is drawn by a
GPU-shaped renderer (software rasteriser here, Vulkan on a machine with a GPU). No UI toolkit: all payload goes to the
console, all visuals go to PNG proofs in `Proofs/`.

## Build & verify

```bash
cd ParametricSketcher
cmake -B build -G Ninja
cmake --build build
ctest --test-dir build --output-on-failure      # or run ./build/KernelVerification directly for the full chart
```

No external packages. `-Wall -Wextra -Wpedantic -Werror`.

## Layout

| Folder | Role | Status |
|---|---|---|
| `Kernel/` | Pure geometry, zero dependencies (port target for anything) | **Phase 1 ✓** |
| `Interaction/` | `CameraProjection` · `SnapResolution` (lattice/endpoint/midpoint/centre/quadrant/on-curve/perpendicular/tangent/intersection/axis, pixel radius + priority) · `InputEvent` · `HotkeyChart` (Plasticity + Blender defaults, rebindable) · `ToolSession` (modal prompts, numeric entry, axis/plane locks, rubber-band preview, G/R/S) · `TransformGizmo` (GizmoPRO per `References/Gizmo.html`: cone/puck/plane/sector per axis, billboarded ring, analytic picking, Ctrl snapping) | **Phase 3 ✓** |
| `Presentation/` | `RasterExchange` seam · `SoftwareRaster` (CPU, pick + depth, PNG with own deflate) · Slang shaders compiled twice: by Slang for Vulkan later, by the C++ compiler through `SlangMirror.h` today · `ScenePresentation` (kernel → streams) · `MatcapStudio.slang` (ten procedural studios pre-render once to a layer sequence; one matcap **per whole**, switchable flat / plastic / matcap) | **Phase 2 ✓** |
| `Console/` | `CommandCodec` (`.arc` grammar) · `ConsoleHost` (sketch, primitives, extrude/revolve/loft, scene, view, `render`, `pick`) · `SolidArc` executable (script / `-c` / REPL) | **Phase 2 ✓** |
| `Document/` | `SceneDocument` — named figure with stable identities (pick id = figure ⊕ pole index), per-figure pole selection · `UndoSequence` — snapshot undo / redo with a change fingerprint | **Phase 4 ✓** |
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

Winding rule: for every closed primitive `∂S/∂u × ∂S/∂v` points **outward**; tessellations are CCW seen from
outside. Verified numerically in `KernelVerification` — this is what booleans and back-face tinting rely on later.

## Phase schedule

| # | Phase | Proof |
|---|---|---|
| 1 | Kernel: vectors, tolerance, NURBS curves & surfaces | `KernelVerification` — 76 checks (radius error < 1e-12, de Boor ≡ Bernstein, refinement invariance, outward normals) |
| 2 | `RasterExchange` + software rasteriser + Slang shaders (lattice, line, point, surface) + camera | `Proof_02a_Lattice.png`, `Proof_02_Sphere.png` |
| 3 | Workplane, snap, modal input, sketch tools (Line … control-point curve) | dimensioned profile with snap markers |
| 4 | Pick step, selection modes, records, undo/redo, hotkey chart | highlighted selection, box select |
| 5 | Gizmo (GizmoPRO design) + G/R/S modal + numeric input | combined and separate T/R/S gizmos |
| 6 | B-rep topology (`BrepBody`), sew / cap / orient, solid primitives, face & edge selection | `TopologyVerification` — 79 checks; `Proof_06a/b/c` |
| 7 | 2D booleans, fillet / chamfer / trim / offset / join | area tables, winding normalised |
| 8 | Extrude / Revolve / Loft / Sweep → solids | extruded profile with hole, revolved vase |
| 9 | Surface–surface intersection + 3D NURBS booleans | box∪box, box−cylinder, sphere∩box, coplanar subtract |
| 10 | Script suite, contact sheet, Vulkan Vulkan hand-off hand-off notes | ctest green |

## Console quick start

```bash
./build/SolidArc Scripts/Phase2_Primitives.arc        # run a script; PNGs land in Proofs/
./build/SolidArc -c "circle (0,0) 3; sphere (0,0,1) 1; view iso; view fit; render Quick"
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
| `inspect x y` · `snap …` · `hud` · `bind`/`unbind`/`hotkeys` | inspect snapping, toggle it, dump modal state, edit the hotkey chart |

| `gizmo on|off` · `gizmo combined|translate|rotate|scale` · `gizmo size px` · `gizmo grips` · `release` | GizmoPRO on the selection; `grips` prints every grip's pixel so scripts can grab it; `click` on a grip starts a drag, `pointer` moves it (`--ctrl` snaps 0.25 m / 0.1× / 5°), `release` commits |
| `show shading flat|plastic|matcap` · `matcap <figure> <studio>` · `matcap list` · `tint <figure> r g b` | shading mode for the view; per-figure studio (steel chrome gold copper plastic-white plastic-red plastic-blue clay pearl carbon) |


## Selection and timeline (Phase 4)

| Command | Meaning |
|---|---|
| `click x y [--shift]` · `select box x0 y0 x1 y1 [--add|--subtract]` · `select all|none|invert` · `select <figure>` | pick-plane selection: click, toggle, marquee (hidden figures never select) |
| `selectmode control|edge|face|whole|cycle` · keys `1 2 3 4`, `Tab` | Plasticity modes; control mode picks poles, `select poles <figure> <i…>|all|none` |
| `hide` `H` · `hide unselected` / `isolate` `Shift+H` · `unhide all` `Alt+H` · `delete` `X` | visibility and removal |
| `duplicate [(dx,dy,dz)]` `Shift+D` · `mirror x|y|z [--copy]` `Alt+X` | copies keep the source's matcap / tint; mirrored surfaces are re-oriented so normals stay outward |
| `undo [n]` `Ctrl+Z` · `redo [n]` `Ctrl+Shift+Z` / `Ctrl+Y` · `timeline` | every mutating command is one entry; a gizmo drag from grab to release is one entry; selection undoes with geometry |

Gizmo in control mode moves only the selected poles (pivot = their centroid), so a cage edit is a drag.

Inside a tool: `X`/`Y`/`Z` lock an axis (again to clear), `Shift+X/Y/Z` lock a plane, `Backspace` removes the last point,
`Enter`/right-click confirm, `Esc` cancels, `↑`/`↓` change polygon sides or spline degree, `Ctrl` while moving suppresses snapping.


## Boundary representation (Phase 6)

`Kernel/TopologySpecification.{h,cpp}` adds `BrepBody`: vertices, edges (NURBS curves), coedges (edge + sense), loops, faces (NURBS
surfaces + `Reversed` switch + trimming loops). Bodies are assembled with one generic operation — `BrepBody::Sew(surfaces)`:

1. every surface becomes a face whose natural boundary is split at tangent kinks, so a hexagon prism gets six side faces and one
   edge per corner while a slot extrusion stays a single side face;
2. coincident boundary curves are merged into shared edges (`FindCoincidentEdge`, either sense);
3. `Orient()` walks face adjacency so every interior edge has two coedges of opposite sense, then flips the whole body if the
   divergence-theorem volume is negative;
4. `Capped()` fits a plane (Newell) to every remaining open loop and adds a trimmed planar face, triangulated by ear clipping with
   hole bridging;
5. `Validate()` reports V/E/F/L, hulls, open / non-manifold / mis-oriented edges, χ, genus, volume and area.

`Box`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Extrude(profile, dir, length)` and `Revolve(profile, origin, axis, angle)` are thin
wrappers over `Sew`. Tessellated volumes land within 0.1 % of the analytic values; χ = 2 for genus-0 solids, 0 for the torus and ring.

Console: `box`, and `cylinder`/`cone`/`sphere`/`torus`/`extrude`/`revolve` now produce solids (`--sheet` keeps a plain surface; an
open profile still extrudes to a sheet). `topology <body>` prints vertices, edges with their coedge senses, loops and face normals;
`sew <figure…>` stitches surfaces. Select modes 3 (face) and 2 (edge) pick faces and edges from the pick plane — each face and edge
carries its own pick id — and `select faces|edges <body> <i…>|all|none` does it by index. Sub-selections drive the gizmo pivot and
are hashed into the undo timeline.

## Planar profile algebra (Phase 7)

`Kernel/ProfileSolver.{h,cpp}` works on **closed planar NURBS loops** without dropping to polygons:

- `Intersect(A, B)` — Bézier-piece subdivision on pole hulls, then a Newton polish on both parameters; crossings land within
  1e-12 on both curves and tangent contacts are labelled. `SelfIntersections` uses the same machinery span against span.
- `SignedArea`, `Winding(P)` — Green's theorem / crossing count on a 1e-5-sagitta tessellation; counter-clockwise about the
  profile normal is material, clockwise is a hole, and a point is inside when its total winding is non-zero.
- `Assemble` validates closure, planarity, coplanarity and simplicity, then nests loops (depth 0 outer, 1 hole, 2 island …);
  `Normalised` fixes each loop's sense to its depth parity, so input winding never matters.
- `Combine(A, B, union | subtract | intersect)` splits every loop at true crossings, classifies each piece by the other
  profile's winding just left and just right of its midpoint (so coincident boundaries are kept exactly once), reverses the
  B pieces of a subtraction, and chains survivors by sharpest-left-turn. Circle pieces stay rational quadratics — the notch
  in a subtracted circle lies on the true circle to 1e-12.
- `Filleted` / `Chamfered` replace corners (all, or `--corners=i,j`) by exact tangent arcs / lines with arc-length setbacks;
  corners whose setbacks collide are left sharp. `Offset` shifts lines and arcs exactly (arcs change radius, circles remain
  exact circles), bridges convex corners with arcs and trims concave ones. `Trimmed` removes the piece nearest a point between
  crossings with the cutters; `Joined` chains pieces in any order or sense.

Console: `boolean union|subtract|intersect <A…> -- <B…> [--keep]` (Q / Shift+Q / Ctrl+Q on the selection), `profile`,
`intersections`, `fillet <curves> r`, `chamfer <curves> d`, `offset <curves> d [--copy]`, `trim <curve> (near) [--by=…]`,
`join`, `explode`. Results are ordinary curves, so they extrude / revolve into solids with holes.
