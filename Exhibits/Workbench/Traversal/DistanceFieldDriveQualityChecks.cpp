//============================================================================================================================================
//                                                          DISTANCEFIELDDRIVEQUALITYCHECKS.CPP
//============================================================================================================================================
// 📦 CPU mirror of the GI marcher against exact triangle rays on the authored, multi-material Drive body.

// 📝 This excludes textured alpha/coverage, wheels, course, card lighting and Vulkan rendering.
#include "Engine/GeometricRaster/DistanceFieldStructure.h"
#include "Engine/GeometricRaster/SceneStructure.h"
#include "EngineContent/GeometryArchives/ControlVehicleStructure.inl"
#include <cassert>
#include <iostream>
#include <map>
#include <vector>
#include <algorithm>
#include <cmath>
#include <limits>
#include <numeric>

using Frontier::Vector3;
using Frontier::DistanceFieldStructure;

float Dot(Vector3 Alpha, Vector3 Beta)
{
    return Alpha.x * Beta.x + Alpha.y * Beta.y + Alpha.z * Beta.z;
}

Vector3 Cross(Vector3 Alpha, Vector3 Beta)
{
    return {Alpha.y * Beta.z - Alpha.z * Beta.y, Alpha.z * Beta.x - Alpha.x * Beta.z, Alpha.x * Beta.y - Alpha.y * Beta.x};
}

Vector3 Normalize(Vector3 Direction)
{
    return Direction / std::sqrt(Dot(Direction, Direction));
}

float MeshRay(const std::vector<Frontier::VertexRecord>& Positions, const std::vector<uint32_t>& Corners,
              Vector3 Origin, Vector3 Direction)
{
    float Closest = 20.0f;
    for (size_t Index = 0u; Index < Corners.size(); Index += 3u)
    {
        const auto Alpha = Positions[Corners[Index]].SpatialLocation;
        const auto Beta  = Positions[Corners[Index + 1u]].SpatialLocation;
        const auto Gamma = Positions[Corners[Index + 2u]].SpatialLocation;
        const Vector3 AB = Beta - Alpha, AC = Gamma - Alpha;
        const Vector3 Crossed = Cross(Direction, AC);
        const float Determinant = Dot(AB, Crossed);
        if (std::abs(Determinant) < 1.0e-9f) continue;
        const float Inverse = 1.0f / Determinant;
        const Vector3 AO = Origin - Alpha;
        const float U = Dot(AO, Crossed) * Inverse;
        if (U < 0.0f || U > 1.0f) continue;
        const Vector3 Q = Cross(AO, AB);
        const float V = Dot(Direction, Q) * Inverse;
        if (V < 0.0f || U + V > 1.0f) continue;
        const float T = Dot(AC, Q) * Inverse;
        if (T >= 0.002f && T < Closest) Closest = T;
    }
    return Closest;
}

struct FieldReading
{
    float Distance = 1.0e20f;
    float Tolerance = 0.002f;
    uint32_t Facet = 0xFFFFFFFFu;
};

