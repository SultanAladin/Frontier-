//============================================================================================================================================
//                                                  EDITORSELECTIONPROOF.CPP
//============================================================================================================================================
// 🧩 CPU proof of the editor's GPU picking, selection outline and transform gizmo — the exact arithmetic the
//    Vulkan build runs, executed here on the CPU over the same Cornell scene:
//
//      · PICKING — the visibility id image is rebuilt pixel by pixel from primary rays (the GPU writes it from
//        the visibility raster; same camera, same packing: (Instance & 0x3FFFF) << 14 | (Primitive & 0x3FFF),
//        invalid 0xFFFFFFFF). A tap reads ONE texel and the instance falls out of the top 18 bits — no proxy,
//        no lookup by position, exactly VisibilityExchange's copy of one texel into the readback extent.
//      · OUTLINE — Engine/Shaders/OutlineRecords.slang is compiled AS C++ (SlangCpuShim) and the compute
//        shader's loop is replayed per pixel: a green rim outside the covered set, which IS the silhouette at
//        the rendered resolution. The sphere's screen box corners are asserted NOT green — a bounding box
//        outline would paint them, the true silhouette cannot reach them.
//      · GIZMO — GizmoFigures composes the reference's pieces (References/Gizmo.html, 1:1) per mode, each mode
//        drawn INDIVIDUALLY, and a perspective-correct rasteriser shades them through GizmoRecords.slang — the
//        same text GizmoRaster.frag.slang includes on the GPU. The piece counts are asserted verbatim against
//        the reference's geometry, and the drag arithmetic (grip probe, axis drag, snap, readout) is exercised
//        the way the engine build drives it.
//
//    Sheets land in Exhibits/Gallery/Editor/: EditorSelectionProof_Pick.png (outline + translate gizmo over the
//    traced Cornell), EditorSelectionProof_Rotate.png, EditorSelectionProof_Scale.png.

#include "SlangCpuShim.h"
#include "OutlineRecords.slang"
#include "GizmoRecords.slang"

#include "GizmoFigures.h"
#include "../../../Engine/GeometricRaster/ClipProjection.h"
#include "PngWriteCounterpart.h"
#include "CpuReSTIRTrace.h"   // pulls RayTracingSolver / FlyThroughSolver the way EditorProof.cpp does

#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <cmath>
#include <vector>
#include <string>

