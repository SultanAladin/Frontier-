#=============================================================================================================================================
# 📦 Frontier/Tools/ProjectConstruct.ps1 — Standalone Game Project Scaffolding and Automated Build Generator for Windows
#=============================================================================================================================================

[CmdletBinding()]
param(
    [string] $ProjectName = 'Project-F20',
    [string] $Destination = 'Projects'
)

$ErrorActionPreference = 'Stop'

$RepositoryRoot = Split-Path -Parent $PSScriptRoot
$TargetDir      = Join-Path (Join-Path $RepositoryRoot $Destination) $ProjectName

Write-Host "[Frontier Project Generator] Scaffolding Project: $ProjectName at $TargetDir" -ForegroundColor Cyan

$Folders = @(
    'Source'
    'Shaders'
    'Content\AudioArchives'
    'Content\FontArchives'
    'Content\GeometryArchives'
    'Content\GraphicArchives'
    'Content\ShaderArchives'
    'Content\WorldArchives'
    'Build'
)

foreach ($Folder in $Folders)
{
    $Path = Join-Path $TargetDir $Folder
    if (-not (Test-Path $Path))
    {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
        Write-Host "  + Created: $Folder" -ForegroundColor Green
    }
}

# Automatically generate project Build/Construct.ps1
$BuildScriptPath = Join-Path $TargetDir 'Build\Construct.ps1'
$ScriptContent = @"
# Direct Toolchain Build Driver for $ProjectName
[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')] [string] `$Configuration = 'Release',
    [switch] `$Rebuild,
    [switch] `$Run
)
`$ErrorActionPreference = 'Stop'
`$ProjectRoot = Split-Path -Parent `$PSScriptRoot
`$RepositoryRoot = Split-Path -Parent (Split-Path -Parent `$ProjectRoot)
powershell -NoProfile -ExecutionPolicy Bypass -File "`$RepositoryRoot\Build\Construct.ps1" -Configuration `$Configuration
`$OutputRoot = Join-Path `$ProjectRoot "build\`$Configuration"
`$BinRoot = Join-Path `$ProjectRoot 'bin'
if (`$Rebuild -and (Test-Path `$OutputRoot)) { Remove-Item -Path `$OutputRoot -Recurse -Force }
if (-not (Test-Path `$OutputRoot)) { New-Item -ItemType Directory -Path `$OutputRoot -Force | Out-Null }
if (-not (Test-Path `$BinRoot)) { New-Item -ItemType Directory -Path `$BinRoot -Force | Out-Null }
`$SourceFiles = @(Get-ChildItem -Path (Join-Path `$ProjectRoot 'Source') -Filter '*.cpp' | ForEach-Object { `$_.FullName })
`$EngineObjFiles = Get-ChildItem -Path (Join-Path `$RepositoryRoot "build\`$Configuration") -Filter '*.obj' | Where-Object { `$_.Name -notmatch 'Execution\.obj' } | ForEach-Object { `$_.FullName }
`$TargetExe = Join-Path `$BinRoot '$ProjectName.exe'
`$CompilerFlags = @('/nologo', '/c', '/EHsc', '/MP', '/MD', '/std:c++20', '/permissive-', '/fp:precise', '/W4', '/WX', '/utf-8', '/Zc:__cplusplus', '/DWIN32_LEAN_AND_MEAN', '/DNOMINMAX', '/DFRONTIER_DEVELOPMENT', "/I```"`$RepositoryRoot```"", "/I```"`$ProjectRoot```"", "/Fo```"`$OutputRoot\\```"")
if (`$Configuration -eq 'Debug') { `$CompilerFlags += @('/Od', '/Zi', '/Zf', '/DFRONTIER_DEBUG=1') } else { `$CompilerFlags += @('/O2', '/Zi', '/Zf', '/DNDEBUG') }
& cl.exe `$CompilerFlags `$SourceFiles
if (`$LASTEXITCODE -ne 0) { exit 1 }
`$GameObjFiles = Get-ChildItem -Path `$OutputRoot -Filter '*.obj' | ForEach-Object { `$_.FullName }
& link.exe @('/nologo', '/DEBUG', "/OUT:```"`$TargetExe```"", '/SUBSYSTEM:CONSOLE') `$GameObjFiles `$EngineObjFiles
if (`$LASTEXITCODE -ne 0) { exit 1 }
Write-Host "[$ProjectName] Executable built successfully: `$TargetExe" -ForegroundColor Green
if (`$Run) { & `$TargetExe }
"@

Set-Content -Path $BuildScriptPath -Value $ScriptContent -Encoding UTF8
Write-Host "  + Generated: Build\Construct.ps1" -ForegroundColor Green

Write-Host "[Frontier Project Generator] Project $ProjectName automated build configuration created successfully." -ForegroundColor Yellow
