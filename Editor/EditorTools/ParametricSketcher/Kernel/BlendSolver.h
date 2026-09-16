//============================================================================================================================================
// 📦 Editor/EditorTools/ParametricSketcher/Kernel/BlendSolver.h — edge blends (chamfer / fillet) on a solid, and planar face push
//============================================================================================================================================
// The old BrepBody::ChamferEdge rewrote coedge pointers in place: it redirected the two adjacent coedges onto new
//    set-back edges and deliberately left the original edge orphaned in the table ("future passes can prune it"). The
//    loops never closed again, so every chamfered body came back as a Sheet — χ=3, genus −1, volume 0. It is not a
//    tolerance bug, it is the wrong formulation, so this file replaces it rather than patching it.
//
//    Here a blend is a set operation against an exactly-built tool solid, which is how a solid modeller states it.
//    The one curved-edge exception is intentionally direct: a complete native right-cylinder cap is rebuilt from its
//    retained cylinder and an exact conical frustum, avoiding a faceted cutter or coincident circular Boolean:
//
//      chamfer(E, s) = Body − Wedge(E, s)                 the planar corner prism beyond the set-back plane is cut away
//      circular chamfer = Cylinder(R, H−s) ∪ Cone(R, R−s, s)     exact right-cylinder cap bevel
//      circular fillet  = Cylinder(R, H−r) ∪ QuarterTorus(R−r, r) exact right-cylinder cap rolling-ball fillet
//      fillet (E, R) = Body − Wedge(E, t) , then the flat  t = R / tan(θ/2) is the tangent set-back for dihedral θ
//                      face is re-seated on the tangent cylinder of radius R and its two cap edges rebuilt as arcs
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
    // Local frame of a straight manifold edge between two planar faces. Refuses anything else, with the reason.
    [[nodiscard]] static bool Frame(const BrepBody& Body, int Edge, EdgeCornerFrame& Out, std::string& Refusal) noexcept;

    // Planar-setback chamfer of one straight planar edge, or an exact conical bevel of a complete native right-cylinder cap edge.
    // SetBack is measured in each adjacent face, away from the edge (and is radial/axial for the circular-cap case).
    [[nodiscard]] static Deliver<BrepBody> ChamferEdge(const BrepBody& Body, int Edge, double SetBack) noexcept;

    // Rolling-ball fillet of one straight planar edge, or an exact quarter-torus roll on a complete native right-cylinder cap edge.
    // Both new seams are G1; the circular-cap radius is the radial and axial set-back.
    [[nodiscard]] static Deliver<BrepBody> FilletEdge(const BrepBody& Body, int Edge, double Radius) noexcept;

    // Push a planar face along its own outward normal. Positive raises a boss, negative sinks a pocket.
    [[nodiscard]] static Deliver<BrepBody> PushFace(const BrepBody& Body, int Face, double Distance) noexcept;

    // Closed-form volume a blend of this edge removes — the check verification asserts against.
    [[nodiscard]] static double ChamferRemoval(const EdgeCornerFrame& F, double SetBack) noexcept;
    [[nodiscard]] static double FilletRemoval(const EdgeCornerFrame& F, double Radius) noexcept;
    [[nodiscard]] static double TangentSetBack(const EdgeCornerFrame& F, double Radius) noexcept;   // R / tan(θ/2)
};

} // namespace Frontier
