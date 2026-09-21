//============================================================================================================================================
//                                   AUTOMOTIVE MATERIAL PREVIEW SCENE
//============================================================================================================================================
// A separate, reviewable CPU scene for the automotive material milestone. It includes the exact
// MaterialEvaluation.slang text through ShaderballPreview.cpp, and uses the shared profile constructors in
// AutomotiveMaterialProfiles.slang. Nothing here is wired into Project-Zero's scene or host serialization.
#define SHADERBALL_PREVIEW_LIB
#include "../../../Engine/ContentInterchange/ShaderballPreview.cpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace
{
constexpr float kPi = 3.14159265358979323846f;

void AddSmoothTri(const vec3& A, const vec3& B, const vec3& C,
                  const vec3& Na, const vec3& Nb, const vec3& Nc, int Mat)
{
    size_t Base = g_Tris.size();
    AddTri(A, B, C, Mat);
    Tri& T = g_Tris[Base];
    T.Na = Na; T.Nb = Nb; T.Nc = Nc;
}

void AddSphere(const vec3& Center, float Radius, int Mat, int Segments = 36, int Rings = 20)
{
    for (int Y = 0; Y < Rings; ++Y)
    {
        float P0 = kPi * static_cast<float>(Y) / Rings;
        float P1 = kPi * static_cast<float>(Y + 1) / Rings;
        for (int X = 0; X < Segments; ++X)
        {
            float U0 = 2.0f * kPi * static_cast<float>(X) / Segments;
            float U1 = 2.0f * kPi * static_cast<float>(X + 1) / Segments;
            auto Point = [&](float P, float U)
            {
                return Center + Radius * vec3(std::sin(P) * std::cos(U),
                                              std::sin(P) * std::sin(U), std::cos(P));
            };
            vec3 A = Point(P0, U0), B = Point(P0, U1), C = Point(P1, U1), D = Point(P1, U0);
            if (Y != 0)
                AddSmoothTri(A, B, D, normalize(A - Center), normalize(B - Center), normalize(D - Center), Mat);
            if (Y != Rings - 1)
                AddSmoothTri(B, C, D, normalize(B - Center), normalize(C - Center), normalize(D - Center), Mat);
        }
    }
}

// A torus with its hole axis along +Y, so it reads as a tire or exhaust ring from the camera.
void AddTorus(const vec3& Center, float Major, float Minor, int Mat, int Segments = 48, int Tube = 16)
{
    for (int Y = 0; Y < Tube; ++Y)
    {
        float V0 = 2.0f * kPi * static_cast<float>(Y) / Tube;
        float V1 = 2.0f * kPi * static_cast<float>(Y + 1) / Tube;
        for (int X = 0; X < Segments; ++X)
        {
            float U0 = 2.0f * kPi * static_cast<float>(X) / Segments;
            float U1 = 2.0f * kPi * static_cast<float>(X + 1) / Segments;
            auto Point = [&](float U, float V)
            {
                float R = Major + Minor * std::cos(V);
                return Center + vec3(R * std::cos(U), Minor * std::sin(V), R * std::sin(U));
            };
            auto Normal = [&](float U, float V)
            {
                return normalize(vec3(std::cos(V) * std::cos(U), std::sin(V), std::cos(V) * std::sin(U)));
            };
            vec3 A = Point(U0, V0), B = Point(U1, V0), C = Point(U1, V1), D = Point(U0, V1);
            if (dot(cross(B - A, D - A), Normal(U0, V0)) < 0.0f)
            {
                vec3 T = B; B = D; D = T;
            }
            AddSmoothTri(A, B, D, Normal(U0, V0), Normal(U1, V0), Normal(U0, V1), Mat);
            AddSmoothTri(B, C, D, Normal(U1, V0), Normal(U1, V1), Normal(U0, V1), Mat);
        }
    }
}

// A cylinder with its axis along Y; used as a brake rotor / machined alloy puck.
void AddCylinder(const vec3& Center, float Radius, float HalfLength, int Mat, int Segments = 48)
{
    for (int X = 0; X < Segments; ++X)
    {
        float U0 = 2.0f * kPi * static_cast<float>(X) / Segments;
        float U1 = 2.0f * kPi * static_cast<float>(X + 1) / Segments;
        vec3 R0(std::cos(U0), 0.0f, std::sin(U0));
        vec3 R1(std::cos(U1), 0.0f, std::sin(U1));
        vec3 A = Center + vec3(R0.x * Radius, -HalfLength, R0.z * Radius);
        vec3 B = Center + vec3(R1.x * Radius, -HalfLength, R1.z * Radius);
        vec3 C = Center + vec3(R1.x * Radius, HalfLength, R1.z * Radius);
        vec3 D = Center + vec3(R0.x * Radius, HalfLength, R0.z * Radius);
        AddSmoothTri(A, B, D, R0, R1, R0, Mat);
        AddSmoothTri(B, C, D, R1, R1, R0, Mat);
        vec3 F0 = Center + vec3(R0.x * Radius, -HalfLength, R0.z * Radius);
        vec3 F1 = Center + vec3(R1.x * Radius, -HalfLength, R1.z * Radius);
        AddSmoothTri(Center + vec3(0.0f, -HalfLength, 0.0f), F1, F0,
                     vec3(0.0f, -1.0f, 0.0f), vec3(0.0f, -1.0f, 0.0f), vec3(0.0f, -1.0f, 0.0f), Mat);
        vec3 B0 = Center + vec3(R0.x * Radius, HalfLength, R0.z * Radius);
        vec3 B1 = Center + vec3(R1.x * Radius, HalfLength, R1.z * Radius);
        AddSmoothTri(Center + vec3(0.0f, HalfLength, 0.0f), B0, B1,
                     vec3(0.0f, 1.0f, 0.0f), vec3(0.0f, 1.0f, 0.0f), vec3(0.0f, 1.0f, 0.0f), Mat);
    }
}

void AddQuad(const vec3& A, const vec3& B, const vec3& C, const vec3& D, int Mat)
{
    AddTri(A, B, C, Mat);
    AddTri(A, C, D, Mat);
}

ShadingRecord GroundMaterial()
{
    ShadingRecord M = AutomotiveDefaults();
    M.BaseColor = vec3(0.07, 0.085, 0.11);
    M.DiffuseRoughness = 0.82;
    M.SpecularWeight = 0.18;
    M.SpecularRoughness = 0.72;
    return M;
}

ShadingRecord PanelMaterial()
{
    ShadingRecord M = AutomotiveDefaults();
    M.BaseColor = vec3(0.30, 0.33, 0.38);
    M.DiffuseRoughness = 0.62;
    M.SpecularWeight = 0.25;
    M.SpecularRoughness = 0.42;
    return M;
}

void ClearScene()
{
    g_Tris.clear();
    g_Nodes.clear();
    g_Order.clear();
    g_Lights.clear();
    g_SolidBall = true;
    for (ShadingRecord& M : g_Mats) M = AutomotiveDefaults();
}

void FinaliseScene()
{
    g_Order.resize(g_Tris.size());
    for (size_t I = 0; I < g_Tris.size(); ++I) g_Order[I] = static_cast<int>(I);
    g_Nodes.emplace_back();
    BuildBvh(0, 0, static_cast<int>(g_Tris.size()));
}

void AddStudioRig(const vec3& Subject)
{
    AddSoftbox(vec3(-4.5f, -3.0f, 5.8f), Subject - vec3(-4.5f, -3.0f, 5.8f),
               vec3(0.0f, 0.0f, 1.0f), 2.0f, 1.15f, vec3(18.0f, 19.0f, 22.0f), 7);
    AddSoftbox(vec3(0.0f, 4.0f, 5.3f), Subject - vec3(0.0f, 4.0f, 5.3f),
               vec3(0.0f, 0.0f, 1.0f), 2.2f, 0.65f, vec3(11.0f, 9.0f, 7.0f), 7);
    // A broad rear light makes transmission through the red tail lens readable.
    AddSoftbox(vec3(-0.3f, 4.8f, 2.0f), Subject - vec3(-0.3f, 4.8f, 2.0f),
               vec3(0.0f, 0.0f, 1.0f), 1.3f, 1.3f, vec3(7.0f, 7.0f, 7.0f), 7);
}

void BuildSuiteScene()
{
    ClearScene();
    // 0 is the solid red tail lens because the shared preview tracer's medium stack watches slot 0.
    g_Mats[0] = AutomotiveRedTailLens(1.52f, 0.055f);
    g_Mats[1] = AutomotiveTriCoat(vec3(0.38f, 0.010f, 0.018f), 0.16f, 0.055f, 1.58f);
    g_Mats[2] = AutomotiveCarbonResin();
    g_Mats[3] = AutomotiveBrushedAlloy(vec3(0.72f, 0.76f, 0.82f), 0.28f, 0.84f, 0.0f);
    g_Mats[4] = AutomotiveHeatTitanium(0.20f, 0.62f);
    g_Mats[5] = AutomotiveTireRubber();
    g_Mats[6] = AutomotiveAlcantara();
    g_Mats[7] = GroundMaterial();

    AddQuad(vec3(-8.0f, -4.0f, 0.0f), vec3(8.0f, -4.0f, 0.0f),
            vec3(8.0f, 5.0f, 0.0f), vec3(-8.0f, 5.0f, 0.0f), 7);

    // Seven clearly separated samples. The carbon/resin piece is a small UV sphere in this first preview; the later
    // UV-texture milestone will replace it with an authored dual-weave panel without changing the lobe profile.
    AddSphere(vec3(-3.10f, 0.55f, 1.08f), 0.92f, 1);  // tri-coat paint
    AddSphere(vec3(-1.85f, 0.60f, 1.05f), 0.62f, 2);  // carbon + clear resin
    AddSphere(vec3(-0.35f, 0.62f, 1.08f), 0.82f, 0);  // red tail lens / solid glass
    AddCylinder(vec3(1.20f, 0.68f, 1.08f), 0.88f, 0.20f, 3); // machined brake alloy
    AddTorus(vec3(2.75f, 0.95f, 1.00f), 0.68f, 0.19f, 4);    // heat-tinted titanium exhaust
    AddTorus(vec3(4.20f, 0.62f, 1.02f), 0.73f, 0.27f, 5);    // tire rubber
    AddSphere(vec3(0.95f, 2.05f, 0.78f), 0.68f, 6);          // Alcantara sample

    AddStudioRig(vec3(0.0f, 1.0f, 1.0f));
    FinaliseScene();
}

void BuildOpticsScene()
{
    ClearScene();
    g_Mats[0] = AutomotiveRedTailLens(1.52f, 0.045f);
    g_Mats[1] = AutomotiveClearHeadlight(1.58f, 0.07f);
    g_Mats[2] = AutomotiveTriCoat(vec3(0.015f, 0.08f, 0.42f), 0.10f, 0.04f, 1.56f);
    g_Mats[3] = AutomotiveBrushedAlloy(vec3(0.82f, 0.86f, 0.92f), 0.16f, 0.78f, 0.35f);
    g_Mats[4] = PanelMaterial();
    g_Mats[5] = GroundMaterial();
    g_Mats[6] = AutomotiveHeatTitanium(0.16f, 0.78f);
    g_Mats[7] = GroundMaterial();

    AddQuad(vec3(-6.0f, -3.0f, 0.0f), vec3(6.0f, -3.0f, 0.0f),
            vec3(6.0f, 4.0f, 0.0f), vec3(-6.0f, 4.0f, 0.0f), 5);
    // A clean optics row: clear headlight glass, red tail lens, blue tri-coat body paint, alloy rotor, and
    // a thin-film titanium ring. The open background keeps the Fresnel silhouettes readable.
    AddSphere(vec3(-2.35f, 0.30f, 1.28f), 0.92f, 0);
    AddSphere(vec3(-0.55f, 0.42f, 1.24f), 0.84f, 1);
    AddSphere(vec3(1.25f, 0.52f, 1.18f), 0.86f, 2);
    AddCylinder(vec3(2.95f, 0.68f, 1.05f), 0.76f, 0.18f, 3);
    AddTorus(vec3(4.35f, 0.80f, 0.92f), 0.55f, 0.15f, 6);
    AddStudioRig(vec3(0.0f, 0.8f, 1.0f));
    FinaliseScene();
}

Camera MakeCamera(const vec3& Origin, const vec3& Look, float Aspect, float FovDegrees)
{
    Camera C;
    C.O = Origin;
    C.F = normalize(Look - C.O);
    C.R = normalize(cross(C.F, vec3(0.0f, 0.0f, 1.0f)));
    C.U = normalize(cross(C.R, C.F));
    C.TanHalf = std::tan(FovDegrees * kPi / 360.0f);
    C.Aspect = Aspect;
    return C;
}

void RenderFilm(const Camera& C, int Width, int Height, int Spp, std::vector<float>& Film, int SeedTag)
{
    Film.assign(static_cast<size_t>(Width) * Height * 3u, 0.0f);
    unsigned Threads = std::thread::hardware_concurrency();
    if (Threads == 0u) Threads = 2u;
    Threads = std::min(Threads, 8u);
    for (int Frame = 0; Frame < Spp; ++Frame)
    {
        std::vector<std::thread> Pool;
        for (unsigned Th = 0u; Th < Threads; ++Th)
            Pool.emplace_back([&, Th]()
            {
                for (int Y = static_cast<int>(Th); Y < Height; Y += static_cast<int>(Threads))
                    for (int X = 0; X < Width; ++X)
                    {
                        uint32_t Seed = (static_cast<uint32_t>(SeedTag) + 1u) * 73856093u
                                      ^ (static_cast<uint32_t>(Frame) + 1u) * 19349663u
                                      ^ (static_cast<uint32_t>(Y * Width + X) + 1u) * 83492791u;
                        Rng R(Seed);
                        float Sx = ((static_cast<float>(X) + R.Next()) / Width * 2.0f - 1.0f) * C.TanHalf * C.Aspect;
                        float Sy = (1.0f - (static_cast<float>(Y) + R.Next()) / Height * 2.0f) * C.TanHalf;
                        vec3 D = normalize(C.F + C.R * Sx + C.U * Sy);
                        vec3 L = Radiance(C.O, D, R);
                        float* P = &Film[(static_cast<size_t>(Y) * Width + X) * 3u];
                        P[0] += L.x; P[1] += L.y; P[2] += L.z;
                    }
            });
        for (auto& T : Pool) T.join();
    }
    float Inv = 1.0f / static_cast<float>(Spp);
    for (float& V : Film) V *= Inv;
}

float AcesEncode(float X)
{
    float Y = (X * (2.51f * X + 0.03f)) / (X * (2.43f * X + 0.59f) + 0.14f);
    return clamp(Y, 0.0f, 1.0f);
}

bool WriteFilm(const char* Path, const std::vector<float>& Film, int W, int H, float Exposure = 1.0f)
{
    std::vector<unsigned char> Pixels(static_cast<size_t>(W) * H * 3u, 0u);
    for (int Y = 0; Y < H; ++Y)
        for (int X = 0; X < W; ++X)
            for (int Ch = 0; Ch < 3; ++Ch)
            {
                float V = AcesEncode(Film[(static_cast<size_t>(Y) * W + X) * 3u + Ch] * Exposure);
                Pixels[(static_cast<size_t>(Y) * W + X) * 3u + Ch] =
                    static_cast<unsigned char>(std::pow(V, 1.0f / 2.2f) * 255.0f + 0.5f);
            }
    return PngWriteCounterpart::WritePng(Path, W, H, 3, Pixels.data(), W * 3) != 0;
}

} // namespace

