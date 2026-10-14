#!/usr/bin/env python3
"""Compare physical/native bead seats with the actual authored rigid rim triangle surface, not only a cylinder proxy."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import sys

Root = Path(__file__).resolve().parents[2]
LocalPython = Root / "_AgentScratch/tmp/python-tools"
if LocalPython.exists():
    sys.path.insert(0, str(LocalPython))
import numpy as Numpy


def ParseSequence(Contents, Name, Precision):
    Body = re.search(Name + r"\[\]\s*=\s*\{(.*?)\};", Contents, re.S).group(1)
    Numbers = re.findall(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?", Body)
    return Numpy.asarray([float(Number) for Number in Numbers], dtype=Precision)


def Measure(Folder):
    Asset = Root / "Projects/Project-Drive/Source/ControlVehicleWheelMesh.inl"
    Geometry = Root / "Engine/PhysicalDynamics/Vehicle/VehicleGeometry.h"
    Physical = Root / "Engine/PhysicalDynamics/Vehicle/RigidWheel.h"
    Contents = Asset.read_text()
    Radius = float(re.search(r"TyreRimRadius\s*=\s*([\d.]+)f", Geometry.read_text()).group(1))
    Width = float(re.search(r"TyreWidth\s*=\s*([\d.]+)f", Geometry.read_text()).group(1))
    Ratio = float(re.search(r"TyreBeadWidthRatio\s*=\s*([\d.]+)f", Physical.read_text()).group(1))
    AuthoredRadius = float(re.search(r"kRimRadius\s*=\s*([\d.]+)f", Contents).group(1))
    Points = ParseSequence(Contents, "kPositions", float).reshape(-1, 3) * (Radius / AuthoredRadius)
    Triangles = Points[ParseSequence(Contents, "kTriangles", int).reshape(-1, 3)]
    A, B, C = Triangles[:, 0], Triangles[:, 1], Triangles[:, 2]
    AB, AC = B - A, C - A
    Normals = Numpy.cross(AB, AC); NormSquared = Numpy.sum(Normals * Normals, axis=1)
    D00, D01, D11 = Numpy.sum(AB * AB, axis=1), Numpy.sum(AB * AC, axis=1), Numpy.sum(AC * AC, axis=1)
    Determinant = D00 * D11 - D01 * D01
    Readings = []
    for HalfWidth in [Width * 0.5, Width * 0.5 * Ratio]:
        Distances = []
        for Side in [-1, 1]:
            for Angle in Numpy.linspace(0, 2 * Numpy.pi, 128, endpoint=False):
                Point = Numpy.array([Radius * Numpy.cos(Angle), Side * HalfWidth, Radius * Numpy.sin(Angle)])
                Relative = Point - A; Projection = Numpy.sum(Relative * Normals, axis=1)
                SafeNorm = Numpy.where(NormSquared > 1e-15, NormSquared, 1)
                Foot = Point - Normals * (Projection / SafeNorm)[:, None]
                Offset = Foot - A; D20, D21 = Numpy.sum(Offset * AB, axis=1), Numpy.sum(Offset * AC, axis=1)
                SafeDeterminant = Numpy.where(Numpy.abs(Determinant) > 1e-15, Determinant, 1)
                U = (D11 * D20 - D01 * D21) / SafeDeterminant
                V = (D00 * D21 - D01 * D20) / SafeDeterminant
                Interior = (U >= 0) & (V >= 0) & (U + V <= 1) & (NormSquared > 1e-15)
                SquaredDistance = Numpy.where(Interior, Projection * Projection / SafeNorm, Numpy.inf)
                for Start, End in [(A, B), (B, C), (C, A)]:
                    Edge = End - Start; Length = Numpy.sum(Edge * Edge, axis=1)
                    Fraction = Numpy.clip(Numpy.sum((Point - Start) * Edge, axis=1) / Numpy.where(Length > 1e-15, Length, 1), 0, 1)
                    Closest = Start + Edge * Fraction[:, None]
                    SquaredDistance = Numpy.minimum(SquaredDistance, Numpy.sum((Closest - Point) ** 2, axis=1))
                Distances.append(float(Numpy.sqrt(SquaredDistance.min())))
        Readings.append({"beadHalfWidthM": HalfWidth, "maximumAuthoredSurfaceDistanceM": max(Distances),
                         "meanAuthoredSurfaceDistanceM": sum(Distances) / len(Distances)})
    Proof = {"passed": Readings[1]["maximumAuthoredSurfaceDistanceM"] < 0.0005,
             "cpuOnly": True, "samples": 256, "oldShoulderWidthAnchor": Readings[0], "correctedRimSeat": Readings[1],
             "method": "Nearest point on every authored rigid rim triangle; no visual radius adjustment.",
             "limitations": "Small residual is authored polygon faceting; dynamic native/physical anchor measurements are recorded separately.",
             "sourceSHA256": {str(File.relative_to(Root)): hashlib.sha256(File.read_bytes()).hexdigest() for File in [Asset, Geometry, Physical, Path(__file__)]}}
    Folder.mkdir(parents=True, exist_ok=True)
    (Folder / "AuthoredRimSeatProof.json").write_text(json.dumps(Proof, indent=2) + "\n")
    print(f"Authored rim gap: old {Readings[0]['maximumAuthoredSurfaceDistanceM']*1000:.3f} mm; corrected {Readings[1]['maximumAuthoredSurfaceDistanceM']*1000:.3f} mm")
    return Proof["passed"]


if __name__ == "__main__":
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--output", type=Path, default=Root / "_AgentScratch/tmp/DriveRimSeat")
    Arguments = Parser.parse_args()
    sys.exit(0 if Measure(Arguments.output.resolve()) else 1)
