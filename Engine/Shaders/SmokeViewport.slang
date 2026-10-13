//============================================================================================================================================
//                                                          SMOKEVIEWPORT.SLANG
//============================================================================================================================================
// 📦 Opaque-depth-clipped world-volume quadrature over resolved linear scene radiance; one final colour transfer, no history contamination.

#version 450
#extension GL_GOOGLE_include_directive : require
#include "SmokeIntegrator.slang"

layout(local_size_x = 8, local_size_y = 8) in;
layout(binding = 0) uniform sampler3D Thermo;
layout(rgba8, binding = 1) uniform writeonly image2D Presentation;
layout(rgba32f, binding = 2) uniform readonly image2D SceneRadiance;
layout(rgba32f, binding = 3) uniform readonly image2D Surface;
layout(binding = 4) uniform sampler2D SurfaceAlbedo;
layout(std430, binding = 5) readonly buffer CoverageReception { uvec4 MinimumCell; uvec4 MaximumCell; };
layout(push_constant) uniform Projection
{
    vec4 Eye;
    vec4 Forward;
    vec4 Right;
    vec4 Up;
    vec4 OriginSpan;
    vec4 Optical;
    vec4 Sun;
    uvec4 Counts;
} Camera;

bool IntersectDomain(vec3 Origin, vec3 Direction, out float Enter, out float Exit)
{
    if (any(greaterThanEqual(MinimumCell.xyz, MaximumCell.xyz))) return false;
    float Spacing = Camera.OriginSpan.w / float(MinimumCell.w);
    vec3 BoundsMinimum = Camera.OriginSpan.xyz + max(vec3(MinimumCell.xyz) - 1.0, vec3(0.0)) * Spacing;
    vec3 BoundsMaximum = Camera.OriginSpan.xyz + min(vec3(MaximumCell.xyz) + 1.0, vec3(MinimumCell.w)) * Spacing;
    Enter = 0.0;
    Exit = 100000.0;
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        float Inverse = 1.0 / (abs(Direction[Axis]) > 0.00000001 ? Direction[Axis] : 0.00000001);
        float Near = (BoundsMinimum[Axis] - Origin[Axis]) * Inverse;
        float Far = (BoundsMaximum[Axis] - Origin[Axis]) * Inverse;
        Enter = max(Enter, min(Near, Far));
        Exit = min(Exit, max(Near, Far));
    }
    return Exit > Enter;
}

float ResolveSmokeShadow(vec3 World, vec3 Direction, uint Samples)
{
    float OpticalDepth = 0.0;
    float StepLength = Camera.OriginSpan.w / float(max(Samples, 1u)) * 0.15;
    for (uint Index = 0u; Index < Samples; ++Index)
    {
        World += Direction * StepLength;
        vec3 Coordinate = (World - Camera.OriginSpan.xyz) / Camera.OriginSpan.w;
        if (any(lessThan(Coordinate, vec3(0.0))) || any(greaterThan(Coordinate, vec3(1.0)))) break;
        OpticalDepth += texture(Thermo, Coordinate).r * Camera.Optical.x * 0.5 * StepLength;
    }
    return exp(-OpticalDepth);
}