namespace {

constexpr uint32_t kViewW = 480u;
constexpr uint32_t kViewH = 300u;
constexpr uint32_t kStrokeRadius = 3u;   // kSelectionOutlineStroke, SwapchainExchange.h

int Failures = 0;
void Expect(bool Condition, const char* Caption)
{
    std::fprintf(stderr, "  %s %s\n", Condition ? "PASS" : "FAIL", Caption);
    if (!Condition) ++Failures;
}

//------------------------------------------------------------------------------------------------------------------------
//                                            THE VISIBILITY ID IMAGE, CPU
//------------------------------------------------------------------------------------------------------------------------
// SceneRecords.slang packing, written by the visibility raster on the GPU; here every pixel's primary ray is
//    intersected against the same triangles and the span holding the hit triangle names the instance ordinal.

uint32_t SpanOfTriangle(const std::vector<Frontier::TriangleSpanRecord>& Spans, uint32_t Triangle)
{
    for (uint32_t S = 0u; S < Spans.size(); ++S)
        if (Triangle >= Spans[S].FirstTriangle && Triangle < Spans[S].FirstTriangle + Spans[S].TriangleCount)
            return S;
    return 0xFFFFFFFFu;
}

void FillVisibilityIds(const Frontier::ProjectZero::RayTracingSolver& Scene,
                       const Frontier::ProjectZero::FlyThroughSolver& Camera,
                       std::vector<uint32_t>& Ids)
{
    const Frontier::Vector3 O  = Camera.QuerySpatialLocation();
    const Frontier::Vector3 F  = Camera.QueryForwardVector();
    const Frontier::Vector3 Rt = Camera.QueryRightVector();
    const Frontier::Vector3 Up = Camera.QueryUpwardVector();
    const float TanHalf = std::tan(Camera.QueryFieldOfViewRadians() * 0.5f);
    const float Aspect  = static_cast<float>(kViewW) / static_cast<float>(kViewH);
    const auto& Spans = Scene.QuerySpans();
    for (uint32_t Y = 0u; Y < kViewH; ++Y)
        for (uint32_t X = 0u; X < kViewW; ++X)
        {
            const float Sx = ((static_cast<float>(X) + 0.5f) / static_cast<float>(kViewW) * 2.0f - 1.0f) * TanHalf * Aspect;
            const float Sy = (1.0f - (static_cast<float>(Y) + 0.5f) / static_cast<float>(kViewH) * 2.0f) * TanHalf;
            Frontier::ProjectZero::RayStructure Ray{
                O, CpuReSTIR::Norm(CpuReSTIR::Add(F, CpuReSTIR::Add(CpuReSTIR::Mul(Rt, Sx), CpuReSTIR::Mul(Up, Sy)))),
                1e-4f, 1e9f };
            const Frontier::ProjectZero::HitIntersection Hit = Scene.EvaluateIntersection(Ray);
            uint32_t Packed = kOutlineInvalidVisibility;
            if (Hit.ValidCondition)
            {
                const uint32_t Span = SpanOfTriangle(Spans, Hit.TriangleIndex);
                if (Span != 0xFFFFFFFFu)
                    Packed = ((Span & 0x3FFFFu) << 14u) | (Hit.TriangleIndex & 0x3FFFu);
            }
            Ids[static_cast<size_t>(Y) * kViewW + X] = Packed;
        }
}

//------------------------------------------------------------------------------------------------------------------------
//                                          THE OUTLINE PASS, THE SHADER'S LOOP
//------------------------------------------------------------------------------------------------------------------------
// SelectionOutline.slang's main(), replayed: inside pixels keep their shading, a not-inside pixel goes green
//    when a covered pixel sits within the round brush. OutlineCovers / OutlineWithinBrush are the .slang text.

void StrokeOutline(const std::vector<uint32_t>& Ids, uint32_t PickedCount, const uint32_t Picked[16],
                   unsigned char* Rgba)
{
    const int Radius = static_cast<int>(kStrokeRadius);
    for (int Y = 0; Y < static_cast<int>(kViewH); ++Y)
        for (int X = 0; X < static_cast<int>(kViewW); ++X)
        {
            const uint32_t Centre = Ids[static_cast<size_t>(Y) * kViewW + X];
            if (OutlineCovers(Centre, PickedCount, const_cast<uint32_t*>(Picked)))
                continue;
            bool Stroked = false;
            for (int Dy = -Radius; Dy <= Radius && !Stroked; ++Dy)
                for (int Dx = -Radius; Dx <= Radius && !Stroked; ++Dx)
                {
                    if (!OutlineWithinBrush(Dx, Dy, Radius)) continue;
                    const int Tx = X + Dx, Ty = Y + Dy;
                    if (Tx < 0 || Ty < 0 || Tx >= static_cast<int>(kViewW) || Ty >= static_cast<int>(kViewH)) continue;
                    if (OutlineCovers(Ids[static_cast<size_t>(Ty) * kViewW + Tx], PickedCount, const_cast<uint32_t*>(Picked)))
                        Stroked = true;
                }
            if (Stroked)
            {
                unsigned char* P = Rgba + (static_cast<size_t>(Y) * kViewW + X) * 4u;
                P[0] = static_cast<unsigned char>(kOutlineTint.x * 255.0f + 0.5f);
                P[1] = static_cast<unsigned char>(kOutlineTint.y * 255.0f + 0.5f);
                P[2] = static_cast<unsigned char>(kOutlineTint.z * 255.0f + 0.5f);
                P[3] = 255u;
            }
        }
}

bool IsOutlineGreen(const unsigned char* P)
{
    return P[1] > 150u && P[0] < 60u && P[2] < 40u;
}

//------------------------------------------------------------------------------------------------------------------------
//                                         THE GIZMO RASTER, GPU ARITHMETIC ON CPU
//------------------------------------------------------------------------------------------------------------------------
// GizmoRaster.vert projects Location through ViewClip and the fragment shades through GizmoShade — replayed
//    here with perspective-correct interpolation, no depth test (the GPU pipeline tests none: the grips read
//    over the object), alpha blending exactly the pipeline's SRC_ALPHA / ONE_MINUS_SRC_ALPHA.

struct ProjectedFigure { float Px, Py, W; bool Live; };

ProjectedFigure ProjectFigure(const Frontier::Matrix4x4& ViewClip, const float Location[3])
{
    float Clip[4];
    for (int R = 0; R < 4; ++R)
        Clip[R] = ViewClip.Columns[0][R] * Location[0] + ViewClip.Columns[1][R] * Location[1]
                + ViewClip.Columns[2][R] * Location[2] + ViewClip.Columns[3][R];
    ProjectedFigure Out{};
    if (Clip[3] < 1e-4f) { Out.Live = false; return Out; }
    Out.W    = Clip[3];
    Out.Px   = (Clip[0] / Clip[3] * 0.5f + 0.5f) * static_cast<float>(kViewW);
    Out.Py   = (Clip[1] / Clip[3] * 0.5f + 0.5f) * static_cast<float>(kViewH);
    Out.Live = true;
    return Out;
}

void BlendTexel(unsigned char* P, vec3 Shaded, float Alpha)
{
    P[0] = static_cast<unsigned char>((Shaded.x * Alpha + static_cast<float>(P[0]) / 255.0f * (1.0f - Alpha)) * 255.0f + 0.5f);
    P[1] = static_cast<unsigned char>((Shaded.y * Alpha + static_cast<float>(P[1]) / 255.0f * (1.0f - Alpha)) * 255.0f + 0.5f);
    P[2] = static_cast<unsigned char>((Shaded.z * Alpha + static_cast<float>(P[2]) / 255.0f * (1.0f - Alpha)) * 255.0f + 0.5f);
}

void RasteriseGizmo(const Frontier::GizmoVertex* Triangles, uint32_t TriangleCount,
                    const Frontier::GizmoVertex* Strokes, uint32_t StrokeCount,
                    const Frontier::Matrix4x4& ViewClip, const float Eye[3], unsigned char* Rgba)
{
    const vec3 TowardLight = normalize(vec3(4.0f, 6.0f, 5.0f));   // the reference's lamp at (4, 6, 5)
    for (uint32_t T = 0u; T + 2u < TriangleCount; T += 3u)
    {
        const Frontier::GizmoVertex& A = Triangles[T];
        const Frontier::GizmoVertex& B = Triangles[T + 1u];
        const Frontier::GizmoVertex& C = Triangles[T + 2u];
        const ProjectedFigure Pa = ProjectFigure(ViewClip, A.Location);
        const ProjectedFigure Pb = ProjectFigure(ViewClip, B.Location);
        const ProjectedFigure Pc = ProjectFigure(ViewClip, C.Location);
        if (!Pa.Live || !Pb.Live || !Pc.Live) continue;
        const float MinX = std::fmax(0.0f, std::floor(std::fmin(Pa.Px, std::fmin(Pb.Px, Pc.Px))));
        const float MaxX = std::fmin(static_cast<float>(kViewW - 1u), std::ceil(std::fmax(Pa.Px, std::fmax(Pb.Px, Pc.Px))));
        const float MinY = std::fmax(0.0f, std::floor(std::fmin(Pa.Py, std::fmin(Pb.Py, Pc.Py))));
        const float MaxY = std::fmin(static_cast<float>(kViewH - 1u), std::ceil(std::fmax(Pa.Py, std::fmax(Pb.Py, Pc.Py))));
        const float Area = (Pb.Px - Pa.Px) * (Pc.Py - Pa.Py) - (Pb.Py - Pa.Py) * (Pc.Px - Pa.Px);
        if (std::fabs(Area) < 1e-6f) continue;
        for (float Y = MinY; Y <= MaxY; Y += 1.0f)
            for (float X = MinX; X <= MaxX; X += 1.0f)
            {
                const float Cx = X + 0.5f, Cy = Y + 0.5f;
                float U = ((Pc.Px - Pb.Px) * (Cy - Pb.Py) - (Pc.Py - Pb.Py) * (Cx - Pb.Px)) / Area;
                float V = ((Pa.Px - Pc.Px) * (Cy - Pc.Py) - (Pa.Py - Pc.Py) * (Cx - Pc.Px)) / Area;
                const float S = 1.0f - U - V;
                if (U < 0.0f || V < 0.0f || S < 0.0f) continue;
                // Perspective-correct: attributes ride 1/w.
                const float Wu = U / Pa.W, Wv = V / Pb.W, Ws = S / Pc.W;
                const float Wsum = Wu + Wv + Ws;
                const float Ka = Wu / Wsum, Kb = Wv / Wsum, Kc = Ws / Wsum;
                vec3 World(A.Location[0] * Ka + B.Location[0] * Kb + C.Location[0] * Kc,
                           A.Location[1] * Ka + B.Location[1] * Kb + C.Location[1] * Kc,
                           A.Location[2] * Ka + B.Location[2] * Kb + C.Location[2] * Kc);
                vec3 Normal(A.Normal[0] * Ka + B.Normal[0] * Kb + C.Normal[0] * Kc,
                            A.Normal[1] * Ka + B.Normal[1] * Kb + C.Normal[1] * Kc,
                            A.Normal[2] * Ka + B.Normal[2] * Kb + C.Normal[2] * Kc);
                const vec3 Tint(A.Tint[0], A.Tint[1], A.Tint[2]);
                const vec3 TowardEye = normalize(vec3(Eye[0] - World.x, Eye[1] - World.y, Eye[2] - World.z));
                const vec3 Shaded = GizmoShade(Tint, normalize(Normal), TowardEye, TowardLight, A.Emissive, A.Unlit);
                unsigned char* P = Rgba + (static_cast<size_t>(Y) * kViewW + static_cast<size_t>(X)) * 4u;
                BlendTexel(P, Shaded, A.Tint[3]);
            }
    }
    // The line list — the corner quads' two opaque edges, unlit, exactly the second pipeline's draw.
    for (uint32_t L = 0u; L + 1u < StrokeCount; L += 2u)
    {
        const ProjectedFigure Pa = ProjectFigure(ViewClip, Strokes[L].Location);
        const ProjectedFigure Pb = ProjectFigure(ViewClip, Strokes[L + 1u].Location);
        if (!Pa.Live || !Pb.Live) continue;
        const float Dx = Pb.Px - Pa.Px, Dy = Pb.Py - Pa.Py;
        const int Steps = static_cast<int>(std::fmax(std::fabs(Dx), std::fabs(Dy))) + 1;
        for (int I = 0; I <= Steps; ++I)
        {
            const float K = static_cast<float>(I) / static_cast<float>(Steps);
            const int X = static_cast<int>(Pa.Px + Dx * K), Y = static_cast<int>(Pa.Py + Dy * K);
            if (X < 0 || Y < 0 || X >= static_cast<int>(kViewW) || Y >= static_cast<int>(kViewH)) continue;
            const vec3 Tint(Strokes[L].Tint[0], Strokes[L].Tint[1], Strokes[L].Tint[2]);
            unsigned char* P = Rgba + (static_cast<size_t>(Y) * kViewW + X) * 4u;
            BlendTexel(P, Tint, Strokes[L].Tint[3]);
        }
    }
}

// A ray from the camera through the pixel nearest a world point — how the proof aims taps and drags.
void RayThroughWorld(const Frontier::ProjectZero::FlyThroughSolver& Camera, const float Point[3],
                     float Origin[3], float Toward[3])
{
    const Frontier::Vector3 O = Camera.QuerySpatialLocation();
    Origin[0] = O.x; Origin[1] = O.y; Origin[2] = O.z;
    const float Lx = Point[0] - O.x, Ly = Point[1] - O.y, Lz = Point[2] - O.z;
    const float L = std::sqrt(Lx * Lx + Ly * Ly + Lz * Lz);
    Toward[0] = Lx / L; Toward[1] = Ly / L; Toward[2] = Lz / L;
}

} // namespace

