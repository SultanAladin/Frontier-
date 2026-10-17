# Geometry repair progress — batch 1

**2026-10-17. Repairs have now started at the user's request.** The earlier broad
and constructed-solid reports remain historical baselines, not post-fix claims.

## Cone implementation confirmed

C++ already implements cones and frustums:

- `Kernel/SurfaceSpecification.cpp`, `NurbsSurface::Cone`: exact rational NURBS
  revolution of a straight generator, retaining cone classification and radii.
- `Kernel/TopologySpecification.cpp`, `BrepBody::Cone`: constructs the surface,
  then uses generic sewing, capping and orientation to create the solid.
- `Console/ConsoleHost.cpp`, `cone` command: native solid or sheet construction.
- `Kernel/FaceEditSolver.cpp` and `Kernel/BlendSolver.cpp`: existing cone editing
  and blending paths. Their existence does not certify all cone Boolean/blend cases.

The cone/box failure was **not missing cone code**.

## Generic native fixes

`Kernel/IntersectionSolver.cpp`:

1. Intersection exits exactly coinciding with an existing face-domain sample now
   share the graph identity of the cut endpoint. Previously a quarter-circle cap
   sample could leave the cut graph disconnected. Identity still includes the
   coedge, so opposite periodic chart seams are not welded together.
2. Span grouping no longer crosses a closed coedge's end/start parameter jump.
   Otherwise `min/max` trimming could replace a wrapped circular arc with its
   complementary arc. Actual seam vertices remain explicit.
3. Before accepting a general SSI assembly, every traced transversal cut must be
   represented by an edge shared by two distinct result faces. Closed/manifold
   topology alone cannot detect a silently omitted component.
4. Final solid/finite-positive-volume validation is enforced in the kernel itself,
   not only at the console boundary. Verbose mode includes invalid-assembly counts.

No operand nudges, primitive substitution, validator weakening, or relaxed kernel
merge/trim tolerances were used. An experimental trimmed-lattice change did not
resolve the periodic ambiguity and was reverted; it is not part of this batch.

## Results

### GEO-003: original cone/box fixture repaired

All four previously refused cases now accept: union, intersection, A−B and B−A.
All pass topology, undo/redo, save/reopen and independent intended-geometry checks.

| Operation | Native volume estimate | Independent reference volume | Absolute residual |
|---|---:|---:|---:|
| Union | 8.978525 | 8.97988522513 | 0.00136022513 |
| Intersection | 1.657665 | 1.65823381694 | 0.00056881694 |
| Cone − box | 3.368525 | 3.36988522513 | 0.00136022513 |
| Box − cone | 3.952300 | 3.95176618306 | 0.00053381694 |

Reference volumes numerically integrate analytic disk/rectangle sections with
32,768 Simpson intervals, independently of returned meshes. Each result receives
16,384 deterministic analytic membership probes; all four had **zero non-boundary
mismatches and zero two-ray disagreements**. Boundary exclusion is 0.1% of the
combined diagonal; declared curved occupancy allowance is 0.5%, volume allowance
1%. These are finite numerical checks, not arbitrary-cone certification.

### GEO-001: incorrect torus union acceptance prevented; union still unsupported

The earlier torus/box union returned only a closed box, losing torus material.
It now refuses atomically with an intersection-boundary diagnostic. This is a
**safety mitigation**, not a completed correct union implementation.

### Periodic outputs remain uncertified

Three previously refused torus/box operations now engine-accept, but the stricter
16,384-probe analytic audits remain inconclusive:

| Operation | Two-ray disagreements / 16,384 | Non-boundary agreed-ray mismatches |
|---|---:|---:|
| Intersection | 550 | 0 |
| Torus − box | 1,187 | 0 |
| Box − torus | 559 | 0 |

The 3% ambiguity limit was **not** relaxed. Native half-torus quadrature is
1.905057 versus analytic 1.89496404501 (~0.53%); the volume allowance alone does
not certify spatial correctness. Investigate periodic face trimming/tessellation
and mesh closure before claiming these repaired (GEO-013).

## Regressions and input proofs

- New `Verification/BooleanBoundaryKnotVerification.cpp`: **92/92 checks pass**.
  Six ordered cone operations at scales 1, 0.1 and 2 (small/large cases translated),
  topology, material-side witnesses, volume identities and periodic safety.
  Linked against the saved pre-fix solver, the same regression exposed **59 failed
  checks**. Curved `Validate().Volume` remains approximate: operand-reversal
  volume residuals are recorded rather than mistaken for exact equality.
