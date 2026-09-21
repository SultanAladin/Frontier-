#include "SpectralOcean.h"

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <iostream>

using Frontier::ProjectFluid::SpectralOcean;

int main() {
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
    return 0;
}
