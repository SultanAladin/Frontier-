# Solid blend architecture audit — 2026-10-17

## Conclusion / scope

The application does **not** yet have a generally integrated solid blending
pipeline. Passing the earlier sphere-corner fixture is not evidence that the
new three-face / four-edge drawing in the user's screenshot works. There is no
error message or exact geometry journal in that screenshot, and no running
native session survived in this workspace to inspect. Obtain its `.arc` document
before claiming its failure has been reproduced or its radius is impossible.

Infinitely many positions, curvatures, trims and topologies are possible. That
requires general algorithms, not an infinite collection of handwritten model
conditions. Sharp, smooth, seam, boundary and nonmanifold edges are distinct
concepts; a seam on a periodic face is not automatically a sharp edge to fillet.
Valid sharp edges can still encounter algorithmic or geometric limits at a
requested radius. A kernel failure alone does not prove mathematical
impossibility or that the radius is necessarily too large.

## Source inspection (not a closed-source CAD parity claim)

1. FreeCAD `TopoShape::makeElementFillet`: validates that selected topological
   edges belong to the source shape; constructs `BRepFilletAPI_MakeFillet` on the
   actual B-rep; adds edge/radius data; hands result/history to `makeElementShape`.
   https://github.com/FreeCAD/FreeCAD/blob/3f5a2ae6b89d9dc40d00729a2f058866400664a1/src/Mod/Part/App/TopoShapeExpansion.cpp
2. FreeCAD PartDesign `Fillet::execute`: uses that operation, checks the result,
   applies its single-solid policy and reports errors. This is not an unlimited
   guarantee: the source explicitly acknowledges failed combinations and sizes.
   https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/PartDesign/App/FeatureFillet.cpp
3. CadQuery `Mixin3D.fillet`: constructs the same native OCCT builder with the
   owning solid and adds its native edges. Chamfer likewise builds an edge/face
   adjacency map and invokes OCCT's chamfer builder. Its Python layer orchestrates
   native geometry; it does not replace it with per-object bevel formulas.
   https://github.com/CadQuery/cadquery/blob/ebf5ee36ea8ca7c0da1d961f02335a94be0e0e9b/cadquery/occ_impl/shapes.py
4. OCCT API: `Add` builds tangent contours; `Build` constructs the result.
   The documentation describes compatibility failures and exposes failed
   contours, failed corner vertices, spine walking / start-solution / twisted
   surface statuses and explicitly partial results.
   https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_1/src/BRepFilletAPI/BRepFilletAPI_MakeFillet.hxx

These are inspected open-source implementations. No claim is made to have
examined SolidWorks, Rhino or other proprietary kernel source.

## Gaps in this repository

- `BlendSolver.cpp` has many bounded analytic constructions. They can be useful
  optimized routes, but their growing catalogue is not general blending support.
- `OptionalOcctBlend.h` currently opts in only when the body carries a sphere
  classification. This was deliberately narrowed after indiscriminate routing
  changed established mixed-cap behavior. It is a coverage restriction, not a
  solution to arbitrary Boolean topology, and is not yet proven to be the cause
  of the new screenshot's problem.
- The worker reconstructs/sews a B-rep for each call, recognizes selected edges
  geometrically, then converts the result back to native rational surfaces and
  sampled trimming traces. The repaired parameter-domain issue was one defect
  in that boundary. Repeated conversion can still lose analytic hints, edge
  identity, parameterization and topology history.
- A topology-only success is insufficient: trim/surface/edge consistency,
  continuity, finite volume and downstream replay must be checked as well.
- The earlier tests mainly establish one fixed Boolean fixture and selected
  sizes. They are regression evidence, not a general CAD capability guarantee.

## Required general C++ direction

1. **One owning B-rep kernel for solid operations.** Create primitives, booleans
   and blends in the same native geometry representation; retain the actual
   support surfaces, trim curves, adjacency and tolerances across operations.
   Browser/GPU streams are derived presentation, never the authoritative model.
   Either promote OCCT ownership for solids or implement equivalent general
   offset/intersection/corner/trimming algorithms in the custom kernel. Merely
   adding another sphere/plane branch is not that implementation.
2. **Topological selection/history.** Resolve selected edges against their owning
   shape and preserve operation-generated/modified/deleted mappings. Do not rely
   on one edge index or three geometric samples to establish persistent identity.
