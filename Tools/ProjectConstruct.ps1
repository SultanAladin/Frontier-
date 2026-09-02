#=============================================================================================================================================
# 📦 Frontier/Tools/ProjectConstruct.ps1 — Standalone Game Project Scaffolding Generator for Windows
#=============================================================================================================================================

[CmdletBinding()]
param(
    [string] $ProjectName = 'ConvergenceGTX',
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
    'Content\LevelArchives'
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

Write-Host "[Frontier Project Generator] Project $ProjectName structure created successfully." -ForegroundColor Yellow
