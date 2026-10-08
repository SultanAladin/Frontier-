# Car CAD — Plasticity-grade surface modeller for automotive

**Standing:** Ongoing — curves-first per 2026-10-08 carve-out (strict Plasticity hotkeys, Experimental prototype)
**Reference UI:** `Experimental/ProjectZeroEditor/index.html` (4.87 MB built bundle, DM Sans Light 300 / Regular 400, 1.302 grind)
**Kernel:** `Editor/AuthoringTools/Modelling/SolidArc` (NurbsCurve / NurbsSurface, BlendSolver, ConstraintGraph, HotkeyChart, ToolSession)
**Track:** `arena/5c85f535-frontier` form, latest not old `Experimental/FrontierEditor` stub

---

## 1. Why a separate Car surface modeller

SolidArc is a solid modeller (B-rep, booleans). Cars are Class-A surfaces — open, G2, trimmed, not booleans. The sheet that builds a fender is a **Loft → Fillet → Trim → Mirror** chain, not a solid primitive. ProjectZeroEditor already ships the 3-dock workspace (Left=Outliner, Centre=Viewport, Right=Inspector) that a Plasticity work-alike wants; we keep the kernel in SolidArc and prototype the car sheet workflow in a new `Experimental/CarEditor` using that exact workspace chrome.

## 2. Hotkeys — strict Plasticity

`HotkeyChart::Defaults()` already ships Plasticity+Blender. For CarEditor we narrow to **strict Plasticity** and make the chart payload (rebindable via `bind` console verb):

| Chord | Verb | Notes |
|-------|------|-------|
| `g` `r` `s` | move / rotate / scale | X Y Z lock axis, Shift+X/Y/Z lock plane, digits type distance |
| `q` `shift+q` `ctrl+q` | boolean union / subtract / intersect | Plasticity Q family |
| `l` `shift+p` `shift+l` | loft / sweep / fillpatch | loft selected in order |
| `b` `shift+b` `o` | fillet / chamfer / offset | radius via `fillet`/`chamfer`/`offset` |
| `e` `c` `t` `j` | extrude / cut / trim / join | |
| `1` `2` `3` `4` `tab` | select control / edge / face / solid / cycle | |
| `shift+a` `ctrl+shift+*` | line / circle / rect / arc / polygon / spline / slot / ellipse | sketch |
| `f` `f3` | command search | Plasticity F |
| `space` `numpad*` | fit / iso / front / back / etc. | |

Modal layer (ToolSession) consumes: **Enter/Left-click confirm, Esc/Right-click cancel, X Y Z axis lock, digits numeric, Tab next field, Ctrl snap-toggle, Shift precision, Alt quantise**.

## 3. Curves — all types, especially G1/G2

**One representation:** `NurbsCurve` (clamped, homogeneous `Vec4` poles). Lines are degree 1, arcs/circles/ellipses are exact rational quadratics (Piegl & Tiller §7.5), splines are cubics. Classification is a hint (`CurveClassification`) that snaps report as “Circle”.

**Types shipped (CurveSpecification.h) + CarEditor exposes:**

* `Line(Vec3 A, Vec3 B)`, `Polyline`, `Circle`, `Arc`, `ArcThreePoints`, `Ellipse`, `Rectangle` (with corner radius), `Polygon` (inscribed/circumscribed), `Slot`, `Bezier`, `ControlPoints` (B-spline), `Interpolate` (through points, cubic), `InterpolateHomogeneous` (rational survive loft)

**Missing for cars → this plan adds:**

* **G1/G2 continuity handles per vertex.** Curve join `Join(A,B)` today is C0 only. CarEditor adds a `CurveContinuity` tag per join: `C0 | G1 (tangent, magnitude free) | G2 (curvature, curvature comb visible)`. Stored on the `FigureRecipe` blue-print, solved by extending `ConstraintGraph` with `Tangent` and `Curvature` constraints (two scalar rows each) and a curvature-comb overlay in `SoftwareRaster`. UI is a per-point inspector pill (G0 / G1 / G2) + drag handles.

* **Handle types:** Auto / Sharp / Smooth / Symmetric — mirrors Plasticity's per-point handle mode. Smooth enforces G1, Symmetric enforces G1+equal length (circularise for G2).

* **Closed periodic splines** for belt lines, wheel arches.

