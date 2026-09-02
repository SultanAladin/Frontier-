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
    KeySpace                            = 4,
    KeyLeftShift                        = 5,
    KeyLeftControl                      = 6,
    KeyEscape                           = 7,
    KeyEnter                            = 8,
    KeyUp                               = 9,
    KeyDown                             = 10,
    KeyLeft                             = 11,
    KeyRight                            = 12,
    Count                               = 13
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
    void                    AssignGamepadAxis(float LeftX, float LeftY, float RightX, float RightY, float LeftTrig, float RightTrig) noexcept;

    [[nodiscard]] bool      IsKeyPressed(VirtualKeyCategory Key) const noexcept;
    [[nodiscard]] Vector3   QueryCursorDelta() const noexcept { return CursorDelta; }
    [[nodiscard]] const GamepadRecord& QueryGamepad() const noexcept { return PrimaryGamepad; }

    // Single unified conversion operator for primary gamepad
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    GamepadRecord           PrimaryGamepad;                     // [gamepad] active gamepad record
    Vector3                 CursorDelta;                        // [px] mouse delta movement
    float                   AnalogDeadzone;                     // [0..1] joystick deadzone threshold
    std::array<bool, static_cast<size_t>(VirtualKeyCategory::Count)> KeyStates; // [keys] active pressed keys
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
