// CPU exact proof for the import-time mesh SDF pipeline.
//   Part A: bake accuracy, sign, file round trip, instance sampling through the inverse transform.
//   Part B: dirty-cell counts per frame for a 3600-frame scenario (one moving car, static boxes, moving camera), old full rebuild
//           versus the new dirty-cell path. Counts are exact cell counts. They are NOT GPU timings.
// Build: g++ -std=c++20 -O2 -I../../../Engine/GeometricRaster proof.cpp -o proof

#include "MeshDistanceField.h"
#include "MeshSdfGpuMirror.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <random>

namespace
{
using MeshDistanceField::Affine;
using MeshDistanceField::ClipLevel;
using MeshDistanceField::Field;
using MeshDistanceField::Triangle;

constexpr uint32_t Frames     = 3600;        // 60 s at 60 fps
constexpr uint32_t Dim        = 32u;         // engine VolumeResolution
constexpr int      Levels     = 3;
constexpr float    CellBase   = 0.15f;       // engine ClipmapCellSize
constexpr uint32_t BakeN      = 32u;
constexpr float    Pi         = 3.14159265358979f;

int Failures = 0;
void Check(bool Ok, const char* Name, const char* Detail = "")
{
    std::printf("%s  %s %s\n", Ok ? "PASS" : "FAIL", Name, Detail);
    if (!Ok) ++Failures;
}

// Exact signed distance to an axis-aligned box of half-size H centred at the origin.
float BoxSdf(const float P[3], const float H[3])
{
    float Q[3];
    for (int A = 0; A < 3; ++A) Q[A] = std::fabs(P[A]) - H[A];
    float Outside = 0.0f;
    for (int A = 0; A < 3; ++A) Outside += std::max(Q[A], 0.0f) * std::max(Q[A], 0.0f);
    return std::sqrt(Outside) + std::min(std::max(Q[0], std::max(Q[1], Q[2])), 0.0f);
}

// Column-major 4x4 from scale, rotation about Z (radians) and translation.
void MakeWorld(float Sx, float Sy, float Sz, float Yaw, const float T[3], float W[16])
{
    const float C = std::cos(Yaw), S = std::sin(Yaw);
    std::fill_n(W, 16, 0.0f);
    W[0] = C * Sx;  W[1] = S * Sx;          // X column
    W[4] = -S * Sy; W[5] = C * Sy;          // Y column
    W[10] = Sz;                             // Z column
    W[12] = T[0];  W[13] = T[1];  W[14] = T[2];
    W[15] = 1.0f;
}

double CellSizeOf(const Field& F)
{
    return (F.H.Max[0] - F.H.Min[0]) / double(F.H.Resolution - 1u);
}

} // namespace