FieldReading ReadField(const DistanceFieldStructure& Field, Vector3 Position)
{
    FieldReading Reading;
    for (const auto& Placement : Field.QueryPlacements())
    {
        if (Placement.Identity[3] == 0u) continue; // aliases share the root field
        const float* World = Placement.WorldToLocal;
        const Vector3 Local{
            World[0] * Position.x + World[4] * Position.y + World[8] * Position.z + World[12],
            World[1] * Position.x + World[5] * Position.y + World[9] * Position.z + World[13],
            World[2] * Position.x + World[6] * Position.y + World[10] * Position.z + World[14]
        };
        const float P[] = {Local.x, Local.y, Local.z};
        float Outside = 0.0f;
        for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
        {
            float Delta = std::max({Placement.Minimum[Axis] - P[Axis], P[Axis] - Placement.Maximum[Axis], 0.0f});
            Outside += Delta * Delta;
        }
        if (Outside > 0.0f)
        {
            const float Distance = std::sqrt(Outside) * Placement.Minimum[3];
            if (Distance < Reading.Distance) Reading = {Distance, Placement.Maximum[3], 0xFFFFFFFFu};
            continue;
        }
        uint32_t Lower[3];
        float Fraction[3];
        for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
        {
            const float Coordinate = (P[Axis] - Placement.Minimum[Axis]) /
                (Placement.Maximum[Axis] - Placement.Minimum[Axis]) * float(Placement.Resolution[Axis] - 1u);
            Lower[Axis] = std::min(uint32_t(Coordinate), Placement.Resolution[Axis] - 2u);
            Fraction[Axis] = Coordinate - float(Lower[Axis]);
        }
        float SignedDistance = 0.0f;
        float NearestWeight = -1.0f;
        uint32_t NearestFacet = 0u;
        for (uint32_t Corner = 0u; Corner < 8u; ++Corner)
        {
            const uint32_t X = Corner & 1u, Y = (Corner >> 1u) & 1u, Z = (Corner >> 2u) & 1u;
            const float Weight = (X ? Fraction[0] : 1.0f - Fraction[0]) *
                                 (Y ? Fraction[1] : 1.0f - Fraction[1]) *
                                 (Z ? Fraction[2] : 1.0f - Fraction[2]);
            const uint32_t Index = Placement.Resolution[3] +
                ((Lower[2] + Z) * Placement.Resolution[1] + (Lower[1] + Y)) * Placement.Resolution[0] + Lower[0] + X;
            const auto Sample = Field.QuerySamples()[Index];
            SignedDistance += Sample.Distance * Weight;
            if (Weight > NearestWeight) { NearestWeight = Weight; NearestFacet = Sample.Facet; }
        }
        const float Distance = std::abs(SignedDistance) * Placement.Minimum[3];
        if (Distance < Reading.Distance)
        {
            Reading = {Distance, Placement.Maximum[3], Placement.Identity[1] +
                       std::min(NearestFacet, Placement.Identity[2] - 1u)};
        }
    }
    return Reading;
}

float FieldEntry(const DistanceFieldStructure& Field, Vector3 Origin, Vector3 Direction, float Current = 0.0f)
{
    float Entry = 20.0f;
    for (const auto& Placement : Field.QueryPlacements())
    {
        if (Placement.Identity[3] == 0u) continue; // aliases share the root field
        const float* World = Placement.WorldToLocal;
        const Vector3 LocalOrigin{
            World[0] * Origin.x + World[4] * Origin.y + World[8] * Origin.z + World[12],
            World[1] * Origin.x + World[5] * Origin.y + World[9] * Origin.z + World[13],
            World[2] * Origin.x + World[6] * Origin.y + World[10] * Origin.z + World[14]};
        const Vector3 LocalDirection{
            World[0] * Direction.x + World[4] * Direction.y + World[8] * Direction.z,
            World[1] * Direction.x + World[5] * Direction.y + World[9] * Direction.z,
            World[2] * Direction.x + World[6] * Direction.y + World[10] * Direction.z};
        const float P[3] = {LocalOrigin.x, LocalOrigin.y, LocalOrigin.z};
        const float D[3] = {LocalDirection.x, LocalDirection.y, LocalDirection.z};
        float Near = 0.0f, Far = 20.0f;
        for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
        {
            if (std::abs(D[Axis]) < 1.0e-8f)
            {
                if (P[Axis] < Placement.Minimum[Axis] || P[Axis] > Placement.Maximum[Axis]) Far = -1.0f;
            }
            else
            {
                const float T0 = (Placement.Minimum[Axis] - P[Axis]) / D[Axis];
                const float T1 = (Placement.Maximum[Axis] - P[Axis]) / D[Axis];
                Near = std::max(Near, std::min(T0, T1));
                Far = std::min(Far, std::max(T0, T1));
            }
        }
        if (Near <= Far && Far >= Current) Entry = std::min(Entry, std::max(Near, Current));
    }
    return Entry;
}