- Six related C++ verification executables: **167/167 checks pass** across
  Intersection, BooleanCylinderSeam, BooleanIdentity, BooleanEquivalence,
  BooleanContact and BodyOps suites. This is not the full bevel/entire-repository
  test suite. Two stale assertions expecting six marched sections for boxes
  already handled by the exact axis-box route failed against both old and new
  kernels; corrected to expect zero fictitious sections. Exact volume, area and
  topology assertions are retained.
- **64-case Boolean-only rerun:** 56 accepted, 8 refused. All 49 previously spatial-
  passing accepted cases remain accepted. Seven newly accepted cases: four cones
  plus the three uncertified periodic observations. One new safe refusal replaces
  the known wrong torus union. The older broad bevel sweep was not rerun.
- **24 complex-pair rerun:** unchanged 78 finals executed, 27 accepted, 51 safely
  refused; 11 construction blockers prevent 66 further finals. All 127 intermediate
  bodies, 26 completed source bodies and 27 accepted finals retain independent
  audit passes. No timeouts or transaction failures. GEO-010/011/012 remain open.
- **Actual mouse-input checks:** four cone Outliner/Shift/operation/Apply/undo/redo
  transactions plus one disabled torus-union guard pass in both native ImGui and
  HTML. The guard has no popup and no Apply. Native color is CPU reference; HTML
  and nine separate native-packet replays use real software WebGL2/ANGLE, with
  zero CPU RGBA uploads. These are not physical-GPU measurements.

## Evidence and reproduce

Portable report: `Exhibits/Gallery/Editor/SolidArcBooleanRepairProof.html`.
Live report: `/gpu/proofs/repairs.html` (39 recorded images).
Compact observations: `Fixtures/BooleanRepairBaseline.json`.
Native host SHA-256: `220aa5b55d73e9efe4795805d976f79f476dd1c726504bf29dcfea4e7ca5ba1c`.

```sh
python3 Tools/Build/VerifySolidArcBooleanKernel.py
python3 Tools/Build/ProbeSolidArcBooleanRepairs.py
SOLIDARC_BROAD_OUT=_AgentScratch/tmp/GeometryRepairs/Broad \
  node Tools/Build/AuditSolidArcBroadGeometrySpatial.mjs
node Tools/Build/AuditSolidArcBooleanRepairs.mjs
SOLIDARC_COMPLEX_OUT=_AgentScratch/tmp/GeometryRepairs/Complex \
  python3 Tools/Build/ProbeSolidArcComplexGeometry.py --workers 4 --timeout 45
SOLIDARC_COMPLEX_OUT=_AgentScratch/tmp/GeometryRepairs/Complex \
  node Tools/Build/AuditSolidArcComplexGeometry.mjs
python3 Tools/Build/PrepareSolidArcBooleanRepairCaptures.py
python3 Tools/Build/RunSolidArcEditorProof.py --build-only
SOLIDARC_OCCT_BLEND_HOST="$PWD/.cache/solidarc-occt/BlendHost" \
  .cache/solidarc-editor/SolidArcEditorProof --complex-geometry-captures \
  _AgentScratch/tmp/GeometryRepairs/UI/capture-plan.json
SOLIDARC_COMPLEX_OUT=_AgentScratch/tmp/GeometryRepairs/UI \
  node Tools/Build/CaptureSolidArcComplexGeometry.mjs
python3 Tools/Build/GenerateSolidArcBooleanRepairProof.py
node Tools/Build/VerifySolidArcBooleanRepairProof.mjs
```

Native verification sources are discovered by the existing CMake verification
glob. Chromium in this sandbox needs `/tmp/chromium` and
`LD_LIBRARY_PATH="$PWD/.cache/browser/libs/lib:${LD_LIBRARY_PATH:-}"`.

## Report verification

The repair report passed all **52 image/control states**, its eight case choices,
39 embedded images, both renderer modes, five actual-input views per UI, JSON
export and navigation from both preserved historical reports. Zero page errors.

## Live-session boundary

The 8081/8083 services and existing drawing were **not reset or restarted**.
Fresh isolated sessions use the newly compiled native executable. Existing
long-lived user document processes retain their loaded kernel; deploying there
requires a separately checkpointed upgrade (including documents/selection/view),
not silently killing or reopening the user's model. No existing-session upgrade
is claimed by this batch.
