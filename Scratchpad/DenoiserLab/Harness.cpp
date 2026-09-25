//============================================================================================================================================
//                                                         HARNESS.CPP
//============================================================================================================================================
// DenoiserLab: runs the REAL AtrousDenoise.slang (staged 1:1 to C++ exactly as the repo's own M9 gate does) over a
// controlled synthetic frame that reproduces the failure modes under test:
//
//   - a checker/pinstripe wall            -> texture detail the filter should not erode (V7 demodulation)
//   - a grazing slanted floor             -> the depth edge-stop's blind spot (V6 gradient)
//   - a recessed trim strip (0.4 z-step)  -> a genuine small step the old depth rule blurs across (V6)
//   - a sphere + a sharp shadow band      -> normal / luminance edge preservation
//   - stable glints (converged + fresh)   -> the firefly clamp's collateral damage (V1)
//   - injected one-sample fireflies       -> the clamp's actual job, which must SURVIVE every variant
//   - a disocclusion block (n = 2)        -> unreliable young variance (V2)
//   - a smooth sky gradient (pass-through)-> 8-bit banding at the presentation write (V5)
//
// Input noise is 1-candidate-ReSTIR-like: per-sample multiplicative Exp(1) (relative sigma = 100%), accumulated with
// the kernel's own running mean + first-two-moments math (ReSTIRViewport.slang, pinned lines), variance of the MEAN.
//
// Output: Results/<Variant>.ppm, plus Reference.ppm / NoDenoise.ppm from the V0 run, and one CSV metrics line.

#include "DenoiseCpuShim.h"

#define main DenoiseEntry
#include STAGED1

#define Extent           DenoiseParameters.Extent
#define StepSize         DenoiseParameters.StepSize
#define Enabled          DenoiseParameters.Enabled
#define NormalPower      DenoiseParameters.NormalPower
#define DepthScale       DenoiseParameters.DepthScale
#define LuminanceScale   DenoiseParameters.LuminanceScale
#define Exposure         DenoiseParameters.Exposure
#define FinalLevel       DenoiseParameters.FinalLevel
#define ColourSaturation DenoiseParameters.ColourSaturation

#include STAGED2

#undef Extent
#undef StepSize
#undef Enabled
#undef NormalPower
#undef DepthScale
#undef LuminanceScale
#undef Exposure
#undef FinalLevel
#undef ColourSaturation
#undef main

InvocationId gl_GlobalInvocationID;

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <set>
#include <string>
#include <vector>

