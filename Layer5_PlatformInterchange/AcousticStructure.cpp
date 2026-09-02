//============================================================================================================================================
// 📦 Frontier/Layer5_PlatformInterchange/AcousticStructure.cpp — Acoustic Waveform Storage Implementation
//============================================================================================================================================

#include "AcousticStructure.h"

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                WAVEFORM INGESTION
//------------------------------------------------------------------------------------------------------------------------

uint32_t AcousticStructure::RegisterWaveform(std::string WaveformName, const float* PcmSamples, size_t SampleCount) noexcept
{
    uint32_t Token = static_cast<uint32_t>(m_WaveformNames.size());
    m_WaveformNames.push_back(std::move(WaveformName));

    if (PcmSamples && SampleCount > 0)
    {
        m_PcmStorage.emplace_back(PcmSamples, PcmSamples + SampleCount);
    }
    else
    {
        m_PcmStorage.emplace_back();
    }

    return Token;
}

} // namespace Frontier
