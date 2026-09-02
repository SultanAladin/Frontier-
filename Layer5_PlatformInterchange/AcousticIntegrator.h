//============================================================================================================================================
// 📦 Frontier/Layer5_PlatformInterchange/AcousticIntegrator.h — 3D HRTF Spatial Audio Mixer with Occlusion Raymarching
//============================================================================================================================================

#pragma once

#include "AcousticStructure.h"
#include "../Layer2_VolumetricDynamics/LevelSetSpace.h"
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                 ACOUSTIC INTEGRATOR
//------------------------------------------------------------------------------------------------------------------------

class AcousticIntegrator
{
public:
    AcousticIntegrator() noexcept;
    ~AcousticIntegrator() noexcept = default;

    AcousticIntegrator(const AcousticIntegrator&) = delete;
    AcousticIntegrator& operator=(const AcousticIntegrator&) = delete;

    void                    SetListenerTransform(const Vector3& Position, const Vector3& Forward, const Vector3& Up) noexcept;

    [[nodiscard]] uint64_t  PlaySound(uint32_t SoundToken, AcousticBusCategory Bus, const Vector3& Position, float Volume = 1.0f, bool Looping = false) noexcept;
    void                    StopSound(uint64_t VoiceIdentifier) noexcept;

    void                    AdvanceAudio(float Δτ, const LevelSetSpace* Obstacles = nullptr) noexcept;

    [[nodiscard]] size_t    QueryActiveVoiceCount() const noexcept;

    // Single unified conversion operator for active voice count
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    Vector3                 m_ListenerPosition;                 // [m] listener world position
    Vector3                 m_ListenerForward;                  // [-] listener forward orientation
    Vector3                 m_ListenerUp;                       // [-] listener up orientation
    std::vector<AcousticVoiceRecord> m_ActiveVoices;            // [voices] active sound voices
    uint64_t                m_VoiceIdentifierCounter;           // [counter] monotonic token generator
};

template<>
inline size_t AcousticIntegrator::Convert<size_t>() const noexcept
{
    return QueryActiveVoiceCount();
}

} // namespace Frontier
