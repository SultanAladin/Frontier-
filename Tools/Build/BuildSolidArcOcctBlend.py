"""Build the EXPERIMENTAL Linux x86-64 native OCCT blending worker.

Downloads are hash-pinned; no Python OCP module is imported or used for geometry.
See Experimental/SolidArc/Native/OCCT_BLEND.md before enabling the worker.
"""
from pathlib import Path
import hashlib
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache/solidarc-occt'
WHEEL = 'cadquery_ocp-7.8.1.1.post1-cp311-cp311-manylinux_2_31_x86_64.whl'
WHEEL_SHA = '0ff754db099da9a4285268cecf7740fef782567621480b007697c00e47f8fbde'
SOURCE_SHA = '7321af48c34dc253bf8aae3f0430e8cb10976961d534d8509e72516978aa82f5'
HEADER_SHA = 'aaf127c04cb31c406e5b04a63f1ae89369fccde6d8fa7cdda1ed4f32dfc5de63'


def verify(path, expected):
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise RuntimeError(f'Hash mismatch: {path}; remove it and retry the pinned download')


def main():
    if platform.system() != 'Linux' or platform.machine() not in ('x86_64', 'AMD64'):
        raise RuntimeError('This optional dependency bootstrap supports Linux x86-64 only')
    if not shutil.which('timeout'):
        raise RuntimeError('GNU coreutils timeout is required by the native bridge')
    CACHE.mkdir(parents=True, exist_ok=True)
    wheel = CACHE / WHEEL
    if not wheel.exists():
        subprocess.run([sys.executable, '-m', 'pip', 'download', '--no-deps',
                        '--only-binary=:all:', '--platform', 'manylinux_2_31_x86_64',
                        '--python-version', '311', '--implementation', 'cp', '--abi', 'cp311',
                        'cadquery-ocp==7.8.1.1.post1', '-d', str(CACHE)], check=True)
    verify(wheel, WHEEL_SHA)
    source = CACHE / 'source.tar.gz'
    if not source.exists():
        urllib.request.urlretrieve('https://codeload.github.com/Open-Cascade-SAS/OCCT/tar.gz/refs/tags/V7_8_1', source)
    verify(source, SOURCE_SHA)
    package = CACHE / 'package'
    # Extract only the shared libraries and upstream license; never execute Python wheel code.
    with zipfile.ZipFile(wheel) as archive:
        for item in archive.infolist():
            name = Path(item.filename)
            if name.is_absolute() or '..' in name.parts:
                raise RuntimeError('Unsafe wheel path')
            if item.filename.startswith('cadquery_ocp.libs/') or item.filename == 'cadquery_ocp/LICENSE':
                archive.extract(item, package)
    include = CACHE / 'include'
    include.mkdir(exist_ok=True)
    with tarfile.open(source) as archive:
        for item in archive:
            if not item.isfile():
                continue
            name = Path(item.name)
            destination = None
            if '/src/' in item.name and name.suffix in ('.hxx', '.lxx', '.gxx', '.h'):
                destination = include / name.name
            elif name.name in ('LICENSE_LGPL_21.txt', 'OCCT_LGPL_EXCEPTION.txt'):
                destination = CACHE / name.name
            if destination:
                with archive.extractfile(item) as stream:
                    destination.write_bytes(stream.read())
    header = ROOT / 'ExternalPackages/json/include/nlohmann/json.hpp'
    if not header.exists():
        raise RuntimeError('Build CompileSequence.py --native first to provision the pinned JSON header')
    verify(header, HEADER_SHA)
    libs = package / 'cadquery_ocp.libs'
    command = [os.environ.get('CXX', 'g++'), '-std=c++17', '-O1', '-I' + str(include),
               '-I' + str(header.parents[1]), str(ROOT / 'Tools/Build/SolidArcOcctBlendHost.cpp'),
               '-o', str(CACHE / 'BlendHost'), '-Wl,-rpath,' + str(libs), '-Wl,-rpath-link,' + str(libs)]
    for name in ['TKFillet', 'TKOffset', 'TKBool', 'TKBO', 'TKShHealing', 'TKTopAlgo', 'TKPrim',
                 'TKBRep', 'TKGeomAlgo', 'TKGeomBase', 'TKG3d', 'TKG2d', 'TKMath', 'TKernel']:
        matches = list(libs.glob('lib' + name + '-*.so*'))
        if len(matches) != 1:
            raise RuntimeError(f'Expected exactly one pinned {name} library, found {matches}')
        command.append(str(matches[0]))
    subprocess.run(command, cwd=ROOT, check=True)
    print('Experimental worker built. NOT enabled automatically.')
    print(f'export SOLIDARC_OCCT_BLEND_HOST="{CACHE / "BlendHost"}"')


if __name__ == '__main__':
    main()
