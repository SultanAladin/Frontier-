#include "SpectralOcean.h"

#include <algorithm>
#include <cmath>
#include <random>

namespace Frontier::ProjectFluid {
namespace {
constexpr float Pi = 3.14159265358979323846f;
constexpr float Gravity = 9.81f;
}

SpectralOcean::SpectralOcean(OceanSettings settings) : Settings_(settings) {
    Rebuild(settings.WindSpeed, settings.WindDirectionRadians);
}

void SpectralOcean::Rebuild(float windSpeed, float windDirectionRadians) {
    Settings_.WindSpeed = std::clamp(windSpeed, 1.0f, 30.0f);
    Settings_.WindDirectionRadians = windDirectionRadians;
    Modes_.clear();
    Modes_.reserve(Settings_.ModeCount);

    std::mt19937 random(Settings_.Seed);
    std::uniform_real_distribution<float> unit(0.0f, 1.0f);
    std::normal_distribution<float> gaussian(0.0f, 1.0f);
    const float windX = std::cos(windDirectionRadians);
    const float windZ = std::sin(windDirectionRadians);
    const float largestWave = Settings_.WindSpeed * Settings_.WindSpeed / Gravity;
    const float minimumWave = largestWave * 0.0125f;

    // Stratified polar samples avoid the square-grid directional bias that made
    // the old HTML/Gerstner prototype visibly repetitive.
    for (std::uint32_t index = 0; index < Settings_.ModeCount; ++index) {
        const float stratum = (static_cast<float>(index) + unit(random)) /
                              static_cast<float>(Settings_.ModeCount);
        const float wavelength = 2.2f * std::pow(105.0f / 2.2f, stratum);
        const float k = 2.0f * Pi / wavelength;
        const float spread = 0.14f + 0.52f * stratum;
        const float angle = windDirectionRadians + gaussian(random) * spread;
        const float kx = std::cos(angle) * k;
        const float kz = std::sin(angle) * k;
        const float alignment = std::max(0.0f, (kx * windX + kz * windZ) / k);
        const float phillips = 0.0042f * std::exp(-1.0f / std::max(1e-5f, k * k * largestWave * largestWave)) /
                               std::max(1e-5f, k * k * k * k) * alignment * alignment *
                               std::exp(-k * k * minimumWave * minimumWave);
        // Monte-Carlo quadrature weight and conservative calibration. The same
        // amplitude is consumed by CPU and GPU, so there is no mirror drift.
        const float amplitude = std::min(0.32f, std::sqrt(std::max(0.0f, phillips)) *
                                               (0.0144f + 0.032f * stratum));
        Modes_.push_back(OceanMode{kx, kz, amplitude, std::sqrt(Gravity * k),
                                   unit(random) * 2.0f * Pi, kx / k, kz / k, 0.0f});
    }
}

void SpectralOcean::SetChoppiness(float value) noexcept {
    Settings_.Choppiness = std::clamp(value, 0.0f, 2.0f);
}

SurfaceSample SpectralOcean::Evaluate(float x, float z, float seconds) const noexcept {
    SurfaceSample result{};
    float dxx = 0.0f;
    float dzz = 0.0f;
    float dxz = 0.0f;
    for (const OceanMode& mode : Modes_) {
        const float theta = mode.WaveX * x + mode.WaveZ * z + mode.Omega * seconds + mode.Phase;
        const float sine = std::sin(theta);
        const float cosine = std::cos(theta);
        result.Height += mode.Amplitude * cosine;
        result.SlopeX -= mode.Amplitude * mode.WaveX * sine;
        result.SlopeZ -= mode.Amplitude * mode.WaveZ * sine;
        const float fold = Settings_.Choppiness * mode.Amplitude * cosine;
        dxx -= fold * mode.DirectionX * mode.WaveX;
        dzz -= fold * mode.DirectionZ * mode.WaveZ;
        dxz -= fold * mode.DirectionX * mode.WaveZ;
    }
    const float jacobian = (1.0f + dxx) * (1.0f + dzz) - dxz * dxz;
    result.Compression = std::clamp(1.0f - jacobian, 0.0f, 1.0f);
    return result;
}

} // namespace Frontier::ProjectFluid
