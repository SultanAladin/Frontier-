//============================================================================================================================================
// Exhibits/Workbench/SdfGiRender/SdfGiRender.cpp — CPU render of a mesh-SDF scene with distance-field diffuse GI
//============================================================================================================================================
//
//    Scene: floor slab, sphere, red block (rotated), green wall. Every object is a triangle mesh that is projected ONCE into a
//    TriangleField (Engine/GeometricRaster/TriangleField.h, the same Project/SampleInstance the import chain uses). Each
//    instance is then sampled through its inverse transform, as the device path does.
//
//    Integrator (CPU mirror of the structure of Engine/Shaders/DistanceFieldGIResolveBody.slang and
//    DistanceFieldTransport.slang::GatherDistanceRadiance, NOT a line-for-line port):
//      • primary rays are sphere-traced on the scene SDF (min over instances);
//      • direct light is one sun sample with a sphere-traced shadow ray;
//      • indirect light is a cosine-weighted hemisphere gather from the hit point. Each gather ray is sphere-traced with a
//        bounded step budget. A miss returns the sky; a hit returns the hit surface's direct sun term plus its sky fill.
//        That is one bounce, which is what the production gather returns from its cached radiance.
//      • the production gather uses 32 current-frame samples (16 for history). Reference uses 512 and deeper tracing.
//
//    NOT claimed: this is not bit-exact with the GPU. The GPU path (SPIR-V kernels, Vulkan host) has not run here, and the
//    shader's own gather, cached-radiance, and material modules are not ported. The CPU reference is the algorithm's
//    expected answer, against which a future GPU readback can be compared.
//
//    Outputs (in the directory given as argv[1]):
//      selftest.txt        field accuracy vs analytic shapes, sign, primary-hit error vs the analytic sphere
//      gi_<variant>.f32    raw linear RGB, width × height × 3 floats
//      convergence.csv    RMSE and mean difference of 1, 2, 4 … 512 gather samples against the reference
//      run.log             timing and counts
//
//    Build & run (from this directory):
//        g++ -std=c++20 -O2 -I../../../Engine/GeometricRaster SdfGiRender.cpp -o sdfgi && ./sdfgi out
//
//============================================================================================================================================

#include "TriangleField.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
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

