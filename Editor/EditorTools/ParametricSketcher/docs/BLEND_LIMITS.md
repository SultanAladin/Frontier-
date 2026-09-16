# Edge blends — exact face pushes and verified edge cuts

`Kernel/BlendSolver.cpp` implements a planar chamfer as a set operation and a fillet as a tangent cylinder seated on the corresponding flat. `Verification/BlendVerification.cpp` checks topology and volume across the complete pushed-spanner perimeter; this document records the current, reproducible bounds.

## The push-seam defect is removed

The former implementation made `push` by unioning an extrusion whose footprint was pulled inward by a few microns. That made the Boolean transversal, but left a narrow annular remnant of the old face. Its four inner boundary edges were implementation artefacts, not designed edges. They were only about 24 μm away from the real perimeter, so no 3 mm blend could legally fit there; those were the five reported refusals.

`PushFace` now first uses a direct B-rep construction for planar faces:

1. translate the selected face and its boundary edges to its new cap position;
2. retain each original boundary edge at the root;
3. make one ruled wall per boundary edge, sharing the root, cap, and vertical joins; and
4. orient and validate the assembled body before accepting it.

The Boolean push remains as a fallback if a future input cannot be sewn by the direct path. For a full-face push this produces the intended topology exactly: **16 vertices, 26 boundary edges, 12 faces, χ=2, genus 0**, and the expected volume is reached to round-off. The top/bottom root joins are coplanar tangent seams, not corners; `Frame` correctly excludes those two from the blend set.

## Current perimeter sweep

The checked sample is a hexagonal prism with one complete side face pushed 26 mm. The `BlendVerification` sweep starts from the direct-push result and tries every physical planar corner.

| check | current result |
|---|---:|
| physical, non-tangent blend corners | 24 |
| chamfers accepted | **24 / 24** |
| fillets accepted | **24 / 24** |
| returned non-solid bodies | **0** |
| chamfers within 3 μm³ of the closed form | **24 / 24** |
| worst chamfer error | **< 0.000003 mm³** |

This replaces the previous **25 / 30** sweep, its five artificial seam refusals, and its 1% fallback bound. The test now requires all 24 physical corners to chamfer and fillet, no broken body, and every accepted chamfer to reach the 3 μm³ numerical-integration bound. These are executable regression conditions, not image comparisons.

A planar chamfer has an exact local construction. If no cutter placement lands within the round-off bound, `ChamferEdge` now returns an explicit refusal rather than a "closest" but incorrect solid. The pushed-spanner sweep has an exact placement for all 24 physical corners, including both 120-degree shoulders.

## Cutter precision

A bounded cutter needs end caps. A cap placed exactly at an edge end is a non-transversal intersection; placing it well past the end can trim a neighbouring face. `ChamferEdge` therefore evaluates a deterministic ladder of **100** cutter placements: five lateral half-widths and twenty positive/negative along-edge margins, retains the closest closed candidate, and returns it only when its measured volume is within **3 μm³** of the exact closed-form wedge. Otherwise the operation explicitly refuses the inaccurate cut. That tolerance is the tessellated volume integrator's observed numerical floor, not a percentage allowance.

The ladder now includes micro-margins from `1e-8` through `1e-3` in both directions. This lets the Boolean clear a seam without paying the old 0.018 mm³ minimum over-cut from its coarser first step. The direct face push removes the one topology in which no local cutter could be valid at all.

## Fillets

`FilletEdge` first makes the tangent-set-back flat and then replaces that face with the rolling cylindrical surface. It evaluates both the original cap edges and square-end circular cap sections, retaining the valid closed body closer to the analytic removal. A candidate that leaves less material than the flat it replaces is rejected: a convex roll must add material back relative to its tangent chamfer.

### Re-entrant handle roots

The rendered cases are reproducible with `Scripts/Phase21_Blends.arc`, including the re-entrant **210° material-angle** handle root (`e1`) requested for the spanner. The normal-based dihedral is the smaller 150° void angle, so a reflex root must not use the convex Boolean cutter.

For a straight, end-capped prism, the solver traces the complete cap perimeter (including the pieces created by `PushFace`), identifies the reflex turn from the loop orientation, and rebuilds that perimeter through the selected edge. A chamfer replaces the root vertex with one line segment and correctly **adds** its triangular void wedge. A fillet uses an exact rational circular arc with tangent distance `R / tan(void-angle / 2)`, extrudes the arc as its own cylindrical face, and caps the two circular end arcs. Other geometry remains on the existing blend path.

`BlendVerification` checks more than solidity here: the R4 chamfer adds exactly the analytic 210° wedge and has the expected 11-face / 27-edge topology; the R4 fillet adds the analytic circular wedge and has the same clean topology plus exactly two radius-4 cap arcs. `Root_Concave_{Chamfer,Fillet}.png` show the full parts, while their `_Detail` counterparts show the single bevel face and smooth roll close-up. A full-face direct push changes the transient edge-table numbering: the geometric arm-tip edge previously reached as `e26` is now `e19`; it is the same left-hand vertical edge of the moved cap, with no hidden micro-rim in front of it.
