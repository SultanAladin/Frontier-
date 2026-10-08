# CarEditor — Plasticity-grade car surface lab (Experimental)

Strict Plasticity prototype using the **latest** `Experimental/ProjectZeroEditor` 3-dock form (not the old `FrontierEditor` stub).

* **Workspace:** Titlebar 39px #121212 + Workspace bar 40px #202020 + 3 columns `240 | 1fr | 330` gap 1px + pane heading 39px #222 — same chrome as the built bundle.
* **Outliner Left:** bodies → curves/surfaces, filter B/C/S, search `F`, `F2` rename, `H` hide, `Shift+A` add curve, `Tab` mode 1/2/3/4.
* **Viewport Centre:** SoftwareRaster placeholder (checker), toolbar Solid/Wire/XRay, `Space` fit, `Numpad` iso, G-move with X/Y/Z lock, curvature comb for G2.
* **Inspector Right:** 5 cards r22 #191919
  01 **Curve** — all types: Line, Polyline, Arc (3pt), Circle, Ellipse, Rectangle, Polygon, Slot, Bézier, B-Spline, NURBS Interp. One NURBS representation (Piegl & Tiller), classification is a snap hint.
  02 **Continuity** — per-vertex **G0 / G1 / G2**, handle modes Auto/Sharp/Smooth/Symmetric, curvature comb overlay.
  03 **Loft** — Ruled (deg1) / Normal (guide) / Developable (unrollable) / Smooth G2 (Class-A) + guide rail + per-section continuity.
  04 **Surfaces** — Extrusion, Revolution, Ruled, Sweep, Coons Patch, Offset, Mirror.
  05 **Bevel / Fillet / Chamfer** — variable radius, G1 vs G2 roll-ball, bevel via swept profile curve.

**Hotkeys:** strict Plasticity (`HotkeyChart::Defaults()` narrowed). `g r s` transform, `q`/`shift+q`/`ctrl+q` booleans, `l` loft, `shift+p` sweep, `shift+l` fillpatch, `b`/`shift+b`/`o` fillet/chamfer/offset, `e` extrude, `c` cut, `t` trim, `j` join. Modal: Enter/Left-click confirm, Esc/Right-click cancel, X Y Z lock, digits numeric, Tab next field.

Run:

```sh
cd Experimental/CarEditor
npm ci
npm run dev -- --port 5174
# http://localhost:5174/
```

Build is parity-checked against `ProjectZeroEditor/index.html` chrome; geometry will wire to `SolidArc` kernel (`CurveSpecification`, `SurfaceSpecification::Loft/Ruled/Sweep/Patch`, `BlendSolver`, `ConstraintGraph` Tangent/Curvature).