// --------------------------------------------------------------------------------------------------------------------
//                                          MESH GENERATORS (triangles, world space before instance transform)
// --------------------------------------------------------------------------------------------------------------------
void AddQuad(std::vector<Triangle>& T, V3 a, V3 b, V3 c, V3 d)
{
    Triangle t1{}, t2{};
    const float A[3] = {a.x, a.y, a.z}, B[3] = {b.x, b.y, b.z}, C[3] = {c.x, c.y, c.z}, D[3] = {d.x, d.y, d.z};
    for (int k = 0; k < 3; ++k) { t1.V[0][k] = A[k]; t1.V[1][k] = B[k]; t1.V[2][k] = C[k]; }
    for (int k = 0; k < 3; ++k) { t2.V[0][k] = A[k]; t2.V[1][k] = C[k]; t2.V[2][k] = D[k]; }
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

// Icosphere, radius 1, subdivided `levels` times (20·4^levels faces).
std::vector<Triangle> IcoSphereMesh(int levels)
{
    const float t = (1.0f + std::sqrt(5.0f)) * 0.5f;
    std::vector<V3> v = {{-1, t, 0}, {1, t, 0}, {-1, -t, 0}, {1, -t, 0}, {0, -1, t}, {0, 1, t},
                         {0, -1, -t}, {0, 1, -t}, {t, 0, -1}, {t, 0, 1}, {-t, 0, -1}, {-t, 0, 1}};
    for (auto& p : v) p = Norm(p);
    std::vector<std::array<int, 3>> f = {{0, 11, 5}, {0, 5, 1}, {0, 1, 7}, {0, 7, 10}, {0, 10, 11}, {1, 5, 9}, {5, 11, 4},
                                         {11, 10, 2}, {10, 7, 6}, {7, 1, 8}, {3, 9, 4}, {3, 4, 2}, {3, 2, 6}, {3, 6, 8},
                                         {3, 8, 9}, {4, 9, 5}, {2, 4, 11}, {6, 2, 10}, {8, 6, 7}, {9, 8, 1}};
    for (int l = 0; l < levels; ++l)
    {
        std::vector<std::array<int, 3>> nf;
        std::vector<std::pair<long long, int>> cache;
        auto mid = [&](int a, int b) -> int {
            const long long key = (long long)std::min(a, b) * 1000003LL + std::max(a, b);
            for (auto& c : cache) if (c.first == key) return c.second;
            v.push_back(Norm((v[a] + v[b]) * 0.5f));
            cache.push_back({key, int(v.size()) - 1});
            return int(v.size()) - 1;
        };
        for (auto& tri : f)
        {
            const int a = mid(tri[0], tri[1]), b = mid(tri[1], tri[2]), c = mid(tri[2], tri[0]);
            nf.push_back({tri[0], a, c}); nf.push_back({tri[1], b, a}); nf.push_back({tri[2], c, b}); nf.push_back({a, b, c});
        }
        f.swap(nf);
    }
    std::vector<Triangle> T;
    for (auto& tri : f)
    {
        Triangle tr{};
        for (int i = 0; i < 3; ++i) { tr.V[i][0] = v[tri[i]].x; tr.V[i][1] = v[tri[i]].y; tr.V[i][2] = v[tri[i]].z; }
        T.push_back(tr);
    }
    return T;
}

// --------------------------------------------------------------------------------------------------------------------
//                                                    SCENE
// --------------------------------------------------------------------------------------------------------------------
struct Instance
{
    const char* name;
    Field field;          // topology field, precomputed once
    Affine xf;            // world → local
    V3 albedo;
    bool emissive = false;
};

struct Scene
{
    std::vector<Instance> inst;
};

// Column-major 4×4 from a 3×3 rotation about Z, uniform scale, and translation.
void MakeWorld(float yawRad, float scale, V3 t, float M[16])
{
    const float c = std::cos(yawRad), s = std::sin(yawRad);
    for (int i = 0; i < 16; ++i) M[i] = 0.0f;
    M[0] = c * scale; M[1] = s * scale;  M[2] = 0.0f;
    M[4] = -s * scale; M[5] = c * scale; M[6] = 0.0f;
    M[8] = 0.0f; M[9] = 0.0f; M[10] = scale;
    M[12] = t.x; M[13] = t.y; M[14] = t.z; M[15] = 1.0f;
}

// Scene distance: min over instances of the sampled field, each through its own inverse transform.
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
    const float h = 0.003f;
    const float dx = SceneDistance(S, {p.x + h, p.y, p.z}) - SceneDistance(S, {p.x - h, p.y, p.z});
    const float dy = SceneDistance(S, {p.x, p.y + h, p.z}) - SceneDistance(S, {p.x, p.y - h, p.z});
    const float dz = SceneDistance(S, {p.x, p.y, p.z + h}) - SceneDistance(S, {p.x, p.y, p.z - h});
    return Norm({dx, dy, dz});
}

// Sphere trace. Returns true with the hit point; `steps` caps the iteration budget.
bool Trace(const Scene& S, V3 o, V3 d, float maxT, int steps, float eps, float& outT, int& outInst)
{
    float t = 0.0f;
    for (int i = 0; i < steps; ++i)
    {
        const V3 p = o + d * t;
        int w = -1;
        const float dist = SceneDistance(S, p, &w);
        if (dist < eps) { outT = t; outInst = w; return true; }
        t += dist * 0.9f;
        if (t > maxT) break;
    }
    return false;
}

// Sky: horizon → zenith gradient with a sun aureole, as in SkyAlongApprox.
struct Environment
{
    V3 zenith{0.30f, 0.42f, 0.62f};
    V3 horizon{0.55f, 0.52f, 0.50f};
    V3 sunDir;      // unit, towards the sun
    V3 sunRadiance; // linear RGB
};

V3 Sky(const Environment& E, V3 d)
{
    const float h = std::clamp(d.z * 0.5f + 0.5f, 0.0f, 1.0f);
    const float k = h * h;
    V3 dome = E.horizon * (1.0f - k) + E.zenith * k;
    const float sunCos = std::max(0.0f, Dot(d, E.sunDir));
    dome = dome + E.sunRadiance * (std::pow(sunCos, 512.0f) * 0.02f);
    return dome;
}

