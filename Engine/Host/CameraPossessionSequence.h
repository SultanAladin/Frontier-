//============================================================================================================================================
//                                                   CAMERAPOSSESSIONSEQUENCE.H
//============================================================================================================================================
// 📦 Play-camera possession: one uncaptured F8 edge ejects or repossesses; Edit/Simulate never retain possession.

#pragma once

#include <cstdint>

namespace Frontier::HostRuntime
{

class CameraPossessionSequence
{
public:
    /// 📦 Consumes held-key readings without replaying a captured or held F8 press.
    /// in    Transport       [-]  0 Edit, 1 Play, 2 Simulate
    /// in    EjectPressed    [-]  current F8 reading, not a repeated key event
    /// in    KeyboardCaptured [-] text or modal controls own the keyboard
    /// out   Ejected         [-]  current Play camera is detached from the project request
    /// tag   nonallocating, nonthrowing
    bool Advance(uint32_t Transport, bool EjectPressed, bool KeyboardCaptured) noexcept
    {
        const bool Pressed = EjectPressed && !PreviousEject;
        PreviousEject = EjectPressed;
        if (Transport != 1u || PreviousTransport != 1u) Ejected = false;
        if (Transport == 1u && Pressed && !KeyboardCaptured) Ejected = !Ejected;
        PreviousTransport = Transport;
        return Ejected;
    }

    [[nodiscard]] bool IsEjected() const noexcept { return Ejected; }

private:
    uint32_t PreviousTransport = 0u;     // [-] - preceding editor transport reading
    bool     PreviousEject     = false;  // [-] - held F8 is consumed even while keyboard input is captured
    bool     Ejected           = false;  // [-] - vehicle simulation continues while its camera is detached
};

} // namespace Frontier::HostRuntime
