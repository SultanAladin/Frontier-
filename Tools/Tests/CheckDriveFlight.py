#!/usr/bin/env python3
"""Compile production Drive sources and measure actual ramp flips, signed spins, landings and brake/friction inclines."""
from pathlib import Path
import argparse
import concurrent.futures
import csv
import hashlib
import json
import math
import os
import platform
import shutil
import subprocess
import sys
from DependencyCodec import RestoreVulkanHeaders

Root = Path(__file__).resolve().parents[2]
ValidatorSHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def Validate(Output, Complete=True):
    Cases = json.loads((Output / "FlightResults.json").read_text())["cases"]
    assert Cases, "No recorded scenarios matched the selection"
    Violations = []
    for Case in Cases:
        Name = Case["name"]
        Budget = max(100.0, 0.001 * Case["initialAvailableJ"])
        Checks = {
            "mechanicalEnergyBound": Case["peakIncreaseJ"] <= Budget,
            "disconnectedDrive": abs(Case["driveWorkJ"]) < 0.001,
            "contactPassivity": Case["peakContactPowerW"] <= 1.0 and Case["peakStaticContactPowerW"] <= 1.0,
            "radiusBound": Case["radiusM"] <= 0.50855 * 1.05,
            "widthBound": Case["halfWidthM"] <= 0.19790 * 1.10,
            "airDeformationBound": Case["airShapeMaxM"] <= 0.035,
        }
        with (Output / (Name + ".csv")).open() as Stream:
            Rows = list(csv.DictReader(Stream))
        if Name.startswith("air-"):
            Checks["isolatedFreeFlight"] = Case["contacts"] == 0
            if Complete:
                Checks["sixSecondsOfFreeFlight"] = Case["longestAirS"] >= 5.99
                Late = [Row for Row in Rows if float(Row["t"]) >= 1.0]
                First = [float(Row["shape_rms_m"]) for Row in Late if float(Row["t"]) <= 3.0]
                Final = [float(Row["shape_rms_m"]) for Row in Late if float(Row["t"]) >= 4.0]
                Case["lateShapeRmsMaximumM"] = max(float(Row["shape_rms_m"]) for Row in Late)
                Case["lateShapeRmsRangeM"] = Case["lateShapeRmsMaximumM"] - min(float(Row["shape_rms_m"]) for Row in Late)
                Case["lateRelativeSpeedRmsMean"] = sum(float(Row["relative_speed_rms"]) for Row in Late) / len(Late)
                Checks["noGrowingAirDeformation"] = Case["lateShapeRmsMaximumM"] < 0.015 and max(Final) <= max(First) + 0.005
        if Complete and Name.startswith("launch-"):
            Checks["twoWheelRampStrike"] = Case["rampWheelMask"] in [5, 10]
            Checks["actualAirborneInversion"] = Case["longestAirS"] > 0.25 and Case["primaryFlightMinimumUpZ"] < 0.0
            Checks["upwardLaunch"] = Case["peakVerticalSpeed"] > 2.0
            Checks["landingRecorded"] = Case["contacts"] > 0
        if Complete and Name.startswith("landing-"):
            Checks["flightAndLanding"] = Case["longestAirS"] > 1.0 and Case["contacts"] > 0
        if Complete and Case["terrain"] == 3:
            CrossSlope = abs(Case["headingDegrees"]) == 90.0
            EnoughGrip = Case["friction"] > math.tan(math.radians(Case["inclineDegrees"]))
            HoldExpected = EnoughGrip and (CrossSlope or Case["brakes"] == 1 or
                (Case["brakes"] == 2 and (Case["inclineDegrees"] == 10 or Case["headingDegrees"] == 0)))
            Case["holdExpected"] = HoldExpected
            if HoldExpected:
                Checks["parkedWithoutCreep"] = Case["parkingDriftM"] <= 0.01 and Case["parkingSpeed"] < 0.01
            else:
                Checks["physicalDownhillMotion"] = Case["parkingDriftM"] > 0.05 and Case["finalSpeed"] > 0.01
        Case["energyBudgetJ"] = Budget
        Case["checks"] = Checks
        Case["passed"] = all(Checks.values())
        Violations += [{"case": Name, "check": Check} for Check, Passed in Checks.items() if not Passed]
    Audit = {"passed": not Violations, "cpuOnly": True, "cases": Cases, "violations": Violations,
        "energyAccountClosed": False, "completeDuration": Complete, "validatorSHA256": ValidatorSHA256,
        "energyIncludes": ["sprung body", "every particle", "rim translation and absolute axial spin", "initial-referenced gravity",
            "spoke/shear/lattice elasticity", "endpoint gas potential", "floored/preloaded springs and anti-roll springs",
            "bump/rim stops", "ground compliance", "active bristles"],
        "limitations": ["Partitioned hub/body/strut timing and work are not a closed coupled solve.",
            "Rim transverse inertia and drivetrain internals are not solved state; drive mounts are disconnected.",
            "Necessary bounds do not prove exact conservation, universal stability or GPU validation."],
        "parkingWindow": "Exclude first 2 s; limit tangent drift to 10 mm and tangent speed to 10 mm/s. Normal settling is separate.",
        "deformationBounds": "5% radial / 10% width growth, 35 mm air node offset; late RMS <15 mm and final-window growth <=5 mm. No simulation clamps."}
    (Output / "FlightAudit.json").write_text(json.dumps(Audit, indent=2) + "\n")
    print(f"Measured {len(Cases)} cases: {sum(Case['passed'] for Case in Cases)} pass, {len(Violations)} failed checks", flush=True)
    for Failure in Violations:
        print("FAIL", Failure["case"], Failure["check"], flush=True)
    return not Violations


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--compiler", default=os.environ.get("CXX", "cl.exe" if sys.platform == "win32" else "g++"))
    Parser.add_argument("--jobs", type=int, default=2, choices=range(1, 5))
    Parser.add_argument("--output", type=Path, default=Root / "_AgentScratch/tmp/DriveFlightAfter")
    Parser.add_argument("--selection", default="all")
    Parser.add_argument("--duration", type=float, default=0)
    Parser.add_argument("--before", action="store_true")
    Parser.add_argument("--validate-only", action="store_true")
    Parser.add_argument("--sanitize", action="store_true")
    Arguments = Parser.parse_args()
    Output = Arguments.output.resolve()
    if Arguments.validate_only:
        Proof = json.loads((Output / "SourceProof.json").read_text())
        return 0 if Validate(Output, not Proof["shortened"]) else 1
    assert Arguments.duration == 0 or Arguments.duration >= 0.1
    Output.mkdir(parents=True, exist_ok=True)
    Scratch = Root / "_AgentScratch/build" / ("DriveFlightSanitized" if Arguments.sanitize else "DriveFlight")
    Scratch.mkdir(parents=True, exist_ok=True)
    Windows = sys.platform == "win32"
    Sources = [Source for Source in json.loads((Root / "Projects/Project-Drive/Build/DriveSimulationSources.json").read_text())["sources"] if not Source.endswith("ProjectDriveInterchange.cpp")]
    Sources += ["Exhibits/Workbench/Automotive/FlightMetrics.cpp"]
    Headers = sorted(File for Folder in ["Engine/PhysicalDynamics/Vehicle", "Projects/Project-Drive/Source", "Exhibits/Workbench/Automotive"] for File in (Root / Folder).rglob("*") if File.suffix in [".h", ".inl"])
    Files = [Root / Source for Source in Sources] + Headers

    def Fingerprint():
        return {str(File.relative_to(Root)): hashlib.sha256(File.read_bytes()).hexdigest() for File in Files}

    Initial = Fingerprint()
    Executable = Scratch / ("FlightMetrics.exe" if Windows else "FlightMetrics")
    Flags = ["/nologo", "/std:c++20", "/EHsc", "/utf-8", "/O2", "/UNDEBUG", "/DNOMINMAX", "/MD"] if Windows else ["-std=c++20", "-O2", "-UNDEBUG"]
    if Arguments.sanitize:
        assert not Windows
        Flags = ["-std=c++20", "-O1", "-g", "-UNDEBUG", "-fsanitize=address,undefined", "-fno-omit-frame-pointer"]
    Flags += [("/I" if Windows else "-I") + str(Folder) for Folder in [Root / "Engine", RestoreVulkanHeaders()]]
    Command = [Arguments.compiler, *Flags, *(str(Root / Source) for Source in Sources)]
    Command += [f"/Fe:{Executable}"] if Windows else ["-o", str(Executable)]
    print("Compile actual production vehicle/body sources and flight measurements", flush=True)
    subprocess.run(Command, cwd=Scratch, check=True)
    Environment = dict(os.environ, ASAN_OPTIONS="detect_leaks=1:halt_on_error=1", UBSAN_OPTIONS="halt_on_error=1")

    def Execute(Shard):
        Folder = Output / f"shard-{Shard}"; Folder.mkdir(exist_ok=True)
        Invocation = [str(Executable), str(Folder), str(Shard), str(Arguments.jobs), Arguments.selection, str(Arguments.duration), "before" if Arguments.before else "after"]
        with (Output / f"Shard-{Shard}.log").open("w") as Stream:
            subprocess.run(Invocation, cwd=Root, env=Environment, stdout=Stream, stderr=subprocess.STDOUT, check=True)
        print(f"Recorded shard {Shard + 1}/{Arguments.jobs}", flush=True)
        return Folder, Invocation

    with concurrent.futures.ThreadPoolExecutor(max_workers=Arguments.jobs) as Executor:
        Runs = list(Executor.map(Execute, range(Arguments.jobs)))
    Results = {"cpuOnly": True, "rateHz": 240, "snapshotRateHz": 20, "cases": []}
    Commands = [Command]
    for Folder, Invocation in Runs:
        Commands.append(Invocation)
        Results["cases"] += json.loads((Folder / "FlightResults.json").read_text())["cases"]
        for Pattern in ["*.csv", "*.frames", "*.terrain"]:
            for File in Folder.glob(Pattern):
                shutil.move(File, Output / File.name)
        shutil.rmtree(Folder)
    assert Fingerprint() == Initial, "Source changed during recording: refuse mixed-source proof"
    assert Results["cases"], "No matching scenarios"
    if Arguments.selection == "all":
        assert len(Results["cases"]) == 68
    (Output / "FlightResults.json").write_text(json.dumps(Results, indent=2) + "\n")
    Proof = {"commands": Commands, "sourceSHA256": Initial, "platform": platform.platform(), "compiler": Arguments.compiler,
        "gpuExecution": False, "windowsExecution": Windows, "sanitized": Arguments.sanitize,
        "shortened": Arguments.duration > 0, "reconstructionStart": Arguments.before,
        "snapshotsAreActualMotion": True, "snapshotRateHz": 20,
        "outputs": {File.name: hashlib.sha256(File.read_bytes()).hexdigest() for File in sorted(Output.iterdir()) if File.suffix in [".csv", ".frames", ".terrain"]}}
    (Output / "SourceProof.json").write_text(json.dumps(Proof, indent=2) + "\n")
    return 0 if Validate(Output, Arguments.duration == 0) else 1


if __name__ == "__main__":
    sys.exit(Main())
