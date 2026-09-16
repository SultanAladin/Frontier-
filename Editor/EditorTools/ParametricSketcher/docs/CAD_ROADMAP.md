# SolidArc capability roadmap — one validated capability at a time

This plan turns the current NURBS/B-rep prototype into a capable CAD application without pretending that a closed body
or a rendered PNG proves an operation is production-ready. A phase is only complete when it has exact/analytic checks
where applicable, adversarial regressions, refusal behaviour for unsupported cases, and a reproducible visual proof.

## Completed first increment — Phase 22: native `.arc` documents

Implemented in this change:

- versioned, human-reviewable native construction documents (`save`, `save <path>`, `open`);
- extension enforcement and automatic `.arc` suffixing;
- same-directory temporary write, replacement backup (`.arc.bak`), and rename-on-success;
- transactional open: replay into a clean host, adopt only on a zero-refusal result;
- persistence of construction operations rather than display triangles, retaining the editable NURBS/B-rep and the
  existing live recipe/dimension/constraint systems;
- round-trip and deliberately-invalid-document regression coverage.

The architecture follows the important distinction between native procedural data and neutral B-rep exchange: the NIST
work on ISO 10303 explains why a parametric model needs construction history, parameters, constraints, and a secondary
B-rep validation representation rather than only its final boundary shape. [NISTIR 7433](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=822720)

## Completed increment — Phase 23: adversarial 2D profile geometry

Implemented and verified in this change:

- `ProfileAdversarialVerification`, a 41-check kernel-facing regression suite, covers coincident portions, shared
  boundaries, exact tangency plus a ±0.0001 near-tangent separation, both closed interpolated and single-span cubic
  self-crossings, free-form spline/ellipse offsets, curvature-cusp refusal, and overlapping free-form Boolean results;
- `Scripts/Phase23_AdversarialProfiles.arc` and its committed 2560 × 1600 contact sheet reproduce the visual cases;
- `SelfIntersections` now detects a non-rational cubic Bézier loop that lies wholly inside one span, in addition to
  cross-span intersections;
- `Offset` rejects a self-intersecting source, detects sampled normal-offset curvature cusps before interpolation, and
  rejects a self-intersecting candidate result instead of returning a folded curve;
- the rational-quadratic exact-offset path now verifies that a span is circular. Ellipses therefore follow the
  distance-controlled free-form path rather than being replaced by osculating circular arcs. The covered ellipse case
  remains within 0.001 mm of its requested 0.2 mm normal distance.

The contact semantics are intentional. A coincident curve portion is a continuum, so the point-only `CurveCrossing` API
emits no fabricated isolated crossing for it; Boolean classification still handles coincident profiles and shared edges.
An external circle tangency emits one tangent contact, but its intersection profile is empty (zero area) and its union
keeps two simple touching components rather than constructing one self-touching loop.

