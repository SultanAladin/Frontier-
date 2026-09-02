#=============================================================================================================================================
# 📦 Project-F20/Build/Construct.ps1 — Direct Toolchain Build Driver for Project-F20 Game Project
#=============================================================================================================================================

[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')] [string] $Configuration = 'Release',
    [switch]                                   $Rebuild,
    [switch]                                   $Run
)

$ErrorActionPreference = 'Stop'

$ProjectRoot    = Split-Path -Parent $PSScriptRoot
$RepositoryRoot = Split-Path -Parent (Split-Path -Parent $ProjectRoot)
$BinRoot        = Join-Path $ProjectRoot 'bin'
$OutputRoot     = Join-Path $ProjectRoot "build\$Configuration"

# Delegate to engine build if engine binaries needed, then compile game host
powershell -NoProfile -ExecutionPolicy Bypass -File "$RepositoryRoot\Build\Construct.ps1" -Configuration $Configuration

if ($Rebuild -and (Test-Path $OutputRoot))
{
    Remove-Item -Path $OutputRoot -Recurse -Force
}

if (-not (Test-Path $OutputRoot))
{
    New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
}

if (-not (Test-Path $BinRoot))
{
    New-Item -ItemType Directory -Path $BinRoot -Force | Out-Null
}

$SourceFiles = @(
    Get-ChildItem -Path (Join-Path $ProjectRoot 'Source') -Filter '*.cpp' | ForEach-Object { $_.FullName }
)

$EngineObjFiles = Get-ChildItem -Path (Join-Path $RepositoryRoot "build\$Configuration") -Filter '*.obj' |
    Where-Object { $_.Name -notmatch 'EngineExecution\.obj' } |
    ForEach-Object { $_.FullName }

$TargetExe = Join-Path $BinRoot 'Project-F20.exe'

$CompilerFlags = @(
    '/nologo',
    '/c',
    '/EHsc',
    '/MP',
    '/MD',
    '/std:c++20',
    '/permissive-',
    '/fp:precise',
    '/W4',
    '/WX',
    '/utf-8',
    '/Zc:__cplusplus',
    '/DWIN32_LEAN_AND_MEAN',
    '/DNOMINMAX',
    '/DFRONTIER_DEVELOPMENT',
    "/I`"$RepositoryRoot`"",
    "/I`"$ProjectRoot`"",
    "/Fo`"$OutputRoot\\`""
)

if ($Configuration -eq 'Debug')
{
    $CompilerFlags += @('/Od', '/Zi', '/Zf', '/DFRONTIER_DEBUG=1')
}
else
{
    $CompilerFlags += @('/O2', '/Zi', '/Zf', '/DNDEBUG')
}

& cl.exe $CompilerFlags $SourceFiles
if ($LASTEXITCODE -ne 0) { exit 1 }

$GameObjFiles = Get-ChildItem -Path $OutputRoot -Filter '*.obj' | ForEach-Object { $_.FullName }
$LinkArgs     = @('/nologo', '/DEBUG', "/OUT:`"$TargetExe`"", '/SUBSYSTEM:CONSOLE') + $GameObjFiles + $EngineObjFiles

& link.exe $LinkArgs
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "[Project-F20] Executable built successfully: $TargetExe" -ForegroundColor Green

if ($Run)
{
    & $TargetExe
}
