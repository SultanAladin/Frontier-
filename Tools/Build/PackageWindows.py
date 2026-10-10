#!/usr/bin/env python3
"""Package the linked Windows desktop build, its projects and its compiled shaders in one zip."""
from pathlib import Path
import hashlib
import json
import shutil
import zipfile

Root = Path(__file__).resolve().parents[2]
Build = Root / 'Build'
Stage = Build / 'WindowsDesktop'
Output = Build / 'Frontier-Windows-x64.zip'


def Copy(Source, Destination):
    if not Source.is_file():
        raise FileNotFoundError(f'Required Windows build output is missing: {Source}')
    Destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(Source, Destination)


def Main():
    if Stage.exists():
        shutil.rmtree(Stage)
    Stage.mkdir(parents=True)
    for Name in ('Frontier.exe', 'glfw3.dll'):
        Copy(Build / Name, Stage / Name)
    for Name in ('Project-Zero', 'Project-Drive'):
        Project = Root / 'Projects' / Name
        for Spec in Project.glob('*.frontier'):
            Copy(Spec, Stage / 'Projects' / Name / Spec.name)
        Image = 'ProjectZero' if Name == 'Project-Zero' else 'ProjectDrive'
        Copy(Project / 'Build' / (Image + '.dll'), Stage / 'Projects' / Name / 'Build' / (Image + '.dll'))
    shutil.copytree(Root / 'Projects/Project-Zero/Content', Stage / 'Projects/Project-Zero/Content')
    Dyno = Root / 'Projects/Project-Dyno/Build/Output/Windows/Release/Binary/Project-Dyno.exe'
    Copy(Dyno, Stage / 'Tools/Project-Dyno.exe')
    DriveContent = Root / 'Projects/Project-Drive/Content'
    if DriveContent.exists():
        shutil.copytree(DriveContent, Stage / 'Projects/Project-Drive/Content')
    Shaders = sorted((Root / 'Engine/Shaders').glob('*.spv'))
    if not Shaders:
        raise RuntimeError('No compiled SPIR-V shaders found')
    for Shader in Shaders:
        Copy(Shader, Stage / 'Engine/Shaders' / Shader.name)
    Manifest = Root / 'Engine/Shaders/ShaderManifest.json'
    if Manifest.exists():
        Copy(Manifest, Stage / 'Engine/Shaders/ShaderManifest.json')
    shutil.copytree(Root / 'EngineContent', Stage / 'EngineContent',
                    ignore=shutil.ignore_patterns('GeometryArchives'))
    SolidArc = Build / 'SolidArc'
    Copy(SolidArc / 'SolidArc.exe', Stage / 'SolidArc/SolidArc.exe')
    shutil.copytree(SolidArc / 'EngineContent', Stage / 'SolidArc/EngineContent')
    Copy(SolidArc / 'BuildManifest.json', Stage / 'SolidArc/BuildManifest.json')
    for Dll in SolidArc.glob('*.dll'):
        Copy(Dll, Stage / 'SolidArc' / Dll.name)
        Copy(Dll, Stage / Dll.name)
    Commit = __import__('os').environ.get('GITHUB_SHA', 'local')
    (Stage / 'BuildManifest.json').write_text(json.dumps({
        'sourceCommit': Commit, 'platform': 'Windows x64', 'configuration': 'Release',
        'applications': ['Frontier.exe', 'SolidArc/SolidArc.exe'],
        'projectImages': ['Projects/Project-Zero/Build/ProjectZero.dll',
                          'Projects/Project-Drive/Build/ProjectDrive.dll'],
        'additionalTools': ['Tools/Project-Dyno.exe'], 'shaderCount': len(Shaders), 'note': 'Linked on CI; interactive UI requires a Windows desktop.'
    }, indent=2), encoding='utf-8')
    (Stage / 'START-HERE.txt').write_text(
        'Extract the whole zip before running. On Windows x64, double-click Frontier.exe '
        'or SolidArc\\SolidArc.exe. In Frontier use Add (+) > Authoring Tools > Open in SolidArc. '
        'Keep the folders alongside the executables. Frontier.exe accepts a path to '
        'Projects\\Project-Zero\\ProjectZero.frontier or Projects\\Project-Drive\\ProjectDrive.frontier. '
        'A Vulkan-capable driver is needed for Frontier; SolidArc uses Direct3D 11. '
        'See BuildManifest.json for the source commit and shader count.\n', encoding='utf-8')
    if Output.exists():
        Output.unlink()
    with zipfile.ZipFile(Output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as Zip:
        for File in Stage.rglob('*'):
            if File.is_file():
                Zip.write(File, File.relative_to(Stage))
    with zipfile.ZipFile(Output) as Zip:
        Bad = Zip.testzip()
        if Bad:
            raise RuntimeError(f'Bundle zip is corrupt at {Bad}')
    print(f'PASS {Output} ({Output.stat().st_size} bytes), {len(Shaders)} shaders, SHA256 {hashlib.sha256(Output.read_bytes()).hexdigest()}')


if __name__ == '__main__':
    Main()
