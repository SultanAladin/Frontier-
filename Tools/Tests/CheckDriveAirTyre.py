#!/usr/bin/env python3
"""Measure airborne tread/rim concentricity independently of bead seating, using the actual native tyre and vehicle."""
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
import struct
import sys
from DependencyCodec import RestoreVulkanHeaders

Root = Path(__file__).resolve().parents[2]
LocalPython = Root / "_AgentScratch/tmp/python-tools"
if LocalPython.exists():
    sys.path.insert(0, str(LocalPython))


def Hash(File):
    return hashlib.sha256(File.read_bytes()).hexdigest()



def MeasureCircles(File):
    import numpy as Numpy
    with File.open("rb") as Stream:
        Magic, Rings, Segments, Count = struct.unpack("4I", Stream.read(16))
        assert Magic == 0x54554D31
        Values = Numpy.frombuffer(Stream.read(), dtype=Numpy.float32).reshape(Count, 14 + Rings * Segments * 3)
    Hubs = Values[:, 7:10]
    Rotations = Values[:, 10:14]
    World = Values[:, 14:].reshape(Count, Rings, Segments, 3) - Hubs[:, None, None, :]
    Inverse = -Rotations[:, None, None, :3]
    Cross = Numpy.cross(Inverse, World)
    Local = World + 2 * (Rotations[:, None, None, 3:4] * Cross + Numpy.cross(Inverse, Cross))
    Centres = Local.mean(axis=2)
    Relative = Local - Centres[:, :, None, :]
    Radii = Numpy.hypot(Relative[:, :, :, 0], Relative[:, :, :, 2])
    Ranges = Numpy.ptp(Radii, axis=2).max(axis=1)
    CentreOffsets = Numpy.hypot(Centres[:, :, 0], Centres[:, :, 2]).max(axis=1)
    Times = (Numpy.arange(Count) + 1) / 20
    Late = Times >= 5.5
    return {"maximumRecordedRingCentreOffsetM": float(CentreOffsets.max()),
            "lateMaximumRecordedRingCentreOffsetM": float(CentreOffsets[Late].max()),
            "lateMaximumCircumferentialRangeM": float(Ranges[Late].max()),
            "measurementRateHz": 20}

