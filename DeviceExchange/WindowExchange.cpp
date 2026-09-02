//============================================================================================================================================
// 📦 Frontier/DeviceExchange/WindowExchange.cpp — Window Creation and Display Implementation
//============================================================================================================================================

#include "WindowExchange.h"

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

WindowExchange::WindowExchange() noexcept
    : NativeWindowToken(nullptr)
    , CurrentWidth(1920)
    , CurrentHeight(1080)
    , CloseRequestedCondition(false)
    , OpenCondition(false)
{
}

WindowExchange::~WindowExchange() noexcept
{
    CloseDisplayWindow();
}

bool WindowExchange::OpenDisplayWindow(const WindowConfiguration& Config) noexcept
{
    CurrentWidth            = Config.Width;
    CurrentHeight           = Config.Height;
    NativeWindowToken       = reinterpret_cast<void*>(0xDEADBEEFULL); // Representative native window handle
    CloseRequestedCondition = false;
    OpenCondition           = true;
    return true;
}

void WindowExchange::CloseDisplayWindow() noexcept
{
    if (OpenCondition)
    {
        NativeWindowToken       = nullptr;
        CloseRequestedCondition = false;
        OpenCondition           = false;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                EVENT POLLING
//------------------------------------------------------------------------------------------------------------------------

void WindowExchange::PollEvents() noexcept
{
    if (!OpenCondition)
    {
        return;
    }

    // Corresponds to glfwPollEvents() or Win32 PeekMessage loop
}

} // namespace Frontier
