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
| chamfers within 3 μm³ of the closed form | **22 / 24** |
| worst chamfer error | **3.2353 mm³ (0.021%)** |

This replaces the previous **25 / 30** sweep, its five artificial seam refusals, and its 1% fallback bound. The test now requires all 24 physical corners to chamfer and fillet, no broken body, at least 22 kernel-precise chamfers, and a maximum error below 0.025% of the body. These are executable regression conditions, not image comparisons.

The remaining 3.2353 mm³ maximum is limited to the two 120-degree shoulders at the root of the pushed arm, where the local cutter is bounded by three non-parallel planes. It is no longer a seam failure or an invalid body; the bounded Boolean returns the closest valid local placement. It is called out explicitly by the test rather than being hidden by the old 1% allowance.

## Cutter precision

A bounded cutter needs end caps. A cap placed exactly at an edge end is a non-transversal intersection; placing it well past the end can trim a neighbouring face. `ChamferEdge` therefore evaluates a deterministic ladder of **100** cutter placements: five lateral half-widths and twenty positive/negative along-edge margins. The first closed body that meets the `1e-12` relative closed-form acceptance is returned; otherwise it preserves the closest closed result.

The ladder now includes micro-margins from `1e-8` through `1e-3` in both directions. This lets the Boolean clear a seam without paying the old 0.018 mm³ minimum over-cut from its coarser first step. The direct face push removes the one topology in which no local cutter could be valid at all.

## Fillets

`FilletEdge` first makes the tangent-set-back flat and then replaces that face with the rolling cylindrical surface. It evaluates both the original cap edges and square-end circular cap sections, retaining the valid closed body closer to the analytic removal. A candidate that leaves less material than the flat it replaces is rejected: a convex roll must add material back relative to its tangent chamfer.

The same two tip-edge operations shown in the console are reproducible with `Scripts/Phase21_Blends.arc`. A full-face direct push changes the transient edge-table numbering: the geometric arm-tip edge previously reached as `e26` is now `e19`; it is the same left-hand vertical edge of the moved cap, with no hidden micro-rim in front of it.
