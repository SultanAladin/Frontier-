//============================================================================================================================================
// 📦 Frontier/Layer5_PlatformInterchange/AcousticIntegrator.cpp — 3D Spatial Audio Implementation
//============================================================================================================================================

#include "AcousticIntegrator.h"
#include <algorithm>
#include <cmath>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

AcousticIntegrator::AcousticIntegrator() noexcept
    : m_ListenerPosition{ 0.0f, 1.7f, 0.0f }
    , m_ListenerForward{ 0.0f, 0.0f, -1.0f }
    , m_ListenerUp{ 0.0f, 1.0f, 0.0f }
    , m_VoiceIdentifierCounter(1)
{
    m_ActiveVoices.reserve(64);
}

void AcousticIntegrator::SetListenerTransform(const Vector3& Position, const Vector3& Forward, const Vector3& Up) noexcept
{
    m_ListenerPosition = Position;
    m_ListenerForward = Forward.Normalized();
    m_ListenerUp = Up.Normalized();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                VOICE OPERATIONS
//------------------------------------------------------------------------------------------------------------------------

uint64_t AcousticIntegrator::PlaySound(uint32_t SoundToken, AcousticBusCategory Bus, const Vector3& Position, float Volume, bool Looping) noexcept
{
    uint64_t Identifier = m_VoiceIdentifierCounter++;
    AcousticVoiceRecord Voice{};
    Voice.VoiceIdentifier              = Identifier;
    Voice.SoundToken                   = SoundToken;
    Voice.TargetBus                    = Bus;
    Voice.SpatialLocation              = Position;
    Voice.VolumeGain                   = Volume;
    Voice.PitchMultiplier              = 1.0f;
    Voice.LowPassFilterCutoffFrequency = 20000.0f;
    Voice.SpatialPan                   = 0.0f;
    Voice.PlayingCondition             = true;
    Voice.LoopingCondition             = Looping;

    m_ActiveVoices.push_back(Voice);
    return Identifier;
}

void AcousticIntegrator::StopSound(uint64_t VoiceIdentifier) noexcept
{
    auto iterator = std::remove_if(m_ActiveVoices.begin(), m_ActiveVoices.end(),
        [VoiceIdentifier](const AcousticVoiceRecord& v) { return v.VoiceIdentifier == VoiceIdentifier; });
    m_ActiveVoices.erase(iterator, m_ActiveVoices.end());
}

//------------------------------------------------------------------------------------------------------------------------
//                                              AUDIO ADVANCEMENT
//------------------------------------------------------------------------------------------------------------------------

void AcousticIntegrator::AdvanceAudio(float Δτ, const LevelSetSpace* Obstacles) noexcept
{
    (void)Δτ;
    Vector3 ListenerRight = OrientationClassifier::CrossProduct(m_ListenerForward, m_ListenerUp).Normalized();

    for (auto& Voice : m_ActiveVoices)
    {
        if (!Voice.PlayingCondition)
        {
            continue;
        }

        Vector3 EmitterVec = Voice.SpatialLocation - m_ListenerPosition;
        float Dist = EmitterVec.Length();
        Vector3 EmitterDir = (Dist > 1e-4f) ? (EmitterVec / Dist) : m_ListenerForward;

        // Panning: dot product against listener right vector
        Voice.SpatialPan = std::clamp(OrientationClassifier::DotProduct(EmitterDir, ListenerRight), -1.0f, 1.0f);

        // Acoustic occlusion raymarching against LevelSetSpace
        float OcclusionFactor = 0.0f; // 0 = open air, 1 = fully occluded
        if (Obstacles && Dist > 0.5f)
        {
            uint32_t Steps = 8;
            float StepSize = Dist / static_cast<float>(Steps);
            for (uint32_t s = 1; s < Steps; ++s)
            {
                Vector3 SamplePoint = m_ListenerPosition + EmitterDir * (static_cast<float>(s) * StepSize);
                if (Obstacles->IsInsideSolid(SamplePoint))
                {
                    OcclusionFactor = 1.0f;
                    break;
                }
            }
        }

        // Low-pass filter cutoff frequency: f_cutoff = 20000 * (1 - Omega) + 800 * Omega
        Voice.LowPassFilterCutoffFrequency = 20000.0f * (1.0f - OcclusionFactor) + 800.0f * OcclusionFactor;
    }
}

size_t AcousticIntegrator::QueryActiveVoiceCount() const noexcept
{
    return m_ActiveVoices.size();
}

} // namespace Frontier
