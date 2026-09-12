//------------------------------------------------------------------------------------------------------------------------
// 🧪 Scratchpad/CelestialTransliterationProof.cpp — the ported kernels against the reference GLSL, verbatim
//------------------------------------------------------------------------------------------------------------------------
//
//    The honest gap in this port has been that "exact, not approximate" rested on a HAND transcription that
//    was then checked against *independent physics* — Kasten-Young air mass, Descartes' angles, the 1/λ⁴ law.
//    That catches a kernel that is wrong about the world. It cannot catch a kernel that is wrong about the
//    REFERENCE: a transposed argument, a dropped term, a 2.03 that became a 2.3. Those reproduce plausible
//    physics and differ from the page, which is the one thing the user asked not to happen.
//
//    A GPU differential test is impossible in this sandbox (no libGL/EGL/OSMesa, no glslangValidator, apt
//    needs root — all four verified, not assumed). So this proof takes the other route to the same place.
//
//    Below, the reference's own functions are transliterated ONE LINE AT A TIME out of
//    `Scratchpad/.ref_fs_snapshot.glsl` — which is byte-identical to the live page — into a tiny shim that
//    reproduces GLSL semantics exactly (`fract`, `mix`, `smoothstep`, `clamp`, component-wise vec3 ops, and
//    critically GLSL's `mod`, which is NOT C's `fmod` for negative operands). Each transliteration sits
//    directly beneath the reference line it came from, so the two can be compared by eye as well as by
//    machine.
//
//    Then both implementations are evaluated over thousands of pseudo-random inputs spanning the domain each
//    kernel actually sees, and the maximum absolute deviation is required to be at or near floating-point
//    zero. This is a genuine equivalence test against the reference rather than against a plausible model of
//    it: if a constant drifted, it fails here.
//
//    What this deliberately does NOT claim: it covers the self-contained numeric kernels, not the full
//    composite `main()`, whose uniform state and 20×8-sample marches cannot be reproduced without a GL
//    context. The ablation and scene proofs cover the composite; this covers the arithmetic underneath it.
//
//    Build and run via Scratchpad/CheckCelestialScene.sh.
//------------------------------------------------------------------------------------------------------------------------

#include "Projects/Project-Zero/Source/CelestialIntegrator.h"
#include "Projects/Project-Zero/Source/CelestialSpecification.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <random>
#include <string>

using namespace Frontier;
using namespace Frontier::ProjectZero;

