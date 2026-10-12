//============================================================================================================================================
//                                                        RESERVOIRINTEGRATOR.CPP
//============================================================================================================================================
// 📦 CPU reference of weighted DI resampling, bounded temporal reuse and surface-tested spatial reuse.
//    The BSDF is the shipped shader compiled as C++; one traced continuation is an ordinary GI reference, not ReSTIR GI.
#include "ReservoirIntegrator.h"
#include "../DeviceExchange/SwapchainExchange.h"
#include "../Host/RayTracingSolver.h"
#include "../ContentInterchange/UnifiedMaterialEvaluation.h"
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <thread>

namespace Frontier
{
namespace
{
using HostRuntime::RayTracingSolver;
using HostRuntime::RayStructure;
using HostRuntime::TriangleGeometry;
using HostRuntime::HitIntersection;
constexpr float π = 3.14159265358979323846f;

Vector3 Pack(vec3 Value)
{
    return {Value.x, Value.y, Value.z};
}

vec3 Unpack(Vector3 Value)
{
    return {Value.x, Value.y, Value.z};
}

struct RandomSequence
{
    uint32_t State;
    float Next()
    {
        State = State * 747796405u + 2891336453u;
        uint32_t Word = ((State >> ((State >> 28u) + 4u)) ^ State) * 277803737u;
        Word = (Word >> 22u) ^ Word;
        return static_cast<float>(Word >> 8u) * (1.0f / 16777216.0f);
    }
};

struct Surface
{
    vec3     Point, Normal, Tangent, Bitangent, Outgoing;
    uint32_t Triangle = UINT32_MAX;
    uint32_t Material = 0u;
    float    Distance = 0.0f;
    float    U = 0.0f, V = 0.0f;

    vec3 Local(vec3 Direction) const
    {
        return {dot(Direction, Tangent), dot(Direction, Bitangent), dot(Direction, Normal)};
    }

    vec3 World(vec3 Direction) const
    {
        return Tangent * Direction.x + Bitangent * Direction.y + Normal * Direction.z;
    }
};

struct LightSample
{
    vec3     Point;
    uint32_t Triangle = UINT32_MAX;
    uint32_t Kind = 0u;  // 0 mesh, 1 sun, 2 sky
};

struct Reservoir
{
    LightSample Selected;
    float       WeightSum = 0.0f;
    float       Weight = 0.0f;
    uint32_t    Count = 0u;
};

float TargetRadiance(vec3 Radiance)
{
    return std::fmax(0.0f, Radiance.x * 0.2126f + Radiance.y * 0.7152f + Radiance.z * 0.0722f);
}

vec3 SkyRadiance(vec3 Direction)
{
    const float Height = std::clamp(Direction.z * 0.5f + 0.5f, 0.0f, 1.0f);
    return vec3(0.15f, 0.22f, 0.35f) * (1.0f - Height) + vec3(0.45f, 0.60f, 0.82f) * Height;
}

void Resample(
    Reservoir&           Destination,
    const LightSample&   Sample,
    float                Weight,
    uint32_t             Count,
    RandomSequence&      Random)
{
    Destination.WeightSum += Weight;
    Destination.Count += Count;
    if (Weight > 0.0f && Random.Next() * Destination.WeightSum < Weight)
        Destination.Selected = Sample;
}

void Finalise(Reservoir& Value, float Target)
{
    Value.Weight = Value.Count > 0u && Target > 1e-12f ? Value.WeightSum / (Value.Count * Target) : 0.0f;
}

template<class Function>
void Parallel(uint32_t Count, uint32_t Threads, const Function& Execute)
{
    std::vector<std::thread> Workers;
    for (uint32_t Thread = 0u; Thread < Threads; ++Thread)
        Workers.emplace_back([&, Thread]()
        {
            for (uint32_t Index = Thread; Index < Count; Index += Threads) Execute(Index);
        });
    for (auto& Worker : Workers) Worker.join();
}

struct SceneEvaluation
{
    std::span<const TriangleIndex> Triangles;
    std::span<const Vector3> Normals;
    const MaterialIndex& Materials;
    const RayTracingSolver& Rays;
    const ReservoirSpecification& Settings;
    std::vector<uint32_t> Lights;
    std::vector<float> LightCumulative;
    std::vector<float> Areas;
    float TotalArea = 0.0f;