// Direct sun term at a point with shadow ray. Lambertian albedo / π.
V3 DirectSun(const Scene& S, const Environment& E, V3 p, V3 n, V3 albedo, int steps, float maxT)
{
    const float ndl = Dot(n, E.sunDir);
    if (ndl <= 0.0f) return {0, 0, 0};
    float t; int w;
    const V3 origin = p + n * 0.003f;
    if (Trace(S, origin, E.sunDir, maxT, steps, 1e-4f, t, w)) return {0, 0, 0};
    return albedo * E.sunRadiance * (ndl * (1.0f / float(M_PI)));
}

// Radiance leaving a surface point towards the camera at the first hit = direct sun + GI gather (sum of Hemisphere samples).
// Rays are generated from the stratified low-discrepancy sequence below. `firstK` ... `firstK+count-1` are used so that the
// same sample indices always produce the same rays: the progressive N=1…512 snapshots are the same run, truncated.
struct GatherParams { int steps; float maxT; float hitEps; };

inline uint32_t HashU32(uint32_t x)
{
    x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16;
    return x;
}
inline float Rand01(uint32_t seed) { return float(HashU32(seed) & 0xFFFFFFu) / float(1u << 24); }

// Cosine-weighted direction in the frame of n (Malley's method on the unit disc).
V3 CosineDirection(V3 n, float u1, float u2)
{
    const float r = std::sqrt(u1), phi = 2.0f * float(M_PI) * u2;
    const float x = r * std::cos(phi), y = r * std::sin(phi), z = std::sqrt(std::max(0.0f, 1.0f - u1));
    V3 a = std::fabs(n.x) > 0.5f ? V3{0, 1, 0} : V3{1, 0, 0};
    V3 tx = Norm(Cross(a, n)), ty = Cross(n, tx);
    return Norm(tx * x + ty * y + n * z);
}

// Returns the radiance one gather ray contributes (already multiplied by albedo of hit surface when hit).
V3 GatherRay(const Scene& S, const Environment& E, V3 p, V3 n, V3 dir, const GatherParams& g)
{
    float t; int w;
    const V3 origin = p + n * 0.002f;
    if (!Trace(S, origin, dir, g.maxT, g.steps, g.hitEps, t, w)) return Sky(E, dir);
    const V3 hp = origin + dir * t;
    const Instance& I = S.inst[size_t(w)];
    if (I.emissive) return I.albedo;                            // emitters: their own radiance
    V3 hn = SceneNormal(S, hp);
    // Hit surface: direct sun (shadow-traced) plus its sky fill. One bounce, matching the cached-radiance gather.
    V3 Lh = DirectSun(S, E, hp, hn, I.albedo, g.steps, g.maxT);
    Lh = Lh + I.albedo * Sky(E, hn) * (1.0f / float(M_PI));
    return Lh;
}

// Indirect irradiance estimate: the gather's diffuse return is albedo · mean(L_i) for cosine-weighted rays (π cancels).
V3 GatherIndirect(const Scene& S, const Environment& E, V3 p, V3 n, uint32_t pixelSeed, int samples, const GatherParams& g,
                  std::vector<V3>* snapshots = nullptr, const std::vector<int>* at = nullptr)
{
    V3 sum{0, 0, 0};
    const float r1 = Rand01(pixelSeed * 2u + 1u), r2 = Rand01(pixelSeed * 2u + 2u);
    size_t snapIdx = 0;
    for (int k = 0; k < samples; ++k)
    {
        const float u1 = std::fmod(float(k) * 0.6180339887f + r1, 1.0f);
        const float u2 = std::fmod(float(k) * 0.7548776662f + r2, 1.0f);
        const V3 dir = CosineDirection(n, u1, u2);
        sum = sum + GatherRay(S, E, p, n, dir, g);
        if (snapshots && at && snapIdx < at->size() && k + 1 == (*at)[snapIdx])
        {
            snapshots->push_back(sum * (1.0f / float(k + 1)));
            ++snapIdx;
        }
    }
    return sum * (1.0f / float(samples));
}

struct RenderOptions
{
    bool gi = true;
    int  giSamples = 32;
    GatherParams gather{48, 6.0f, 1e-3f};
};

struct Image { int W, H; std::vector<V3> px; };