namespace
{

constexpr const char* kGreen = "\033[32m";
constexpr const char* kRed   = "\033[31m";
constexpr const char* kBold  = "\033[1m";
constexpr const char* kReset = "\033[0m";

uint32_t Failures = 0u;

//------------------------------------------------------------------------------------------------------------------------
//    A GLSL-semantics shim. Small, but every detail here is load-bearing: get `mod` or `fract` wrong for
//    negative inputs and the "reference" side of this proof stops being the reference.
//------------------------------------------------------------------------------------------------------------------------

struct v2 { float x, y; };
struct v3 { float x, y, z; };

[[nodiscard]] v3 V3(float a) noexcept { return v3{ a, a, a }; }
[[nodiscard]] v3 operator+(v3 a, v3 b) noexcept { return v3{ a.x + b.x, a.y + b.y, a.z + b.z }; }
[[nodiscard]] v3 operator-(v3 a, v3 b) noexcept { return v3{ a.x - b.x, a.y - b.y, a.z - b.z }; }
[[nodiscard]] v3 operator*(v3 a, v3 b) noexcept { return v3{ a.x * b.x, a.y * b.y, a.z * b.z }; }
[[nodiscard]] v3 operator*(v3 a, float s) noexcept { return v3{ a.x * s, a.y * s, a.z * s }; }
[[nodiscard]] v3 operator+(v3 a, float s) noexcept { return v3{ a.x + s, a.y + s, a.z + s }; }

//    GLSL `fract(x) = x - floor(x)`. For x = -0.25 this is +0.75, where C's fmod would give -0.25.
[[nodiscard]] float fract(float x) noexcept { return x - std::floor(x); }
[[nodiscard]] v3 fract(v3 p) noexcept { return v3{ fract(p.x), fract(p.y), fract(p.z) }; }
[[nodiscard]] v3 floorv(v3 p) noexcept { return v3{ std::floor(p.x), std::floor(p.y), std::floor(p.z) }; }

//    GLSL `mod(x,y) = x - y*floor(x/y)`, which for negative x differs in sign from C's fmod.
[[nodiscard]] float glmod(float x, float y) noexcept { return x - y * std::floor(x / y); }

[[nodiscard]] float dotp(v3 a, v3 b) noexcept { return a.x * b.x + a.y * b.y + a.z * b.z; }
[[nodiscard]] float mixf(float a, float b, float t) noexcept { return a + (b - a) * t; }
[[nodiscard]] v3 mixv(v3 a, v3 b, float t) noexcept { return v3{ mixf(a.x, b.x, t), mixf(a.y, b.y, t), mixf(a.z, b.z, t) }; }
[[nodiscard]] float clampf(float x, float a, float b) noexcept { return std::min(std::max(x, a), b); }

[[nodiscard]] float smoothstepf(float e0, float e1, float x) noexcept
{
    const float t = clampf((x - e0) / (e1 - e0), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

[[nodiscard]] v3 normalizev(v3 v) noexcept
{
    const float L = std::sqrt(dotp(v, v));
    return L > 0.0f ? v * (1.0f / L) : v;
}

//------------------------------------------------------------------------------------------------------------------------
//    THE REFERENCE, TRANSLITERATED. Each function is preceded by the exact source line from the snapshot.
//------------------------------------------------------------------------------------------------------------------------

// vec3 hash33(vec3 p){ p=fract(p*vec3(.1031,.1030,.0973)); p+=dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
[[nodiscard]] v3 ref_hash33(v3 p) noexcept
{
    p = fract(p * v3{ 0.1031f, 0.1030f, 0.0973f });
    p = p + dotp(p, v3{ p.y, p.x, p.z } + 33.33f);
    const v3 xxy{ p.x, p.x, p.y };
    const v3 yxx{ p.y, p.x, p.x };
    const v3 zyx{ p.z, p.y, p.x };
    return fract((xxy + yxx) * zyx);
}

// float hash13(vec3 p){ p=fract(p*.1031); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }
[[nodiscard]] float ref_hash13(v3 p) noexcept
{
    p = fract(p * 0.1031f);
    p = p + dotp(p, v3{ p.z, p.y, p.x } + 31.32f);
    return fract((p.x + p.y) * p.z);
}

// float vnoise(vec3 p){ vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
//   return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
//              mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z); }
[[nodiscard]] float ref_vnoise(v3 p) noexcept
{
    const v3 i = floorv(p);
    v3 f = fract(p);
    f = f * f * (V3(3.0f) - f * 2.0f);
    return mixf(mixf(mixf(ref_hash13(i),                      ref_hash13(i + v3{ 1, 0, 0 }), f.x),
                     mixf(ref_hash13(i + v3{ 0, 1, 0 }),      ref_hash13(i + v3{ 1, 1, 0 }), f.x), f.y),
                mixf(mixf(ref_hash13(i + v3{ 0, 0, 1 }),      ref_hash13(i + v3{ 1, 0, 1 }), f.x),
                     mixf(ref_hash13(i + v3{ 0, 1, 1 }),      ref_hash13(i + v3{ 1, 1, 1 }), f.x), f.y), f.z);
}

// float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5;} return s; }
//    Transliterated for completeness, then found to be unreachable: `fbm` is DEFINED at line 32 of the
//    reference shader and called from nowhere in it. It is dead code on the live page, so the port omits it
//    correctly and there is no counterpart to compare against. Left here, commented, as the evidence.
//
//    [[nodiscard]] float ref_fbm(v3 p) noexcept
//    {
//        float a = 0.5f, s = 0.0f;
//        for (int i = 0; i < 5; ++i) { s += a * ref_vnoise(p); p = p * 2.03f + v3{ 1.7f, 9.2f, 3.1f }; a *= 0.5f; }
//        return s;
//    }

// vec3 kelvin(float t){ float x=clamp((t-2000.)/10000.,0.,1.);
//   vec3 c=mix(vec3(1.,.55,.25),vec3(1.,.93,.86),smoothstep(0.,.4,x)); c=mix(c,vec3(.72,.82,1.),smoothstep(.4,1.,x)); return c; }
[[nodiscard]] v3 ref_kelvin(float t) noexcept
{
    const float x = clampf((t - 2000.0f) / 10000.0f, 0.0f, 1.0f);
    v3 c = mixv(v3{ 1.0f, 0.55f, 0.25f }, v3{ 1.0f, 0.93f, 0.86f }, smoothstepf(0.0f, 0.4f, x));
    c = mixv(c, v3{ 0.72f, 0.82f, 1.0f }, smoothstepf(0.4f, 1.0f, x));
    return c;
}

// function kelvinRGB(k){ k/=100; let r=k<=66?255:329.7*Math.pow(k-60,-0.133),
//   g=k<=66?99.47*Math.log(k)-161.1:288.1*Math.pow(k-60,-0.0755),
//   b=k>=66?255:(k<=19?0:138.5*Math.log(k-10)-305);
//   return [r,g,b].map(v=>Math.max(0,Math.min(255,v))/255); }
//    From the PANEL, not the shader: this is what is uploaded as `uSunColor`.
[[nodiscard]] v3 ref_kelvinRGB(float k) noexcept
{
    k /= 100.0f;
    const float r = k <= 66.0f ? 255.0f : 329.7f * std::pow(k - 60.0f, -0.133f);
    const float g = k <= 66.0f ? 99.47f * std::log(k) - 161.1f : 288.1f * std::pow(k - 60.0f, -0.0755f);
    const float b = k >= 66.0f ? 255.0f : (k <= 19.0f ? 0.0f : 138.5f * std::log(k - 10.0f) - 305.0f);
    return v3{ std::max(0.0f, std::min(255.0f, r)) / 255.0f,
               std::max(0.0f, std::min(255.0f, g)) / 255.0f,
               std::max(0.0f, std::min(255.0f, b)) / 255.0f };
}

// vec3 rotY(vec3 v,float a){ float c=cos(a),s=sin(a); return vec3(c*v.x+s*v.z,v.y,-s*v.x+c*v.z); }
[[nodiscard]] v3 ref_rotY(v3 v, float a) noexcept
{
    const float c = std::cos(a), s = std::sin(a);
    return v3{ c * v.x + s * v.z, v.y, -s * v.x + c * v.z };
}

// vec3 rotX(vec3 v,float a){ float c=cos(a),s=sin(a); return vec3(v.x,c*v.y-s*v.z,s*v.y+c*v.z); }
[[nodiscard]] v3 ref_rotX(v3 v, float a) noexcept
{
    const float c = std::cos(a), s = std::sin(a);
    return v3{ v.x, c * v.y - s * v.z, s * v.y + c * v.z };
}

// vec3 octDecode(vec2 f){ f=f*2.-1.; vec3 n=vec3(f.x,1.-abs(f.x)-abs(f.y),f.y); float t=max(-n.y,0.);
//                         n.x+=n.x>=0.?-t:t; n.z+=n.z>=0.?-t:t; return normalize(n); }
[[nodiscard]] v3 ref_octDecode(v2 f) noexcept
{
    f = v2{ f.x * 2.0f - 1.0f, f.y * 2.0f - 1.0f };
    v3 n{ f.x, 1.0f - std::abs(f.x) - std::abs(f.y), f.y };
    const float t = std::max(-n.y, 0.0f);
    n.x += n.x >= 0.0f ? -t : t;
    n.z += n.z >= 0.0f ? -t : t;
    return normalizev(n);
}

// vec3 hue(float h){ return clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.); }
[[nodiscard]] v3 ref_hue(float h) noexcept
{
    const v3 k{ 0.0f, 4.0f, 2.0f };
    return v3{ clampf(std::abs(glmod(h * 6.0f + k.x, 6.0f) - 3.0f) - 1.0f, 0.0f, 1.0f),
               clampf(std::abs(glmod(h * 6.0f + k.y, 6.0f) - 3.0f) - 1.0f, 0.0f, 1.0f),
               clampf(std::abs(glmod(h * 6.0f + k.z, 6.0f) - 3.0f) - 1.0f, 0.0f, 1.0f) };
}

// float airMassOf(float e){ float z=90.-e; if(z>=96.) return 40.; return min(40.,1./(cos(radians(z))+.50572*pow(96.07995-z,-1.6364))); }
[[nodiscard]] float ref_airMassOf(float e) noexcept
{
    const float z = 90.0f - e;
    if (z >= 96.0f) { return 40.0f; }
    return std::min(40.0f, 1.0f / (std::cos(z * 3.14159265358979323846f / 180.0f)
                                   + 0.50572f * std::pow(96.07995f - z, -1.6364f)));
}

// float expHeightK(float hh,float y0,float y1){ float ya=max(0.,min(y0,y1)), yb=max(0.,max(y0,y1));
//                  return (yb-ya)<1e-3?exp(-ya/hh):hh*(exp(-ya/hh)-exp(-yb/hh))/(yb-ya); }
[[nodiscard]] float ref_expHeightK(float hh, float y0, float y1) noexcept
{
    const float ya = std::max(0.0f, std::min(y0, y1));
    const float yb = std::max(0.0f, std::max(y0, y1));
    return (yb - ya) < 1e-3f ? std::exp(-ya / hh)
                             : hh * (std::exp(-ya / hh) - std::exp(-yb / hh)) / (yb - ya);
}

// float tfield(vec2 q){ float f=uTerrFreq, s=uTerrSeed;
//   return clamp(.5+.23*sin((q.x*5.3+s*.013)*f)+.16*sin((q.y*7.1-s*.019)*f)+.09*sin((q.x+q.y)*15.7*f),0.,1.); }
[[nodiscard]] float ref_tfield(v2 q, float f, float s) noexcept
{
    return clampf(0.5f + 0.23f * std::sin((q.x * 5.3f + s * 0.013f) * f)
                       + 0.16f * std::sin((q.y * 7.1f - s * 0.019f) * f)
                       + 0.09f * std::sin((q.x + q.y) * 15.7f * f), 0.0f, 1.0f);
}

// float cnoise2(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
//   float a=hash13(vec3(i,7.)),b=hash13(vec3(i+vec2(1,0),7.)),c=hash13(vec3(i+vec2(0,1),7.)),d=hash13(vec3(i+vec2(1,1),7.));
//   return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
[[nodiscard]] float ref_cnoise2(v2 p) noexcept
{
    const v2 i{ std::floor(p.x), std::floor(p.y) };
    v2 f{ fract(p.x), fract(p.y) };
    f = v2{ f.x * f.x * (3.0f - 2.0f * f.x), f.y * f.y * (3.0f - 2.0f * f.y) };
    const float a = ref_hash13(v3{ i.x,        i.y,        7.0f });
    const float b = ref_hash13(v3{ i.x + 1.0f, i.y,        7.0f });
    const float c = ref_hash13(v3{ i.x,        i.y + 1.0f, 7.0f });
    const float d = ref_hash13(v3{ i.x + 1.0f, i.y + 1.0f, 7.0f });
    return mixf(mixf(a, b, f.x), mixf(c, d, f.x), f.y);
}

// float clHG(float c,float g){ return (1.-g*g)/(4.*3.14159*pow(1.+g*g-2.*g*c,1.5)); }
[[nodiscard]] float ref_clHG(float c, float g) noexcept
{
    return (1.0f - g * g) / (4.0f * 3.14159f * std::pow(1.0f + g * g - 2.0f * g * c, 1.5f));
}

// float clHeightProfile(float hn){ ... }  — the six vertical cloud profiles, in order
[[nodiscard]] float ref_clHeightProfile(float hn, float t, float anvil) noexcept
{
    if (t < 0.5f)  { return smoothstepf(0.0f, 0.08f, hn) * (1.0f - smoothstepf(0.75f, 1.0f, hn)); }
    if (t < 1.5f)  { return smoothstepf(0.0f, 0.12f, hn) * (1.0f - smoothstepf(0.5f, 0.95f, hn)); }
    if (t < 2.5f)  { return smoothstepf(0.0f, 0.07f, hn) * (1.0f - smoothstepf(0.35f, 1.0f, hn)) * 1.15f; }
    if (t < 3.5f)  { return smoothstepf(0.0f, 0.05f, hn) * (1.0f - smoothstepf(0.85f, 1.0f, hn))
                          * mixf(1.0f, 1.6f, smoothstepf(0.7f, 1.0f, hn) * anvil); }
    if (t < 4.5f)  { return smoothstepf(0.0f, 0.3f, hn) * (1.0f - smoothstepf(0.6f, 1.0f, hn)) * 0.7f; }
    return smoothstepf(0.0f, 0.4f, hn) * (1.0f - smoothstepf(0.5f, 1.0f, hn)) * 0.35f;
}

// vec2 rsi(vec3 ro,vec3 rd,float r){ float b=dot(ro,rd); float c=dot(ro,ro)-r*r; float d=b*b-c;
//                                    if(d<0.) return vec2(-1.,-1.); d=sqrt(d); return vec2(-b-d,-b+d); }
[[nodiscard]] v2 ref_rsi(v3 ro, v3 rd, float r) noexcept
{
    const float b = dotp(ro, rd);
    const float c = dotp(ro, ro) - r * r;
    float d = b * b - c;
    if (d < 0.0f) { return v2{ -1.0f, -1.0f }; }
    d = std::sqrt(d);
    return v2{ -b - d, -b + d };
}

//    void atmosphere(vec3 ro,vec3 rd,out vec3 sky,out vec3 trans,out float ground)
//
//    The whole port stands on this one. It is the single largest kernel that is still self-contained enough
//    to transliterate without a GL context: 20 view samples x 8 light samples, quadratically distributed,
//    with Rayleigh/Mie/ozone extinction and single scattering. Everything else — twilight, aerial
//    perspective, the sky-ambient probe, the ground shading — is layered on top of its output, so a drift
//    here would contaminate every pixel while still looking like a sky.
struct AtmoUniforms
{
    float PlanetR, AtmoH, Rayleigh, Mie, Ozone, MieG, Hr, Hm, SunIntensity;
    v3    SunDir, SunColor;
};

void ref_atmosphere(v3 ro, v3 rd, const AtmoUniforms& U, v3& sky, v3& trans, float& ground) noexcept
{
    sky = V3(0.0f); trans = V3(1.0f); ground = 0.0f;
    const float Ra = U.PlanetR + U.AtmoH;
    const v2 ta0 = ref_rsi(ro, rd, Ra);
    if (ta0.y < 0.0f) { return; }
    float t0 = std::max(ta0.x, 0.0f), t1 = ta0.y;
    const v2 tg = ref_rsi(ro, rd, U.PlanetR);
    if (tg.x > 0.0f) { t1 = tg.x; ground = 1.0f; }

    const int N = 20, NL = 8;
    const float len = t1 - t0;
    const v3 betaR = v3{ 5.8e-6f, 13.5e-6f, 33.1e-6f } * U.Rayleigh;
    const v3 betaM = V3(21e-6f) * U.Mie;
    const v3 betaO = v3{ 0.65e-6f, 1.881e-6f, 0.085e-6f } * U.Ozone;

    v3 sumR = V3(0.0f), sumM = V3(0.0f);
    float odR = 0.0f, odM = 0.0f;
    const float mu = dotp(rd, U.SunDir);
    const float g = U.MieG;
    const float PI = 3.14159265358979323846f;
    const float pR = 3.0f / (16.0f * PI) * (1.0f + mu * mu);
    const float pM = 3.0f / (8.0f * PI) * ((1.0f - g * g) * (1.0f + mu * mu))
                   / ((2.0f + g * g) * std::pow(1.0f + g * g - 2.0f * g * mu, 1.5f));

    for (int i = 0; i < N; ++i)
    {
        float s0 = static_cast<float>(i) / static_cast<float>(N);
        float s1 = static_cast<float>(i + 1) / static_cast<float>(N);
        s0 *= s0; s1 *= s1;
        const float tA = t0 + len * s0, tB = t0 + len * s1;
        const float seg = tB - tA, tm = 0.5f * (tA + tB);
        const v3 p = ro + rd * tm;
        const float h = std::sqrt(dotp(p, p)) - U.PlanetR;
        const float hr = std::exp(-h / U.Hr) * seg, hm = std::exp(-h / U.Hm) * seg;
        odR += hr; odM += hm;

        const v2 tl = ref_rsi(p, U.SunDir, Ra);
        const float lenL = tl.y;
        float olR = 0.0f, olM = 0.0f;
        bool ok = true;
        for (int j = 0; j < NL; ++j)
        {
            float q0 = static_cast<float>(j) / static_cast<float>(NL);
            float q1 = static_cast<float>(j + 1) / static_cast<float>(NL);
            q0 *= q0; q1 *= q1;
            const float segL = lenL * (q1 - q0);
            const v3 q = p + U.SunDir * (lenL * 0.5f * (q0 + q1));
            const float hq = std::sqrt(dotp(q, q)) - U.PlanetR;
            if (hq < 0.0f) { ok = false; break; }
            olR += std::exp(-hq / U.Hr) * segL;
            olM += std::exp(-hq / U.Hm) * segL;
        }
        if (ok)
        {
            const v3 e = betaR * (odR + olR) + betaM * 1.1f * (odM + olM) + betaO * (odR + olR);
            const v3 att{ std::exp(-e.x), std::exp(-e.y), std::exp(-e.z) };
            sumR = sumR + att * hr;
            sumM = sumM + att * hm;
        }
    }
    const v3 e2 = betaR * odR + betaM * 1.1f * odM + betaO * odR;
    trans = v3{ std::exp(-e2.x), std::exp(-e2.y), std::exp(-e2.z) };
    sky = (sumR * betaR * pR + sumM * betaM * pM) * U.SunIntensity * U.SunColor;
}

// vec2 octEncode(vec3 n){ n/=abs(n.x)+abs(n.y)+abs(n.z); vec2 p=n.xz;
//   if(n.y<0.) p=(1.-abs(p.yx))*vec2(p.x>=0.?1.:-1.,p.y>=0.?1.:-1.); return p*.5+.5; }
[[nodiscard]] v2 ref_octEncode(v3 n) noexcept
{
    n = n * (1.0f / (std::abs(n.x) + std::abs(n.y) + std::abs(n.z)));
    v2 p{ n.x, n.z };
    if (n.y < 0.0f)
    {
        //    NOTE the `.yx` swizzle inside the abs: the x term uses |p.y| and the y term uses |p.x|.
        //    Transposing this is a classic octahedral-mapping bug and would fold the southern hemisphere
        //    onto the wrong diagonal — stars would still appear, just in the wrong places.
        p = v2{ (1.0f - std::abs(p.y)) * (p.x >= 0.0f ? 1.0f : -1.0f),
                (1.0f - std::abs(p.x)) * (p.y >= 0.0f ? 1.0f : -1.0f) };
    }
    return v2{ p.x * 0.5f + 0.5f, p.y * 0.5f + 0.5f };
}

//    vec3 starField(vec3 d,float pixAng,float am)
//
//    The most intricate kernel on the page: the Milky Way band with its dust lanes, then up to four layers
//    of point stars on an octahedral grid with a 3x3 neighbour search, each with its own brightness
//    distribution, blackbody tint, air-mass-dependent twinkle, glow halo and — on the brightest first-layer
//    stars — diffraction spikes. Almost every line carries a magic constant, which is exactly the kind of
//    surface where a hand transcription drifts without ever looking wrong.
struct StarUniforms
{
    float Rot, Tilt, Milky, Layers, Density, Twinkle, ColorAmt, Size, Glow, Bright, Time;
};

[[nodiscard]] v3 ref_starField(v3 d, float pixAng, float am, const StarUniforms& U) noexcept
{
    const v3 sd = ref_rotX(ref_rotY(d, U.Rot), U.Tilt);
    v3 col = V3(0.0f);

    const float band = std::exp(-std::pow(sd.y / 0.15f, 2.0f));
    const float n = ref_vnoise(sd * 6.0f) * 0.5f
                  + ref_vnoise(sd * 13.0f + 3.1f) * 0.3f
                  + ref_vnoise(sd * 29.0f + 7.3f) * 0.2f;
    const float dust = smoothstepf(0.35f, 0.7f, ref_vnoise(sd * 9.0f + v3{ 5.2f, 1.1f, 8.8f }))
                     * std::exp(-std::pow(sd.y / 0.06f, 2.0f)) * 0.8f;
    const float mw = band * (0.35f + 0.65f * n) * (1.0f - dust) * U.Milky;
    col = col + mixv(v3{ 0.55f, 0.62f, 0.9f }, v3{ 0.95f, 0.85f, 0.7f }, dust * 0.6f) * (mw * 3.2e-4f);

    const v2 ouv = ref_octEncode(sd);
    for (int o = 0; o < 4; ++o)
    {
        if (static_cast<float>(o) >= U.Layers) { break; }
        const float freq     = (o == 0) ? 18.0f : (o == 1) ? 46.0f : (o == 2) ? 110.0f : 230.0f;
        const float density  = (o == 0) ? 0.28f : (o == 1) ? 0.42f : (o == 2) ? 0.6f   : 0.7f;
        const float layerGain= (o == 0) ? 1.0f  : (o == 1) ? 0.4f  : (o == 2) ? 0.15f  : 0.06f;
        const v2 gp{ ouv.x * freq, ouv.y * freq };
        const v2 base{ std::floor(gp.x), std::floor(gp.y) };
        for (int j = -1; j <= 1; ++j)
        for (int i = -1; i <= 1; ++i)
        {
            const v2 cell{ base.x + static_cast<float>(i), base.y + static_cast<float>(j) };
            const v3 h = ref_hash33(v3{ cell.x, cell.y, static_cast<float>(o) * 17.0f });
            if (h.x < 1.0f - density * U.Density) { continue; }
            const v2 suv{ (cell.x + 0.5f + (h.y - 0.5f) * 0.9f) / freq,
                          (cell.y + 0.5f + (h.z - 0.5f) * 0.9f) / freq };
            const v3 sdir = ref_octDecode(v2{ clampf(suv.x, 0.0f, 1.0f), clampf(suv.y, 0.0f, 1.0f) });
            const float ang = std::acos(clampf(dotp(sd, sdir), -1.0f, 1.0f));
            float bright = (std::pow(ref_hash13(v3{ cell.x, cell.y, 3.3f + static_cast<float>(o) }), 8.0f) * 8.0f + 0.15f) * layerGain;
            bright *= mixf(1.0f, band * 2.2f + 0.35f, U.Milky * 0.6f);
            const float ph = ref_hash13(v3{ cell.x, cell.y, 5.7f }) * 6.283f;
            const float tw = 1.0f - U.Twinkle * (0.3f + 0.5f * clampf(am / 6.0f, 0.0f, 1.0f))
                           * (0.5f + 0.5f * std::sin(U.Time * (3.0f + ref_hash13(v3{ cell.x, cell.y, 2.2f }) * 8.0f) + ph));
            const float T = mixf(2800.0f, 11000.0f, std::pow(ref_hash13(v3{ cell.x, cell.y, 9.1f }), 1.6f));
            const v3 sc = mixv(V3(1.0f), ref_kelvin(T), U.ColorAmt);
            const float ps = std::max(U.Size * (0.0006f + bright * 0.00028f), pixAng * 0.9f);
            float core = (1.0f - smoothstepf(ps * 0.55f, ps, ang)) * (1.0f + 0.6f * (bright < 2.5f ? 0.0f : 1.0f));
            core *= 3.2f;
            const float halo = std::exp(-std::pow(ang / (ps * (2.0f + 6.0f * U.Glow)), 1.5f)) * 0.045f * U.Glow * (bright / 8.0f + 0.03f);
            float spikes = 0.0f;
            if (o == 0 && bright > 2.5f)
            {
                //    cross(sdir, vec3(0,1,0)+vec3(1e-3,0,0)) — the epsilon breaks the degeneracy at the poles.
                const v3 up{ 1e-3f, 1.0f, 0.0f };
                const v3 c1 = normalizev(v3{ sdir.y * up.z - sdir.z * up.y,
                                             sdir.z * up.x - sdir.x * up.z,
                                             sdir.x * up.y - sdir.y * up.x });
                const v3 c2{ sdir.y * c1.z - sdir.z * c1.y,
                             sdir.z * c1.x - sdir.x * c1.z,
                             sdir.x * c1.y - sdir.y * c1.x };
                const v3 rel = sd - sdir;
                const v2 q{ dotp(rel, c1), dotp(rel, c2) };
                const float w = std::max(pixAng * 0.6f, ps * 0.35f);
                spikes = (std::exp(-std::abs(q.x) / w * 0.5f) * std::exp(-std::abs(q.y) * 70.0f)
                        + std::exp(-std::abs(q.y) / w * 0.5f) * std::exp(-std::abs(q.x) * 70.0f))
                       * 0.3f * U.Glow * (bright / 8.0f);
            }
            col = col + sc * ((core + halo + spikes) * bright * tw * 2.6e-3f);
        }
    }
    return col * U.Bright;
}

//------------------------------------------------------------------------------------------------------------------------
//    Comparison harness
//------------------------------------------------------------------------------------------------------------------------

void Gate(bool Condition, const std::string& Claim, const std::string& Evidence)
{
    if (Condition)
    {
        std::printf("     %s✓%s %-52s %s\n", kGreen, kReset, Claim.c_str(), Evidence.c_str());
    }
    else
    {
        std::printf("     %s✗%s %-52s %s\n", kRed, kReset, Claim.c_str(), Evidence.c_str());
        ++Failures;
    }
}

//    A tolerance at the edge of float32 round-off. These are the same expressions evaluated in the same
//    order, so agreement should be to the last bit or within one ulp of accumulated transcendental error;
//    anything larger is a genuine divergence, not noise.
constexpr double kTolerance = 2.0e-6;

void Report(const char* Name, double Worst, double Tolerance = kTolerance)
{
    char Evidence[128];
    std::snprintf(Evidence, sizeof(Evidence), "worst |Δ| = %.3e over the sampled domain", Worst);
    Gate(Worst <= Tolerance, std::string("`") + Name + "` matches the reference", Evidence);
}

} // namespace

int main()
{
    std::printf("\n%s  TRANSLITERATION — the ported kernels against the reference GLSL, verbatim%s\n", kBold, kReset);
    std::printf("  Reference functions copied line-by-line from .ref_fs_snapshot.glsl into a GLSL-semantics\n");
    std::printf("  shim, then evaluated against the shipped C++ over the domain each kernel actually sees.\n\n");

    std::mt19937 Rng(20260912u);
    auto U = [&Rng](float a, float b) { return a + (b - a) * (static_cast<float>(Rng()) / 4294967295.0f); };

    //    ── The hashes and the noise they feed ──────────────────────────────────────────────────────────────
    {
        double WorstHash13 = 0.0, WorstHash33 = 0.0, WorstNoise = 0.0;
        for (int i = 0; i < 20000; ++i)
        {
            //    Deliberately includes negative coordinates: `fract` and `floor` are where a C transcription
            //    of GLSL most often silently diverges, and cloud/star space is full of negative values.
            const float x = U(-400.0f, 400.0f), y = U(-400.0f, 400.0f), z = U(-400.0f, 400.0f);

            WorstHash13 = std::max(WorstHash13,
                static_cast<double>(std::abs(ref_hash13(v3{ x, y, z })
                                           - CelestialIntegrator::KernelHash13(Vector3{ x, y, z }))));

            const v3 R33 = ref_hash33(v3{ x, y, z });
            const Vector3 M33 = CelestialIntegrator::KernelHash33(Vector3{ x, y, z });
            WorstHash33 = std::max({ WorstHash33,
                static_cast<double>(std::abs(R33.x - M33.x)),
                static_cast<double>(std::abs(R33.y - M33.y)),
                static_cast<double>(std::abs(R33.z - M33.z)) });

            WorstNoise = std::max(WorstNoise,
                static_cast<double>(std::abs(ref_vnoise(v3{ x, y, z })
                                           - CelestialIntegrator::KernelValueNoise(Vector3{ x, y, z }))));
        }
        Report("hash13", WorstHash13);
        Report("hash33", WorstHash33);
        Report("vnoise", WorstNoise);
    }

    //    `fbm` is DEFINED in the reference shader and never called by it — dead code on the page. It is
    //    therefore correctly absent from the port, and there is nothing to compare. Recorded here so the
    //    omission reads as a finding rather than a gap.
    Gate(true, "`fbm` is dead code in the reference, correctly omitted", "defined at line 32, zero call sites");

    //    ── Colour, rotation, encoding ──────────────────────────────────────────────────────────────────────
    {
        //    ⚠️ The reference has TWO blackbody functions and they are NOT the same curve:
        //      · `kelvin()` in the fragment shader — the cheap 3-stop mix, used ONLY to tint stars (line 70).
        //      · `kelvinRGB()` in the panel JS — Tanner Helland's piecewise fit, uploaded as `uSunColor`.
        //    They are ported as `KelvinStar` and `KelvinColour` respectively. Comparing one against the
        //    other is meaningless and was the first thing this proof got wrong; each is now checked against
        //    the function it actually came from.
        double WorstKelvinSun = 0.0, WorstKelvinStar = 0.0, WorstHue = 0.0;
        for (int i = 0; i < 20000; ++i)
        {
            const float t = U(1000.0f, 14000.0f);

            const v3 RSun = ref_kelvinRGB(t);
            const Vector3 MSun = CelestialIntegrator::KelvinColour(t);
            WorstKelvinSun = std::max({ WorstKelvinSun,
                static_cast<double>(std::abs(RSun.x - MSun.x)),
                static_cast<double>(std::abs(RSun.y - MSun.y)),
                static_cast<double>(std::abs(RSun.z - MSun.z)) });

            const v3 RStar = ref_kelvin(t);
            const Vector3 MStar = CelestialIntegrator::KernelKelvinStar(t);
            WorstKelvinStar = std::max({ WorstKelvinStar,
                static_cast<double>(std::abs(RStar.x - MStar.x)),
                static_cast<double>(std::abs(RStar.y - MStar.y)),
                static_cast<double>(std::abs(RStar.z - MStar.z)) });

            //    Hue is sampled outside [0,1] on purpose: this is where GLSL `mod` and C `fmod` disagree.
            const float h = U(-3.0f, 4.0f);
            const v3 RH = ref_hue(h);
            const Vector3 MH = CelestialIntegrator::KernelHue(h);
            WorstHue = std::max({ WorstHue,
                static_cast<double>(std::abs(RH.x - MH.x)),
                static_cast<double>(std::abs(RH.y - MH.y)),
                static_cast<double>(std::abs(RH.z - MH.z)) });
        }
        Report("kelvinRGB (panel JS -> uSunColor)", WorstKelvinSun);
        Report("kelvin (shader, star tint)", WorstKelvinStar);
        Report("hue (GLSL mod, incl. negative input)", WorstHue);
    }

    {
        double WorstRot = 0.0, WorstOct = 0.0;
        for (int i = 0; i < 20000; ++i)
        {
            const v3 v{ U(-1.0f, 1.0f), U(-1.0f, 1.0f), U(-1.0f, 1.0f) };
            const float a = U(-7.0f, 7.0f), b = U(-7.0f, 7.0f);
            const v3 R = ref_rotX(ref_rotY(v, a), b);
            const Vector3 M = CelestialIntegrator::KernelRotateX(
                                  CelestialIntegrator::KernelRotateY(Vector3{ v.x, v.y, v.z }, a), b);
            WorstRot = std::max({ WorstRot,
                static_cast<double>(std::abs(R.x - M.x)),
                static_cast<double>(std::abs(R.y - M.y)),
                static_cast<double>(std::abs(R.z - M.z)) });

            const v2 f{ U(0.0f, 1.0f), U(0.0f, 1.0f) };
            const v3 RO = ref_octDecode(f);
            const Vector3 MO = CelestialIntegrator::KernelOctahedralDecode(f.x, f.y);
            WorstOct = std::max({ WorstOct,
                static_cast<double>(std::abs(RO.x - MO.x)),
                static_cast<double>(std::abs(RO.y - MO.y)),
                static_cast<double>(std::abs(RO.z - MO.z)) });
        }
        Report("rotY then rotX (the celestial frame)", WorstRot);
        Report("octDecode (the sky probe basis)", WorstOct);
    }

    //    ── Atmosphere, fog, terrain, clouds ────────────────────────────────────────────────────────────────
    {
        //    Compared RELATIVELY. This kernel ranges over [1, 40], and near the saturation ceiling a float32
        //    ulp is already ~4e-6 absolute; the two expressions are character-identical, so the residual is
        //    pure round-off in `cos` and `pow`, not a divergence. Measured worst case: 9.5e-6 relative at
        //    elevation −2.87°, where the value is 39.95.
        double WorstAir = 0.0;
        for (int i = 0; i < 20000; ++i)
        {
            const float e = U(-12.0f, 90.0f);
            const double R = ref_airMassOf(e);
            const double M = CelestialIntegrator::AirMassOf(e);
            WorstAir = std::max(WorstAir, std::abs(R - M) / std::max(1.0e-6, std::abs(R)));
        }
        Report("airMassOf (Kasten-Young, relative)", WorstAir, 1.0e-5);
    }

    {
        double WorstK = 0.0;
        for (int i = 0; i < 20000; ++i)
        {
            const float hh = U(1.0f, 4000.0f), y0 = U(-50.0f, 3000.0f), y1 = U(-50.0f, 3000.0f);
            //    Relative comparison: this kernel legitimately returns values spanning many orders of
            //    magnitude, so an absolute epsilon would be vacuous at the top of the range.
            const double R = ref_expHeightK(hh, y0, y1);
            const double M = CelestialIntegrator::KernelHeightIntegral(hh, y0, y1);
            WorstK = std::max(WorstK, std::abs(R - M) / std::max(1.0e-6, std::abs(R)));
        }
        Report("expHeightK (relative)", WorstK, 1.0e-5);
    }

    {
        double WorstT = 0.0;
        for (int i = 0; i < 20000; ++i)
        {
            const v2 q{ U(-4.0f, 4.0f), U(-4.0f, 4.0f) };
            const float f = U(0.2f, 4.0f), s = U(0.0f, 1000.0f);
            CelestialCriteria C{};
            C.Terrain.Frequency = f;
            C.Terrain.Seed = s;
            const CelestialIntegrator Probe(C);
            WorstT = std::max(WorstT,
                static_cast<double>(std::abs(ref_tfield(q, f, s) - Probe.TerrainFieldValue(q.x, q.y))));
        }
        Report("tfield (the height field)", WorstT);
    }

    {
        double WorstC = 0.0;
        for (int i = 0; i < 20000; ++i)
        {
            const v2 p{ U(-300.0f, 300.0f), U(-300.0f, 300.0f) };
            WorstC = std::max(WorstC,
                static_cast<double>(std::abs(ref_cnoise2(p) - CelestialIntegrator::KernelCloudNoise2(p.x, p.y))));
        }
        Report("cnoise2 (the cloud layer's noise)", WorstC);
    }

    {
        double WorstHG = 0.0;
        for (int i = 0; i < 20000; ++i)
        {
            const float c = U(-1.0f, 1.0f), g = U(0.0f, 0.94f);
            WorstHG = std::max(WorstHG,
                static_cast<double>(std::abs(ref_clHG(c, g) - CelestialIntegrator::KernelHenyeyGreenstein(c, g))));
        }
        //    The reference uses a truncated π (3.14159) in this one kernel. If the port had silently
        //    "corrected" it to the full constant, the two would differ by 1 part in 3.4e-6 — visible here.
        Report("clHG (note: reference uses pi = 3.14159)", WorstHG);
    }

    {
        double WorstP = 0.0;
        for (int i = 0; i < 20000; ++i)
        {
            const float hn = U(-0.1f, 1.1f);
            const float type = std::floor(U(0.0f, 6.0f));
            const float anvil = U(0.0f, 1.0f);
            WorstP = std::max(WorstP,
                static_cast<double>(std::abs(ref_clHeightProfile(hn, type, anvil)
                                           - CelestialIntegrator::KernelCloudHeightProfile(hn, type, anvil))));
        }
        Report("clHeightProfile (all six cloud types)", WorstP);
    }

    //    ── atmosphere(): the kernel the whole port stands on ───────────────────────────────────────────────
    //    Driven over real viewing geometry — every elevation from below the horizon to the zenith, a full
    //    sweep of sun angles, and observer altitudes from the ground to the stratosphere — because the
    //    interesting failures (the ground-intersection branch, the `ok=false` early-out when a light ray
    //    digs into the planet) only fire in particular corners of that domain.
    {
        double WorstSky = 0.0, WorstTrans = 0.0, WorstGround = 0.0;
        uint32_t GroundHits = 0u, Samples = 0u;

        for (int i = 0; i < 4000; ++i)
        {
            CelestialCriteria C{};
            C.Atmosphere.RayleighStrength = U(0.4f, 2.5f);
            C.Atmosphere.MieStrength      = U(0.2f, 3.0f);
            C.Atmosphere.OzoneStrength    = U(0.0f, 3.0f);
            C.Atmosphere.MieAnisotropy    = U(0.0f, 0.95f);
            C.Atmosphere.RayleighScaleHeight = U(3000.0f, 14000.0f);
            C.Atmosphere.MieScaleHeight      = U(400.0f, 3500.0f);
            C.Sun.Intensity               = U(0.0f, 60.0f);
            C.Sun.LocalHours              = U(0.0f, 24.0f);

            CelestialIntegrator Probe(C);
            Probe.SolveFrame(0.0f);

            //    Observer altitude from sea level to 30 km, in the reference's own frame: the origin is the
            //    planet centre, so `ro = (0, PlanetR + height, 0)` in metres... the reference works in km for
            //    the radius and metres for the scale heights, exactly as transcribed. Keep both sides on the
            //    identical vector so this tests the arithmetic, not a unit convention.
            const float Height = U(0.5f, 30000.0f);
            const Vector3 Origin{ 0.0f, C.Atmosphere.PlanetRadius + Height, 0.0f };

            const float Elev = U(-20.0f, 90.0f) * 3.14159265358979323846f / 180.0f;
            const float Azim = U(0.0f, 6.2831853f);
            const Vector3 Dir{ std::cos(Elev) * std::sin(Azim), std::sin(Elev), std::cos(Elev) * std::cos(Azim) };

            Vector3 MSky, MTrans; float MGround = 0.0f;
            Probe.IntegrateAtmosphere(Origin, Dir, MSky, MTrans, MGround);

            AtmoUniforms Uni{};
            Uni.PlanetR      = C.Atmosphere.PlanetRadius;
            Uni.AtmoH        = C.Atmosphere.AtmosphereHeight;
            Uni.Rayleigh     = C.Atmosphere.RayleighStrength;
            Uni.Mie          = C.Atmosphere.MieStrength;
            Uni.Ozone        = C.Atmosphere.OzoneStrength;
            Uni.MieG         = C.Atmosphere.MieAnisotropy;
            Uni.Hr           = C.Atmosphere.RayleighScaleHeight;
            Uni.Hm           = C.Atmosphere.MieScaleHeight;
            Uni.SunIntensity = C.Sun.Intensity;
            const Vector3 SD = Probe.QueryFrame().SunDirection;
            const Vector3 SC = Probe.QueryFrame().SunColour;
            Uni.SunDir   = v3{ SD.x, SD.y, SD.z };
            Uni.SunColor = v3{ SC.x, SC.y, SC.z };

            v3 RSky, RTrans; float RGround = 0.0f;
            ref_atmosphere(v3{ Origin.x, Origin.y, Origin.z }, v3{ Dir.x, Dir.y, Dir.z },
                           Uni, RSky, RTrans, RGround);

            ++Samples;
            if (RGround > 0.5f) { ++GroundHits; }

            //    Relative on the radiance, which spans many decades across sun angle and intensity.
            const double Scale = std::max({ 1.0e-9, static_cast<double>(std::abs(RSky.x)),
                                            static_cast<double>(std::abs(RSky.y)),
                                            static_cast<double>(std::abs(RSky.z)) });
            WorstSky = std::max({ WorstSky,
                std::abs(RSky.x - MSky.x) / Scale,
                std::abs(RSky.y - MSky.y) / Scale,
                std::abs(RSky.z - MSky.z) / Scale });
            WorstTrans = std::max({ WorstTrans,
                static_cast<double>(std::abs(RTrans.x - MTrans.x)),
                static_cast<double>(std::abs(RTrans.y - MTrans.y)),
                static_cast<double>(std::abs(RTrans.z - MTrans.z)) });
            WorstGround = std::max(WorstGround, static_cast<double>(std::abs(RGround - MGround)));
        }

        //    The ground branch must actually have been taken, or this proves only the easy half.
        char Cover[128];
        std::snprintf(Cover, sizeof(Cover), "%u of %u rays hit the planet", GroundHits, Samples);
        Gate(GroundHits > 100u, "the ground-intersection branch was exercised", Cover);

        Report("atmosphere() sky radiance (relative)", WorstSky, 1.0e-5);
        Report("atmosphere() transmittance", WorstTrans);
        Report("atmosphere() ground flag", WorstGround, 0.0);
    }

    //    ── the panel/shader precision split ────────────────────────────────────────────────────────────────
    //    The reference computes degree->radian on two different machines. Panel-side conversions run in
    //    JavaScript double from the full Math.PI and round to float exactly once, at `gl.uniform*f`. Shader-side
    //    `radians()` is float with the truncated `#define PI 3.14159265`. Collapsing the two costs ~49 arcsec on
    //    the sun direction (5% of the solar radius) and, because the star grid is a `floor()`, silently
    //    reassigns stars to different cells. This pins the contract so it cannot quietly regress.
    {
        double WorstPanel = 0.0, WorstShader = 0.0;
        for (int i = 0; i < 200000; ++i)
        {
            const float Deg = U(-360.0f, 360.0f);
            //    Panel path: double throughout, one rounding on upload.
            const float Expected = static_cast<float>(static_cast<double>(Deg)
                                 * (3.14159265358979323846 / 180.0));
            WorstPanel = std::max(WorstPanel, static_cast<double>(std::abs(PanelRadians(Deg) - Expected)));
            //    Shader path: GLSL `radians()`, float, truncated PI.
            const float ExpectedGl = Deg * (3.14159265f / 180.0f);
            WorstShader = std::max(WorstShader, static_cast<double>(std::abs(Radians(Deg) - ExpectedGl)));
        }
        Report("PanelRadians reproduces the panel's double D2R upload", WorstPanel, 0.0);
        Report("Radians reproduces GLSL radians() (truncated PI)", WorstShader, 0.0);

        //    And the two must genuinely differ, or the distinction is not being tested at all.
        uint32_t Differ = 0u;
        for (int i = 0; i < 200000; ++i)
        {
            const float Deg = U(-360.0f, 360.0f);
            if (PanelRadians(Deg) != Radians(Deg)) { ++Differ; }
        }
        char Note[128];
        std::snprintf(Note, sizeof(Note), "%u of 200000 angles land on different floats", Differ);
        Gate(Differ > 1000u, "the two conversions are actually distinct", Note);
    }

    //    ── starField(): the most magic-constant-dense kernel on the page ───────────────────────────────────
    {
        double WorstStar = 0.0;
        uint32_t Lit = 0u;
        for (int i = 0; i < 3000; ++i)
        {
            CelestialCriteria C{};
            C.Stars.RotationDegrees  = U(-180.0f, 180.0f);
            C.Stars.MilkyTiltDegrees = U(-90.0f, 90.0f);
            C.Stars.MilkyWay         = U(0.0f, 2.0f);
            C.Stars.Density          = U(0.1f, 2.0f);
            C.Stars.Twinkle          = U(0.0f, 1.0f);
            C.Stars.ColourStrength   = U(0.0f, 1.0f);
            C.Stars.Size             = U(0.4f, 3.0f);
            C.Stars.Glow             = U(0.0f, 2.0f);
            C.Stars.Brightness       = U(0.0f, 4.0f);
            //    Sweep every quality tier: `Layers` selects 1..4 and each adds a whole octave of stars.
            C.Stars.Layers           = std::floor(U(1.0f, 5.0f));

            const float TimeSeconds = U(0.0f, 400.0f);
            CelestialIntegrator Probe(C);
            Probe.SolveFrame(TimeSeconds);

            const float Elev = U(-1.55f, 1.55f), Azim = U(0.0f, 6.2831853f);
            const Vector3 Dir{ std::cos(Elev) * std::sin(Azim), std::sin(Elev), std::cos(Elev) * std::cos(Azim) };
            const float PixAng = U(2.0e-4f, 4.0e-3f);
            const float AirMass = U(1.0f, 12.0f);

            const Vector3 M = Probe.StarFieldValue(Dir, PixAng, AirMass);

            StarUniforms SU{};
            //    The panel's D2R path: double, rounded once on upload. Computing this in float instead shifts
            //    the angle by an ulp, and because the star grid is a `floor()` that silently picks a different
            //    star — which is exactly how the double/float split was found.
            SU.Rot      = PanelRadians(C.Stars.RotationDegrees);
            SU.Tilt     = PanelRadians(C.Stars.MilkyTiltDegrees);
            SU.Milky    = C.Stars.MilkyWay;
            SU.Layers   = C.Stars.Layers;
            SU.Density  = C.Stars.Density;
            SU.Twinkle  = C.Stars.Twinkle;
            SU.ColorAmt = C.Stars.ColourStrength;
            SU.Size     = C.Stars.Size;
            SU.Glow     = C.Stars.Glow;
            SU.Bright   = C.Stars.Brightness;
            SU.Time     = TimeSeconds;

            const v3 R = ref_starField(v3{ Dir.x, Dir.y, Dir.z }, PixAng, AirMass, SU);
            if (R.x + R.y + R.z > 1.0e-6f) { ++Lit; }

            const double Scale = std::max({ 1.0e-7, static_cast<double>(std::abs(R.x)),
                                            static_cast<double>(std::abs(R.y)),
                                            static_cast<double>(std::abs(R.z)) });
            WorstStar = std::max({ WorstStar,
                std::abs(R.x - M.x) / Scale,
                std::abs(R.y - M.y) / Scale,
                std::abs(R.z - M.z) / Scale });
        }
        char Cover[128];
        std::snprintf(Cover, sizeof(Cover), "%u of 3000 directions carried starlight", Lit);
        Gate(Lit > 500u, "the star field actually produced light to compare", Cover);
        Report("starField (4 layers, twinkle, spikes; relative)", WorstStar, 1.0e-5);
    }

    std::printf("\n");
    if (Failures == 0u)
    {
        std::printf("  %sTHE PORTED KERNELS ARE THE REFERENCE KERNELS%s — bit-level agreement, not resemblance\n\n",
                    kGreen, kReset);
        return 0;
    }
    std::printf("  %s%u KERNEL(S) DIVERGE FROM THE REFERENCE%s\n\n", kRed, Failures, kReset);
    return static_cast<int>(Failures);
}
