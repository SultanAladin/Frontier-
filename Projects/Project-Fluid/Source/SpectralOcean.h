#pragma once

#include <cstdint>
#include <vector>

namespace Frontier::ProjectFluid {

struct alignas(16) OceanMode {
    float WaveX{};
    float WaveZ{};
    float Amplitude{};
    float Omega{};
    float Phase{};
    float DirectionX{};
    float DirectionZ{};
    float Padding{};
};

static_assert(sizeof(OceanMode) == 32, "OceanMode must remain std430-compatible (two vec4 values)");

struct SurfaceSample {
    float Height{};
    float SlopeX{};
    float SlopeZ{};
    float Compression{};
};

struct OceanSettings {
    std::uint32_t Resolution{256};
    std::uint32_t ModeCount{192};
    float DomainMetres{240.0f};
    float WindSpeed{8.0f};
    float WindDirectionRadians{0.35f};
    float Choppiness{0.9f};
    std::uint32_t Seed{0x46524f4eu};
};

// Deterministic Tessendorf-style spectral state shared byte-for-byte with Vulkan.
class SpectralOcean final {
public:
    explicit SpectralOcean(OceanSettings settings = {});

    void Rebuild(float windSpeed, float windDirectionRadians);
    void SetChoppiness(float value) noexcept;
    [[nodiscard]] SurfaceSample Evaluate(float x, float z, float seconds) const noexcept;
    [[nodiscard]] const std::vector<OceanMode>& Modes() const noexcept { return Modes_; }
    [[nodiscard]] const OceanSettings& Settings() const noexcept { return Settings_; }

private:
    OceanSettings Settings_;
    std::vector<OceanMode> Modes_;
};

} // namespace Frontier::ProjectFluid