    Surface Resolve(const HitIntersection& Hit, vec3 Direction) const
    {
        Surface Result;
        if (!Hit.ValidCondition) return Result;
        Result.Triangle = Hit.TriangleIndex;
        Result.Material = Hit.MaterialIndex;
        Result.Point = Unpack(Hit.HitLocation);
        Result.Distance = Hit.RayDistance;
        const auto& Geometry = Rays.QueryTriangles()[Hit.TriangleIndex];
        const vec3 A = Unpack(Geometry.VertexAlpha);
        const vec3 E0 = Unpack(Geometry.VertexBeta) - A, E1 = Unpack(Geometry.VertexGamma) - A;
        const vec3 Offset = Result.Point - A;
        const float AA = dot(E0, E0), AB = dot(E0, E1), BB = dot(E1, E1);
        const float Determinant = AA * BB - AB * AB;
        if (Determinant > 1e-16f)
        {
            Result.U = (BB * dot(Offset, E0) - AB * dot(Offset, E1)) / Determinant;
            Result.V = (AA * dot(Offset, E1) - AB * dot(Offset, E0)) / Determinant;
        }
        Result.Normal = normalize(Unpack(Normals[Hit.TriangleIndex * 3u]) * (1.0f - Result.U - Result.V)
            + Unpack(Normals[Hit.TriangleIndex * 3u + 1u]) * Result.U + Unpack(Normals[Hit.TriangleIndex * 3u + 2u]) * Result.V);
        if (dot(Result.Normal, Direction) > 0.0f) Result.Normal = -Result.Normal;
        Result.Tangent = normalize(cross(std::fabs(Result.Normal.z) < 0.95f ? vec3(0.0f, 0.0f, 1.0f) : vec3(0.0f, 1.0f, 0.0f), Result.Normal));
        Result.Bitangent = cross(Result.Normal, Result.Tangent);
        Result.Outgoing = Result.Local(-Direction);
        return Result;
    }

    ShadingRecord Material(const Surface& Hit) const
    {
        const MaterialRecord& Header = Materials.QueryRecords()[Hit.Material];
        ShadingRecord Result = UnifiedMaterial::Transcribe(Materials.QuerySlabRecords()[Header.SlabOffset],
            (Header.Flags & kMaterialReflectanceMask) >> kMaterialReflectanceShift);
        const auto& Triangle = Triangles[Hit.Triangle];
        const auto& Geometry = Rays.QueryTriangles()[Hit.Triangle];
        UnifiedMaterial::BindAutomotiveHit(Result, Unpack(Geometry.VertexAlpha), Unpack(Geometry.VertexBeta),
            Unpack(Geometry.VertexGamma), Triangle.TextureAlphaU, Triangle.TextureAlphaV, Triangle.TextureBetaU,
            Triangle.TextureBetaV, Triangle.TextureGammaU, Triangle.TextureGammaV, Hit.U, Hit.V, Hit.Distance,
            -Hit.World(Hit.Outgoing), Hit.Normal, std::tan(Settings.FieldOfView * π / 360.0f) * 2.0f / Settings.Height);
        return Result;
    }

