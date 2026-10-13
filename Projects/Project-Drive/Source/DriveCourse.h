//============================================================================================================================================
// 📦 Projects/Project-Drive/Source/DriveCourse.h — the shared driving course (terrain + props), header-only
//============================================================================================================================================
//
//    ONE definition of the course, read by both hosts exactly like ShowroomStructure is in Project-Zero:
//      • the RENDER side (shared raster/ReSTIR / the Vulkan app) emits triangles from EmitCourseTriangles();
//      • the PHYSICS side (DriveTelemetry / the live drive) samples CourseHeight()/CourseNormal() as the tyre ground query.
//    Because both come from these functions, the wheels rest exactly on the surface the renderer draws.
//
//    Layout matches TractrixDriveScene / the authored `--scene drive` level (metres, +X fwd / +Y left / +Z up):
//      flat CHECKER pad · a RAMP 9 m ahead (6 m run, 1.35 m crest) · three rounded SPEED BUMPS behind · an 8-cone slalom.

#pragma once

#include <cstdint>
#include <cmath>
#include "../../../Engine/PhysicalDynamics/Vehicle/RigidWheel.h"
#include <algorithm>

namespace Frontier {
namespace Drive {

// --- course constants (kept in step with TractrixDriveScene::Layout) --------------------------------------------------
struct CourseConstants
{
    static constexpr float PadHalfExtent  = 60.0f;
    static constexpr float CheckerCell    = 4.0f;
    static constexpr float RampNearX      = 9.0f;
    static constexpr float RampRunX       = 6.0f;
    static constexpr float RampRise       = 1.35f;
    static constexpr float RampHalfWidth  = 3.2f;
    static constexpr int   BumpCount      = 3;
    static constexpr float BumpFirstX     = -7.0f;
    static constexpr float BumpSpacingX   = -4.5f;
    static constexpr float BumpHeight     = 0.11f;
    static constexpr float BumpHalfWidthY = 4.0f;
    static constexpr float BumpHalfLenX   = 0.55f;
    static constexpr int   ConeCount      = 8;
    static constexpr float ConeRadius     = 0.22f;
    static constexpr float ConeHeight     = 0.55f;
};

// Material ids the emitter tags each triangle with.  The first six belong to the static course; the remainder
// are the ControlVehicle palette.  Keep this order in step with DriveSceneAuthor::AuthorMaterials and the CPU
// reference renderers.  `ControlVehicle.blend` names its original material families MAGlass, MAMetalicCoat,
// MAPlastic and MARubber; the flattened body export has no polygon-slot stream, so its source-space classifier
// restores those four material families without turning the whole shell into a single paint slab.
enum CourseMaterial : uint32_t
{
    MatCheckerLight = 0u,
    MatCheckerDark  = 1u,
    MatSurround     = 2u,
    MatRamp         = 3u,
    MatBump         = 4u,
    MatCone         = 5u,

    // Families 6..15 are the material slots the artist actually assigned in ControlVehicle.blend, recovered by
    // CarModelling/ControlVehicle/ExtractVehicle.py from the per-face `material_index` attribute.  The names
    // below are the .blend slot names verbatim; do not rename them to something tidier, because the generated
    // ControlVehicleMesh.inl maps slot -> family by these identities.
    MatBodyPaint      = 6u,  // MetalicCoat        — authored clearcoat paint, rendered as a finite-flake automotive family
    MatVehicleGlass   = 7u,  // Glass              — cockpit glazing, transmissive (see the Project-Zero glass family)
    MatVehiclePlastic = 8u,  // Plastic            — splitter, lower trim and grille regions
    MatTyre           = 9u,  // Rubber / StandardRubber.002
    MatHub            = 10u, // Material.024       — the rim mag accent (authored blue emitter)
    MatBrake          = 11u, // brake disc / caliper metal
    MatVehicleTrim    = 12u, // Plastic2           — light satin trim, distinct from the black Plastic family
    MatHeadlight      = 13u, // FrontLight         — authored white emitter at 48.7
    MatTaillight      = 14u, // RearLight          — authored red emitter at 6.5, IOR 8.0
    MatVehicleDefault = 15u, // Material.016 and any face the .blend leaves unassigned (Blender's own 0.8 grey)
    MatCount          = 16u, // [-] the authored families; the cabin fixtures below are Drive-side additions