int main()
{
    std::fprintf(stderr, "[SelectionProof] the Cornell scene, traced on the CPU as the GPU build renders it\n");
    Frontier::ProjectZero::RayTracingSolver Scene;
    Scene.ConstructCornellBoxScene();
    Frontier::ProjectZero::FlyThroughSolver Camera;
    Camera.AssignSpatialLocation(Frontier::Vector3{ 0.35f, -4.6f, 1.75f });
    Camera.AssignOrientationEuler(-0.06f, 0.0f, 0.0f);   // yaw 0 faces +Y, straight into the room
    Camera.AssignAspectRatio(static_cast<float>(kViewW) / static_cast<float>(kViewH));

    const char* FramesText = std::getenv("EDITORPROOF_FRAMES");
    const uint32_t Frames = FramesText ? static_cast<uint32_t>(std::atoi(FramesText)) : 16u;
    std::vector<unsigned char> Traced(static_cast<size_t>(kViewW) * kViewH * 4u);
    CpuReSTIR::Render(Scene, Camera, kViewW, kViewH, Frames, 8u, 1.05f, Traced.data());

    // ── The visibility id image, and the spans that name its ordinals ────────────────────────────────────────
    const auto& Spans = Scene.QuerySpans();
    uint32_t TallBox = 0xFFFFFFFFu, ShortBox = 0xFFFFFFFFu, Sphere = 0xFFFFFFFFu;
    for (uint32_t S = 0u; S < Spans.size(); ++S)
    {
        if (Spans[S].Name == "Tall Box")  TallBox  = S;
        if (Spans[S].Name == "Short Box") ShortBox = S;
        if (Spans[S].Name == "Sphere")    Sphere   = S;
    }
    Expect(TallBox != 0xFFFFFFFFu && ShortBox != 0xFFFFFFFFu && Sphere != 0xFFFFFFFFu,
           "the Cornell spans carry the Tall Box, the Short Box and the Sphere");

    std::vector<uint32_t> Ids(static_cast<size_t>(kViewW) * kViewH);
    FillVisibilityIds(Scene, Camera, Ids);

    // ── GPU picking, simulated exactly: one texel read, instance from the top 18 bits ────────────────────────
    std::fprintf(stderr, "[SelectionProof] picking: one texel of the id image\n");
    uint32_t TallCovered = 0u, TapX = 0u, TapY = 0u;
    for (uint32_t Y = 0u; Y < kViewH; ++Y)
        for (uint32_t X = 0u; X < kViewW; ++X)
        {
            const uint32_t Packed = Ids[static_cast<size_t>(Y) * kViewW + X];
            if (Packed != kOutlineInvalidVisibility && OutlineInstanceOfPacked(Packed) == TallBox)
            { ++TallCovered; TapX = X; TapY = Y; }
        }
    Expect(TallCovered > 400u, "the Tall Box owns pixels in the id image");
    const uint32_t TapPacked = Ids[static_cast<size_t>(TapY) * kViewW + TapX];
    Expect(OutlineInstanceOfPacked(TapPacked) == TallBox, "a tap on the Tall Box answers the Tall Box's ordinal");
    Expect(Ids[0] == kOutlineInvalidVisibility || OutlineInstanceOfPacked(Ids[0]) < Spans.size(),
           "every packed id names a live span or the invalid clear");

    // ── The outline: silhouette, never a box ─────────────────────────────────────────────────────────────────
    std::fprintf(stderr, "[SelectionProof] outline: the silhouette stroke over the traced frame\n");
    uint32_t Picked[16] = { TallBox, Sphere };
    std::vector<unsigned char> PickSheet = Traced;
    StrokeOutline(Ids, 2u, Picked, PickSheet.data());

    uint32_t GreenTotal = 0u;
    int SphMinX = static_cast<int>(kViewW), SphMaxX = -1, SphMinY = static_cast<int>(kViewH), SphMaxY = -1;
    for (int Y = 0; Y < static_cast<int>(kViewH); ++Y)
        for (int X = 0; X < static_cast<int>(kViewW); ++X)
        {
            const unsigned char* P = PickSheet.data() + (static_cast<size_t>(Y) * kViewW + X) * 4u;
            if (IsOutlineGreen(P) && !OutlineCovers(Ids[static_cast<size_t>(Y) * kViewW + X], 2u, Picked)) ++GreenTotal;
            const uint32_t Packed = Ids[static_cast<size_t>(Y) * kViewW + X];
            if (Packed != kOutlineInvalidVisibility && OutlineInstanceOfPacked(Packed) == Sphere)
            {
                SphMinX = std::min(SphMinX, X); SphMaxX = std::max(SphMaxX, X);
                SphMinY = std::min(SphMinY, Y); SphMaxY = std::max(SphMaxY, Y);
            }
        }
    Expect(GreenTotal > 200u, "the green stroke exists and sits outside the covered set");

    // Every stroked pixel hugs the silhouette: within the brush radius of a covered pixel.
    bool Hugging = true;
    const int Radius = static_cast<int>(kStrokeRadius);
    for (int Y = 0; Y < static_cast<int>(kViewH) && Hugging; ++Y)
        for (int X = 0; X < static_cast<int>(kViewW) && Hugging; ++X)
        {
            const unsigned char* P = PickSheet.data() + (static_cast<size_t>(Y) * kViewW + X) * 4u;
            if (!IsOutlineGreen(P) || OutlineCovers(Ids[static_cast<size_t>(Y) * kViewW + X], 2u, Picked)) continue;
            bool Near = false;
            for (int Dy = -Radius; Dy <= Radius && !Near; ++Dy)
                for (int Dx = -Radius; Dx <= Radius && !Near; ++Dx)
                {
                    const int Tx = X + Dx, Ty = Y + Dy;
                    if (Tx < 0 || Ty < 0 || Tx >= static_cast<int>(kViewW) || Ty >= static_cast<int>(kViewH)) continue;
                    if (OutlineWithinBrush(Dx, Dy, Radius)
                        && OutlineCovers(Ids[static_cast<size_t>(Ty) * kViewW + Tx], 2u, Picked)) Near = true;
                }
            if (!Near) Hugging = false;
        }
    Expect(Hugging, "every stroked pixel sits within the brush of the silhouette (no floating box lines)");

    // The sphere reads as an ellipse on screen: a BOUNDING BOX outline would paint its screen-box corners,
    //    the true silhouette cannot reach them (the stroke hugs the curve, the corners sit ~29% outside it).
    Expect(SphMaxX > SphMinX + 10 && SphMaxY > SphMinY + 10, "the sphere covers a readable screen extent");
    bool CornersClean = true;
    const int CornerX[4] = { SphMinX - 1, SphMaxX + 1, SphMinX - 1, SphMaxX + 1 };
    const int CornerY[4] = { SphMinY - 1, SphMinY - 1, SphMaxY + 1, SphMaxY + 1 };
    for (int C = 0; C < 4; ++C)
    {
        const int X = std::min(std::max(CornerX[C], 0), static_cast<int>(kViewW) - 1);
        const int Y = std::min(std::max(CornerY[C], 0), static_cast<int>(kViewH) - 1);
        if (IsOutlineGreen(PickSheet.data() + (static_cast<size_t>(Y) * kViewW + X) * 4u)) CornersClean = false;
    }
    Expect(CornersClean, "the sphere's screen-box corners are NOT stroked - the outline is the silhouette, not a box");

    // ── The gizmo: the reference's pieces, one mode at a time ────────────────────────────────────────────────
    std::fprintf(stderr, "[SelectionProof] gizmo: composing and rasterising the reference's pieces per mode\n");
    Frontier::GizmoPose Pose;
    Pose.Origin[0] = -0.90f; Pose.Origin[1] = 2.70f; Pose.Origin[2] = 0.90f;   // the Tall Box's placement
    {
        const Frontier::Vector3 O = Camera.QuerySpatialLocation();
        const float Dx = Pose.Origin[0] - O.x, Dy = Pose.Origin[1] - O.y, Dz = Pose.Origin[2] - O.z;
        const float Away = std::sqrt(Dx * Dx + Dy * Dy + Dz * Dz);
        Pose.Reach = std::fmax(0.2f, Away * std::tan(Camera.QueryFieldOfViewRadians() * 0.5f) * 0.35f);
    }

    Frontier::CameraClipConfiguration ClipSeat;
    ClipSeat.Origin             = Camera.QuerySpatialLocation();
    ClipSeat.Forward            = Camera.QueryForwardVector();
    ClipSeat.Right              = Camera.QueryRightVector();
    ClipSeat.Up                 = Camera.QueryUpwardVector();
    ClipSeat.TanHalfFieldOfView = std::tan(Camera.QueryFieldOfViewRadians() * 0.5f);
    ClipSeat.AspectRatio        = static_cast<float>(kViewW) / static_cast<float>(kViewH);
    ClipSeat.NearDistance       = 0.05f;
    const Frontier::Matrix4x4 ViewClip = Frontier::ConstructViewClipProjection(ClipSeat);
    const Frontier::Vector3 EyeSeat = Camera.QuerySpatialLocation();
    const float Eye[3]         = { EyeSeat.x, EyeSeat.y, EyeSeat.z };
    const float EyeRight[3]    = { ClipSeat.Right.x, ClipSeat.Right.y, ClipSeat.Right.z };
    const float EyeUp[3]       = { ClipSeat.Up.x, ClipSeat.Up.y, ClipSeat.Up.z };

    std::vector<Frontier::GizmoVertex> Triangles(4800u);
    std::vector<Frontier::GizmoVertex> Strokes(64u);

    // The reference's exact piece counts, per mode drawn individually:
    //    cone 24·2 = 48 tris/axis, quad 2, arc 24·2 = 48, cylinder 24·4 = 96, ring 48·12·2 = 1152.
    struct ModeSheet { Frontier::GizmoMode Mode; const char* Png; uint32_t Tris; uint32_t StrokeVerts; };
    const ModeSheet Sheets[3] = {
        { Frontier::GizmoMode::Translate, "Exhibits/Gallery/Editor/EditorSelectionProof_Pick.png",   3u * 50u + 1152u, 12u },
        { Frontier::GizmoMode::Rotate,    "Exhibits/Gallery/Editor/EditorSelectionProof_Rotate.png", 3u * 48u + 1152u, 0u  },
        { Frontier::GizmoMode::Scale,     "Exhibits/Gallery/Editor/EditorSelectionProof_Scale.png",  3u * 96u + 1152u, 0u  },
    };
    for (const ModeSheet& Sheet : Sheets)
    {
        uint32_t StrokeSeated = 0u;
        const uint32_t TriangleSeated = Frontier::ComposeGizmoVertices(
            Sheet.Mode, Pose, Frontier::GizmoGrip::None, EyeRight, EyeUp,
            Triangles.data(), static_cast<uint32_t>(Triangles.size()),
            Strokes.data(), static_cast<uint32_t>(Strokes.size()), &StrokeSeated);
        char Caption[128];
        std::snprintf(Caption, sizeof(Caption), "mode %u composes the reference's %u triangles and %u stroke vertices",
                      static_cast<uint32_t>(Sheet.Mode), Sheet.Tris, Sheet.StrokeVerts);
        Expect(TriangleSeated == Sheet.Tris * 3u && StrokeSeated == Sheet.StrokeVerts, Caption);

        std::vector<unsigned char> ModeSheetRgba = Sheet.Mode == Frontier::GizmoMode::Translate ? PickSheet : Traced;
        RasteriseGizmo(Triangles.data(), TriangleSeated, Strokes.data(), StrokeSeated, ViewClip, Eye, ModeSheetRgba.data());

        // Each axis tint must land on the sheet — the reference's red, green and blue grips, and the white ring.
        uint32_t RedSeen = 0u, GreenSeen = 0u, BlueSeen = 0u, WhiteSeen = 0u;
        for (size_t I = 0u; I < static_cast<size_t>(kViewW) * kViewH; ++I)
        {
            const unsigned char* P = ModeSheetRgba.data() + I * 4u;
            if (P[0] > 150u && P[1] < 90u && P[2] < 90u) ++RedSeen;
            if (P[1] > 150u && P[0] < 90u && P[2] < 90u) ++GreenSeen;
            if (P[2] > 150u && P[0] < 110u && P[1] < 130u) ++BlueSeen;
            if (P[0] > 200u && P[1] > 200u && P[2] > 200u) ++WhiteSeen;
        }
        std::snprintf(Caption, sizeof(Caption), "mode %u shows the red, green and blue grips and the white ring (%u/%u/%u/%u px)",
                      static_cast<uint32_t>(Sheet.Mode), RedSeen, GreenSeen, BlueSeen, WhiteSeen);
        Expect(RedSeen > 20u && GreenSeen > 20u && BlueSeen > 20u && WhiteSeen > 5u, Caption);

        // WritePng speaks RGB; the working sheets ride RGBA for the blend arithmetic.
        std::vector<unsigned char> Rgb(static_cast<size_t>(kViewW) * kViewH * 3u);
        for (size_t I = 0u; I < static_cast<size_t>(kViewW) * kViewH; ++I)
        {
            Rgb[I * 3u]      = ModeSheetRgba[I * 4u];
            Rgb[I * 3u + 1u] = ModeSheetRgba[I * 4u + 1u];
            Rgb[I * 3u + 2u] = ModeSheetRgba[I * 4u + 2u];
        }
        if (PngWriteCounterpart::WritePng(Sheet.Png, static_cast<int>(kViewW), static_cast<int>(kViewH), 3,
                                          Rgb.data(), static_cast<int>(kViewW) * 3) == 0)
        {
            std::fprintf(stderr, "  FAIL could not write %s\n", Sheet.Png);
            ++Failures;
        }
        else
            std::fprintf(stderr, "  wrote %s\n", Sheet.Png);
    }

    // ── The drag arithmetic: Blender's behaviour, measured from the press ────────────────────────────────────
    std::fprintf(stderr, "[SelectionProof] drags: grip probe, axis move, snap, turn, scale clamp, readout\n");
    {
        // The +X cone answers MoveX under a ray aimed at its tip.
        float Origin[3], Toward[3];
        const float ConeTip[3] = { Pose.Origin[0] + Frontier::kGizmoTipReach * Pose.Reach, Pose.Origin[1], Pose.Origin[2] };
        RayThroughWorld(Camera, ConeTip, Origin, Toward);
        Expect(Frontier::ProbeGizmoGrip(Frontier::GizmoMode::Translate, Pose, Origin, Toward) == Frontier::GizmoGrip::MoveX,
               "a ray at the +X cone probes MoveX");

        // A drag along +X: press at the cone, advance 0.4 m to the right — the demand answers the axis offset.
        Frontier::GizmoDrag Drag{};
        Expect(Frontier::BeginGizmoDrag(Frontier::GizmoGrip::MoveX, Pose, Origin, Toward, &Drag), "the press seeds the X drag");
        Frontier::GizmoDemand Demand{};
        const float Landed[3] = { ConeTip[0] + 0.4f, ConeTip[1], ConeTip[2] };
        float Origin2[3], Toward2[3];
        RayThroughWorld(Camera, Landed, Origin2, Toward2);
        Expect(Frontier::AdvanceGizmoDrag(Drag, Pose, Origin2, Toward2, false, &Demand), "the move advances");
        Expect(std::fabs(Demand.Move[0] - 0.4f) < 0.06f && std::fabs(Demand.Move[1]) < 0.05f,
               "the unsnapped X move measures the pointer's travel from the press");
        Expect(Frontier::AdvanceGizmoDrag(Drag, Pose, Origin2, Toward2, true, &Demand), "the snapped move advances");
        const float Snapped = Demand.Move[0] / Frontier::kGizmoSnapMove;
        Expect(std::fabs(Snapped - std::round(Snapped)) < 1e-3f, "Ctrl snaps the TOTAL move to 0.25 steps");
        Expect(std::strstr(Demand.Readout, "move") != nullptr, "the readout speaks the reference's line");

        // A turn about Z: press on the arc, sweep the pointer — the angle is measured from the press and
        //    Ctrl snaps it to 5 degree steps.
        const float ArcSeat = Frontier::kGizmoArcRadius * Pose.Reach * 0.7071f;
        const float ArcAt[3] = { Pose.Origin[0] + ArcSeat, Pose.Origin[1] + ArcSeat, Pose.Origin[2] };
        RayThroughWorld(Camera, ArcAt, Origin, Toward);
        Frontier::GizmoDrag Turn{};
        Expect(Frontier::BeginGizmoDrag(Frontier::GizmoGrip::TurnZ, Pose, Origin, Toward, &Turn), "the press seeds the Z turn");
        const float Swept[3] = { Pose.Origin[0] + ArcSeat * 0.5f, Pose.Origin[1] + ArcSeat * 1.32f, Pose.Origin[2] };
        RayThroughWorld(Camera, Swept, Origin2, Toward2);
        Expect(Frontier::AdvanceGizmoDrag(Turn, Pose, Origin2, Toward2, false, &Demand) && std::fabs(Demand.TurnAngle) > 0.05f,
               "the turn sweeps an angle from the press");
        Expect(Frontier::AdvanceGizmoDrag(Turn, Pose, Origin2, Toward2, true, &Demand), "the snapped turn advances");
        const float Degrees = Demand.TurnAngle / Frontier::kGizmoSnapTurn;
        Expect(std::fabs(Degrees - std::round(Degrees)) < 1e-3f, "Ctrl snaps the turn to 5 degree steps");

        // A scale drag: crowding the origin far enough clamps at the floor, never zero or negative.
        const float GripAt[3] = { Pose.Origin[0] + (Frontier::kGizmoTipReach - Frontier::kGizmoCylinderInset) * Pose.Reach,
                                  Pose.Origin[1], Pose.Origin[2] };
        RayThroughWorld(Camera, GripAt, Origin, Toward);
        Frontier::GizmoDrag Stretch{};
        Expect(Frontier::BeginGizmoDrag(Frontier::GizmoGrip::ScaleX, Pose, Origin, Toward, &Stretch), "the press seeds the X scale");
        const float Crowded[3] = { Pose.Origin[0] - 3.0f * Pose.Reach, Pose.Origin[1], Pose.Origin[2] };
        RayThroughWorld(Camera, Crowded, Origin2, Toward2);
        Expect(Frontier::AdvanceGizmoDrag(Stretch, Pose, Origin2, Toward2, false, &Demand) && Demand.ScaleFactor >= 0.05f,
               "the scale clamps at 0.05, never zero or negative");
    }

    std::fprintf(stderr, "[SelectionProof] %s\n", Failures == 0 ? "every figure agrees" : "FAILURES above");
    return Failures == 0 ? 0 : 1;
}
