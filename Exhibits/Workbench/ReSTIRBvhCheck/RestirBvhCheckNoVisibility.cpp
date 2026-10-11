//============================================================================================================================================
// Exhibits/Workbench/ReSTIRBvhCheck/RestirBvhCheck.cpp — CPU checks of the BVH traversal and the RIS direct-light estimator
//============================================================================================================================================
//
//    Part A  BVH closest hit (Engine/GeometricRaster/TraversalIndex.cpp, TraceClosest) against a brute-force
//            Möller–Trumbore over the same triangles. Random rays plus axis-aligned rays. The axis-aligned set is the
//            zero-component case that the TraversalIndex.cpp comment flags as a NaN hazard, so it is tested on purpose.
//    Part B  Direct light by weighted reservoir sampling (the candidate/weight/resample algebra of
//            Engine/Shaders/ViewportIntegrator.slang: ResampleCandidate, W = WeightSum / (M · p̂(z)), contribution =
//            W · p̂(z) · V(z)), against a brute-force sum over every light. Visibility goes through the BVH.
//
//    This is a CPU check of the ESTIMATOR, not a run of the ReSTIR GPU kernel. The shader's own comment calls it an
//    interim kernel (1-bounce RIS, temporal reuse, no spatial reuse). What is measured here is the bias and noise of
//    the RIS estimator against a brute-force answer, with the BVH as the visibility oracle.
//
//    Build (from this directory; needs the Vulkan headers and tinybvh, which are external packages):
//        g++ -std=c++20 -O2 -I<vulkan-headers>/include -I<tinybvh> -I../../../Engine/DeviceExchange \
//            -I../../../Engine/GeometricRaster RestirBvhCheck.cpp ../../../Engine/GeometricRaster/TraversalIndex.cpp -o rbvh
//    Run: ./rbvh out
//
//============================================================================================================================================

#include "TraversalIndex.h"
#include "../DeviceExchange/SwapchainExchange.h"   // TriangleIndex

#include <cmath>
#include <cstdio>
#include <cstdint>
#include <random>
#include <string>
#include <vector>

