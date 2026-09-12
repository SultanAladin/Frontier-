//============================================================================================================================================
// 📦 Project-Zero/Source/CelestialStage.cpp — The Combined Frame
//============================================================================================================================================

#include "CelestialStage.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <random>
#include <thread>

namespace Frontier::ProjectZero {

namespace {

//    The aperture cut into the ceiling, in the engine frame (X right, Y depth, Z up). It is deliberately large:
//    the frame has to show the sky as a *scene element* — clouds moving across it, the moon and stars in it,
//    the solar disc crossing it — and not merely as a skylight that proves illumination. What remains of the
//    ceiling is a border wide enough to read as a room and to cast the aperture's shadow edge on the floor.
constexpr float kApertureHalfX = 0.88f;
constexpr float kApertureMinY  = 0.16f;
constexpr float kApertureMaxY  = 1.94f;
constexpr float kCeilingHeight = 2.4f;                          // the ceiling is lifted to open the sky further

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                     LIFECYCLE
//------------------------------------------------------------------------------------------------------------------------

CelestialStage::CelestialStage(const CelestialStageCriteria& Setup, const CelestialCriteria& SkyCriteria) noexcept
    : Criteria(Setup)
    , Scene{}
    , Sky(SkyCriteria)
    , Rain(SkyCriteria)
    , RadianceBuffer(static_cast<size_t>(Setup.Width) * Setup.Height, Vector3{ 0.0f, 0.0f, 0.0f })
    , SkyMaskBuffer(static_cast<size_t>(Setup.Width) * Setup.Height, 0.0f)
    , Statistics{}
{
    ConstructStage();
}

void CelestialStage::ConstructStage() noexcept
{
    //    Start from Project Zero's own Cornell box so the classic ReSTIR scene is genuinely the one under test,
    //    then re-cut the ceiling if the sky is to reach the floor.
    Scene.ConstructCornellBoxScene();

    if (!Criteria.OpenCeiling)
    {
        return;
    }

    //    Rebuild the shell so the room can be taller than the stock 2 m box: a taller room puts more sky in
    //    frame without moving the camera outside, and gives the aperture's light a longer throw down the walls.
    //    The floor, the boxes and the luminaire are kept exactly as the Cornell builder authored them — only
    //    the four walls and the ceiling are replaced.
    auto& Triangles = Scene.MutableTriangles();
    //    Quads are appended floor, ceiling, back, left, right, light — two triangles each. Drop the ceiling and
    //    the three walls (indices 2..9), keep the floor (0..1) and everything from the light onward (10+).
    Triangles.erase(Triangles.begin() + 2, Triangles.begin() + 10);

    const float Z = kCeilingHeight;

    //    Walls, wound so each normal points into the room.
    Scene.AppendQuad(Vector3{ -1.0f, 2.0f, 0.0f }, Vector3{ 1.0f, 2.0f, 0.0f },
                     Vector3{ 1.0f, 2.0f, Z }, Vector3{ -1.0f, 2.0f, Z }, 0u);           // far wall
    Scene.AppendQuad(Vector3{ -1.0f, 0.0f, 0.0f }, Vector3{ -1.0f, 2.0f, 0.0f },
                     Vector3{ -1.0f, 2.0f, Z }, Vector3{ -1.0f, 0.0f, Z }, 1u);          // left, red
    Scene.AppendQuad(Vector3{ 1.0f, 2.0f, 0.0f }, Vector3{ 1.0f, 0.0f, 0.0f },
                     Vector3{ 1.0f, 0.0f, Z }, Vector3{ 1.0f, 2.0f, Z }, 2u);            // right, green

    //    The ceiling, as four strips framing the aperture — all wound for a downward (-Z) normal.
    Scene.AppendQuad(Vector3{ -1.0f, kApertureMinY, Z }, Vector3{ 1.0f, kApertureMinY, Z },
                     Vector3{ 1.0f, 0.0f, Z }, Vector3{ -1.0f, 0.0f, Z }, 0u);
    Scene.AppendQuad(Vector3{ -1.0f, 2.0f, Z }, Vector3{ 1.0f, 2.0f, Z },
                     Vector3{ 1.0f, kApertureMaxY, Z }, Vector3{ -1.0f, kApertureMaxY, Z }, 0u);
    Scene.AppendQuad(Vector3{ -1.0f, kApertureMaxY, Z }, Vector3{ -kApertureHalfX, kApertureMaxY, Z },
                     Vector3{ -kApertureHalfX, kApertureMinY, Z }, Vector3{ -1.0f, kApertureMinY, Z }, 0u);
    Scene.AppendQuad(Vector3{ kApertureHalfX, kApertureMaxY, Z }, Vector3{ 1.0f, kApertureMaxY, Z },
                     Vector3{ 1.0f, kApertureMinY, Z }, Vector3{ kApertureHalfX, kApertureMinY, Z }, 0u);

    for (uint32_t i = 0u; i < Triangles.size(); ++i)
    {
        Triangles[i].TriangleIndex = i;
    }
}

void CelestialStage::Advance(float DeltaSeconds) noexcept
{
    Sky.AdvanceWind(DeltaSeconds);
    Sky.SolveFrame(Sky.QueryFrame().TimeSeconds + DeltaSeconds);
    Rain.AssignCriteria(Sky.QueryCriteria());
    //    Rain falls in the sky frame; the room's floor is at world Z = 0, which is sky Y = 0.
    Rain.Advance(DeltaSeconds, Vector3{ 0.0f, 1.0f, 0.0f }, Sky.QueryFrame(), 0.0f);
    SunIrradiance = Sky.SampleSunIrradiance();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SHADING
//------------------------------------------------------------------------------------------------------------------------

ObserverFrame CelestialStage::ObserverFrameOf(const Frontier::CameraProjection& Camera) const noexcept
{
    ObserverFrame Frame{};
    const Vector3 WorldPosition = Camera.QuerySpatialLocation();
    //    The observer stands on the celestial ground plane: the room's floor is the world's surface, so the
    //    camera's world Z becomes the sky frame's altitude.
    Frame.Position    = SkyFrameOf(WorldPosition);
    Frame.Forward     = SkyFrameOf(Camera.QueryForwardVector());
    Frame.Right       = SkyFrameOf(Camera.QueryRightVector());
    Frame.Upward      = SkyFrameOf(Camera.QueryUpwardVector());
    Frame.TangentHalf = std::tan(Camera.QueryFieldOfViewRadians() * 0.5f);
    Frame.Height      = std::max(WorldPosition.z, 0.1f);
    return Frame;
}

Vector3 CelestialStage::SampleCosineHemisphere(const Vector3& Normal, float u1, float u2) const noexcept
{
    const float r = std::sqrt(u1);
    const float theta = 2.0f * kPi * u2;
    const float x = r * std::cos(theta);
    const float y = r * std::sin(theta);
    const float z = std::sqrt(std::max(0.0f, 1.0f - u1));

    const Vector3 Up = (std::abs(Normal.z) < 0.999f) ? Vector3{ 0.0f, 0.0f, 1.0f } : Vector3{ 1.0f, 0.0f, 0.0f };
    const Vector3 Tangent = Cross(Up, Normal).Normalized();
    const Vector3 Bitangent = Cross(Normal, Tangent);
    return (Tangent * x + Bitangent * y + Normal * z).Normalized();
}

Vector3 CelestialStage::ShadeSurface(const HitIntersection& Hit, const Vector3& ViewDirection,
                                     const Vector3& IndirectRadiance) const noexcept
{
    (void)ViewDirection;
    const auto& Materials = Scene.QueryMaterials();
    const AnalyticalMaterial& Material = Materials[Hit.MaterialIndex];
    Vector3 Radiance{ 0.0f, 0.0f, 0.0f };

    //    ① The sun, as a directional light, shadowed by the room. This is the term that makes the aperture
    //       visible as a bright patch on the floor.
    if (Criteria.SkyLighting)
    {
        const Vector3 SunWorld = WorldFrameOf(Sky.QueryFrame().SunDirection);
        const float NdotL = Dot(Hit.SurfaceNormal, SunWorld);
        if (NdotL > 0.0f && SunIrradiance.LengthSquared() > 0.0f)
        {
            const Vector3 Origin = Hit.HitLocation + Hit.SurfaceNormal * 1e-3f;
            //    A long shadow ray: anything in the room occludes the sun.
            const Vector3 Target = Origin + SunWorld * 40.0f;
            if (!Scene.EvaluateOcclusion(Origin, Target))
            {
                Radiance += Material.AlbedoColor * SunIrradiance * NdotL;
            }
        }

        //    ② Sky ambient — the hemisphere of scattered light reaching this point through the aperture.
        //       Sampled, not assumed: the visibility term is what shapes it.
        constexpr uint32_t kSkyTaps = 6u;
        Vector3 SkyTerm{ 0.0f, 0.0f, 0.0f };
        uint32_t Unoccluded = 0u;
        for (uint32_t s = 0u; s < kSkyTaps; ++s)
        {
            const float u1 = (static_cast<float>(s) + 0.5f) / static_cast<float>(kSkyTaps);
            const float u2 = Fract(static_cast<float>(s) * 0.618034f + 0.5f);
            const Vector3 Direction = SampleCosineHemisphere(Hit.SurfaceNormal, u1, u2);
            const Vector3 Origin = Hit.HitLocation + Hit.SurfaceNormal * 1e-3f;
            if (!Scene.EvaluateOcclusion(Origin, Origin + Direction * 30.0f))
            {
                SkyTerm += Sky.SampleEnvironmentRadiance(Direction, ObserverFrame{});
                ++Unoccluded;
            }
        }
        if (Unoccluded > 0u)
        {
            //    Cosine-weighted hemisphere sampling: the estimator is the mean of the samples times albedo.
            Radiance += Material.AlbedoColor * (SkyTerm / static_cast<float>(kSkyTaps));
        }
    }

    //    ③ The classic Cornell luminaire, and ④ the ReSTIR indirect term.
    Radiance += IndirectRadiance;
    return Radiance;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE FRAME
//------------------------------------------------------------------------------------------------------------------------

void CelestialStage::RenderFrame(const Frontier::CameraProjection& Camera) noexcept
{
    const auto StartTime = std::chrono::high_resolution_clock::now();

    const uint32_t W = Criteria.Width;
    const uint32_t H = Criteria.Height;
    const ObserverFrame Observer = ObserverFrameOf(Camera);
    const auto& Materials = Scene.QueryMaterials();

    //    The Cornell luminaire, as the original renderer describes it.
    const Vector3 LightMin{ -0.28f, 0.72f, 1.995f };
    const Vector3 LightMax{  0.28f, 1.28f, 1.995f };
    const Vector3 LightNormal{ 0.0f, 0.0f, -1.0f };
    const Vector3 LightEmission = Criteria.EmissiveLuminaire ? Vector3{ 12.0f, 12.0f, 12.0f } : Vector3{ 0.0f, 0.0f, 0.0f };
    const float LightArea = (LightMax.x - LightMin.x) * (LightMax.y - LightMin.y);

    //    One pixel's angular size, for the star field's flat-top discs.
    const float PixelAngle = 2.0f * Observer.TangentHalf / static_cast<float>(H);

    std::mt19937 Rng(1337u);
    std::uniform_real_distribution<float> Dist(0.0f, 1.0f);

    const size_t PixelCount = static_cast<size_t>(W) * H;
    std::vector<HitIntersection> PrimaryHits(PixelCount);
    std::vector<Vector3> DirectBuffer(PixelCount, Vector3{ 0.0f, 0.0f, 0.0f });
    std::vector<IndirectGIReservoir> Indirect(PixelCount);

    //    ── Phase 1 · primary visibility ────────────────────────────────────────────────────────────────────
    for (uint32_t y = 0u; y < H; ++y)
    {
        for (uint32_t x = 0u; x < W; ++x)
        {
            const size_t idx = static_cast<size_t>(y) * W + x;
            const Frontier::ViewRay Ray = Camera.ConstructRay((static_cast<float>(x) + 0.5f) / static_cast<float>(W),
                                                              (static_cast<float>(y) + 0.5f) / static_cast<float>(H));
            PrimaryHits[idx] = Scene.EvaluateIntersection(
                RayRecord{ Ray.OriginLocation, Ray.UnitDirection, Ray.NearClippingDistance, Ray.FarClippingDistance });
        }
    }

    //    ── Phase 2 · direct illumination from the Cornell luminaire ────────────────────────────────────────
    for (size_t idx = 0u; idx < PixelCount; ++idx)
    {
        const HitIntersection& Hit = PrimaryHits[idx];
        if (!Hit.ValidCondition || Hit.MaterialIndex == 3u || !Criteria.EmissiveLuminaire)
        {
            continue;
        }
        const AnalyticalMaterial& Material = Materials[Hit.MaterialIndex];
        Vector3 Sum{ 0.0f, 0.0f, 0.0f };
        constexpr int Grid = 4;
        const float CellWeight = 1.0f / static_cast<float>(Grid * Grid);

        for (int gy = 0; gy < Grid; ++gy)
        {
            for (int gx = 0; gx < Grid; ++gx)
            {
                const float u = (static_cast<float>(gx) + Dist(Rng)) / static_cast<float>(Grid);
                const float v = (static_cast<float>(gy) + Dist(Rng)) / static_cast<float>(Grid);
                const Vector3 LightPoint{ LightMin.x + u * (LightMax.x - LightMin.x),
                                          LightMin.y + v * (LightMax.y - LightMin.y),
                                          LightMin.z };
                if (Scene.EvaluateOcclusion(Hit.HitLocation + Hit.SurfaceNormal * 1e-3f, LightPoint))
                {
                    continue;
                }
                const Vector3 ToLight = LightPoint - Hit.HitLocation;
                const float DistanceSquared = ToLight.LengthSquared();
                const float Distance = std::sqrt(DistanceSquared);
                const Vector3 L = ToLight / Distance;
                const float CosSurface = std::max(0.0f, Dot(Hit.SurfaceNormal, L));
                const float CosLight = std::max(0.0f, Dot(LightNormal, Negate(L)));
                if (CosSurface > 0.0f && CosLight > 0.0f)
                {
                    const float Geometry = (CosSurface * CosLight) / DistanceSquared;
                    Sum += Material.AlbedoColor * (LightEmission * (Geometry * LightArea * CellWeight * 0.40f));
                }
            }
        }
        DirectBuffer[idx] = Sum;
    }

    //    ── Phase 3 · ReSTIR GI candidates ──────────────────────────────────────────────────────────────────
    //    A bounce ray that escapes through the aperture returns SKY radiance, which is what couples the
    //    celestial port into global illumination rather than merely painting a backdrop.
    for (size_t idx = 0u; idx < PixelCount; ++idx)
    {
        const HitIntersection& Hit = PrimaryHits[idx];
        IndirectGIReservoir Reservoir{ Vector3{ 0.0f, 0.0f, 0.0f }, Vector3{ 0.0f, 0.0f, 1.0f },
                                       Vector3{ 0.0f, 0.0f, 0.0f }, 0.0f, 0u, 0.0f };
        if (!Hit.ValidCondition || Hit.MaterialIndex == 3u)
        {
            Indirect[idx] = Reservoir;
            continue;
        }

        for (uint32_t s = 0u; s < Criteria.IndirectRays; ++s)
        {
            const Vector3 BounceDirection = SampleCosineHemisphere(Hit.SurfaceNormal, Dist(Rng), Dist(Rng));
            const RayRecord BounceRay{ Hit.HitLocation + Hit.SurfaceNormal * 1e-3f, BounceDirection, 1e-3f, 50.0f };
            const HitIntersection BounceHit = Scene.EvaluateIntersection(BounceRay);

            Vector3 BounceRadiance{ 0.0f, 0.0f, 0.0f };
            Vector3 BouncePosition = Hit.HitLocation + BounceDirection * 10.0f;
            Vector3 BounceNormal = Negate(BounceDirection);

            if (BounceHit.ValidCondition && BounceHit.MaterialIndex != 3u)
            {
                const AnalyticalMaterial& BounceMaterial = Materials[BounceHit.MaterialIndex];
                BouncePosition = BounceHit.HitLocation;
                BounceNormal   = BounceHit.SurfaceNormal;

                //    The luminaire's contribution at the bounce point.
                const Vector3 LightPoint{ LightMin.x + Dist(Rng) * (LightMax.x - LightMin.x),
                                          LightMin.y + Dist(Rng) * (LightMax.y - LightMin.y),
                                          LightMin.z };
                const Vector3 ToLight = LightPoint - BounceHit.HitLocation;
                const float DistanceSquared = ToLight.LengthSquared();
                const Vector3 L = ToLight / std::sqrt(DistanceSquared);
                const float CosSurface = std::max(0.0f, Dot(BounceHit.SurfaceNormal, L));
                const float CosLight = std::max(0.0f, Dot(LightNormal, Negate(L)));
                if (Criteria.EmissiveLuminaire
                    && !Scene.EvaluateOcclusion(BounceHit.HitLocation + BounceHit.SurfaceNormal * 1e-3f, LightPoint))
                {
                    const float Geometry = (CosSurface * CosLight) / (DistanceSquared + 0.05f);
                    BounceRadiance += BounceMaterial.AlbedoColor * (LightEmission * (Geometry * LightArea * 0.35f));
                }

                //    …and the sun's, at the bounce point. Sunlight that lands on a wall and bounces to the
                //    floor is exactly the coupling the combined proof is meant to show.
                if (Criteria.SkyLighting)
                {
                    const Vector3 SunWorld = WorldFrameOf(Sky.QueryFrame().SunDirection);
                    const float NdotL = Dot(BounceHit.SurfaceNormal, SunWorld);
                    if (NdotL > 0.0f)
                    {
                        const Vector3 Origin = BounceHit.HitLocation + BounceHit.SurfaceNormal * 1e-3f;
                        if (!Scene.EvaluateOcclusion(Origin, Origin + SunWorld * 40.0f))
                        {
                            BounceRadiance += BounceMaterial.AlbedoColor * SunIrradiance * NdotL;
                        }
                    }
                }
            }
            else if (Criteria.SkyLighting)
            {
                //    The ray left the room: it sees the sky, and that radiance enters the GI solve.
                BounceRadiance = Sky.SampleEnvironmentRadiance(BounceDirection, Observer);
            }

            const float Weight = (BounceRadiance.x + BounceRadiance.y + BounceRadiance.z) * 0.3333f;
            Reservoir.ResampleIndirect(BouncePosition, BounceNormal, BounceRadiance, Weight, Dist(Rng));
        }

        if (Reservoir.WeightSum > 0.0f && Reservoir.SampleCount > 0u)
        {
            Reservoir.UnbiasedWeight = Reservoir.WeightSum / static_cast<float>(Reservoir.SampleCount);
        }
        Indirect[idx] = Reservoir;
    }

    //    ── Phase 4 · ReSTIR GI spatial resampling ──────────────────────────────────────────────────────────
    std::vector<IndirectGIReservoir> Resampled = Indirect;
    for (uint32_t pass = 0u; pass < Criteria.SpatialPasses; ++pass)
    {
        for (uint32_t y = 0u; y < H; ++y)
        {
            for (uint32_t x = 0u; x < W; ++x)
            {
                const size_t idx = static_cast<size_t>(y) * W + x;
                const HitIntersection& Centre = PrimaryHits[idx];
                if (!Centre.ValidCondition || Centre.MaterialIndex == 3u)
                {
                    continue;
                }
                IndirectGIReservoir Merged = Indirect[idx];

                for (uint32_t n = 0u; n < 8u; ++n)
                {
                    const int nx = static_cast<int>(x) + (static_cast<int>(Rng() % 11u) - 5);
                    const int ny = static_cast<int>(y) + (static_cast<int>(Rng() % 11u) - 5);
                    if (nx < 0 || nx >= static_cast<int>(W) || ny < 0 || ny >= static_cast<int>(H))
                    {
                        continue;
                    }
                    const size_t nIdx = static_cast<size_t>(ny) * W + static_cast<uint32_t>(nx);
                    const HitIntersection& Neighbour = PrimaryHits[nIdx];
                    if (!Neighbour.ValidCondition || Neighbour.MaterialIndex == 3u) { continue; }
                    if (Dot(Centre.SurfaceNormal, Neighbour.SurfaceNormal) < 0.90f) { continue; }
                    if (std::abs(Centre.RayDistance - Neighbour.RayDistance) > 0.10f) { continue; }

                    const IndirectGIReservoir& Source = Indirect[nIdx];
                    if (Source.WeightSum <= 0.0f) { continue; }

                    //    The reconnection Jacobian for the shift between the two shading points.
                    const Vector3 d1 = Source.BounceHitPosition - Neighbour.HitLocation;
                    const Vector3 d2 = Source.BounceHitPosition - Centre.HitLocation;
                    const float l1 = d1.LengthSquared();
                    const float l2 = d2.LengthSquared();
                    float Jacobian = 1.0f;
                    if (l1 > 1e-6f && l2 > 1e-6f)
                    {
                        const float c1 = std::abs(Dot(Source.BounceHitNormal, d1 / std::sqrt(l1)));
                        const float c2 = std::abs(Dot(Source.BounceHitNormal, d2 / std::sqrt(l2)));
                        Jacobian = (c1 <= 1e-4f) ? 0.0f : (c2 * l1) / (c1 * l2);
                    }
                    const float Shifted = (Source.IndirectRadiance.x + Source.IndirectRadiance.y + Source.IndirectRadiance.z)
                                        * 0.3333f * Source.UnbiasedWeight * Jacobian;
                    Merged.ResampleIndirect(Source.BounceHitPosition, Source.BounceHitNormal, Source.IndirectRadiance,
                                            Shifted, Dist(Rng));
                }

                if (Merged.WeightSum > 0.0f && Merged.SampleCount > 0u)
                {
                    Merged.UnbiasedWeight = Merged.WeightSum / static_cast<float>(Merged.SampleCount);
                }
                Resampled[idx] = Merged;
            }
        }
        Indirect = Resampled;
    }

    //    ── Phase 5 · bilateral filter on the indirect term ─────────────────────────────────────────────────
    std::vector<Vector3> FilteredIndirect(PixelCount, Vector3{ 0.0f, 0.0f, 0.0f });
    for (uint32_t y = 0u; y < H; ++y)
    {
        for (uint32_t x = 0u; x < W; ++x)
        {
            const size_t idx = static_cast<size_t>(y) * W + x;
            const HitIntersection& Centre = PrimaryHits[idx];
            if (!Centre.ValidCondition || Centre.MaterialIndex == 3u)
            {
                continue;
            }
            Vector3 Accumulated{ 0.0f, 0.0f, 0.0f };
            float WeightTotal = 0.0f;

            for (int dy = -3; dy <= 3; ++dy)
            {
                for (int dx = -3; dx <= 3; ++dx)
                {
                    const int qx = static_cast<int>(x) + dx;
                    const int qy = static_cast<int>(y) + dy;
                    if (qx < 0 || qx >= static_cast<int>(W) || qy < 0 || qy >= static_cast<int>(H)) { continue; }
                    const size_t qIdx = static_cast<size_t>(qy) * W + static_cast<uint32_t>(qx);
                    const HitIntersection& Neighbour = PrimaryHits[qIdx];
                    if (!Neighbour.ValidCondition || Neighbour.MaterialIndex == 3u) { continue; }

                    const float SpatialWeight = std::exp(-static_cast<float>(dx * dx + dy * dy) / 9.0f);
                    const float NormalWeight = std::pow(std::max(0.0f, Dot(Centre.SurfaceNormal, Neighbour.SurfaceNormal)), 16.0f);
                    const float DepthWeight = std::exp(-std::abs(Centre.RayDistance - Neighbour.RayDistance) * 15.0f);
                    const float Weight = SpatialWeight * NormalWeight * DepthWeight;

                    if (Indirect[qIdx].WeightSum > 0.0f)
                    {
                        Accumulated += Indirect[qIdx].IndirectRadiance * Weight;
                        WeightTotal += Weight;
                    }
                }
            }
            if (WeightTotal > 0.0f)
            {
                FilteredIndirect[idx] = Accumulated * (1.0f / WeightTotal);
            }
        }
    }

    //    ── Phase 6 · composition: surfaces, sky, media, optics, tonemap ────────────────────────────────────
    //    This is the expensive pass — every sky pixel runs the full integrator (atmosphere march, stars, moons,
    //    two cloud systems, the local volumetric march). Scanlines are independent, so they are handed to a
    //    thread each and the per-frame statistics are reduced afterwards. Determinism is preserved because
    //    nothing here consumes the shared RNG: the jitter is hashed from the pixel coordinate.
    double LuminanceSum = 0.0;
    double SkyLuminanceSum = 0.0;
    double SurfaceLuminanceSum = 0.0;
    uint32_t SkyPixels = 0u;
    uint32_t SurfacePixels = 0u;

    const uint32_t ThreadCount = std::max(1u, std::thread::hardware_concurrency());
    std::vector<double> PartialLuminance(ThreadCount, 0.0);
    std::vector<double> PartialSkyLuminance(ThreadCount, 0.0);
    std::vector<double> PartialSurfaceLuminance(ThreadCount, 0.0);
    std::vector<uint32_t> PartialSkyPixels(ThreadCount, 0u);
    std::vector<uint32_t> PartialSurfacePixels(ThreadCount, 0u);

    auto ShadeBand = [&](uint32_t Worker)
    {
        for (uint32_t y = Worker; y < H; y += ThreadCount)
        {
        for (uint32_t x = 0u; x < W; ++x)
        {
            const size_t idx = static_cast<size_t>(y) * W + x;
            const HitIntersection& Hit = PrimaryHits[idx];

            const float u = (static_cast<float>(x) + 0.5f) / static_cast<float>(W);
            const float v = (static_cast<float>(y) + 0.5f) / static_cast<float>(H);
            const Frontier::ViewRay Ray = Camera.ConstructRay(u, v);
            const Vector3 SkyDirection = SkyFrameOf(Ray.UnitDirection);

            //    Normalised device coordinates, for the flare and the vignette.
            const float ndcU = (2.0f * u - 1.0f) * Camera.QueryAspectRatio();
            const float ndcV = 1.0f - 2.0f * v;

            Vector3 Radiance{ 0.0f, 0.0f, 0.0f };
            float SkyMask = 0.0f;

            if (Hit.ValidCondition)
            {
                if (Hit.MaterialIndex == 3u)
                {
                    Radiance = Materials[Hit.MaterialIndex].EmissiveRadiance;
                }
                else
                {
                    const AnalyticalMaterial& Material = Materials[Hit.MaterialIndex];
                    const Vector3 IndirectTerm = Material.AlbedoColor * (FilteredIndirect[idx] * 0.40f);
                    Radiance = DirectBuffer[idx] + ShadeSurface(Hit, Ray.UnitDirection, IndirectTerm);
                    //    ⚠️ No constant ambient term here. The original renderer added `albedo * 0.015` to every
                    //    surface, which lights the room even with every light switched off — it would make the
                    //    sky-off negative control pass by accident and hide a dead sky. Every photon in this
                    //    frame now comes from a light that is actually being integrated.

                    //    Aerial perspective over the surface, at its true distance. This carries the two
                    //    analytic fogs and the local volumetric march, all of which IN-SCATTER sky light — so
                    //    it belongs to the sky's contribution and the negative control has to switch it off
                    //    too, or "sky off" would still deliver photons through the fog.
                    if (Criteria.SkyLighting)
                    {
                        Radiance = Sky.ApplyAerialPerspective(Radiance, SkyDirection, Hit.RayDistance, Observer, x, y);
                    }
                    //    Only NON-emissive surfaces count toward "is the room lit". Including the luminaire's
                    //    own 32 cd/m² face would swamp the average and let a pitch-black room still report a
                    //    healthy mean — which is precisely the false pass the negative control exists to catch.
                    PartialSurfaceLuminance[Worker] += LuminanceOf(Radiance);
                    ++PartialSurfacePixels[Worker];
                }
            }
            else
            {
                //    Nothing in the room: this pixel sees the sky, through the aperture or past the walls.
                Radiance = Criteria.SkyLighting
                         ? Sky.SampleSkyRadiance(SkyDirection, Observer, PixelAngle, x, y)
                         : Vector3{ 0.0f, 0.0f, 0.0f };
                SkyMask = 1.0f;
                PartialSkyLuminance[Worker] += LuminanceOf(Radiance);
                ++PartialSkyPixels[Worker];
            }

            //    The rainbow rides on the sky mask, so the geometry occludes it; the flare is a lens artefact
            //    and sits over everything. Both are sunlight, so both answer to the negative control.
            if (Criteria.SkyLighting)
            {
                Radiance = Sky.AddRainbow(Radiance, SkyDirection, SkyMask);
                Radiance = Sky.AddLensFlare(Radiance, ndcU, ndcV, Observer);
            }

            RadianceBuffer[idx] = Radiance;
            SkyMaskBuffer[idx]  = SkyMask;
            PartialLuminance[Worker] += LuminanceOf(Radiance);
        }
        }
    };

    {
        std::vector<std::thread> Workers;
        Workers.reserve(ThreadCount);
        for (uint32_t w = 0u; w < ThreadCount; ++w)
        {
            Workers.emplace_back(ShadeBand, w);
        }
        for (std::thread& Worker : Workers)
        {
            Worker.join();
        }
    }

    for (uint32_t w = 0u; w < ThreadCount; ++w)
    {
        LuminanceSum        += PartialLuminance[w];
        SkyLuminanceSum     += PartialSkyLuminance[w];
        SurfaceLuminanceSum += PartialSurfaceLuminance[w];
        SkyPixels           += PartialSkyPixels[w];
        SurfacePixels       += PartialSurfacePixels[w];
    }

    //    ── Phase 7 · precipitation, splatted as motion streaks in screen space ─────────────────────────────
    uint32_t RainPixels = 0u;
    if (Sky.QueryCriteria().Precipitation.Visible && !Rain.QueryPool().empty())
    {
        const HydrometeorClass& Class = Rain.QueryClass();
        const Vector3 CameraPosition = Camera.QuerySpatialLocation();
        const Vector3 Forward = Camera.QueryForwardVector();
        const Vector3 Right   = Camera.QueryRightVector();
        const Vector3 Up      = Camera.QueryUpwardVector();
        const float TangentHalf = std::tan(Camera.QueryFieldOfViewRadians() * 0.5f);
        const float Aspect = Camera.QueryAspectRatio();
        const Vector3 Tint = Sky.QueryCriteria().Precipitation.Tint;
        const float Opacity = Sky.QueryCriteria().Precipitation.Opacity;
        const float StreakScale = Sky.QueryCriteria().Precipitation.Streak * Class.StreakLength * 0.05f;

        //    Drops are lit by the same sky the scene is lit by, so they darken with the weather.
        const Vector3 DropRadiance = (Sky.QueryFrame().SkyAmbient * 2.2f + SunIrradiance * 0.35f) * Tint;

        auto Project = [&](const Vector3& WorldPoint, float& OutX, float& OutY, float& OutDepth) -> bool
        {
            const Vector3 Relative = WorldPoint - CameraPosition;
            const float Depth = Dot(Relative, Forward);
            if (Depth < 0.05f) { return false; }
            const float px = Dot(Relative, Right) / (Depth * TangentHalf * Aspect);
            const float py = Dot(Relative, Up) / (Depth * TangentHalf);
            OutX = (px * 0.5f + 0.5f) * static_cast<float>(W);
            OutY = (0.5f - py * 0.5f) * static_cast<float>(H);
            OutDepth = Depth;
            return true;
        };

        for (const Hydrometeor& Drop : Rain.QueryPool())
        {
            const Vector3 World = WorldFrameOf(Drop.Position);
            float sx = 0.0f, sy = 0.0f, depth = 0.0f;
            if (!Project(World, sx, sy, depth)) { continue; }

            //    Pixels per metre at this depth — the projection that sets both width and streak length.
            const float PixelsPerMetre = static_cast<float>(H) / (2.0f * depth * TangentHalf);
            const float Fade = std::min(1.0f, depth / 2.0f) * (1.0f - Clamp01((depth - 45.0f * 1.6f) / (45.0f * 0.6f)));
            if (Fade <= 0.0f) { continue; }

            const float Radius = std::max(0.5f, Drop.Scale * Class.Diameter * 0.0006f * PixelsPerMetre);

            if (Drop.Landed)
            {
                if (!Sky.QueryCriteria().Precipitation.Splash) { continue; }
                const float k = Drop.RestedFor / std::max(0.01f, Sky.QueryCriteria().Precipitation.RestSeconds);
                const float RingRadius = (0.6f + k * 2.2f) * Sky.QueryCriteria().Precipitation.Accumulation * PixelsPerMetre * 0.6f + 1.0f;
                const float Alpha = (1.0f - k) * 0.35f * Opacity * Fade;
                //    A flattened ellipse: the splash ring seen in perspective.
                for (int a = 0; a < 24; ++a)
                {
                    const float t = static_cast<float>(a) / 24.0f * 2.0f * kPi;
                    const int px = static_cast<int>(sx + std::cos(t) * RingRadius);
                    const int py = static_cast<int>(sy + std::sin(t) * RingRadius * 0.35f);
                    if (px < 0 || px >= static_cast<int>(W) || py < 0 || py >= static_cast<int>(H)) { continue; }
                    const size_t ridx = static_cast<size_t>(py) * W + static_cast<uint32_t>(px);
                    RadianceBuffer[ridx] = Mix(RadianceBuffer[ridx], DropRadiance, Alpha);
                    ++RainPixels;
                }
                continue;
            }

            if (Class.Shape == 0u)
            {
                //    A motion streak from the drop's own velocity: length = speed × exposure.
                const Vector3 TailWorld = WorldFrameOf(Drop.Position - Drop.Velocity * (StreakScale * 0.4f));
                float tx = sx, ty = sy, tdepth = depth;
                Project(TailWorld, tx, ty, tdepth);
                const float Alpha = 0.55f * Opacity * Fade;
                const float Length = std::sqrt((tx - sx) * (tx - sx) + (ty - sy) * (ty - sy));
                const int Steps = std::max(2, static_cast<int>(Length));
                for (int s = 0; s <= Steps; ++s)
                {
                    const float t = static_cast<float>(s) / static_cast<float>(Steps);
                    const int px = static_cast<int>(sx + (tx - sx) * t);
                    const int py = static_cast<int>(sy + (ty - sy) * t);
                    const float Width = std::max(0.7f, Radius * 1.6f);
                    for (int w = -static_cast<int>(Width * 0.5f); w <= static_cast<int>(Width * 0.5f); ++w)
                    {
                        const int qx = px + w;
                        if (qx < 0 || qx >= static_cast<int>(W) || py < 0 || py >= static_cast<int>(H)) { continue; }
                        const size_t ridx = static_cast<size_t>(py) * W + static_cast<uint32_t>(qx);
                        RadianceBuffer[ridx] = Mix(RadianceBuffer[ridx], DropRadiance, Alpha);
                        ++RainPixels;
                    }
                }
            }
            else
            {
                //    Hail and snow are round: a small filled disc, brighter at the centre.
                const float Alpha = (Class.Shape == 1u ? 0.95f : 0.9f) * Opacity * Fade;
                const int R = std::max(1, static_cast<int>(Radius));
                for (int dy = -R; dy <= R; ++dy)
                {
                    for (int dx = -R; dx <= R; ++dx)
                    {
                        if (dx * dx + dy * dy > R * R) { continue; }
                        const int px = static_cast<int>(sx) + dx;
                        const int py = static_cast<int>(sy) + dy;
                        if (px < 0 || px >= static_cast<int>(W) || py < 0 || py >= static_cast<int>(H)) { continue; }
                        const size_t ridx = static_cast<size_t>(py) * W + static_cast<uint32_t>(px);
                        RadianceBuffer[ridx] = Mix(RadianceBuffer[ridx], DropRadiance, Alpha);
                        ++RainPixels;
                    }
                }
            }
        }
    }

    const auto EndTime = std::chrono::high_resolution_clock::now();

    Statistics.MeanLuminance        = LuminanceSum / static_cast<double>(PixelCount);
    Statistics.SkyPixelFraction     = static_cast<double>(SkyPixels) / static_cast<double>(PixelCount);
    Statistics.MeanSkyLuminance     = SkyPixels > 0u ? SkyLuminanceSum / SkyPixels : 0.0;
    Statistics.MeanSurfaceLuminance = SurfacePixels > 0u ? SurfaceLuminanceSum / SurfacePixels : 0.0;
    Statistics.RainPixels           = RainPixels;
    Statistics.RenderMilliseconds   = std::chrono::duration<double, std::milli>(EndTime - StartTime).count();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   IMAGE EXPORT
//------------------------------------------------------------------------------------------------------------------------

bool CelestialStage::ExportPpmImage(const std::string& OutputPath) const noexcept
{
    std::ofstream Out(OutputPath, std::ios::binary);
    if (!Out.is_open())
    {
        return false;
    }

    Out << "P6\n" << Criteria.Width << " " << Criteria.Height << "\n255\n";

    for (uint32_t y = 0u; y < Criteria.Height; ++y)
    {
        for (uint32_t x = 0u; x < Criteria.Width; ++x)
        {
            const size_t idx = static_cast<size_t>(y) * Criteria.Width + x;
            const float u = (static_cast<float>(x) + 0.5f) / static_cast<float>(Criteria.Width);
            const float v = (static_cast<float>(y) + 0.5f) / static_cast<float>(Criteria.Height);

            //    The reference's own display chain: auto EV, tonemap, vignette, gamma, grain.
            const Vector3 Display = Sky.ResolveDisplay(RadianceBuffer[idx] * Criteria.Exposure,
                                                       2.0f * u - 1.0f, 1.0f - 2.0f * v, x, y);
            const auto Quantise = [](float c) -> uint8_t
            {
                return static_cast<uint8_t>(std::clamp(c * 255.0f, 0.0f, 255.0f));
            };
            Out.put(static_cast<char>(Quantise(Display.x)));
            Out.put(static_cast<char>(Quantise(Display.y)));
            Out.put(static_cast<char>(Quantise(Display.z)));
        }
    }
    return true;
}

} // namespace Frontier::ProjectZero