## 4. Surfaces — all types

`NurbsSurface` already ships: `Plane, Sphere, Cylinder, Cone, Torus, Patch, Extrusion, Revolution, Ruled, Loft` (via `Skin()`), plus `SurfaceOffsetSolver` and `BrepRestructure`.

**Loft is one verb with four types the inspector switches between (Plasticity parity):**

| Loft type | What it does | Kernel |
|-----------|--------------|--------|
| **Ruled / Straight** | Linear between sections (degree 1 in V) | `Ruled()` |
| **Normal** | Profiles stay normal to a guide (car hood bulge) | `Loft()` with guide rail |
| **Developable** | Developable sheet (unrollable) | `FairPatchSolver` with developability fairing |
| **Smooth / G2** | Full loft with G1/G2 per section (Class-A) | `Skin()` + G1/G2 constraints on IsoCurve handles |

**Other surfaces CarEditor needs:**

* `Revolution` (wheels, fillets), `Extrusion` (extruded belt line), `Sweep` (first = profile, second = path — `SkinSolver`), `Coons / Patch` (N-sided fill), `Offset` (panel thickness), `Mirror` (car symmetry).

## 5. Bevel / Fillet / Chamfer

`BlendSolver` and `FaceEditSolver` already exist for edge blends. CarEditor adds the inspector:

* **Fillet:** variable radius per edge, G1 vs G2 roll-ball, conic rho for automotive fillets.
* **Chamfer:** distance + angle or two distances, equal/unequal.
* **Bevel:** offset + profile curve (user draws the bevel profile, swept along the edge chain).

All three are **history** — `ToolSession` records the edge selection, the radius, and the continuity; `UndoSequence` stores it.

## 6. Workspace — ProjectZeroEditor form, car content

```
┌─────────────────────────────────────────────────────────────────┐
│ Titlebar 39px #121212  ·  Workspace bar 40px #202020 / tab #303030 │
├──────────────┬──────────────────────┬──────────────────────────────┤
│ Outliner 240 │ Viewport (checker)   │ Inspector 330 +01px gap      │
│ #1b1b1b      │ #151515 toolbar 40   │ #1b1b1b pane 39 #222          │
│ LEF 01..05   │ 1028px at 1600w      │ Material / Impact / Quality  │
│ collections  │ metrics 72 + preview │ 5 cards r22 #191919          │
│ search F     │ F3 diagnostics       │ status 26 #111               │
└──────────────┴──────────────────────┴──────────────────────────────┘
```

Outliner (Left) — collections + bodies, filter Lights/Sky/Bodies/Geometry/Camera, search, `F2` rename, hide, `Ctrl+A` Construct.
Viewport (Centre) — checker or `SoftwareRaster` matcap, `Space` fit, `Numpad` iso, `Alt+Z` xray, `ToolSession` gizmo, curvature combs.
Inspector (Right) — per selection: curve type cards, per-vertex G0/G1/G2 pills + handle types, surface cards (loft type switch, guide rails, continuity), edge chain fillet/chamfer/bevel cards.

## 7. Phasing (curves-first per user choice)

* **P0 — scaffold** (this turn): `Experimental/CarEditor` cloned from ProjectZeroEditor workspace, strict HotkeyChart preset, outliner+inspector car content stub, docs.
* **P1 — curves & G1/G2** (next): `CurveContinuity` tag, `ConstraintGraph` Tangent/Curvature, comb overlay, `Join` with G1/G2, handle types in inspector. Proof: `VisualProof/CarCurves/`.
* **P2 — loft types**: Ruled/Normal/Developable/G2 loft UI, `Skin()` + guide, `Patch` Coons. Proof: `VisualProof/CarLoft/`.
* **P3 — edge**: Fillet/Chamfer/Bevel inspector + `BlendSolver` variable radius. Proof: `VisualProof/CarEdges/`.
* **P4 — car vertical**: One fender (3 curves G2 → Normal loft → Fillet 12mm G2 → Mirror) drivable end-to-end, hotkeys exercised. Proof: `ToyCar.arc` extended + contact sheet.

## 8. Deviation log

* `Experimental/FrontierEditor` is **not** the reference — 438-byte Vite stub. Only `ProjectZeroEditor/index.html` is.
* `InspectorDepot` second kit is not the reference for light/inspector — only `kit.js:el()` is borrowed.