float FieldRay(const DistanceFieldStructure& Field, Vector3 Origin, Vector3 Direction)
{
    float Travel = std::max(0.002f, FieldEntry(Field, Origin, Direction) + 0.0001f);
    for (uint32_t Step = 0u; Step < 192u && Travel < 20.0f; ++Step)
    {
        FieldReading Read = ReadField(Field, Origin + Direction * Travel);
        if (Read.Distance > 1.0e19f) break;
        if (Read.Facet == 0xFFFFFFFFu)
        {
            const float Entry = FieldEntry(Field, Origin, Direction, Travel);
            if (Entry >= 20.0f) break;
            if (Entry > Travel + 0.001f) { Travel = Entry + 0.0001f; continue; }
        }
        if (Read.Facet != 0xFFFFFFFFu && Read.Distance < Read.Tolerance) return Travel;
        Travel += std::max(Read.Distance * 0.75f, Read.Tolerance * 0.5f);
    }
    return 20.0f;
}

struct RayStatistics
{
    uint32_t Total = 0u;
    uint32_t MeshHits = 0u;
    uint32_t FieldHits = 0u;
    uint32_t Missing = 0u;
    uint32_t Extra = 0u;
    uint32_t Wrong = 0u;
    std::vector<float> Differences;
};

void Probe(RayStatistics& Stats, const std::vector<Frontier::VertexRecord>& Positions,
           const std::vector<uint32_t>& Corners, const DistanceFieldStructure& Field,
           Vector3 Origin, Vector3 Direction)
{
    const float Reference = MeshRay(Positions, Corners, Origin, Direction);
    const float Approximate = FieldRay(Field, Origin, Direction);
    ++Stats.Total;
    if (Reference < 20.0f) ++Stats.MeshHits;
    if (Approximate < 20.0f) ++Stats.FieldHits;
    if (Reference < 20.0f && Approximate >= 20.0f) ++Stats.Missing;
    if (Reference >= 20.0f && Approximate < 20.0f) ++Stats.Extra;
    if (Reference < 20.0f && Approximate < 20.0f)
    {
        const float Error = std::abs(Approximate - Reference);
        Stats.Differences.push_back(Error);
        if (Error > 0.10f) ++Stats.Wrong;
    }
}

void Print(const char* Name, RayStatistics& Stats)
{
    std::sort(Stats.Differences.begin(), Stats.Differences.end());
    const auto Quantile = [&](float Fraction)
    {
        return Stats.Differences.empty() ? 0.0f : Stats.Differences[size_t((Stats.Differences.size() - 1u) * Fraction)];
    };
    std::cout << Name << ": total=" << Stats.Total << " meshHits=" << Stats.MeshHits << " fieldHits=" << Stats.FieldHits
              << " missing=" << Stats.Missing << " extra=" << Stats.Extra << " wrongDepth>0.10m=" << Stats.Wrong
              << " depthErrorMedian=" << Quantile(0.5f) << " depthErrorP95=" << Quantile(0.95f) << '\n';
}