Research informs the acceptance boundary rather than replacing validation: offset self-intersections are both local
(curvature) and global (distant portions collide), so sampling alone is not an adequate acceptance criterion. The
distance-map/trimming work by Seong, Elber, and Kim describes detecting and trimming both classes through
parameter-space zero sets and numeric marching. [Computer-Aided Design article](https://www.sciencedirect.com/science/article/abs/pii/S0010448505001491)

**Exit gate met:** every covered construction either meets its declared tolerance or refuses with a specific reason; the
suite also verifies that no accepted result loop self-intersects. This is a targeted planar-curve safety boundary, not a
claim of general offset-loop trimming or an interval-overlap contact API.

## Subsequent increments — 2D fixes, then general 3D blends

### Completed Phase 24: B-rep Boolean contact healing for axis-aligned boxes

The Phase 23 contact policy exposed the analogous 3D failure mode: a generic surface-intersection marcher has no unique
section curve for face-on-face coincidence or a zero-volume point/edge contact. It must not invent one or sew touching
solids into a non-manifold edge. This increment adds a narrow, structural constructive resolver before the general SSI
path when **both** operands prove to be natural six-plane, eight-corner axis-aligned boxes:

- face-touching and rectangularly overlapping boxes are rebuilt as one exact box;
- identical and contained boxes select the mathematically surviving box for union/common;
- a one-sided box slice is rebuilt exactly for subtraction;
- point-touching, edge-touching, and separated boxes return independent B-rep hulls with no topology weld;
- zero-volume common and complete subtraction are explicit `DegenerateInput` empty-result refusals;
- cavities and L-shaped differences retain the existing trimmed-face SSI path rather than being approximated as boxes.

`BooleanContactVerification` has 31 checks for these cases, including a real 0.0001 overlap that must not be mistaken
for contact, and creates `Proofs/Phase24_BooleanContacts.png` directly from C++ console commands. No HTML or browser
implementation is part of this capability.

The scope mirrors robust-kernel practice: Open CASCADE exposes a separate fuzzy tolerance for close/coincident Boolean
classification and explicit topology handling, rather than assuming every contact has a transversal section curve.
[OCCT Boolean options](https://dev.opencascade.org/doc/refman/html/class_b_o_p_algo___options.html)

**Exit gate met:** the covered contact cases are closed, manifold, consistently wound B-reps or explicit empty results;
edge and point contacts preserve two valid hulls instead of a four-coedge non-manifold edge. General curved or
non-transversal contact remains deliberately refused pending a separately validated contact classifier.

### Completed Phase 24b: exact duplicate B-rep Boolean identity

An exact duplicate valid B-rep is another non-transversal case that does not need a surface-intersection curve. The
Boolean kernel now compares the complete B-rep representation exactly: vertices, NURBS edges and face surfaces,
knots/poles, coedge traces, loops, orientation, and topology indices. When both input
solids are exact copies, union and common retain one operand, while subtraction returns an explicit empty-result
refusal. The comparison intentionally has **no fuzzy tolerance**: near-coincident shapes are not silently merged and
remain in the bounded general contact path.

`BooleanIdentityVerification` has 26 C++ checks covering copied and independently rebuilt spheres, cylinders, tori,
and extrudes; an exact copy of a trimmed sphere-union result; a near-coincident refusal; and a distinct crossing pair
that still takes SSI. It generates `Proofs/Phase24b_BooleanIdentity.png` directly from C++ console commands, with no
HTML or browser code.

This is aligned with the robust-kernel distinction between full coincidence (which should not be split) and partial
or near coincidence (which needs interference classification). [OCCT Boolean Operations](https://occt3d.com/dev/doc/overview/html/specification__boolean_operations.html)

**Exit gate met:** exactly identical valid B-reps no longer enter the non-transversal marcher; topology-rich trimmed
copies are covered; nearby but distinct bodies are demonstrably not mistaken for identity. At this stage, geometric
equivalence across reparameterized or reordered B-reps remained outside the identity gate.

### Completed Phase 24c: affine-NURBS-equivalent Boolean identity

A native cylinder and the extrusion of the same full circle are geometrically identical, yet their side-face and seam
NURBS use different affine parameter intervals and a different analytic classification hint. The identity comparator now
normalizes only affine knot domains while requiring every homogeneous control point and every topology field to match
exactly. This lets construction-independent but parameter-affine-equivalent B-reps take the same zero-section Boolean
path. It does **not** use a spatial merge tolerance, reorder faces/edges, reverse parameter directions, or claim general
shape equivalence.

`BooleanEquivalenceVerification` has 17 C++ checks for cylinder versus circular extrusion in both operand orders, an
explicitly reparameterized circle, a 0.0001-radius near miss that must not pass, and an ordinary sphere/sphere SSI case.
It generates `Proofs/Phase24c_BooleanEquivalence.png` directly from C++ console commands; no HTML or browser work is
included.

**Exit gate met:** full coincident geometry generated through two construction paths is returned as one valid solid or
an explicit empty subtraction; a geometric near miss remains outside the identity gate. Reversed/reordered topology and
partial coincidence remain future correspondence/contact-classification work.

### Completed Phase 24d: seam-invariant full right-cylinder Boolean identity

A periodic circular seam is a parameterization/topology choice, not a material intersection. Two equal cylinders can
therefore have different seam vertices, different full-circle start angles, or opposite construction directions even
after affine knot normalization; the generic SSI marcher then sees coincident faces and correctly declines to fabricate
a section. This increment recognizes only validated closed right cylinders with two classified full-circle caps, one
classified straight seam, two planar caps, and one cylinder/circular-extrusion side. It derives and canonically signs
the physical axis, base, radius, and height, then applies the identity Boolean result only when those values agree at
kernel-scale numerical noise.

`BooleanCylinderSeamVerification` has 18 C++ checks covering a native cylinder versus a 60° seam-shifted circular
extrusion, top-down construction, two independent seam positions, radius/height near misses, and a perpendicular
crossing-cylinder SSI control. It generates `Proofs/Phase24d_BooleanCylinderSeams.png` from C++ console commands; no
HTML or browser work is included.

Periodic parameterization is an explicit Boolean limitation in mature-kernel documentation, and their algorithms reuse
existing topology rather than manufacture duplicate section curves at coincident entities.
[OCCT Boolean parameterization limits](https://dev.opencascade.org/doc/overview/html/specification__boolean_operations.html)

**Exit gate met:** fully coincident, seam-relocated right cylinders produce exactly one valid operand for union/common
or an explicit empty subtraction; any physical radius/height change remains outside the gate. Cones, partial cylinders,
and non-circular periodic NURBS remain on the regular contact/SSI path.

### Completed Phase 25: exact circular right-cylinder cap chamfer

A complete circular cap rim of the native right-cylinder B-rep is a curved edge, so the planar prism-cutter path is
incorrect for it. `BlendSolver::ChamferEdge` now has a deliberately structural route for that one topology: two planar
caps, one classified cylinder side, two rational quadratic circular rims, one straight seam, and `V2/E3/C6/L3/F3` before
the operation. It keeps the cylinder over `H−s`, attaches an exact rational conical frustum over `s`, and sews the two
surfaces and their planar caps. This gives an exact radial-and-axial set-back and a valid `V3/E5/F4` result without a
Boolean cut or faceting. The route works on either cap and arbitrary non-unit construction axes; set-backs that reach
the axis or consume the height refuse.

`CylinderChamferVerification` supplies 19 C++ checks: top/bottom, an oblique axis, validity/topology, an exact sampled
cone generatrix, explicit circular-extrusion scope refusal, feasibility refusals, and the console command. It generates
`Proofs/Phase25_CylinderChamfers.png` directly from C++ commands with no HTML/browser component.

**Exit gate met:** the supported circular cap has exact conic geometry rather than an approximate cutter result. This is
not general curved-edge blending: circular-extrusion topology, partial cylinders, cones, and arbitrary NURBS edges still
refuse until independently implemented and verified.

### Completed Phase 26: exact circular right-cylinder cap rolling-ball fillet

A circular cap rim of the same tightly verified native-cylinder topology now has a constant-radius rolling-ball solution.
`BlendSolver::FilletEdge` creates the meridian as an exact rational quarter circle and revolves it around the cylinder
axis. The resulting surface is recorded as the appropriate **partial torus** (`Rmajor = R−r`, `Rminor = r`), then sewn
to the retained cylinder and planar caps; it is a closed `V3/E5/F4` B-rep. Its two endpoints are respectively tangent
to the cylinder and cap, so the feature has measured G1 joins instead of merely a rounded-looking tessellation. It works
at either cap, with a non-unit or reversed construction direction; a radius reaching the axis or full height is refused.

`CylinderFilletVerification` has 22 C++ checks for exact torus samples, G1 normals at both joins, topology/solidity,
top/bottom, oblique/reversed construction, explicit circular-extrusion rejection, feasibility bounds, the analytic
volume observation, and console integration. It generates `Proofs/Phase26_CylinderFillets.png` directly from C++ commands
(no HTML or browser implementation).

The bounded feature follows established CAD fillet semantics: production kernels attach a constant radius to a selected
edge/contour and track its continuity to support faces.
[OCCT constant-radius fillet API](https://dev.opencascade.org/doc/refman/html/class_b_rep_fillet_a_p_i___make_fillet.html)

**Exit gate met:** a supported circular rim has a true rational quarter-torus and measured G1 joins. Partial rims,
circular-extrusion topology, cones, plane–cylinder/cylinder–cylinder intersections, and arbitrary NURBS supports still
refuse rather than being treated as this primitive case.

### Phase 27: constant-radius general smooth-support fillets

Implement the next bounded generalization across one selected smooth edge between two supported surfaces. The
construction should offset both supports to form a spine, create rational quadratic cross-sections, trim the support
faces with the contact curves, sew, orient, and validate the result. Start with one plane–cylinder example before
considering cylinder–cylinder or NURBS supports.

This follows established blend research: constant-radius blends are produced by offsetting the two support surfaces,
finding their intersection/spine, and sweeping rational quadratic sections; corner blends are a separate problem.
[Constant-radius blending in surface modelling](https://www.sciencedirect.com/science/article/abs/pii/0010448589900468)

**Exit gate:** one plane–cylinder case must retain valid B-rep topology, contact/tangency within tolerance, expected
volume direction, and a close-up C++ proof render. Unsupported support pairs must refuse cleanly.

### Phase 28: blend chains and corners

Add tangent-chain propagation, then multi-edge/corner resolution as separate subfeatures. Do not market this phase as
complete until chain endpoints, three-face corners, holes, thin walls, and blend/blend intersections have their own
topology and visual regressions.

### Phase 29: variable radius, setbacks, partial edges, and G2

Variable-radius blends need a radius law along the spine, feasibility detection, and a non-linear solve. G2 continuity
requires its own surface construction and curvature acceptance measurements. These are not small extensions of the
current constant-radius planar implementation.

## Later direct modelling and platform work

After the 2D and blend foundations are reliable, implement and validate these as isolated features:

1. robust coincident/tangent Boolean classification, healing, sliver removal, and face merge;
2. general shell/thicken, face offset, draft, move/delete/replace face, extend/trim;
3. holes, threads, ribs, bosses, patterns, and stable ordered feature history;
4. STEP/DXF/STL/3MF/OBJ exchange and controlled tessellation;
5. assemblies, mates, BOM, mass properties, drawing extraction, and manufacturing workflows;
6. a production interactive UI and GPU viewport.

Neutral formats are required for exchange but do not replace the native `.arc` source of truth: final-shape STEP B-rep
transfer commonly loses feature-tree and sketch-constraint behaviour. [NIST procedural-model exchange discussion](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=904157)

## Working policy

- Implement one bounded capability per change.
- Start each capability by adding failure-oriented test geometry.
- Use analytic quantities when available; otherwise declare numerical tolerance and measure it.
- Treat a closed/manifold body as necessary but not sufficient: inspect close visual proofs at the actual requested edge.
- Keep unsupported domains explicit and refused rather than returning plausible but broken geometry.
