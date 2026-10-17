"""Prepare pinned Linux ANGLE/SwiftShader libraries for reproducible native GPU-ID proofs.
Does not install drivers globally or add downloaded binaries to Git. Requires npm/node.
A machine's own EGL/GLES3 libraries can be used instead via SOLIDARC_GPU_PICKING_LIBRARY_DIR.
"""
from pathlib import Path
import subprocess
import tarfile

root = Path(__file__).resolve().parents[2]
cache = root / '.cache/native-gpu'
cache.mkdir(parents=True, exist_ok=True)
subprocess.run(['npm', 'install', '--prefix', str(cache), '--save-exact',
                '--no-audit', '--no-fund', '@sparticuz/chromium@131.0.1'], check=True)
compressed = cache / 'node_modules/@sparticuz/chromium/bin/swiftshader.tar.br'
archive = cache / 'swiftshader.tar'
with archive.open('wb') as output:
    subprocess.run(['node', '-e', "process.stdout.write(require('node:zlib').brotliDecompressSync(require('node:fs').readFileSync(process.argv[1])))", str(compressed)], stdout=output, check=True)
libraries = cache / 'lib'
libraries.mkdir(exist_ok=True)
with tarfile.open(archive) as package:
    # Extract only regular flat files; portable to Python versions predating tar filters.
    for member in package.getmembers():
        if not member.isfile() or Path(member.name).name != member.name:
            raise RuntimeError('Unexpected archive entry: ' + member.name)
        target = libraries / member.name
        data = package.extractfile(member).read()
        if not target.exists() or target.read_bytes() != data:
            temporary = target.with_suffix(target.suffix + '.new')
            temporary.write_bytes(data)
            temporary.replace(target)
for name in ['libEGL.so', 'libGLESv2.so']:
    if not (libraries / name).exists():
        raise RuntimeError('Missing ' + name)
print('SOLIDARC_GPU_PICKING_LIBRARY_DIR=' + str(libraries))
print('Driver: ANGLE/SwiftShader (software, not physical GPU). Native visible color remains CPU reference.')