int main(int ArgumentCount, char** Arguments)
{
    assert(ArgumentCount == 2);
    using namespace Frontier;
    using namespace Frontier::Vehicle::ControlVehicle;
    std::map<uint32_t, std::vector<uint32_t>> FamilyTriangles;
    for (uint32_t Index = 0u; Index < kTriangleCount; ++Index)
    {
        const uint32_t Family = kTriangleFamily[Index];
        for (uint32_t Corner = 0u; Corner < 3u; ++Corner)
        {
            FamilyTriangles[Family].push_back(kTriangles[Index * 3u + Corner]);
        }
    }
    std::vector<VertexRecord> Positions(kVertexCount);
    for (uint32_t Index = 0u; Index < kVertexCount; ++Index)
    {
        Positions[Index].SpatialLocation = {kPositions[3u * Index], kPositions[3u * Index + 1u], kPositions[3u * Index + 2u]};
    }
    std::vector<uint32_t> Corners;
    std::vector<InstanceRecord> Placements;
    std::vector<MaterialRecord> Materials(FamilyTriangles.size());
    for (const auto& [Family, Indices] : FamilyTriangles)
    {
        InstanceRecord Placement{};
        Placement.World[0] = Placement.World[5] = Placement.World[10] = Placement.World[15] = 1.0f;
        Placement.VertexOffset = 0u;
        Placement.FirstIndex = static_cast<uint32_t>(Corners.size());
        Placement.TriangleCount = static_cast<uint32_t>(Indices.size() / 3u);
        Placement.MaterialIndex = static_cast<uint32_t>(Placements.size());
        Placements.push_back(Placement);
        Corners.insert(Corners.end(), Indices.begin(), Indices.end());
        std::cout << "material " << Family << " -> " << Placement.TriangleCount << " triangles\n";
    }
    DistanceFieldStructure Field;
    // These are eight authored material families, not eight separate geometric objects. The capture importer
    //    associates their instance rows with one scene-graph placement; emulate that partition here.
    std::vector<uint32_t> Roots(Placements.size(), 0u);
    if (!Field.Construct(Positions, Corners, Placements, Materials, Roots, Arguments[1]))
    {
        std::cerr << Field.QueryRefusal() << '\n';
        return 1;
    }
    std::cout << "field placements=" << Field.QueryPlacements().size() << " samples=" << Field.QuerySamples().size() << '\n';
    for (const auto& Placement : Field.QueryPlacements())
    {
        if (Placement.Identity[3] == 0u) continue;
        std::cout << "slot " << Placement.Identity[0] << ": " << Placement.Resolution[0] << 'x' << Placement.Resolution[1]
                  << 'x' << Placement.Resolution[2] << ", tolerance=" << Placement.Maximum[3] << '\n';
    }

    RayStatistics Exterior;
    const Vector3 Eye{-7.0f, -6.0f, 2.0f};
    const Vector3 Forward = Normalize(Vector3{0.0f, 0.0f, 0.7f} - Eye);
    const Vector3 Right = Normalize(Cross(Forward, Vector3{0.0f, 0.0f, 1.0f}));
    const Vector3 Up = Normalize(Cross(Right, Forward));
    const float Spread = std::tan(55.0f * 3.14159265f / 360.0f);
    for (uint32_t Y = 0u; Y < 45u; ++Y)
    {
        for (uint32_t X = 0u; X < 80u; ++X)
        {
            const float U = (float(X) + 0.5f) / 80.0f * 2.0f - 1.0f;
            const float V = 1.0f - (float(Y) + 0.5f) / 45.0f * 2.0f;
            Probe(Exterior, Positions, Corners, Field, Eye, Normalize(Forward + Right * (U * Spread * (80.0f/45.0f)) + Up * (V * Spread)));
        }
    }
    Print("exterior", Exterior);
    RayStatistics Underside;
    for (uint32_t Y = 0u; Y < 23u; ++Y)
    {
        for (uint32_t X = 0u; X < 45u; ++X)
        {
            const Vector3 Origin{-2.7f + float(X) * 0.12f, -1.1f + float(Y) * 0.10f, -0.30f};
            Probe(Underside, Positions, Corners, Field, Origin, Vector3{0.0f, 0.0f, 1.0f});
        }
    }
    Print("undercar-vertical", Underside);
    RayStatistics Cabin;
    const Vector3 Interior{0.0f, 0.0f, 0.7f};
    for (uint32_t Elevation = 0u; Elevation < 17u; ++Elevation)
    {
        for (uint32_t Azimuth = 0u; Azimuth < 72u; ++Azimuth)
        {
            const float A = float(Azimuth) * (6.2831853f / 72.0f);
            const float E = (float(Elevation) - 8.0f) * (2.2f / 16.0f);
            const Vector3 Direction{std::cos(E) * std::cos(A), std::cos(E) * std::sin(A), std::sin(E)};
            Probe(Cabin, Positions, Corners, Field, Interior, Direction);
        }
    }
    Print("interior", Cabin);
    // An exact mesh intersection is the reference, not a pixel-perfect SDF guarantee. These limits reject the
    //    original 8×64-material fields (49 exterior / 41 interior misses and 50/202 large depth errors).
    const bool Good = Exterior.Missing <= 5u && Exterior.Extra <= 15u && Exterior.Wrong <= 30u &&
                      Underside.Missing <= 10u && Underside.Wrong <= 30u &&
                      Cabin.Missing <= 10u && Cabin.Wrong <= 15u;
    std::cout << (Good ? "PASS" : "FAIL") << " authored Drive body: grouped field + local-box entry + 192-step march\n";
    return Good ? 0 : 1;
}