3. **General blend construction.** Build the tangent contours / offset-support
   spine, rolling-ball strips, multi-edge corner transitions and trimmed/sewn
   result. Chamfer uses its own setback construction, not a fillet substitute.
   Preserve legitimate sharp ends and detect periodic seams explicitly.
4. **Clear backend policy.** Existing proven analytic paths may remain optimized
   implementations, but a declared general fallback should cover supported solid
   B-reps, not be gated on the pictured primitive. Do not simply delete the gate:
   that previously caused mixed-corner regression failures and needs migration
   tests and explicit selection/chain semantics first.
5. **Transactional validation and diagnostics.** Distinguish invalid source or
   selection, conversion failure, kernel construction failure, incomplete corner
   patch and invalid result. Discard partial shapes. Preserve drawing/history on
   refusal. Never claim a start-solution failure always means excessive radius.
6. **Broad verification, including valid refusals.** Cover primitive and
   Boolean-derived plane/cylinder/cone/sphere/torus/NURBS supports; open and closed
   contours; convex/concave rims; seams and poles; varied corner valence; multiple
   scales and orientations; repeated features; save/reopen/history replay; radius
   sweeps and invalid inputs. For shared fixtures compare to the reference
   kernel/application, but acknowledge shared OCCT lineage. Verify native own
   pointer inputs and actual HTML UI, not just a successful console status.

This is a kernel-integration change, not a small UI fix. A generally applicable
implementation cannot honestly be declared complete from another screenshot.

## C++ change in this audit

The OCCT worker now preserves native fillet failure categories using
`NbFaultyContours`, `FaultyContour`, `StripeStatus`, `NbFaultyVertices` and
`HasResult`. Previously all `IsDone()==false` cases were collapsed into one
"edge set / radius" refusal. Partial results remain discarded. This improves
fault localization; **it does not implement the general pipeline above**.

Validation after this diagnostic change: rebuilt native host and worker;
original six-selection probe passed 6/6 with undo/redo. An oversized radius
failure reported a start-solution failure and preserved the source geometry.
No app preview was running at inspection; no user session was reset or modified.


## Subsequent cylinder/sphere reproduction and bounded repair

The user's primitive recipe, without an `.arc`, reproduced the screenshot's
**V4 E4 F3** topology: unit sphere at the origin minus a radius-.6, height-2
cylinder starting at the origin. Both real circular rims were tested; the other
two edges are periodic chart seams. Reverse subtraction was also tested.

The worker now recovers analytic cylindrical input supports, remaps cylindrical
periodic seams, heals individual imported faces at the existing bounded
precision, clamps unperiodized rational support ends before exact extension,
and ignores numerical-only domain overshoot. If rational conversion invalidates
a periodic face's UV wires, a generic closed-support division/conversion retry
must still pass validation. Closed circular trim traces receive denser sampling.
This fixes the demonstrated interop failure; it is not the canonical owning
B-rep migration described above. The sphere-support dispatch restriction remains.

At .0375, both rims × both orders × both modes pass: 8/8 actual native ImGui
own-mouse/B/numeric/Apply/history tests, 8/8 native GLES own-pointer/save-reopen
cases and 8/8 actual HTML canvas/B/signed-input/Apply cases. Native ImGui color
is CPU reference; GLES picking and WebGL2 are software ANGLE/SwiftShader. The
70-test enabled-backend suite and earlier six sphere/box selections also pass.
Native/HTML proof entry points and 40 recorded-image control states are tested.
No existing live drawing was reset; proof harnesses use isolated sessions.

One separate exploratory .03 reverse-subtraction chamfer still refuses under
the unchanged native/worker volume guard. Tests prove that refusal is atomic
and the same history feature can recover by switching to the validated fillet.
Do not present the .0375 matrix as certification of arbitrary radii or solids.

Reproduction and portable evidence:
`Tools/Build/GenerateSolidArcCylinderSphereBevelProof.py`,
`Experimental/SolidArc/Native/CylinderSphereBevelMetrics.py`,
`SolidArcEditorProof --cylinder-sphere-bevel-only`,
`Tools/Build/RunSolidArcCylinderSphereBevelProof.mjs`, and
`Tools/Build/VerifySolidArcCylinderSphereProofButtons.mjs`.
