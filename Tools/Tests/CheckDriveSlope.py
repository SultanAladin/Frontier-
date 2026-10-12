#!/usr/bin/env python3
"""Audit real powered approaches, moving brakes, signed slope travel and bead-to-rim alignment."""
from pathlib import Path
import argparse
import concurrent.futures
import csv
import hashlib
import json
import os
import shutil
import subprocess
import sys
from DependencyCodec import RestoreVulkanHeaders

Root = Path(__file__).resolve().parents[2]


def Validate(Folder):
    Cases = json.loads((Folder / "SlopeResults.json").read_text())["cases"]
    assert Cases
    Violations = []
    for Case in Cases:
        with (Folder / (Case["name"] + ".csv")).open() as Stream:
            Rows = list(csv.DictReader(Stream))
        End = Rows[-1]
        Checks = {
            "brakeDissipation": Case["positiveBrakePowerW"] <= 1.0,
            "contactPassivity": Case["positiveContactPowerW"] <= 1.0,
            "nativeBeadSeated": Case["nativeBeadGapM"] <= 0.00001,
            "physicalBeadMatchesRim": Case["physicalBeadGapM"] <= 0.00001,
            "radialExpansionBound": Case["radiusM"] <= 0.50855 * 1.05,
        }
        if Case["driven"]:
            Checks["movingBeforeBrake"] = Case["brakeStartSpeed"] > 0.25
            if Case["brakes"] == 1:
                Checks["serviceBrakeStopsAndHolds"] = 0 <= Case["stopTime"] < 3.5 and Case["finalSpeed"] < 0.01
            if abs(Case["heading"]) == 90:
                Checks["noPropulsiveUphillCrossDrift"] = Case["driveUphillM"] <= 0.02
        else:
            Checks["gravityPointsDownhill"] = float(End["uphill_speed"]) < 0 and float(End["uphill_m"]) < 0
        Case["checks"] = Checks
        Case["passed"] = all(Checks.values())
        Violations += [{"case": Case["name"], "check": Name} for Name, Passed in Checks.items() if not Passed]
    Audit = {"passed": not Violations, "cpuOnly": True, "cases": Cases, "violations": Violations,
        "validatorSHA256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "motion": "Warmup 0-1.5 s; actual rear-wheel drive 1.5-3.5 s; coast/service/rear brake 3.5-7 s. No velocity/orientation commands.",
        "slopeConvention": "Plane normal (-sin(theta),0,cos(theta)); world +X is uphill, -X downhill. Heading +/-90 is parallel to contours.",
        "limitations": "Disc work/sign and moving stopping tests, not a closed whole-vehicle energy proof. Rear-only holding capacity depends on axle load; preserve physical sliding.",
        "beadMeasurements": "Native tyre inner boundary vs solved rim; separately gas/spoke anchor vs rim. No projection-radius or velocity clamps."}
    (Folder / "SlopeAudit.json").write_text(json.dumps(Audit, indent=2) + "\n")
    print(f"Slope/brake/bead audit: {sum(Case['passed'] for Case in Cases)}/{len(Cases)} pass, {len(Violations)} failed checks", flush=True)
    for Failure in Violations:
        print("FAIL", Failure["case"], Failure["check"], flush=True)
    return Audit["passed"]


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--compiler", default=os.environ.get("CXX", "cl.exe" if sys.platform == "win32" else "g++"))
    Parser.add_argument("--jobs", type=int, default=2, choices=range(1, 5))
    Parser.add_argument("--selection", default="all")
    Parser.add_argument("--output", type=Path, default=Root / "_AgentScratch/tmp/DriveSlopeAfter")
    Parser.add_argument("--validate-only", action="store_true")
    Parser.add_argument("--sanitize", action="store_true")
    Arguments = Parser.parse_args(); Folder = Arguments.output.resolve()
    if Arguments.validate_only:
        return 0 if Validate(Folder) else 1
    Folder.mkdir(parents=True, exist_ok=True)
    Build = Root / "_AgentScratch/build" / ("DriveSlopeSanitized" if Arguments.sanitize else "DriveSlope")
    Build.mkdir(parents=True, exist_ok=True)
    Sources = [Source for Source in json.loads((Root / "Projects/Project-Drive/Build/DriveSimulationSources.json").read_text())["sources"] if not Source.endswith("ProjectDriveInterchange.cpp")]
    Sources += ["Exhibits/Workbench/Automotive/SlopeMetrics.cpp"]
    Headers = sorted(File for Prefix in ["Engine/PhysicalDynamics/Vehicle", "Projects/Project-Drive/Source", "Exhibits/Workbench/Automotive"] for File in (Root / Prefix).rglob("*") if File.suffix in [".h", ".inl"])
    Files = [Root / Source for Source in Sources] + Headers

    def Fingerprint():
        return {str(File.relative_to(Root)): hashlib.sha256(File.read_bytes()).hexdigest() for File in Files}

    Initial = Fingerprint(); Windows = sys.platform == "win32"
    Flags = ["/nologo", "/std:c++20", "/EHsc", "/utf-8", "/O2", "/MD", "/UNDEBUG", "/DNOMINMAX"] if Windows else ["-std=c++20", "-O2", "-UNDEBUG"]
    if Arguments.sanitize:
        assert not Windows
        Flags = ["-std=c++20", "-O1", "-g", "-UNDEBUG", "-fsanitize=address,undefined", "-fno-omit-frame-pointer"]
    Flags += [("/I" if Windows else "-I") + str(Prefix) for Prefix in [Root / "Engine", RestoreVulkanHeaders()]]
    Executable = Build / ("SlopeMetrics.exe" if Windows else "SlopeMetrics")
    Command = [Arguments.compiler, *Flags, *(str(Root / Source) for Source in Sources)]
    Command += [f"/Fe:{Executable}"] if Windows else ["-o", str(Executable)]
    print("Compile actual production powered/brake slope recorder", flush=True)
    subprocess.run(Command, cwd=Build, check=True)

    def Record(Shard):
        Output = Folder / f"shard-{Shard}"; Output.mkdir(exist_ok=True)
        Invocation = [str(Executable), str(Output), str(Shard), str(Arguments.jobs), Arguments.selection]
        with (Folder / f"Shard-{Shard}.log").open("w") as Stream:
            subprocess.run(Invocation, cwd=Root, env=dict(os.environ, ASAN_OPTIONS="detect_leaks=1:halt_on_error=1", UBSAN_OPTIONS="halt_on_error=1"), stdout=Stream, stderr=subprocess.STDOUT, check=True)
        print("Recorded slope shard", Shard, flush=True)
        return Output, Invocation

    with concurrent.futures.ThreadPoolExecutor(max_workers=Arguments.jobs) as Executor:
        Runs = list(Executor.map(Record, range(Arguments.jobs)))
    Results = {"cpuOnly": True, "rateHz": 240, "snapshotRateHz": 20, "cases": []}; Commands = [Command]
    for Output, Invocation in Runs:
        Commands.append(Invocation); Results["cases"] += json.loads((Output / "SlopeResults.json").read_text())["cases"]
        for Pattern in ["*.csv", "*.frames", "*.terrain"]:
            for File in Output.glob(Pattern):
                shutil.move(File, Folder / File.name)
        shutil.rmtree(Output)
    assert Results["cases"] and Fingerprint() == Initial
    (Folder / "SlopeResults.json").write_text(json.dumps(Results, indent=2) + "\n")
    Proof = {"cpuOnly": True, "sanitized": Arguments.sanitize, "commands": Commands, "sourceSHA256": Initial,
        "outputs": {File.name: hashlib.sha256(File.read_bytes()).hexdigest() for File in Folder.iterdir() if File.suffix in [".csv", ".frames", ".terrain"]}}
    (Folder / "SlopeSourceProof.json").write_text(json.dumps(Proof, indent=2) + "\n")
    return 0 if Validate(Folder) else 1


if __name__ == "__main__":
    sys.exit(Main())
