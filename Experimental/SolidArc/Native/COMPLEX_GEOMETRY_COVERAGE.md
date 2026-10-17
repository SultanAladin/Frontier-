# Constructed / concave Boolean coverage

**2026-10-17 — testing only; deferred kernel gaps are not repaired.**

The prior 64-case primitive/mixed sweep remains in `BROAD_GEOMETRY_COVERAGE.md`.
This addition tests engineered source construction and Boolean-of-Boolean shapes,
not a few more sphere pairings. See `GEOMETRY_GAPS.md` for the repair backlog.

## Actual scope and denominators

- 24 pairings × 6 ordered operations = 144 planned final tests.
- 196 source-construction commands attempted; 127 accepted body stages.
- 13 completed source pairs; 11 source construction refusals.
- **78 final operations executed: 27 accepted, 51 safely refused.**
- **66 planned finals were not run** because their operands could not be built.
- Zero sweep timeouts and zero transaction assertion failures.
- All 51 final refusals and 11 construction refusals preserve the native figure
  state and draw geometry. All 27 accepted finals pass undo/redo; all 13 completed
  source pairs pass save/reopen. No failure was converted to a success.

The six operations are A∪B, B∪A, A∩B, B∩A, A−B and B−A. Exact recipes, intended
CSG/reference ASTs and construction step indices are in `Fixtures/ComplexGeometry.json`.
The compact observed outcomes/diagnostics are in `Fixtures/ComplexGeometryBaseline.json`.
This baseline records current limitations; future repairs should improve it, not
be required to preserve these refusals.

## Pairing matrix

| Fixture | Geometry coverage | Construction | Accepted / executed finals |
|---|---|---|---|
| `blind-pocket-dogbone` | blind-pocket, curved-planar | Blocked at zero-based step 5 | 0/0 — six not run |
| `c-frame-staircase` | concave, multi-stage-union, coplanar | Blocked at zero-based step 7 | 0/0 — six not run |
| `comb-staircase` | many-reentrant-corners, multi-stage-union | Blocked at zero-based step 7 | 0/0 — six not run |
| `concave-l-notched` | concave, reentrant, both-constructed | Built | 6/6 |
| `concave-l-ruled` | concave-loft, non-axis-side-faces, both-constructed | Built | 0/6 |
| `concave-u-ruled` | concave-loft, multi-stage, non-planar-sides | Blocked at zero-based step 8 | 0/0 — six not run |
| `coplanar-t-c` | coplanar, reentrant, both-constructed | Built | 0/6 |
| `cross-drilled-t` | cross-bore, concave, internal-intersections | Blocked at zero-based step 4 | 0/0 — six not run |
| `disconnected-l-parts` | disconnected-source, multiple-hulls, concave | Built | 0/6 |
| `four-hole-z` | four-through-holes, concave, many-loops | Built | 0/6 |
| `hollow-cross-elbow` | hollow, crossing-tunnels, multi-stage | Blocked at zero-based step 6 | 0/0 — six not run |
| `hollow-cup-star` | hollow, curved-concave, multi-stage | Blocked at zero-based step 4 | 0/0 — six not run |
| `near-coincident-u` | near-coincident, thin-sliver, concave | Built | 6/6 |
| `pocket-island-comb` | blind-pocket, island, connected-floor, multi-stage | Built | 0/6 |
| `ribbed-annular` | ribs, through-hole, thin-walls | Blocked at zero-based step 4 | 0/0 — six not run |
| `scaled-l-notch` | metamorphic, small-scale, translated, concave | Built | 3/6 |
| `slotted-flange-cone` | slots, annular, conical, multi-stage | Blocked at zero-based step 8 | 0/0 — six not run |
| `split-intersection` | disconnected-result, concave, multiple-hulls | Built | 0/6 |
| `star-hex-ring` | concave, through-hole, many-faces | Built | 0/6 |
| `terrace-double-window` | multi-level, two-through-windows, both-constructed | Blocked at zero-based step 11 | 0/0 — six not run |
| `thin-u-comb` | thin-wall, reentrant, small-features | Built | 6/6 |
| `twin-bore-fork` | two-through-holes, concave | Built | 0/6 |
| `u-channel-l` | concave, rotation, both-constructed | Built | 6/6 |
| `window-dogbone` | through-hole, multi-stage-union, curved-planar | Blocked at zero-based step 5 | 0/0 — six not run |

