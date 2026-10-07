//============================================================================================================================================
//                                                              EPICEXCHANGE.CPP
//============================================================================================================================================
// 📦 Authenticates through Epic Account Portal and exchanges the identity token for a product user.

#include "EpicExchange.h"

#include <eos_sdk.h>
#include <eos_auth.h>
#include <eos_connect.h>
#include <eos_version.h>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <cstdio>

namespace Networking
{
namespace
{
EOS_HPlatform Platform = nullptr;
EOS_HAuth Auth = nullptr;
EOS_HConnect Connect = nullptr;
EOS_Auth_IdToken* IdentityToken = nullptr;
LoginSequence Login;
DiagnosticReception Reception = nullptr;
bool OwnsInitialization = false;
bool AllowCreation = false;
std::chrono::steady_clock::time_point Started;

void Emit(const char* Text) noexcept
{
    if (Reception)
        Reception(Text);
}

void Refuse(const char* Operation, EOS_EResult Result) noexcept
{
    char Text[256]{};
    std::snprintf(Text, sizeof(Text), "%s result=%s", Operation, EOS_EResult_ToString(Result));
    Emit(Text);
    Login.Refuse();
}

void ReleaseToken() noexcept
{
    if (IdentityToken)
        EOS_Auth_IdToken_Release(IdentityToken);
    IdentityToken = nullptr;
}

void AcceptProductUser(EOS_ProductUserId ProductUser) noexcept
{
    const bool Valid = EOS_ProductUserId_IsValid(ProductUser) == EOS_TRUE;
    Login.AcceptConnect(Valid);
    Emit(Valid ? "connect=success product_user_id_valid=1" : "connect=refused invalid_product_user_id");
    if (Login.Progress == LoginProgress::Connected)
        Emit("LOGIN_VERIFIED auth=success connect=success");
}

void EOS_CALL ReceiveCreation(const EOS_Connect_CreateUserCallbackInfo* Completion)
{
    if (Login.Finished() || EOS_EResult_IsOperationComplete(Completion->ResultCode) != EOS_TRUE)
        return;
    if (Completion->ResultCode != EOS_EResult::EOS_Success)
    {
        Refuse("connect_create_user", Completion->ResultCode);
        return;
    }
    AcceptProductUser(Completion->LocalUserId);
}

void EOS_CALL ReceiveConnect(const EOS_Connect_LoginCallbackInfo* Completion)
{
    if (Login.Finished() || EOS_EResult_IsOperationComplete(Completion->ResultCode) != EOS_TRUE)
        return;
    ReleaseToken();
    if (Completion->ResultCode == EOS_EResult::EOS_InvalidUser && Completion->ContinuanceToken)
    {
        if (!AllowCreation)
        {
            Emit("connect=account_creation_required consent=missing; set EOS_ALLOW_CREATE_USER=1 only for a new test account");
            Login.Refuse();
            return;
        }
        EOS_Connect_CreateUserOptions Options{};
        Options.ApiVersion = EOS_CONNECT_CREATEUSER_API_LATEST;
        Options.ContinuanceToken = Completion->ContinuanceToken;
        EOS_Connect_CreateUser(Connect, &Options, nullptr, ReceiveCreation);
        return;
    }
    if (Completion->ResultCode != EOS_EResult::EOS_Success)
    {
        Refuse("connect_login", Completion->ResultCode);
        return;
    }
    AcceptProductUser(Completion->LocalUserId);
}

void EOS_CALL ReceiveAuth(const EOS_Auth_LoginCallbackInfo* Completion)
{
    if (Login.Finished() || EOS_EResult_IsOperationComplete(Completion->ResultCode) != EOS_TRUE)
        return;
    if (Completion->ResultCode != EOS_EResult::EOS_Success)
    {
        Refuse("auth_login", Completion->ResultCode);
        return;
    }
    Login.AcceptAuth(EOS_EpicAccountId_IsValid(Completion->LocalUserId) == EOS_TRUE &&
                     EOS_EpicAccountId_IsValid(Completion->SelectedAccountId) == EOS_TRUE);
    if (Login.Finished())
    {
        Emit("auth=refused invalid_epic_account_id");
        return;
    }
    Emit("auth=success epic_account_id_valid=1");
    EOS_Auth_CopyIdTokenOptions Copy{};
    Copy.ApiVersion = EOS_AUTH_COPYIDTOKEN_API_LATEST;
    Copy.AccountId = Completion->SelectedAccountId;
    const EOS_EResult Result = EOS_Auth_CopyIdToken(Auth, &Copy, &IdentityToken);
    if (Result != EOS_EResult::EOS_Success)
    {
        Refuse("auth_copy_id_token", Result);
        return;
    }
    EOS_Connect_Credentials Credentials{};
    Credentials.ApiVersion = EOS_CONNECT_CREDENTIALS_API_LATEST;
    Credentials.Type = EOS_EExternalCredentialType::EOS_ECT_EPIC_ID_TOKEN;
    if (!IdentityToken || !IdentityToken->JsonWebToken || !*IdentityToken->JsonWebToken)
    {
        Emit("auth=refused missing_identity_token");
        Login.Refuse();
        ReleaseToken();
        return;
    }
    Credentials.Token = IdentityToken->JsonWebToken;
    EOS_Connect_LoginOptions Options{};
    Options.ApiVersion = EOS_CONNECT_LOGIN_API_LATEST;
    Options.Credentials = &Credentials;
    EOS_Connect_Login(Connect, &Options, nullptr, ReceiveConnect);
}
}

bool VerifyEpicRuntime(DiagnosticReception ActiveReception) noexcept
{
    if (Platform || OwnsInitialization || !ActiveReception)
        return false;
    ActiveReception("scope=sdk_runtime_only authentication=NOT_ATTEMPTED");
    ActiveReception(EOS_GetVersion());
    EOS_InitializeOptions Options{};
    Options.ApiVersion = EOS_INITIALIZE_API_LATEST;
    Options.ProductName = "Charge";
    Options.ProductVersion = "Networking-Dev-1";
    const EOS_EResult Result = EOS_Initialize(&Options);
    ActiveReception(EOS_EResult_ToString(Result));
    if (Result != EOS_EResult::EOS_Success)
        return false;
    const EOS_EResult Shutdown = EOS_Shutdown();
    ActiveReception(EOS_EResult_ToString(Shutdown));
    return Shutdown == EOS_EResult::EOS_Success;
}

bool ConstructEpic(DiagnosticReception ActiveReception) noexcept
{
    if (Platform || OwnsInitialization)
        return false;
    Reception = ActiveReception;
    Login = {};
    const char* Secret = std::getenv("EOS_CLIENT_SECRET");
    if (!Secret || !*Secret)
    {
        Emit("configuration=refused missing_EOS_CLIENT_SECRET; use a rotated credential locally");
        Login.Refuse();
        return false;
    }
    const char* ClientId = std::getenv("EOS_CLIENT_ID");
    if (!ClientId || !*ClientId)
        ClientId = "xyza7891AKjtZj8wTzcmI5F3oc1zLU4s";
    const char* Consent = std::getenv("EOS_ALLOW_CREATE_USER");
    AllowCreation = Consent && std::strcmp(Consent, "1") == 0;
    EOS_InitializeOptions Initialize{};
    Initialize.ApiVersion = EOS_INITIALIZE_API_LATEST;
    Initialize.ProductName = "Charge";
    Initialize.ProductVersion = "Networking-Dev-1";
    const EOS_EResult Result = EOS_Initialize(&Initialize);
    if (Result != EOS_EResult::EOS_Success)
    {
        Refuse("initialize", Result);
        return false;
    }
    OwnsInitialization = true;
    EOS_Platform_Options Options{};
    Options.ApiVersion = EOS_PLATFORM_OPTIONS_API_LATEST;
    Options.ProductId = "fbf3442817da41bda43997bd3d87e875";
    Options.SandboxId = "p-ewz29ujngay2pm7t5twt8drcvbr8ru";
    Options.DeploymentId = "bb5140b152114e8b92021b0afd8c9df1";
    Options.ClientCredentials.ClientId = ClientId;
    Options.ClientCredentials.ClientSecret = Secret;
    Options.bIsServer = EOS_FALSE;
    Options.Flags = 0;
    Platform = EOS_Platform_Create(&Options);
    if (!Platform)
    {
        Emit("platform=refused");
        Login.Refuse();
        RetireEpic();
        return false;
    }
    Auth = EOS_Platform_GetAuthInterface(Platform);
    Connect = EOS_Platform_GetConnectInterface(Platform);
    if (!Auth || !Connect)
    {
        Emit("interfaces=refused");
        Login.Refuse();
        RetireEpic();
        return false;
    }
    const char* Method = std::getenv("EOS_LOGIN_METHOD");
    const bool Developer = Method && std::strcmp(Method, "developer") == 0;
    if (Method && *Method && !Developer && std::strcmp(Method, "accountportal") != 0)
    {
        Emit("configuration=refused unknown_login_method");
        Login.Refuse();
        RetireEpic();
        return false;
    }
    EOS_Auth_Credentials Credentials{};
    Credentials.ApiVersion = EOS_AUTH_CREDENTIALS_API_LATEST;
    Credentials.Type = EOS_ELoginCredentialType::EOS_LCT_AccountPortal;
    if (Developer)
    {
        const char* Credential = std::getenv("EOS_DEVELOPER_CREDENTIAL");
        if (!Credential || !*Credential)
        {
            Emit("configuration=refused missing_developer_credential_name");
            Login.Refuse();
            RetireEpic();
            return false;
        }
        Credentials.Type = EOS_ELoginCredentialType::EOS_LCT_Developer;
        Credentials.Id = "localhost:6547";
        Credentials.Token = Credential;
    }
#if defined(_WIN32)
    else
    {
        EOS_Platform_GetDesktopCrossplayStatusOptions Readiness{};
        Readiness.ApiVersion = EOS_PLATFORM_GETDESKTOPCROSSPLAYSTATUS_API_LATEST;
        EOS_Platform_DesktopCrossplayStatusInfo Reading{};
        const EOS_EResult ReadinessResult = EOS_Platform_GetDesktopCrossplayStatus(Platform, &Readiness, &Reading);
        if (ReadinessResult != EOS_EResult::EOS_Success ||
            Reading.Status != EOS_EDesktopCrossplayStatus::EOS_DCS_OK)
        {
            char Text[256]{};
            std::snprintf(Text, sizeof(Text), "account_portal=not_ready result=%s status=%d service=%d",
                EOS_EResult_ToString(ReadinessResult), static_cast<int>(Reading.Status), Reading.ServiceInitResult);
            Emit(Text);
            Emit("Install EOS redistributable and launch through EOS Bootstrapper, or use Developer Auth Tool for testing");
            Login.Refuse();
            RetireEpic();
            return false;
        }
    }
#endif
    EOS_Auth_LoginOptions LoginOptions{};
    LoginOptions.ApiVersion = EOS_AUTH_LOGIN_API_LATEST;
    LoginOptions.Credentials = &Credentials;
    LoginOptions.ScopeFlags = EOS_EAuthScopeFlags::EOS_AS_BasicProfile;
    Started = std::chrono::steady_clock::now();
    Emit(Developer ? "auth=waiting method=developer timeout_seconds=180" :
                     "auth=waiting method=account_portal timeout_seconds=180");
    EOS_Auth_Login(Auth, &LoginOptions, nullptr, ReceiveAuth);
    return true;
}

void AdvanceEpic() noexcept
{
    if (!Platform || Login.Finished())
        return;
    EOS_Platform_Tick(Platform);
    if (!Login.Finished() && std::chrono::steady_clock::now() - Started > std::chrono::seconds(180))
    {
        Emit("login=refused timeout");
        Login.Refuse();
    }
}

void RetireEpic() noexcept
{
    Login.Refuse();
    if (Platform)
        EOS_Platform_Release(Platform);
    Platform = nullptr;
    Auth = nullptr;
    Connect = nullptr;
    ReleaseToken();
    if (OwnsInitialization)
        EOS_Shutdown();
    OwnsInitialization = false;
    Reception = nullptr;
}

LoginProgress InspectLogin() noexcept
{
    return Login.Progress;
}
}
