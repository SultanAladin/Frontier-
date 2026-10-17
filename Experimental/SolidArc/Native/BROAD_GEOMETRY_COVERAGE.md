# Broad native geometry coverage audit

This audit **does not establish general/arbitrary geometry support**. No solver
repair or improved geometric acceptance rate is claimed by adding the tests.

## Deterministic scope

`Fixtures/BroadGeometry.json` defines 16 pairings: offset and rotated boxes,
box/cylinder, box/tilted cylinder, sphere/box, offset sphere/cylinder,
sphere/sphere, perpendicular cylinders, cone/box, cone/sphere, torus/box,
torus/cylinder, extruded hexagon/box, three-profile loft/box, small boxes and a
translated/scaled sphere/cylinder pair. Each tests union, intersection, A−B, B−A:
**64 Boolean cases**.

On accepted Boolean results, sample first/last candidate edges having two distinct
face owners, both blend modes at .025×scale, the first edge at .01×scale, and
an adjacent pair where available. These are **not pre-certified valid sharp-edge
sets/radii**. Refusals can be legitimate, unsupported or defective; do not treat
every refusal as a kernel bug. All outcomes remain in the report.

## Actual results

- **50/64 engine-accepted**, topology-valid positive-volume Boolean outputs;
  **14 safe Boolean refusals**. Refusal checks compare figure state, actual draw
  geometry and saved model journal ignoring repeated display-only `dim auto`.
- **135/388 completed sampled bevel requests engine-accepted**; **253 refusals**
  preserve the original figure state and draw geometry. Accepted results check
  positive solid topology and undo/redo. This is not independent G1 certification.
- **One additional request timed out after 100 seconds** under the four-worker
  sweep: lofted-profiles A−B, e17 fillet .025. Its Boolean completed; two earlier
  blend requests refused. The test process was terminated, with no rollback
  claim for that timed-out request.
- All **11** families completing all four Booleans satisfy approximate volume
  algebra identities within 1% of combined native source volume. This alone did
  **not** catch the torus false positive below.
- Independent recorded-mesh audit: **49/50** accepted outputs pass 512-point
  occupancy sampling and mesh-bounds inclusion. **One real false positive**:
  torus/box union omits the part of the torus outside the box, despite passing
  native closed/manifold/positive-volume checks. Bounds inclusion fails and
  **66/512** occupancy samples disagree. This result is prominently flagged,
  not presented as a correct Boolean.

`AuditSolidArcBroadGeometrySpatial.mjs` uses separate BVH triangle-ray parity,
not the modelling kernel's point-inside classifier. Two non-axis-aligned rays
must agree. A 1% bounds tolerance and >1% occupancy mismatch threshold allow
mesh approximation; passing is sampled evidence, **not exact CAD certification**.

## Visual and input provenance

- **All 64** Boolean cases captured in actual native C++ ImGui CPU-reference color.
- **116** recorded native command packets drawn using the real WebGL2 renderer;
  packet replay is explicitly **not** mouse-input evidence.
- **8 native ImGui + 8 HTML** engine-accepted cases exercise real mouse selection,
  B, signed numeric entry, Apply, undo/redo and history reopening. Families:
  offset boxes, rotated boxes, sphere/box, sphere/sphere, cone/sphere, torus/box,
  extruded hexagon/box, translated/scaled sphere/cylinder. The torus/box case
  demonstrates working input on an incorrectly accepted Boolean; it does **not**
  establish geometric correctness. These chosen cases do not determine the
  broad engine-acceptance denominator.
- **388 gallery control states**, all 64 cells, failure/spatial filters, JSON
  download, native/HTML launchers and Close verified without changing a drawing.
- Native color is CPU reference; browser uses software ANGLE/SwiftShader, zero
  CPU RGBA frame uploads. No physical-GPU claim.

## Reproduce

Build GeometryHost, the optional OCCT worker, native ImGui proof and the browser
app as described in `OCCT_BLEND.md`. Run:

```sh
python3 Tools/Build/ProbeSolidArcBroadGeometry.py --workers 4
# Nonzero exit while a request times out is intentional; results still written.
node Tools/Build/AuditSolidArcBroadGeometrySpatial.mjs
python3 Tools/Build/RunSolidArcEditorProof.py --build-only
SOLIDARC_OCCT_BLEND_HOST="$PWD/.cache/solidarc-occt/BlendHost" \
  .cache/solidarc-editor/SolidArcEditorProof --broad-geometry-proof \
  _AgentScratch/tmp/BroadGeometry/results.json
node Tools/Build/CaptureSolidArcBroadGeometry.mjs
python3 Tools/Build/GenerateSolidArcBroadGeometryProof.py
node Tools/Build/VerifySolidArcBroadGeometryProof.mjs
```

Chromium and its runtime libraries must be provisioned for browser tests.
`--resume` reuses completed per-case output, retries setup/test failures and
retains timeout evidence. `--fixtures id,id` narrows a reproduction. All probing
uses isolated native processes and fresh browser sessions, never the live user's
model. The live port-8081 `/proofs` gallery is generated without restarting the
native mirror or backend. Generated packets/images/reports stay outside Git.

## Next geometry repair priorities

1. Fix torus trimming/classification: topology validity must not admit a wrong
   set-theoretic result. Keep the spatial regression as an acceptance gate.
2. Repair tilted-cylinder/box and cone/box Boolean output validation failures.
3. Move curved-edge, periodic and multi-edge blend support toward the owning
   B-rep integration in `BLEND_ARCHITECTURE.md`; do not remove dispatch restrictions
   or relax endpoint/volume guards merely to increase acceptance counts.
4. Add a bounded/cancellable path for the slow loft-derived blend, and expand
   independent spatial checks before advertising general geometry support.
