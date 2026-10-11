//============================================================================================================================================
// Exhibits/Workbench/VehicleSdfRender/VehicleSdfRender.cpp — the simulated car driving through a mesh-SDF scene, three modes
//============================================================================================================================================
//
//    Replays the physics recorded by Exhibits/Workbench/VehicleStability (the per-frame CSVs from the real VehicleSolver) and
//    renders it. The car (chassis box + 4 wheel cylinders), the curb and the floor are all TriangleField instances. The car
//    moves by changing its instance transform each frame; its field is projected once, as the import chain does.
//
//    Pose per frame: chassis CoM x,y,z and roll/pitch/yaw from the CSV; wheel hubs from the four wheel-contact points.
//    Wheel spin is not drawn. Wheel hubs are approximated from contact points, not read from the solver.
//
//    Modes (per pixel, one sample, so GI and ReSTIR show their noise honestly):
//      raster  — direct sun with one shadow ray, plus sky fill. No indirect light.
//      restir  — direct sun by weighted reservoir sampling over M = 8 sun-disk candidates (RIS). Target p̂ is the unshadowed
//                cosine term. Visibility is traced only for the selected candidate, as in ViewportIntegrator.slang.
//                Sky fill as in raster. No indirect light.
//      gi      — direct sun with one shadow ray, plus a 12-sample cosine gather through the SDF with one bounce.
//
//    Not the GPU. The CPU renderer mirrors the algorithms' structure; it is not a bit-exact GPU run.
//
//    Build & run (from this directory):
//        g++ -std=c++20 -O2 -I../../../Engine/GeometricRaster VehicleSdfRender.cpp -o vsdf
//        ./vsdf <csv-dir> <out-dir> <curb0|curb20|spin> <raster|restir|gi>
//    Writes <out-dir>/<scenario>_<mode>.rgb (raw 8-bit RGB frames) and <scenario>_<mode>.frames (frame count, width, height).
//
//============================================================================================================================================

#include "TriangleField.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

using namespace TriangleField;