int main(int Argc, char** Argv)
{
    int Width = 768;
    int Height = 432;
    int Spp = 96;
    std::string OutDir = "Exhibits/Gallery/Automotive";
    if (Argc > 1) Width = std::atoi(Argv[1]);
    if (Argc > 2) Height = std::atoi(Argv[2]);
    if (Argc > 3) Spp = std::atoi(Argv[3]);
    if (Argc > 4) OutDir = Argv[4];

    Frontier::ShadingTableSet Tables = Frontier::ShadingTableCodec::Bake(1024u);
    g_Tables = &Tables;

    BuildSuiteScene();
    Camera SuiteCamera = MakeCamera(vec3(0.35f, -11.5f, 3.35f), vec3(0.45f, 0.75f, 1.10f),
                                    static_cast<float>(Width) / Height, 34.0f);
    std::vector<float> Suite;
    RenderFilm(SuiteCamera, Width, Height, Spp, Suite, 101);
    std::string SuitePath = OutDir + "/AutomotiveMaterialSuite.png";
    if (!WriteFilm(SuitePath.c_str(), Suite, Width, Height, 1.0f)) return 2;

    BuildOpticsScene();
    Camera OpticsCamera = MakeCamera(vec3(0.25f, -11.5f, 3.35f), vec3(0.65f, 0.75f, 1.12f),
                                     static_cast<float>(Width) / Height, 31.0f);
    std::vector<float> Optics;
    RenderFilm(OpticsCamera, Width, Height, Spp, Optics, 202);
    std::string OpticsPath = OutDir + "/AutomotiveOpticsAndCoatings.png";
    if (!WriteFilm(OpticsPath.c_str(), Optics, Width, Height, 1.0f)) return 3;

    std::printf("[AutomotivePreview] wrote %s\n", SuitePath.c_str());
    std::printf("[AutomotivePreview] wrote %s\n", OpticsPath.c_str());
    std::printf("[AutomotivePreview] exact BSDF: Engine/Shaders/MaterialEvaluation.slang\n");
    std::printf("[AutomotivePreview] exact profiles: Engine/Shaders/AutomotiveMaterialProfiles.slang\n");
    std::printf("[AutomotivePreview] scene is standalone; Project-Zero integration is intentionally absent\n");
    return 0;
}
