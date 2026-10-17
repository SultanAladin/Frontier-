# Deferred geometry gaps — repair backlog

**Status: repairs started 2026-10-17 at the user’s request.**
The earlier tests remain historical baselines. See `GEOMETRY_REPAIR_PROGRESS.md`
for exact repaired scope, new safety guards and still-open issues.
Do not weaken validators or silently replace geometry to improve acceptance.

## Existing confirmed gaps

| ID | Gap / evidence | Reproduction | Acceptance for a future repair |
|---|---|---|---|
| GEO-001 | **Safety-mitigated, union still open.** Earlier accepted closed box omitted torus material (66/512 disagreements). New cut-conservation/kernel validation refuses atomically instead. Correct union output is not implemented by this batch. | `BroadGeometry.json`, `torus-box`, `union` | Preserve the complete set-theoretic union; pass independent spatial checks, topology, history and regression suites. A positive volume alone is insufficient. |
| GEO-002 | Box / tilted-cylinder Booleans refuse output validity checks. | `box-tilted-cylinder`, all four original operations | Valid Boolean output for supported non-degenerate cases, or a precise transactional refusal; test tilted and transformed variants. |
| GEO-003 | **Original fixture repaired.** C++ cones already existed; generic boundary-knot identity and closed-span seam fixes make all four original cone/box cases accept, with analytic audits and history tests. Not universal cone certification. | `cone-box`, all four operations | Correct trimming/classification and positive manifold output, with independent set-membership checks. |
| GEO-004 | **Still open.** Three torus/box operations now engine-accept but strict analytic mesh audits are inconclusive (see GEO-013); torus/cylinder limitations remain. | `torus-box` intersect/subtract; `torus-cylinder` union/intersect/A−B | Preserve periodic seams and holes; do not certify by topology alone. |
| GEO-005 | General curved-edge / non-planar blends and connected-corner resolution remain limited. | Individual native diagnostics in the broad report; source `BlendSolver.cpp` and optional bridge policy | General owning-B-rep blend path, correct trims and supported corner transitions; maintain explicit refusals and geometry/volume guards. |
| GEO-006 | Slow loft-derived blend: request exceeded 100 seconds in four-worker sweep. | `lofted-profiles-subtract-ab`, edge 17, fillet .025 | Bounded/cancellable computation, exact source preservation on cancellation, correctness and responsiveness tests. Timeout is not asserted to be a safe rollback. |
| GEO-007 | Reverse cylinder−sphere chamfer at .03 refuses native/worker volume agreement; .0375 fixture is accepted. | `CylinderSphereBevelMetrics.py` and `OCCT_BLEND.md` | Correct native trim reconstruction across a radius sweep; no tolerance relaxation solely to pass. |
| GEO-008 | Earlier sphere/box curved edge at .0589048619762 refuses ~54e-6 endpoint discrepancy against 20e-6 guard. | `OCCT_BLEND.md`, original sphere/box fixture | Correct endpoint correspondence, no silent radius substitution for explicit values. |
| GEO-009 | Acceptance differs under translated/scaled equivalent geometry; robustness not certified. | `sphere-cylinder` versus `translated-sphere-cylinder` | Equivalent set operations and consistent supported blend behavior across scales/locations, with scale-aware independent checks. |

## Constructed / concave findings (2026-10-17, deferred)

Exact zero-based steps, full commands and refusal reasons are preserved in
`COMPLEX_GEOMETRY_COVERAGE.md` and `Fixtures/ComplexGeometryBaseline.json`.

