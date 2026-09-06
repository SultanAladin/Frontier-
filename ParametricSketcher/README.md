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
ctest --test-dir build --output-on-failure      # 23 suites, all green; the per-suite chart is at ./build/<Suite>Verification
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
| 9 | Surface–surface intersection + 3D NURBS booleans | `IntersectionVerification` — 47 checks; `Proofs/Phase9_Booleans_{Iso,Top}.png` |
| 9b | FairPatch — energy-fair fills with G0 / G1 / G2 rims from the adjacent faces, tension, guides, N-sided | `FairPatchVerification` — 47 checks; `Proofs/Phase9b_FairPatch_{Iso,Window,Pillow}.png` |
| 10 | Script suite, contact sheet, Vulkan hand-off notes | `SuiteVerification` — 39 checks; `docs/HANDOFF_VULKAN.md`; `docs/CONTACT_SHEET.md`; `Proofs/Phase10_ContactSheet.png` (2×2 of 1280×800 tiles); `Proofs/Phase10_Suite.png` (one iso render of every phase) |
| 11a | `solidify` (single-surface shell, refuses closed / closed-in-U or V / flat-sheet), `loft --guides=a,b` (plasticity-style, sheets bend through named curves via iterative projection with boundary clamping), `chamfer <body> --edges=i` (planar setback along the named body edge, with the two adjacent faces trimmed to the set-back lines and a new planar face added) | `BodyOpsVerification` — 25 checks (refusal cases for body / sphere, success on a saddle shell, bent-loft Z rises above the plain range, boundary rows preserved, single + triple sequential body chamfers reduce the volume) |
| 12 | `bridge <curve1> <curve2> [--degree] [--no-align]` (Plasticity-style 2-section loft: connects two open curves in any orientation as a ruled/skin surface), `array <figure>... --count=N --step=(dx,dy,dz)` (linear array, N total including seed, each copy translated by `Step·T` for `T = K/(N-1)`), `array <figure>... --count=N --axis=(ox,oy,oz),(dx,dy,dz) [--angle=deg] [--scale=s]` (radial array around an arbitrary axis with optional taper), `plane --name=N` + `workplane <name>` (named construction planes, also recoverable from a face normal with `plane --from=<figure> --name=N`) | `ArrayAndBridgeVerification` — 67 checks (bridge bounds match curve extents, linear-array X-step, radial-array Z-preservation + unit volume under rotation, taper shrinks volume, named-plane round-trip, all refusal cases); `Proofs/Phase12_{Bridge,ArrayLinear,ArrayRadial,NamedPlanes,ContactSheet}.png` |
| 13 | `dim list` / `dim <figure> --along=X\|Y\|Z` / `dim <figure> <p1> <p2>` / `dim edit <id> <value>` / `dim hide\|show\|delete <id\|all>` / `angle <polyline> [--at=K]` — dimensions are auto-emitted on every primitive (3 bbox dims on a body, arc-length on a curve, radius + circumference on a circle, Rmajor + Rminor on an ellipse); user-added dims are preserved across re-emit, the label re-formats on every render so an edit shows up immediately; dims are drawn as world-space billboard overlays with extension lines, ticks, and a tiny 5×7 bitmap-font label. A `--no-dim` switch on any primitive suppresses auto-emit. | `DimensionVerification` — 54 checks (3 bbox dims on a box, arc-length 5 on a 3-4-5 line, radius 2 + circumference 4π on a circle, user linear/bbox/free dims, angle 90° on a right triangle, dim edit/hide/show/delete mutates the tree, refusal cases, `--no-dim` suppresses auto-emit); `Proofs/Phase13_{BoxDims,CurveDims,DimEdit,Angle,ContactSheet}.png` |

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

## FairPatch — fills whose rims follow the neighbouring faces (Phase 9b)

