#!/usr/bin/env python3
"""Build native tyre/smoke proofs with the shared Drive roster; MSVC /MD and GCC/Clang routes, no window/GPU claim."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import sys
from DependencyCodec import RestoreVulkanHeaders

Root = Path(__file__).resolve().parents[2]


def Fingerprint(Files):
    return {str(File.relative_to(Root)): hashlib.sha256(File.read_bytes()).hexdigest() for File in sorted(Files)}


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--compiler", default=os.environ.get("CXX", "cl.exe" if sys.platform == "win32" else "g++"))
    Parser.add_argument("--output", type=Path, default=Root / "_AgentScratch/tmp/SmokeSequence/Native")
    Parser.add_argument("--sanitize", action="store_true")
    Arguments = Parser.parse_args()
    Windows = sys.platform == "win32"
    if Windows and Arguments.sanitize:
        Parser.error("ASan/UBSan proof requires GCC/Clang; MSVC verification is a separate route")
    Folder = Arguments.output.resolve()
    Build = Root / "_AgentScratch/build/SmokeSequence"
    Folder.mkdir(parents=True, exist_ok=True)
    Build.mkdir(parents=True, exist_ok=True)
    Roster = json.loads((Root / "Projects/Project-Drive/Build/DriveSimulationSources.json").read_text())["sources"]
    NativeSources = ["VisualProof/SmokeSequence/SmokeMetrics.cpp", "VisualProof/SmokeSequence/VehicleMetrics.cpp"]
    Files = {Root / Source for Source in Roster + NativeSources}
    for Prefix in ["Engine/PhysicalDynamics/Vehicle", "Engine/VolumetricDynamics", "Projects/Project-Drive/Source"]:
        Files.update(File for File in (Root / Prefix).rglob("*") if File.suffix in [".h", ".inl"])
    Files.update(Root / Name for Name in ["Engine/Host/SmokeSequence.h", "Engine/Host/FrontierRuntime.cpp",
        "Engine/ProjectInterchange/CodeInterchange.h", "Engine/ProjectInterchange/CodeInterchange.cpp",
        "Engine/ProjectInterchange/SmokeInterchange.h", "Tools/Tests/CheckDriveSmoke.py"])
    Initial = Fingerprint(Files)
    Includes = [Root / "Engine", RestoreVulkanHeaders()]
    Flags = ["/nologo", "/std:c++20", "/EHsc", "/utf-8", "/O2", "/MD", "/UNDEBUG", "/DNOMINMAX"] if Windows else [
        "-std=c++20", "-O2", "-UNDEBUG", "-ffunction-sections", "-fdata-sections"]
    if Arguments.sanitize:
        Flags = ["-std=c++20", "-O1", "-g", "-UNDEBUG", "-fsanitize=address,undefined", "-fno-omit-frame-pointer"]
    Flags += [("/I" if Windows else "-I") + str(Include) for Include in Includes]
    Commands = []
    Environment = dict(os.environ, ASAN_OPTIONS="detect_leaks=1:halt_on_error=1", UBSAN_OPTIONS="halt_on_error=1")
    for Name, Sources, RunArguments in [
        ("SmokeMetrics", [NativeSources[0], "Engine/PhysicalDynamics/Vehicle/XPBDSoftTyre.cpp"], []),
        ("VehicleMetrics", Roster + [NativeSources[1]], [str(Folder)])
    ]:
        Executable = Build / (Name + (".exe" if Windows else ""))
        Output = [f"/Fe:{Executable}"] if Windows else ["-o", str(Executable)]
        Command = [Arguments.compiler, *Flags, *(str(Root / Source) for Source in Sources), *Output]
        if not Windows and not Arguments.sanitize:
            Command.append("-Wl,--gc-sections")
        print("Compile native", Name, flush=True)
        subprocess.run(Command, cwd=Build, check=True)
        Invocation = [str(Executable), *RunArguments]
        with (Folder / (Name + ".log")).open("w") as Log:
            Completed = subprocess.run(Invocation, cwd=Root, env=Environment, stdout=Log, stderr=subprocess.STDOUT)
        print((Folder / (Name + ".log")).read_text(), end="", flush=True)
        Completed.check_returncode()
        Commands.extend([Command, Invocation])
    assert Fingerprint(Files) == Initial, "Source changed during the native recording"
    Proof = {"recordedDate": "2026-10-12", "passed": True, "cpuOnly": True, "gpuExecution": False,
        "windowsExecution": Windows, "sanitized": Arguments.sanitize, "physicsRateHz": 240,
        "gasRateHz": 60, "captureRateHz": 20, "captureSeconds": 6, "commands": Commands,
        "sourceSHA256": Initial, "outputs": Fingerprint(set(Folder.glob("*.csv")) | set(Folder.glob("*.smoke")) | set(Folder.glob("*.log"))),
        "motion": "1.5 s settle; velocity/yaw initial condition seeded once; 6 s unconstrained mechanical integration. Steering input only in turning case. No frame-by-frame position/velocity commands.",
        "ignition": "Only diagnostic-ignition overrides tread heat capacity and sustained ignition/exposure thresholds. Other fixtures use runtime thresholds.",
        "publication": "Actual Drive C callback and host-owned CPU snapshot copies. Fine GPU residency/depth-aware viewport composition not executed or completed."}
    (Folder / "SmokeSourceProof.json").write_text(json.dumps(Proof, indent=2) + "\n")
    print("PASS native thermal/smoke and lifecycle evidence:", Folder)


if __name__ == "__main__":
    Main()