| ID | Gap / evidence | Reproduction | Acceptance for a future repair |
|---|---|---|---|
| GEO-010 | Eleven source-construction chains cannot complete; 66 final operations are therefore not run. Refusals include ordinary aligned/tangent/vertex-crossing assemblies, seams/singularities and edge/surface refinement. | `blind-pocket-dogbone` step 5; `c-frame-staircase` 7; `comb-staircase` 7; `concave-u-ruled` 8; `cross-drilled-t` 4; `hollow-cross-elbow` 6; `hollow-cup-star` 4; `ribbed-annular` 4; `slotted-flange-cone` 8; `terrace-double-window` 11; `window-dogbone` 5 | Build supported intended source CSG with correct spatial sets; validate each intermediate; retain atomic refusal for genuinely unsupported/degenerate cases. Do not just nudge fixtures to hide ordinary coincident geometry. |
| GEO-011 | Eight independently sampled-valid source pairs refuse all six final operations (48 refusals). Spans concave lofts, holes, pockets, disconnected pieces and coincident profiles. No incorrect accepted output is alleged for these refusals. | `concave-l-ruled`, `coplanar-t-c`, `disconnected-l-parts`, `four-hole-z`, `pocket-island-comb`, `split-intersection`, `star-hex-ring`, `twin-bore-fork`; all ordered union/intersection/subtraction cases | Correct intended set output for supported cases, including multi-loop/multi-hull topology, with independent membership/volume checks. Retain precise transactional diagnostics for remaining limitations. |
| GEO-012 | Operand reversal changes union/intersection acceptance on translated/scaled concave solids. A∪B and A∩B accept; B∪A and B∩A refuse “marching did not close.” | `scaled-l-notch`, `union` vs `union-ba`, `intersect` vs `intersect-ba` | Commutative operations must agree spatially and have consistent support under reversal; scale/translation sweeps, strict source checks and history preservation. Do not loosen topology/trim guards to equalise acceptance. |
| GEO-013 | Newly accepted periodic torus/box outputs have excessive independent two-ray disagreement: 550/16,384 intersection, 1,187/16,384 torus−box, 559/16,384 box−torus. Agreed-ray samples have zero mismatches, but that is not sufficient certification. | `AuditSolidArcBooleanRepairs.mjs`; `Fixtures/BooleanRepairBaseline.json` | Establish correct periodic trim/tessellation and closed spatial output; pass the existing ambiguity threshold without weakening it, plus analytic membership/volume and transactional regressions. |

### Validation qualification retained for future work

The independent checks are finite, not an exact general-purpose CAD oracle.
Non-planar ruled loft native/analytic volume residuals are ~0.084% (L) and ~0.402%
(U), within the declared 1% curved quadrature tolerance. Preserve these values and
add refinement/convergence evidence later; they are **not** asserted to be exact
matches or confirmed geometry defects. The disabled twin-bore union UI guard is
working safely and is not itself a newly discovered UI defect.

## Interpretation rules

- The prior sweep: 64 final Boolean cases; 50 engine/topology accepted, 14 safely
  refused. Of accepted outputs, 49 passed the sampled mesh audit and one was
  demonstrably incorrect. These are not 50 certified correct Booleans.
- 135/388 completed candidate-edge bevel requests were engine-accepted, 253
  refused, plus one timed-out request. Candidates/radii were not all independently
  pre-certified valid; not every refusal is a proven solver bug.
- Mouse/Apply success establishes input/transaction behavior, not correctness of
  the source Boolean. The torus/box UI case demonstrates that distinction.
- A finite primitive or constructed-solid matrix cannot establish “any geometry.”
- Newly found constructed/concave failures must be appended with exact fixture,
  stage, operation and independent evidence. Preserve test manifests and compact
  result baselines in the repository; keep bulk captures outside Git.

## Evidence / architecture

- `BROAD_GEOMETRY_COVERAGE.md`: original 16-pair/64-case audit and provenance.
- `BLEND_ARCHITECTURE.md`: general kernel-integration work still required.
- `Fixtures/BroadGeometry.json`: exact original fixtures.
- Constructed-solid coverage and new evidence are recorded in
  `COMPLEX_GEOMETRY_COVERAGE.md` and its compact result baseline.