    // Cabin HMI (DriveCabinLayout.h): the screens are emissive materials whose emission TEXTURE the host binds to
    //    the project's live sheet, so the glass lights the cabin through the same GI as the lamps. Names are the
    //    interchange subject names — DisplaySequence matches them verbatim.
    MatCabinTablet    = 16u, // "Display:CabinTablet"
    MatCabinCluster   = 17u, // "Display:DriverCluster"
    MatCabinLamp      = 18u, // headliner lamp emitter
    MatCabinBezel     = 19u, // screen housings, matte black
    MatCabinCount     = 20u
};

// --- terrain sample (the tyre ground query) ---------------------------------------------------------------------------
// --- kerb ---------------------------------------------------------------------------------------------------
// A raised kerb running alongside the pad, with a genuine VERTICAL face. It exists so that lateral contact can
//    be tested at all: the rest of the course (pad, ramp, speed bumps, cones) is pure heightfield, every
//    surface of it faces upward, and a tyre can never be struck side-on by any of it.
struct KerbConstants
{
    static constexpr float CentreY   = 3.20f;    // [m] kerb inner face, +Y side of the pad
    static constexpr float Height    = 0.120f;   // [m] standard kerb upstand
    static constexpr float Depth     = 0.300f;   // [m] how far it extends in +Y
    static constexpr float NearX     = -14.0f;   // [m] runs alongside the slalom
    static constexpr float FarX      =  26.0f;
};

[[nodiscard]] inline bool WithinKerb(float x, float y) noexcept
{
    using K = KerbConstants;
    return x >= K::NearX && x <= K::FarX && y >= K::CentreY && y <= K::CentreY + K::Depth;
}

// Nearest point on the course surface, with its outward normal. This is what the tyre's contact query needs:
//    a heightfield can only ever answer "how high is the floor here", which pushes a node UP when what should
//    happen is that it is stopped sideways by a wall.
inline void CourseSurface(float x, float y, float z, float& outX, float& outY, float& outZ,
                          float& nx, float& ny, float& nz) noexcept;

[[nodiscard]] inline float CourseHeight(float x, float y) noexcept
{
    using C = CourseConstants;
    // The kerb is part of the drawn surface too, so the renderer and the physics agree on where it is.
    if (WithinKerb(x, y)) return KerbConstants::Height;
    // Ramp wedge (sits on the pad; past the crest the ground drops back to 0 so the car launches).
    if (x >= C::RampNearX && x <= C::RampNearX + C::RampRunX && std::fabs(y) <= C::RampHalfWidth)
        return C::RampRise * (x - C::RampNearX) / C::RampRunX;
    // Rounded speed bumps behind the spawn.
    if (std::fabs(y) <= C::BumpHalfWidthY)
    {
        float z = 0.0f;
        for (int i = 0; i < C::BumpCount; ++i)
        {
            const float cx = C::BumpFirstX + static_cast<float>(i) * C::BumpSpacingX;
            const float d  = x - cx;
            if (std::fabs(d) < C::BumpHalfLenX)
                z += C::BumpHeight * 0.5f * (1.0f + std::cos(3.14159265f * d / C::BumpHalfLenX));
        }
        return z;
    }
    return 0.0f;
}

// Surface normal by central differences (unit length).
inline void CourseNormal(float x, float y, float& nx, float& ny, float& nz) noexcept
{
    const float e = 0.15f;
    const float hx = (CourseHeight(x + e, y) - CourseHeight(x - e, y)) / (2.0f * e);
    const float hy = (CourseHeight(x, y + e) - CourseHeight(x, y - e)) / (2.0f * e);
    nx = -hx; ny = -hy; nz = 1.0f;
    const float l = std::sqrt(nx * nx + ny * ny + nz * nz);
    if (l > 0.0f) { nx /= l; ny /= l; nz /= l; }
}

// Nearest point on the course surface plus its outward normal.
//
//    Off the kerb this is the heightfield answer it always was: straight down the column to CourseHeight.
//    On or beside the kerb it is a real box query -- the node is pushed out through whichever face it is
//    closest to, so the vertical inner face stops a tyre SIDEWAYS instead of launching it upward. That is the
//    whole reason the contact contract was widened from a height to a point.
inline Vehicle::Vec3 CourseTriangleProjection(const Vehicle::Vec3& Point,
                                             const Vehicle::Vec3& A,
                                             const Vehicle::Vec3& B,
                                             const Vehicle::Vec3& C) noexcept
{
    using Vehicle::Dot;
    const auto AB = B - A, AC = C - A, AP = Point - A;
    const float D1 = Dot(AB, AP), D2 = Dot(AC, AP);
    if (D1 <= 0.0f && D2 <= 0.0f) return A;
    const auto BP = Point - B;
    const float D3 = Dot(AB, BP), D4 = Dot(AC, BP);
    if (D3 >= 0.0f && D4 <= D3) return B;
    const float VC = D1 * D4 - D3 * D2;
    if (VC <= 0.0f && D1 >= 0.0f && D3 <= 0.0f) return A + AB * (D1 / (D1 - D3));
    const auto CP = Point - C;
    const float D5 = Dot(AB, CP), D6 = Dot(AC, CP);
    if (D6 >= 0.0f && D5 <= D6) return C;
    const float VB = D5 * D2 - D1 * D6;
    if (VB <= 0.0f && D2 >= 0.0f && D6 <= 0.0f) return A + AC * (D2 / (D2 - D6));
    const float VA = D3 * D6 - D5 * D4;
    if (VA <= 0.0f && D4 - D3 >= 0.0f && D5 - D6 >= 0.0f)
        return B + (C - B) * ((D4 - D3) / ((D4 - D3) + (D5 - D6)));
    const float Reciprocal = 1.0f / (VA + VB + VC);
    return A + AB * (VB * Reciprocal) + AC * (VC * Reciprocal);
}

inline void CourseSurface(float x, float y, float z, float& outX, float& outY, float& outZ,
                          float& nx, float& ny, float& nz) noexcept
{
    using K = KerbConstants;
    using C = CourseConstants;
    const bool OnRamp = x >= C::RampNearX && x <= C::RampNearX + C::RampRunX && std::abs(y) <= C::RampHalfWidth;
    const float Base = WithinKerb(x, y) || OnRamp ? 0.0f : CourseHeight(x, y);

    const float KerbTop = K::Height;
    const bool Inside = x >= K::NearX && x <= K::FarX && y >= K::CentreY && y <= K::CentreY + K::Depth;
    if (Inside && z >= 0.0f && z < KerbTop)
    {
        const float Distances[5] = {x - K::NearX, K::FarX - x, y - K::CentreY,
                                    K::CentreY + K::Depth - y, KerbTop - z};
        uint32_t Face = 0u;
        for (uint32_t Index = 1u; Index < 5u; ++Index)
            if (Distances[Index] < Distances[Face]) Face = Index;
        outX = x; outY = y; outZ = z; nx = 0.0f; ny = 0.0f; nz = 0.0f;
        if (Face == 0u) { outX = K::NearX; nx = -1.0f; }
        if (Face == 1u) { outX = K::FarX; nx =  1.0f; }
        if (Face == 2u) { outY = K::CentreY; ny = -1.0f; }
        if (Face == 3u) { outY = K::CentreY + K::Depth; ny = 1.0f; }
        if (Face == 4u) { outZ = KerbTop; nz = 1.0f; }
        return;
    }
    const float ClosestX = std::clamp(x, K::NearX, K::FarX);
    const float ClosestY = std::clamp(y, K::CentreY, K::CentreY + K::Depth);
    const float ClosestZ = std::clamp(z, 0.0f, KerbTop);
    const float Dx = x - ClosestX, Dy = y - ClosestY, Dz = z - ClosestZ;
    const float Distance = std::sqrt(Dx * Dx + Dy * Dy + Dz * Dz);
    if (Distance > 1.0e-7f && Distance < z - Base)
    {
        outX = ClosestX; outY = ClosestY; outZ = ClosestZ;
        nx = Dx / Distance; ny = Dy / Distance; nz = Dz / Distance;
        return;
    }

    outX = x; outY = y; outZ = Base; nx = 0.0f; ny = 0.0f; nz = 1.0f;
    if (x < 0.0f && std::abs(y) <= C::BumpHalfWidthY) CourseNormal(x, y, nx, ny, nz);
    // 📝 Exact rendered wedge features; finite-difference height normals at edges are not collision walls.
    using Vehicle::Vec3; using Vehicle::Dot;
    const Vec3 Point{x, y, z};
    const float Near = C::RampNearX, Far = Near + C::RampRunX, Rise = C::RampRise, Width = C::RampHalfWidth;
    const float Slope = Rise / C::RampRunX;
    const bool InsideRamp = OnRamp && z >= 0.0f && z <= Slope * (x - Near);
    if (x < Near - Rise || x > Far + Rise || std::abs(y) > Width + Rise) return;
    const Vec3 TopNormal = Vec3{-Slope, 0.0f, 1.0f}.Normalized();
    const Vec3 Projection = Point - TopNormal * Dot(Point - Vec3{Near, 0.0f, 0.0f}, TopNormal);
    const float TopX = std::clamp(Projection.x, Near, Far);
    const Vec3 Top{TopX, std::clamp(Projection.y, -Width, Width), Slope * (TopX - Near)};
    const Vec3 Candidates[4] =
    {
        Top,
        {Far, std::clamp(y, -Width, Width), std::clamp(z, 0.0f, Rise)},
        CourseTriangleProjection(Point, {Near, -Width, 0.0f}, {Far, -Width, 0.0f}, {Far, -Width, Rise}),
        CourseTriangleProjection(Point, {Near, Width, 0.0f}, {Far, Width, 0.0f}, {Far, Width, Rise})
    };
    const Vec3 Normals[4] = {TopNormal, {1.0f, 0.0f, 0.0f}, {0.0f, -1.0f, 0.0f}, {0.0f, 1.0f, 0.0f}};
    float Best = InsideRamp ? 1.0e30f : (z - Base) * (z - Base);
    for (uint32_t Feature = 0u; Feature < 4u; ++Feature)
    {
        const Vec3 Relative = Point - Candidates[Feature]; const float Squared = Dot(Relative, Relative);
        if (Squared >= Best) continue;
        Best = Squared;
        const Vec3 Outward = InsideRamp || Squared < 1.0e-12f ? Normals[Feature] : Relative.Normalized();
        outX = Candidates[Feature].x; outY = Candidates[Feature].y; outZ = Candidates[Feature].z;
        nx = Outward.x; ny = Outward.y; nz = Outward.z;
    }
}

// Cone base centre for slalom cone `k` (matches TractrixDriveScene).
inline void ConeOrigin(int k, float& x, float& y) noexcept
{
    x = 18.0f + static_cast<float>(k) * 5.0f;
    y = (k & 1) ? -2.4f : 2.4f;
}

//------------------------------------------------------------------------------------------------------------------------
// EmitCourseTriangles(add): calls add(ax,ay,az, bx,by,bz, cx,cy,cz, material) once per triangle of the STATIC course
//    (checker pad, surround, ramp, bumps, cones). The vehicle body + wheels are emitted separately by the render tool so
//    they can be posed from telemetry.
//------------------------------------------------------------------------------------------------------------------------
template <class Add>
inline void EmitCourseTriangles(Add add) noexcept
{
    using C = CourseConstants;
    auto quad = [&](float ax,float ay,float az, float bx,float by,float bz,
                    float cx,float cy,float cz, float dx,float dy,float dz, uint32_t m)
    {
        add(ax,ay,az, bx,by,bz, cx,cy,cz, m);
        add(ax,ay,az, cx,cy,cz, dx,dy,dz, m);
    };

    // Surround plane under everything.
    // ── the kerb, drawn as a real box ──────────────────────────────────────────────────────────────────────
    // CourseHeight() and CourseSurface() already know about the kerb; this is the render side agreeing with
    //    them, which is the whole contract at the top of this file ("the wheels rest exactly on the surface
    //    the renderer draws"). It is emitted as a box rather than a raised heightfield cell precisely because
    //    its INNER FACE is the point: that vertical wall is the thing the tyre is meant to strike.
    {
        using K = KerbConstants;
        const float Y0 = K::CentreY, Y1 = K::CentreY + K::Depth, H = K::Height;
        quad(K::NearX, Y0, H,  K::FarX, Y0, H,  K::FarX, Y1, H,  K::NearX, Y1, H, MatSurround);   // top
        quad(K::NearX, Y0, 0.0f, K::FarX, Y0, 0.0f, K::FarX, Y0, H, K::NearX, Y0, H, MatSurround);// inner face
        quad(K::FarX, Y1, 0.0f, K::NearX, Y1, 0.0f, K::NearX, Y1, H, K::FarX, Y1, H, MatSurround);// outer face
        quad(K::NearX, Y1, 0.0f, K::NearX, Y0, 0.0f, K::NearX, Y0, H, K::NearX, Y1, H, MatSurround);
        quad(K::FarX, Y0, 0.0f, K::FarX, Y1, 0.0f, K::FarX, Y1, H, K::FarX, Y0, H, MatSurround);
    }

    const float G = C::PadHalfExtent * 4.0f;
    quad(-G,-G,-0.02f,  G,-G,-0.02f,  G,G,-0.02f,  -G,G,-0.02f, MatSurround);

    // Checker pad.
    const float H = C::PadHalfExtent, cell = C::CheckerCell;
    const int N = static_cast<int>((2.0f * H) / cell);
    for (int i = 0; i < N; ++i)
        for (int j = 0; j < N; ++j)
        {
            const float x0 = -H + i * cell, x1 = x0 + cell;
            const float y0 = -H + j * cell, y1 = y0 + cell;
            const uint32_t m = ((i + j) & 1) ? MatCheckerDark : MatCheckerLight;
            quad(x0,y0,0.0f, x1,y0,0.0f, x1,y1,0.0f, x0,y1,0.0f, m);
        }

    // Ramp wedge (sloped top, vertical far face, two side walls).
    {
        const float n = C::RampNearX, f = C::RampNearX + C::RampRunX, r = C::RampRise, w = C::RampHalfWidth;
        quad(n,-w,0.0f, n,w,0.0f, f,w,r, f,-w,r, MatRamp);   // sloped surface
        quad(f,-w,r,  f,w,r,  f,w,0.0f, f,-w,0.0f, MatRamp); // far vertical face
        add(n,-w,0.0f, f,-w,r, f,-w,0.0f, MatRamp);          // −Y wall
        add(n, w,0.0f, f, w,0.0f, f, w,r, MatRamp);          // +Y wall
    }

    // Speed bumps (low half-cylinder ridges along Y).
    for (int b = 0; b < C::BumpCount; ++b)
    {
        const float cx = C::BumpFirstX + static_cast<float>(b) * C::BumpSpacingX;
        const int   arc = 10;
        for (int s = 0; s < arc; ++s)
        {
            const float t0 = -C::BumpHalfLenX + (2.0f * C::BumpHalfLenX) * (static_cast<float>(s)      / arc);
            const float t1 = -C::BumpHalfLenX + (2.0f * C::BumpHalfLenX) * (static_cast<float>(s + 1)  / arc);
            const float z0 = C::BumpHeight * 0.5f * (1.0f + std::cos(3.14159265f * t0 / C::BumpHalfLenX));
            const float z1 = C::BumpHeight * 0.5f * (1.0f + std::cos(3.14159265f * t1 / C::BumpHalfLenX));
            quad(cx+t0,-C::BumpHalfWidthY,z0, cx+t1,-C::BumpHalfWidthY,z1,
                 cx+t1, C::BumpHalfWidthY,z1, cx+t0, C::BumpHalfWidthY,z0, MatBump);
        }
    }

    // Slalom cones.
    for (int k = 0; k < C::ConeCount; ++k)
    {
        float bx, by; ConeOrigin(k, bx, by);
        const int seg = 14;
        for (int s = 0; s < seg; ++s)
        {
            const float a0 = (2.0f * 3.14159265f * s)       / seg;
            const float a1 = (2.0f * 3.14159265f * (s + 1)) / seg;
            const float x0 = bx + C::ConeRadius * std::cos(a0), y0 = by + C::ConeRadius * std::sin(a0);
            const float x1 = bx + C::ConeRadius * std::cos(a1), y1 = by + C::ConeRadius * std::sin(a1);
            add(x0,y0,0.0f, x1,y1,0.0f, bx,by,C::ConeHeight, MatCone);   // side
            add(x1,y1,0.0f, x0,y0,0.0f, bx,by,0.0f,          MatCone);   // base
        }
    }
}

} // namespace Drive
} // namespace Frontier
