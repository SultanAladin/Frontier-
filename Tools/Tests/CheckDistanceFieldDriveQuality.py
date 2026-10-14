#!/usr/bin/env python3
"""CPU-only authored Drive body vs production SDF builder and shader-mirrored ray marcher. No Vulkan render."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile

Root = Path(__file__).resolve().parents[2]
from DependencyCodec import RestoreVulkanHeaders

Scratch = Root / "_AgentScratch/build/DistanceFieldDriveQuality"
Scratch.mkdir(parents=True, exist_ok=True)
Compiler = os.environ.get("CXX", "cl.exe" if sys.platform == "win32" else "g++")
Headers = RestoreVulkanHeaders()
Source = Root / "Exhibits/Workbench/Traversal/DistanceFieldDriveQualityChecks.cpp"
Builder = Root / "Engine/GeometricRaster/DistanceFieldStructure.cpp"
Binary = Scratch / ("DriveQuality.exe" if sys.platform == "win32" else "DriveQuality")
if sys.platform == "win32":
    Command = [Compiler, "/nologo", "/std:c++20", "/EHsc", "/utf-8", "/O2", "/MD", "/DNOMINMAX",
               "/I" + str(Root), "/I" + str(Root / "Engine"), "/I" + str(Headers),
               str(Source), str(Builder), "/Fe:" + str(Binary)]
else:
    Command = [Compiler, "-O2", "-std=c++20", "-pthread", "-I" + str(Root),
               "-I" + str(Root / "Engine"), "-I" + str(Headers),
               str(Source), str(Builder), "-o", str(Binary)]
subprocess.run(Command, cwd=Root, check=True)
with tempfile.TemporaryDirectory(prefix="body-", dir=Scratch) as Storage:
    subprocess.run([str(Binary), str(Path(Storage) / "fields")], cwd=Root, check=True)
