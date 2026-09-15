//============================================================================================================================================
// 📦 Frontier/Scratchpad/RockFieldProof/RockFieldProof.cpp — Host Side Verification and Reference Rendering of the Geologic SDF
//============================================================================================================================================
//
// Compiles Shaders/RockFieldSpace.glsl verbatim as C++20 and then:
//   ① measures the field numerically (Lipschitz validity, surface reachability, term contribution)
//   ② renders reference frames of every lithology with the same sphere tracer the WebGL preview uses
//
// This is the check that the geology is real before it is trusted in a browser. Scratchpad only.
//
//============================================================================================================================================

#include "GlslCompatSpecification.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

//------------------------------------------------------------------------------------------------------------------------
//                                                    KERNEL INCLUSION
//------------------------------------------------------------------------------------------------------------------------

#include "../../Shaders/RockFieldSpace.glsl"

//------------------------------------------------------------------------------------------------------------------------
//                                                     SPHERE TRACER
//------------------------------------------------------------------------------------------------------------------------

struct TraceRecord
{
    bool                    Struck = false;                     // [-] did the ray reach the surface
    float                   Travel = 0.0f;                      // [m] distance along the ray
    int                     Steps = 0;                          // [count] iterations consumed
    vec3                    Location{};                         // [m] surface point
};

static float PixelFootprint(float Travel, float ConeAngle) noexcept
{
    return std::max(Travel * ConeAngle, 1e-4f);
}

static TraceRecord TraceRock(const vec3& Origin, const vec3& Direction, float ConeAngle, float FarLimit) noexcept
{
    // Two phase sphere trace.
    //   Phase ①  march the coarse body (mass + joints) minus the detail amplitude. Large, safe steps.
    //   Phase ②  once inside the detail shell, switch to the fully displaced field.
    //
    // Critically, the hit test is made against the TRUE field value, never against the Lipschitz normalised step.
    // The normalised step is only ever used to decide how far it is safe to advance. Testing the normalised value
    // for proximity would stop the ray L times too early — tens of centimetres above the rock, in the smooth
    // region above every displacement term — and the surface would render as featureless plastic.
    TraceRecord Record;
    float Travel = 0.0f;

    for (int Step = 0; Step < 512; ++Step)
    {
        vec3 Sample = Origin + Direction * Travel;
        float Footprint = PixelFootprint(Travel, ConeAngle);
        Record.Steps = Step;

        float Coarse = RockCoarseDistance(Sample);
        float Shell = RockDetailAmplitude(Footprint);
        if (Coarse - Shell > Footprint)
        {
            Travel += std::max((Coarse - Shell) / std::max(RockCoarseLipschitz, 1.0f), 1e-4f);
            if (Travel > FarLimit)
            {
                break;
            }
            continue;
        }

        // Inside the detail shell: resolve against the full field.
        float Field = RockFieldDistance(Sample, Footprint);
        if (Field < Footprint * 0.5f)
        {
            Record.Struck = true;
            Record.Travel = Travel;
            Record.Location = Sample;
            return Record;
        }
        // Field is already in hand and RockLipschitz still describes this sample, so normalise it directly rather
        // than paying for a second full evaluation of the same point.
        Travel += std::max(RockNormaliseStep(Field), Footprint * 0.12f);
        if (Travel > FarLimit)
        {
            break;
        }
    }
    Record.Travel = Travel;
    return Record;
}

static vec3 RockNormal(const vec3& Position, float Footprint) noexcept
{
    float Epsilon = std::max(Footprint * 0.6f, 4e-4f);
    float Dx = RockFieldDistance(Position + vec3(Epsilon, 0.0f, 0.0f), Footprint)
             - RockFieldDistance(Position - vec3(Epsilon, 0.0f, 0.0f), Footprint);
    float Dy = RockFieldDistance(Position + vec3(0.0f, Epsilon, 0.0f), Footprint)
             - RockFieldDistance(Position - vec3(0.0f, Epsilon, 0.0f), Footprint);
    float Dz = RockFieldDistance(Position + vec3(0.0f, 0.0f, Epsilon), Footprint)
             - RockFieldDistance(Position - vec3(0.0f, 0.0f, Epsilon), Footprint);
    return normalize(vec3(Dx, Dy, Dz));
}

