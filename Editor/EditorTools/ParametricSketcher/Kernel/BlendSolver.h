//============================================================================================================================================
// 📦 Editor/EditorTools/ParametricSketcher/Kernel/BlendSolver.h — edge blends (chamfer / fillet) on a solid, and planar face push
//============================================================================================================================================
// The old BrepBody::ChamferEdge rewrote coedge pointers in place: it redirected the two adjacent coedges onto new
//    set-back edges and deliberately left the original edge orphaned in the table ("future passes can prune it"). The
//    loops never closed again, so every chamfered body came back as a Sheet — χ=3, genus −1, volume 0. It is not a
//    tolerance bug, it is the wrong formulation, so this file replaces it rather than patching it.
//
//    Here a blend is a set operation against an exactly-built tool solid, which is how a solid modeller states it.
//    Curved-edge routes are deliberately bounded and direct: a complete native right-cylinder cap is rebuilt from its
//    retained cylinder and an exact conical frustum/quarter torus, while the first general smooth-support case rebuilds
//    a planar annular shoulder and cylindrical boss around their offset-surface spine. A G1 tangent-chain walker lets
//    that boss root be selected through one member of a representation-split full ring, bounded semicircle, or
//    general-angle sector with two radial caps. Intentional multi-edge sets deduplicate those members and compose
//    independent rolls transactionally:
//
//      chamfer(E, s) = Body − Wedge(E, s)                 the planar corner prism beyond the set-back plane is cut away
//      circular chamfer = Cylinder(R, H−s) ∪ Cone(R, R−s, s)     exact right-cylinder cap bevel
//      circular fillet  = Cylinder(R, H−r) ∪ QuarterTorus(R−r, r) exact right-cylinder cap rolling-ball fillet
//      boss-root fillet = Shoulder(offset r) ∪ QuarterTorus(R+r, r) ∪ Boss(offset r) exact plane–cylinder G1 roll
//      fillet (E, R) = Body − Wedge(E, t) , then the flat  t = R / tan(θ/2) is the tangent set-back for dihedral θ
//                      face is re-seated on the tangent cylinder of radius R and its two cap edges rebuilt as arcs
//      circular cap push  = Cylinder(R, H+d)                        exact native-cylinder cap offset
//      cylindrical side push = Cylinder(R+d, H)                     exact native-cylinder radial face offset
//      push  (F, d)  = Body ∪ Prism(F, d)  ·  Body − Prism(F, −d)
//
//    IntersectionSolver::Combine already returns a closed, consistently wound, manifold B-rep with (u,v) trims on
//    every coedge, so the blends inherit those guarantees instead of re-establishing them by hand — and they compose,
//    so chamfering an edge of an already-pushed face works. Removal volumes match the closed form (see the Removal
//    helpers); verification asserts against those, so a regression shows up as a number, not as a picture.
#pragma once

#include "TopologySpecification.h"
#include <string>

namespace Frontier
{

// Local frame of a manifold edge shared by two planar faces.
struct EdgeCornerFrame
{
    Vec3   Start, End;                                                                  // [m] edge endpoints
    Vec3   Tangent;                                                                     // [-] unit, Start → End
    Vec3   NormalA, NormalB;                                                            // [-] unit outward normals of the two adjacent faces
    Vec3   InA, InB;                                                                    // [-] unit, in each face's plane, pointing away from the edge over that face
    Vec3   Bisector;                                                                    // [-] unit outward corner bisector
    double Length = 0.0;                                                                // [m]
    double Dihedral = 0.0;                                                              // [rad] interior angle between the two faces
    int    FaceA = -1, FaceB = -1;                                                      // [-]
};

class BlendSolver
{
public:
    // Follow G1 edge-to-edge continuations from a manifold seed. A closed edge is a singleton; an ambiguous tangent
    // branch refuses rather than selecting by edge-table order. The returned indices describe one complete chain.
    [[nodiscard]] static Deliver<std::vector<int>> TangentChain(const BrepBody& Body, int SeedEdge) noexcept;

    // Local frame of a straight manifold edge between two planar faces. Refuses anything else, with the reason.
    [[nodiscard]] static bool Frame(const BrepBody& Body, int Edge, EdgeCornerFrame& Out, std::string& Refusal) noexcept;

    // Planar-setback chamfer of one straight planar edge, or an exact conical bevel of a complete native right-cylinder cap edge.
    // SetBack is measured in each adjacent face, away from the edge (and is radial/axial for the circular-cap case).
    [[nodiscard]] static Deliver<BrepBody> ChamferEdge(const BrepBody& Body, int Edge, double SetBack) noexcept;

    // Rolling-ball fillet of one straight planar edge, an exact quarter-torus on a native right-cylinder cap, or an exact
    // concave quarter-torus at the circular root of a bounded planar-shoulder/cylindrical-boss topology. One member of a
    // representation-split full ring, semicircle, or general radial sector propagates over the chain and heals internal
    // angular support seams. Both contacts are G1; finite routes retain exact end meridians on one diameter cap or two
    // radial caps. Asymmetric/unsupported/branching smooth-support arrangements refuse without approximation.
    [[nodiscard]] static Deliver<BrepBody> FilletEdge(const BrepBody& Body, int Edge, double Radius) noexcept;

    // Transactional constant-radius fillet of an intentional seed set. Members of the same curved tangent chain are
    // deduplicated, independent chains are applied in deterministic geometric order, and shared-vertex corner sets
    // refuse before construction. AppliedChains receives the committed chain count, or zero on refusal.
    [[nodiscard]] static Deliver<BrepBody> FilletEdges(const BrepBody& Body, const std::vector<int>& SeedEdges,
                                                       double Radius, int* AppliedChains = nullptr) noexcept;

    // Push a face along its own outward normal. Native right-cylinder caps and side face rebuild directly as exact
    // height/radius edits; all other planar faces use the established direct/Boolean paths. Positive adds material.
    [[nodiscard]] static Deliver<BrepBody> PushFace(const BrepBody& Body, int Face, double Distance) noexcept;

    // Closed-form volume a blend of this edge removes — the check verification asserts against.
    [[nodiscard]] static double ChamferRemoval(const EdgeCornerFrame& F, double SetBack) noexcept;
    [[nodiscard]] static double FilletRemoval(const EdgeCornerFrame& F, double Radius) noexcept;
    [[nodiscard]] static double TangentSetBack(const EdgeCornerFrame& F, double Radius) noexcept;   // R / tan(θ/2)
};

} // namespace Frontier
