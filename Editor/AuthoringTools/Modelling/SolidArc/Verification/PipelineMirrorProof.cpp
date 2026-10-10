//============================================================================================================================================
// 📦 Editor/AuthoringTools/Modelling/SolidArc/Verification/PipelineMirrorProof.cpp — CPU exact mirror of the three SolidArc raster pipelines
//============================================================================================================================================
// The three GPU raster pipelines of the Vulkan path are Surface (SurfaceVS/FS), Line (LineVS/FS) and Point (PointVS/FS). This harness
//    drives each one in isolation through SoftwareRaster, which executes the SAME .slang bodies as C++ (SlangMirror.h), over a full
//    turntable orbit. It writes:
//       <out>/frames_<pipeline>.rgba   raw RGBA8 frames (top row first), consumed by build_proofs.py
//       <out>/timings.tsv              one row per frame: wall time (CPU mirror) and workload tallies
//       <out>/checks.txt               self-checks (pick identity, depth ordering, determinism); exit 1 on any failure
//
// IMPORTANT: the timings are CPU-mirror wall-clock times on this machine. They are NOT GPU frame times. No GPU number is produced here.
//------------------------------------------------------------------------------------------------------------------------------------------
#include "Interaction/CameraProjection.h"
#include "Presentation/ScenePresentation.h"
#include "Presentation/SoftwareRaster.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

using namespace Frontier;

namespace
{

constexpr uint32_t Width = 480, Height = 300;
constexpr int Frames = 72;                                 // 5° per frame, one full turn
constexpr int WarmupFrames = 3;
const float Backdrop[4] = { 0.055f, 0.06f, 0.07f, 1.0f };
constexpr double Pi = 3.14159265358979323846;

struct Scene
{
    const char* Name;
    double Distance;
    SurfaceStream Surfaces;
    SegmentStream Segments;
    PointStream Points;
    DrawRecord SurfaceDraw, SegmentDraw, PointDraw;
};

// Torus: major radius 1.0, tube radius 0.35. Normals point outward; triangles are wound CCW seen from +normal (checked per triangle).
SurfaceStream MakeTorus(int MajorSteps, int MinorSteps)
{
    SurfaceStream S;
    const double R = 1.0, r = 0.35;
    for (int I = 0; I <= MajorSteps; ++I)
        for (int J = 0; J <= MinorSteps; ++J)
        {
            const double U = 2.0 * Pi * I / MajorSteps, V = 2.0 * Pi * J / MinorSteps;
            const double Cu = std::cos(U), Su = std::sin(U), Cv = std::cos(V), Sv = std::sin(V);
            S.Positions.push_back(float((R + r * Cv) * Cu)); S.Positions.push_back(float((R + r * Cv) * Su)); S.Positions.push_back(float(r * Sv));
            S.Normals.push_back(float(Cv * Cu)); S.Normals.push_back(float(Cv * Su)); S.Normals.push_back(float(Sv));
            S.Parameters.push_back(float(U / (2.0 * Pi))); S.Parameters.push_back(float(V / (2.0 * Pi)));
        }
    const uint32_t Row = MinorSteps + 1;
    for (int I = 0; I < MajorSteps; ++I)
        for (int J = 0; J < MinorSteps; ++J)
        {
            const uint32_t A = uint32_t(I) * Row + J, B = A + Row, C = A + 1, D = B + 1;
            const uint32_t Tri[2][3] = { { A, B, C }, { C, B, D } };
            for (const auto& T : Tri)
            {
                // Orientation check: the cross product must point along the stored normal, otherwise swap two corners.
                auto P = [&](uint32_t Index) { return Vec3{ S.Positions[3 * Index], S.Positions[3 * Index + 1], S.Positions[3 * Index + 2] }; };
                Vec3 E1 = P(T[1]) - P(T[0]), E2 = P(T[2]) - P(T[0]);
                Vec3 Cross{ E1.Y * E2.Z - E1.Z * E2.Y, E1.Z * E2.X - E1.X * E2.Z, E1.X * E2.Y - E1.Y * E2.X };
                Vec3 N{ S.Normals[3 * T[0]], S.Normals[3 * T[0] + 1], S.Normals[3 * T[0] + 2] };
                const bool Ccw = Cross.X * N.X + Cross.Y * N.Y + Cross.Z * N.Z > 0.0;
                S.Triangles.push_back(T[0]);
                S.Triangles.push_back(Ccw ? T[1] : T[2]);
                S.Triangles.push_back(Ccw ? T[2] : T[1]);
            }
        }
    return S;
}

Scene MakeSurfaceScene()
{
    Scene S{ "surface", 4.6, {}, {}, {}, {}, {}, {} };
    S.Surfaces = MakeTorus(96, 48);
    S.SurfaceDraw = ScenePresentation::Tinted(0.72f, 0.74f, 0.80f, 1.0f);
    S.SurfaceDraw.Shading = uint8_t(SurfaceShading::Plastic);
    return S;
}

Scene MakeLineScene()
{
    Scene S{ "line", 4.6, {}, {}, {}, {}, {}, {} };
    // Wire of the torus: 96 meridians and 48 parallels (solid edges).
    const int Meridians = 96, Parallels = 48, Steps = 64;
    const double R = 1.0, r = 0.35;
    for (int I = 0; I < Meridians; ++I)
    {
        const double U = 2.0 * Pi * I / Meridians;
        std::vector<Vec3> Pts;
        for (int J = 0; J <= Steps; ++J)
        {
            const double V = 2.0 * Pi * J / Steps;
            Pts.push_back({ (R + r * std::cos(V)) * std::cos(U), (R + r * std::cos(V)) * std::sin(U), r * std::sin(V) });
        }
        S.Segments.AppendPolyline(Pts, false);
    }
    for (int J = 0; J < Parallels; ++J)
    {
        const double V = 2.0 * Pi * J / Parallels;
        std::vector<Vec3> Pts;
        for (int I = 0; I <= Steps; ++I)
        {
            const double U = 2.0 * Pi * I / Steps;
            Pts.push_back({ (R + r * std::cos(V)) * std::cos(U), (R + r * std::cos(V)) * std::sin(U), r * std::sin(V) });
        }
        S.Segments.AppendPolyline(Pts, false);
    }
    S.SegmentDraw = ScenePresentation::Tinted(0.95f, 0.80f, 0.30f, 1.0f);
    S.SegmentDraw.LineWidth = 1.5f;
    S.SegmentDraw.PickIdentity = 7;

    return S;
}

Scene MakePointScene()
{
    Scene S{ "point", 6.2, {}, {}, {}, {}, {}, {} };
    const int N = 32;
    const PointGlyph Glyphs[5] = { PointGlyph::Disc, PointGlyph::Square, PointGlyph::Diamond, PointGlyph::Cross, PointGlyph::Ring };
    for (int I = 0; I < N; ++I)
        for (int J = 0; J < N; ++J)
        {
            const double X = -1.5 + 3.0 * I / (N - 1), Y = -1.5 + 3.0 * J / (N - 1);
            const double Z = 0.25 * std::sin(3.0 * X) * std::cos(3.0 * Y);
            S.Points.Append({ X, Y, Z }, Glyphs[(I + J) % 5]);
        }
    S.PointDraw = ScenePresentation::Tinted(0.30f, 0.78f, 0.95f, 1.0f);
    S.PointDraw.PointSize = 7.0f;
    S.PointDraw.PickIdentity = 9;
    return S;
}

void Draw(SoftwareRaster& Raster, const Scene& S)
{
    if (std::strcmp(S.Name, "surface") == 0) Raster.DrawSurface(S.Surfaces, S.SurfaceDraw);
    else if (std::strcmp(S.Name, "line") == 0) Raster.DrawSegments(S.Segments, S.SegmentDraw);
    else Raster.DrawPoints(S.Points, S.PointDraw);
}

ViewRecord ViewFor(const Scene& S, int Frame)
{
    CameraProjection Camera;
    Camera.Distance = S.Distance;
    Camera.Yaw = 2.0 * Pi * Frame / Frames;
    Camera.Pitch = 30.0 * Pi / 180.0;
    return Camera.ToViewRecord(Width, Height, 1.0);
}

uint64_t Hash(const RasterImage& I)
{
    uint64_t H = 1469598103934665603ull;
    for (uint8_t B : I.Pixels) { H ^= B; H *= 1099511628211ull; }
    return H;
}

} // namespace

