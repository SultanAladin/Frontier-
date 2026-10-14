//============================================================================================================================================
//                                                     DISTANCEFIELDSTRUCTURE.CPP
//============================================================================================================================================
// 📦 Derives a mesh-local lattice once, validates/publishes it to disk, and thereafter updates only placement rows.

#include "DistanceFieldStructure.h"
#include "SceneStructure.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iomanip>
#include <limits>
#include <sstream>

namespace Frontier
{
namespace
{
constexpr uint64_t kDistanceSignature = 0x32464453544E5246ull; // FRNTSDF2, little-endian IEEE binary32
constexpr uint32_t kDistanceRevision = 2u;
constexpr uint32_t kMaximumDimension = 64u;
constexpr float kMinimumCell = 0.10f;                         // [m] import-time local sampling target

struct DistanceFieldFileRecord
{
    uint64_t Signature = kDistanceSignature;
    uint32_t Revision = kDistanceRevision;
    uint32_t FacetCount = 0u;
    uint64_t Fingerprint[2]{};
    float Minimum[4]{};
    float Maximum[4]{};
    uint32_t Resolution[4]{};
    uint64_t Checksum = 0u;
};
static_assert(sizeof(DistanceFieldFileRecord) == 88u);

uint64_t FingerprintBytes(const void* Bytes, size_t Count, uint64_t Seed = 14695981039346656037ull)
{
    const auto* First = static_cast<const unsigned char*>(Bytes);
    for (size_t Index = 0u; Index < Count; ++Index) Seed = (Seed ^ First[Index]) * 1099511628211ull;
    return Seed;
}

std::string FingerprintFacets(const std::vector<DistanceFieldFacet>& Facets, uint64_t (&Fingerprint)[2])
{
    Fingerprint[0] = FingerprintBytes(&kDistanceRevision, sizeof(kDistanceRevision));
    Fingerprint[1] = FingerprintBytes(&kDistanceRevision, sizeof(kDistanceRevision), 7809847782465536322ull);
    for (const auto& Facet : Facets)
        for (const float* Corner : { Facet.Alpha, Facet.Beta, Facet.Gamma })
            for (auto& Digest : Fingerprint) Digest = FingerprintBytes(Corner, 3u * sizeof(float), Digest);
    std::ostringstream Spelling;
    Spelling << std::hex << std::setfill('0') << std::setw(16) << Fingerprint[0] << std::setw(16) << Fingerprint[1];
    return Spelling.str();
}

Vector3 PointFrom(const float* Coordinates) { return { Coordinates[0], Coordinates[1], Coordinates[2] }; }
float Dot(Vector3 Alpha, Vector3 Beta) { return Alpha.x * Beta.x + Alpha.y * Beta.y + Alpha.z * Beta.z; }
float Squared(Vector3 Point) { return Dot(Point, Point); }

Vector3 ClosestSegment(Vector3 Point, Vector3 Alpha, Vector3 Beta)
{
    const Vector3 Edge = Beta - Alpha;
    const float Parameter = std::clamp(Dot(Point - Alpha, Edge) / std::max(Squared(Edge), 1.0e-20f), 0.0f, 1.0f);
    return Alpha + Edge * Parameter;
}

Vector3 ClosestFacet(Vector3 Point, const DistanceFieldFacet& Facet)
{
    const Vector3 Alpha = PointFrom(Facet.Alpha), Beta = PointFrom(Facet.Beta), Gamma = PointFrom(Facet.Gamma);
    const Vector3 EdgeAlpha = Beta - Alpha, EdgeBeta = Gamma - Alpha, ToAlpha = Point - Alpha;
    const float D1 = Dot(EdgeAlpha, ToAlpha), D2 = Dot(EdgeBeta, ToAlpha);
    if (D1 <= 0.0f && D2 <= 0.0f) return Alpha;
    const Vector3 ToBeta = Point - Beta;
    const float D3 = Dot(EdgeAlpha, ToBeta), D4 = Dot(EdgeBeta, ToBeta);
    if (D3 >= 0.0f && D4 <= D3) return Beta;
    const float Vc = D1 * D4 - D3 * D2;
    if (Vc <= 0.0f && D1 >= 0.0f && D3 <= 0.0f) return Alpha + EdgeAlpha * (D1 / std::max(D1 - D3, 1.0e-20f));
    const Vector3 ToGamma = Point - Gamma;
    const float D5 = Dot(EdgeAlpha, ToGamma), D6 = Dot(EdgeBeta, ToGamma);
    if (D6 >= 0.0f && D5 <= D6) return Gamma;
    const float Vb = D5 * D2 - D1 * D6;
    if (Vb <= 0.0f && D2 >= 0.0f && D6 <= 0.0f) return Alpha + EdgeBeta * (D2 / std::max(D2 - D6, 1.0e-20f));
    const float Va = D3 * D6 - D5 * D4;
    if (Va <= 0.0f && D4 - D3 >= 0.0f && D5 - D6 >= 0.0f)
        return Beta + (Gamma - Beta) * ((D4 - D3) / std::max(D4 - D3 + D5 - D6, 1.0e-20f));
    const float Sum = Va + Vb + Vc;
    if (std::fabs(Sum) < 1.0e-20f)
    {
        const Vector3 Candidates[] = { ClosestSegment(Point, Alpha, Beta), ClosestSegment(Point, Beta, Gamma),
                                       ClosestSegment(Point, Gamma, Alpha) };
        Vector3 Closest = Candidates[0];
        for (Vector3 Candidate : Candidates)
            if (Squared(Candidate - Point) < Squared(Closest - Point)) Closest = Candidate;
        return Closest;
    }
    return Alpha + EdgeAlpha * (Vb / Sum) + EdgeBeta * (Vc / Sum);
}

float BoxSquared(Vector3 Point, const float* Minimum, const float* Maximum)
{
    const float Coordinates[] = { Point.x, Point.y, Point.z };
    float Distance = 0.0f;
    for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
    {
        const float Outside = std::max({ Minimum[Axis] - Coordinates[Axis], 0.0f, Coordinates[Axis] - Maximum[Axis] });
        Distance += Outside * Outside;
    }
    return Distance;
}

bool ReadDistanceFile(const std::filesystem::path& Path, const DistanceFieldFileRecord& Expected,
                      std::vector<DistanceFieldVoxelRecord>& Samples)
{
    std::ifstream Stream(Path, std::ios::binary);
    DistanceFieldFileRecord Header;
    if (!Stream.read(reinterpret_cast<char*>(&Header), sizeof(Header)) ||
        std::memcmp(&Header, &Expected, offsetof(DistanceFieldFileRecord, Checksum)) != 0) return false;
    const size_t Count = size_t(Header.Resolution[0]) * Header.Resolution[1] * Header.Resolution[2];
    Samples.resize(Count);
    if (!Stream.read(reinterpret_cast<char*>(Samples.data()), Count * sizeof(Samples[0])) ||
        Stream.peek() != std::char_traits<char>::eof() ||
        FingerprintBytes(Samples.data(), Count * sizeof(Samples[0])) != Header.Checksum) return false;
    for (const auto& Sample : Samples)
        if (!std::isfinite(Sample.Distance) || Sample.Facet >= Header.FacetCount) return false;
    return true;
}

bool PublishDistanceFile(const std::filesystem::path& Path, DistanceFieldFileRecord Header,
                         const std::vector<DistanceFieldVoxelRecord>& Samples)
{
    std::error_code Error;
    std::filesystem::create_directories(Path.parent_path(), Error);
    if (Error) return false;
    Header.Checksum = FingerprintBytes(Samples.data(), Samples.size() * sizeof(Samples[0]));
    const auto Temporary = Path.string() + ".tmp-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count());
    {
        std::ofstream Stream(Temporary, std::ios::binary | std::ios::trunc);
        if (!Stream.write(reinterpret_cast<const char*>(&Header), sizeof(Header)) ||
            !Stream.write(reinterpret_cast<const char*>(Samples.data()), Samples.size() * sizeof(Samples[0])) ||
            !Stream.flush())
        {
            Stream.close();
            std::filesystem::remove(Temporary, Error);
            return false;
        }
        Stream.close();
        if (Stream.fail()) { std::filesystem::remove(Temporary, Error); return false; }
    }
    std::filesystem::rename(Temporary, Path, Error);
    if (Error)
    {
        // Windows does not replace an existing pathname. A concurrent valid publication is already sufficient.
        std::vector<DistanceFieldVoxelRecord> Existing;
        if (ReadDistanceFile(Path, Header, Existing))
        {
            std::filesystem::remove(Temporary, Error);
            return true;
        }
        std::filesystem::remove(Path, Error);         // only a refused/corrupt artifact is replaced
        Error.clear();
        std::filesystem::rename(Temporary, Path, Error);
    }
    if (!Error) return true;
    std::filesystem::remove(Temporary, Error);
    return false;
}
}

DistanceFieldStructure::DistanceFieldStructure() = default;
DistanceFieldStructure::~DistanceFieldStructure() = default;

bool DistanceFieldStructure::Construct(const SceneStructure& Scene)
{
    const char* Storage = std::getenv("FRONTIER_DISTANCE_FIELD_ROOT");
    return Construct(Scene.QueryVertices(), Scene.QueryIndices(), Scene.QueryInstances(), Scene.QueryMaterials().QueryRecords(),
                     Storage && *Storage ? Storage : "Build/Derived/DistanceFields");
}

bool DistanceFieldStructure::Construct(const std::vector<VertexRecord>& Positions, const std::vector<uint32_t>& Corners,
                                      const std::vector<InstanceRecord>& Rows, const std::vector<MaterialRecord>& Reflectance,
                                      const std::filesystem::path& Storage)
{
    Facets.clear(); Branches.clear(); Samples.clear(); Placements.clear(); Contents.clear(); Refusal.clear();
    Instances = Rows; Materials = Reflectance; CacheMetrics = {};
    ++Revision; ++PlacementRevision; ++CaptureRevision;
    if (Rows.empty()) { Refusal = "distance fields require at least one mesh placement"; return false; }
    for (uint32_t Slot = 0u; Slot < Rows.size(); ++Slot)
    {
        const auto& Row = Rows[Slot];
        if (!Row.TriangleCount || Row.MaterialIndex >= Reflectance.size())
        { Refusal = "distance-field placement has no facets or no material"; return false; }
        std::vector<DistanceFieldFacet> Input(Row.TriangleCount);
        for (uint32_t Primitive = 0u; Primitive < Row.TriangleCount; ++Primitive)
        {
            auto& Facet = Input[Primitive];
            float* Destinations[] = { Facet.Alpha, Facet.Beta, Facet.Gamma };
            for (uint32_t Corner = 0u; Corner < 3u; ++Corner)
            {
                const size_t Index = size_t(Row.FirstIndex) + size_t(Primitive) * 3u + Corner;
                if (Index >= Corners.size() || size_t(Corners[Index]) + Row.VertexOffset >= Positions.size())
                { Refusal = "distance-field mesh contains an out-of-range corner"; return false; }
                const auto& Position = Positions[Corners[Index] + Row.VertexOffset].SpatialLocation;
                const float Coordinates[] = { Position.x, Position.y, Position.z };
                for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
                {
                    if (!std::isfinite(Coordinates[Axis])) { Refusal = "distance-field mesh is not finite"; return false; }
                    Destinations[Corner][Axis] = Coordinates[Axis];
                }
            }
            std::memcpy(&Facet.Beta[3], &Primitive, sizeof(Primitive));
        }
        uint64_t Fingerprint[2];
        const std::string Key = FingerprintFacets(Input, Fingerprint);
        auto Found = Contents.find(Key);
        if (Found == Contents.end())
        {
            DistanceFieldContentRecord Content;
            if (!ConstructPartition(std::move(Input), Storage, Content)) return false;
            Found = Contents.emplace(Key, std::move(Content)).first;
        }
        else ++CacheMetrics.SharedPlacements;
        const auto& Content = Found->second;
        DistanceFieldPlacementRecord Placement;
        std::copy_n(Content.Minimum, 3u, Placement.Minimum);
        std::copy_n(Content.Maximum, 3u, Placement.Maximum);
        std::copy_n(Content.Resolution, 3u, Placement.Resolution);
        Placement.Resolution[3] = Content.FirstSample;
        Placement.Identity[0] = Slot;
        Placement.Identity[1] = static_cast<uint32_t>(Facets.size());
        Placement.Identity[2] = static_cast<uint32_t>(Content.Facets.size());
        if (!ProjectPlacement(Slot, Row, Placement)) { Refusal = "distance-field placement is singular or not finite"; return false; }
        Placements.push_back(Placement);
        for (auto Facet : Content.Facets)
        {
            std::memcpy(&Facet.Alpha[3], &Slot, sizeof(Slot));
            const auto& Material = Reflectance[Row.MaterialIndex];
            Facet.Albedo[0] = Material.AlbedoR * (1.0f - Material.Metalness);
            Facet.Albedo[1] = Material.AlbedoG * (1.0f - Material.Metalness);
            Facet.Albedo[2] = Material.AlbedoB * (1.0f - Material.Metalness);
            Facet.Emission[0] = Material.EmissiveR; Facet.Emission[1] = Material.EmissiveG; Facet.Emission[2] = Material.EmissiveB;
            Facets.push_back(Facet);
        }
    }
    return true;
}

bool DistanceFieldStructure::Construct(std::vector<DistanceFieldFacet> Input)
{
    std::vector<VertexRecord> Positions;
    std::vector<uint32_t> Corners;
    for (const auto& Facet : Input)
        for (const float* Corner : { Facet.Alpha, Facet.Beta, Facet.Gamma })
        {
            VertexRecord Position{};
            Position.SpatialLocation = PointFrom(Corner);
            Positions.push_back(Position);
            Corners.push_back(static_cast<uint32_t>(Corners.size()));
        }
    InstanceRecord Row{};
    Row.World[0] = Row.World[5] = Row.World[10] = Row.World[15] = 1.0f;
    Row.TriangleCount = static_cast<uint32_t>(Input.size());
    MaterialRecord Material{};
    if (!Input.empty())
    {
        Material.AlbedoR = Input[0].Albedo[0]; Material.AlbedoG = Input[0].Albedo[1]; Material.AlbedoB = Input[0].Albedo[2];
        Material.EmissiveR = Input[0].Emission[0]; Material.EmissiveG = Input[0].Emission[1]; Material.EmissiveB = Input[0].Emission[2];
    }
    return Construct(Positions, Corners, { Row }, { Material });
}

bool DistanceFieldStructure::ConstructPartition(std::vector<DistanceFieldFacet> Input, const std::filesystem::path& Storage,
                                               DistanceFieldContentRecord& Content)
{
    DistanceFieldFileRecord Header;
    Header.FacetCount = static_cast<uint32_t>(Input.size());
    const std::string Key = FingerprintFacets(Input, Header.Fingerprint);
    DistanceFieldStructure Import;
    Import.Facets = std::move(Input);
    for (auto& Facet : Import.Facets)
    {
        const Vector3 Alpha = PointFrom(Facet.Beta) - PointFrom(Facet.Alpha);
        const Vector3 Beta = PointFrom(Facet.Gamma) - PointFrom(Facet.Alpha);
        Vector3 Normal{ Alpha.y * Beta.z - Alpha.z * Beta.y, Alpha.z * Beta.x - Alpha.x * Beta.z,
                        Alpha.x * Beta.y - Alpha.y * Beta.x };
        const float Length = std::sqrt(Squared(Normal));
        if (!std::isfinite(Length)) { Refusal = "distance-field facet extent overflows binary32"; return false; }
        Normal = Length > 1.0e-10f ? Normal / Length : Vector3{ 0.0f, 0.0f, 1.0f };
        Facet.Normal[0] = Normal.x; Facet.Normal[1] = Normal.y; Facet.Normal[2] = Normal.z;
    }
    Import.Linearize(0u, Header.FacetCount);
    const auto& Root = Import.Branches[0];
    float Longest = 0.0f;
    for (uint32_t Axis = 0u; Axis < 3u; ++Axis) Longest = std::max(Longest, Root.Maximum[Axis] - Root.Minimum[Axis]);
    const float Cell = std::max(kMinimumCell, Longest / float(kMaximumDimension - 2u));
    for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
    {
        Header.Minimum[Axis] = Root.Minimum[Axis] - kMinimumCell * 1.5f;
        Header.Maximum[Axis] = Root.Maximum[Axis] + kMinimumCell * 1.5f;
        const float Span = Header.Maximum[Axis] - Header.Minimum[Axis];
        if (!std::isfinite(Span) || Span <= 0.0f) { Refusal = "distance-field lattice extent is invalid"; return false; }
        Header.Resolution[Axis] = static_cast<uint32_t>(std::clamp(std::ceil(Span / Cell) + 1.0f, 4.0f, float(kMaximumDimension)));
    }
    std::vector<DistanceFieldVoxelRecord> Partition;
    const auto Path = Storage / (Key + ".sdf");
    if (ReadDistanceFile(Path, Header, Partition)) ++CacheMetrics.FileHits;
    else
    {
        const uint32_t XCount = Header.Resolution[0], YCount = Header.Resolution[1], ZCount = Header.Resolution[2];
        Partition.resize(size_t(XCount) * YCount * ZCount);
        for (uint32_t Z = 0u; Z < ZCount; ++Z)
            for (uint32_t Y = 0u; Y < YCount; ++Y)
                for (uint32_t X = 0u; X < XCount; ++X)
                {
                    Vector3 Point;
                    float* Coordinates[] = { &Point.x, &Point.y, &Point.z };
                    const uint32_t Coordinate[] = { X, Y, Z };
                    for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
                        *Coordinates[Axis] = Header.Minimum[Axis] + (Header.Maximum[Axis] - Header.Minimum[Axis]) *
                                             float(Coordinate[Axis]) / float(Header.Resolution[Axis] - 1u);
                    float NearestSquared = std::numeric_limits<float>::max();
                    uint32_t Nearest = 0u;
                    Vector3 NearestPoint;
                    for (uint32_t Branch = 0u; Branch < Import.Branches.size();)
                    {
                        const auto& Bounds = Import.Branches[Branch];
                        if (BoxSquared(Point, Bounds.Minimum, Bounds.Maximum) > NearestSquared) { Branch = Bounds.Escape; continue; }
                        for (uint32_t Index = Bounds.First; Index < Bounds.First + Bounds.Count; ++Index)
                        {
                            const Vector3 Closest = ClosestFacet(Point, Import.Facets[Index]);
                            const float Distance = Squared(Point - Closest);
                            if (Distance < NearestSquared) { NearestSquared = Distance; Nearest = Index; NearestPoint = Closest; }
                        }
                        ++Branch;
                    }
                    float Distance = std::sqrt(NearestSquared);
                    if (Dot(Point - NearestPoint, PointFrom(Import.Facets[Nearest].Normal)) < 0.0f) Distance = -Distance;
                    if (!std::isfinite(Distance)) { Refusal = "distance-field sample extent is not finite"; return false; }
                    uint32_t Primitive;
                    std::memcpy(&Primitive, &Import.Facets[Nearest].Beta[3], sizeof(Primitive));
                    Partition[(size_t(Z) * YCount + Y) * XCount + X] = { Distance, Primitive };
                }
        if (!PublishDistanceFile(Path, Header, Partition))
        { Refusal = "distance-field artifact could not be published: " + Path.string(); return false; }
        ++CacheMetrics.Constructed;
    }
    if (Samples.size() + Partition.size() > std::numeric_limits<uint32_t>::max())
    { Refusal = "distance-field sample addressing exceeds 32 bits"; return false; }
    std::copy_n(Header.Minimum, 3u, Content.Minimum);
    std::copy_n(Header.Maximum, 3u, Content.Maximum);
    std::copy_n(Header.Resolution, 3u, Content.Resolution);
    Content.FirstSample = static_cast<uint32_t>(Samples.size());
    // Persist authored primitive identity, not nth_element's platform-dependent leaf permutation.
    Content.Facets.resize(Import.Facets.size());
    for (const auto& Facet : Import.Facets)
    {
        uint32_t Primitive;
        std::memcpy(&Primitive, &Facet.Beta[3], sizeof(Primitive));
        Content.Facets[Primitive] = Facet;
    }
    Samples.insert(Samples.end(), Partition.begin(), Partition.end());
    return true;
}

bool DistanceFieldStructure::ProjectPlacement(uint32_t Slot, const InstanceRecord& Row, DistanceFieldPlacementRecord& Placement) const
{
    (void)Slot;
    for (float Coordinate : Row.World) if (!std::isfinite(Coordinate)) return false;
    if (std::fabs(Row.World[3]) > 1.0e-6f || std::fabs(Row.World[7]) > 1.0e-6f ||
        std::fabs(Row.World[11]) > 1.0e-6f || std::fabs(Row.World[15] - 1.0f) > 1.0e-6f) return false;
    const float* World = Row.World;
    const double A = World[0], B = World[4], C = World[8], D = World[1], E = World[5], F = World[9];
    const double G = World[2], H = World[6], I = World[10];
    const double Determinant = A * (E * I - F * H) - B * (D * I - F * G) + C * (D * H - E * G);
    if (!std::isfinite(Determinant) || std::fabs(Determinant) < 1.0e-12) return false;
    const double Inverse[] = { (E * I - F * H), (F * G - D * I), (D * H - E * G),
                               (C * H - B * I), (A * I - C * G), (B * G - A * H),
                               (B * F - C * E), (C * D - A * F), (A * E - B * D) };
    float* Local = Placement.WorldToLocal;
    std::fill_n(Local, 16u, 0.0f);
    double FrobeniusSquared = 0.0;
    for (uint32_t Column = 0u; Column < 3u; ++Column)
        for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
        {
            const float Coordinate = static_cast<float>(Inverse[Column * 3u + Axis] / Determinant);
            if (!std::isfinite(Coordinate)) return false;
            Local[Column * 4u + Axis] = Coordinate;
            FrobeniusSquared += double(Coordinate) * Coordinate;
        }
    Local[15] = 1.0f;
    for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
    {
        Local[12u + Axis] = -(Local[Axis] * World[12] + Local[4u + Axis] * World[13] + Local[8u + Axis] * World[14]);
        if (!std::isfinite(Local[12u + Axis])) return false;
    }
    std::copy_n(World, 16u, Placement.LocalToWorld);
    // 1 / ||A^-1||F is a lower bound on the smallest singular value, including shear and mirrored placements.
    Placement.Minimum[3] = static_cast<float>(1.0 / std::sqrt(FrobeniusSquared));
    if (!std::isfinite(Placement.Minimum[3]) || Placement.Minimum[3] <= 0.0f) return false;
    float MinimumCell = std::numeric_limits<float>::max();
    for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
        MinimumCell = std::min(MinimumCell, (Placement.Maximum[Axis] - Placement.Minimum[Axis]) /
                                          float(Placement.Resolution[Axis] - 1u));
    // The march's surface tolerance, world metres. A third of the finest cell, bounded above: a 480 m ground slab
    //    at the 64-cell cap has 0.6 m cells, and a 0.21 m tolerance lifted every gather ray's origin 0.63 m off the
    //    ground — above the underside of a car — so the sky leaked under everything (CI capture
    //    sdf-gi-exterior-skyfrac, before). Capped, the ground's own trilinear plane is still exact.
    static const float ToleranceCap = []{ const char* Value = std::getenv("FRONTIER_SDF_TOLERANCE_CAP"); return Value ? static_cast<float>(std::atof(Value)) : 0.04f; }();   // CI bisect hook
    Placement.Maximum[3] = std::clamp(MinimumCell * Placement.Minimum[3] * 0.35f, 0.002f, std::max(ToleranceCap, 0.002f));
    for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
    {
        Placement.WorldMinimum[Axis] = std::numeric_limits<float>::max();
        Placement.WorldMaximum[Axis] = -std::numeric_limits<float>::max();
    }
    for (uint32_t Corner = 0u; Corner < 8u; ++Corner)
        for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
        {
            float Coordinate = World[12u + Axis];
            for (uint32_t Column = 0u; Column < 3u; ++Column)
                Coordinate += World[Column * 4u + Axis] *
                              ((Corner & (1u << Column)) ? Placement.Maximum[Column] : Placement.Minimum[Column]);
            if (!std::isfinite(Coordinate)) return false;
            Placement.WorldMinimum[Axis] = std::min(Placement.WorldMinimum[Axis], Coordinate);
            Placement.WorldMaximum[Axis] = std::max(Placement.WorldMaximum[Axis], Coordinate);
        }
    return true;
}

bool DistanceFieldStructure::RefreshInstances(const InstanceRecord* Rows, uint32_t Count)
{
    if (!Rows || Count != Instances.size() || Count != Placements.size()) return false;
    bool Changed = false, ReflectanceChanged = false;
    std::vector<DistanceFieldPlacementRecord> Projected = Placements;
    for (uint32_t Slot = 0u; Slot < Count; ++Slot)
    {
        if (Rows[Slot].TriangleCount != Instances[Slot].TriangleCount || Rows[Slot].FirstIndex != Instances[Slot].FirstIndex ||
            Rows[Slot].VertexOffset != Instances[Slot].VertexOffset || Rows[Slot].MaterialIndex >= Materials.size()) return false;
        if (std::memcmp(Rows[Slot].World, Instances[Slot].World, sizeof(Rows[Slot].World)) != 0)
        {
            if (!ProjectPlacement(Slot, Rows[Slot], Projected[Slot])) return false;
            Changed = true;
        }
        ReflectanceChanged |= Rows[Slot].MaterialIndex != Instances[Slot].MaterialIndex;
    }
    Placements.swap(Projected);
    Instances.assign(Rows, Rows + Count);
    if (Changed) ++PlacementRevision;
    if (ReflectanceChanged) ++CaptureRevision;
    return true;
}

bool DistanceFieldStructure::RefreshReflectance(const SceneStructure& Scene)
{
    Materials = Scene.QueryMaterials().QueryRecords();
    if (!RefreshInstances(Scene.QueryInstances().data(), static_cast<uint32_t>(Scene.QueryInstances().size()))) return false;
    ++CaptureRevision;
    return true;
}

float DistanceFieldStructure::SampleDistance(uint32_t Slot, Vector3 World) const noexcept
{
    if (Slot >= Placements.size()) return std::numeric_limits<float>::max();
    const auto& Placement = Placements[Slot];
    float Point[3];
    for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
        Point[Axis] = Placement.WorldToLocal[Axis] * World.x + Placement.WorldToLocal[4u + Axis] * World.y +
                      Placement.WorldToLocal[8u + Axis] * World.z + Placement.WorldToLocal[12u + Axis];
    uint32_t First[3];
    float Fraction[3];
    for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
    {
        const float Coordinate = std::clamp((Point[Axis] - Placement.Minimum[Axis]) /
                                (Placement.Maximum[Axis] - Placement.Minimum[Axis]) * float(Placement.Resolution[Axis] - 1u),
                                0.0f, float(Placement.Resolution[Axis] - 1u));
        First[Axis] = std::min(static_cast<uint32_t>(Coordinate), Placement.Resolution[Axis] - 2u);
        Fraction[Axis] = Coordinate - float(First[Axis]);
    }
    float Distance = 0.0f;
    for (uint32_t Corner = 0u; Corner < 8u; ++Corner)
    {
        uint32_t Coordinate[3];
        float Weight = 1.0f;
        for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
        {
            const bool Upper = (Corner & (1u << Axis)) != 0u;
            Coordinate[Axis] = First[Axis] + (Upper ? 1u : 0u);
            Weight *= Upper ? Fraction[Axis] : 1.0f - Fraction[Axis];
        }
        const uint32_t Index = Placement.Resolution[3] +
                              (Coordinate[2] * Placement.Resolution[1] + Coordinate[1]) * Placement.Resolution[0] + Coordinate[0];
        Distance += Samples[Index].Distance * Weight;
    }
    return Distance * Placement.Minimum[3];
}

void DistanceFieldStructure::Linearize(uint32_t First, uint32_t Count)
{
    DistanceFieldBranch Branch{};
    for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
    {
        Branch.Minimum[Axis] = std::numeric_limits<float>::max();
        Branch.Maximum[Axis] = -std::numeric_limits<float>::max();
        for (uint32_t Index = First; Index < First + Count; ++Index)
        {
            const auto& Facet = Facets[Index];
            Branch.Minimum[Axis] = std::min({Branch.Minimum[Axis], Facet.Alpha[Axis], Facet.Beta[Axis], Facet.Gamma[Axis]});
            Branch.Maximum[Axis] = std::max({Branch.Maximum[Axis], Facet.Alpha[Axis], Facet.Beta[Axis], Facet.Gamma[Axis]});
        }
    }
    const uint32_t Slot = static_cast<uint32_t>(Branches.size());
    Branches.push_back(Branch);
    if (Count <= 4u)
    {
        Branches[Slot].First = First;
        Branches[Slot].Count = Count;
    }
    else
    {
        uint32_t Axis = 0u;
        for (uint32_t Candidate = 1u; Candidate < 3u; ++Candidate)
            if (Branch.Maximum[Candidate]-Branch.Minimum[Candidate] > Branch.Maximum[Axis]-Branch.Minimum[Axis]) Axis = Candidate;
        const uint32_t Half = Count / 2u;
        std::nth_element(Facets.begin()+First, Facets.begin()+First+Half, Facets.begin()+First+Count,
            [Axis](const auto& Alpha, const auto& Beta)
            {
                return Alpha.Alpha[Axis]+Alpha.Beta[Axis]+Alpha.Gamma[Axis] < Beta.Alpha[Axis]+Beta.Beta[Axis]+Beta.Gamma[Axis];
            });
        Linearize(First, Half);
        Linearize(First+Half, Count-Half);
    }
    Branches[Slot].Escape = static_cast<uint32_t>(Branches.size());
}
}