namespace {

struct V3 { float x, y, z; };
inline V3 operator+(V3 a, V3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline V3 operator-(V3 a, V3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 operator*(V3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }
inline float Dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline V3 Cross(V3 a, V3 b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
inline float Len(V3 a) { return std::sqrt(Dot(a, a)); }
inline V3 Norm(V3 a) { const float l = Len(a); return l > 0 ? a * (1.0f / l) : V3{0, 0, 1}; }

struct Tri { V3 a, b, c; };

// Möller–Trumbore, brute force. Returns the smallest t > tMin, or -1.
float BruteHit(const std::vector<Tri>& T, V3 o, V3 d, uint32_t& prim, float tMax = 1e30f)
{
    float best = -1.0f;
    for (uint32_t i = 0; i < T.size(); ++i)
    {
        const V3 e1 = T[i].b - T[i].a, e2 = T[i].c - T[i].a;
        const V3 p = Cross(d, e2);
        const float det = Dot(e1, p);
        if (std::fabs(det) < 1e-12f) continue;
        const float inv = 1.0f / det;
        const V3 s = o - T[i].a;
        const float u = Dot(s, p) * inv;
        if (u < 0.0f || u > 1.0f) continue;
        const V3 q = Cross(s, e1);
        const float v = Dot(d, q) * inv;
        if (v < 0.0f || u + v > 1.0f) continue;
        const float t = Dot(e2, q) * inv;
        if (t > 1e-4f && t < tMax && (best < 0.0f || t < best)) { best = t; prim = i; }
    }
    return best;
}

Frontier::TriangleIndex ToIndex(const Tri& t)
{
    Frontier::TriangleIndex x{};
    x.VertexAlphaX = t.a.x; x.VertexAlphaY = t.a.y; x.VertexAlphaZ = t.a.z;
    x.VertexBetaX = t.b.x;  x.VertexBetaY = t.b.y;  x.VertexBetaZ = t.b.z;
    x.VertexGammaX = t.c.x; x.VertexGammaY = t.c.y; x.VertexGammaZ = t.c.z;
    return x;
}

void AddBox(std::vector<Tri>& T, V3 c, V3 h)
{
    const V3 p[8] = {{c.x - h.x, c.y - h.y, c.z - h.z}, {c.x + h.x, c.y - h.y, c.z - h.z}, {c.x + h.x, c.y + h.y, c.z - h.z},
                     {c.x - h.x, c.y + h.y, c.z - h.z}, {c.x - h.x, c.y - h.y, c.z + h.z}, {c.x + h.x, c.y - h.y, c.z + h.z},
                     {c.x + h.x, c.y + h.y, c.z + h.z}, {c.x - h.x, c.y + h.y, c.z + h.z}};
    const int q[6][4] = {{0, 3, 2, 1}, {4, 5, 6, 7}, {0, 1, 5, 4}, {2, 3, 7, 6}, {1, 2, 6, 5}, {3, 0, 4, 7}};
    for (auto& f : q) { T.push_back({p[f[0]], p[f[1]], p[f[2]]}); T.push_back({p[f[0]], p[f[2]], p[f[3]]}); }
}

} // namespace

int main(int argc, char** argv)
{
    const std::string out = (argc > 1) ? argv[1] : ".";
    FILE* rep = std::fopen((out + "/novis.txt").c_str(), "w");
    auto say = [&](const char* fmt, auto... a) { std::printf(fmt, a...); std::fprintf(rep, fmt, a...); };

    // ---------------- scene: a floor, 40 boxes of occluders, all in world space ----------------
    std::mt19937 rng(20261011u);
    std::uniform_real_distribution<float> U(-1.0f, 1.0f);
    std::vector<Tri> tris;
    tris.push_back({{-6, -6, 0}, {6, -6, 0}, {6, 6, 0}});          // floor
    tris.push_back({{-6, -6, 0}, {6, 6, 0}, {-6, 6, 0}});
    for (int i = 0; i < 40; ++i)
        AddBox(tris, {U(rng) * 4.5f, U(rng) * 4.5f, 0.2f + 0.5f * (U(rng) + 1.0f)}, {0.15f + 0.2f * (U(rng) + 1.0f), 0.15f + 0.2f * (U(rng) + 1.0f), 0.2f + 0.3f * (U(rng) + 1.0f)});
    std::vector<Frontier::TriangleIndex> idx;
    for (const Tri& t : tris) idx.push_back(ToIndex(t));
    say("scene: %zu triangles (floor + 40 boxes)\n", tris.size());

    Frontier::TraversalIndex bvh;
    const bool built = bvh.Build(idx, false);
    say("BVH built: %s (nodes %u)\n", built ? "yes" : "NO", bvh.QueryMetrics().NodeCount);
    if (!built) { std::fclose(rep); return 1; }

    // ---------------- Part A: closest hit, BVH vs brute ----------------
    {
        uint32_t nRand = 20000, nAxis = 2000;
        uint32_t mismatchHit = 0, mismatchT = 0, mismatchPrim = 0, bothHit = 0, bothMiss = 0;
        float maxDt = 0.0f;
        auto check = [&](V3 o, V3 d, uint32_t& countMismatch, const char* tag) {
            const float o3[3] = {o.x, o.y, o.z}, d3[3] = {d.x, d.y, d.z};
            float tBvh = 0.0f; uint32_t pBvh = 0;
            const bool hb = bvh.TraceClosest(o3, d3, tBvh, pBvh);
            uint32_t pBr = 0;
            const float tBr = BruteHit(tris, o, d, pBr);
            const bool hr = tBr > 0.0f;
            (void)tag;
            if (hb != hr) { ++mismatchHit; ++countMismatch; return; }
            if (!hb) { ++bothMiss; return; }
            ++bothHit;
            const float dt = std::fabs(tBvh - tBr);
            maxDt = std::max(maxDt, dt);
            if (dt > 1e-3f) ++mismatchT;
            if (pBvh != pBr && dt > 1e-4f) ++mismatchPrim;
        };
        uint32_t dummy = 0;
        for (uint32_t i = 0; i < nRand; ++i)
        {
            const V3 o{U(rng) * 6.0f, U(rng) * 6.0f, 0.1f + 3.0f * (U(rng) + 1.0f)};
            const V3 d = Norm(V3{U(rng), U(rng), U(rng) * 0.9f - 0.2f});
            check(o, d, dummy, "random");
        }
        // Axis-aligned rays: zero components in the direction (the NaN-slab hazard), from above and aside.
        for (uint32_t i = 0; i < nAxis; ++i)
        {
            const V3 o{U(rng) * 5.0f, U(rng) * 5.0f, 0.5f + 2.0f * (U(rng) + 1.0f)};
            V3 d{0, 0, -1};
            switch (i % 6) { case 0: d = {0, 0, -1}; break; case 1: d = {1, 0, 0}; break; case 2: d = {-1, 0, 0}; break;
                             case 3: d = {0, 1, 0}; break; case 4: d = {0, -1, 0}; break; default: d = {0, 0, 1}; }
            check(o, d, dummy, "axis");
        }
        say("Part A  BVH closest hit vs brute force, %u random + %u axis-aligned rays\n", nRand, nAxis);
        say("        hit/miss mismatches %u, both-hit t mismatches >1e-3 m: %u, prim mismatches: %u, max |dt| %.2e m\n",
            mismatchHit, mismatchT, mismatchPrim, maxDt);
        say("        both-hit %u, both-miss %u\n", bothHit, bothMiss);
    }

    // ---------------- Part B: RIS direct light vs brute-force sum over lights ----------------
    {
        const uint32_t K = 64;             // point lights
        const uint32_t R = 200;            // receivers on the floor
        const uint32_t T = 4000;           // trials per receiver per M
        const float albedo = 0.6f, f = albedo / float(M_PI);
        struct Light { V3 p; float I; };
        std::vector<Light> L(K);
        for (auto& l : L) l = {{U(rng) * 4.0f, U(rng) * 4.0f, 2.0f + 1.5f * (U(rng) + 1.0f)}, 20.0f * (U(rng) + 1.0f) * 0.5f + 5.0f};
        std::vector<V3> rec(R);
        for (auto& r : rec) r = {U(rng) * 4.0f, U(rng) * 4.0f, 0.0f};
        const V3 n{0, 0, 1};

        auto unshadowed = [&](V3 x, const Light& l) -> float {                    // p̂: target without visibility
            const V3 to = l.p - x; const float d2 = Dot(to, to); const float c = Dot(n, to * (1.0f / std::sqrt(d2)));
            return c > 0.0f ? f * l.I * c / d2 : 0.0f;
        };
        auto visibleBvh = [&](V3 x, const Light& l) -> float {
            const V3 o = x + n * 1e-3f; const V3 to = l.p - o; const float D = Len(to); const V3 d = to * (1.0f / D);
            const float o3[3] = {o.x, o.y, o.z}, d3[3] = {d.x, d.y, d.z};
            float t = 0.0f; uint32_t p = 0;
            if (bvh.TraceClosest(o3, d3, t, p) && t < D - 1e-3f) return 0.0f;
            return 1.0f;
        };
        auto visibleBrute = [&](V3 x, const Light& l) -> float {
            const V3 o = x + n * 1e-3f; const V3 to = l.p - o; const float D = Len(to); const V3 d = to * (1.0f / D);
            uint32_t p = 0; const float t = BruteHit(tris, o, d, p);
            return (t > 0.0f && t < D - 1e-3f) ? 0.0f : 1.0f;
        };

        // visibility oracle agreement, BVH vs brute, over every receiver/light pair
        uint64_t visPairs = 0, visMismatch = 0;
        for (const V3& x : rec) for (const Light& l : L)
        {
            ++visPairs;
            if (visibleBvh(x, l) != visibleBrute(x, l)) ++visMismatch;
        }
        say("Part B  RIS direct light, %u point lights, %u receivers, %u trials per receiver\n", K, R, T);
        say("        visibility BVH vs brute over %llu pairs: mismatches %llu\n", (unsigned long long)visPairs, (unsigned long long)visMismatch);

        // brute reference per receiver
        std::vector<double> ref(R);
        for (uint32_t r = 0; r < R; ++r)
        {
            double s = 0.0;
            for (const Light& l : L) s += double(unshadowed(rec[r], l));
            ref[r] = s;
        }

        FILE* csv = std::fopen((out + "/ris_bias_vs_m_novis.csv").c_str(), "w");
        std::fprintf(csv, "M,mean_rel_bias,rmse_over_mean_ref,mean_estimate_over_ref\n");
        say("        %6s %14s %14s %14s\n", "M", "mean rel bias", "rel RMSE", "mean est/ref");
        for (uint32_t M : {1u, 2u, 4u, 8u, 16u, 32u, 64u})
        {
            std::mt19937 trng(777u + M);
            std::uniform_real_distribution<float> u01(0.0f, 1.0f);
            double sumRelBias = 0.0, sumSq = 0.0, sumRatio = 0.0; uint32_t counted = 0;
            for (uint32_t r = 0; r < R; ++r)
            {
                if (ref[r] <= 0.0) continue;
                double acc = 0.0;
                for (uint32_t t = 0; t < T; ++t)
                {
                    // RIS: M uniform candidates (pdf 1/K); w = p̂ / pdf; one selected with prob w / ΣW (reservoir).
                    double wsum = 0.0; uint32_t sel = 0; double selP = 0.0;
                    for (uint32_t m = 0; m < M; ++m)
                    {
                        const uint32_t li = uint32_t(u01(trng) * K) % K;
                        const double ph = unshadowed(rec[r], L[li]);
                        const double w = ph * double(K);
                        wsum += w;
                        if (u01(trng) * wsum <= w) { sel = li; selP = ph; }
                    }
                    if (selP <= 0.0) continue;
                    // W = wsum / (M · p̂(z)); contribution = W · p̂(z) · V(z)  ==  (wsum/M) · V(z)
                    acc += (wsum / double(M)) * 1.0;   // NO VISIBILITY test
                }
                const double est = acc / double(T);
                sumRelBias += (est - ref[r]) / ref[r];
                sumRatio += est / ref[r];
                sumSq += ((est - ref[r]) / ref[r]) * ((est - ref[r]) / ref[r]);
                ++counted;
            }
            const double mb = sumRelBias / counted, rr = std::sqrt(sumSq / counted), ratio = sumRatio / counted;
            say("        %6u %+14.5f %14.5f %14.5f\n", M, mb, rr, ratio);
            std::fprintf(csv, "%u,%.6f,%.6f,%.6f\n", M, mb, rr, ratio);
        }
        std::fclose(csv);
        say("        (mean rel bias = average over receivers of (estimate − brute)/brute; rel RMSE = its spread)\n");
    }
    std::fclose(rep);
    return 0;
}
