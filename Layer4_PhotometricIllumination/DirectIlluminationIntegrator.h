//============================================================================================================================================
// 📦 Frontier/Layer4_PhotometricIllumination/DirectIlluminationIntegrator.h — ReSTIR Spatiotemporal Direct Illumination Integrator
//============================================================================================================================================

#pragma once

#include "ClusteredSpace.h"
#include "../Layer3_GeometricRaster/MaterialCodec.h"
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                              ILLUMINATION RESERVOIR
//------------------------------------------------------------------------------------------------------------------------

struct IlluminationReservoir
{
    uint32_t                SelectedLightIndex;                 // [index] winning candidate light index
    float                   WeightSum;                          // [-] accumulated candidate weights w_sum
    uint32_t                SampleCount;                        // [count] number of considered candidates M
    float                   UnbiasedWeight;                     // [-] normalization weight W

    void Update(uint32_t CandidateIndex, float Weight, float RandomScalar) noexcept
    {
        WeightSum += Weight;
        SampleCount += 1;
        if (RandomScalar * WeightSum <= Weight)
        {
            SelectedLightIndex = CandidateIndex;
        }
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                      DIRECT ILLUMINATION INTEGRATOR
//------------------------------------------------------------------------------------------------------------------------

class DirectIlluminationIntegrator
{
public:
    DirectIlluminationIntegrator(uint32_t ExtentWidth, uint32_t ExtentHeight) noexcept;
    ~DirectIlluminationIntegrator() noexcept = default;

    DirectIlluminationIntegrator(const DirectIlluminationIntegrator&) = delete;
    DirectIlluminationIntegrator& operator=(const DirectIlluminationIntegrator&) = delete;

    void                    IntegrateDirectIllumination(
                                const VisibilityProjection& Visibility,
                                const GeometryStructure& Geometry,
                                const MaterialCodec& Codec,
                                const std::vector<PhotometricLightRecord>& Lights,
                                std::vector<Vector4>& OutRadianceField) noexcept;

    // Single unified conversion operator for pixel count
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    uint32_t                m_Width;                            // [px] viewport width
    uint32_t                m_Height;                           // [px] viewport height
    std::vector<IlluminationReservoir> m_Reservoirs;            // [reservoirs] per-pixel ReSTIR reservoirs
};

template<>
inline size_t DirectIlluminationIntegrator::Convert<size_t>() const noexcept
{
    return m_Reservoirs.size();
}

} // namespace Frontier
