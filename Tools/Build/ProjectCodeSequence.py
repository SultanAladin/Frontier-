#!/usr/bin/env python3
"""Build a declared vehicle code image from its authoritative shared-mechanics source roster."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import sys

Root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Root / "Tools/Tests"))
from DependencyCodec import RestoreVulkanHeaders

Parser = argparse.ArgumentParser(description=__doc__)
Parser.add_argument("--verify-only", action="store_true")
Parser.add_argument("--project", choices=["Project-Zero", "Project-Drive"], required=True)
Parser.add_argument("--compiler", default=os.environ.get("CXX", "cl.exe" if sys.platform == "win32" else "g++"))
Arguments = Parser.parse_args()
Project = Root / "Projects" / Arguments.project
Subject = "Zero" if Arguments.project == "Project-Zero" else "Drive"
Roster = json.loads((Project / ("Build/" + Subject + "SimulationSources.json")).read_text())
Output = Project / ("Build/Project" + Subject + ".dll")
Scratch = Root / ("_AgentScratch/build/CodeImages/Project" + Subject)
Scratch.mkdir(parents=True, exist_ok=True)
Windows = sys.platform == "win32"
Includes = [Root / "Engine", RestoreVulkanHeaders()]
Headers = sorted(File for Folder in [Root / "Engine", Root / "EngineContent", Project / "Source"]
                 for File in Folder.rglob("*") if File.suffix in [".h", ".inl"])
HeaderIdentity = hashlib.sha256(b"".join(File.read_bytes() for File in Headers)).hexdigest()
Objects = []
for Slot, Name in enumerate(Roster["sources"]):
    Source = Root / Name
    assert Source.is_file()
    Object = Scratch / (str(Slot) + "-" + Source.stem + (".obj" if Windows else ".o"))
    if Windows:
        Command = [Arguments.compiler, "/nologo", "/std:c++20", "/O2", "/MD", "/EHsc", "/utf-8", "/c"]
        Command.extend("/I" + str(Folder) for Folder in Includes)
        Command.extend([str(Source), "/Fo" + str(Object)])
    else:
        Command = [Arguments.compiler, "-std=c++20", "-O2", "-fPIC", "-c"]
        Command.extend("-I" + str(Folder) for Folder in Includes)
        Command.extend([str(Source), "-o", str(Object)])
    Identity = hashlib.sha256((HeaderIdentity + Source.read_text() + json.dumps(Command)).encode()).hexdigest()
    Certificate = Object.with_suffix(".identity")
    if Arguments.verify_only:
        assert Object.exists() and Certificate.exists() and Certificate.read_text() == Identity, "Code-image input identity changed"
    elif not Object.exists() or not Certificate.exists() or Certificate.read_text() != Identity:
        print("+", " ".join(Command), flush=True)
        subprocess.run(Command, cwd=Scratch, check=True)
        Certificate.write_text(Identity)
    Objects.append(str(Object))
if Arguments.verify_only:
    Inputs = {str(File.relative_to(Root)): hashlib.sha256(File.read_bytes()).hexdigest()
              for File in sorted(set(Headers) | {Root / Name for Name in Roster["sources"]})}
    Proof = {"passed": True, "objectInputsVerified": True, "sourceSHA256": Inputs,
             "objectSHA256": {str(Path(Object).relative_to(Root)): hashlib.sha256(Path(Object).read_bytes()).hexdigest()
                              for Object in Objects}, "codeImageSHA256": hashlib.sha256(Output.read_bytes()).hexdigest()}
    (Scratch / "CodeImageSourceProof.json").write_text(json.dumps(Proof, indent=2) + "\n")
    print("Verified actual code-image compiled inputs:", Output)
    sys.exit(0)
if Windows:
    Command = [Arguments.compiler, "/nologo", "/LD", "/MD", *Objects, "/link", "/OUT:" + str(Output)]
else:
    Command = [Arguments.compiler, "-shared", *Objects, "-o", str(Output)]
print("+", " ".join(Command), flush=True)
subprocess.run(Command, cwd=Scratch, check=True)
print("Built actual " + str(Output.relative_to(Root)), flush=True)
