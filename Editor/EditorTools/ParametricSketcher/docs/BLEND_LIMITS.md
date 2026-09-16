# Edge blends — what is exact, what is approximate, and one thing that does not work

`Kernel/BlendSolver.cpp`. Numbers are from `Verification/BlendVerification.cpp`, which asserts closed-form
volumes rather than comparing pictures.

## Exact

| operation | result | closed form | error |
|---|---|---|---|
| chamfer, box vertical edge, s=3 | 7910.00000 | 7910.00000 | 3.6e-12 |
| chamfer, pushed arm tip, s=4 | 15512.25514 | 15512.25514 | 1.1e-11 |
| fillet, box vertical edge, R=3 | 7961.32881 | 7961.37167 | 4.3e-02 (tessellation of the roll) |

A chamfer is a pure boolean against an exactly-built wedge, so it is exact to round-off. A fillet on an edge
whose ends are **square to the edge** is exact once its cap edges are rebuilt as circular sections of the roll
cylinder.

## Approximate, with the reason

**`push`** pulls the tool outline inward by ~1e-6 of the body before sweeping it. A tool flush with the face is
the coincident-face case `IntersectionSolver::Combine` refuses outright ("surface singularity or seam corner"),
because the two boundaries meet along a whole face instead of crossing. The inset buys transversality and costs
a relative volume deficit of the same order: 15592.25475 against an ideal 15592.30485.

**`fillet` on an edge with MITRED ends** — the top edge of a prism, whose ends are cut by the neighbouring side
walls rather than square to the edge — under-fills by **0.419%** (pentagon prism, R=3: 11319.62 against an ideal
11367.27). The roll surface itself is right (face area 110.7855 against an ideal 110.7949); the shortfall is that
each mitred end is closed by the straight chord the cut produced instead of the true section. The result is still
a valid closed manifold solid, and `BlendVerification` fails if this regresses past 1%.

## Rejected: interpolating the true ellipse section

The obvious fix is that cylinder ∩ mitre-plane is an **ellipse**, so sample that locus and interpolate a degree-3
curve through it instead of forcing `ArcThreePoints` (a circle) through the same endpoints. The sampling is
correct — the waist points solve to 1e-15 on both the cylinder and the plane, and the rebuilt edge has the right
length (4.83441 against a 4.35318 chord).

It makes the volume **worse: 2.63%**, up from 0.419%.

The reason is that the edge curve is only half the story. The roll face is `NurbsSurface::Extrusion(arc, Tangent,
F.Length)` — a cylinder whose parameter domain is sized to the edge. A mitred end runs *past* the edge's own
endpoints, so bending the boundary curve outward moves the trimming loop outside the domain it is evaluated in,
and `TessellateFace` clamps it. The boundary and the surface then disagree, and the enclosed volume drifts further
than the chord approximation it replaced.

Doing this properly means re-seating the roll as a surface whose domain is derived from the flat's actual extent
along the axis, and re-deriving every (u,v) trim against that new domain — not a boundary-curve substitution.
Until then the chord approximation is the better of the two, and it is bounded by a test.

Worth noting: `FilletEdge` builds both the plain and the cap-rebuilt candidate and keeps whichever scores closer
to the closed form, so this class of mistake degrades to "no improvement" rather than to a wrong part.