int main(int Argc, char** Argv)
{
    const std::filesystem::path Out = Argc > 1 ? Argv[1] : "proof-out";
    std::filesystem::create_directories(Out);
    std::FILE* Tsv = std::fopen((Out / "timings.tsv").string().c_str(), "w");
    std::FILE* Checks = std::fopen((Out / "checks.txt").string().c_str(), "w");
    if (!Tsv || !Checks) { std::fprintf(stderr, "[PipelineMirror] RED — cannot open %s\n", Out.string().c_str()); return 1; }
    std::fprintf(Tsv, "pipeline\tframe\tcpu_ms\ttriangles\tsegments\tpoints\tfragments\tdepth_rejected\tback_facing\n");

    int Failures = 0;
    auto Check = [&](bool Ok, const char* What) {
        std::fprintf(Checks, "%s  %s\n", Ok ? "PASS" : "FAIL", What);
        std::fprintf(stderr, "[PipelineMirror] %s  %s\n", Ok ? "PASS" : "FAIL", What);
        if (!Ok) ++Failures;
    };

    SoftwareRaster Raster(Width, Height);
    std::fprintf(stderr, "[PipelineMirror] CPU exact mirror · %ux%u · %d frames/pipeline · timings are CPU wall-clock, not GPU\n",
                 Width, Height, Frames);

    const Scene Scenes[3] = { MakeSurfaceScene(), MakeLineScene(), MakePointScene() };
    for (const Scene& S : Scenes)
    {
        const std::string RawPath = (Out / ("frames_" + std::string(S.Name) + ".rgba")).string();
        std::FILE* Raw = std::fopen(RawPath.c_str(), "wb");
        if (!Raw) { std::fprintf(stderr, "[PipelineMirror] RED — cannot write %s\n", RawPath.c_str()); return 1; }
        std::fprintf(stderr, "[PipelineMirror] %-8s triangles %zu · segments %u · points %u\n", S.Name,
                     S.Surfaces.Triangles.size() / 3, S.Segments.SegmentCount(), S.Points.PointCount());

        for (int F = -WarmupFrames; F < Frames; ++F)
        {
            const int Frame = F < 0 ? 0 : F;
            ViewRecord View = ViewFor(S, Frame);
            auto T0 = std::chrono::steady_clock::now();
            Raster.BeginTarget(Backdrop);
            Raster.BindView(View);
            Draw(Raster, S);
            Raster.EndTarget();
            auto T1 = std::chrono::steady_clock::now();
            if (F < 0) continue;                                              // warm-up frames are not recorded
            const double Ms = std::chrono::duration<double, std::milli>(T1 - T0).count();
            const RasterExchange::Tally Tally = Raster.QueryTally();
            std::fprintf(Tsv, "%s\t%d\t%.4f\t%u\t%u\t%u\t%u\t%u\t%u\n", S.Name, Frame, Ms, Tally.Triangles, Tally.Segments,
                         Tally.Points, Tally.Fragments, Tally.DepthRejected, Tally.BackFacing);
            RasterImage Image = Raster.Readback();
            std::fwrite(Image.Pixels.data(), 1, Image.Pixels.size(), Raw);
        }
        std::fclose(Raw);

        // Determinism: the same view twice gives identical bytes.
        Raster.BeginTarget(Backdrop); Raster.BindView(ViewFor(S, 10)); Draw(Raster, S); Raster.EndTarget();
        const uint64_t First = Hash(Raster.Readback());
        Raster.BeginTarget(Backdrop); Raster.BindView(ViewFor(S, 10)); Draw(Raster, S); Raster.EndTarget();
        Check(First == Hash(Raster.Readback()), (std::string(S.Name) + ": identical bytes for an identical view").c_str());
    }

    // Pick identity: find a pixel the torus covers (its pick reads 42), and confirm empty pixels stay 0.
    // Depth ordering: a plane lying behind the torus must not change that pixel's colour or depth.
    {
        Scene S = MakeSurfaceScene();
        S.SurfaceDraw.PickIdentity = 42;
        Raster.BeginTarget(Backdrop); Raster.BindView(ViewFor(S, 0)); Raster.DrawSurface(S.Surfaces, S.SurfaceDraw); Raster.EndTarget();
        uint32_t Hits = 0, PX = 0, PY = 0;
        for (uint32_t Y = 0; Y < Height && Hits == 0; ++Y)
            for (uint32_t X = 0; X < Width; ++X)
                if (Raster.Pick(X, Y) == 42) { PX = X; PY = Y; ++Hits; break; }
        Check(Hits == 1, "surface pick identity 42 is reported somewhere in the frame");
        Check(Raster.Pick(2, 2) == 0, "pick is 0 where nothing is drawn");
        const float DepthBefore = Raster.Depth(PX, PY);
        const RasterImage Before = Raster.Readback();
        const size_t Offset = (size_t(PY) * Width + PX) * 4;
        const uint8_t Pixel0[3] = { Before.Pixels[Offset], Before.Pixels[Offset + 1], Before.Pixels[Offset + 2] };

        SurfaceStream Plane;
        Plane.Positions = { -3, -3, -1.5f,  3, -3, -1.5f,  3, 3, -1.5f,  -3, 3, -1.5f };
        Plane.Normals = { 0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1 };
        Plane.Parameters = { 0, 0,  1, 0,  1, 1,  0, 1 };
        Plane.Triangles = { 0, 1, 2,  0, 2, 3 };
        DrawRecord Red = ScenePresentation::Tinted(1.0f, 0.0f, 0.0f, 1.0f);
        Raster.BeginTarget(Backdrop); Raster.BindView(ViewFor(S, 0));
        Raster.DrawSurface(S.Surfaces, S.SurfaceDraw);
        Raster.DrawSurface(Plane, Red);
        Raster.EndTarget();
        const RasterImage After = Raster.Readback();
        Check(Raster.Depth(PX, PY) == DepthBefore, "a plane behind the torus leaves the torus depth untouched");
        Check(After.Pixels[Offset] == Pixel0[0] && After.Pixels[Offset + 1] == Pixel0[1] && After.Pixels[Offset + 2] == Pixel0[2],
              "a plane behind the torus leaves the torus colour untouched");
    }

    std::fclose(Tsv);
    std::fclose(Checks);
    std::fprintf(stderr, "[PipelineMirror] %s — %d failure(s)\n", Failures == 0 ? "GREEN" : "RED", Failures);
    return Failures == 0 ? 0 : 1;
}