## Exact preparation blockers (all source state preserved)

Step indices are zero-based and match the manifest and baseline. A partial build
is explicitly labelled as partial in the visual report, never as completed A/B.

| Fixture | Step | Command | Refusal diagnostic |
|---|---|---|---|
| `blind-pocket-dogbone` | 5 | `boolean union N5 -- N6 --name=N3` | boolean union: Unsupported — tangent or coincident faces (not transversal) |
| `c-frame-staircase` | 7 | `boolean union N6 -- N7 --name=N4` | boolean union: Unsupported — intersection passes exactly through a vertex (non-generic: nudge one body) |
| `comb-staircase` | 7 | `boolean union N6 -- N7 --name=N4` | boolean union: Unsupported — intersection passes exactly through a vertex (non-generic: nudge one body) |
| `concave-u-ruled` | 8 | `boolean union N7 -- N8 --name=N5` | boolean union: Unsupported — intersection passes exactly through a vertex (non-generic: nudge one body) |
| `cross-drilled-t` | 4 | `boolean subtract N1 -- N2 --name=A` | boolean subtract: Unsupported — coincident faces along the intersection (not transversal) |
| `hollow-cross-elbow` | 6 | `boolean union N1 -- N2 --name=A` | boolean union: Unsupported — tangent or coincident faces (not transversal) |
| `hollow-cup-star` | 4 | `boolean intersect N1 -- N2 --name=A` | boolean intersect: Unsupported — edge–surface refinement did not converge at a face boundary |
| `ribbed-annular` | 4 | `boolean union N5 -- N6 --name=N3` | boolean union: Unsupported — intersection runs into a surface singularity or seam corner (non-generic: nudge or rotate one body) |
| `slotted-flange-cone` | 8 | `boolean union N1 -- N2 --name=A` | boolean union: Unsupported — edge–surface refinement did not converge at a face boundary |
| `terrace-double-window` | 11 | `boolean subtract N7 -- N8 --name=B` | boolean subtract: Unsupported — intersection runs into a surface singularity or seam corner (non-generic: nudge or rotate one body) |
| `window-dogbone` | 5 | `boolean union N5 -- N6 --name=N3` | boolean union: Unsupported — tangent or coincident faces (not transversal) |

## Independent correctness checks, including construction

The reference is the intended geometry—not the kernel's returned source meshes.
`GeometryReferenceOracle.mjs` implements signed membership for analytic primitives,
polygonal profiles, ruled-section lofts, transforms and CSG operations. Reference
self-checks run before the audit. `GeometryMeshAudit.mjs` independently classifies
native triangles using BVH acceleration and two rays.

`AuditSolidArcComplexGeometry.mjs` checked:

- **127/127 intermediate bodies** passed configured finite checks.
- **26/26 completed source bodies** passed configured finite checks.
- **27/27 accepted Boolean results** passed configured finite checks.
- 180 audits; **770,233 probes** in total: 4,096 deterministic uniform probes per
  audit plus feature witnesses, exact orthogonal cell centres where applicable,
  and both sides of returned triangle surfaces. Repeated final/source-stage
  geometry is intentionally audited at both workflow checkpoints.
- Twelve accepted final results additionally have exact orthogonal CSG reference
  volumes. Other spatial passes are not automatically exact volume certifications.
- Polygonal checks permit zero non-boundary membership mismatches; curved and
  non-planar checks allow 0.5%. Two-ray disagreement and near-boundary exclusions
  are recorded explicitly in downloadable audit data.
- Available native/reference volume comparisons use max(5e−7, 1e−5 × reference
  volume) for polygonal geometry, 1% for curved/non-planar quadrature.

A finite sample audit cannot certify arbitrary geometry, exact trimming or every
small feature. Ruled concave lofts are non-planar: L native volume 13.981673 versus
analytic 13.9934637333 (~0.084% difference); U 18.09857 versus 18.1716069333 (~0.402%).
These residuals are retained, within the declared allowance, not reported as exact
matches or confirmed incorrect lofts. Refinement/convergence remains future work.

## New deferred findings

