//============================================================================================================================================
// 📦 Engine/Shaders/TyreDeformation.slang — Procedural tyre deformation from the solver's per-wheel contact record
//============================================================================================================================================
// The physics wheel is rigid (PhysicalDynamics/Vehicle/RigidWheel.h): its hub pose and the trace-fan contact (load,
//    patch centre, normal, deflection) are the whole truth about the tyre. This file bends the DRAWN tyre to match,
//    per vertex, in world space — any tyre mesh, authored or generated, slick or treaded, as long as its rim is
//    rigid inside RimRadius and its rubber lies between RimRadius and TreadRadius about the axle.
//
//    Everything is evaluated in WORLD space about the hub, so the contact patch stands still on the road while the
//    material rolls through it; the mesh needs no special vertex attributes, and the same function reconstructs the
//    triangle in SurfaceResolve, so the visibility buffer, motion vectors and shading normals all agree.
//
//    Effects, all C¹ and all bounded by the record:
//      ① flat patch        — a soft clamp of the height above the ground plane: nothing dips below the road, the
//                             bend is 2·√(2·R·δ) long in the rolling direction as on a real tyre;
//      ② sidewall bulge    — the rubber squeezed out of the patch bellies the sidewalls beside it, ∝ δ;
//      ③ carcass lean      — the tread walks sideways under lateral force (Fy / lateral stiffness);
//      ④ tread lead        — and fore/aft under drive and brake (Fx / longitudinal stiffness);
//      ⑤ centrifugal growth— the tread radius grows with (ω·R)².
//
//    Compiles as GLSL (this is #included by the raster vertex stages and the resolve) and as C++ through
//    Engine/Shaders/SlangCpuShim.h (FRONTIER_CPU_PORT), so the CPU proofs run the identical arithmetic.

#ifndef FRONTIER_TYRE_DEFORMATION_INCLUDED
#define FRONTIER_TYRE_DEFORMATION_INCLUDED

// 128-byte record, std430; mirrored by Engine/GeometricRaster/TyreDeformationRecord.h.
struct TyreDeformationRecord
{
    vec4 Hub;           // xyz hub centre (world, m)                       w TreadRadius R (m)
    vec4 Axle;          // xyz unit axle direction (world, hub +Y)        w RimRadius (m): rigid inside
    vec4 Ground;        // xyz contact patch centre (world, m)            w Deflection δ (m, 0 = no contact)
    vec4 Normal;        // xyz unit contact normal (world)                w HalfWidth (m)
    vec4 Lateral;       // xyz carcass lateral deflection (world, m)      w TreadSpeed ω·R (m/s)
    vec4 Longitudinal;  // xyz tread fore/aft lead (world, m)             w PressureRatio p / p_nominal
    vec4 Tuning;        // x BulgeGain  y PatchSoftness (fraction of δ)  z GrowthGain (per (m/s)²)  w Active (1 / 0)
    vec4 Reserved;
};

// Instance → record. Bit InstanceFlagTyreDeform (1 << 2) marks a deformed instance; the slot sits in bits 16..23.
//    Records are stored in pairs: [slot * 2] current frame, [slot * 2 + 1] previous frame (motion vectors).
#define TYRE_DEFORM_FLAG     4u
#define TYRE_DEFORM_SLOT(F)  (((F) >> 16u) & 255u)

// World-space position in, world-space position out.
vec3 DeformTyrePoint(vec3 Point, TyreDeformationRecord R)
{
    if (R.Tuning.w < 0.5) return Point;
    vec3  Axle   = R.Axle.xyz;
    vec3  Offset = Point - R.Hub.xyz;
    float Along  = dot(Offset, Axle);
    vec3  Radial = Offset - Axle * Along;
    float Rho    = length(Radial);
    float Tread  = R.Hub.w, Rim = R.Axle.w;
    float Span   = max(Tread - Rim, 0.001);
    float Weight = clamp((Rho - Rim) / Span, 0.0, 1.0);          // 0 on the rim (rigid) … 1 at the tread
    if (Weight <= 0.0) return Point;
    Weight = Weight * Weight * (3.0 - 2.0 * Weight);
    vec3  Up     = Radial / max(Rho, 1e-6);                       // outward from the axle

    // ⑤ centrifugal growth
    float Growth = R.Tuning.z * R.Lateral.w * R.Lateral.w;
    Point += Up * (Rho * Growth * Weight);

    float Delta = R.Ground.w;
    if (Delta <= 0.0) return Point;

    // ① flat patch: soft clamp of the height above the ground plane
    vec3  N      = R.Normal.xyz;
    float Height = dot(Point - R.Ground.xyz, N);
    float Knee   = max(R.Tuning.y * Delta, 0.0001);
    float Soft   = Height < Knee ? Knee * exp((Height - Knee) / Knee) : Height;
    float Push   = (Soft - Height) * Weight;
    Point += N * Push;

    // ② sidewall bulge beside the patch — strongest mid-sidewall, on the side of the axle the point sits
    float Toward = max(0.0, dot(-Up, N));                         // 1 straight under the hub, 0 at the equator
    Toward = Toward * Toward;
    float Side   = clamp(Along / max(R.Normal.w, 0.001), -1.0, 1.0);
    float Belly  = 4.0 * Weight * (1.0 - Weight);
    float Softer = 1.0 / max(R.Longitudinal.w, 0.5);                 // a soft tyre bellies more for the same squash
    Point += Axle * (Side * Belly * Toward * R.Tuning.x * Delta * Softer);

    // ③ ④ carcass lean and tread lead, focused at the contact
    Point += (R.Lateral.xyz + R.Longitudinal.xyz) * (Toward * Weight);
    return Point;
}

#endif
