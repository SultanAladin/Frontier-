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

## Next increment — Phase 23: 2D adversarial geometry regression suite

Before changing the 2D algorithms, build explicit, reproducible cases and measure results. The suite will cover:

1. overlapping and coincident line/arc/NURBS portions;
2. tangent and near-tangent curve intersections at progressively smaller offsets;
3. self-intersecting splines and nested loops;
4. offset cusps, local curvature-radius violations, global offset loops, and nested offsets;
5. Boolean union/subtract/intersect combinations containing those cases;
6. invariant checks: valid NURBS, no zero-length segments, clean loop orientation/nesting, expected area, and no
   unannounced topology changes.

Research informs the approach rather than replacing validation: offset self-intersections are both local (curvature) and
global (distant portions collide), so sampling alone is not an adequate acceptance criterion. The distance-map/trimming
work by Seong, Elber, and Kim describes detecting and trimming both classes through parameter-space zero sets and
numeric marching. [Computer-Aided Design article](https://www.sciencedirect.com/science/article/abs/pii/S0010448505001491)

**Exit gate:** every constructed case is either exact within its declared tolerance or rejected with a specific reason;
no case may return malformed profile topology.

## Subsequent increments — 2D fixes, then general 3D blends

### Phase 24: repair the verified 2D failures

Use the Phase 23 measurements to make targeted changes to `ProfileSolver` and curve offsetting. Preserve exact lines and
conics where possible; approximate arbitrary NURBS offsets under an explicit, tested deviation bound; split/trim loops
only after classifying the topology. This is deliberately separated from test creation so that each algorithmic change
has a known failing example and a measurable result.

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
