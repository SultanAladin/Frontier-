#!/usr/bin/env python3
"""Run the actual Project-Zero code image, authored 3D scene and shared Vulkan smoke presentation."""
from pathlib import Path
import argparse
import concurrent.futures
import hashlib
import json
import os
import shutil
import subprocess
import sys
from DependencyCodec import RestoreVulkanHeaders, RestoreProofDependency

Root = Path(__file__).resolve().parents[2]
Parser = argparse.ArgumentParser(description=__doc__)
Parser.add_argument("--build-only", action="store_true")
Parser.add_argument("--device-checks", action="store_true")
Parser.add_argument("--cases", nargs="+", default=["holding", "combined-drift", "turning-drift", "scrolling-drift", "diagnostic-ignition"])
Parser.add_argument("--ticks", type=int, default=360)
Parser.add_argument("--fine-extent", type=int, choices=[64, 128], default=64)
Parser.add_argument("--jobs", type=int, choices=[1, 2, 3, 4], default=2)
Parser.add_argument("--compiler", default=os.environ.get("CXX", "cl.exe" if sys.platform == "win32" else "g++"))
Arguments = Parser.parse_args()
Build = Root / "_AgentScratch/build/ZeroNative"
Raw = Root / "_AgentScratch/tmp/ZeroNative/Captures"
for Folder in [Build, Raw, Root / "_AgentScratch/logs/ZeroNative"]:
    Folder.mkdir(parents=True, exist_ok=True)
Windows = sys.platform == "win32"
Roster = json.loads((Root / "VisualProof/SmokeSequence/ZeroNativeSources.json").read_text())
VulkanHeaders = RestoreVulkanHeaders()
Includes = [Root / Folder for Folder in Roster["includes"]]
Includes.extend([VulkanHeaders, RestoreProofDependency("cgltf"), RestoreProofDependency("stb"), RestoreProofDependency("ufbx"), RestoreProofDependency("tinybvh")])
Executable = Build / ("ZeroViewportMetrics.exe" if Windows else "ZeroViewportMetrics")


def Execute(Command, Cwd=Build):
    print("+", " ".join(str(Part) for Part in Command), flush=True)
    subprocess.run([str(Part) for Part in Command], cwd=Cwd, check=True)


HeaderFiles = sorted(File for Folder in [Root / "Engine", Root / "EngineContent"] for File in Folder.rglob("*")
                     if File.suffix in [".h", ".inl", ".slang"])
HeaderIdentity = hashlib.sha256(b"".join(File.read_bytes() for File in HeaderFiles) +
                                (Root / "VisualProof/SmokeSequence/ZeroViewportMetrics.cpp").read_bytes()).hexdigest()


def Compile(Source):
    Source = Root / Source
    Object = Build / (Source.stem + (".obj" if Windows else ".o"))
    if Windows:
        Command = [Arguments.compiler, "/nologo", "/std:c++20", "/O2", "/MD", "/EHsc", "/utf-8", "/Gy", "/DFRONTIER_CPU_PORT"]
        Command.extend("/I" + str(Folder) for Folder in Includes)
        Command.extend(["/c", Source, "/Fo" + str(Object)])
    else:
        Command = [Arguments.compiler, "-std=c++20", "-O2", "-DFRONTIER_CPU_PORT", "-ffunction-sections", "-fdata-sections"]
        Command.extend("-I" + str(Folder) for Folder in Includes)
        Command.extend(["-c", Source, "-o", Object])
    Identity = hashlib.sha256((HeaderIdentity + Source.read_text() + json.dumps([str(Part) for Part in Command])).encode()).hexdigest()
    Certificate = Object.with_suffix(".identity")
    if not Object.exists() or not Certificate.exists() or Certificate.read_text() != Identity:
        Execute(Command)
        Certificate.write_text(Identity)
    return Object


Execute([sys.executable, Root / "Tools/Build/ProjectCodeSequence.py", "--project", "Project-Zero", "--compiler", Arguments.compiler])
with concurrent.futures.ThreadPoolExecutor(max_workers=Arguments.jobs) as Workers:
    Objects = list(Workers.map(Compile, Roster["sources"]))
if Windows:
    VulkanLibrary = Path(os.environ["VULKAN_SDK"]) / "Lib/vulkan-1.lib"
    Execute([Arguments.compiler, "/nologo", *Objects, "/Fe" + str(Executable), "/link", VulkanLibrary])
else:
    Runtime = Root / "_AgentScratch/tmp/ZeroNative/Runtime"
    Execute([Arguments.compiler, *Objects, "-Wl,--gc-sections", "-L" + str(Runtime), "-Wl,-rpath," + str(Runtime),
             "-l:libvulkan.so.1", "-ldl", "-pthread", "-o", Executable])
ShaderCompiler = shutil.which("glslangValidator") or str(Build / "glslang/StandAlone/glslang")
for Name in ["SmokeTransport", "SmokeViewport"]:
    Execute([ShaderCompiler, "-V", "--target-env", "vulkan1.1", "-S", "comp", "-I" + str(Root / "Engine/Shaders"),
             Root / ("Engine/Shaders/" + Name + ".slang"), "-o", Build / (Name + ".spv")])