    vec3 Contribution(
        const Surface&          Hit,
        const ShadingRecord&    Material,
        const ResolvedLayers&   Layers,
        const LightSample&      Sample) const
    {
        if (Sample.Kind == 0u && Sample.Triangle == UINT32_MAX) return vec3(0.0f);
        const vec3 Offset = Sample.Point - Hit.Point;
        const float DistanceSquared = dot(Offset, Offset);
        if (DistanceSquared < 1e-10f) return vec3(0.0f);
        const vec3 Direction = Offset / std::sqrt(DistanceSquared);
        const vec3 Local = Hit.Local(Direction);
        vec3 Emission;
        float GeometryFactor = std::fabs(Local.z);
        if (Sample.Kind == 1u) Emission = vec3(1.0f, 0.95f, 0.85f) * Settings.SunIntensity;
        else if (Sample.Kind == 2u) Emission = SkyRadiance(Direction);
        else
        {
            const auto& Light = Rays.QueryTriangles()[Sample.Triangle];
            const auto& Record = Materials.QueryRecords()[Light.MaterialIndex];
            Emission = {Record.EmissiveR, Record.EmissiveG, Record.EmissiveB};
            GeometryFactor *= std::fabs(dot(Unpack(Light.SurfaceNormal), -Direction)) / DistanceSquared;
        }
        return EvaluateBsdf(Material, Layers, Hit.Outgoing, Local) * Emission * GeometryFactor;
    }

    LightSample Draw(const Surface& Hit, RandomSequence& Random, float& Pdf) const
    {
        const float Coin = Random.Next();
        const float SunChance = 0.25f;
        const float SkyChance = Lights.empty() ? 0.75f : 0.5f;
        if (Coin < SunChance)
        {
            // Directional-sun reference, not a claim of GPU finite-disc/atmosphere parity.
            Pdf = SunChance;
            return {Hit.Point + normalize(Unpack(Settings.SunDirection)) * 10000.0f, UINT32_MAX, 1u};
        }
        if (Coin < SunChance + SkyChance)
        {
            const float Radius = std::sqrt(Random.Next()), Angle = 2.0f * π * Random.Next();
            const vec3 Direction = Hit.World({Radius * std::cos(Angle), Radius * std::sin(Angle), std::sqrt(1.0f - Radius * Radius)});
            Pdf = SkyChance * std::fmax(1e-7f, dot(Direction, Hit.Normal)) / π;
            return {Hit.Point + Direction * 10000.0f, UINT32_MAX, 2u};
        }
        const float Pick = Random.Next() * TotalArea;
        const uint32_t Slot = std::min(static_cast<uint32_t>(std::lower_bound(LightCumulative.begin(), LightCumulative.end(), Pick) - LightCumulative.begin()), static_cast<uint32_t>(Lights.size()) - 1u);
        const uint32_t Triangle = Lights[Slot];
        const auto& Light = Rays.QueryTriangles()[Triangle];
        float U = Random.Next(), V = Random.Next();
        if (U + V > 1.0f)
        {
            U = 1.0f - U;
            V = 1.0f - V;
        }
        Pdf = (1.0f - SunChance - SkyChance) / TotalArea;
        return {Unpack(Light.VertexAlpha) * (1.0f - U - V) + Unpack(Light.VertexBeta) * U + Unpack(Light.VertexGamma) * V, Triangle, 0u};
    }

    bool Visible(const Surface& Hit, const LightSample& Sample) const
    {
        const vec3 Direction = normalize(Sample.Point - Hit.Point);
        const float Side = dot(Direction, Hit.Normal) >= 0.0f ? 1.0f : -1.0f;
        return !Rays.EvaluateOcclusion(Pack(Hit.Point + Hit.Normal * (0.001f * Side)), Pack(Sample.Point - Direction * 0.002f));
    }

    vec3 Direct(
        const Surface&          Hit,
        const ShadingRecord&    Material,
        const ResolvedLayers&   Layers,
        RandomSequence&         Random) const
    {
        Reservoir Result;
        for (uint32_t Index = 0u; Index < Settings.Candidates; ++Index)
        {
            float Pdf;
            const LightSample Sample = Draw(Hit, Random, Pdf);
            Resample(Result, Sample, TargetRadiance(Contribution(Hit, Material, Layers, Sample)) / Pdf, 1u, Random);
        }
        const vec3 Estimate = Contribution(Hit, Material, Layers, Result.Selected);
        Finalise(Result, TargetRadiance(Estimate));
        return Result.Weight > 0.0f && Visible(Hit, Result.Selected) ? Estimate * Result.Weight : vec3(0.0f);
    }

