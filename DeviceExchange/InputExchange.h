//============================================================================================================================================
// 📦 Frontier/DeviceExchange/InputExchange.h — Multi-Device Keyboard, Mouse, and Gamepad Input Polling
//============================================================================================================================================

#pragma once

#if defined(_MSC_VER)
    #pragma warning(disable: 4324)                              // Disable structure padding alignment warning under /WX
#endif

#include "OrientationClassifier.h"
#include <cstdint>
#include <array>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                    KEYBOARD KEY
//------------------------------------------------------------------------------------------------------------------------

enum class VirtualKeyCategory : uint32_t
{
    KeyW                                = 0,
    KeyA                                = 1,
    KeyS                                = 2,
    KeyD                                = 3,
    KeyQ                                = 4,
    KeyE                                = 5,
    KeySpace                            = 6,
    KeyLeftShift                        = 7,
    KeyLeftControl                      = 8,
    KeyEscape                           = 9,
    KeyEnter                            = 10,
    KeyUp                               = 11,
    KeyDown                             = 12,
    KeyLeft                             = 13,
    KeyRight                            = 14,
    Count                               = 15
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    GAMEPAD RECORD
//------------------------------------------------------------------------------------------------------------------------

struct GamepadRecord
{
    Vector3                 LeftStickDirection;                 // [-1..1] analog left joystick axis (x, y)
    Vector3                 RightStickDirection;                // [-1..1] analog right joystick axis (x, y)
    float                   LeftTriggerPressure;                // [0..1] analog brake trigger pressure
    float                   RightTriggerPressure;               // [0..1] analog accelerator trigger pressure
    bool                    ButtonSouthDown;                    // [bool] A / Cross button
    bool                    ButtonEastDown;                     // [bool] B / Circle button
    bool                    ButtonWestDown;                     // [bool] X / Square button
    bool                    ButtonNorthDown;                    // [bool] Y / Triangle button
    bool                    ConnectedCondition;                 // [bool] gamepad connection status
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   INPUT EXCHANGE
//------------------------------------------------------------------------------------------------------------------------

class InputExchange
{
public:
    InputExchange() noexcept;
    ~InputExchange() noexcept = default;

    InputExchange(const InputExchange&) = delete;
    InputExchange& operator=(const InputExchange&) = delete;

    void                    PollInputDevices() noexcept;

    void                    AssignKeyState(VirtualKeyCategory Key, bool Pressed) noexcept;
    void                    AssignCursorDelta(float DeltaX, float DeltaY) noexcept;
    void                    AssignMouseButton(uint32_t ButtonIndex, bool Pressed) noexcept;
    void                    AssignMouseScroll(float ScrollDelta) noexcept;
    void                    AssignGamepadAxis(float LeftX, float LeftY, float RightX, float RightY, float LeftTrig, float RightTrig) noexcept;

    [[nodiscard]] bool      IsKeyPressed(VirtualKeyCategory Key) const noexcept;
    [[nodiscard]] bool      IsMouseButtonPressed(uint32_t ButtonIndex) const noexcept;
    [[nodiscard]] float     QueryMouseScrollDelta() const noexcept { return MouseScrollDelta; }
    [[nodiscard]] Vector3   QueryCursorDelta() const noexcept { return CursorDelta; }
    [[nodiscard]] const GamepadRecord& QueryGamepad() const noexcept { return PrimaryGamepad; }

    // Single unified conversion operator for primary gamepad
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    GamepadRecord           PrimaryGamepad;                     // [gamepad] active gamepad record
    Vector3                 CursorDelta;                        // [px] mouse delta movement
    float                   AnalogDeadzone;                     // [0..1] joystick deadzone threshold
    float                   MouseScrollDelta;                   // [clicks] mouse scroll wheel increment
    std::array<bool, static_cast<size_t>(VirtualKeyCategory::Count)> KeyStates; // [keys] active pressed keys
    std::array<bool, 5>     MouseButtonStates;                  // [buttons] mouse buttons (0=LMB, 1=RMB, 2=MMB)
};

template<>
inline GamepadRecord InputExchange::Convert<GamepadRecord>() const noexcept
{
    return PrimaryGamepad;
}

template<>
inline bool InputExchange::Convert<bool>() const noexcept
{
    return PrimaryGamepad.ConnectedCondition;
}

} // namespace Frontier