`Kernel/FairPatchSolver.{h,cpp}`. `fillpatch` (Phase 8) is a Coons blend: exact on its boundary, blind to what lies
next to it, so it always meets the surrounding faces with a crease. `fairpatch` keeps the exact boundary and *solves*
the interior instead:

- **Rims** are curves or body edges, each with a continuity and a tension. A rim's *support* is the face on the other
  side of the edge (chosen automatically as the face that continues flush with the fill; `@fN` picks one explicitly)
  or, for a sketch curve, the surface / body named by `--on=`. G1 makes the cross-boundary derivative lie in the
  support's tangent plane; G2 also matches the support's normal curvature across the rim (second fundamental form,
  measured by closest point so the support's parameterisation is irrelevant). Tension scales the cross-derivative
  magnitude relative to the Coons fill — 0.5 hugs the rim, 2 fills out.
- **Fair interior**: the boundary pole rows are fixed; the interior poles minimise a bending energy on the control
  net (second divided differences over the Greville abscissae in u, v and the mixed term, so a flat rim gives an
  exactly flat sheet). One linear least-squares solve per round (Cholesky on the normal equations, x/y/z as three
  right-hand sides); G2 and guides are re-projected for three rounds.
- **Guides** (`--guides=a,b`) are interior interpolation conditions: samples of each guide are pulled onto the sheet at
  their closest (u,v).
- **Four rims → one untrimmed quad**; three, five or more rims (or `--star`) → N quads about a centre. The spokes
  carry a shared normal field, perpendicular to the spoke tangent, so both neighbouring quads honour it and the seams
  are tangent-continuous (0.06° across a hexagonal window; 2.5° on a strongly warped pentagon). For a window in a
  smooth skin the centre is placed on the skin itself; for walls meeting the fill at an angle it is lifted along
  their continuation.
- **Report** after every fill: quads, unknowns, worst rim normal angle (G1), worst curvature mismatch (G2), seam
  break, guide deviation and the sampled bending energy against the plain Coons fill.
- **Associative**: `RecipeOperation::FairPatch` stores rims with their continuity / tension / face, guides and options;
  the fingerprint includes the supports' poles, so cutting the window elsewhere or moving a guide rebuilds the fill.

```
fairpatch Windowed:e2 Windowed:e3 Windowed:e4 Windowed:e7 Windowed:e8 Windowed:e9 --g2 --name=Window
fairpatch Block:e4@f2 Block:e5@f5 Block:e6@f3 Block:e7@f4 --g1 --guides=Crest --name=Pillow
fairpatch L1 L2@g2@t0.5 L3 L4 --g1 --on=Tube        # sketch curves, G1 from a named surface, one rim G2 with tension 0.5
fairpatch Bowl:e1@f0 --g2                              # one closed edge, quartered; closes a cut sphere G2
```

`Scripts/Phase9b_FairPatch.arc` → `Proofs/Phase9b_FairPatch_{Iso,Window,Pillow}.png`: a box-shaped window cut through a
drum filled G0 / G1 / G2 (radial deviation from the drum 5.4 % → 0.7 % → 0.3 %; G2 rim curvature mismatch 0.13 of 0.5),
a pillow over a box that leaves every wall vertically and passes through a guide crest (deviation 1 mm), five free
sketch splines filled N-sided, a cut sphere closed G2 (rim normal error 0.005°), and the guide moved with the pillow
following. `FairPatchVerification` (47 checks) measures all of it: planar rims give an exactly planar sheet, G1/G2 rim
angles < 0.5° against a cylinder, tension monotone, guide within 2 mm, star / N-sided seams, refusal of open rings,
and the console verb's per-rim tags, `--on`, `--guides`, undo and regeneration.

## Suite, contact sheet and Vulkan hand-off (Phase 10)

The closing phase is the meta-test: prove the toolchain end to end and write the spec for the GPU port.

**Suite script.** `Scripts/Phase10_Suite.arc` builds one document with a contribution from every phase (sketch,
primitives, profile algebra + areas, loft / sweep / pipe, four booleans, a FairPatch drum window) and renders one
`1280 × 800` iso image, `Proofs/Phase10_Suite.png`. If anything in the kernel is broken the suite image shows it.

**Contact sheet.** `Scripts/Phase10_ContactSheet.arc` composes a single `2560 × 1600` PNG from four separately rendered
`1280 × 800` tiles (top / front / right / iso), each its own fresh scene. The mechanism is a new sub-verb of `render`:

```
render sheet 0                          # capture the current raster as tile 0 (top-left)
render sheet 1                          # ... 1 = top-right
render sheet 2                          # ... 2 = bottom-left
render sheet 3                          # ... 3 = bottom-right
render sheet finalize Phase10_Contact   # 2x2 composite, writes Proofs/<name>.png
```

The compositor lives in `Console/ConsoleHost.cpp` (alongside `render`); it uses the same in-tree PNG writer
(`Presentation/SoftwareRaster::WritePng`) so the sheet has no external dependency. Four `RasterImage` tiles are
captured in `ConsoleHost::SheetTiles[N]`, the script clears the live scene with the new `reset` verb, builds the next
tile's scene, and `finalize` walks the four buffers into a single 2×2 RGBA8 image with a 1 px divider at the inner
edge. `docs/CONTACT_SHEET.md` is the design doc.

**Vulkan hand-off.** `docs/HANDOFF_VULKAN.md` is the contract for the next `VulkanRaster` that will sit next to
`SoftwareRaster` and implement the same `RasterExchange`. The verbs the seam already speaks (one `Begin/End` per
target, one `BindView` per frame, draw-record per draw, three sub-passes for lattice / opaque / overlay, a separate
`R32_UINT` pick attachment, ten matcap studios) are mapped to a single render pass with three sub-passes, one
staging buffer per `Begin/End`, an instance-rate draw record (push constant) and the four `.spv` outputs from the
existing `.slang` sources. The acceptance criterion is a `RendersEqual` check: same scene, same view, SoftwareRaster
vs VulkanRaster, PNG hashes within 1 LSB / channel.

**Regression net.** `SuiteVerification` (39 checks) re-runs every per-phase `.arc` script, asserts each terminates
without refusal, decodes the resulting PNG to confirm the `IHDR` is `1280 × 800` `RGBA8` and the file is non-empty,
runs the Phase 10 suite + contact sheet, and finally drives a `ConsoleHost` directly to confirm the new `render
sheet` / `reset` / `recipe` verbs exist and refuse garbage. It is the single executable that proves the console,
the scene, the kernel and the raster still all agree after every commit.

ctest now registers **22 suites** — 10 per-phase or per-feature verification binaries (552 checks total) and 12
script smoke tests — and all 22 run green on every commit. The per-suite check counts:

| Suite | Checks |
|---|---|
| `KernelVerification`         | 76  |
| `InteractionVerification`    | 54  |
| `SelectionVerification`      | 35  |
| `RasterVerification`         | 24  |
| `TopologyVerification`       | 79  |
| `ProfileVerification`        | 103 |
| `SkinVerification`           | 48  |
| `IntersectionVerification`   | 47  |
| `FairPatchVerification`      | 47  |
| `SuiteVerification`          | 39  |
| **Total** | **552** |

Phase 10 also adds two new console verbs that the other phases do not need: `reset` (clears the scene + undo +
workplane + the contact-sheet tile buffer) and `render sheet <0|1|2|3> / render sheet finalize <name>` (the contact
sheet compositor described above).

## True NURBS booleans — surface–surface intersection on the B-rep (Phase 9)

`Kernel/IntersectionSolver.{h,cpp}` intersects and combines closed solids on their exact NURBS faces — nothing drops to
polygons except the seeding step:

1. **Seed** — coarse tessellations of the trimmed faces are intersected triangle against triangle to find where face pairs
   meet at all.
2. **March** — from each seed the true curve is traced: a predictor step along `Na × Nb`, then Newton on the two tangent
   planes plus the step plane, with `(u,v)` on **both** surfaces carried along. Step size adapts to the turning angle.
3. **Exit on edges** — when the trace leaves a face in its `(u,v)` domain, the exact point is solved as
   *edge curve ∩ other surface* (3×3 Newton), recorded once as an **exit**, and the march continues on the neighbouring face
   through the shared edge. Pieces therefore begin and end on real edges, and both bodies agree on those points to
   `KernelTolerance`. Seams of closed surfaces (cylinder, sphere, torus) are ordinary edges here.
4. **Fit** — each piece becomes a cubic interpolant; chords that stray more than 2 µm from either surface are refined.
5. **Split** — each face is a planar arrangement in its own `(u,v)` domain: trimming loops (split at exits) plus cut
   curves in both directions. The left-face walk (`PlanarCells`) yields the face pieces, holes attached to their cell.
6. **Classify** — a piece touching a cut is inside the other body iff its inward direction across the cut opposes the
   other face's normal (local, exact). Untouched pieces follow by flooding across shared edges, whole untouched hulls
   by a three-ray parity vote.
7. **Assemble** — union / subtract / intersect keep the right pieces (subtraction flips the tool's), share edges and
   vertices (`AddEdge` merges), and store the `(u,v)` trace on every coedge. The result is again a closed, manifold,
   consistently wound body; `Validate()` checks it, `Orient()` only runs if a mismatch is reported.

Topology gained what trimmed curved faces need: `BrepCoedge::Trace` (the `(u,v)` polyline), `CoedgeTrace()` (stored,
iso-side, or projected), and a `TessellateFace` for **trimmed curved faces** — the surface's own lattice is clipped by
the trimming rings (`PlanarCells` again), so a trimmed cylinder tessellates in ~1 ms with a few hundred triangles and the
volume quadrature matches the natural face.

Refusals are explicit rather than guessed: coincident or tangent faces, a curve through a sphere pole / cone apex, a
curve exactly through a vertex, sheets, empty results.

```
boolean subtract Brick Bore            true 3D boolean (bodies); still the 2D profile boolean for sketch curves
boolean union selected                 Q / Shift+Q / Ctrl+Q on two selected bodies
intersections Brick Bore --curves      SSI curve pieces (deviation, length), optionally added as sketch curves
boolean … --keep --verbose             keep the operands · trace the marching
```

`Scripts/Phase9_Booleans.arc` → `Proofs/Phase9_Booleans_{Iso,Top}.png`: box − cylinder (genus 1, 8 − π/2), box ∪ side
rod, sphere ∩ sphere lens (closed-form volume within 2e-3), box − torus through all four walls (10 curve pieces),
sphere scooping a box corner (curve crossing three faces), pipe tee. `IntersectionVerification` checks exact volumes
(box∪box = 15, box∩box = unit cube), inclusion–exclusion identities, genus, face winding of the bore wall and console
behaviour (undo, `--keep`, hotkeys).

## Loft, sweep, pipe, patch — derived figures that follow their sketch (Phase 8)

`Kernel/SkinSolver.{h,cpp}` skins exact NURBS over curves:

- **Loft** — sections are harmonised first: same sense (loop normals), seams rotated to the least twist (exact split +
  join at the best of the knot breaks / closest point / 24 trial seams), common degree and merged knots; then interpolated
  across in V (homogeneous, shared chord-length parameters, so circles stay circles). Closed sections → capped solid;
  `Outer+Hole` groups or filled areas with holes → solid with through-holes (hole sheets face inward); `--loop` closes the
  loft back onto its first section (four circles round a ring → genus-1 torus-like body); `--sheet` keeps the skin open.
- **Sweep** — rotation-minimising frames (double reflection), or `--bases=frenet|fixed`, along any curve or body edge;
  `--scale`, `--twist`, `--stations`. A square along a line is an exact prism (1.08 = 0.36·3); a circle along a quarter
  arc reproduces the quarter torus to 0.2 %. **Pipe** is a sweep of an exact circle.
- **Patch** — Coons blend over 3 or 4 boundaries in any order / sense (rational boundaries are refitted within
  tolerance, integral ones are exact); N ≥ 5 boundaries become N Coons quads meeting at a common centre with mirrored
  spoke tangents (Plasticity's xNURBS-style N-sided fill), delivered as one sewn sheet body; one closed curve is quartered.
- Fixed `NurbsCurve::Split` at an existing full-multiplicity knot (it used to return a one-pole piece).

**Recipes** (`Document/FigureRecipe.{h,cpp}`). Every extrude / revolve / loft / sweep / pipe / fillpatch result carries a
recipe: the operation, its options and the identities of its sources (curves, sketch areas by bounding curves + centroid
signature, body edges). The sources stay in the scene as ordinary curves. After every command the document regenerates
each recipe whose inputs' geometry fingerprint changed — move a section, pull a pole in edit mode, move the box whose
edge a pipe follows, and the result rebuilds. A recipe that can no longer be satisfied (a deleted source, a patch ring
that no longer closes) keeps its last geometry and reports a complaint; undo brings it back. `recipe` lists them,
`dependents <figure>` shows what follows a curve, `recipe bake` detaches a figure into plain geometry.

Console: `loft <sections…>|selected [--degree] [--loop] [--sheet] [--no-align]` (L), `sweep <profile> <path>` (Shift+P),
`pipe <path> r` (P), `fillpatch <boundaries…>` (Shift+L); sections are curves, `aN` areas, `Body:eN` edges or
`Outer+Hole` groups. Edit-mode G/R/S now moves only the selected poles. Script `Scripts/Phase8_Skins.arc`, proofs
`Proofs/Phase8_Skins_{Iso,Top}.png`, `SkinVerification` 48 checks.

## Sketch areas, bucket fill and through-holes (Phase 7b)

Sketch curves on the workplane are arranged into **closed areas** automatically (`Kernel/ProfileSolver::Cells`): every
crossing and T-junction splits the curves, dangling ends are pruned, and each bounded face of the arrangement is traced
once by the leftmost-turn walk — two overlapping squares give three areas (3, 1, 3), a circle cut by a line two half discs,
nested loops become areas with holes at depths 0/1/2. `SceneDocument::RebuildAreas` derives them after every command; the
only user-owned part is each area's **fill**, which survives rebuilds by centroid + area signature and takes part in undo.

- `areas` lists `aN`, fill, depth, area, holes, centroid and bounding curves; filled areas render as translucent sheets
  and are hoverable / clickable (`click`, `select a0 a3`) like any figure.
- `fill on|off|toggle <aN…>`, `fill all|none`, `fill at (x,y) [on|off]` — bucket fill: an area that is filled is material.
- `extrude` / `revolve` accept `aN` or a curve; a filled area (or a closed curve whose filled area it bounds) extrudes as a
  **solid with through-holes** (multi-loop caps, `BrepBody::Extrude/Revolve(loops, …)`, loop senses normalised, Euler
  `V − E + F − (L − F)` so a plate with one hole reports χ 0 / genus 1); an unfilled area or open curve yields sheets.
- Orthographic views hide the gizmo grips that cannot work along the view axis (`gizmo status` → `view along Z (only
  XY-plane move + Z rotate)`; `gizmo grips` prints `hidden (orthographic view along Z)`), and `AimAt(view)` restores the
  full rig as soon as the view is free.

Script `Scripts/Phase7b_Areas.arc`, proofs `Proofs/Phase7b_Areas_Top.png` / `Proofs/Phase7b_Areas_Iso.png`,
checks in `ProfileVerification` (103 in total).

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
