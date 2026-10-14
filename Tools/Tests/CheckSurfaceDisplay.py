#!/usr/bin/env python3
"""Build and run the SurfaceDisplay proofs: the tablet/cluster raster + touch proof and the Drive cabin fixture proof.

No window or GPU: both are CPU sheets written to VisualProof/SurfaceDisplay. Uses the ExternalPackages headers
(stb, cgltf, ufbx, fast_obj, vulkan-headers); pass --packages to point at another checkout of them."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

Root = Path(__file__).resolve().parents[2]
Parser = argparse.ArgumentParser(description=__doc__)
Parser.add_argument("--packages", type=Path, default=Root / "ExternalPackages")
Parser.add_argument("--output", type=Path, default=Root / "VisualProof/SurfaceDisplay")
Arguments = Parser.parse_args()
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

Windows = sys.platform == "win32"
Compiler = "cl.exe" if Windows else os.environ.get("CXX", "g++")
Flags = (["/nologo", "/c", "/O2", "/MD", "/EHsc", "/std:c++20", "/utf-8", "/W3", "/DNDEBUG", "/DNOMINMAX", "/D_CRT_SECURE_NO_WARNINGS"] if Windows
         else ["-c", "-O2", "-std=c++20", "-DNDEBUG", "-pthread", "-Wall"])
Includes = [("/I" if Windows else "-I") + str(Folder) for Folder in
            [Root, Root / "Engine", Root / "Engine/SurfaceDisplay", Arguments.packages / "stb", Arguments.packages / "cgltf",
             Arguments.packages / "ufbx", Arguments.packages / "fast_obj", Arguments.packages / "vulkan-headers/include"]]
Scratch = Root / "_AgentScratch/build/SurfaceDisplay"
Scratch.mkdir(parents=True, exist_ok=True)
Arguments.output.mkdir(parents=True, exist_ok=True)

SurfaceDisplay = [f"Engine/SurfaceDisplay/{Name}.cpp" for Name in
                  ["DisplaySheetStructure", "TypefaceSheetCodec", "DisplayRasterProjection", "DisplaySurfaceStructure",
                   "DisplayTouchProjection", "DisplayMeshProjection", "DisplayStartupSequence", "TabletScreenSequence", "ClusterScreenSequence"]]
Content = [Source for Source in json.loads((Root / "Projects/Project-Drive/Build/DriveContentSources.json").read_text())["sources"]
           if not Source.endswith("DriveContentHost.cpp")]


def Link(Name, Sources):
    Objects = []
    for Relative in Sources:
        Object = Scratch / (Relative.replace("/", "_") + (".obj" if Windows else ".o"))
        if not Object.exists() or Object.stat().st_mtime < (Root / Relative).stat().st_mtime:
            Output = [f"/Fo{Object}"] if Windows else ["-o", str(Object)]
            subprocess.run([Compiler, *Flags, *Includes, Relative, *Output], check=True, cwd=Root)
        Objects.append(str(Object))
    Executable = Scratch / (Name + (".exe" if Windows else ""))
    Command = (["link.exe", "/nologo", f"/OUT:{Executable}", *Objects] if Windows else [Compiler, *Objects, "-pthread", "-o", str(Executable)])
    subprocess.run(Command, check=True, cwd=Root)
    return Executable


Proof = Link("SurfaceDisplayProof", ["Exhibits/Workbench/Automotive/SurfaceDisplayProof.cpp", *SurfaceDisplay])
subprocess.run([str(Proof), str(Root / "EngineContent/FontArchives/Inter"), str(Arguments.output)], check=True, cwd=Root)
Cabin = Link("CabinFixtureProof", ["Exhibits/Workbench/Automotive/CabinFixtureProof.cpp", *Content,
                                   *[S for S in SurfaceDisplay if "DisplaySurfaceStructure" not in S]])
subprocess.run([str(Cabin), str(Arguments.output)], check=True, cwd=Root)
print("PASS SurfaceDisplay proofs; no window or GPU was used.")
