#!/usr/bin/env python3
"""Check 26 signed rigid rotations/native rims, then 14 core or all 68 production flight/contact scenarios."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import sys
from DependencyCodec import RestoreVulkanHeaders

Root = Path(__file__).resolve().parents[2]


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--compiler", default=os.environ.get("CXX", "cl.exe" if sys.platform == "win32" else "g++"))
    Parser.add_argument("--matrix", action="store_true")
    Parser.add_argument("--rigid-only", action="store_true")
    Parser.add_argument("--jobs", type=int, default=2)
    Parser.add_argument("--output", type=Path, default=Root / "_AgentScratch/tmp/DriveTumbleFinal")
    Arguments = Parser.parse_args()
    Scratch = Root / "_AgentScratch/build/DriveRigid"; Scratch.mkdir(parents=True, exist_ok=True)
    Arguments.output.mkdir(parents=True, exist_ok=True)
    Windows = sys.platform == "win32"
    Sources = [Source for Source in json.loads((Root / "Projects/Project-Drive/Build/DriveSimulationSources.json").read_text())["sources"] if not Source.endswith("ProjectDriveInterchange.cpp")]
    Sources += ["Exhibits/Workbench/Automotive/DriveTumbleProof.cpp"]
    Flags = ["/nologo", "/std:c++20", "/EHsc", "/utf-8", "/O2", "/MD", "/UNDEBUG", "/DNOMINMAX"] if Windows else ["-std=c++20", "-O2", "-UNDEBUG"]
    Flags += [("/I" if Windows else "-I") + str(Folder) for Folder in [Root / "Engine", RestoreVulkanHeaders()]]
    Executable = Scratch / ("DriveTumbleProof.exe" if Windows else "DriveTumbleProof")
    Command = [Arguments.compiler, *Flags, *(str(Root / Source) for Source in Sources)]
    Command += [f"/Fe:{Executable}"] if Windows else ["-o", str(Executable)]
    subprocess.run(Command, cwd=Scratch, check=True)
    subprocess.run([str(Executable), str(Arguments.output.resolve())], cwd=Root, check=True)
    Proof = {"command": Command, "cpuOnly": True, "sourceSHA256": {Source: hashlib.sha256((Root / Source).read_bytes()).hexdigest() for Source in Sources}}
    (Arguments.output / "RigidSourceProof.json").write_text(json.dumps(Proof, indent=2) + "\n")
    if Arguments.rigid_only:
        return 0
    return subprocess.run([sys.executable, str(Root / "Tools/Tests/CheckDriveFlight.py"), "--compiler", Arguments.compiler,
        "--jobs", str(Arguments.jobs), "--output", str(Arguments.output), "--selection", "all" if Arguments.matrix else "core"], cwd=Root).returncode


if __name__ == "__main__":
    sys.exit(Main())
