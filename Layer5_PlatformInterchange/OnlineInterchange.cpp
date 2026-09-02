//============================================================================================================================================
// 📦 Frontier/Layer5_PlatformInterchange/OnlineInterchange.cpp — EOS Platform Interchange Implementation
//============================================================================================================================================

#include "OnlineInterchange.h"

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

OnlineInterchange::OnlineInterchange(OnlineConfiguration Config) noexcept
    : m_Config(std::move(Config))
    , m_InitializedCondition(false)
    , m_AuthenticatedCondition(false)
{
}

OnlineInterchange::~OnlineInterchange() noexcept
{
    TerminatePlatform();
}

bool OnlineInterchange::InitializePlatform() noexcept
{
    m_InitializedCondition = true;
    return true;
}

void OnlineInterchange::TerminatePlatform() noexcept
{
    if (m_InitializedCondition)
    {
        m_Voice.LeaveRoom();
        m_AuthenticatedCondition = false;
        m_InitializedCondition = false;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                CYCLE ADVANCEMENT
//------------------------------------------------------------------------------------------------------------------------

void OnlineInterchange::AdvanceOnlineCycle() noexcept
{
    if (!m_InitializedCondition)
    {
        return;
    }

    // Corresponds to EOS_Platform_Tick()
}

bool OnlineInterchange::AuthenticateLocalUser(std::string_view UserToken) noexcept
{
    if (!m_InitializedCondition || UserToken.empty())
    {
        return false;
    }

    m_AuthenticatedCondition = true;
    return true;
}

bool OnlineInterchange::SendDatagram(uint64_t TargetAccountId, const void* PayloadBytes, size_t PayloadLength) noexcept
{
    (void)TargetAccountId;
    (void)PayloadBytes;
    (void)PayloadLength;
    return m_AuthenticatedCondition;
}

} // namespace Frontier