int main()
{
    const std::filesystem::path Out = "out";
    std::filesystem::create_directories(Out);
    const std::string ObjPath = (Out / "unit_cube.obj").string();
    {
        std::FILE* File = std::fopen(ObjPath.c_str(), "w");
        const float V[8][3] = { { -1, -1, -1 }, { 1, -1, -1 }, { 1, 1, -1 }, { -1, 1, -1 },
                                { -1, -1, 1 },  { 1, -1, 1 },  { 1, 1, 1 },  { -1, 1, 1 } };
        for (const auto& P : V) std::fprintf(File, "v %g %g %g\n", P[0], P[1], P[2]);
        const int F[6][4] = { { 1, 4, 3, 2 }, { 5, 6, 7, 8 }, { 1, 2, 6, 5 }, { 4, 8, 7, 3 }, { 1, 5, 8, 4 }, { 2, 3, 7, 6 } };   // outward CCW
        for (const auto& Q : F) std::fprintf(File, "f %d %d %d %d\n", Q[0], Q[1], Q[2], Q[3]);
        std::fclose(File);
    }

    // ---------------- Part A: bake and sampling ----------------
    std::printf("== Part A: bake accuracy and instance sampling (CPU exact)\n");
    std::vector<Triangle> Tris;
    std::string Bytes;
    Check(MeshDistanceField::LoadObj(ObjPath, Tris, &Bytes) && Tris.size() == 12u, "OBJ loads as 12 triangles from 6 quads");

    const Field Cube = MeshDistanceField::Bake(Tris, BakeN, 0.1f, MeshDistanceField::Fnv1a(Bytes.data(), Bytes.size()));
    const double Cell = CellSizeOf(Cube);
    {
        // Inside the field's bounds the sample is accurate; outside them it is a conservative lower bound (checked below).
        std::mt19937 Rng(7);
        std::uniform_real_distribution<float> U(-1.2f, 1.2f);
        double MaxError = 0.0;
        for (int I = 0; I < 20000; ++I)
        {
            const float P[3] = { U(Rng), U(Rng), U(Rng) };
            const float H[3] = { 1.0f, 1.0f, 1.0f };
            MaxError = std::max(MaxError, std::fabs(double(MeshDistanceField::SampleLocal(Cube, P)) - BoxSdf(P, H)));
        }
        std::uniform_real_distribution<float> Wide(-1.6f, 1.6f);
        int OutsideOver = 0;
        for (int I = 0; I < 20000; ++I)
        {
            const float P[3] = { Wide(Rng), Wide(Rng), Wide(Rng) };
            const float H[3] = { 1.0f, 1.0f, 1.0f };
            if (double(MeshDistanceField::SampleLocal(Cube, P)) > BoxSdf(P, H) + 1.5 * Cell + 1e-4) ++OutsideOver;
        }
        Check(OutsideOver == 0, "outside the field bounds the sample never exceeds the true distance (conservative)");
        char Detail[96];
        std::snprintf(Detail, sizeof(Detail), "(max error %.4f, cell %.4f)", MaxError, Cell);
        // Bound: trilinear interpolation of a 1-Lipschitz field errs by at most 3/2 cell (half a cell per axis).
        Check(MaxError <= 1.5 * Cell, "trilinear sample of the baked cube matches the exact box SDF", Detail);
    }
    {
        const float Centre[3] = { 0, 0, 0 }, Far[3] = { 3, 0, 0 }, Inside[3] = { 0.5f, 0.2f, -0.3f };
        Check(MeshDistanceField::SampleLocal(Cube, Centre) < 0.0f && MeshDistanceField::SampleLocal(Cube, Inside) < 0.0f,
              "sign: inside the cube is negative");
        Check(MeshDistanceField::SampleLocal(Cube, Far) > 1.5f, "sign: outside the cube is positive, about 2 units away");
    }
    {
        const std::string Path = (Out / "unit_cube.fsdf").string();
        Check(MeshDistanceField::Save(Cube, Path), "bake writes a .fsdf file");
        Field Back;
        const bool Loaded = MeshDistanceField::Load(Path, Back);
        const bool Same = Loaded && Back.H.ContentHash == Cube.H.ContentHash && Back.Distance == Cube.Distance;
        Check(Same, "load returns the identical field (round trip)");
    }
    {
        // Instance: cube scaled x2, rotated 30 degrees about Z, moved to (3,-1,0.5). Exact world SDF is the box of half 2, rotated.
        const float T[3] = { 3.0f, -1.0f, 0.5f };
        const float Yaw = 30.0f * Pi / 180.0f;
        float W[16];
        MakeWorld(2.0f, 2.0f, 2.0f, Yaw, T, W);
        Affine A{};
        Check(MeshDistanceField::MakeAffine(W, A), "instance transform inverts");
        std::mt19937 Rng(11);
        std::uniform_real_distribution<float> U(-4.0f, 4.0f);
        double MaxError = 0.0;
        int Kept = 0;
        for (int I = 0; I < 40000; ++I)
        {
            const float P[3] = { T[0] + U(Rng), T[1] + U(Rng), T[2] + U(Rng) };
            float Rel[3] = { P[0] - T[0], P[1] - T[1], P[2] - T[2] };
            const float C = std::cos(-Yaw), S = std::sin(-Yaw);
            // Local point is the inverse-rotated, unscaled point (the cube's own space has half-size 1 for an instance scale of 2).
            const float Unrot[3] = { C * Rel[0] - S * Rel[1], S * Rel[0] + C * Rel[1], Rel[2] };   // world offset in the box's frame
            const float Local[3] = { Unrot[0] / 2.0f, Unrot[1] / 2.0f, Unrot[2] / 2.0f };
            if (std::fabs(Local[0]) > 1.2f || std::fabs(Local[1]) > 1.2f || std::fabs(Local[2]) > 1.2f) continue;   // inside bounds only
            ++Kept;
            const float H[3] = { 2.0f, 2.0f, 2.0f };
            const double Exact = BoxSdf(Unrot, H);   // world-space exact distance
            MaxError = std::max(MaxError, std::fabs(double(MeshDistanceField::SampleInstance(Cube, A, P)) - Exact));
        }
        char Detail[96];
        std::snprintf(Detail, sizeof(Detail), "(%d in-bounds points, max error %.4f, tolerance %.4f)", Kept, MaxError, 1.5 * Cell * 2.0);
        Check(MaxError <= 1.5 * Cell * 2.0, "moved, scaled and rotated instance samples the shared field correctly", Detail);
    }
    {
        // Non-uniform scale: the sample must never exceed the true world distance (conservative for sphere tracing).
        const float T[3] = { 0.0f, 0.0f, 0.0f };
        float W[16];
        MakeWorld(3.0f, 1.0f, 0.5f, 0.0f, T, W);
        Affine A{};
        MeshDistanceField::MakeAffine(W, A);
        std::mt19937 Rng(13);
        std::uniform_real_distribution<float> U(-5.0f, 5.0f);
        // Exact world distance to the box with half sizes (3,1,0.5). Outside the box the sample must not exceed it (conservative).
        // Inside, the sample's magnitude must not exceed the true penetration depth. Allowed slack: 1.5 local cells x smallest stretch.
        int OutsideOver = 0, InsideOver = 0, Inside = 0;
        double WorstOutside = -1e9, WorstInside = -1e9;
        const float H[3] = { 3.0f, 1.0f, 0.5f };
        const double Slack = 1.5 * Cell * 0.5 + 1e-4;
        for (int I = 0; I < 20000; ++I)
        {
            const float P[3] = { U(Rng), U(Rng), U(Rng) };
            const double Exact = BoxSdf(P, H);
            const double Sample = double(MeshDistanceField::SampleInstance(Cube, A, P));
            if (Exact >= 0.0)
            {
                WorstOutside = std::max(WorstOutside, Sample - Exact);
                if (Sample > Exact + Slack) ++OutsideOver;
            }
            else
            {
                ++Inside;
                WorstInside = std::max(WorstInside, std::fabs(Sample) - std::fabs(Exact));
                if (std::fabs(Sample) > std::fabs(Exact) + Slack) ++InsideOver;
            }
        }
        char Detail[160];
        std::snprintf(Detail, sizeof(Detail), "(outside: %d over, worst %.4f; inside (%d pts): %d over, worst %.4f; slack %.4f)",
                      OutsideOver, WorstOutside, Inside, InsideOver, WorstInside, Slack);
        Check(OutsideOver == 0 && InsideOver == 0, "non-uniform scale: sample is conservative (outside never over, inside never deeper)", Detail);
    }

    // ---------------- Part B: dirty cells per frame ----------------
    std::printf("\n== Part B: dirty cells per frame, %u frames, 3 clip levels of %u^3 (exact cell counts, not GPU time)\n", Frames, Dim);
    const uint64_t VoxelsAllLevels = uint64_t(Levels) * Dim * Dim * Dim;

    // Movable car: circles at radius 25 m, 8 m/s. Half extents 2.1 x 0.95 x 0.75 m.
    const float CarHalf[3] = { 2.1f, 0.95f, 0.75f };
    auto CarCentre = [](uint32_t F, float C[3]) {
        const float Angle = (8.0f / 25.0f) * (float(F) / 60.0f);
        C[0] = 25.0f * std::cos(Angle); C[1] = 25.0f * std::sin(Angle); C[2] = 0.75f;
    };
    // Static scene: 60 boxes on a deterministic grid, never moved.
    struct Box { float Min[3], Max[3]; };
    std::vector<Box> Statics;
    std::mt19937 Rng(20260910);
    std::uniform_real_distribution<float> P(-60.0f, 60.0f), Half(1.0f, 3.0f);
    for (int I = 0; I < 60; ++I)
    {
        const float C[3] = { P(Rng), P(Rng), 0.0f }, H[3] = { Half(Rng), Half(Rng), Half(Rng) };
        Box B{};
        for (int A = 0; A < 3; ++A) { B.Min[A] = C[A] - H[A]; B.Max[A] = C[A] + H[A]; }
        Statics.push_back(B);
    }

    // Composition cull check: an instance may be skipped when its box is further than Threshold from the cell. Verify that the
    // minimum over the culled set equals the minimum over all instances whenever the true minimum is below Threshold.
    {
        const float Threshold = 4.0f;
        float CarW[16];
        const float Zero[3] = { 0, 0, 0 };
        MakeWorld(CarHalf[0], CarHalf[1], CarHalf[2], 0.0f, Zero, CarW);
        Affine CarA{};
        MeshDistanceField::MakeAffine(CarW, CarA);
        std::mt19937 R2(99);
        std::uniform_real_distribution<float> Around(-4.0f, 4.0f);
        int Mismatch = 0, Compared = 0;
        for (int I = 0; I < 4000; ++I)
        {
            float Cc[3]; CarCentre(uint32_t(I % 3600), Cc);
            const float Q[3] = { Cc[0] + Around(R2), Cc[1] + Around(R2), Cc[2] + Around(R2) };
            double All = 1e30, Culled = 1e30;
            // Full set: the car itself plus every static box (a box distance, exact for a box instance).
            for (const Box& B : Statics)
            {
                float Dist2 = 0.0f;
                for (int A = 0; A < 3; ++A) { const float G = std::max(std::max(B.Min[A] - Q[A], Q[A] - B.Max[A]), 0.0f); Dist2 += G * G; }
                All = std::min(All, double(std::sqrt(Dist2)));
            }
            const float CarDist = MeshDistanceField::SampleInstance(Cube, CarA, Q);
            All = std::min(All, double(CarDist));
            // Culled set: only instances whose box lies within Threshold of the point.
            for (const Box& B : Statics)
            {
                float Dist2 = 0.0f;
                for (int A = 0; A < 3; ++A) { const float G = std::max(std::max(B.Min[A] - Q[A], Q[A] - B.Max[A]), 0.0f); Dist2 += G * G; }
                if (std::sqrt(Dist2) <= Threshold) Culled = std::min(Culled, double(std::sqrt(Dist2)));
            }
            if (CarDist <= Threshold) Culled = std::min(Culled, double(CarDist));
            if (All < Threshold)
            {
                ++Compared;
                if (std::fabs(All - Culled) > 1e-4) ++Mismatch;
            }
        }
        char Detail[96];
        std::snprintf(Detail, sizeof(Detail), "(%d points compared, %d mismatches)", Compared, Mismatch);
        Check(Compared > 1000 && Mismatch == 0, "culling by bounds keeps the composited minimum exact", Detail);
    }

    // Per-frame counts.
    std::FILE* Tsv = std::fopen("frame_cell_writes.tsv", "w");
    std::fprintf(Tsv, "frame\told_full_rebuild_writes\tnew_static_field_writes\tnew_movable_field_writes\tnew_total_writes\tcamera_shift_cells\tcar_move_cells\n");
    uint64_t OldTotal = 0, NewTotal = 0, NewStaticTotal = 0, NewMovableTotal = 0;
    uint64_t OldFullFrames = 0, CarOnlyFrames = 0, StaticWritesOnCarOnly = 0;
    double NsDecision = 0.0;
    ClipLevel PreviousLevels[Levels]{};
    float PreviousCarMin[3]{}, PreviousCarMax[3]{};
    const float CamStart[3] = { -30.0f, 0.0f, 2.0f };
    for (uint32_t F = 0; F < Frames; ++F)
    {
        float Eye[3] = { CamStart[0] + 1.5f * float(F) / 60.0f, CamStart[1], CamStart[2] };
        float Car[3]; CarCentre(F, Car);
        float CarMin[3], CarMax[3];
        for (int A = 0; A < 3; ++A) { CarMin[A] = Car[A] - CarHalf[A]; CarMax[A] = Car[A] + CarHalf[A]; }

        const auto T0 = std::chrono::steady_clock::now();
        ClipLevel Levels3[Levels];
        bool OriginChanged = false;
        uint64_t Shift = 0, CarCells = 0;
        for (int L = 0; L < Levels; ++L)
        {
            Levels3[L] = MeshDistanceField::MakeClipLevel(Eye, CellBase * float(1 << L), Dim);
            if (F > 0)
            {
                if (Levels3[L].Origin[0] != PreviousLevels[L].Origin[0] || Levels3[L].Origin[1] != PreviousLevels[L].Origin[1] ||
                    Levels3[L].Origin[2] != PreviousLevels[L].Origin[2]) OriginChanged = true;
                Shift += MeshDistanceField::ExposedCellsOnShift(PreviousLevels[L], Levels3[L]);
            }
            if (F > 0) CarCells += MeshDistanceField::DirtyCellsForMove(Levels3[L], PreviousCarMin, PreviousCarMax, CarMin, CarMax);
            else CarCells += MeshDistanceField::DirtyCellsForMove(Levels3[L], CarMin, CarMax, CarMin, CarMax);
        }
        const auto T1 = std::chrono::steady_clock::now();
        NsDecision += double(std::chrono::duration_cast<std::chrono::nanoseconds>(T1 - T0).count());

        const bool CarMoved = F > 0;   // the car moves every frame
        // Old build: any instance change or any origin change re-dispatches the full three-level volume.
        const uint64_t Old = (CarMoved || OriginChanged || F == 0) ? VoxelsAllLevels : 0u;
        // New build: two fields (Unreal's static / movable split). Each has its own clip volumes, so a camera shift exposes the same
        // slabs in both. Only the movable field gets the car's old and new footprint cells.
        const uint64_t StaticWrites  = Shift;
        const uint64_t MovableWrites = Shift + (CarMoved ? CarCells : 0u);
        const uint64_t New = StaticWrites + MovableWrites;

        if (CarMoved && Shift == 0) { ++CarOnlyFrames; StaticWritesOnCarOnly += StaticWrites; }
        if (Old == VoxelsAllLevels) ++OldFullFrames;
        OldTotal += Old;
        NewTotal += New;
        NewStaticTotal += StaticWrites;
        NewMovableTotal += MovableWrites;
        std::fprintf(Tsv, "%u\t%llu\t%llu\t%llu\t%llu\t%llu\t%llu\n", F, (unsigned long long)Old, (unsigned long long)StaticWrites,
                     (unsigned long long)MovableWrites, (unsigned long long)New, (unsigned long long)Shift, (unsigned long long)CarCells);

        for (int L = 0; L < Levels; ++L) PreviousLevels[L] = Levels3[L];
        for (int A = 0; A < 3; ++A) { PreviousCarMin[A] = CarMin[A]; PreviousCarMax[A] = CarMax[A]; }
    }
    std::fclose(Tsv);

    const double OldPerFrame = double(OldTotal) / Frames, NewPerFrame = double(NewTotal) / Frames;
    std::printf("old: %.0f cell writes per frame (full volume rebuilt on %llu of %u frames)\n", OldPerFrame,
                (unsigned long long)OldFullFrames, Frames);
    std::printf("new: %.1f cell writes per frame (static field %.1f, movable field %.1f)\n", NewPerFrame,
                double(NewStaticTotal) / Frames, double(NewMovableTotal) / Frames);
    std::printf("reduction: %.1fx fewer cell writes; decision cost %.1f ns per frame (CPU)\n", OldPerFrame / std::max(NewPerFrame, 1e-9),
                NsDecision / Frames);

    char Detail[128];
    std::snprintf(Detail, sizeof(Detail), "(new %.1f vs old %.0f per frame)", NewPerFrame, OldPerFrame);
    Check(NewTotal < OldTotal, "dirty-cell path writes fewer cells than the full rebuild", Detail);
    char CarDetail[96];
    std::snprintf(CarDetail, sizeof(CarDetail), "(%llu frames with the car moving and no camera shift)", (unsigned long long)CarOnlyFrames);
    Check(CarOnlyFrames > 2000 && StaticWritesOnCarOnly == 0, "moving car never writes the static field", CarDetail);

    // ---------------- Part C: import step writes an index; runtime only loads ----------------
    std::printf("\n== Part C: import index, cache hits, stale and missing detection, runtime never bakes\n");
    {
        namespace fs = std::filesystem;
        const fs::path Content = Out / "content";
        const fs::path Cache = Out / "sdf_cache";
        fs::remove_all(Content);
        fs::remove_all(Cache);
        fs::create_directories(Content / "sub");
        fs::copy_file(ObjPath, Content / "a.obj");
        fs::copy_file(ObjPath, Content / "sub" / "b.obj");
        fs::copy_file(ObjPath, Content / "c.obj");

        std::string Error;
        uint32_t Hits = 99u;
        const uint64_t Before = MeshDistanceField::BakeCallCount();
        const int Indexed = MeshDistanceField::BakeDirectory(Content.string(), Cache.string(), BakeN, 0.1f, &Hits, &Error);
        const uint64_t FirstBakes = MeshDistanceField::BakeCallCount() - Before;
        char Detail[96];
        std::snprintf(Detail, sizeof(Detail), "(indexed %d, baked %llu)", Indexed, (unsigned long long)FirstBakes);
        Check(Indexed == 3 && Hits == 0u && FirstBakes == 3u, "import bakes each of the 3 meshes once and writes the index", Detail);

        const uint64_t Second = MeshDistanceField::BakeCallCount();
        const int Again = MeshDistanceField::BakeDirectory(Content.string(), Cache.string(), BakeN, 0.1f, &Hits, &Error);
        Check(Again == 3 && Hits == 3u && MeshDistanceField::BakeCallCount() == Second, "second import is all cache hits (no bake)");

        // Runtime: load each mesh. No bake may run.
        const uint64_t RuntimeStart = MeshDistanceField::BakeCallCount();
        MeshDistanceField::Field Loaded;
        std::string Reason;
        const auto StatusA = MeshDistanceField::RuntimeLoad(Cache.string(), Content.string(), "a.obj", BakeN, 0.1f, Loaded, Reason);
        Check(StatusA == MeshDistanceField::RuntimeStatus::Loaded && Loaded.Distance == Cube.Distance,
              "runtime loads a.obj from the index, identical to the imported field");

        // Edit c.obj after import. Its hash no longer matches, so runtime must refuse it, not rebake it.
        {
            std::FILE* File = std::fopen((Content / "c.obj").string().c_str(), "ab");
            std::fprintf(File, "# edited after import\n");
            std::fclose(File);
        }
        const auto StatusC = MeshDistanceField::RuntimeLoad(Cache.string(), Content.string(), "c.obj", BakeN, 0.1f, Loaded, Reason);
        Check(StatusC == MeshDistanceField::RuntimeStatus::Stale && Reason.find("stale") != std::string::npos,
              "edited source is reported stale, not silently rebuilt", ("(" + Reason + ")").c_str());

        const auto StatusD = MeshDistanceField::RuntimeLoad(Cache.string(), Content.string(), "d.obj", BakeN, 0.1f, Loaded, Reason);
        Check(StatusD == MeshDistanceField::RuntimeStatus::NoIndexEntry && Reason.find("import") != std::string::npos,
              "mesh with no import entry is reported, not baked");

        Check(MeshDistanceField::BakeCallCount() == RuntimeStart, "runtime loads performed zero bakes (counter unchanged)");
    }

    // ---------------- Part D: GPU kernels, CPU exact mirror ----------------
    std::printf("\n== Part D: GPU bake and dirty-cell composite, CPU exact mirror of MeshSdf.slang (device run NOT performed)\n");
    {
        using MeshSdfGpuMirror::InstanceGpu;
        std::vector<float> TriFlat;
        for (const Triangle& T : Tris) for (const auto& V : T.V) for (int A = 0; A < 3; ++A) TriFlat.push_back(V[A]);

        // Bake parity: mirror of BakeMain against the CPU reference, same bounds, same resolution.
        const Field Ref = MeshDistanceField::Bake(Tris, BakeN, 0.1f, 1u);
        MeshSdfGpuMirror::BakeParams BP{};
        BP.Min = MeshSdfGpuMirror::F3(Ref.H.Min[0], Ref.H.Min[1], Ref.H.Min[2]);
        BP.Max = MeshSdfGpuMirror::F3(Ref.H.Max[0], Ref.H.Max[1], Ref.H.Max[2]);
        BP.Resolution = BakeN;
        BP.TriangleCount = uint32_t(Tris.size());
        const std::vector<float> Gpu = MeshSdfGpuMirror::BakeGrid(BP, TriFlat);
        double BakeDiff = 0.0;
        for (size_t I = 0; I < Gpu.size(); ++I) BakeDiff = std::max(BakeDiff, std::fabs(double(Gpu[I]) - double(Ref.Distance[I])));
        char Detail[96];
        std::snprintf(Detail, sizeof(Detail), "(max abs diff %.2e over %zu nodes)", BakeDiff, Gpu.size());
        Check(BakeDiff <= 1e-4, "mirror of BakeMain matches the CPU bake at every grid node", Detail);

        // Composite parity over a dirty box of one clip level, three culled-in instances.
        const Field& F = Cube;
        std::vector<MeshDistanceField::Affine> Affines;
        std::vector<InstanceGpu> Instances;
        const float Yaw = 30.0f * Pi / 180.0f;
        float W0[16], W1[16], W2[16];
        const float T0[3] = { 25.0f, 0.0f, 0.75f }, T1[3] = { 3.0f, -1.0f, 0.5f }, T2[3] = { -10.0f, 4.0f, 0.0f };
        MakeWorld(2.1f, 0.95f, 0.75f, 0.0f, T0, W0);
        MakeWorld(2.0f, 2.0f, 2.0f, Yaw, T1, W1);
        MakeWorld(4.0f, 1.0f, 1.5f, 0.0f, T2, W2);
        for (const float* W : { W0, W1, W2 })
        {
            MeshDistanceField::Affine A{};
            MeshDistanceField::MakeAffine(W, A);
            Affines.push_back(A);
            Instances.push_back(MeshSdfGpuMirror::MakeInstanceGpu(F, A, 0u));
        }
        const float Eye[3] = { 24.0f, 0.0f, 1.0f };
        const MeshDistanceField::ClipLevel Level = MeshDistanceField::MakeClipLevel(Eye, CellBase, Dim);
        MeshSdfGpuMirror::CompositeParams CP{};
        CP.Origin = MeshSdfGpuMirror::F3(Level.Origin[0], Level.Origin[1], Level.Origin[2]);
        CP.Cell = Level.Cell;
        CP.Dim = Dim;
        CP.DirtyLo[0] = 10; CP.DirtyLo[1] = 12; CP.DirtyLo[2] = 12;
        CP.DirtyHi[0] = 20; CP.DirtyHi[1] = 20; CP.DirtyHi[2] = 20;
        CP.InstanceCount = uint32_t(Instances.size());
        const uint64_t Total = uint64_t(Dim) * Dim * Dim;
        std::vector<float> Clip(Total, -999.0f);
        const uint64_t Written = MeshSdfGpuMirror::CompositeDirty(CP, Instances, F.Distance, Clip);
        const uint64_t Expected = uint64_t(CP.DirtyHi[0] - CP.DirtyLo[0] + 1) * (CP.DirtyHi[1] - CP.DirtyLo[1] + 1) * (CP.DirtyHi[2] - CP.DirtyLo[2] + 1);
        uint64_t Touched = 0u;
        for (float V : Clip) if (V != -999.0f) ++Touched;
        std::snprintf(Detail, sizeof(Detail), "(written %llu, dirty box %llu, touched %llu of %llu)", (unsigned long long)Written,
                      (unsigned long long)Expected, (unsigned long long)Touched, (unsigned long long)Total);
        Check(Written == Expected && Touched == Expected, "composite writes exactly the dirty cells and no others", Detail);

        double CompDiff = 0.0;
        for (uint32_t Z = CP.DirtyLo[2]; Z <= CP.DirtyHi[2]; ++Z)
            for (uint32_t Y = CP.DirtyLo[1]; Y <= CP.DirtyHi[1]; ++Y)
                for (uint32_t X = CP.DirtyLo[0]; X <= CP.DirtyHi[0]; ++X)
                {
                    const float Pos[3] = { Level.Origin[0] + (float(X) + 0.5f) * Level.Cell,
                                           Level.Origin[1] + (float(Y) + 0.5f) * Level.Cell,
                                           Level.Origin[2] + (float(Z) + 0.5f) * Level.Cell };
                    double Best = 1e30;
                    for (const auto& A : Affines) Best = std::min(Best, double(MeshDistanceField::SampleInstance(F, A, Pos)));
                    const uint64_t Index = (uint64_t(Z) * Dim + Y) * Dim + X;
                    CompDiff = std::max(CompDiff, std::fabs(Best - double(Clip[Index])));
                }
        std::snprintf(Detail, sizeof(Detail), "(max abs diff %.2e over %llu cells)", CompDiff, (unsigned long long)Expected);
        Check(CompDiff <= 1e-3, "mirror of CompositeMain matches the CPU per-instance minimum", Detail);
    }

    std::printf("%s - %d failure(s)\n", Failures ? "RED" : "GREEN", Failures);
    return Failures ? 1 : 0;
}