namespace {

struct V3 { float x, y, z; };
inline V3 operator+(V3 a, V3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline V3 operator-(V3 a, V3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 operator*(V3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }
inline V3 operator*(V3 a, V3 b) { return {a.x * b.x, a.y * b.y, a.z * b.z}; }
inline float Dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline V3 Cross(V3 a, V3 b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
inline float Len(V3 a) { return std::sqrt(Dot(a, a)); }
inline V3 Norm(V3 a) { const float l = Len(a); return l > 0 ? a * (1.0f / l) : V3{0, 0, 1}; }

// ---------------------------------------------------------------- meshes (world-independent, projected once)
void AddQuad(std::vector<Triangle>& T, V3 a, V3 b, V3 c, V3 d)
{
    Triangle t1{}, t2{};
    const V3 P[4] = {a, b, c, d};
    for (int k = 0; k < 3; ++k) { t1.V[0][k] = (&P[0].x)[k]; t1.V[1][k] = (&P[1].x)[k]; t1.V[2][k] = (&P[2].x)[k]; }
    for (int k = 0; k < 3; ++k) { t2.V[0][k] = (&P[0].x)[k]; t2.V[1][k] = (&P[2].x)[k]; t2.V[2][k] = (&P[3].x)[k]; }
    T.push_back(t1); T.push_back(t2);
}

std::vector<Triangle> BoxMesh(V3 h)
{
    std::vector<Triangle> T;
    const V3 p[8] = {{-h.x, -h.y, -h.z}, {h.x, -h.y, -h.z}, {h.x, h.y, -h.z}, {-h.x, h.y, -h.z},
                     {-h.x, -h.y, h.z},  {h.x, -h.y, h.z},  {h.x, h.y, h.z},  {-h.x, h.y, h.z}};
    AddQuad(T, p[0], p[3], p[2], p[1]); AddQuad(T, p[4], p[5], p[6], p[7]);
    AddQuad(T, p[0], p[1], p[5], p[4]); AddQuad(T, p[2], p[3], p[7], p[6]);
    AddQuad(T, p[1], p[2], p[6], p[5]); AddQuad(T, p[3], p[0], p[4], p[7]);
    return T;
}

// Wheel: a cylinder with its axis along local Y (the car's left-right axis), radius r, half-width hw.
std::vector<Triangle> WheelMesh(float r, float hw, int seg)
{
    std::vector<Triangle> T;
    for (int i = 0; i < seg; ++i)
    {
        const float a0 = 2.0f * float(M_PI) * i / seg, a1 = 2.0f * float(M_PI) * (i + 1) / seg;
        const V3 c0{std::cos(a0) * r, -hw, std::sin(a0) * r}, c1{std::cos(a1) * r, -hw, std::sin(a1) * r};
        const V3 d0{std::cos(a0) * r,  hw, std::sin(a0) * r}, d1{std::cos(a1) * r,  hw, std::sin(a1) * r};
        AddQuad(T, c0, c1, d1, d0);
        Triangle f1{}, f2{};
        const V3 o1{0, -hw, 0}, o2{0, hw, 0};
        for (int k = 0; k < 3; ++k) { f1.V[0][k] = (&o1.x)[k]; f1.V[1][k] = (&c1.x)[k]; f1.V[2][k] = (&c0.x)[k]; }
        for (int k = 0; k < 3; ++k) { f2.V[0][k] = (&o2.x)[k]; f2.V[1][k] = (&d0.x)[k]; f2.V[2][k] = (&d1.x)[k]; }
        T.push_back(f1); T.push_back(f2);
    }
    return T;
}

// ---------------------------------------------------------------- scene
struct Instance { const char* name; Field field; Affine xf; V3 albedo; bool planar; };
struct Scene { std::vector<Instance> inst; };

// Column-major world matrix from a row-major rotation R (rows are the world images of the local axes' columns) and translation.
void MakeWorld(const float R[3][3], V3 t, float M[16])
{
    for (int c = 0; c < 3; ++c)
        for (int r = 0; r < 3; ++r) M[4 * c + r] = R[r][c];
    M[12] = t.x; M[13] = t.y; M[14] = t.z; M[15] = 1.0f;
}
void Identity(float R[3][3]) { for (int r = 0; r < 3; ++r) for (int c = 0; c < 3; ++c) R[r][c] = (r == c); }
void RotZ(float a, float R[3][3]) { const float c = std::cos(a), s = std::sin(a); R[0][0] = c; R[0][1] = -s; R[0][2] = 0; R[1][0] = s; R[1][1] = c; R[1][2] = 0; R[2][0] = 0; R[2][1] = 0; R[2][2] = 1; }
// Body pose: R = Rz(yaw) · Ry(p) · Rx(r). The CSV pitch is the nose-up angle (fwd.z = asin(pitch)); with R = Rz·Ry(p)·Rx,
//    fwd.z = −sin p, so p = −pitch.
void BodyRotation(float yawDeg, float pitchDeg, float rollDeg, float R[3][3])
{
    const float y = yawDeg * float(M_PI) / 180.0f, p = -pitchDeg * float(M_PI) / 180.0f, r = rollDeg * float(M_PI) / 180.0f;
    const float cy = std::cos(y), sy = std::sin(y), cp = std::cos(p), sp = std::sin(p), cr = std::cos(r), sr = std::sin(r);
    R[0][0] = cy * cp; R[0][1] = cy * sp * sr - sy * cr; R[0][2] = cy * sp * cr + sy * sr;
    R[1][0] = sy * cp; R[1][1] = sy * sp * sr + cy * cr; R[1][2] = sy * sp * cr - cy * sr;
    R[2][0] = -sp;     R[2][1] = cp * sr;                R[2][2] = cp * cr;
}

void Put(Scene& S, const char* name, const std::vector<Triangle>& tris, uint32_t res, const float R[3][3], V3 t, V3 albedo, bool planar)
{
    Instance I;
    I.name = name;
    I.field = Project(tris, res, 0.12f, uint64_t(res) * 1000003ull + uint64_t(name[0]) * 31u + uint64_t(name[1]));
    float M[16]; MakeWorld(R, t, M);
    MakeAffine(M, I.xf);
    I.albedo = albedo; I.planar = planar;
    S.inst.push_back(std::move(I));
}

inline float SceneDistance(const Scene& S, V3 p, int* which = nullptr)
{
    const float P[3] = {p.x, p.y, p.z};
    float best = 1e30f; int idx = -1;
    for (size_t i = 0; i < S.inst.size(); ++i)
    {
        const float d = SampleInstance(S.inst[i].field, S.inst[i].xf, P);
        if (d < best) { best = d; idx = int(i); }
    }
    if (which) *which = idx;
    return best;
}

V3 SceneNormal(const Scene& S, V3 p)
{
    const float h = 0.002f;
    const float dx = SceneDistance(S, {p.x + h, p.y, p.z}) - SceneDistance(S, {p.x - h, p.y, p.z});
    const float dy = SceneDistance(S, {p.x, p.y + h, p.z}) - SceneDistance(S, {p.x, p.y - h, p.z});
    const float dz = SceneDistance(S, {p.x, p.y, p.z + h}) - SceneDistance(S, {p.x, p.y, p.z - h});
    return Norm({dx, dy, dz});
}

bool Trace(const Scene& S, V3 o, V3 d, float maxT, int steps, float eps, float& outT, int& outInst)
{
    float t = 0.0f;
    for (int i = 0; i < steps; ++i)
    {
        int w = -1;
        const float dist = SceneDistance(S, o + d * t, &w);
        if (dist < eps) { outT = t; outInst = w; return true; }
        t += dist * 0.9f;
        if (t > maxT) break;
    }
    return false;
}

struct Environment { V3 zenith{0.30f, 0.42f, 0.62f}, horizon{0.55f, 0.52f, 0.50f}, sunDir, sunRadiance; };
V3 Sky(const Environment& E, V3 d)
{
    const float h = std::clamp(d.z * 0.5f + 0.5f, 0.0f, 1.0f), k = h * h;
    V3 dome = E.horizon * (1.0f - k) + E.zenith * k;
    const float sunCos = std::max(0.0f, Dot(d, E.sunDir));
    return dome + E.sunRadiance * (std::pow(sunCos, 512.0f) * 0.02f);
}

inline uint32_t Hash(uint32_t x) { x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16; return x; }
inline float Rnd(uint32_t s) { return float(Hash(s) & 0xFFFFFFu) / float(1u << 24); }

// Sun direction jittered inside a disk of angular radius `cone` (radians). u1,u2 uniform in [0,1).
V3 SunCandidate(const Environment& E, float cone, float u1, float u2)
{
    V3 a = std::fabs(E.sunDir.x) > 0.5f ? V3{0, 1, 0} : V3{1, 0, 0};
    V3 tx = Norm(Cross(a, E.sunDir)), ty = Cross(E.sunDir, tx);
    const float r = cone * std::sqrt(u1), phi = 2.0f * float(M_PI) * u2;
    return Norm(E.sunDir + tx * (r * std::cos(phi)) + ty * (r * std::sin(phi)));
}

inline float ShadowVis(const Scene& S, V3 p, V3 n, V3 dir)
{
    float t; int w;
    return Trace(S, p + n * 0.003f, dir, 40.0f, 96, 1e-4f, t, w) ? 0.0f : 1.0f;
}

V3 CosineDir(V3 n, float u1, float u2)
{
    const float r = std::sqrt(u1), phi = 2.0f * float(M_PI) * u2;
    V3 a = std::fabs(n.x) > 0.5f ? V3{0, 1, 0} : V3{1, 0, 0};
    V3 tx = Norm(Cross(a, n)), ty = Cross(n, tx);
    return Norm(tx * (r * std::cos(phi)) + ty * (r * std::sin(phi)) + n * std::sqrt(std::max(0.0f, 1.0f - u1)));
}

// One bounce of the gather: the hit's direct sun (shadowed) plus its sky fill.
V3 GatherRadiance(const Scene& S, const Environment& E, V3 p, V3 n, V3 dir)
{
    float t; int w;
    const V3 o = p + n * 0.002f;
    if (!Trace(S, o, dir, 8.0f, 40, 1e-3f, t, w)) return Sky(E, dir);
    const V3 hp = o + dir * t;
    const V3 hn = S.inst[size_t(w)].planar ? V3{0, 0, 1} : SceneNormal(S, hp);
    const float ndl = Dot(hn, E.sunDir);
    V3 L = Sky(E, hn) * (1.0f / float(M_PI)) * S.inst[size_t(w)].albedo;
    if (ndl > 0.0f) L = L + S.inst[size_t(w)].albedo * E.sunRadiance * (ndl / float(M_PI)) * ShadowVis(S, hp, hn, E.sunDir);
    return L;
}

// ---------------------------------------------------------------- one frame
enum class Mode { Raster, ReStir, Gi };

void RenderFrame(const Scene& S, const Environment& E, V3 eye, V3 target, int W, int H, Mode mode, uint32_t frame,
                 std::vector<uint8_t>& rgb)
{
    const V3 fwd = Norm(target - eye);
    const V3 right = Norm(Cross(fwd, V3{0, 0, 1}));
    const V3 up = Cross(right, fwd);
    const float th = std::tan(38.0f * float(M_PI) / 360.0f), aspect = float(W) / float(H);
    rgb.assign(size_t(W) * H * 3, 0);
    for (int y = 0; y < H; ++y)
    for (int x = 0; x < W; ++x)
    {
        const uint32_t seed = Hash(uint32_t(x) * 73856093u ^ uint32_t(y) * 19349663u ^ frame * 83492791u);
        const float u = ((x + 0.5f) / W * 2.0f - 1.0f) * aspect * th;
        const float v = (1.0f - (y + 0.5f) / H * 2.0f) * th;
        const V3 d = Norm(fwd + right * u + up * v);
        float t; int w;
        V3 col = Sky(E, d);
        if (Trace(S, eye, d, 200.0f, 320, 1e-3f, t, w))
        {
            const V3 p = eye + d * t;
            const Instance& I = S.inst[size_t(w)];
            const V3 n = I.planar ? V3{0, 0, 1} : SceneNormal(S, p);
            const float ndl = Dot(n, E.sunDir);
            col = V3{0, 0, 0};
            if (mode == Mode::Raster || mode == Mode::Gi)
            {
                if (ndl > 0.0f) col = col + I.albedo * E.sunRadiance * (ndl / float(M_PI)) * ShadowVis(S, p, n, E.sunDir);
            }
            if (mode == Mode::ReStir)
            {
                // RIS over M = 8 sun-disk candidates. Target p̂ = unshadowed cosine (constant radiance). Selection is a
                // weighted reservoir; visibility is traced only for the selected candidate.
                const int M = 8;
                const float cone = 0.035f;                     // ~2° half-angle disk: soft, visible penumbra
                float wsum = 0.0f, selP = 0.0f; V3 selDir = E.sunDir;
                for (int m = 0; m < M; ++m)
                {
                    const float u1 = Rnd(seed + 17u * uint32_t(m) + 1u), u2 = Rnd(seed + 17u * uint32_t(m) + 2u);
                    const V3 c = SunCandidate(E, cone, u1, u2);
                    const float ph = std::max(0.0f, Dot(n, c));
                    wsum += ph;
                    if (Rnd(seed + 17u * uint32_t(m) + 3u) * wsum <= ph) { selP = ph; selDir = c; }
                }
                if (selP > 0.0f && wsum > 0.0f)
                    col = col + I.albedo * E.sunRadiance * (1.0f / float(M_PI)) * (wsum / float(M)) * ShadowVis(S, p, n, selDir);
            }
            if (mode == Mode::Gi)
            {
                const int samples = 12;
                V3 gi{0, 0, 0};
                const float r1 = Rnd(seed + 901u), r2 = Rnd(seed + 902u);
                for (int k = 0; k < samples; ++k)
                {
                    const float u1f = std::fmod(float(k) * 0.6180339887f + r1, 1.0f);
                    const float u2f = std::fmod(float(k) * 0.7548776662f + r2, 1.0f);
                    gi = gi + GatherRadiance(S, E, p, n, CosineDir(n, u1f, u2f));
                }
                col = col + I.albedo * gi * (1.0f / float(samples));
            }
            else
            {
                col = col + I.albedo * Sky(E, n) * (1.0f / float(M_PI));
            }
        }
        // exposure + Reinhard + gamma, as in the shader's output stage
        col = col * 1.0f;
        const float rr[3] = {col.x, col.y, col.z};
        uint8_t* px = &rgb[(size_t(y) * W + x) * 3];
        for (int c = 0; c < 3; ++c)
        {
            const float q = std::max(0.0f, rr[c]);
            px[c] = uint8_t(std::clamp(std::pow(q / (q + 1.0f), 1.0f / 2.2f), 0.0f, 1.0f) * 255.0f + 0.5f);
        }
    }
}

// ---------------------------------------------------------------- CSV
struct Row { double t, x, y, z, roll, pitch, yaw, speed, c[4][3]; };
std::vector<Row> ReadCsv(const std::string& path)
{
    std::vector<Row> rows;
    FILE* f = std::fopen(path.c_str(), "r");
    if (!f) return rows;
    char line[4096];
    if (!std::fgets(line, sizeof line, f)) { std::fclose(f); return rows; }   // header
    while (std::fgets(line, sizeof line, f))
    {
        Row r{};
        double v[40] = {0};
        int n = 0;
        for (char* tok = std::strtok(line, ","); tok && n < 40; tok = std::strtok(nullptr, ","), ++n) v[n] = std::atof(tok);
        r.t = v[0]; r.x = v[1]; r.y = v[2]; r.z = v[3];
        r.speed = v[11]; r.roll = v[7]; r.pitch = v[8]; r.yaw = v[9];
        for (int k = 0; k < 4; ++k) for (int c = 0; c < 3; ++c) r.c[k][c] = v[19 + 3 * k + c];
        rows.push_back(r);
    }
    std::fclose(f);
    return rows;
}

} // namespace

int main(int argc, char** argv)
{
    if (argc < 5) { std::fprintf(stderr, "usage: vsdf <csv-dir> <out-dir> <curb0|curb20|spin> <raster|restir|gi>\n"); return 2; }
    const std::string csvDir = argv[1], outDir = argv[2], scenario = argv[3], modeName = argv[4];
    const Mode mode = modeName == "raster" ? Mode::Raster : modeName == "restir" ? Mode::ReStir : Mode::Gi;

    const bool spin = scenario == "spin";
    const float curbTheta = scenario == "curb20" ? float(20.0 * M_PI / 180.0) : 0.0f;
    const std::string csvName = spin ? "spin_12ms_arena.csv" : (scenario == "curb20" ? "curb_15ms_20deg.csv" : "curb_15ms_00deg.csv");
    std::vector<Row> rows = ReadCsv(csvDir + "/" + csvName);
    if (rows.empty()) { std::fprintf(stderr, "no rows in %s\n", csvName.c_str()); return 1; }

    // Sample the recording: every 0.1 s for the curb runs (2.5 s), every 0.2 s for the spin (10 s).
    const double dtSample = spin ? 0.2 : 0.1, tEnd = spin ? 10.0 : 2.5;
    std::vector<const Row*> frames;
    for (double t = 0.0; t <= tEnd + 1e-9; t += dtSample)
    {
        const Row* best = &rows.front();
        for (const Row& r : rows) if (std::fabs(r.t - t) < std::fabs(best->t - t)) best = &r;
        frames.push_back(best);
    }

    // ---- scene: projected once ----
    const auto t0 = std::chrono::steady_clock::now();
    Scene S;
    V3 curbC{0.0f, 0.0f, 0.0f};
    {
        float R[3][3]; Identity(R);
        Put(S, "floor", BoxMesh({spin ? 40.0f : 5.0f, spin ? 40.0f : 5.0f, 0.05f}), spin ? 160u : 96u, R, {0, 0, -0.05f},
            {0.42f, 0.42f, 0.40f}, true);
        if (!spin)
        {
            // curb: a 0.10 m wide, 0.12 m high strip across the road, at angle θ, placed where the sim put it (6 m ahead of
            // the rolling-start position, which is the first CSV x)
            const float x0 = float(rows.front().x + 6.0);
            RotZ(curbTheta, R);
            const float c = std::cos(curbTheta), s = std::sin(curbTheta);
            V3 center{x0 + c * 0.05f, s * 0.05f, 0.06f};
            curbC = center;
            Put(S, "curb", BoxMesh({0.05f, 1.2f, 0.06f}), 96u, R, center, {0.70f, 0.66f, 0.56f}, false);
        }
        // car body and wheels: meshes once; poses set per frame below
    }
    // Build the car fields once and keep them in a template list.
    Field bodyField = Project(BoxMesh({2.1f, 0.85f, 0.30f}), 96u, 0.12f, 0xB0D1ull);
    Field wheelField = Project(WheelMesh(0.509f, 0.12f, 28), 48u, 0.12f, 0x51EEu);
    const float projectMs = std::chrono::duration<float, std::milli>(std::chrono::steady_clock::now() - t0).count();
    std::fprintf(stderr, "scene projected in %.0f ms\n", projectMs);

    // ---- render ----
    const int W = 192, H = 108;
    FILE* out = std::fopen((outDir + "/" + scenario + "_" + modeName + ".rgb").c_str(), "wb");
    if (!out) { std::fprintf(stderr, "cannot write output\n"); return 1; }
    Environment E;
    E.sunDir = Norm(V3{-0.45f, 0.35f, 0.82f});
    E.sunRadiance = V3{3.2f, 3.0f, 2.7f};
    std::vector<uint8_t> rgb;
    const auto tr = std::chrono::steady_clock::now();
    uint32_t fi = 0;
    for (const Row* r : frames)
    {
        Scene F;
        // static instances
        for (const Instance& I : S.inst) F.inst.push_back(I);
        // car body
        float Rb[3][3]; BodyRotation(float(r->yaw), float(r->pitch), float(r->roll), Rb);
        const V3 com{float(r->x), float(r->y), float(r->z)};
        // body box centre sits 0.15 m above the CoM (the box spans the chassis, wheels poke out below)
        V3 bodyCentre = com + V3{Rb[0][2], Rb[1][2], Rb[2][2]} * 0.15f;
        F.inst.push_back(Instance{"body", bodyField, {}, {0.20f, 0.36f, 0.74f}, false});
        MakeAffine(  // local→world: rotation Rb, translation bodyCentre
            [&] { static float M[16]; MakeWorld(Rb, bodyCentre, M); return M; }(), F.inst.back().xf);
        // wheels: hub = contact point + radius along the body up axis; axis = body left axis
        for (int k = 0; k < 4; ++k)
        {
            const V3 contact{float(r->c[k][0]), float(r->c[k][1]), float(r->c[k][2])};
            const V3 hub = contact + V3{Rb[0][2], Rb[1][2], Rb[2][2]} * 0.509f;
            Instance wI{"wheel", wheelField, {}, {0.07f, 0.07f, 0.07f}, false};
            static float Mw[4][16];
            MakeWorld(Rb, hub, Mw[k]);
            MakeAffine(Mw[k], wI.xf);
            F.inst.push_back(wI);
        }
        // camera: chase view from the side (curbs) or high chase (spin)
        // curb runs: side camera aimed midway between the car and the curb, so both stay in frame as the car passes.
        const V3 target = spin ? com + V3{0.0f, 0.0f, 0.2f}
                               : V3{0.5f * (com.x + curbC.x), 0.5f * (com.y + curbC.y), 0.5f * (com.z + 0.06f) + 0.2f};
        const V3 eye = spin ? V3{com.x + 1.0f, com.y - 9.0f, com.z + 9.5f}
                            : target + V3{0.0f, -12.0f, 4.5f};
        RenderFrame(F, E, eye, target, W, H, mode, fi, rgb);
        std::fwrite(rgb.data(), 1, rgb.size(), out);
        ++fi;
    }
    std::fclose(out);
    FILE* meta = std::fopen((outDir + "/" + scenario + "_" + modeName + ".frames").c_str(), "w");
    std::fprintf(meta, "%u %d %d\n", fi, W, H);
    std::fclose(meta);
    std::fprintf(stderr, "%s/%s: %u frames in %.1f s\n", scenario.c_str(), modeName.c_str(), fi,
                 std::chrono::duration<float>(std::chrono::steady_clock::now() - tr).count());
    return 0;
}