- Source construction itself blocks ordinary aligned/tangent/vertex-crossing
  assemblies, singular/seam intersections and edge/surface refinement. Eleven
  exact reproductions are above (GEO-010).
- Eight completed source families reject every final operation: `star-hex-ring`,
  `twin-bore-fork`, `four-hole-z`, `pocket-island-comb`, `concave-l-ruled`,
  `disconnected-l-parts`, `coplanar-t-c`, `split-intersection` (GEO-011). This spans
  concavity, multiple holes, pockets, non-planar lofts and multi-component cases.
- `scaled-l-notch`: A∪B and A∩B accept, their reversed operand orders refuse
  “marching did not close.” A−B accepts and B−A refuses too, but subtraction is not
  commutative. The two commutative acceptance discrepancies are GEO-012.
- No newly accepted incorrect result was found by these configured independent
  checks. This does not clear the earlier confirmed torus/box union defect.

## Visual and actual-input evidence

Portable report: `Exhibits/Gallery/Editor/SolidArcComplexGeometryProof.html`.
Live route: `/gpu/proofs/complex.html`; the existing `/proofs` broad report is
preserved and links to this expansion.

- 24 source/partial-source and 78 final-operation **actual native C++ ImGui**
  CPU-reference captures. These are not physical GPU raster evidence.
- 178 real WebGL2 native-packet replays: 24 source/partial-source states, 127
  isolated accepted intermediate bodies and 27 accepted final results. Cameras
  are fitted in JavaScript; the source geometry is native, not reconstructed in JS.
  Software ANGLE/SwiftShader, zero CPU RGBA frame uploads; not physical-GPU proof.
- Separately, **four actual mouse-input checks per UI** (native and HTML):
  `concave-l-notched-union`, `near-coincident-u-subtract-ab`, `thin-u-comb-intersect`
  exercise Outliner/Shift selection, operation, Apply, undo/redo; the fourth,
  `twin-bore-fork-union`, checks disabled operation, no popup and source preservation.
  There is **no Apply** for this guard; it is not counted as an accepted Boolean.
- 296 losslessly packed recorded images in the standalone report, with all
  results, construction steps, refusal diagnostics and downloadable audit JSON.

## Gallery verification

`VerifySolidArcComplexGeometryProof.mjs` passed **752 image/control states**, all
144 planned matrix cells, all 127 intermediate-body choices, both renderer modes,
actual-input views, five filters, JSON export and the link from the preserved
64-case broad report. Zero page errors. Filter counts: 11 construction-blocked,
5 with accepted finals, 8 completed-but-all-refused, 1 order-asymmetric, 24 total.

## Reproduce

```sh
python3 Tools/Build/BuildSolidArcComplexFixtures.py
python3 Tools/Build/ProbeSolidArcComplexGeometry.py --workers 4 --timeout 45
node Tools/Build/AuditSolidArcComplexGeometry.mjs
python3 Tools/Build/PrepareSolidArcComplexCaptures.py
python3 Tools/Build/RunSolidArcEditorProof.py --build-only
SOLIDARC_OCCT_BLEND_HOST="$PWD/.cache/solidarc-occt/BlendHost" \
  .cache/solidarc-editor/SolidArcEditorProof --complex-geometry-captures \
  _AgentScratch/tmp/ComplexGeometry/capture-plan.json
node Tools/Build/CaptureSolidArcComplexGeometry.mjs
python3 Tools/Build/GenerateSolidArcComplexGeometryProof.py
node Tools/Build/VerifySolidArcComplexGeometryProof.mjs
```

Native host SHA-256: `aae793c535ae4d024fbff7f8a097ab40598e6cce926ac17d75397cce3f827eca`.
Manifest SHA-256: `ec16d192437a2d122e6410c5a130a5f29f0bbaaafc20766e1834ee4d854ad3b0`.
Browser capture tools expect installed Playwright/Chromium and, on this sandbox,
`LD_LIBRARY_PATH="$PWD/.cache/browser/libs/lib:${LD_LIBRARY_PATH:-}"`.
Bulk packets/captures remain scratch/gallery artifacts under existing ignore
conventions. Native rendering/input proof uses an isolated document root and
browser capture uses new isolated native sessions; the live drawing/services
were not reset. This expansion adds no bevel certification or kernel repairs.
