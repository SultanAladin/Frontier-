#!/usr/bin/env python3
"""Build and run the reproducible gas reading checks, then record the executed commands and hashes.

    python3 Exhibits/Workbench/GasFluid/RunNativeGasFieldChecks.py

Dependency-free: the whole of Engine/VolumetricDynamics is header-only and pulls in nothing but WindField.h,
which is itself header-only. No ImGui, no window, no Vulkan, no bootstrap. Captures land in
Exhibits/Gallery/GasField.

The run is executed twice into separate build directories and the two transcripts are compared, because the
headline claim of CoarseGasField.h is that the reading is reproducible. A check that only ever runs once
cannot observe that.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

Root = Path(__file__).resolve().parents[3]
Build = Root / '.cache/gasbuild'
Gallery = Root / 'Exhibits/Gallery/GasField'
Build.mkdir(parents=True, exist_ok=True)
Gallery.mkdir(parents=True, exist_ok=True)

Include = ['-IEngine/VolumetricDynamics', '-IEngine/DisplayPresentation']
Flags = ['-std=c++20', '-O1', '-Wall', '-Wextra', '-Wno-unused-parameter']
Source = 'Exhibits/Workbench/GasFluid/NativeGasFieldChecks.cpp'

Commands, Transcripts = [], []
for Attempt in ('First', 'Second'):
    Program = Build / f'GasFieldChecks{Attempt}'
    Command = ['g++', *Flags, *Include, Source, '-o', str(Program)]
    subprocess.run(Command, cwd=Root, check=True)
    Commands.append(Command)

    Result = subprocess.run([str(Program)], cwd=Root, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    Transcripts.append(Result.stdout)
    if Attempt == 'First':
        print(Result.stdout, end='')
    assert Result.returncode == 0, f'gas field checks failed on the {Attempt.lower()} run'

# The reproducibility claim, observed across two separate builds rather than merely asserted inside one.
assert Transcripts[0] == Transcripts[1], 'two runs of the gas field checks disagreed'
print('Two independent builds produced identical transcripts.')

(Gallery / 'Proof.txt').write_text(Transcripts[0] + 'Two independent builds produced identical transcripts.\n')

Tracked = [Root / 'Engine/VolumetricDynamics/GasQualityAllowance.h',
           Root / 'Engine/VolumetricDynamics/CoarseGasField.h',
           Root / 'Engine/VolumetricDynamics/GasCollisionIntake.h',
           Root / 'Engine/VolumetricDynamics/GasWindContribution.h',
           Root / Source,
           Path(__file__)]
(Gallery / 'Commands.json').write_text(json.dumps(Commands, indent=2) + '\n')
(Gallery / 'Hashes.json').write_text(json.dumps(
    {str(Entry.relative_to(Root)): hashlib.sha256(Entry.read_bytes()).hexdigest() for Entry in Tracked},
    indent=2) + '\n')
sys.exit(0)