def Validate(Folder):
    Cases = []
    NominalRadius = 0.50855
    for File in sorted(Folder.glob("*.csv")):
        with File.open() as Stream:
            Rows = list(csv.DictReader(Stream))
        assert Rows and all(math.isfinite(float(Value)) for Row in Rows for Value in Row.values())
        Late = [Row for Row in Rows if float(Row["t"]) >= 5.5]
        Early = [Row for Row in Rows if 1.0 <= float(Row["t"]) <= 3.0]
        Norm = lambda Row: math.sqrt(sum(float(Row["centre_" + Axis + "_m"]) ** 2 for Axis in ["x", "y", "z"]))
        Case = {"name": File.stem, "seconds": 6.0,
                "maximumCentreOffsetM": max(Norm(Row) for Row in Rows),
                "lateMeanCentreOffsetM": sum(Norm(Row) for Row in Late) / len(Late),
                "lateMeanWorldCentreZM": sum(float(Row["world_centre_z_m"]) for Row in Late) / len(Late),
                "lateMeanRadiusM": sum(float(Row["mean_radius_m"]) for Row in Late) / len(Late),
                "lateMeanInflationGrowthM": sum(float(Row["mean_radius_m"]) for Row in Late) / len(Late) - NominalRadius,
                "lateMaximumCentredRadiusRangeM": max(float(Row["centred_range_m"]) for Row in Late),
                "maximumShapeOffsetM": max(float(Row["shape_max_m"]) for Row in Rows),
                "initialShapeOffsetM": float(Rows[0]["shape_max_m"]),
                "maximumAirShapeOffsetM": max(float(Row["shape_max_m"]) for Row in Rows[1:]),
                "nativeBeadGapM": max(float(Row["native_bead_gap_m"]) for Row in Rows),
                "nativeTreadGapM": max(float(Row["native_tread_gap_m"]) for Row in Rows),
                "lateCentreOffsetRangeM": max(Norm(Row) for Row in Late) - min(Norm(Row) for Row in Late),
                "lateMeanPressurePa": sum(float(Row["pressure_Pa"]) for Row in Late) / len(Late)}
        Checks = {"actualAirborneAfterRelease": max(float(Row["contacts"]) for Row in Rows[1:]) == 0,
                  "nativeBeadSeated": Case["nativeBeadGapM"] < 0.00001,
                  "nativeMatchesSolvedTread": Case["nativeTreadGapM"] < 0.00002,
                  "boundedAirDeformation": Case["maximumAirShapeOffsetM"] < 0.035,
                  "noGrowingCentreOffset": max(Norm(Row) for Row in Late) <= max(Norm(Row) for Row in Early) + 0.005}
        Case.update(MeasureCircles(File.with_suffix(".frames")))
        Case["checks"] = Checks
        Case["passed"] = all(Checks.values())
        Cases.append(Case)
        print(f"{File.stem}: settled centre {Case['lateMeanCentreOffsetM']*1000:.4f} mm, world-Z {Case['lateMeanWorldCentreZM']*1000:+.4f} mm, mean inflation growth {Case['lateMeanInflationGrowthM']*1000:.3f} mm", flush=True)
    assert len(Cases) == 7
    Audit = {"passed": all(Case["passed"] for Case in Cases), "recordedDate": "2026-10-12", "cases": Cases,
             "measurement": "Centre is the mean of all actual tread particles relative to the rigid rim in material space. Radius growth is measured separately. Bead and native tread projection checks do not substitute for concentricity.",
             "conditions": "Production dimensions/compliances/pressure and native XPBD solver. Isolated hub held or prescribed ballistic, optional prescribed 80 rad/s axle spin. Unload-held begins after 1.5 s of ground compression. Vehicle cases use the actual chassis/suspension/tyre integration in gravity, without ground, drive or chassis damping.",
             "limitations": "A fixed hub is a suspended wheel, not a freefalling car. Prescribed constant-spin hubs can supply work; no closed energy claim is made for them. The loaded initial sample is not classified as airborne; the unchanged 35 mm air-deformation bound starts after release. Circumferential range is measured within each ring, separately from the crown across the tyre width. No rigidification, radius/velocity clamp, pose pin or extra tyre damping is introduced.",
             "validatorSHA256": Hash(Path(__file__))}
    (Folder / "AirTyreAudit.json").write_text(json.dumps(Audit, indent=2) + "\n")
    print(f"Air tyre native geometry/deformation checks: {sum(Case['passed'] for Case in Cases)}/7 pass", flush=True)
    return Audit["passed"]


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--compiler", default=os.environ.get("CXX", "cl.exe" if sys.platform == "win32" else "g++"))
    Parser.add_argument("--output", type=Path, default=Root / "_AgentScratch/tmp/DriveAirTyre")
    Parser.add_argument("--jobs", type=int, default=2, choices=range(1, 5))
    Parser.add_argument("--validate-only", action="store_true")
    Arguments = Parser.parse_args()
    Folder = Arguments.output.resolve()
    if Arguments.validate_only:
        return 0 if Validate(Folder) else 1
    Folder.mkdir(parents=True, exist_ok=True)
    Build = Root / "_AgentScratch/build/DriveAirTyre"
    Build.mkdir(parents=True, exist_ok=True)
    Sources = [Source for Source in json.loads((Root / "Projects/Project-Drive/Build/DriveSimulationSources.json").read_text())["sources"] if not Source.endswith("ProjectDriveInterchange.cpp")]
    Sources += ["Exhibits/Workbench/Automotive/AirTyreMetrics.cpp"]
    Headers = sorted(File for Prefix in ["Engine/PhysicalDynamics/Vehicle", "Projects/Project-Drive/Source", "Exhibits/Workbench/Automotive"] for File in (Root / Prefix).rglob("*") if File.suffix in [".h", ".inl"])
    Files = [Root / Source for Source in Sources] + Headers
    Fingerprint = lambda: {str(File.relative_to(Root)): Hash(File) for File in Files}
    Initial = Fingerprint()
    Windows = sys.platform == "win32"
    Flags = ["/nologo", "/std:c++20", "/EHsc", "/utf-8", "/O2", "/MD", "/UNDEBUG", "/DNOMINMAX"] if Windows else ["-std=c++20", "-O2", "-UNDEBUG"]
    Flags += [("/I" if Windows else "-I") + str(Prefix) for Prefix in [Root / "Engine", RestoreVulkanHeaders()]]
    Executable = Build / ("AirTyreMetrics.exe" if Windows else "AirTyreMetrics")
    Command = [Arguments.compiler, *Flags, *(str(Root / Source) for Source in Sources)]
    Command += [f"/Fe:{Executable}"] if Windows else ["-o", str(Executable)]
    print("Compile native airborne tyre/vehicle recorder", flush=True)
    subprocess.run(Command, cwd=Build, check=True)

    def Record(Shard):
        Destination = Folder / f"shard-{Shard}"
        Destination.mkdir(exist_ok=True)
        Invocation = [str(Executable), str(Destination), str(Shard), str(Arguments.jobs)]
        with (Folder / f"Shard-{Shard}.log").open("w") as Stream:
            subprocess.run(Invocation, cwd=Root, stdout=Stream, stderr=subprocess.STDOUT, check=True)
        return Destination, Invocation

    with concurrent.futures.ThreadPoolExecutor(max_workers=Arguments.jobs) as Executor:
        Runs = list(Executor.map(Record, range(Arguments.jobs)))
    Commands = [Command]
    for Destination, Invocation in Runs:
        Commands.append(Invocation)
        for Pattern in ["*.csv", "*.frames", "*.terrain"]:
            for File in Destination.glob(Pattern):
                shutil.move(File, Folder / File.name)
        shutil.rmtree(Destination)
    assert Fingerprint() == Initial, "Refuse recordings mixed with source edits"
    Proof = {"commands": Commands, "sourceSHA256": Initial, "singleActualWheelPerRecording": True,
             "snapshotRateHz": 20, "simulationRateHz": 240, "recordedDate": "2026-10-12",
             "outputs": {File.name: Hash(File) for File in Folder.iterdir() if File.suffix in [".csv", ".frames", ".terrain"]}}
    (Folder / "AirTyreSourceProof.json").write_text(json.dumps(Proof, indent=2) + "\n")
    return 0 if Validate(Folder) else 1


if __name__ == "__main__":
    sys.exit(Main())
