//============================================================================================================================================
//                                                         SMOKEINTEGRATOR.SLANG
//============================================================================================================================================
// 📦 Shared volume phase and authored emission palette from VolumeRaymarch.h; radiance stays linear until the final transfer.

float ResolveSmokePhase(float Cosine, float Anisotropy)
{
    float Forward = (1.0 - Anisotropy * Anisotropy) / (12.56637061436 * pow(max(1.0 + Anisotropy * Anisotropy - 2.0 * Anisotropy * Cosine, 0.0001), 1.5));
    float Backward = (1.0 - 0.0625) / (12.56637061436 * pow(max(1.0625 + 0.5 * Cosine, 0.0001), 1.5));
    return mix(Backward, Forward, 0.72);
}

vec3 ResolveSmokeEmission(float Temperature, float Scale)
{
    float Mapped = clamp(Temperature * Scale * 0.28, 0.0, 1.6);
    if (Mapped <= 0.01) return vec3(0.0);
    const vec3 Stops[4] = vec3[4](vec3(0.0), vec3(0.55, 0.03, 0.005), vec3(1.0, 0.24, 0.01), vec3(1.0, 0.86, 0.52));
    float Scaled = Mapped / 1.6 * 3.0;
    int Lower = min(int(Scaled), 2);
    return mix(Stops[Lower], Stops[Lower + 1], Scaled - float(Lower));
}

vec3 ResolveSmokeColourTransfer(vec3 Radiance, float Exposure, float Saturation, uint Transfer)
{
    Radiance = max(Radiance * Exposure, vec3(0.0));
    float Luminance = dot(Radiance, vec3(0.2126, 0.7152, 0.0722));
    Radiance = mix(vec3(Luminance), Radiance, clamp(Saturation, 0.0, 1.0));
    if (Transfer == 1u) return sqrt(clamp(Radiance, vec3(0.0), vec3(1.0)));
    if (Transfer == 2u) return pow(Radiance / (Radiance + vec3(1.0)), vec3(1.0 / 2.2));
    vec3 Mapped = clamp((Radiance * (2.51 * Radiance + 0.03)) / (Radiance * (2.43 * Radiance + 0.59) + 0.14), vec3(0.0), vec3(1.0));
    return pow(Mapped, vec3(1.0 / 2.2));
}
