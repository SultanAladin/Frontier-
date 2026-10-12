#!/usr/bin/env python3
"""Differentiate recorded co-material particle coordinates independently of particle/endpoint-rim velocity timing."""
from pathlib import Path
import argparse
import csv
import hashlib
import json
import struct
import sys

Root = Path(__file__).resolve().parents[2]
LocalPython = Root / "_AgentScratch/tmp/python-tools"
if LocalPython.exists():
    sys.path.insert(0, str(LocalPython))
import numpy as Numpy


def Validate(Folder):
    SourceProof = json.loads((Folder / "SourceProof.json").read_text())
    Cases = json.loads((Folder / "FlightAudit.json").read_text())["cases"]
    Measurements = []
    for Case in Cases:
        if not Case["name"].startswith("air-"):
            continue
        File = Folder / (Case["name"] + ".frames"); Contents = File.read_bytes()
        Digest = hashlib.sha256(Contents).hexdigest()
        assert Digest == SourceProof["outputs"][File.name], "Recorded positions changed"
        Magic, Rings, Segments, Frames = struct.unpack("<4I", Contents[:16]); assert Magic == 0x54554D42 and Frames == 120
        Count = Rings * Segments
        Snapshots = Numpy.frombuffer(Contents[16:], dtype="<f4").reshape(Frames, 7 + 4 * (7 + Count * 3))
        MaterialPositions = []
        for Corner in range(4):
            Offset = 7 + Corner * (7 + Count * 3)
            Centre = Snapshots[:, Offset:Offset + 3].astype(Numpy.float64)
            Rotation = Snapshots[:, Offset + 3:Offset + 7].astype(Numpy.float64); Rotation /= Numpy.linalg.norm(Rotation, axis=1)[:, None]
            Relative = Snapshots[:, Offset + 7:Offset + 7 + Count * 3].reshape(Frames, Count, 3) - Centre[:, None, :]
            Axis = Rotation[:, :3][:, None, :]; Scalar = Rotation[:, 3:4][:, None, :]; Cross = Numpy.cross(Axis, Relative)
            MaterialPositions.append(Relative - 2 * Scalar * Cross + 2 * Numpy.cross(Axis, Cross))
        Coordinates = Numpy.concatenate(MaterialPositions, axis=1)
        ShapeRate = Numpy.diff(Coordinates, axis=0) / 0.05; Times = (Numpy.arange(Frames - 1) + 2) * 0.05
        Rms = Numpy.sqrt(Numpy.mean(Numpy.sum(ShapeRate * ShapeRate, axis=2), axis=1)); Late = Rms[Times >= 1.0]
        with (Folder / (Case["name"] + ".csv")).open() as Stream:
            Readings = [Reading for Reading in csv.DictReader(Stream) if float(Reading["t"]) >= 1.0]
        Peak = float(Late.max())
        Measurements.append({"case": Case["name"], "passed": Peak <= 0.01, "positionDerivativeRmsPeakMPerS": Peak,
            "positionDerivativeRmsMeanMPerS": float(Late.mean()),
            "lateParticleVelocityMinusEndpointRimRmsMeanMPerS": sum(float(Reading["relative_speed_rms"]) for Reading in Readings) / len(Readings),
            "recordingSHA256": Digest})
    assert len(Measurements) == 26
    Proof = {"passed": all(Measurement["passed"] for Measurement in Measurements), "cpuOnly": True,
        "sourceSHA256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "cases": Measurements, "cadenceHz": 20,
        "equilibrationExcludedS": 1, "shapeRateRmsLimitMPerS": 0.01,
        "method": "Differentiate every recorded particle after removing its solved material pose; no interpolation or clipping.",
        "limitations": ["20 Hz derivatives cannot exclude above-Nyquist oscillation.", "Raw particle/endpoint-rim velocity timing remains separate.",
            "Small positional wobble does not establish exact conservation or universal stability."]}
    (Folder / "FlightDeformationProof.json").write_text(json.dumps(Proof, indent=2) + "\n")
    print(f"Position-derived shape-rate bound: {sum(Measurement['passed'] for Measurement in Measurements)}/26 pass")
    print(f"Maximum late RMS shape rate: {max(Measurement['positionDerivativeRmsPeakMPerS'] for Measurement in Measurements):.6f} m/s")
    return Proof["passed"]


if __name__ == "__main__":
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--output", type=Path, default=Root / "_AgentScratch/tmp/DriveFlightAfter")
    Arguments = Parser.parse_args(); sys.exit(0 if Validate(Arguments.output.resolve()) else 1)
