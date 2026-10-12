#!/usr/bin/env python3
"""Audit real powered approaches, moving brakes, signed slope travel and bead-to-rim alignment."""
from pathlib import Path
import argparse
import concurrent.futures
import csv
import hashlib
import json
import math
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
            "noIdleDriveFightingBrakes": max((abs(float(Row["gearbox_drive_torque_Nm"])) for Row in Rows if Row["phase"] == "2" and (float(Row["brake"]) > 0 or Row["handbrake"] == "1")), default=0.0) <= 0.001,
            "nativeBeadSeated": Case["nativeBeadGapM"] <= 0.00001,
            "physicalBeadMatchesRim": Case["physicalBeadGapM"] <= 0.00001,
            "nativeEnvelopeMatchesSolvedTread": Case.get("nativeTreadGapM", math.inf) <= 0.00001,
            "discTorqueWithinCapacity": Case.get("brakeOverCapacityNm", math.inf) <= 0.01,
            "groundForceWithinFrictionCone": Case.get("gripOverCapacityN", math.inf) <= 0.05,
            "coupledContactConverged": Case.get("unconvergedContactSteps", 1) == 0,
            "heightDecomposition": max(abs(float(Row["z"]) - float(Rows[0]["z"]) - float(Row["vertical_from_uphill_m"]) - float(Row["vertical_from_normal_m"])) for Row in Rows) <= 0.00002,
            "radialExpansionBound": Case["radiusM"] <= 0.50855 * 1.05,
        }
        if Case["driven"]:
            Checks["movingBeforeBrake"] = Case["brakeStartSpeed"] > 0.25
            if Case["brakes"] == 1:
                # The 35-degree control has little net braking margin after gravity. Extend recording, not a pose clamp.
                Angle = math.radians(Case["incline"])
                AlongGrade = abs(Case["heading"]) == 180
                NetDeceleration = 9.81 * (Case["friction"] * math.cos(Angle) - (math.sin(Angle) if AlongGrade else 0.0))
                StopAllowance = 3.5 if Case["incline"] <= 20 else 1.0 + 1.5 * Case["brakeStartSpeed"] / max(0.01, NetDeceleration)
                Case["physicalStopAllowanceS"] = StopAllowance
                Checks["serviceBrakeStopsAndHolds"] = 0 <= Case["stopTime"] < StopAllowance and Case["finalSpeed"] < 0.01
            if Case["brakes"] == 2 and Case["heading"] in [0, 90, -90]:
                Checks["rearBrakeStopsWhereCapacityAllows"] = 0 <= Case["stopTime"] < 3.5 and Case["finalSpeed"] < 0.01
            if Case["brakes"] == 1 or (Case["brakes"] == 2 and Case["heading"] in [0, 90, -90]):
                HoldRows = [Row for Row in Rows if float(Row["t"]) >= 3.5 + max(0, Case["stopTime"]) + 0.25]
                Checks["sustainedHoldAfterStop"] = Case["stopTime"] >= 0 and bool(HoldRows) and max(float(Row["tangent_speed"]) for Row in HoldRows) < 0.05
            if abs(Case["heading"]) == 90:
                Checks["noPropulsiveUphillCrossDrift"] = Case["driveUphillM"] <= 0.02
        else:
            Checks["gravityPointsDownhill"] = float(End["uphill_speed"]) < 0 and float(End["uphill_m"]) < 0
        Case["maximumContactStationarityM_S"] = max(float(Row["contact_stationarity_m_s"]) for Row in Rows)
        if Case["driven"] and Case["brakes"] == 2 and abs(Case["heading"]) == 180:
            TailRows = [Row for Row in Rows if float(Row["t"]) >= Case["seconds"] - 0.5]
            Case["rearOnlyGripN"] = Case["friction"] * sum(float(Row["normal_load_2_N"]) + float(Row["normal_load_3_N"]) for Row in TailRows) / len(TailRows)
            Case["nonContactGradeDemandN"] = sum(float(Row["static_uphill_force_N"]) - float(Row["body_uphill_force_N"]) for Row in TailRows) / len(TailRows)
            Case["downhillRearOnlyObservation"] = "stoppedAndHeld" if Case["stopTime"] >= 0 and Case["finalSpeed"] < 0.01 else "stillMovingAtRecordingEnd"
            if Case["downhillRearOnlyObservation"] == "stoppedAndHeld":
                HoldRows = [Row for Row in Rows if float(Row["t"]) >= 3.5 + Case["stopTime"] + 0.25]
                Checks["rearDownhillHoldAfterStop"] = bool(HoldRows) and max(float(Row["tangent_speed"]) for Row in HoldRows) < 0.05
        Case["checks"] = Checks
        Case["passed"] = all(Checks.values())
        Violations += [{"case": Case["name"], "check": Name} for Name, Passed in Checks.items() if not Passed]
    Audit = {"passed": not Violations, "cpuOnly": True, "cases": Cases, "violations": Violations,
        "validatorSHA256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "motion": "Warmup 0-1.5 s; actual rear-wheel drive 1.5-3.5 s; coast/service/rear brake from 3.5 s until the case-specific 7 or 19 s recording end. No velocity/orientation commands.",
        "slopeConvention": "Plane normal (-sin(theta),0,cos(theta)); world +X is uphill, -X downhill. Heading +/-90 is parallel to contours.",
        "limitations": "Disc work/sign and moving stopping tests, not a closed whole-vehicle energy proof. Rear-only holding capacity depends on axle load; preserve physical sliding.",
        "beadMeasurements": "Actual closed native envelope bead/tread vertices and actual pressure-surface seats, sampled at 20 Hz against the current rim pose. No projection-radius or velocity clamps.",
        "brakeMeasurements": "Each disc is checked independently for positive work and excess torque; complete contact force is checked against measured load and friction.",
        "recordedDate": "2026-10-12"}
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
