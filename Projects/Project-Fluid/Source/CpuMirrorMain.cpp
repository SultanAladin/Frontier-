#include "SpectralOcean.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

using Frontier::ProjectFluid::SpectralOcean;
using Frontier::ProjectFluid::SurfaceSample;

namespace {
struct Colour { float R{}, G{}, B{}; };

Colour Mix(Colour a, Colour b, float t) {
    t = std::clamp(t, 0.0f, 1.0f);
    return {a.R + (b.R - a.R) * t, a.G + (b.G - a.G) * t, a.B + (b.B - a.B) * t};
}
float Smooth(float a, float b, float x) {
    const float t = std::clamp((x - a) / (b - a), 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}
struct Vec3 { float X{}, Y{}, Z{}; };
Vec3 Add(Vec3 a, Vec3 b) { return {a.X + b.X, a.Y + b.Y, a.Z + b.Z}; }
Vec3 Sub(Vec3 a, Vec3 b) { return {a.X - b.X, a.Y - b.Y, a.Z - b.Z}; }
Vec3 Scale(Vec3 a, float s) { return {a.X * s, a.Y * s, a.Z * s}; }
float Dot(Vec3 a, Vec3 b) { return a.X * b.X + a.Y * b.Y + a.Z * b.Z; }
Vec3 Cross(Vec3 a, Vec3 b) { return {a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X}; }
Vec3 Normalized(Vec3 a) { const float n = std::sqrt(std::max(1e-12f, Dot(a, a))); return Scale(a, 1.0f / n); }

float Fract(float value) { return value - std::floor(value); }
float ShaderHash(float x, float y) {
    float px = Fract(x * 0.1031f);
    float py = Fract(y * 0.1031f);
    float pz = Fract(x * 0.1031f);
    const float d = px * (py + 33.33f) + py * (pz + 33.33f) + pz * (px + 33.33f);
    px += d; py += d; pz += d;
    return Fract((px + py) * pz);
}

Colour SkyColour(Vec3 ray, Vec3 sunDirection) {
    const float horizonAmount = std::pow(1.0f - std::clamp(ray.Y, 0.0f, 1.0f), 3.0f);
    Colour sky = Mix({0.025f, 0.11f, 0.30f}, {0.43f, 0.68f, 0.84f}, horizonAmount);
    const float sunDot = std::max(Dot(ray, sunDirection), 0.0f);
    const float sunDisc = std::pow(sunDot, 1200.0f);
    const float sunGlow = std::pow(sunDot, 22.0f);
    sky.R += (sunDisc * 7.0f + sunGlow * 0.16f);
    sky.G += (sunDisc * 7.0f + sunGlow * 0.16f) * 0.78f;
    sky.B += (sunDisc * 7.0f + sunGlow * 0.16f) * 0.48f;
    return sky;
}

SurfaceSample SampleField(const std::vector<SurfaceSample>& field, std::uint32_t resolution,
                          float domain, float x, float z) {
    float gx = (x / domain + 0.5f) * (resolution - 1u);
    float gz = (z / domain + 0.5f) * (resolution - 1u);
    gx = std::clamp(gx, 0.0f, static_cast<float>(resolution - 1u));
    gz = std::clamp(gz, 0.0f, static_cast<float>(resolution - 1u));
    const std::uint32_t ax = static_cast<std::uint32_t>(std::floor(gx));
    const std::uint32_t az = static_cast<std::uint32_t>(std::floor(gz));
    const std::uint32_t bx = std::min(ax + 1u, resolution - 1u);
    const std::uint32_t bz = std::min(az + 1u, resolution - 1u);
    const float fx = gx - std::floor(gx), fz = gz - std::floor(gz);
    const auto blend = [](SurfaceSample a, SurfaceSample b, float t) {
        return SurfaceSample{a.Height + (b.Height - a.Height) * t,
                             a.SlopeX + (b.SlopeX - a.SlopeX) * t,
                             a.SlopeZ + (b.SlopeZ - a.SlopeZ) * t,
                             a.Compression + (b.Compression - a.Compression) * t};
    };
    return blend(blend(field[az * resolution + ax], field[az * resolution + bx], fx),
                 blend(field[bz * resolution + ax], field[bz * resolution + bx], fx), fz);
}

bool RenderProof(const SpectralOcean& ocean, const std::string& path) {
    constexpr std::uint32_t width = 1280;
    constexpr std::uint32_t height = 720;
    constexpr float seconds = 9.0f;
    constexpr float cameraX = 0.0f;
    constexpr float cameraZ = 0.0f;
    constexpr float cameraZoom = 170.0f;
    const std::uint32_t resolution = ocean.Settings().Resolution;
    const float domain = ocean.Settings().DomainMetres;
    const float halfDomain = domain * 0.5f;

    // This is the CPU equivalent of OceanSurface.comp's output buffer.
    std::vector<SurfaceSample> field(static_cast<std::size_t>(resolution) * resolution);
    for (std::uint32_t z = 0; z < resolution; ++z)
        for (std::uint32_t x = 0; x < resolution; ++x) {
            const float wx = (static_cast<float>(x) / (resolution - 1u) - 0.5f) * domain;
            const float wz = (static_cast<float>(z) / (resolution - 1u) - 0.5f) * domain;
            field[z * resolution + x] = ocean.Evaluate(wx, wz, seconds);
        }

    const Vec3 camera{42.0f + cameraX, 8.5f, 78.0f + cameraZ};
    const Vec3 target{-8.0f + cameraX, 0.0f, -30.0f + cameraZ};
    const Vec3 forward = Normalized(Sub(target, camera));
    const Vec3 right = Normalized(Cross(forward, {0.0f, 1.0f, 0.0f}));
    const Vec3 up = Normalized(Cross(right, forward));
    const Vec3 sunDirection = Normalized({0.48f, 0.72f, 0.36f});
    const float tanHalfFov = std::clamp(cameraZoom / 300.0f, 0.32f, 0.92f);
    const float aspect = static_cast<float>(width) / height;

    std::vector<unsigned char> pixels(static_cast<std::size_t>(width) * height * 3);
    for (std::uint32_t py = 0; py < height; ++py) {
        for (std::uint32_t px = 0; px < width; ++px) {
            const float u = (static_cast<float>(px) + 0.5f) / width;
            const float v = (static_cast<float>(py) + 0.5f) / height;
            const float ndcX = (u * 2.0f - 1.0f) * aspect;
            const float ndcY = 1.0f - v * 2.0f;
            const Vec3 ray = Normalized(Add(Add(forward, Scale(right, ndcX * tanHalfFov)), Scale(up, ndcY * tanHalfFov)));
            Colour colour = SkyColour(ray, sunDirection);

            float previousT = 0.75f;
            Vec3 previousPoint = Add(camera, Scale(ray, previousT));
            float previousDistance = previousPoint.Y - SampleField(field, resolution, domain,
                std::clamp(previousPoint.X, -halfDomain, halfDomain),
                std::clamp(previousPoint.Z, -halfDomain, halfDomain)).Height;
            float hitT = -1.0f;
            for (int stepIndex = 0; stepIndex < 150; ++stepIndex) {
                const float t = 0.75f + static_cast<float>(stepIndex + 1) * 2.0f;
                const Vec3 point = Add(camera, Scale(ray, t));
                const bool inDomain = std::abs(point.X) <= halfDomain && std::abs(point.Z) <= halfDomain;
                const float distanceToSurface = point.Y - SampleField(field, resolution, domain,
                    std::clamp(point.X, -halfDomain, halfDomain),
                    std::clamp(point.Z, -halfDomain, halfDomain)).Height;
                if (inDomain && previousDistance > 0.0f && distanceToSurface <= 0.0f) {
                    float lo = previousT, hi = t;
                    for (int refine = 0; refine < 6; ++refine) {
                        const float mid = (lo + hi) * 0.5f;
                        const Vec3 probe = Add(camera, Scale(ray, mid));
                        const float signedDistance = probe.Y - SampleField(field, resolution, domain, probe.X, probe.Z).Height;
                        if (signedDistance > 0.0f) lo = mid; else hi = mid;
                    }
                    hitT = (lo + hi) * 0.5f;
                    break;
                }
                previousT = t;
                previousDistance = distanceToSurface;
            }

            if (hitT > 0.0f) {
                const Vec3 world = Add(camera, Scale(ray, hitT));
                const SurfaceSample surface = SampleField(field, resolution, domain, world.X, world.Z);
                const Vec3 normal = Normalized({-surface.SlopeX, 1.0f, -surface.SlopeZ});
                const Vec3 viewDirection = Scale(ray, -1.0f);
                const Vec3 reflectedRay = Sub(ray, Scale(normal, 2.0f * Dot(ray, normal)));
                const float fresnel = 0.02f + 0.98f * std::pow(1.0f - std::max(Dot(normal, viewDirection), 0.0f), 5.0f);
                const float diffuse = std::max(Dot(normal, sunDirection), 0.0f);
                const Vec3 halfVector = Normalized(Add(sunDirection, viewDirection));
                const float specular = std::pow(std::max(Dot(normal, halfVector), 0.0f), 180.0f) * 3.2f;
                const float crestLight = Smooth(0.05f, 0.75f, surface.Height);
                const Colour body = Mix({0.004f, 0.045f, 0.10f}, {0.01f, 0.30f, 0.36f},
                                        0.18f + diffuse * 0.36f + crestLight * 0.18f);
                const Colour reflection = SkyColour(reflectedRay, sunDirection);
                colour = Mix(body, reflection, fresnel);
                colour.R += specular; colour.G += specular * 0.83f; colour.B += specular * 0.60f;
                colour = Mix(colour, {0.36f, 0.62f, 0.73f}, Smooth(150.0f, 285.0f, hitT) * 0.62f);

                const float gridX = (world.X / domain + 0.5f) * (resolution - 1u);
                const float gridZ = (world.Z / domain + 0.5f) * (resolution - 1u);
                const float cellX = std::floor(gridX), cellZ = std::floor(gridZ);
                const float seed = ShaderHash(cellX, cellZ);
                const float jitterX = ShaderHash(cellX + 17.0f, cellZ + 3.0f) - 0.5f;
                const float jitterZ = ShaderHash(cellX + 5.0f, cellZ + 31.0f) - 0.5f;
                const float localX = Fract(gridX) - 0.5f - jitterX * 0.46f;
                const float localZ = Fract(gridZ) - 0.5f - jitterZ * 0.46f;
                const float radius = 0.08f + seed * 0.10f;
                const float particle = 1.0f - Smooth(radius * 0.68f, radius, std::sqrt(localX * localX + localZ * localZ));
                const float alive = surface.Compression >= 0.075f && surface.Height >= 0.10f && seed >= 0.88f ? 1.0f : 0.0f;
                colour = Mix(colour, {0.82f, 0.93f, 0.97f}, particle * alive * 0.72f);
            }

            const auto encode = [](float value) {
                return static_cast<unsigned char>(std::pow(std::clamp(value, 0.0f, 1.0f), 1.0f / 2.2f) * 255.0f + 0.5f);
            };
            const std::size_t at = (static_cast<std::size_t>(py) * width + px) * 3;
            pixels[at] = encode(colour.R); pixels[at + 1] = encode(colour.G); pixels[at + 2] = encode(colour.B);
        }
    }

    std::ofstream image(path, std::ios::binary);
    if (!image) return false;
    image << "P6\n" << width << ' ' << height << "\n255\n";
    image.write(reinterpret_cast<const char*>(pixels.data()), static_cast<std::streamsize>(pixels.size()));
    return static_cast<bool>(image);
}
} // namespace

int main(int argumentCount, char** argumentValues) {
    SpectralOcean ocean;
    float minimum = 1e9f;
    float maximum = -1e9f;
    double energy = 0.0;
    constexpr std::uint32_t samples = 96;
    for (std::uint32_t z = 0; z < samples; ++z) {
        for (std::uint32_t x = 0; x < samples; ++x) {
            const auto sample = ocean.Evaluate((static_cast<float>(x) / samples - 0.5f) * 240.0f,
                                               (static_cast<float>(z) / samples - 0.5f) * 240.0f, 9.0f);
            minimum = std::min(minimum, sample.Height);
            maximum = std::max(maximum, sample.Height);
            energy += sample.Height * sample.Height;
            if (!std::isfinite(sample.Height) || !std::isfinite(sample.SlopeX) || !std::isfinite(sample.SlopeZ)) {
                std::cerr << "Project-Fluid CPU mirror produced a non-finite sample\n";
                return 1;
            }
        }
    }
    const double rms = std::sqrt(energy / static_cast<double>(samples * samples));
    std::cout << std::fixed << std::setprecision(4)
              << "Project-Fluid CPU mirror: " << ocean.Modes().size() << " shared spectral modes\n"
              << "height range [" << minimum << ", " << maximum << "] m, RMS " << rms << " m\n";
    if (rms < 0.005 || rms > 8.0) {
        std::cerr << "Ocean energy outside validation bounds\n";
        return 2;
    }
    if (argumentCount == 3 && std::string(argumentValues[1]) == "--render") {
        if (!RenderProof(ocean, argumentValues[2])) {
            std::cerr << "Could not write proof render: " << argumentValues[2] << '\n';
            return 3;
        }
        std::cout << "CPU mirror proof rendered to " << argumentValues[2] << '\n';
    }
    return 0;
}