namespace Lab {

constexpr int W = 512;
constexpr int H = 512;
constexpr int Levels = 4;                       // the shipped chain at DenoiseLevelCount = 4 (steps 1, 2, 4, 8)

//------------------------------------------------------------------------------------------------------------------------
//                                                      DETERMINISTIC RNG
//------------------------------------------------------------------------------------------------------------------------

inline uint64_t Split(uint64_t X)
{
    X += 0x9e3779b97f4a7c15ULL;
    X = (X ^ (X >> 30)) * 0xbf58476d1ce4e5b9ULL;
    X = (X ^ (X >> 27)) * 0x94d049bb133111ebULL;
    return X ^ (X >> 31);
}
inline float U01(uint64_t S) { return float((Split(S) >> 11) & 0xFFFFFFu) / 16777216.0f; }
inline float Exp1(uint64_t S) { return -std::log(1.0f - std::min(U01(S), 0.999999f)); }   // Exp(1): mean 1, var 1

//------------------------------------------------------------------------------------------------------------------------
//                                                          SCENE
//------------------------------------------------------------------------------------------------------------------------

enum RegionId { RSky = 0, RWall, RTrim, RFloor, RSphere };

constexpr float SphereCx = 256.0f, SphereCy = 300.0f, SphereR = 110.0f;

inline int Region(int X, int Y)
{
    if (Y < 72) return RSky;
    const float Dx = float(X) - SphereCx, Dy = float(Y) - SphereCy;
    if (Dx * Dx + Dy * Dy < SphereR * SphereR) return RSphere;
    if (X >= 88 && X < 108) return RTrim;
    return X < 256 ? RWall : RFloor;
}

inline float DepthOf(int X, int Y)
{
    switch (Region(X, Y))
    {
        case RSky:    return -1.0f;
        case RWall:   return 5.0f;
        case RTrim:   return 4.6f;                                     // a genuine 0.4 step in front of the wall
        case RFloor:  return 2.5f + (float(Y) - 72.0f) * 0.045f;       // grazing slant: strong, CONSISTENT gradient
        default: {
            const float Dx = float(X) - SphereCx, Dy = float(Y) - SphereCy;
            const float T  = std::sqrt(std::max(SphereR * SphereR - Dx * Dx - Dy * Dy, 0.0f)) / SphereR;
            return 4.0f - 1.2f * T;
        }
    }
}

inline vec3 NormalOf(int X, int Y)
{
    switch (Region(X, Y))
    {
        case RFloor:  return normalize(vec3(0.0f, -0.93f, 0.37f));
        case RSphere: {
            const float Dx = (float(X) - SphereCx) / SphereR, Dy = (float(Y) - SphereCy) / SphereR;
            const float Z  = std::sqrt(std::max(1.0f - Dx * Dx - Dy * Dy, 0.0f));
            return normalize(vec3(Dx, Dy, std::max(Z, 0.05f)));
        }
        default:      return vec3(0.0f, 0.0f, 1.0f);
    }
}

inline vec3 AlbedoOf(int X, int Y)
{
    switch (Region(X, Y))
    {
        case RSky:  return vec3(1.0f, 1.0f, 1.0f);
        case RWall: {
            if ((X % 17) < 2) return vec3(0.85f, 0.82f, 0.75f);         // pinstripes: 2 px of high-frequency detail
            const bool C = (((X / 24) + (Y / 24)) & 1) != 0;
            return C ? vec3(0.62f, 0.44f, 0.28f) : vec3(0.24f, 0.30f, 0.42f);
        }
        case RTrim: return vec3(0.75f, 0.72f, 0.66f);
        case RFloor: {
            const float V = 0.45f + 0.15f * U01(uint64_t(X / 7) * 8191u + uint64_t(Y / 7) * 131071u + 7u);
            return vec3(V, V * 0.92f, V * 0.80f);                       // blocky 7 px value-noise texture
        }
        default:    return vec3(0.30f, 0.34f, 0.38f);
    }
}

inline float ShadowFactor(int X, int Y)
{
    const float S = float(X + Y);
    const float T = smoothstep(575.0f, 583.0f, S) * (1.0f - smoothstep(657.0f, 665.0f, S));
    return 1.0f - 0.85f * T;                                            // a sharp-edged diagonal shadow band
}

inline bool IsGlint(int X, int Y)
{
    const int R = Region(X, Y);
    if (R != RFloor && R != RSphere) return false;
    if (ShadowFactor(X, Y) < 0.5f) return false;
    return (Split(uint64_t(Y) * W + uint64_t(X) + 0x611Au) % 277u) == 0u;
}

inline bool IsFirefly(int X, int Y)
{
    if (Region(X, Y) == RSky || IsGlint(X, Y)) return false;
    return (Split(uint64_t(Y) * W + uint64_t(X) + 0xFFu) % 1409u) == 0u;
}

// Sample counts: the moving-camera default is n = 8 (alpha-clamped history), one block is converged (n = 64),
// one block is a fresh disocclusion (n = 2), the analytic sky is noiseless.
inline int CountOf(int X, int Y)
{
    if (Region(X, Y) == RSky) return 64;
    if (X >= 300 && X < 500 && Y >= 100 && Y < 300) return 64;          // converged block
    if (X >= 190 && X < 330 && Y >= 385 && Y < 500) return 2;           // disocclusion block
    return 8;
}

inline vec3 TruthRadiance(int X, int Y)
{
    if (Region(X, Y) == RSky)
    {
        const float T = smoothstep(0.0f, 511.0f, float(X));
        vec3 SkyA = vec3(0.10f, 0.16f, 0.34f), SkyB = vec3(0.85f, 0.50f, 0.24f);
        return mix(SkyA, SkyB, T) * (0.22f + 0.0032f * float(Y));       // smooth, low-contrast: the banding probe
    }
    float I = 0.35f + 0.75f * smoothstep(72.0f, 460.0f, float(Y));
    const float B1 = 0.70f * std::exp(-((X - 140.0f) * (X - 140.0f) + (Y - 180.0f) * (Y - 180.0f)) / (2.0f * 110.0f * 110.0f));
    const float B2 = 0.55f * std::exp(-((X - 420.0f) * (X - 420.0f) + (Y - 350.0f) * (Y - 350.0f)) / (2.0f * 90.0f * 90.0f));
    I = (I + B1 + B2) * ShadowFactor(X, Y);
    if (Region(X, Y) == RTrim) I *= 0.55f;                              // the recess sits in its own shade
    vec3 Lit = AlbedoOf(X, Y) * I;
    if (Region(X, Y) == RSphere)
    {
        vec3 L = normalize(vec3(0.4f, -0.5f, 0.75f));
        Lit = Lit * (0.25f + 0.75f * std::max(dot(NormalOf(X, Y), L), 0.0f));
    }
    Lit = Lit * vec3(1.0f, 0.96f, 0.90f);
    if (IsGlint(X, Y)) Lit = Lit * 12.0f;                               // a stable bright facet, part of the SIGNAL
    return Lit;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  KERNEL-EXACT ACCUMULATION
//------------------------------------------------------------------------------------------------------------------------
// The running mean and the first two luminance moments, verbatim from the pinned ReSTIRViewport.slang lines:
//     mean += (x - mean) / n;   moments += (l, l^2 - moments) / n;   var = (E[l^2] - E[l]^2) / n;   n < 2 -> l^2.
// HV_YOUNG adds the V2 change: a floor for n < 4, where two or three samples cannot certify a low variance.

struct Accumulated { vec3 Mean; float Variance; };

Accumulated Accumulate(int X, int Y, const vec3& Truth, int N, bool Demodulate)
{
    const vec3 Albedo = AlbedoOf(X, Y);
    vec3  Mean(0.0f, 0.0f, 0.0f);
    float M1 = 0.0f, M2 = 0.0f;
    for (int I = 0; I < N; ++I)
    {
        const uint64_t Seed = (uint64_t(Y) * W + uint64_t(X)) * 131u + uint64_t(I) * 2654435761u;
        vec3 Sample = Truth * Exp1(Seed);
        if (IsFirefly(X, Y) && I == 0) Sample = vec3(60.0f, 57.0f, 50.0f);   // one huge sample lands in the history
        if (Demodulate)
            Sample = Sample / max(Albedo, vec3(0.02f, 0.02f, 0.02f));
        const float Count = float(I + 1);
        Mean += (Sample - Mean) / Count;
        const float Luma = Luminance(Sample);
        M1 += (Luma - M1) / Count;
        M2 += (Luma * Luma - M2) / Count;
    }
    const float SampleVariance = std::max(M2 - M1 * M1, 0.0f);
    float Variance = SampleVariance / float(N);
    const float MeanLuma = Luminance(Mean);
#ifdef HV_YOUNG
    // V2: a young history is not allowed to certify silence. Floor scaled by brightness, fading out by n = 4.
    if (N < 4) Variance = std::max(Variance, MeanLuma * MeanLuma * float(4 - N) * 0.125f);
#endif
    if (N < 2) Variance = MeanLuma * MeanLuma;
    return { Mean, Variance };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        IMAGE HELPERS
//------------------------------------------------------------------------------------------------------------------------

inline int Quantise(float V) { return int(std::lround(clamp(V, 0.0f, 1.0f) * 255.0f)); }

void WritePpm(const char* Path, const std::vector<unsigned char>& Rgb)
{
    FILE* F = std::fopen(Path, "wb");
    if (!F) { std::fprintf(stderr, "cannot write %s\n", Path); std::exit(2); }
    std::fprintf(F, "P6\n%d %d\n255\n", W, H);
    std::fwrite(Rgb.data(), 1, Rgb.size(), F);
    std::fclose(F);
}

std::vector<unsigned char> Bytes(const image2D& Image)
{
    std::vector<unsigned char> Out(size_t(W) * H * 3u);
    for (int Y = 0; Y < H; ++Y)
        for (int X = 0; X < W; ++X)
        {
            const vec4 T = Image.Texels[size_t(Y) * W + X];
            Out[(size_t(Y) * W + X) * 3 + 0] = (unsigned char)Quantise(T.x);
            Out[(size_t(Y) * W + X) * 3 + 1] = (unsigned char)Quantise(T.y);
            Out[(size_t(Y) * W + X) * 3 + 2] = (unsigned char)Quantise(T.z);
        }
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          METRICS
//------------------------------------------------------------------------------------------------------------------------

double PsnrOver(const std::vector<unsigned char>& A, const std::vector<unsigned char>& B, const std::vector<char>& Mask)
{
    double Sum = 0.0; long Count = 0;
    for (int Y = 0; Y < H; ++Y)
        for (int X = 0; X < W; ++X)
        {
            if (!Mask[size_t(Y) * W + X]) continue;
            for (int C = 0; C < 3; ++C)
            {
                const double D = double(A[(size_t(Y) * W + X) * 3 + C]) - double(B[(size_t(Y) * W + X) * 3 + C]);
                Sum += D * D; ++Count;
            }
        }
    if (Count == 0) return 0.0;
    const double Mse = Sum / double(Count);
    return Mse <= 1e-12 ? 99.0 : 10.0 * std::log10(255.0 * 255.0 / Mse);
}

double LumaByte(const std::vector<unsigned char>& Img, int X, int Y)
{
    const size_t I = (size_t(Y) * W + X) * 3;
    return 0.2126 * Img[I] + 0.7152 * Img[I + 1] + 0.0722 * Img[I + 2];
}

} // namespace Lab

//------------------------------------------------------------------------------------------------------------------------
//                                                           MAIN
//------------------------------------------------------------------------------------------------------------------------

int main(int Argc, char** Argv)
{
    using namespace Lab;
    const std::string Variant = Argc > 1 ? Argv[1] : "V0_Baseline";
    const std::string OutDir  = Argc > 2 ? Argv[2] : "Results";
#ifdef HV_DEMOD
    const bool Demod = true;
#else
    const bool Demod = false;
#endif

    // ---- build the frame the kernel would hand the filter --------------------------------------------------------------
    SourceImage.Assign(W, H);
    TargetImage.Assign(W, H);
    SurfaceImage.Assign(W, H);
    OutputImage.Assign(W, H);
#ifdef HV_DEMOD
    AlbedoImage.Assign(W, H);
#endif

    std::vector<vec4> InputTexels(size_t(W) * H);
    std::vector<vec4> OutputPrefill(size_t(W) * H);   // HV_SHIP: the albedo the kernel parks in OutputImage
    std::vector<unsigned char> Reference(size_t(W) * H * 3u);
    std::vector<float> ReferenceFloat(size_t(W) * H * 3u);

    DenoiseParameters.Exposure = 1.0f;            // ToneMap below reads these two through the macro binding
    DenoiseParameters.ColourSaturation = 1.0f;

    for (int Y = 0; Y < H; ++Y)
        for (int X = 0; X < W; ++X)
        {
            const size_t I = size_t(Y) * W + X;
            const vec3 Truth = TruthRadiance(X, Y);
            const float Depth = DepthOf(X, Y);
            SurfaceImage.Texels[I] = vec4(NormalOf(X, Y), Depth);
#ifdef HV_DEMOD
            AlbedoImage.Texels[I] = vec4(AlbedoOf(X, Y), 1.0f);
#endif
            if (Depth <= 0.0f)
            {
                InputTexels[I] = vec4(Truth, 0.0f);        // analytic sky: noiseless, variance 0, albedo 1
                OutputPrefill[I] = vec4(1.0f, 1.0f, 1.0f, 1.0f);
            }
            else
            {
#ifdef HV_SHIP
                // The ship kernel's exact math: RADIANCE moments, then the store demodulates the mean by the
                //    rgba8-quantised albedo and rescales the variance by that albedo's luminance squared.
                const Accumulated A = Accumulate(X, Y, Truth, CountOf(X, Y), false);
                const vec3 Alb = AlbedoOf(X, Y);
                const vec3 QAlb = max(vec3(std::floor(Alb.x * 255.0f + 0.5f) / 255.0f,
                                           std::floor(Alb.y * 255.0f + 0.5f) / 255.0f,
                                           std::floor(Alb.z * 255.0f + 0.5f) / 255.0f),
                                      vec3(0.02f, 0.02f, 0.02f));
                const float QLum = std::max(Luminance(QAlb), 0.02f);
                InputTexels[I] = vec4(A.Mean / QAlb, A.Variance / (QLum * QLum));
                OutputPrefill[I] = vec4(QAlb, 1.0f);
#else
                const Accumulated A = Accumulate(X, Y, Truth, CountOf(X, Y), Demod);
                InputTexels[I] = vec4(A.Mean, A.Variance);
#endif
            }
            const vec3 Ref = ToneMap(Truth);
            Reference[I * 3 + 0] = (unsigned char)Quantise(Ref.x);
            Reference[I * 3 + 1] = (unsigned char)Quantise(Ref.y);
            Reference[I * 3 + 2] = (unsigned char)Quantise(Ref.z);
            ReferenceFloat[I * 3 + 0] = clamp(Ref.x, 0.0f, 1.0f) * 255.0f;
            ReferenceFloat[I * 3 + 1] = clamp(Ref.y, 0.0f, 1.0f) * 255.0f;
            ReferenceFloat[I * 3 + 2] = clamp(Ref.z, 0.0f, 1.0f) * 255.0f;
        }

    // ---- run the level chain, timed over repeats ------------------------------------------------------------------------
    const int Repeats = 5;
    double BestMs = 1e30;
    for (int R = 0; R < Repeats; ++R)
    {
        SourceImage.Texels = InputTexels;
#ifdef HV_SHIP
        OutputImage.Texels = OutputPrefill;   // the ship filter READS the parked albedo before overwriting
#endif
        const auto T0 = std::chrono::steady_clock::now();
        for (int Level = 0; Level < Levels; ++Level)
        {
            DenoiseParameters.Extent           = uvec2(unsigned(W), unsigned(H));
            DenoiseParameters.StepSize         = 1u << Level;
            DenoiseParameters.Enabled          = 1u;
            DenoiseParameters.NormalPower      = 64.0f;
            DenoiseParameters.DepthScale       = 0.05f;
            DenoiseParameters.LuminanceScale   = 4.0f;
#ifdef HV_SCHEDULE
            {   // V3: tighten the luminance stop as the taps widen — late levels are where detail smears.
                const float Sigma[4] = { 4.0f, 4.0f, 2.0f, 1.0f };
                DenoiseParameters.LuminanceScale = Sigma[Level];
            }
#endif
            DenoiseParameters.Exposure         = 1.0f;
            DenoiseParameters.FinalLevel       = (Level + 1 == Levels) ? 1u : 0u;
            DenoiseParameters.ColourSaturation = 1.0f;
            for (int Y = 0; Y < H; ++Y)
                for (int X = 0; X < W; ++X)
                {
                    gl_GlobalInvocationID.x = unsigned(X);
                    gl_GlobalInvocationID.y = unsigned(Y);
                    DenoiseEntry();
                }
            std::swap(SourceImage.Texels, TargetImage.Texels);
        }
        const auto T1 = std::chrono::steady_clock::now();
        BestMs = std::min(BestMs, std::chrono::duration<double, std::milli>(T1 - T0).count());
    }

    // ---- masks ----------------------------------------------------------------------------------------------------------
    auto MaskOf = [&](auto Predicate) {
        std::vector<char> M(size_t(W) * H, 0);
        for (int Y = 0; Y < H; ++Y) for (int X = 0; X < W; ++X) M[size_t(Y) * W + X] = Predicate(X, Y) ? 1 : 0;
        return M;
    };
    auto Plain = [&](int X, int Y) { return !IsGlint(X, Y) && !IsFirefly(X, Y); };
    const auto MAll       = MaskOf([&](int X, int Y) { return !IsFirefly(X, Y); });
    const auto MWall      = MaskOf([&](int X, int Y) { return Region(X, Y) == RWall && Plain(X, Y); });
    const auto MFloor     = MaskOf([&](int X, int Y) { return Region(X, Y) == RFloor && Plain(X, Y) && CountOf(X, Y) == 8; });
    const auto MTrim      = MaskOf([&](int X, int Y) { return Region(X, Y) == RTrim && Plain(X, Y); });
    const auto MConverged = MaskOf([&](int X, int Y) { return Region(X, Y) != RSky && CountOf(X, Y) == 64 && Plain(X, Y); });
    const auto MWedge     = MaskOf([&](int X, int Y) { return CountOf(X, Y) == 2 && Plain(X, Y); });

    const auto Out = Bytes(OutputImage);

    // ---- glint retention & firefly leak ----------------------------------------------------------------------------------
    double GlintConvOut = 0.0, GlintConvRef = 0.0, GlintFreshOut = 0.0, GlintFreshRef = 0.0;
    double FireflySum = 0.0; long FireflyCount = 0;
    for (int Y = 0; Y < H; ++Y)
        for (int X = 0; X < W; ++X)
        {
            if (IsGlint(X, Y))
            {
                const double O = LumaByte(Out, X, Y), Rf = LumaByte(Reference, X, Y);
                if (CountOf(X, Y) == 64) { GlintConvOut += O; GlintConvRef += Rf; }
                else if (CountOf(X, Y) == 8) { GlintFreshOut += O; GlintFreshRef += Rf; }
            }
            if (IsFirefly(X, Y))
            {
                const double O = LumaByte(Out, X, Y), Rf = std::max(LumaByte(Reference, X, Y), 1.0);
                FireflySum += O / Rf; ++FireflyCount;
            }
        }

    // ---- sky banding: low-frequency error vs the FLOAT reference, and distinct levels per row ---------------------------
    double SkyBlockErr = 0.0; int SkyBlocks = 0;
    for (int By = 0; By < 64; By += 8)
        for (int Bx = 0; Bx < W; Bx += 8)
        {
            double E[3] = { 0.0, 0.0, 0.0 };
            for (int Y = By; Y < By + 8; ++Y)
                for (int X = Bx; X < Bx + 8; ++X)
                    for (int C = 0; C < 3; ++C)
                        E[C] += double(Out[(size_t(Y) * W + X) * 3 + C]) - double(ReferenceFloat[(size_t(Y) * W + X) * 3 + C]);
            SkyBlockErr += (std::fabs(E[0]) + std::fabs(E[1]) + std::fabs(E[2])) / (3.0 * 64.0);
            ++SkyBlocks;
        }
    SkyBlockErr /= std::max(SkyBlocks, 1);

    double DistinctSum = 0.0; int DistinctRows = 0;
    for (int Y = 8; Y < 64; Y += 4)
    {
        std::set<int> Levels3;
        for (int X = 0; X < W; ++X)
        {
            const size_t I = (size_t(Y) * W + X) * 3;
            Levels3.insert(int(Out[I]) << 16 | int(Out[I + 1]) << 8 | int(Out[I + 2]));
        }
        DistinctSum += double(Levels3.size()); ++DistinctRows;
    }
    DistinctSum /= std::max(DistinctRows, 1);

    // ---- outputs ---------------------------------------------------------------------------------------------------------
    WritePpm((OutDir + "/" + Variant + ".ppm").c_str(), Out);
    if (Variant == "V0_Baseline")
    {
        WritePpm((OutDir + "/Reference.ppm").c_str(), Reference);
        image2D InputShow; InputShow.Assign(W, H);
        for (int Y = 0; Y < H; ++Y)
            for (int X = 0; X < W; ++X)
            {
                vec3 Mean = InputTexels[size_t(Y) * W + X].rgb;
                const vec3 Tone = ToneMap(Mean);
                InputShow.Texels[size_t(Y) * W + X] = vec4(Tone, 1.0f);
            }
        WritePpm((OutDir + "/NoDenoise.ppm").c_str(), Bytes(InputShow));
    }

    std::printf("%s,%.1f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.1f,%.1f,%.2f,%.3f,%.0f\n",
                Variant.c_str(), BestMs,
                PsnrOver(Out, Reference, MAll),
                PsnrOver(Out, Reference, MWall),
                PsnrOver(Out, Reference, MFloor),
                PsnrOver(Out, Reference, MTrim),
                PsnrOver(Out, Reference, MConverged),
                PsnrOver(Out, Reference, MWedge),
                100.0 * GlintConvOut / std::max(GlintConvRef, 1.0),
                100.0 * GlintFreshOut / std::max(GlintFreshRef, 1.0),
                FireflyCount > 0 ? FireflySum / FireflyCount : 0.0,
                SkyBlockErr, DistinctSum);
    return 0;
}
