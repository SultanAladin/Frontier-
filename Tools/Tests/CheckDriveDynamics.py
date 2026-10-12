#!/usr/bin/env python3
"""Compile actual Drive simulation/contact code and execute deterministic CPU regressions, optionally with sanitizers."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import sys

Root = Path(__file__).resolve().parents[2]
Parser = argparse.ArgumentParser(description=__doc__)
Parser.add_argument("--compiler", default=os.environ.get("CXX", "cl.exe" if sys.platform == "win32" else "g++"))
Parser.add_argument("--sanitize", action="store_true")
Parser.add_argument("--output", type=Path, default=Root / "_AgentScratch/tmp/DriveDynamicsTraces")
Arguments = Parser.parse_args()
Scratch = Root / "_AgentScratch/build/DriveDynamics"
Scratch.mkdir(parents=True, exist_ok=True)
Arguments.output.mkdir(parents=True, exist_ok=True)
Windows = sys.platform == "win32"
Includes = [Root / "Engine", Root / "ExternalPackages/vulkan-headers/include"]
Flags = (["/nologo", "/std:c++20", "/EHsc", "/utf-8", "/O2", "/UNDEBUG", "/DNOMINMAX", "/MD"] if Windows else
         ["-std=c++20", "-O2", "-UNDEBUG", "-ffunction-sections", "-fdata-sections"])
if Arguments.sanitize:
    if Windows:
        Parser.error("ASan+UBSan runner is available for GCC/Clang only; Windows execution remains separate")
    Flags = ["-std=c++20", "-O1", "-g", "-UNDEBUG", "-fsanitize=address,undefined", "-fno-omit-frame-pointer"]
Flags += [("/I" if Windows else "-I") + str(Folder) for Folder in Includes]
Sources = json.loads((Root / "Projects/Project-Drive/Build/DriveSimulationSources.json").read_text())["sources"]


def CompileAndRun(Name, Additions, RunArguments=()):
    Executable = Scratch / (Name + (".exe" if Windows else ""))
    Roster = [Source for Source in Sources if not Source.endswith("ProjectDriveInterchange.cpp")]
    if Name == "DriveInterchangeChecks":
        Roster = Sources
    Roster += Additions
    Output = [f"/Fe:{Executable}"] if Windows else ["-o", str(Executable)]
    Command = [Arguments.compiler, *Flags, *(str(Root / Source) for Source in Roster), *Output]
    print("Compiling", Name, flush=True)
    subprocess.run(Command, cwd=Scratch, check=True)
    Environment = dict(os.environ, ASAN_OPTIONS="detect_leaks=1:halt_on_error=1", UBSAN_OPTIONS="halt_on_error=1")
    subprocess.run([str(Executable), *map(str, RunArguments)], cwd=Root, env=Environment, check=True)
    return {"command": Command, "sources": {Source: hashlib.sha256((Root / Source).read_bytes()).hexdigest() for Source in Roster}}


Proof = CompileAndRun("DriveDynamicsProof", ["Exhibits/Workbench/Automotive/DriveDynamicsProof.cpp"], [Arguments.output.resolve()])
if not Arguments.sanitize:
    CompileAndRun("DriveInterchangeChecks", ["Projects/Project-Drive/Source/DriveInterchangeChecks.cpp"])
Proof["gpuExecution"] = False
Proof["windowsExecution"] = Windows
Proof["sanitized"] = Arguments.sanitize
Proof["traces"] = {File.name: hashlib.sha256(File.read_bytes()).hexdigest() for File in Arguments.output.glob("*.csv")}
(Arguments.output / "Proof.json").write_text(json.dumps(Proof, indent=2) + "\n")
print("PASS deterministic CPU vehicle/contact/possession checks; trace files:", Arguments.output)