void main()
{
    ivec2 Pixel = ivec2(gl_GlobalInvocationID.xy);
    if (any(greaterThanEqual(Pixel, ivec2(Camera.Counts.xy)))) return;
    vec2 Screen = (vec2(Pixel) + 0.5) / vec2(Camera.Counts.xy) * 2.0 - 1.0;
    float Aspect = float(Camera.Counts.x) / float(Camera.Counts.y);
    vec3 Direction = normalize(Camera.Forward.xyz + Camera.Right.xyz * Screen.x * Camera.Eye.w * Aspect
                                                 - Camera.Up.xyz * Screen.y * Camera.Eye.w);
    vec4 Opaque = imageLoad(Surface, Pixel);
    float OpaqueDistance = floatBitsToUint(Opaque.w) == 0xFFFFFFFFu ? 100000.0 : length(Opaque.xyz - Camera.Eye.xyz);
    vec3 Scene = max(imageLoad(SceneRadiance, Pixel).rgb, vec3(0.0));
    if (Camera.Up.w > 0.0)
    {
        vec3 Albedo = floatBitsToUint(Opaque.w) == 0xFFFFFFFFu ? vec3(1.0) : texelFetch(SurfaceAlbedo, Pixel, 0).rgb;
        Albedo = floor(clamp(Albedo, vec3(0.02), vec3(1.0)) * 255.0 + 0.5) / 255.0;
        Scene *= Albedo;
    }
    vec3 Radiance = vec3(0.0);
    float Transmittance = 1.0;
    float Enter, Exit;
    if (IntersectDomain(Camera.Eye.xyz, Direction, Enter, Exit))
    {
        Exit = min(Exit, OpaqueDistance);
        uint Samples = max(Camera.Counts.z & 65535u, 1u);
        uint ShadowSamples = min(Camera.Counts.z >> 16, 16u);
        float StepLength = max((Exit - Enter) / float(Samples), 0.00001);
        vec3 SunDirection = normalize(Camera.Sun.xyz);
        float Phase = ResolveSmokePhase(dot(Direction, SunDirection), 0.38);
        // 📝 Stationary pixel quadrature: neither pause nor display frequency changes its noise realization.
        uint Seed = uint(Pixel.x) * 73856093u ^ uint(Pixel.y) * 19349663u;
        Seed ^= Seed >> 13; Seed *= 2246822519u; Seed ^= Seed >> 16;
        float Offset = 0.25 + 0.5 * float(Seed & 65535u) / 65535.0;
        for (uint Index = 0u; Index < Samples && Exit > Enter; ++Index)
        {
            if (Transmittance < 0.003) break;
            vec3 World = Camera.Eye.xyz + Direction * (Enter + (float(Index) + Offset) * StepLength);
            vec3 Reading = max(texture(Thermo, (World - Camera.OriginSpan.xyz) / Camera.OriginSpan.w).rgb, vec3(0.0));
            if (Reading.r < 0.0001 && Reading.z < 0.001) continue;
            float Extinction = Reading.r * Camera.Optical.x;
            float Absorbed = 1.0 - exp(-Extinction * StepLength);
            float Shadow = ResolveSmokeShadow(World, SunDirection, ShadowSamples);
            float Powder = 1.0 - exp(-Reading.r * 2.5);
            vec3 Skylight = vec3(0.30, 0.38, 0.52) * 0.35;
            vec3 Sunlight = vec3(1.0, 0.93, 0.82) * Camera.Sun.w * Shadow * Phase * (0.4 + Powder * 2.4);
            vec3 Scattered = (Skylight + Sunlight) * Camera.Optical.y;
            // A separately advected combustion-provenance scalar prevents warm, unignited drift smoke from glowing.
            float Flame = clamp(Reading.z, 0.0, 1.0);
            float FlameTemperature = 2.4 + max(Reading.g - 0.03, 0.0) * Camera.Optical.z;
            vec3 Emission = ResolveSmokeEmission(FlameTemperature, 1.0) * Camera.Optical.w * Flame;
            // The emission transfer is the existing authored palette, not a calibrated Planck spectrum.
            Radiance += Transmittance * (Scattered * Absorbed + Emission * StepLength * (1.0 + Reading.r * 2.5));
            Transmittance *= 1.0 - Absorbed;
        }
    }
    // Unaffected pixels retain the renderer's exact weather, low-light, dither and transfer result.
    // Affected pixels are composed only with linear SceneRadiance, never with the encoded presentation.
    if (Transmittance > 0.999999 && dot(Radiance, Radiance) < 0.0000000001) return;
    vec3 Resolved = Scene * Transmittance + Radiance;
    vec3 Display = ResolveSmokeColourTransfer(Resolved, Camera.Forward.w, Camera.Right.w, Camera.Counts.w);
    imageStore(Presentation, Pixel, vec4(Display, 1.0));
}
