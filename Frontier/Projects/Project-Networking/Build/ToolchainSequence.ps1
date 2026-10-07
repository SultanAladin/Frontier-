param(
    [Parameter(Mandatory = $true)][string]$SdkRoot,
    [Parameter(Mandatory = $true)][string]$SlateRoot
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$Output = Join-Path $PSScriptRoot 'Output'
$SdkRoot = (Resolve-Path $SdkRoot).Path
$SlateRoot = (Resolve-Path $SlateRoot).Path
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
    $Revision = & git -C $SlateRoot rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Unable to record Slate revision.' }
    @{
        slate_revision = $Revision
        built_utc = [DateTime]::UtcNow.ToString('o')
        eos_runtime_sha256 = (Get-FileHash $Runtime -Algorithm SHA256).Hash
        sources = @(Get-ChildItem (Join-Path $ProjectRoot 'Source') -File | ForEach-Object {
            @{ name = $_.Name; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash }
        })
    } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $Output 'BuildEvidence.json')
} finally {
    Pop-Location
}
Write-Host "Built console and project DLL in $Output. Authentication has NOT been executed."
