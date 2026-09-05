//============================================================================================================================================
// 📦 ParametricSketcher/Kernel/ProfileSolver.h — Planar profile algebra on exact NURBS loops: intersection, booleans, fillet,
//    chamfer, offset, trim, join.
//
//    A profile is a set of closed planar NurbsCurves. Winding is meaning: a counter-clockwise loop (about the plane normal)
//    encloses material, a clockwise loop cuts a hole, and a point is inside when its winding number over all loops is non-zero.
//    Booleans never drop to polygons — loops are split at true curve–curve intersections and the surviving pieces (rational arcs
//    stay rational arcs) are chained back into loops. Tessellation is used only to answer "which side" for a point that is not on
//    the boundary, where a 1e-4 sagitta cannot change the answer.
//============================================================================================================================================
#pragma once

#include "Kernel/CurveSpecification.h"
#include <vector>

namespace Frontier
{

struct CurveCrossing                                                                    // one solution of A(s) = B(t)
{
    double ParameterA = 0.0;                                                            // [-]
    double ParameterB = 0.0;                                                            // [-]
    Vec3   Point;                                                                       // [m]
    bool   Tangent = false;                                                             // [-] tangents parallel at the crossing
};

enum class ProfileOperation : uint8_t { Union, Subtract, Intersect };
[[nodiscard]] const char* Describe(ProfileOperation Op) noexcept;

struct ProfileLoop
{
    NurbsCurve Curve;                                                                   // closed
    double     SignedArea = 0.0;                                                        // [m²] + counter-clockwise about the normal
    int        Depth = 0;                                                               // [-] enclosure depth: 0 outer, 1 hole, 2 island …
};

struct Profile
{
    Vec3                     Normal = Vec3::UnitZ();                                    // [-] plane normal shared by every loop
    std::vector<ProfileLoop> Loops;

    [[nodiscard]] double Area() const noexcept;                                         // [m²] sum of signed areas
    [[nodiscard]] int    Winding(Vec3 P) const noexcept;                                // [-] over all loops
    [[nodiscard]] bool   Contains(Vec3 P) const noexcept { return Winding(P) != 0; }
    [[nodiscard]] Profile Reversed() const noexcept;
    [[nodiscard]] std::vector<NurbsCurve> Curves() const noexcept;
};

class ProfileSolver
{
public:
    // ── curve level ────────────────────────────────────────────────────────────────────────────────────────────────────────
    [[nodiscard]] static std::vector<CurveCrossing> Intersect(const NurbsCurve& A, const NurbsCurve& B,
                                                              double Tolerance = ScalarCriteria::KernelTolerance) noexcept;
    [[nodiscard]] static std::vector<CurveCrossing> SelfIntersections(const NurbsCurve& A) noexcept;
    [[nodiscard]] static std::vector<NurbsCurve>    SplitAt(const NurbsCurve& C, std::vector<double> Parameters) noexcept;   // closed curves wrap
    [[nodiscard]] static double                     SignedArea(const NurbsCurve& Closed, Vec3 Normal) noexcept;
    [[nodiscard]] static int                        Winding(const NurbsCurve& Closed, Vec3 Normal, Vec3 P) noexcept;

    // ── profile level ──────────────────────────────────────────────────────────────────────────────────────────────────────
    [[nodiscard]] static Deliver<Profile> Assemble(const std::vector<NurbsCurve>& Loops, Vec3 Normal) noexcept;   // validates closure / planarity, computes area & depth
    [[nodiscard]] static Deliver<Profile> Combine(const Profile& A, const Profile& B, ProfileOperation Op) noexcept;
    [[nodiscard]] static Profile          Normalised(Profile P) noexcept;              // outer loops CCW, holes CW by depth parity

    // ── sketch edits (open or closed curves) ───────────────────────────────────────────────────────────────────────────────
    [[nodiscard]] static Deliver<NurbsCurve> Filleted(const NurbsCurve& C, double Radius, const std::vector<int>* Corners = nullptr) noexcept;
    [[nodiscard]] static Deliver<NurbsCurve> Chamfered(const NurbsCurve& C, double Setback, const std::vector<int>* Corners = nullptr) noexcept;
    [[nodiscard]] static Deliver<NurbsCurve> Offset(const NurbsCurve& C, double Distance, Vec3 Normal) noexcept;   // + = left of travel
    [[nodiscard]] static Deliver<std::vector<NurbsCurve>> Trimmed(const NurbsCurve& C, const std::vector<NurbsCurve>& Cutters, Vec3 Near) noexcept;
    [[nodiscard]] static Deliver<NurbsCurve> Joined(std::vector<NurbsCurve> Pieces) noexcept;   // chains in any order / sense
};

} // namespace Frontier
