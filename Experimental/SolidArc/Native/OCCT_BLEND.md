# Native sphere-corner fillet / chamfer bridge

Enabled in the port-8083 preview after the October 17 repair. The native server
now discovers a provisioned `.cache/solidarc-occt/BlendHost`; an explicit empty
`SOLIDARC_OCCT_BLEND_HOST` disables it. The route applies to spherical supports,
not every freeform solid. Established planar / cylinder / cone / mixed-cap
routes remain intact. Source sphere hints are retained after readback when
support samples verify the same center/radius.

## Reproduce / install

Linux x86-64, glibc >= 2.31, C++17 compiler, Python/pip (build-time only), GNU
coreutils `timeout`. From the repository root:

```sh
python3 Experimental/SolidArc/Native/CompileSequence.py --native
python3 Tools/Build/BuildSolidArcOcctBlend.py
python3 Tools/Build/ProbeSolidArcOcctBlend.py
python3 Tools/Build/PrepareSolidArcNativeGpuPicking.py
SOLIDARC_GPU_PICKING_LIBRARY_DIR="$PWD/.cache/native-gpu/lib" \
  python3 Experimental/SolidArc/Native/SphereCornerBevelMetrics.py
SOLIDARC_OCCT_BLEND_HOST="$PWD/.cache/solidarc-occt/BlendHost" \
  python3 Experimental/SolidArc/Native/BevelMetrics.py
python3 Experimental/SolidArc/Native/ServeSequence.py --port 8083
# Separate terminal (built GPU app + native C++ mirror on the same origin):
npm run build --prefix Experimental/SolidArc -- --base=/gpu/
python3 Tools/Build/ServeSolidArcMirror.py --port 8081 --geometry-port 8083
# Alternative Vite frontend: SOLIDARC_GEOMETRY_URL=http://127.0.0.1:8083 npm run dev -- --port 8081
# Actual HTML mouse/B/signed-size/Apply proof (requires Chromium + runtime libs):
SOLIDARC_URL=http://127.0.0.1:8081/gpu/ BROWSER_EXECUTABLE=/path/to/chromium node Tools/Build/RunSolidArcSphereBevelProof.mjs
```

The bootstrap verifies SHA-256 for OCCT V7_8_1 headers, the pinned
`cadquery-ocp==7.8.1.1.post1` Linux wheel and existing JSON header. Only native
libraries and the upstream license are extracted from the wheel: Python OCP is
never imported. All geometry is computed by native C++ OCCT 7.8.1. The ignored
cache contains regenerated dependencies/binaries, not Git assets. Rebuild after
moving it (absolute library RPATH). Emscripten and non-Linux builds retain the
previous routes; no Windows/WASM OCCT bootstrap is supplied.

## What was wrong

The original solver did not support these plane–sphere Boolean corners. The
new worker initially returned apparently closed solids with clipped blends:
OCCT pcurves extended outside a support's nominal knot interval, whereas native
NURBS evaluation clamps at that interval. The repair extends the **homogeneous
rational support representation** over the complete trimming interval, preserving
the mathematical surface rather than stretching it or relaxing validation.
Converted surfaces and pcurves stay coordinated. Pole-degenerate edges retain
their UV bridge even though the edge has no finite 3D length.

Native own-pointer tests also found the GLES ID renderer's line bias pointed
away from the eye. It now subtracts the same clip-space bias as `LineRaster.slang`.
An opt-in native command-stream picker forwards real vertex streams to the
existing GLES ID/depth device; proof requests provide mouse coordinates, not
injected pick IDs. Browser rendering continues to use WebGL2. SwiftShader was
used for both automated GPU proofs: **software GPU**, not physical hardware.

## Evidence

Fixture: boxes `[0,0,0]–[4,3,2]`, `[2,0,0]–[6,3,2]`; radius-.75 sphere at origin;
subtract box #1 from sphere #3 → Difference #4. Unrelated box #2 is hidden for
mouse-picking proofs, not removed or changed.

- Six original command selections at radius `.0375`: **6/6 accepted**, undo/redo.
- Native C++ own-pointer tests: **12/12** (each of the three curved rim and three
  straight re-entrant edges, fillet + chamfer at `.0375`); preview leaves source
  unchanged; commit, undo, redo, save/reopen. Additional adjacent rim pair test
  checks `.0075`, feature re-edit to `.0375`, and invalid-zero refusal/rollback.
- Actual HTML: **12/12**, canvas mouse selection, B shortcut, signed input,
  native preview, Apply, closed/manifold/oriented result; no page errors.
- Existing geometry baseline: **50/50**. Existing full bevel/geometry suite with
  the new backend configured: **70/70** (141.443 seconds, final run alongside browser proof).
- Broader exploratory matrix: **23/24** accepted, spanning `.0075` fillets,
  `.0589048619762` fillets and `.0375` chamfers, all singles + adjacent sets.
  **Known remaining limit:** curved edge 1 at `.0589048619762` refuses because a
  returned trim endpoint disagrees by ~54e-6, above the 20e-6 guard. This is not a
  claim that every radius / arbitrary Boolean solid is repaired. Do not remove
  that refusal or widen the guard to turn the matrix green.

