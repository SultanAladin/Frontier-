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

### Phase 25: blend foundation — topology and eligibility

Extend edge classification beyond the current planar/straight case:

- classify convex, reflex, tangent, and degenerate material angles from oriented adjacent faces;
- obtain stable edge-on-face parameter traces and tangent directions;
- define a per-edge radius feasibility bound and structured refusal diagnostics;
- preserve source-face provenance and a stable edge-selection key across a single feature rebuild.

**Exit gate:** no geometry is changed yet; every selected edge receives a correct classification and either a supported
blend plan or a precise refusal. The corrected 210° handle root remains a mandatory regression.

### Phase 26: constant-radius curved-support fillets

Implement one bounded generalization first: constant-radius rolling-ball fillets across one selected smooth edge between
two supported surfaces. The construction should intersect the two offset supports to form a spine, create rational
quadratic cross-sections, trim the support faces with the contact curves, sew, orient, and validate the resulting body.

This follows established blend research: constant-radius blends are produced by offsetting the two support surfaces,
finding their intersection/spine, and sweeping rational quadratic sections; corner blends are a separate problem.
[Constant-radius blending in surface modelling](https://www.sciencedirect.com/science/article/abs/pii/0010448589900468)

**Exit gate:** plane–cylinder, cylinder–cylinder, and selected NURBS-support examples must retain valid B-rep topology,
contact/tangency within tolerance, expected volume direction, and produce close-up proof renders. Unsupported corner
cases must refuse cleanly.

### Phase 27: blend chains and corners

Add tangent-chain propagation, then multi-edge/corner resolution as separate subfeatures. Do not market this phase as
complete until chain endpoints, three-face corners, holes, thin walls, and blend/blend intersections have their own
topology and visual regressions.

### Phase 28: variable radius, setbacks, partial edges, and G2

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