static float RockOcclusion(const vec3& Position, const vec3& Normal, float Footprint) noexcept
{
    float Occlusion = 0.0f;
    float Weight = 1.0f;
    for (int Sample = 1; Sample <= 5; ++Sample)
    {
        float Reach = 0.012f * float(Sample) * float(Sample);
        float Field = RockFieldDistance(Position + Normal * Reach, Footprint);
        Occlusion += Weight * (Reach - Field);
        Weight *= 0.72f;
    }
    return clamp(1.0f - 2.6f * Occlusion, 0.0f, 1.0f);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   MEASUREMENT PASSES
//------------------------------------------------------------------------------------------------------------------------

struct MeasurementRecord
{
    int                     Rays = 0;                           // [count] rays cast
    int                     Hits = 0;                           // [count] rays that reached the surface
    int                     Overshoots = 0;                     // [count] steps that crossed the surface illegally
    int                     StepTotal = 0;                      // [count] accumulated iterations
    int                     StepPeak = 0;                       // [count] worst case iterations
    float                   LipschitzPeak = 0.0f;               // [-] largest bound observed
    float                   GradientPeak = 0.0f;                // [-] largest measured ‖∇f‖ after normalisation
};

// Verifies the central claim of the kernel: on the exterior — the only region a sphere tracer ever traverses —
// the normalised field f / L is 1-Lipschitz, so a step of f / L can never jump past the surface.
static MeasurementRecord MeasureLipschitzValidity(int Lithology, unsigned SampleCount)
{
    MeasurementRecord Record;
    RockShape = RockPreset(Lithology, 3.0f);

    unsigned Sequence = 12345u;
    auto NextUnit = [&Sequence]() noexcept
    {
        Sequence = Sequence * 1664525u + 1013904223u;
        return float(Sequence >> 8u) * (1.0f / 16777216.0f);
    };

    for (unsigned Sample = 0; Sample < SampleCount; ++Sample)
    {
        vec3 Position(NextUnit() * 6.0f - 3.0f, NextUnit() * 6.0f - 3.0f, NextUnit() * 4.0f - 1.6f);
        const float Footprint = 0.004f;

        float Centre = RockFieldDistance(Position, Footprint);
        float BoundHere = RockLipschitz;
        if (Centre < 0.0f)
        {
            // Interior samples are unreachable by the tracer: it terminates at the zero crossing.
            continue;
        }
        Record.LipschitzPeak = std::max(Record.LipschitzPeak, BoundHere);

        // Measure the true local gradient of the normalised field and confirm it stays within unity.
        const float Delta = 1e-3f;
        float Dx = RockFieldDistance(Position + vec3(Delta, 0.0f, 0.0f), Footprint) - Centre;
        float Dy = RockFieldDistance(Position + vec3(0.0f, Delta, 0.0f), Footprint) - Centre;
        float Dz = RockFieldDistance(Position + vec3(0.0f, 0.0f, Delta), Footprint) - Centre;
        float Gradient = length(vec3(Dx, Dy, Dz)) / Delta;
        float Normalised = Gradient / std::max(BoundHere, 1.0f);
        Record.GradientPeak = std::max(Record.GradientPeak, Normalised);
        if (Normalised > 1.0f)
        {
            Record.Overshoots++;
        }
        Record.Rays++;
    }
    return Record;
}

// Casts a camera worth of rays and confirms the tracer converges without tunnelling through the rock.
static MeasurementRecord MeasureTraceBehaviour(int Lithology, int Resolution)
{
    MeasurementRecord Record;
    RockShape = RockPreset(Lithology, 3.0f);

    const vec3 Eye(4.05f, -4.35f, 2.35f);
    const vec3 Focus(0.0f, 0.0f, 0.35f);
    const vec3 Forward = normalize(Focus - Eye);
    const vec3 Right = normalize(cross(Forward, vec3(0.0f, 0.0f, 1.0f)));
    const vec3 Up = cross(Right, Forward);
    const float ConeAngle = 1.0f / float(Resolution);

    for (int Y = 0; Y < Resolution; ++Y)
    {
        for (int X = 0; X < Resolution; ++X)
        {
            float U = (float(X) + 0.5f) / float(Resolution) * 2.0f - 1.0f;
            float V = (float(Y) + 0.5f) / float(Resolution) * 2.0f - 1.0f;
            vec3 Direction = normalize(Forward * 1.65f + Right * U + Up * V);

            TraceRecord Trace = TraceRock(Eye, Direction, ConeAngle, 22.0f);
            Record.Rays++;
            Record.StepTotal += Trace.Steps;
            Record.StepPeak = std::max(Record.StepPeak, Trace.Steps);
            if (Trace.Struck)
            {
                Record.Hits++;
                // A legal hit approaches the surface from outside: the field at the struck point must not be
                // deeply negative, which would mean the marcher had already tunnelled inside the rock.
                float Field = RockFieldDistance(Trace.Location, PixelFootprint(Trace.Travel, ConeAngle));
                if (Field < -PixelFootprint(Trace.Travel, ConeAngle) * 6.0f)
                {
                    Record.Overshoots++;
                }
            }
        }
    }
    return Record;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  REFERENCE SHADING
//------------------------------------------------------------------------------------------------------------------------

static vec3 LithologyAlbedo(int Lithology, const RockSurfaceRecord& Surface, float Seed) noexcept
{
    vec3 Fresh;
    vec3 Weathered;

    if (Lithology == ROCK_LITHOLOGY_GRANITE)
    {
        Fresh = vec3(0.560f, 0.530f, 0.505f);
        Weathered = vec3(0.395f, 0.350f, 0.295f);
    }
    else if (Lithology == ROCK_LITHOLOGY_SANDSTONE)
    {
        Fresh = vec3(0.680f, 0.505f, 0.330f);
        Weathered = vec3(0.520f, 0.360f, 0.225f);
    }
    else if (Lithology == ROCK_LITHOLOGY_BASALT)
    {
        Fresh = vec3(0.180f, 0.178f, 0.185f);
        Weathered = vec3(0.128f, 0.120f, 0.118f);
    }
    else if (Lithology == ROCK_LITHOLOGY_LIMESTONE)
    {
        Fresh = vec3(0.700f, 0.685f, 0.630f);
        Weathered = vec3(0.500f, 0.485f, 0.430f);
    }
    else
    {
        Fresh = vec3(0.395f, 0.390f, 0.395f);
        Weathered = vec3(0.285f, 0.275f, 0.265f);
    }

    // Freshly spalled scars expose unweathered rock; long exposed faces darken and dull.
    float Freshness = clamp(Surface.SpallFreshness, 0.0f, 1.0f);
    vec3 Albedo = mix(Weathered, Fresh, Freshness);

    // Grain scale mottling from the crystal / clast field.
    Albedo = Albedo * (1.0f + 0.16f * Surface.GrainSignal);

    // Case hardened rind is paler and slightly polished; cavity interiors are darker and dustier.
    Albedo = mix(Albedo, Albedo * 1.12f, clamp(Surface.RindIntegrity - 0.5f, 0.0f, 0.5f) * 2.0f * 0.6f);
    Albedo = mix(Albedo, Albedo * 0.62f, clamp(Surface.CavityDepth * 6.0f, 0.0f, 1.0f));
    (void)Seed;
    return clamp(Albedo, 0.0f, 1.0f);
}

static vec3 ShadeSample(const vec3& Position, const vec3& Normal, float Footprint, int Lithology) noexcept
{
    const vec3 SunDirection = normalize(vec3(0.52f, -0.62f, 0.59f));
    const vec3 SunColour = vec3(1.28f, 1.17f, 0.99f);
    const vec3 SkyColour = vec3(0.34f, 0.42f, 0.56f);
    const vec3 BounceColour = vec3(0.25f, 0.21f, 0.16f);

    RockSurfaceRecord Surface = RockSurface;
    vec3 Albedo = LithologyAlbedo(Lithology, Surface, RockShape.Seed);

    float Occlusion = RockOcclusion(Position, Normal, Footprint);

    // Soft shadow by marching the normalised field toward the sun.
    float Shadow = 1.0f;
    float Travel = 0.03f;
    for (int Step = 0; Step < 64; ++Step)
    {
        vec3 Sample = Position + SunDirection * Travel;
        float Probe = Footprint + Travel * 0.01f;
        // Shadow rays march the coarse body directly. Subtracting the detail amplitude here (as the primary ray
        // does) would report every surface point as buried and shadow the whole rock black.
        float Field = RockCoarseDistance(Sample) / std::max(RockCoarseLipschitz, 1.0f);
        Shadow = std::min(Shadow, 10.0f * Field / Travel);
        Travel += clamp(Field, 0.02f, 0.30f);
        (void)Probe;
        if (Shadow < 0.004f || Travel > 7.0f)
        {
            break;
        }
    }
    Shadow = clamp(Shadow, 0.0f, 1.0f);

    float Lambert = std::max(dot(Normal, SunDirection), 0.0f);
    float SkyTerm = clamp(0.5f + 0.5f * Normal.z, 0.0f, 1.0f);
    float BounceTerm = clamp(0.4f - 0.4f * Normal.z, 0.0f, 1.0f);

    vec3 Radiance = Albedo * SunColour * (Lambert * Shadow);
    Radiance += Albedo * SkyColour * (SkyTerm * Occlusion * 0.62f);
    Radiance += Albedo * BounceColour * (BounceTerm * Occlusion);

    // Wet-look specular sheen concentrated on intact rind, suppressed inside friable cavities.
    vec3 ViewDirection = normalize(vec3(4.05f, -4.35f, 2.35f) - Position);
    vec3 Halfway = normalize(ViewDirection + SunDirection);
    float Gloss = mix(12.0f, 46.0f, clamp(Surface.RindIntegrity, 0.0f, 1.0f));
    float Specular = std::pow(std::max(dot(Normal, Halfway), 0.0f), Gloss);
    float Reflectance = 0.035f * Surface.RindIntegrity * (1.0f - clamp(Surface.CavityDepth * 5.0f, 0.0f, 1.0f));
    Radiance += SunColour * (Specular * Reflectance * Shadow * 8.0f);

    return Radiance;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   IMAGE EMISSION
//------------------------------------------------------------------------------------------------------------------------

static void WritePortablePixmap(const std::string& Path, const std::vector<vec3>& Pixels, int Width, int Height)
{
    std::ofstream Stream(Path, std::ios::binary);
    Stream << "P6\n" << Width << " " << Height << "\n255\n";
    for (int Index = 0; Index < Width * Height; ++Index)
    {
        vec3 Colour = Pixels[size_t(Index)];
        // Filmic-ish tonemap then sRGB transfer.
        Colour = Colour / (Colour + vec3(1.0f));
        Colour = pow(clamp(Colour, 0.0f, 1.0f), 1.0f / 2.2f);
        unsigned char Bytes[3] = {
            (unsigned char)(clamp(Colour.x, 0.0f, 1.0f) * 255.0f + 0.5f),
            (unsigned char)(clamp(Colour.y, 0.0f, 1.0f) * 255.0f + 0.5f),
            (unsigned char)(clamp(Colour.z, 0.0f, 1.0f) * 255.0f + 0.5f)
        };
        Stream.write((const char*)Bytes, 3);
    }
}

struct ViewSpecification
{
    vec3                    Eye;                                // [m] camera position
    vec3                    Focus;                              // [m] look at target
    float                   Zoom;                               // [-] focal multiplier
};

static void RenderLithology(int Lithology, const ViewSpecification& View, const std::string& Path,
                            int Width, int Height, int SuperSample)
{
    std::vector<vec3> Pixels(size_t(Width * Height), vec3(0.0f, 0.0f, 0.0f));

    const vec3 Forward = normalize(View.Focus - View.Eye);
    const vec3 Right = normalize(cross(Forward, vec3(0.0f, 0.0f, 1.0f)));
    const vec3 Up = cross(Right, Forward);
    const float Aspect = float(Width) / float(Height);
    const float ConeAngle = 1.0f / (float(Height) * View.Zoom);

    // The kernel globals (RockShape / RockSurface / RockLipschitz) are shared mutable state exactly as they are in
    // GLSL, so this renderer stays single threaded and parallelism is achieved by running one process per frame.
    RockShape = RockPreset(Lithology, 3.0f);

    for (int Y = 0; Y < Height; ++Y)
    {
        for (int X = 0; X < Width; ++X)
        {
            vec3 Accumulated(0.0f, 0.0f, 0.0f);
            for (int Sub = 0; Sub < SuperSample; ++Sub)
            {
                float JitterX = (float(Sub % 2) + 0.5f) / 2.0f;
                float JitterY = (float(Sub / 2) + 0.5f) / 2.0f;
                float U = ((float(X) + JitterX) / float(Width) * 2.0f - 1.0f) * Aspect;
                float V = -((float(Y) + JitterY) / float(Height) * 2.0f - 1.0f);
                vec3 Direction = normalize(Forward * View.Zoom + Right * U + Up * V);

                TraceRecord Trace = TraceRock(View.Eye, Direction, ConeAngle, 26.0f);
                if (Trace.Struck)
                {
                    float Footprint = PixelFootprint(Trace.Travel, ConeAngle);
                    vec3 Normal = RockNormal(Trace.Location, Footprint);
                    // Re-evaluate last so RockSurface holds this sample's material fields.
                    RockFieldDistance(Trace.Location, Footprint);
                    vec3 Radiance = ShadeSample(Trace.Location, Normal, Footprint, Lithology);
                    float Fog = 1.0f - std::exp(-Trace.Travel * 0.016f);
                    Accumulated += mix(Radiance, vec3(0.52f, 0.60f, 0.72f), Fog * 0.5f);
                }
                else
                {
                    float Gradient = clamp(Direction.z * 0.5f + 0.5f, 0.0f, 1.0f);
                    Accumulated += mix(vec3(0.40f, 0.45f, 0.53f), vec3(0.20f, 0.33f, 0.58f), Gradient);
                }
            }
            Pixels[size_t(Y * Width + X)] = Accumulated / float(SuperSample);
        }
    }

    WritePortablePixmap(Path, Pixels, Width, Height);
    std::printf("  wrote %s\n", Path.c_str());
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       EXECUTION
//------------------------------------------------------------------------------------------------------------------------

int main(int argc, char** argv)
{
    // --render <lithology> <width> <macro 0|1>  renders exactly one frame, so a shell can fan the five
    // lithologies out across cores as separate processes (the kernel globals forbid threads).
    if (argc >= 3 && std::strcmp(argv[1], "--render") == 0)
    {
        const char* FrameNames[5] = { "Granite", "Sandstone", "Basalt", "Limestone", "Schist" };
        int Lithology = std::atoi(argv[2]);
        int FrameWidth = (argc > 3) ? std::atoi(argv[3]) : 420;
        int FrameHeight = (FrameWidth * 3) / 4;
        bool Macro = (argc > 4) && std::atoi(argv[4]) != 0;

        ViewSpecification View;
        if (Macro)
        {
            View.Eye = vec3(1.62f, -1.42f, 0.86f);
            View.Focus = vec3(0.05f, 0.10f, 0.40f);
            View.Zoom = 3.30f;
        }
        else
        {
            View.Eye = vec3(4.05f, -4.35f, 2.35f);
            View.Focus = vec3(0.0f, 0.0f, 0.30f);
            View.Zoom = 1.75f;
        }
        std::string Path = std::string("Diagnostics/RockField_") + FrameNames[Lithology]
                         + (Macro ? "Macro" : "") + ".ppm";
        RenderLithology(Lithology, View, Path, FrameWidth, FrameHeight, (argc > 5) ? std::atoi(argv[5]) : 1);
        return 0;
    }

    bool MeasureOnly = (argc > 1 && std::strcmp(argv[1], "--measure") == 0);
    int Width = 420;
    int Height = 300;
    int SuperSample = 4;
    if (argc > 2)
    {
        Width = std::atoi(argv[2]);
        Height = (Width * 3) / 4;
    }

    const char* Names[5] = { "Granite", "Sandstone", "Basalt", "Limestone", "Schist" };

    std::printf("== Lipschitz validity on the exterior (normalised gradient must stay <= 1) ==\n");
    for (int Lithology = 0; Lithology < 5; ++Lithology)
    {
        MeasurementRecord Record = MeasureLipschitzValidity(Lithology, 60000);
        std::printf("  %-10s  exterior samples %6d   L peak %7.1f   max |grad(f/L)| %6.3f   violations %d   %s\n",
                    Names[Lithology], Record.Rays, Record.LipschitzPeak, Record.GradientPeak, Record.Overshoots,
                    Record.Overshoots == 0 ? "PASS" : "FAIL");
    }

    std::printf("\n== Trace behaviour (overshoots must be zero) ==\n");
    for (int Lithology = 0; Lithology < 5; ++Lithology)
    {
        MeasurementRecord Record = MeasureTraceBehaviour(Lithology, 128);
        float Coverage = 100.0f * float(Record.Hits) / float(std::max(Record.Rays, 1));
        float MeanSteps = float(Record.StepTotal) / float(std::max(Record.Rays, 1));
        std::printf("  %-10s  coverage %5.1f%%   mean steps %5.1f   peak %3d   overshoots %d   %s\n",
                    Names[Lithology], Coverage, MeanSteps, Record.StepPeak, Record.Overshoots,
                    Record.Overshoots == 0 ? "PASS" : "FAIL");
    }

    if (MeasureOnly)
    {
        return 0;
    }

    std::printf("\n== Reference frames ==\n");
    ViewSpecification Wide;
    Wide.Eye = vec3(4.05f, -4.35f, 2.35f);
    Wide.Focus = vec3(0.0f, 0.0f, 0.30f);
    Wide.Zoom = 1.75f;

    for (int Lithology = 0; Lithology < 5; ++Lithology)
    {
        RockShape = RockPreset(Lithology, 3.0f);
        std::string Path = std::string("Diagnostics/RockField_") + Names[Lithology] + ".ppm";
        RenderLithology(Lithology, Wide, Path, Width, Height, SuperSample);
    }

    // Close range study: proves the detail survives to millimetre scale rather than dissolving into noise.
    ViewSpecification Macro;
    Macro.Eye = vec3(1.62f, -1.42f, 0.86f);
    Macro.Focus = vec3(0.05f, 0.10f, 0.40f);
    Macro.Zoom = 3.30f;
    RenderLithology(ROCK_LITHOLOGY_SANDSTONE, Macro, "Diagnostics/RockField_SandstoneMacro.ppm", Width, Height, SuperSample);
    RenderLithology(ROCK_LITHOLOGY_GRANITE, Macro, "Diagnostics/RockField_GraniteMacro.ppm", Width, Height, SuperSample);

    return 0;
}