## Validation boundary

The 30-second worker limit has a 2-second termination grace. The executable path
is trusted deployment configuration, not user drawing input. Import/output B-reps
must validate in OCCT; conversion is checked again. Exported pcurve points are
checked against 3D edge geometry (20e-6); native support evaluations are checked
against exported OCCT reference points (2e-8 relative to scale). Native trim
endpoints must agree with shared vertices within 20e-6. Source/import and returned/
native volumes must agree within 0.3% (floor 1e-12), accounting for native
quadrature. Bodies must be closed, manifold and positive finite volume. Normal
agreement is checked at three samples on boundaries OCCT tags tangent, within
.01 radians. Constant radius/equal setback are passed to actual fillet/chamfer
builders; this is not a chamfer substituted for a fillet.

Sewing/healing precision is 2e-6, capped at 20e-6; this interop tolerance is stated
explicitly, not described as unchanged original-solver tolerance. The tests do
not independently certify every principal curvature of every rational blend.
Sharp end caps are not asserted tangent. Unsupported/over-tolerance results
refuse atomically. Analytic hints besides plane and verified source sphere can
still be lost; broad downstream arbitrary freeform editing is not certified.

B opens on a validated initial radius for spherical bodies: if its length-based
suggestion refuses, it tries up to three smaller suggestions. The displayed size
reflects that choice. Explicit numeric input and feature edits are never silently
changed; the known larger-radius refusal above remains visible.

The server no longer silently evicts idle drawings after one hour; closed
browser sessions still release explicitly, and the eight-session cap bounds
memory. No old curved-proof checkpoint was loaded into the user's drawing.
Reload the preview / Continue previous if reconnecting to a closed old session;
server restart does not preserve in-memory undo stacks.

## Dependency notices / provenance

- OCCT V7_8_1: https://github.com/Open-Cascade-SAS/OCCT/tree/V7_8_1
- OCCT license: GNU LGPL 2.1 with the Open CASCADE exception; upstream
  `LICENSE_LGPL_21.txt` and `OCCT_LGPL_EXCEPTION.txt` are copied into the cache.
- Wheel packaging: https://github.com/CadQuery/OCP and
  https://pypi.org/project/cadquery-ocp/7.8.1.1.post1/ ; upstream
  `cadquery_ocp/LICENSE` is retained in the extracted package.
- nlohmann JSON v3.12.0: existing repository bootstrap pin, MIT license.

No third-party binary is checked into Git by this work. Redistributing a built
worker or bundled OCCT libraries requires carrying applicable upstream notices,
source availability / relinking obligations and the relevant licenses; this
bootstrap is not a substitute for satisfying those distribution requirements.



## Cylinder / sphere recess follow-up

The exact-count primitive reproduction is a unit sphere minus an origin cylinder
(radius .6, height 2): **V4 E4 F3**. Circular rims e1/e2 accept both fillet and
chamfer at .0375. Reverse subtraction e1/e2 also accepts both modes. Surface
seams (e0/e3 in the first order, e0 in the reverse order) now disable bevel with
a specific native reason instead of advertising a bevelable corner.

Import now preserves analytic cylinders, heals individual face wires and maps
cylindrical seams in the analytic angular domain. Export clamps unperiodized
support ends before exact extension, suppresses numerical-only extension, and
uses a validated closed-support split retry if rational conversion creates
intersecting UV wires. Closed full-loop trim traces are sampled more densely;
open-edge sampling remains unchanged. Endpoint, trim, tangent-normal, solid and
volume guards remain active. Analytic output metadata beyond verified planes
and source spheres is still not generally preserved.

Final evidence: **8 native ImGui own-mouse cases**, **8 native GLES own-pointer
cases including save/reopen**, **8 HTML mouse/B/Apply cases**, **70/70 existing
enabled-backend regressions**, **6/6 earlier sphere/box command probes**. Native
history buttons, signed input, undo/redo and invalid Apply are exercised. Live
native/HTML proof launchers, Close, all five mirror panels and **40 proof-image
states** also pass. Both server entry points discover the provisioned worker.
The native color proof is CPU reference, not physical-GPU footage.

Known additional limit: reverse-order chamfer at .03 still safely refuses on
native/worker volume disagreement. The harness verifies unchanged geometry and
recovery by changing the existing feature to validated fillet mode; arbitrary
radii and Boolean topology remain uncertified.

Run `CylinderSphereBevelMetrics.py`, the C++ proof binary's
`--cylinder-sphere-bevel-only`, `RunSolidArcCylinderSphereBevelProof.mjs`,
`GenerateSolidArcCylinderSphereBevelProof.py` and
`VerifySolidArcCylinderSphereProofButtons.mjs` to reproduce. The live portable
report route is `/proofs/cylinder-sphere-bevel`; native UI is `/cpp`, HTML is
`/gpu/`, app port 8081, backend 8083. Generated evidence remains outside Git.