AuthoringScene = Root / "Projects/Project-Zero/Content/Scenes/Vehicle.gltf"
Execute([Executable, "--author", AuthoringScene])
if Arguments.device_checks:
    DeviceObject = Compile("VisualProof/SmokeSequence/SmokeDeviceMetrics.cpp")
    DeviceExecutable = Build / ("SmokeDeviceMetrics.exe" if Windows else "SmokeDeviceMetrics")
    if Windows:
        Execute([Arguments.compiler, "/nologo", DeviceObject, *Objects[1:], "/Fe" + str(DeviceExecutable), "/link", VulkanLibrary])
    else:
        Execute([Arguments.compiler, DeviceObject, *Objects[1:], "-Wl,--gc-sections", "-L" + str(Runtime),
                 "-Wl,-rpath," + str(Runtime), "-l:libvulkan.so.1", "-ldl", "-pthread", "-o", DeviceExecutable])
    if not Windows:
        os.environ["VK_ICD_FILENAMES"] = str(Runtime / "vk_swiftshader_icd.json")
        os.environ["LD_LIBRARY_PATH"] = str(Runtime) + ":" + os.environ.get("LD_LIBRARY_PATH", "")
    Execute([DeviceExecutable, Build, Raw / "DeviceMetrics.json"], Root)
if Arguments.build_only:
    sys.exit(0)

if not Windows:
    os.environ["VK_ICD_FILENAMES"] = str(Runtime / "vk_swiftshader_icd.json")
    os.environ["LD_LIBRARY_PATH"] = str(Runtime) + ":" + os.environ.get("LD_LIBRARY_PATH", "")
    os.environ["LP_NUM_THREADS"] = "2"
InitialConditions = {
    "holding": ([0, 0, 0], [0, 0, 0], False),
    "combined-drift": ([18, 9, 0], [0, 0, 0], False),
    "turning-drift": ([17, 8, 0], [0, 0, 0.6], False),
    "scrolling-drift": ([36, 13, 0], [0, 0, 0], False),
    "diagnostic-ignition": ([18, 9, 0], [0, 0, 0], True),
}
EvidenceFiles = set(HeaderFiles)
EvidenceFiles.update(Root / Name for Name in Roster["sources"])
EvidenceFiles.update([Root / "Projects/Project-Zero/Source/ProjectZeroInterchange.cpp",
                      Root / "Projects/Project-Zero/Build/ZeroSimulationSources.json",
                      Root / "Projects/Project-Zero/ProjectZero.frontier", Root / "Tools/Tests/RunZeroSmokeExhibit.py"])
SourceIdentity = {str(File.relative_to(Root)): hashlib.sha256(File.read_bytes()).hexdigest() for File in sorted(EvidenceFiles)}
CompilationProof = {"passed": True, "windowsExecution": Windows, "sourceSHA256": SourceIdentity,
                    "executableSHA256": hashlib.sha256(Executable.read_bytes()).hexdigest(),
                    "codeImageSHA256": hashlib.sha256((Root / "Projects/Project-Zero/Build/ProjectZero.dll").read_bytes()).hexdigest()}
(Build / "CompilationProof.json").write_text(json.dumps(CompilationProof, indent=2) + "\n")

for Case in Arguments.cases:
    Velocity, AngularVelocity, Diagnostic = InitialConditions[Case]
    Fixture = Raw / Case
    Fixture.mkdir(parents=True, exist_ok=True)
    (Fixture / "Build").mkdir(exist_ok=True)
    (Fixture / "Content/Scenes").mkdir(parents=True, exist_ok=True)
    shutil.copy2(Root / "Projects/Project-Zero/Build/ProjectZero.dll", Fixture / "Build/ProjectZero.dll")
    shutil.copy2(AuthoringScene, Fixture / "Content/Scenes/Vehicle.gltf")
    Specification = (Root / "Projects/Project-Zero/ProjectZero.frontier").read_text()
    Specification += "\n[Vehicle]\nInitialVelocity = " + json.dumps(Velocity) + "\nInitialAngularVelocity = " + json.dumps(AngularVelocity)
    Specification += "\nDiagnosticIgnition = " + str(Diagnostic).lower() + "\n"
    Location = Fixture / "ProjectZero.frontier"
    Location.write_text(Specification)
    for Picture in Fixture.glob("Picture-*.png"):
        Picture.unlink()
    Execute([Executable, Location, Fixture, Case, Build, Arguments.ticks, Arguments.fine_extent], Root)
    Audit = json.loads((Fixture / "NativeMetrics.json").read_text())
    assert {str(File.relative_to(Root)): hashlib.sha256(File.read_bytes()).hexdigest() for File in sorted(EvidenceFiles)} == SourceIdentity
    Audit["sourceIdentitySHA256"] = hashlib.sha256(json.dumps(SourceIdentity, sort_keys=True).encode()).hexdigest()
    Audit["executableSHA256"] = hashlib.sha256(Executable.read_bytes()).hexdigest()
    Audit["codeImageSHA256"] = hashlib.sha256((Fixture / "Build/ProjectZero.dll").read_bytes()).hexdigest()
    Audit["openingSceneSHA256"] = hashlib.sha256(AuthoringScene.read_bytes()).hexdigest()
    (Fixture / "NativeMetrics.json").write_text(json.dumps(Audit, indent=2) + "\n")