// Renders one image. When `giSnaps` and `at` are given, the gather is recorded after each sample count in `at`, using the
// same ray sequence, so the snapshots are the N-sample prefixes of one run. Every snapshot holds the full pixel colour.
Image Render(const Scene& S, const Environment& E, V3 eye, V3 target, float vfovDeg, int W, int H, const RenderOptions& opt,
             std::vector<std::vector<V3>>* giSnaps = nullptr, const std::vector<int>* at = nullptr)
{
    Image img{W, H, std::vector<V3>(size_t(W) * H)};
    const V3 fwd = Norm(target - eye);
    const V3 right = Norm(Cross(fwd, V3{0, 0, 1}));
    const V3 up = Cross(right, fwd);
    const float th = std::tan(vfovDeg * float(M_PI) / 360.0f);
    const float aspect = float(W) / float(H);
    const size_t nSnap = (giSnaps && at) ? at->size() : 0;
    if (giSnaps) giSnaps->assign(nSnap, std::vector<V3>(size_t(W) * H));
    for (int y = 0; y < H; ++y)
    {
        for (int x = 0; x < W; ++x)
        {
            const size_t idx = size_t(y) * W + x;
            const float u = ((x + 0.5f) / W * 2.0f - 1.0f) * aspect * th;
            const float v = (1.0f - (y + 0.5f) / H * 2.0f) * th;
            const V3 d = Norm(fwd + right * u + up * v);
            float t; int w;
            V3 col{0, 0, 0};
            bool gathered = false;
            V3 albedo{0, 0, 0}, gi{0, 0, 0};
            std::vector<V3> snaps;
            if (!Trace(S, eye, d, 60.0f, 256, 1e-4f, t, w))
            {
                col = Sky(E, d);
            }
            else
            {
                const V3 p = eye + d * t;
                const V3 n = SceneNormal(S, p);
                const Instance& I = S.inst[size_t(w)];
                albedo = I.albedo;
                if (I.emissive) col = I.albedo;
                else
                {
                    col = DirectSun(S, E, p, n, I.albedo, opt.gather.steps, opt.gather.maxT);
                    if (opt.gi)
                    {
                        const uint32_t seed = uint32_t(y) * 7919u + uint32_t(x) * 104729u + 12345u;
                        gi = GatherIndirect(S, E, p, n, seed, opt.giSamples, opt.gather, giSnaps ? &snaps : nullptr, at);
                        col = col + I.albedo * gi;
                        gathered = true;
                    }
                    else
                    {
                        col = col + I.albedo * Sky(E, n) * (1.0f / float(M_PI));
                    }
                }
            }
            img.px[idx] = col;
            if (giSnaps)
            {
                for (size_t s = 0; s < nSnap; ++s)
                    (*giSnaps)[s][idx] = gathered ? (col - albedo * gi + albedo * snaps[s]) : col;
            }
        }
    }
    return img;
}

void WriteF32(const std::string& path, const Image& img)
{
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) { std::fprintf(stderr, "cannot write %s\n", path.c_str()); return; }
    for (const V3& p : img.px) { const float a[3] = {p.x, p.y, p.z}; std::fwrite(a, sizeof(float), 3, f); }
    std::fclose(f);
}

double Rmse(const Image& a, const Image& b)
{
    double s = 0; for (size_t i = 0; i < a.px.size(); ++i)
    {
        const V3 d = a.px[i] - b.px[i]; s += double(Dot(d, d));
    }
    return std::sqrt(s / (3.0 * double(a.px.size())));
}
double MeanOf(const Image& a) { double s = 0; for (auto& p : a.px) s += (p.x + p.y + p.z) / 3.0; return s / double(a.px.size()); }

} // namespace

