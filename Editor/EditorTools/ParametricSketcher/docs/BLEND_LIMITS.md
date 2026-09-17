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

### Exact plane–cylinder boss roots

Phase 31 adds the first bounded smooth-support route that does not depend on a native primitive cap. The classifier finds
a rational circular edge shared by a planar annular shoulder and cylindrical boss, confirms the complete five-face
stepped topology, and derives the common axis, shoulder plane, inner/outer radii, and support extents from geometry and
adjacency rather than face order.

For fillet radius `r`, the offset plane and offset boss cylinder intersect on a circular spine of radius `Rb + r`, one
radius above the shoulder. Revolving an exact rational quadratic quarter-circle about that spine produces the retained
partial torus. Its lower contact circle is at radius `Rb + r` in the shoulder plane; its upper contact circle is at
radius `Rb` and height `shoulder + r`. Both joins are G1. The operation directly sews the retained outer cylinder,
trimmed annulus, quarter-torus, shortened boss cylinder, and two caps into a `V5/E9/C18/L6/F6` solid. The concave
roll adds the analytic volume
`ΔV = 2πr²[Rb(1 − π/4) + r(5/6 − π/4)]`; verification requires the tessellated solid volume to follow that value.

The supported radius interval is strictly `0 < r < min(boss height, outer radius − boss radius)`. A radius at either
upper bound consumes a support and refuses. Phase 32a also accepts a complete boss-root ring split into two or four
rational arc edges by angular representation seams. `TangentChain` follows only unambiguous G1 edge continuations; the
classifier then requires a closed `2π` ring and matching shoulder, boss, and outer-wall patch sets before it heals all
seams into the canonical exact result. Selecting either member of a two-edge chain or any member of a four-edge chain
therefore produces the same solid.

Phase 32b admits a half-turn of the stepped solid bounded by one planar diameter face. The root chain spans `π` with two
endpoints and matching bottom/top sector patches. Its internal two/four-member representation seams heal to one partial
torus, while two exact quarter-circle meridians terminate the roll on the retained diameter cap. The result is one hull
of genus zero with `V12/E17/C34/L7/F7`; its volume is one half of the corresponding full-ring result.

Phase 32d extends only this rotational-sector topology. A general open chain's signed arc span is derived by walking its
members in endpoint order, and the outer circular chain must have the same magnitude. Two distinct radial cap planes
must contain the corresponding start/end rays and meet on one axis edge. Reconstruction closes those radial paths
explicitly and returns a seam-healed `V12/E18/C36/L8/F8` result. Positive/negative quarter turns, 120° and reflex 270°
spans, and oblique axes are verified. The result volume is the absolute angular fraction of the full-ring analytic value.
This does not cover unequal, mitred, free-form, or otherwise non-radial endpoint supports.

### Intentional multi-edge sets

Phase 32c introduces `FilletEdges` as a transactional composition layer. Every source seed is validated and expanded to
its tangent chain before construction. Repeated indices and multiple selected members of one chain collapse to one
target. Vertex-disjoint targets are sorted by orientation-free start/middle/end geometry, then geometrically re-resolved
after each earlier roll changes edge numbering. All results live in a working copy; one failed or ambiguous target
rejects the complete call. The original body is never mutated.

Chains sharing any source vertex refuse up front as an unsupported corner set. This is stricter than applying edges one
at a time on purpose: two adjacent rolling cylinders do not supply the three-face corner patch needed to close their
intersection. The console body form of `fillet --edges=i,j,…` now uses the same all-or-nothing route and reports the
number of distinct chains committed. The verified independent case is two opposite straight box edges at one common
radius, producing `V12/E18/C36/L8/F8`; this does not imply support for general blend/blend intersections.

The outer shoulder rim, incomplete/non-circular chains, asymmetric or non-radial endpoints, cylinder–cylinder contacts,
arbitrary trimmed/free-form surfaces, branching chains, thin-wall interactions, holes, unequal/non-orthogonal or two-edge corner patches, and
general blend/blend intersections remain unsupported; they refuse rather than entering the straight-planar approximation. The
six direct verifiers measure exact torus identity/residual/span, both G1 contacts, support extents,
closed/diameter/radial-sector/multi-edge topology, endpoint meridians and caps, analytic volume direction/value,
transformed axes, chain propagation/healing/deduplication, transactional refusal bounds, and console commit/rollback.

### Orthogonal three-face corner patch

Phase 32e supports exactly three equal-radius edges incident to one vertex of a structurally verified rectangular solid. The direct reconstruction retains six planar supports, adds three radius-`r` cylinders along the selected edges, and joins them with a rational spherical octant centred one radius along each local box axis. The output is a `V13/E21/C42/L10/F10` one-hull solid. Two-edge requests and unequal or non-orthogonal corners still refuse; this route is not a general blend/blend intersection solver.

### Re-entrant handle roots

The rendered cases are reproducible with `Scripts/Phase21_Blends.arc`, including the re-entrant **210° material-angle** handle root (`e1`) requested for the spanner. The normal-based dihedral is the smaller 150° void angle, so a reflex root must not use the convex Boolean cutter.

For a straight, end-capped prism, the solver traces the complete cap perimeter (including the pieces created by `PushFace`), identifies the reflex turn from the loop orientation, and rebuilds that perimeter through the selected edge. A chamfer replaces the root vertex with one line segment and correctly **adds** its triangular void wedge. A fillet uses an exact rational circular arc with tangent distance `R / tan(void-angle / 2)`, extrudes the arc as its own cylindrical face, and caps the two circular end arcs. Other geometry remains on the existing blend path.

`BlendVerification` checks more than solidity here: the R4 chamfer adds exactly the analytic 210° wedge and has the expected 11-face / 27-edge topology; the R4 fillet adds the analytic circular wedge and has the same clean topology plus exactly two radius-4 cap arcs. `Root_Concave_{Chamfer,Fillet}.png` show the full parts, while their `_Detail` counterparts show the single bevel face and smooth roll close-up. A full-face direct push changes the transient edge-table numbering: the geometric arm-tip edge previously reached as `e26` is now `e19`; it is the same left-hand vertical edge of the moved cap, with no hidden micro-rim in front of it.