    vec3 Continuation(
        const Surface&          Hit,
        const ShadingRecord&    Material,
        const ResolvedLayers&   Layers,
        RandomSequence&         Random) const
    {
        const vec4 Sample = SampleBsdf(Material, Layers, Hit.Outgoing, {Random.Next(), Random.Next(), Random.Next(), Random.Next()});
        if (Sample.w <= 1e-8f) return vec3(0.0f);
        const vec3 Local = Sample.xyz;
        const vec3 Direction = normalize(Hit.World(Local));
        const vec3 Throughput = EvaluateBsdf(Material, Layers, Hit.Outgoing, Local) * (std::fabs(Local.z) / Sample.w);
        const float Side = Local.z > 0.0f ? 1.0f : -1.0f;
        const RayStructure Ray{Pack(Hit.Point + Hit.Normal * (0.001f * Side)), Pack(Direction), 0.0001f, 10000.0f};
        const Surface Bounce = Resolve(Rays.EvaluateIntersection(Ray), Direction);
        // 📝 The primary sky proposal already integrates BSDF-to-sky paths; counting a miss again doubles that light.
        if (Bounce.Triangle == UINT32_MAX) return vec3(0.0f);
        const ShadingRecord Secondary = this->Material(Bounce);
        // NEE already estimates emissive-hit paths; do not double count the BSDF hit of a mesh emitter.
        if (TargetRadiance(Secondary.Emission) > 0.0f) return vec3(0.0f);
        const ResolvedLayers SecondaryLayers = ResolveLayers(Secondary, Bounce.Outgoing);
        return Throughput * Direct(Bounce, Secondary, SecondaryLayers, Random);
    }
};

bool Compatible(const Surface& A, const Surface& B)
{
    return A.Triangle != UINT32_MAX && B.Triangle != UINT32_MAX && A.Material == B.Material
        && dot(A.Normal, B.Normal) > 0.9063078f && std::fabs(A.Distance - B.Distance) < std::fmax(0.005f, A.Distance * 0.1f);
}

float ToneCurve(float Value)
{
    const float Mapped = std::clamp((Value * (2.51f * Value + 0.03f)) / (Value * (2.43f * Value + 0.59f) + 0.14f), 0.0f, 1.0f);
    return Mapped <= 0.0031308f ? Mapped * 12.92f : 1.055f * std::pow(Mapped, 1.0f / 2.4f) - 0.055f;
}
}

ReservoirMetrics ReservoirIntegrator::Render(
    std::span<const TriangleIndex>       Triangles,
    std::span<const Vector3>             CornerNormals,
    std::span<const MaterialDescriptor>  Descriptors,
    const ReservoirSpecification&       Settings,
    std::vector<unsigned char>&          Rgb)
{
    if (Triangles.empty() || CornerNormals.size() != Triangles.size() * 3u || Descriptors.empty()
        || Settings.Width == 0u || Settings.Height == 0u || Settings.Frames == 0u || Settings.Candidates == 0u)
        throw std::invalid_argument("Invalid CPU reservoir geometry or sampling extent");
    static_cast<void>(UnifiedMaterial::EnsureTables());
    MaterialIndex Materials;
    for (const auto& Descriptor : Descriptors) Materials.Register(Descriptor);
    Materials.Finalise(1u);
    std::vector<TriangleGeometry> Geometry;
    for (const auto& Triangle : Triangles)
    {
        TriangleGeometry Item{};
        Item.VertexAlpha = {Triangle.VertexAlphaX, Triangle.VertexAlphaY, Triangle.VertexAlphaZ};
        Item.VertexBeta = {Triangle.VertexBetaX, Triangle.VertexBetaY, Triangle.VertexBetaZ};
        Item.VertexGamma = {Triangle.VertexGammaX, Triangle.VertexGammaY, Triangle.VertexGammaZ};
        std::memcpy(&Item.MaterialIndex, &Triangle.MaterialSlot, sizeof(Item.MaterialIndex));
        if (Item.MaterialIndex >= Descriptors.size()) throw std::invalid_argument("Invalid triangle material");
        Item.SurfaceNormal = Pack(normalize(cross(Unpack(Item.VertexBeta) - Unpack(Item.VertexAlpha), Unpack(Item.VertexGamma) - Unpack(Item.VertexAlpha))));
        Geometry.push_back(Item);
    }
    RayTracingSolver Rays;
    Rays.AssignTriangles(Geometry);
    SceneEvaluation Scene{Triangles, CornerNormals, Materials, Rays, Settings};
    for (uint32_t Index = 0u; Index < Geometry.size(); ++Index)
    {
        const auto& Item = Geometry[Index];
        const auto& Material = Materials.QueryRecords()[Item.MaterialIndex];
        const float Area = 0.5f * length(cross(Unpack(Item.VertexBeta) - Unpack(Item.VertexAlpha), Unpack(Item.VertexGamma) - Unpack(Item.VertexAlpha)));
        if (Material.EmissiveR + Material.EmissiveG + Material.EmissiveB <= 0.0f || Area <= 1e-12f) continue;
        Scene.TotalArea += Area;
        Scene.Lights.push_back(Index);
        Scene.LightCumulative.push_back(Scene.TotalArea);
    }
    const uint32_t Count = Settings.Width * Settings.Height;
    const uint32_t Threads = std::clamp(Settings.Threads, 1u, 32u);
    const vec3 Eye = Unpack(Settings.Eye), Forward = normalize(Unpack(Settings.Target) - Eye);
    const vec3 Right = normalize(cross(Forward, vec3(0.0f, 0.0f, 1.0f))), Up = cross(Right, Forward);
    const float Scale = std::tan(Settings.FieldOfView * π / 360.0f), Aspect = static_cast<float>(Settings.Width) / Settings.Height;
    std::vector<Surface> Surfaces(Count);
    std::vector<vec3> Directions(Count), Accumulation(Count, vec3(0.0f));
    std::vector<Reservoir> History(Count), Current(Count), Spatial(Count);
    Parallel(Count, Threads, [&](uint32_t Index)
    {
        const float X = (2.0f * ((Index % Settings.Width) + 0.5f) / Settings.Width - 1.0f) * Scale * Aspect;
        const float Y = (1.0f - 2.0f * ((Index / Settings.Width) + 0.5f) / Settings.Height) * Scale;
        Directions[Index] = normalize(Forward + Right * X + Up * Y);
        const RayStructure Ray{Settings.Eye, Pack(Directions[Index]), 0.0001f, 10000.0f};
        Surfaces[Index] = Scene.Resolve(Rays.EvaluateIntersection(Ray), Directions[Index]);
    });
    std::atomic<uint64_t> Temporal{0u}, Neighbours{0u}, Invalid{0u};
    for (uint32_t Frame = 0u; Frame < Settings.Frames; ++Frame)
    {
        Parallel(Count, Threads, [&](uint32_t Index)
        {
            Current[Index] = Reservoir{};
            const Surface& Hit = Surfaces[Index];
            if (Hit.Triangle == UINT32_MAX) return;
            const ShadingRecord Material = Scene.Material(Hit);
            const ResolvedLayers Layers = ResolveLayers(Material, Hit.Outgoing);
            RandomSequence Random{Index ^ (Frame * 103687u) ^ 0x12345678u};
            for (uint32_t Candidate = 0u; Candidate < Settings.Candidates; ++Candidate)
            {
                float Pdf;
                const LightSample Sample = Scene.Draw(Hit, Random, Pdf);
                Resample(Current[Index], Sample, TargetRadiance(Scene.Contribution(Hit, Material, Layers, Sample)) / Pdf, 1u, Random);
            }
            const Reservoir& Previous = History[Index];
            if (Previous.Weight > 0.0f)
            {
                // Static camera and immutable geometry make same-pixel temporal correspondence exact for this reference.
                const uint32_t ReusedCount = std::min(Previous.Count, 32u);
                const float Target = TargetRadiance(Scene.Contribution(Hit, Material, Layers, Previous.Selected));
                Resample(Current[Index], Previous.Selected, Target * Previous.Weight * ReusedCount, ReusedCount, Random);
                ++Temporal;
            }
            Finalise(Current[Index], TargetRadiance(Scene.Contribution(Hit, Material, Layers, Current[Index].Selected)));
        });
        Parallel(Count, Threads, [&](uint32_t Index)
        {
            Spatial[Index] = Current[Index];
            const Surface& Hit = Surfaces[Index];
            if (Hit.Triangle == UINT32_MAX) return;
            const ShadingRecord Material = Scene.Material(Hit);
            const ResolvedLayers Layers = ResolveLayers(Material, Hit.Outgoing);
            RandomSequence Random{Index ^ (Frame * 179425u) ^ 0x9e3779b9u};
            for (uint32_t Neighbour = 0u; Neighbour < 4u; ++Neighbour)
            {
                const int32_t X = static_cast<int32_t>(Index % Settings.Width) + static_cast<int32_t>(Random.Next() * 7.0f) - 3;
                const int32_t Y = static_cast<int32_t>(Index / Settings.Width) + static_cast<int32_t>(Random.Next() * 7.0f) - 3;
                if (X < 0 || Y < 0 || X >= static_cast<int32_t>(Settings.Width) || Y >= static_cast<int32_t>(Settings.Height)) continue;
                const uint32_t Other = static_cast<uint32_t>(Y) * Settings.Width + static_cast<uint32_t>(X);
                const Reservoir& Value = Current[Other];
                if (Other == Index || Value.Weight <= 0.0f || !Compatible(Hit, Surfaces[Other])) continue;
                // Avoid shifting sky/sun far points on reuse: retain their original direction at the receiving surface.
                LightSample Sample = Value.Selected;
                if (Sample.Kind != 0u) Sample.Point = Hit.Point + (Sample.Point - Surfaces[Other].Point);
                const float Target = TargetRadiance(Scene.Contribution(Hit, Material, Layers, Sample));
                Resample(Spatial[Index], Sample, Target * Value.Weight * Value.Count, Value.Count, Random);
                ++Neighbours;
            }
            const vec3 Contribution = Scene.Contribution(Hit, Material, Layers, Spatial[Index].Selected);
            Finalise(Spatial[Index], TargetRadiance(Contribution));
            vec3 Radiance = Material.Emission;
            if (TargetRadiance(Material.Emission) <= 0.0f)
            {
                if (Spatial[Index].Weight > 0.0f && Scene.Visible(Hit, Spatial[Index].Selected))
                    Radiance += Contribution * Spatial[Index].Weight;
                Radiance += Scene.Continuation(Hit, Material, Layers, Random);
            }
            if (!std::isfinite(Radiance.x) || !std::isfinite(Radiance.y) || !std::isfinite(Radiance.z)
                || Radiance.x < -1e-6f || Radiance.y < -1e-6f || Radiance.z < -1e-6f)
            {
                ++Invalid;
                return;
            }
            Accumulation[Index] += Radiance;
        });
        History.swap(Spatial);
    }
    ReservoirMetrics Metrics;
    Metrics.TemporalReuses = Temporal.load();
    Metrics.SpatialReuses = Neighbours.load();
    Metrics.InvalidSamples = Invalid.load();
    Rgb.resize(static_cast<size_t>(Count) * 3u);
    for (uint32_t Index = 0u; Index < Count; ++Index)
    {
        const vec3 Radiance = Surfaces[Index].Triangle == UINT32_MAX ? SkyRadiance(Directions[Index]) : Accumulation[Index] / static_cast<float>(Settings.Frames);
        Metrics.MeanRadiance += TargetRadiance(Radiance) / Count;
        Rgb[Index * 3u] = static_cast<unsigned char>(255.0f * ToneCurve(Radiance.x) + 0.5f);
        Rgb[Index * 3u + 1u] = static_cast<unsigned char>(255.0f * ToneCurve(Radiance.y) + 0.5f);
        Rgb[Index * 3u + 2u] = static_cast<unsigned char>(255.0f * ToneCurve(Radiance.z) + 0.5f);
    }
    return Metrics;
}
}