int main(int argc, char** argv)
{
    using clk = std::chrono::steady_clock;
    const std::string out = (argc > 1) ? argv[1] : ".";
    const int W = 320, H = 180;
    std::FILE* log = std::fopen((out + "/run.log").c_str(), "w");
    auto say = [&](const char* fmt, auto... a) { std::printf(fmt, a...); if (log) std::fprintf(log, fmt, a...); };

    // ---- build the scene: each mesh is projected once; instances only carry their transform ----
    const auto t0 = clk::now();
    Scene S;
    const float pad = 0.15f;
    auto addInstance = [&](const char* name, const std::vector<Triangle>& tris, uint32_t res, float yaw, float scale, V3 pos,
                           V3 albedo, bool emissive = false) {
        Instance I;
        I.name = name;
        I.field = Project(tris, res, pad, uint64_t(res) * 1000003ull + uint64_t(name[0]));
        float M[16]; MakeWorld(yaw, scale, pos, M);
        MakeAffine(M, I.xf);
        I.albedo = albedo; I.emissive = emissive;
        S.inst.push_back(std::move(I));
    };
    addInstance("floor", BoxMesh({4.0f, 4.0f, 0.05f}), 96, 0.0f, 1.0f, {0, 0, -0.05f}, {0.55f, 0.55f, 0.55f});
    addInstance("sphere", IcoSphereMesh(3), 64, 0.0f, 0.5f, {0, 0, 0.5f}, {0.85f, 0.85f, 0.82f});
    addInstance("block", BoxMesh({0.35f, 0.35f, 0.35f}), 64, float(M_PI) / 6.0f, 1.0f, {1.15f, -0.25f, 0.35f}, {0.75f, 0.15f, 0.12f});
    addInstance("wall", BoxMesh({0.06f, 3.0f, 1.8f}), 64, 0.0f, 1.0f, {-1.8f, 0.0f, 1.8f}, {0.15f, 0.55f, 0.22f});
    const float buildMs = std::chrono::duration<float, std::milli>(clk::now() - t0).count();
    say("built %zu instances (projected once each) in %.1f ms\n", S.inst.size(), buildMs);
    for (const Instance& I : S.inst)
        say("  %-7s res %u  bounds [%.2f %.2f %.2f]..[%.2f %.2f %.2f]  albedo (%.2f %.2f %.2f)\n", I.name, I.field.H.Resolution,
            I.field.H.Min[0], I.field.H.Min[1], I.field.H.Min[2], I.field.H.Max[0], I.field.H.Max[1], I.field.H.Max[2],
            I.albedo.x, I.albedo.y, I.albedo.z);

    // ---- self test: field accuracy against analytic shapes ----
    {
        FILE* f = std::fopen((out + "/selftest.txt").c_str(), "w");
        auto line = [&](const char* fmt, auto... a) { std::fprintf(f, fmt, a...); std::printf(fmt, a...); };
        // analytic distances for the sphere (centre (0,0,0.5), r 0.5) and the block (box, rotated)
        auto sdSphere = [](V3 p) { return Len(p - V3{0, 0, 0.5f}) - 0.5f; };
        float maxErrSphere = 0.0f, maxErrFar = 0.0f; int nSamp = 0, signWrong = 0;
        uint32_t rng = 7u;
        for (int i = 0; i < 4000; ++i)
        {
            rng = HashU32(rng + 1u);
            const V3 p{(Rand01(rng) - 0.5f) * 3.0f, (Rand01(rng * 3u + 1u) - 0.5f) * 3.0f, Rand01(rng * 5u + 2u) * 2.0f};
            const float exact = sdSphere(p);
            const float d = SampleInstance(S.inst[1].field, S.inst[1].xf, &p.x);
            if (std::fabs(exact) < 0.2f) maxErrSphere = std::max(maxErrSphere, std::fabs(d - exact));
            if (std::fabs(exact) > 0.15f) { maxErrFar = std::max(maxErrFar, std::fabs(d - exact)); }
            if ((exact < -0.02f) != (d < 0.0f) && std::fabs(exact) > 0.02f) ++signWrong;
            ++nSamp;
        }
        line("sphere field vs analytic (n=%d): max |err| near surface %.4f m, max |err| away %.4f m, sign wrong %d\n",
             nSamp, maxErrSphere, maxErrFar, signWrong);
        // primary-hit accuracy: sphere-trace a ray at the sphere and compare the hit to the analytic intersection
        V3 eye{0.0f, -2.0f, 0.5f}; float worst = 0.0f; int hits = 0;
        for (int i = 0; i < 200; ++i)
        {
            const float a = (i / 200.0f - 0.5f) * 0.5f, b = (i * 0.37f) - 0.2f;
            const V3 d = Norm(V3{std::sin(a), std::cos(a), std::sin(b) * 0.3f});
            float t; int w;
            if (!Trace(S, eye, d, 10.0f, 256, 1e-4f, t, w) || w != 1) continue;
            ++hits;
            const V3 pe = eye + d * t;
            worst = std::max(worst, std::fabs(sdSphere(pe)));
        }
        line("primary sphere hits %d, worst distance of the hit from the analytic sphere %.4f m\n", hits, worst);
        // mesh deviation of the icosphere itself (chord error) for context
        line("icosphere level 3 mesh: %zu triangles\n", IcoSphereMesh(3).size());
        std::fclose(f);
    }

    // ---- renders ----
    Environment E;
    E.sunDir = Norm(V3{-0.45f, 0.35f, 0.82f});
    E.sunRadiance = V3{3.2f, 3.0f, 2.7f};
    const V3 eye{4.3f, -4.2f, 2.6f}, target{0.0f, 0.0f, 0.35f};

    RenderOptions noGi;  noGi.gi = false;
    RenderOptions gi32;  gi32.gi = true;  gi32.giSamples = 32;
    RenderOptions ref;   ref.gi = true;   ref.giSamples = 512;  ref.gather = {192, 6.0f, 1e-3f};

    auto tr = clk::now();
    Image imgNoGi = Render(S, E, eye, target, 40.0f, W, H, noGi);
    say("gi_off rendered in %.1f s\n", std::chrono::duration<float>(clk::now() - tr).count());

    // One reference run records the N-sample prefixes of its own gather sequence (N = 1…512). Each prefix uses the reference's
    // tracing budget, so the convergence table isolates the sample count.
    std::vector<int> at = {1, 2, 4, 8, 16, 32, 64, 128, 256, 512};
    std::vector<std::vector<V3>> snaps;
    tr = clk::now();
    Image imgRef = Render(S, E, eye, target, 40.0f, W, H, ref, &snaps, &at);
    say("gi_reference_512 (192-step trace, snapshots 1..512) rendered in %.1f s\n", std::chrono::duration<float>(clk::now() - tr).count());

    // Production-like budget: 32 samples with 48-step traces. Compared with the same reference below.
    tr = clk::now();
    Image img32Prod = Render(S, E, eye, target, 40.0f, W, H, gi32);
    say("gi_32_prod (48-step trace) rendered in %.1f s\n", std::chrono::duration<float>(clk::now() - tr).count());

    WriteF32(out + "/gi_off.f32", imgNoGi);
    WriteF32(out + "/gi_reference_512.f32", imgRef);
    WriteF32(out + "/gi_32_prod.f32", img32Prod);
    for (size_t s = 0; s < at.size(); ++s)
    {
        Image im{W, H, snaps[s]};
        if (at[s] == 32 || at[s] == 4 || at[s] == 1) WriteF32(out + "/gi_snap_" + std::to_string(at[s]) + ".f32", im);
    }

    // ---- convergence table (RMSE and mean against the 512-sample reference) ----
    {
        FILE* f = std::fopen((out + "/convergence.csv").c_str(), "w");
        std::fprintf(f, "samples,rmse_vs_ref512,mean_linear_rgb,mean_ref512\n");
        const double meanRef = MeanOf(imgRef);
        for (size_t s = 0; s < at.size(); ++s)
        {
            Image im{W, H, snaps[s]};
            std::fprintf(f, "%d,%.6f,%.6f,%.6f\n", at[s], Rmse(im, imgRef), MeanOf(im), meanRef);
            say("  samples %2d  RMSE vs 512-ref %.5f  mean %.5f (ref %.5f)\n", at[s], Rmse(im, imgRef), MeanOf(im), meanRef);
        }
        std::fprintf(f, "gi_off,%.6f,%.6f,%.6f\n", Rmse(imgNoGi, imgRef), MeanOf(imgNoGi), meanRef);
        std::fprintf(f, "gi_32_prod_48step,%.6f,%.6f,%.6f\n", Rmse(img32Prod, imgRef), MeanOf(img32Prod), meanRef);
        std::fclose(f);
        say("  gi off    RMSE vs 512-ref %.5f  mean %.5f\n", Rmse(imgNoGi, imgRef), MeanOf(imgNoGi));
        say("  gi 32 prod (48-step) RMSE vs 512-ref %.5f  mean %.5f\n", Rmse(img32Prod, imgRef), MeanOf(img32Prod));
    }
    if (log) std::fclose(log);
    return 0;
}
