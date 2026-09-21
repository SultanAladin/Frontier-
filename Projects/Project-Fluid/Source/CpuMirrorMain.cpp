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
float Hash(std::uint32_t x, std::uint32_t y) {
    std::uint32_t h = x * 0x8da6b343u ^ y * 0xd8163841u ^ 0xcb1ab31fu;
    h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u;
    return static_cast<float>(h & 0x00ffffffu) / 16777216.0f;
}

bool RenderProof(const SpectralOcean& ocean, const std::string& path) {
    constexpr std::uint32_t width = 1280;
    constexpr std::uint32_t height = 720;
    const std::uint32_t n = ocean.Settings().Resolution;
    const float domain = ocean.Settings().DomainMetres;
    constexpr float seconds = 9.0f;
    constexpr float zoom = 170.0f;
    constexpr float aspect = static_cast<float>(width) / height;

    std::vector<SurfaceSample> field(static_cast<std::size_t>(n) * n);
    for (std::uint32_t z = 0; z < n; ++z)
        for (std::uint32_t x = 0; x < n; ++x) {
            const float wx = (static_cast<float>(x) / (n - 1u) - 0.5f) * domain;
            const float wz = (static_cast<float>(z) / (n - 1u) - 0.5f) * domain;
            field[z * n + x] = ocean.Evaluate(wx, wz, seconds);
        }

    std::ofstream image(path, std::ios::binary);
    if (!image) return false;
    image << "P6\n" << width << ' ' << height << "\n255\n";
    const Colour skyTop{0.030f, 0.180f, 0.400f};
    const Colour skyHorizon{0.480f, 0.720f, 0.880f};
    const Colour deep{0.008f, 0.090f, 0.180f};
    const Colour shallow{0.020f, 0.500f, 0.540f};
    const std::array<float, 3> light{-0.350f, 0.800f, 0.480f};

    for (std::uint32_t py = 0; py < height; ++py) {
        const float v = (static_cast<float>(py) + 0.5f) / height;
        for (std::uint32_t px = 0; px < width; ++px) {
            const float u = (static_cast<float>(px) + 0.5f) / width;
            Colour colour = Mix(skyTop, skyHorizon, Smooth(0.0f, 0.72f, v));
            const float perspective = 0.35f + (1.70f - 0.35f) * v;
            const float worldX = (u - 0.5f) * aspect * perspective * zoom;
            const float worldZ = (0.78f - v) * 1.30f * zoom;
            float gx = (worldX / domain + 0.5f) * (n - 1u);
            const float gz = (worldZ / domain + 0.5f) * (n - 1u);
            gx = std::fmod(gx, static_cast<float>(n - 1u));
            if (gx < 0.0f) gx += n - 1u;
            if (gz >= 0.0f && gz < n - 1.0f) {
                const auto ix = static_cast<std::uint32_t>(gx);
                const auto iz = static_cast<std::uint32_t>(gz);
                const SurfaceSample& s = field[iz * n + ix];
                float nx = -s.SlopeX * 2.5f, ny = 1.0f, nz = -s.SlopeZ * 2.5f;
                const float inverseLength = 1.0f / std::sqrt(nx * nx + ny * ny + nz * nz);
                nx *= inverseLength; ny *= inverseLength; nz *= inverseLength;
                constexpr std::array<float, 3> view{0.0f, 0.55f, 0.835f};
                const float viewLength = std::sqrt(view[1] * view[1] + view[2] * view[2]);
                const float vx = 0.0f, vy = view[1] / viewLength, vz = view[2] / viewLength;
                const float diffuse = std::max(0.0f, nx * light[0] + ny * light[1] + nz * light[2]);
                const float fresnel = std::pow(1.0f - std::max(nx * vx + ny * vy + nz * vz, 0.0f), 5.0f);
                const float crest = Smooth(0.05f, 0.65f, s.Height);
                colour = Mix(deep, shallow, 0.14f + 0.48f * diffuse + 0.22f * crest);
                const Colour reflection = Mix(skyHorizon, skyTop, ny);
                colour.R += reflection.R * (0.12f + 0.48f * fresnel);
                colour.G += reflection.G * (0.12f + 0.48f * fresnel);
                colour.B += reflection.B * (0.12f + 0.48f * fresnel);
                float hx = light[0] + vx, hy = light[1] + vy, hz = light[2] + vz;
                const float hInv = 1.0f / std::sqrt(hx * hx + hy * hy + hz * hz);
                hx *= hInv; hy *= hInv; hz *= hInv;
                const float glint = std::pow(std::max(0.0f, nx * hx + ny * hy + nz * hz), 72.0f) * 1.8f;
                colour.R += glint; colour.G += glint * 0.86f; colour.B += glint * 0.64f;

                // The water shading above is complete before foam. This pull
                // compositor draws only seeded, discrete bubble particles.
                const float seed = Hash(ix, iz);
                const float lx = gx - std::floor(gx) - 0.5f;
                const float lz = gz - std::floor(gz) - 0.5f;
                const float radius = 0.16f + 0.30f * seed;
                const float particle = 1.0f - Smooth(radius * 0.65f, radius, std::sqrt(lx * lx + lz * lz));
                const float alive = s.Compression >= 0.25f - 0.25f * seed ? 1.0f : 0.0f;
                colour = Mix(colour, {0.88f, 0.96f, 1.0f}, particle * alive * (0.50f + 0.45f * seed));
            }
            const auto encode = [](float value) {
                return static_cast<unsigned char>(std::pow(std::clamp(value, 0.0f, 1.0f), 1.0f / 2.2f) * 255.0f + 0.5f);
            };
            const std::array<unsigned char, 3> rgb{encode(colour.R), encode(colour.G), encode(colour.B)};
            image.write(reinterpret_cast<const char*>(rgb.data()), rgb.size());
        }
    }
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
