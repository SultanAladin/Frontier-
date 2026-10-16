#!/usr/bin/env python3
"""Build the actual SolidArc panels and their CPU proof, never a replacement UI.
Generated dependencies, objects and images stay in ignored cache/gallery folders.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT / 'Exhibits/Workbench/IconArt'))
from PrepareTarget import acquire

CACHE = ROOT / '.cache/solidarc-editor'
CACHE.mkdir(parents=True, exist_ok=True)
IMGUI = ROOT / 'ExternalPackages/imgui'
if not (IMGUI / 'imgui.cpp').exists():
    IMGUI = CACHE / 'imgui'
    acquire('ocornut/imgui', '83f668625ad45364de71d385aeb6a5dd04bee02e', IMGUI)
for patch, witness in [('PatchA-TrapezoidalTabs.patch', 'FRONTIER PATCH A'),
                       ('PatchB-TabOverlapZOrder.patch', 'FRONTIER PATCH B'),
                       ('PatchC-RoundTabButtons.patch', 'FRONTIER PATCH C'),
                       ('PatchD-TabAddButton.patch', 'FRONTIER PATCH D'),
                       ('PatchE-NoTabScrollButtons.patch', 'FRONTIER PATCH E'),
                       ('PatchF-TabContentInsets.patch', 'FRONTIER PATCH F')]:
    if not any(witness in (IMGUI / f).read_text() for f in ['imgui.cpp', 'imgui_widgets.cpp']):
        subprocess.run(['git', 'apply', '--unsafe-paths', '--directory=' + str(IMGUI),
                        str(ROOT / 'Tools/Build/Patches' / patch)], check=True)

TVG = ROOT / '.cache/cpp-target/ExternalPackages/thorvg'
STB = ROOT / '.cache/cpp-target/ExternalPackages/stb'
acquire('thorvg/thorvg', '6715f99ac106b6d4587f384a78c59fe957cfd2a3', TVG)
acquire('nothings/stb', '2c980bb59875b0d32144a71867fbdebb2f77cd20', STB)
LIB = ROOT / '.cache/icon-art/release/libthorvg.a'
if not LIB.exists():
    subprocess.run([sys.executable, 'Exhibits/Workbench/IconArt/BuildProof.py'], check=True)

CAD = ROOT / 'Editor/AuthoringTools/Modelling/SolidArc'
sources = [ROOT / 'Exhibits/Workbench/Editor/SolidArcEditorProof.cpp']
for folder in ['Kernel', 'Document', 'Interaction', 'Presentation']:
    sources += sorted((CAD / folder).glob('*.cpp'))
sources += [CAD / 'Console' / (n + '.cpp') for n in ['CommandCodec', 'ConsoleHost', 'ConsoleInteraction', 'ConsoleSelection']]
sources += sorted((CAD / 'Editor').glob('*.cpp'))
sources += [ROOT / 'Engine/Editor' / (n + '.cpp') for n in ['ControlPanel', 'OutlinerPanel', 'ViewportPanel']]
sources += sorted((ROOT / 'Engine/Editor').glob('*InspectorPanel.cpp'))
sources += [ROOT / 'Engine/DisplayPresentation' / (n + '.cpp') for n in ['GlyphSpace', 'VectorCodec', 'PixelSpace', 'IconArt', 'IconPresentation']]
sources += [IMGUI / (n + '.cpp') for n in ['imgui', 'imgui_draw', 'imgui_tables', 'imgui_widgets']]
flags = ['-std=c++20', '-O1', '-g', '-pthread', '-DFRONTIER_DEVELOPMENT', '-DTVG_STATIC', '-Wall', '-Wextra', '-Wno-unused-function']
flags += ['-I' + str(p) for p in [ROOT, ROOT/'Engine', IMGUI, TVG/'inc', CAD, CAD/'Presentation', ROOT/'Engine/Editor', ROOT/'Engine/DisplayPresentation', ROOT/'Exhibits/Workbench/Editor']]
cxx = os.environ.get('CXX', 'g++')

def compile_one(src):
    obj = CACHE / (hashlib.sha256(str(src).encode()).hexdigest()[:16] + '.o')
    dep = obj.with_suffix('.d')
    signature = obj.with_suffix('.command')
    cmd = [cxx, *flags, '-MMD', '-MF', str(dep), '-c', str(src), '-o', str(obj)]
    dependencies = [src]
    if dep.exists():
        dependencies += [Path(s) for s in dep.read_text().replace('\\\n', ' ').split(':', 1)[1].split()]
    stale = (not obj.exists() or not signature.exists() or signature.read_text() != json.dumps(cmd)
             or any(not p.exists() or p.stat().st_mtime > obj.stat().st_mtime for p in dependencies))
    if stale:
        log = obj.with_suffix('.log')
        with log.open('w') as out:
            result = subprocess.run(cmd, stdout=out, stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError(log.read_text())
        signature.write_text(json.dumps(cmd))
    return obj

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    objects = list(pool.map(compile_one, sources))
binary = CACHE / 'SolidArcEditorProof'
cmd = [cxx, '-pthread', *map(str, objects), str(LIB), '-o', str(binary)]
subprocess.run(cmd, check=True)
(CACHE / 'Build.json').write_text(json.dumps({'sources': list(map(str, sources)), 'flags': flags, 'link': cmd}, indent=2))
(ROOT/'Exhibits/Gallery/Editor').mkdir(parents=True, exist_ok=True)
if '--build-only' not in sys.argv:
    subprocess.run([str(binary)], check=True)
print(binary)
