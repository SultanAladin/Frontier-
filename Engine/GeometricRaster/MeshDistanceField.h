//============================================================================================================================================
//                                                    MESHDISTANCEFIELD.H
//============================================================================================================================================
// 📦 Per-mesh signed distance fields baked at import time, plus the CPU mirror of how an instance samples one and how clipmap cells
//    become dirty. Header-only so the bake tool, the engine and the CPU proof all run the same arithmetic.
//
// Runtime rule: nothing in this header is called per frame to build a field. The bake runs once per unique mesh, in the import
// tool, and the result is cached on disk under a hash of its source and resolution. At runtime an instance samples its mesh field
// through its inverse world matrix, so moving it changes its transform and never its field.
//
// Layout of a .fsdf file (little-endian):
//   Header (48 bytes): Magic 'FSDF', Version, Resolution, Reserved, Min[3], Max[3], ContentHash (FNV-1a 64 of source + resolution)
//   Resolution^3 float32 distances, X fastest. Negative inside, positive outside.

#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <string>
#include <vector>

namespace MeshDistanceField
{
inline constexpr uint32_t FileMagic   = 0x46534446u;   // 'FSDF'
inline constexpr uint32_t FileVersion = 1u;

struct Header
{
    uint32_t Magic = FileMagic, Version = FileVersion, Resolution = 0u, Reserved = 0u;
    float    Min[3]{}, Max[3]{};
    uint64_t ContentHash = 0u;
};
static_assert(sizeof(Header) == 48u, "Header layout is part of the .fsdf file format");

struct Field
{
    Header            H{};
    std::vector<float> Distance;   // Resolution^3, X fastest
};

struct Triangle
{
    float V[3][3];
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   SMALL VECTOR MATH
//------------------------------------------------------------------------------------------------------------------------
inline void Sub(const float A[3], const float B[3], float Out[3]) noexcept { for (int I = 0; I < 3; ++I) Out[I] = A[I] - B[I]; }
inline float Dot(const float A[3], const float B[3]) noexcept { return A[0] * B[0] + A[1] * B[1] + A[2] * B[2]; }
inline void  Cross(const float A[3], const float B[3], float Out[3]) noexcept
{
    Out[0] = A[1] * B[2] - A[2] * B[1];
    Out[1] = A[2] * B[0] - A[0] * B[2];
    Out[2] = A[0] * B[1] - A[1] * B[0];
}

//------------------------------------------------------------------------------------------------------------------------
//                                    CLOSEST POINT ON TRIANGLE (Ericson, Real-Time Collision Detection 5.1.5)
//------------------------------------------------------------------------------------------------------------------------
inline void ClosestOnTriangle(const float P[3], const float A[3], const float B[3], const float C[3], float Out[3]) noexcept
{
    float AB[3], AC[3], AP[3], BP[3], CP[3];
    Sub(B, A, AB); Sub(C, A, AC); Sub(P, A, AP);
    const float D1 = Dot(AB, AP), D2 = Dot(AC, AP);
    if (D1 <= 0.0f && D2 <= 0.0f) { std::memcpy(Out, A, 12); return; }
    Sub(P, B, BP);
    const float D3 = Dot(AB, BP), D4 = Dot(AC, BP);
    if (D3 >= 0.0f && D4 <= D3) { std::memcpy(Out, B, 12); return; }
    const float VC = D1 * D4 - D3 * D2;
    if (VC <= 0.0f && D1 >= 0.0f && D3 <= 0.0f)
    {
        const float V = D1 / (D1 - D3);
        for (int I = 0; I < 3; ++I) Out[I] = A[I] + V * AB[I];
        return;
    }
    Sub(P, C, CP);
    const float D5 = Dot(AB, CP), D6 = Dot(AC, CP);
    if (D6 >= 0.0f && D5 <= D6) { std::memcpy(Out, C, 12); return; }
    const float VB = D5 * D2 - D1 * D6;
    if (VB <= 0.0f && D2 >= 0.0f && D6 <= 0.0f)
    {
        const float W = D2 / (D2 - D6);
        for (int I = 0; I < 3; ++I) Out[I] = A[I] + W * AC[I];
        return;
    }
    const float VA = D3 * D6 - D5 * D4;
    if (VA <= 0.0f && (D4 - D3) >= 0.0f && (D5 - D6) >= 0.0f)
    {
        const float W = (D4 - D3) / ((D4 - D3) + (D5 - D6));
        for (int I = 0; I < 3; ++I) Out[I] = B[I] + W * (C[I] - B[I]);
        return;
    }
    const float Denom = 1.0f / (VA + VB + VC);
    const float V = VB * Denom, W = VC * Denom;
    for (int I = 0; I < 3; ++I) Out[I] = A[I] + AB[I] * V + AC[I] * W;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        BAKE
//------------------------------------------------------------------------------------------------------------------------
// Exact signed distance at every grid node, brute force over triangles. Runs in the import tool only (cost is
// Resolution^3 x triangles). Sign comes from the closest triangle's face normal, the same convention the device construct uses:
// correct for closed, consistently wound meshes, and the sign can flip for points that sit exactly on an edge.
// Number of bakes run in this process. The runtime loader never bakes, and the proof checks this counter stays put at runtime.
inline uint64_t& BakeCallCount() noexcept
{
    static uint64_t Count = 0u;
    return Count;
}

inline Field Bake(const std::vector<Triangle>& Tris, uint32_t Resolution, float PadFraction, uint64_t ContentHash)
{
    ++BakeCallCount();
    Field F;
    F.H.Resolution  = Resolution;
    F.H.ContentHash = ContentHash;
    if (Tris.empty() || Resolution < 2u) return F;
    float Lo[3] = { 1e30f, 1e30f, 1e30f }, Hi[3] = { -1e30f, -1e30f, -1e30f };
    for (const Triangle& T : Tris)
        for (const auto& V : T.V)
            for (int A = 0; A < 3; ++A) { Lo[A] = std::min(Lo[A], V[A]); Hi[A] = std::max(Hi[A], V[A]); }
    float Extent = 0.0f;
    for (int A = 0; A < 3; ++A) Extent = std::max(Extent, Hi[A] - Lo[A]);
    const float Pad = std::max(PadFraction * Extent, 1e-4f);
    for (int A = 0; A < 3; ++A) { F.H.Min[A] = Lo[A] - Pad; F.H.Max[A] = Hi[A] + Pad; }

    const uint32_t N = Resolution;
    F.Distance.assign(size_t(N) * N * N, 0.0f);
    for (uint32_t Z = 0; Z < N; ++Z)
        for (uint32_t Y = 0; Y < N; ++Y)
            for (uint32_t X = 0; X < N; ++X)
            {
                float P[3];
                const uint32_t Index[3] = { X, Y, Z };
                for (int A = 0; A < 3; ++A)
                    P[A] = F.H.Min[A] + (F.H.Max[A] - F.H.Min[A]) * float(Index[A]) / float(N - 1u);
                float Best = 1e30f, Sign = 1.0f;
                for (const Triangle& T : Tris)
                {
                    float Q[3];
                    ClosestOnTriangle(P, T.V[0], T.V[1], T.V[2], Q);
                    float D[3]; Sub(P, Q, D);
                    const float Squared = Dot(D, D);
                    if (Squared < Best * Best)
                    {
                        Best = std::sqrt(Squared);
                        float E1[3], E2[3], Normal[3];
                        Sub(T.V[1], T.V[0], E1); Sub(T.V[2], T.V[0], E2); Cross(E1, E2, Normal);
                        Sign = Dot(D, Normal) < 0.0f ? -1.0f : 1.0f;
                    }
                }
                F.Distance[size_t(Z) * N * N + size_t(Y) * N + X] = Sign * Best;
            }
    return F;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     FILE FORMAT
//------------------------------------------------------------------------------------------------------------------------
inline bool Save(const Field& F, const std::string& Path)
{
    std::FILE* File = std::fopen(Path.c_str(), "wb");
    if (!File) return false;
    const bool Ok = std::fwrite(&F.H, sizeof(Header), 1, File) == 1 &&
                    std::fwrite(F.Distance.data(), sizeof(float), F.Distance.size(), File) == F.Distance.size();
    return std::fclose(File) == 0 && Ok;
}

inline bool Load(const std::string& Path, Field& Out)
{
    std::FILE* File = std::fopen(Path.c_str(), "rb");
    if (!File) return false;
    Field F;
    bool Ok = std::fread(&F.H, sizeof(Header), 1, File) == 1 && F.H.Magic == FileMagic && F.H.Version == FileVersion;
    if (Ok)
    {
        const size_t Count = size_t(F.H.Resolution) * F.H.Resolution * F.H.Resolution;
        F.Distance.resize(Count);
        Ok = std::fread(F.Distance.data(), sizeof(float), Count, File) == Count;
    }
    std::fclose(File);
    if (Ok) Out = std::move(F);
    return Ok;
}

// FNV-1a 64 over bytes, used for the content hash that names the cache file.
inline uint64_t Fnv1a(const void* Data, size_t Bytes, uint64_t Seed = 1469598103934665603ull) noexcept
{
    uint64_t H = Seed;
    const unsigned char* P = static_cast<const unsigned char*>(Data);
    for (size_t I = 0; I < Bytes; ++I) { H ^= P[I]; H *= 1099511628211ull; }
    return H;
}

// Hash that names a cache entry: source bytes, resolution, padding and format version. Any change to any input changes it.
inline uint64_t SourceHash(const std::string& Bytes, uint32_t Resolution, float Padding) noexcept
{
    uint64_t H = Fnv1a(Bytes.data(), Bytes.size());
    H = Fnv1a(&Resolution, sizeof(Resolution), H);
    H = Fnv1a(&Padding, sizeof(Padding), H);
    H = Fnv1a(&FileVersion, sizeof(FileVersion), H);
    return H;
}

inline bool ReadAll(const std::string& Path, std::string& Out)
{
    std::FILE* File = std::fopen(Path.c_str(), "rb");
    if (!File) return false;
    Out.clear();
    char Buffer[4096];
    size_t Read;
    while ((Read = std::fread(Buffer, 1, sizeof(Buffer), File)) > 0) Out.append(Buffer, Read);
    std::fclose(File);
    return true;
}

// Reads a Wavefront OBJ: positive or negative 'v' indices, fan triangulation of 'f'. Returns false on unreadable input.
inline bool LoadObj(const std::string& Path, std::vector<Triangle>& Tris, std::string* SourceBytes = nullptr)
{
    std::FILE* File = std::fopen(Path.c_str(), "rb");
    if (!File) return false;
    std::string Text;
    char Buffer[4096];
    size_t Read;
    while ((Read = std::fread(Buffer, 1, sizeof(Buffer), File)) > 0) Text.append(Buffer, Read);
    std::fclose(File);
    if (SourceBytes) *SourceBytes = Text;

    std::vector<std::array<float, 3>> Vertices;
    size_t Pos = 0;
    while (Pos < Text.size())
    {
        size_t End = Text.find('\n', Pos);
        if (End == std::string::npos) End = Text.size();
        const std::string Line = Text.substr(Pos, End - Pos);
        Pos = End + 1;
        if (Line.size() > 2 && Line[0] == 'v' && Line[1] == ' ')
        {
            float X, Y, Z;
            if (std::sscanf(Line.c_str() + 2, "%f %f %f", &X, &Y, &Z) == 3) Vertices.push_back({ X, Y, Z });
        }
        else if (Line.size() > 2 && Line[0] == 'f' && Line[1] == ' ')
        {
            std::vector<long> Indices;
            const char* Cursor = Line.c_str() + 2;
            while (*Cursor)
            {
                while (*Cursor == ' ' || *Cursor == '\t' || *Cursor == '\r') ++Cursor;
                if (!*Cursor) break;
                char* Next = nullptr;
                const long Index = std::strtol(Cursor, &Next, 10);
                if (Next == Cursor) break;
                Indices.push_back(Index);
                Cursor = Next;
                while (*Cursor && *Cursor != ' ' && *Cursor != '\t' && *Cursor != '\r') ++Cursor;   // skip /vt/vn
            }
            for (size_t K = 1; K + 1 < Indices.size(); ++K)
            {
                Triangle T{};
                const long Corners[3] = { Indices[0], Indices[K], Indices[K + 1] };
                for (int C = 0; C < 3; ++C)
                {
                    const long Raw = Corners[C];
                    const long Idx = Raw > 0 ? Raw - 1 : long(Vertices.size()) + Raw;
                    if (Idx < 0 || Idx >= long(Vertices.size())) return false;
                    for (int A = 0; A < 3; ++A) T.V[C][A] = Vertices[size_t(Idx)][A];
                }
                Tris.push_back(T);
            }
        }
    }
    return !Tris.empty();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  RUNTIME SAMPLING
//------------------------------------------------------------------------------------------------------------------------
// Trilinear sample of a field at a point given in the field's own (local) space. The surface lies inside the bounds, so outside
// them the distance to the surface is at least the gap to the bounds, and (the field being 1-Lipschitz) at least the clamped
// value minus the gap. The larger of the two is a conservative lower bound for sphere tracing.
inline float SampleLocal(const Field& F, const float P[3]) noexcept
{
    const uint32_t N = F.H.Resolution;
    if (N < 2u || F.Distance.empty()) return 1e30f;
    float Clamped[3], Outside = 0.0f, Grid[3];
    for (int A = 0; A < 3; ++A)
    {
        Clamped[A] = std::min(std::max(P[A], F.H.Min[A]), F.H.Max[A]);
        const float Gap = Clamped[A] - P[A];
        Outside += Gap * Gap;
        Grid[A] = (Clamped[A] - F.H.Min[A]) / (F.H.Max[A] - F.H.Min[A]) * float(N - 1u);
    }
    uint32_t I0[3]; float Fr[3];
    for (int A = 0; A < 3; ++A)
    {
        const float G = std::min(Grid[A], float(N - 1u) - 1e-4f);
        I0[A] = uint32_t(std::max(G, 0.0f));
        Fr[A] = G - float(I0[A]);
    }
    auto At = [&](uint32_t X, uint32_t Y, uint32_t Z) { return F.Distance[size_t(Z) * N * N + size_t(Y) * N + X]; };
    float Accum = 0.0f;
    for (int Corner = 0; Corner < 8; ++Corner)
    {
        const uint32_t Dx = Corner & 1, Dy = (Corner >> 1) & 1, Dz = (Corner >> 2) & 1;
        const float Weight = (Dx ? Fr[0] : 1.0f - Fr[0]) * (Dy ? Fr[1] : 1.0f - Fr[1]) * (Dz ? Fr[2] : 1.0f - Fr[2]);
        Accum += Weight * At(I0[0] + Dx, I0[1] + Dy, I0[2] + Dz);
    }
    const float Gap = std::sqrt(Outside);
    return Gap > 0.0f ? std::max(Gap, Accum - Gap) : Accum;
}

// Affine instance transform in the engine's column-major layout (World[0..2] X column, [4..6] Y, [8..10] Z, [12..14] translation).
struct Affine
{
    float Inverse[9];   // row-major inverse of the 3x3 part
    float InverseTranslation[3];
    float MinScale;     // smallest axis stretch: world distance = local distance * stretch, so this is a conservative lower bound
};

inline bool MakeAffine(const float World[16], Affine& Out) noexcept
{
    float M[3][3];
    for (int Row = 0; Row < 3; ++Row)
        for (int Col = 0; Col < 3; ++Col) M[Row][Col] = World[4 * Col + Row];
    const float T[3] = { World[12], World[13], World[14] };
    const float Det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
                      M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    if (std::fabs(Det) < 1e-12f) return false;
    const float InvDet = 1.0f / Det;
    float Inv[3][3];
    Inv[0][0] = (M[1][1] * M[2][2] - M[1][2] * M[2][1]) * InvDet;
    Inv[0][1] = (M[0][2] * M[2][1] - M[0][1] * M[2][2]) * InvDet;
    Inv[0][2] = (M[0][1] * M[1][2] - M[0][2] * M[1][1]) * InvDet;
    Inv[1][0] = (M[1][2] * M[2][0] - M[1][0] * M[2][2]) * InvDet;
    Inv[1][1] = (M[0][0] * M[2][2] - M[0][2] * M[2][0]) * InvDet;
    Inv[1][2] = (M[0][2] * M[1][0] - M[0][0] * M[1][2]) * InvDet;
    Inv[2][0] = (M[1][0] * M[2][1] - M[1][1] * M[2][0]) * InvDet;
    Inv[2][1] = (M[0][1] * M[2][0] - M[0][0] * M[2][1]) * InvDet;
    Inv[2][2] = (M[0][0] * M[1][1] - M[0][1] * M[1][0]) * InvDet;
    for (int Row = 0; Row < 3; ++Row)
        for (int Col = 0; Col < 3; ++Col) Out.Inverse[3 * Row + Col] = Inv[Row][Col];
    for (int Row = 0; Row < 3; ++Row)
        Out.InverseTranslation[Row] = -(Inv[Row][0] * T[0] + Inv[Row][1] * T[1] + Inv[Row][2] * T[2]);
    float MinStretch = 1e30f;
    for (int Col = 0; Col < 3; ++Col)
        MinStretch = std::min(MinStretch, std::sqrt(M[0][Col] * M[0][Col] + M[1][Col] * M[1][Col] + M[2][Col] * M[2][Col]));
    Out.MinScale = MinStretch;
    return true;
}

// An instance samples its mesh field through the inverse transform. Nothing about the field changes when the instance moves.
inline float SampleInstance(const Field& F, const Affine& A, const float WorldPoint[3]) noexcept
{
    float Local[3];
    for (int Row = 0; Row < 3; ++Row)
        Local[Row] = A.Inverse[3 * Row] * WorldPoint[0] + A.Inverse[3 * Row + 1] * WorldPoint[1] +
                     A.Inverse[3 * Row + 2] * WorldPoint[2] + A.InverseTranslation[Row];
    return SampleLocal(F, Local) * A.MinScale;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 CLIPMAP DIRTY CELLS
//------------------------------------------------------------------------------------------------------------------------
// A clip level is a Dim^3 volume of cells. Its origin is the world-space minimum corner, snapped like the device path does it:
// floor(eye / cell) - Dim/2, times cell.
struct ClipLevel
{
    float    Origin[3];
    float    Cell;
    uint32_t Dim;
};

inline ClipLevel MakeClipLevel(const float Eye[3], float CellSize, uint32_t Dim) noexcept
{
    ClipLevel L{};
    L.Cell = CellSize;
    L.Dim  = Dim;
    for (int A = 0; A < 3; ++A) L.Origin[A] = (std::floor(Eye[A] / CellSize) - float(Dim / 2u)) * CellSize;
    return L;
}

// Inclusive cell index range an axis-aligned box covers inside a clip level, clipped to the volume. Returns false when empty.
struct CellRange
{
    int32_t Lo[3], Hi[3];
};

inline bool RangeOf(const ClipLevel& L, const float Min[3], const float Max[3], CellRange& Out) noexcept
{
    for (int A = 0; A < 3; ++A)
    {
        const float Lo = std::floor((Min[A] - L.Origin[A]) / L.Cell);
        const float Hi = std::floor((Max[A] - L.Origin[A]) / L.Cell);
        const int32_t ILo = int32_t(std::max(Lo, 0.0f));
        const int32_t IHi = int32_t(std::min(Hi, float(L.Dim) - 1.0f));
        if (IHi < ILo || Hi < 0.0f || Lo > float(L.Dim) - 1.0f) return false;
        Out.Lo[A] = ILo;
        Out.Hi[A] = IHi;
    }
    return true;
}

inline uint64_t CountCells(const CellRange& R) noexcept
{
    return uint64_t(R.Hi[0] - R.Lo[0] + 1) * uint64_t(R.Hi[1] - R.Lo[1] + 1) * uint64_t(R.Hi[2] - R.Lo[2] + 1);
}

inline bool Intersect(const CellRange& A, const CellRange& B, CellRange& Out) noexcept
{
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        Out.Lo[Axis] = std::max(A.Lo[Axis], B.Lo[Axis]);
        Out.Hi[Axis] = std::min(A.Hi[Axis], B.Hi[Axis]);
        if (Out.Hi[Axis] < Out.Lo[Axis]) return false;
    }
    return true;
}

// Cells written when an instance moves from Old to New bounds: the union of both footprints, counted once each.
inline uint64_t DirtyCellsForMove(const ClipLevel& L, const float OldMin[3], const float OldMax[3],
                                  const float NewMin[3], const float NewMax[3]) noexcept
{
    CellRange A{}, B{}, Common{};
    const bool HasA = RangeOf(L, OldMin, OldMax, A), HasB = RangeOf(L, NewMin, NewMax, B);
    uint64_t Count = 0u;
    if (HasA) Count += CountCells(A);
    if (HasB) Count += CountCells(B);
    if (HasA && HasB && Intersect(A, B, Common)) Count -= CountCells(Common);
    return Count;
}

// Cells that become newly visible when the eye moves from one snapped origin to the next. Only these slabs are filled, never the
// whole volume (toroidal reuse of the old contents).
inline uint64_t ExposedCellsOnShift(const ClipLevel& Previous, const ClipLevel& Next) noexcept
{
    const uint64_t Total = uint64_t(Next.Dim) * Next.Dim * Next.Dim;
    uint64_t Kept = 1u;
    for (int A = 0; A < 3; ++A)
    {
        const int64_t Shift = std::llround((Next.Origin[A] - Previous.Origin[A]) / Next.Cell);
        const int64_t Magnitude = std::min<int64_t>(std::llabs(Shift), Next.Dim);
        Kept *= uint64_t(int64_t(Next.Dim) - Magnitude);
    }
    return Total - Kept;
}

//------------------------------------------------------------------------------------------------------------------------
//                                             IMPORT (BAKE) AND RUNTIME (LOAD ONLY)
//------------------------------------------------------------------------------------------------------------------------
// The import step bakes every .obj under a content root and writes sdf_index.tsv in the cache directory:
//     <relative source path> TAB <hash, 16 hex digits> TAB <cache file name> TAB <resolution>
// The runtime step only reads that index. It recomputes the source hash and refuses any entry that does not match, so a stale
// or missing field is reported, never silently rebuilt.

inline constexpr const char* IndexName = "sdf_index.tsv";

inline std::string HexHash(uint64_t Hash)
{
    char Text[32];
    std::snprintf(Text, sizeof(Text), "%016llx", static_cast<unsigned long long>(Hash));
    return Text;
}

// Bake one source file into CacheDir (cache hit skips the bake). Returns the entry hash through Out.
inline bool BakeSource(const std::string& SourcePath, const std::string& CacheDir, uint32_t Resolution, float Padding,
                       uint64_t& OutHash, std::string& OutFileName, bool& OutHit, std::string& Error)
{
    std::string Bytes;
    std::vector<Triangle> Tris;
    if (!LoadObj(SourcePath, Tris, &Bytes)) { Error = "cannot read triangles from " + SourcePath; return false; }
    OutHash = SourceHash(Bytes, Resolution, Padding);
    const std::string Stem = std::filesystem::path(SourcePath).stem().string();
    OutFileName = Stem + "-" + HexHash(OutHash) + ".fsdf";
    const std::filesystem::path Target = std::filesystem::path(CacheDir) / OutFileName;
    std::filesystem::create_directories(CacheDir);
    Field Cached;
    OutHit = std::filesystem::exists(Target) && Load(Target.string(), Cached) && Cached.H.ContentHash == OutHash;
    if (OutHit) return true;
    Field F = Bake(Tris, Resolution, Padding, OutHash);
    if (!Save(F, Target.string())) { Error = "cannot write " + Target.string(); return false; }
    return true;
}

// Import step: every .obj under Root. Writes the index. Returns the number of entries, or -1 on error.
inline int BakeDirectory(const std::string& Root, const std::string& CacheDir, uint32_t Resolution, float Padding,
                         uint32_t* OutHits = nullptr, std::string* Error = nullptr)
{
    namespace fs = std::filesystem;
    std::vector<fs::path> Sources;
    for (const auto& Entry : fs::recursive_directory_iterator(Root))
        if (Entry.is_regular_file() && Entry.path().extension() == ".obj") Sources.push_back(Entry.path());
    std::sort(Sources.begin(), Sources.end());
    std::string Index;
    uint32_t Hits = 0u;
    for (const fs::path& Source : Sources)
    {
        uint64_t Hash = 0u;
        std::string FileName, Failure;
        bool Hit = false;
        if (!BakeSource(Source.string(), CacheDir, Resolution, Padding, Hash, FileName, Hit, Failure))
        {
            if (Error) *Error = Failure;
            return -1;
        }
        Hits += Hit ? 1u : 0u;
        const std::string Relative = fs::relative(Source, Root).generic_string();
        Index += Relative + "\t" + HexHash(Hash) + "\t" + FileName + "\t" + std::to_string(Resolution) + "\n";
    }
    std::FILE* File = std::fopen((fs::path(CacheDir) / IndexName).string().c_str(), "wb");
    if (!File) { if (Error) *Error = "cannot write index"; return -1; }
    std::fwrite(Index.data(), 1, Index.size(), File);
    std::fclose(File);
    if (OutHits) *OutHits = Hits;
    return int(Sources.size());
}

enum class RuntimeStatus { Loaded, NoIndexEntry, Stale, Missing };

// Runtime step: load only. Never bakes. SourceRelative is the key written by BakeDirectory.
inline RuntimeStatus RuntimeLoad(const std::string& CacheDir, const std::string& SourceRoot, const std::string& SourceRelative,
                                 uint32_t Resolution, float Padding, Field& Out, std::string& Reason)
{
    namespace fs = std::filesystem;
    std::string IndexText;
    if (!ReadAll((fs::path(CacheDir) / IndexName).string(), IndexText)) { Reason = "no sdf index: run the import step"; return RuntimeStatus::NoIndexEntry; }
    std::string Found;
    size_t Pos = 0;
    while (Pos < IndexText.size())
    {
        size_t End = IndexText.find('\n', Pos);
        if (End == std::string::npos) End = IndexText.size();
        const std::string Line = IndexText.substr(Pos, End - Pos);
        Pos = End + 1;
        if (Line.compare(0, SourceRelative.size(), SourceRelative) == 0 && Line.size() > SourceRelative.size() &&
            Line[SourceRelative.size()] == '\t') { Found = Line; break; }
    }
    if (Found.empty()) { Reason = "no SDF for " + SourceRelative + ": run the import step"; return RuntimeStatus::NoIndexEntry; }
    const size_t T1 = Found.find('\t'), T2 = Found.find('\t', T1 + 1);
    const std::string HashText = Found.substr(T1 + 1, T2 - T1 - 1);
    const std::string FileName = Found.substr(T2 + 1, Found.find('\t', T2 + 1) - T2 - 1);

    std::string Bytes;
    if (!ReadAll((fs::path(SourceRoot) / SourceRelative).string(), Bytes)) { Reason = "source missing: " + SourceRelative; return RuntimeStatus::Missing; }
    if (HexHash(SourceHash(Bytes, Resolution, Padding)) != HashText) { Reason = "stale SDF for " + SourceRelative + ": source changed since import"; return RuntimeStatus::Stale; }
    if (!Load((fs::path(CacheDir) / FileName).string(), Out)) { Reason = "cannot read " + FileName; return RuntimeStatus::Missing; }
    return RuntimeStatus::Loaded;
}
} // namespace MeshDistanceField
