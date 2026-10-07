param(
    [Parameter(Mandatory = $true)][string]$SdkRoot,
    [Parameter(Mandatory = $true)][string]$SlateRoot,
    [Parameter(Mandatory = $true)][string]$GuiRoot
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$Output = Join-Path $PSScriptRoot 'Output'
$SdkRoot = (Resolve-Path $SdkRoot).Path
$SlateRoot = (Resolve-Path $SlateRoot).Path
$GuiRoot = (Resolve-Path $GuiRoot).Path
$Include = Join-Path $SdkRoot 'Include'
$Library = Join-Path $SdkRoot 'Lib/EOSSDK-Win64-Shipping.lib'
$Runtime = Join-Path $SdkRoot 'Bin/EOSSDK-Win64-Shipping.dll'
$Interchange = Join-Path $SlateRoot 'Frontier/Engine/ProjectInterchange'
foreach ($Required in @($Library, $Runtime, (Join-Path $Include 'eos_sdk.h'), (Join-Path $Interchange 'ProjectInterchange.h'))) {
    if (-not (Test-Path $Required)) { throw "Required file absent: $Required" }
}
if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    throw 'Run from an x64 Visual Studio developer PowerShell with cl.exe available.'
}
if ($env:VSCMD_ARG_TGT_ARCH -ne 'x64') {
    throw 'Use the x64 Visual Studio developer environment.'
}
New-Item -ItemType Directory -Force $Output | Out-Null
$Flags = @('/nologo', '/std:c++20', '/MD', '/EHsc', '/W4', '/utf-8', '/D_CRT_SECURE_NO_WARNINGS', "/I$Include", "/I$Interchange")
$Exchange = Join-Path $ProjectRoot 'Source/EpicExchange.cpp'
Push-Location $Output
try {
    & cl.exe @Flags $Exchange (Join-Path $ProjectRoot 'Source/LoginHost.cpp') '/Fe:LoginHost.exe' /link $Library
    if ($LASTEXITCODE -ne 0) { throw 'EOS console compilation/link failed.' }
    & cl.exe @Flags /LD $Exchange (Join-Path $ProjectRoot 'Source/NetworkingInterchange.cpp') '/Fe:ProjectNetworking.dll' /link $Library
    if ($LASTEXITCODE -ne 0) { throw 'Frontier project DLL compilation/link failed.' }
    Copy-Item $Runtime (Join-Path $Output 'EOSSDK-Win64-Shipping.dll') -Force
    $GuiBuild = Join-Path $Output 'WindowBuild'
    $ConfigureOutput = & cmake -S (Join-Path $PSScriptRoot 'WindowHost') -B $GuiBuild -A x64 "-DEOS_SDK_ROOT=$SdkRoot" "-DGUI_ROOT=$GuiRoot"
    $ConfigureCode = $LASTEXITCODE
    $ConfigureOutput | Write-Host
    if ($ConfigureCode -ne 0) {
        $ConfigureOutput | Select-Object -Last 30 | ForEach-Object { Write-Host "::error::$_" }
        throw 'GLFW/ImGui window configuration failed.'
    }
    $BuildOutput = & cmake --build $GuiBuild --config Release --parallel 4
    $BuildCode = $LASTEXITCODE
    $BuildOutput | Write-Host
    if ($BuildCode -ne 0) {
        $BuildOutput | Select-Object -Last 30 | ForEach-Object { Write-Host "::error::$_" }
        throw 'GLFW/ImGui window build failed.'
    }
    $Revision = & git -C $SlateRoot rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Unable to record Slate revision.' }
    @{
        slate_revision = $Revision
        gui_glfw_revision = (& git -C (Join-Path $GuiRoot 'glfw') rev-parse HEAD)
        gui_imgui_revision = (& git -C (Join-Path $GuiRoot 'imgui') rev-parse HEAD)
        window_sha256 = (Get-FileHash (Join-Path $Output 'NetworkingLogin.exe') -Algorithm SHA256).Hash
        built_utc = [DateTime]::UtcNow.ToString('o')
        eos_runtime_sha256 = (Get-FileHash $Runtime -Algorithm SHA256).Hash
        sources = @(Get-ChildItem (Join-Path $ProjectRoot 'Source') -File | ForEach-Object {
            @{ name = $_.Name; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash }
        })
    } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $Output 'BuildEvidence.json')
} finally {
    Pop-Location
}
Write-Host "Built GLFW/ImGui window, console diagnostic and project DLL in $Output. Authentication has NOT been executed."
