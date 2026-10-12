#!/usr/bin/env python3
"""Build current-checkout CPU renderers and publish fresh, labelled Drive images/GIFs with provenance. Never fetch Frontier source."""
from pathlib import Path
import argparse
import base64
import mimetypes
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import sys

Root = Path(__file__).resolve().parents[2]
LocalPython = Root / "_AgentScratch/tmp/python-tools"
if LocalPython.exists():
    sys.path.insert(0, str(LocalPython))
Parser = argparse.ArgumentParser(description=__doc__)
Parser.add_argument("--compiler", default=os.environ.get("CXX", "g++"))
Parser.add_argument("--views", type=int, default=8)
Parser.add_argument("--frames", type=int, default=8)
Parser.add_argument("--publish-only", action="store_true", help="Publish this checkout's already-fresh scratch captures; do not render again")
Arguments = Parser.parse_args()
if not 1 <= Arguments.views <= 24 or not 2 <= Arguments.frames <= 64:
    Parser.error("views must be 1..24 and frames 2..64")
if sys.platform == "win32" and not Arguments.publish_only:
    Parser.error("CPU exhibit compilation currently requires GCC/Clang; use the native Windows product for Vulkan captures")
try:
    from PIL import Image, ImageDraw, ImageFont
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as Plot
    import numpy as Numpy
except ImportError:
    Parser.error("Install pillow, numpy and matplotlib for the exhibit publisher (compilation/physics checks do not need them)")
Scratch = Root / "_AgentScratch/build/DriveRender"
Raw = Root / "_AgentScratch/tmp/DriveRenders"
Gallery = Root / "Exhibits/Gallery/ProjectDrive"
Traces = Root / "_AgentScratch/tmp/DriveDynamicsSanitized"
if not (Traces / "Proof.json").exists():
    Traces = Root / "_AgentScratch/tmp/DriveDynamicsReconstructed"
for Folder in [Scratch, Raw, Gallery]:
    Folder.mkdir(parents=True, exist_ok=True)
Shared = ["Engine/DisplayPresentation/ShadingTableCodec.cpp", "Engine/ContentInterchange/MaterialIndex.cpp",
          "Engine/GeometricRaster/SceneStructure.cpp", "Engine/GeometricRaster/GeometryStructure.cpp",
          "Engine/DeviceExchange/OrientationClassifier.cpp", "Projects/Project-Drive/Source/DriveSceneAuthor.cpp",
          "Engine/PhysicalDynamics/Vehicle/XPBDSoftTyre.cpp"]
ReSTIR = ["Engine/GeometricRaster/ReservoirIntegrator.cpp", "Engine/Host/RayTracingSolver.cpp",
          "Exhibits/Workbench/Automotive/DriveReservoirProof.cpp"]
Raster = ["Exhibits/Workbench/Automotive/DriveRenderProof.cpp", "Engine/GeometricRaster/VisibilityRaster.cpp",
          "Engine/GeometricRaster/DistanceFieldStructure.cpp", "Engine/DisplayPresentation/CelestialSolver.cpp",
          "Engine/GeometricRaster/StarCatalogueIndex.cpp"]
Commands = []
if Arguments.publish_only and (Raw / "ReSTIRCommands.json").exists():
    Commands = json.loads((Raw / "ReSTIRCommands.json").read_text())


def Execute(Command, Name):
    Commands.append([str(Part) for Part in Command])
    print(Name, flush=True)
    Log = Raw / (Name.replace(" ", "-") + ".log")
    with Log.open("w") as Stream:
        subprocess.run(Command, cwd=Root, stdout=Stream, stderr=subprocess.STDOUT, check=True)
    if Name == "ReSTIR reference":
        Proof = json.loads((Raw / "ReservoirProof.json").read_text())
        assert Proof["renderer"] == "Engine/GeometricRaster/ReservoirIntegrator"
        assert all(View["invalidSamples"] == 0 and View["temporalReuses"] > 0 and View["spatialReuses"] > 0 for View in Proof["views"])


if not Arguments.publish_only:
    Includes = ["Engine", "Engine/Shaders", "Engine/DisplayPresentation", "Engine/ContentInterchange",
                "Engine/DeviceExchange", "Engine/GeometricRaster", "ExternalPackages/vulkan-headers/include"]
    from DependencyCodec import RestoreVulkanHeaders
    Includes[-1] = str(RestoreVulkanHeaders())
    Flags = ["-O2", "-std=c++20", "-DFRONTIER_CPU_PORT", "-ffunction-sections", "-fdata-sections", "-pthread"]
    Flags += ["-I" + str(Path(Folder) if Path(Folder).is_absolute() else Root / Folder) for Folder in Includes]
    # Rebuild on source/header changes; default renders always run again, even when object files remain reusable.
    Headers = [File for Folder in ["Engine", "Projects/Project-Drive/Source", "Exhibits/Workbench/Automotive"]
               for File in (Root / Folder).rglob("*") if File.suffix in [".h", ".inl", ".slang"]]
    LastHeader = max(File.stat().st_mtime_ns for File in Headers)
    Objects = {}
    for Source in dict.fromkeys(Shared + ReSTIR + Raster):
        Output = Scratch / (Source.replace("/", "_") + ".o")
        if not Output.exists() or Output.stat().st_mtime_ns < max((Root / Source).stat().st_mtime_ns, LastHeader):
            Execute([Arguments.compiler, *Flags, "-c", str(Root / Source), "-o", str(Output)], "Compile " + Path(Source).stem)
        Objects[Source] = str(Output)
    for Name, Additions in [("DriveReservoirProof", ReSTIR), ("DriveRenderProof", Raster)]:
        Execute([Arguments.compiler, *(Objects[Source] for Source in Shared + Additions),
                 "-Wl,--gc-sections", "-pthread", "-o", str(Scratch / Name)], "Link " + Name)
    Execute([str(Scratch / "DriveRenderProof"), str(Raw), str(Arguments.views)], "Raster SDF reference")
    Execute([str(Scratch / "DriveReservoirProof"), str(Raw), str(Arguments.views), str(Arguments.frames)], "ReSTIR reference")
    (Raw / "ReSTIRCommands.json").write_text(json.dumps(Commands, indent=2) + "\n")


ReservoirProof = json.loads((Raw / "ReservoirProof.json").read_text())
assert ReservoirProof["renderer"] == "Engine/GeometricRaster/ReservoirIntegrator"
assert len(ReservoirProof["views"]) == Arguments.views
assert all(View["invalidSamples"] == 0 and View["temporalReuses"] > 0 and View["spatialReuses"] > 0 for View in ReservoirProof["views"])
shutil.copyfile(Raw / "ReservoirProof.json", Gallery / "ReservoirProof.json")

Date = datetime.datetime.now(datetime.timezone.utc).isoformat()
FontPath = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
Font = ImageFont.truetype(str(FontPath), 15) if FontPath.exists() else ImageFont.load_default()
Small = ImageFont.truetype(str(FontPath), 12) if FontPath.exists() else ImageFont.load_default()


def Label(File, Heading, Detail):
    Picture = Image.open(File).convert("RGB")
    Surface = Image.new("RGB", (Picture.width, Picture.height + 70), "#11151c")
    Surface.paste(Picture, (0, 70))
    Pen = ImageDraw.Draw(Surface)
    Pen.text((16, 10), Heading, font=Font, fill="#f0f1f4")
    Pen.text((16, 34), Detail, font=Small, fill="#bdc5d3")
    Pen.text((16, 51), "Fresh CPU run | no Vulkan/GPU execution", font=Small, fill="#ffca80")
    return Surface


Modes = [("restir", "ReSTIR DI | shared CPU reference", "Temporal/spatial reservoirs + one traced GI continuation"),
         ("raster", "GI off / RT off | production CPU raster", "Visibility triangles + raster shadow maps; no secondary rays"),
         ("sdf-reference", "GI on / RT off | SDF transport reference", "Production persistent local fields; reference-only one-bounce lighting")]
for Suffix, Title, Detail in Modes:
    Files = [Raw / f"orbit-{Index}-{Suffix}.png" for Index in range(Arguments.views)]
    if Suffix == "restir" and not Files and (Raw / "restir.png").exists():
        Files = [Raw / "restir.png"]
    if not all(File.exists() for File in Files):
        raise RuntimeError("Missing fresh captures for " + Suffix)
    Pictures = [Label(File, Title, Detail) for File in Files]
    Pictures[0].save(Gallery / (Suffix + ".png"))
    Pictures[0].save(Gallery / (Suffix + ".gif"), save_all=True, append_images=Pictures[1:], duration=220, loop=0)
# One labelled comparison, made from rendered images, never synthetic illustration.
Pictures = [Image.open(Gallery / (Mode[0] + ".png")).convert("RGB") for Mode in Modes]
Comparison = Image.new("RGB", (sum(Picture.width for Picture in Pictures), max(Picture.height for Picture in Pictures)), "#11151c")
Left = 0
for Picture in Pictures:
    Comparison.paste(Picture, (Left, 0))
    Left += Picture.width
Comparison.save(Gallery / "render-modes.png")

ScenarioNames = ["settled", "kerb", "airborne", "rollover", "landing"]
if all((Traces / (Name + ".csv")).exists() for Name in ScenarioNames):
    Figure, Axes = Plot.subplots(3, 5, figsize=(16, 8), layout="constrained")
    Figure.suptitle("Project-Drive: production CPU dynamics | fixed 240 Hz | fresh force/energy traces", fontsize=15)
    for Column, Name in enumerate(ScenarioNames):
        Readings = Numpy.genfromtxt(Traces / (Name + ".csv"), delimiter=",", names=True)
        Time = Readings["t"]
        Axes[0, Column].plot(Time, Readings["z"], label="CoM height")
        Axes[0, Column].set_title(Name)
        Axes[0, Column].set_ylabel("height [m]")
        Axes[1, Column].plot(Time, Readings["tyre_load_N"] / 1000, label="tyre vertical")
        Axes[1, Column].plot(Time, Readings["tyre_normal_y_N"] / 1000, label="kerb normal")
        Axes[1, Column].plot(Time, Readings["strut_force_N"] / 1000, label="strut")
        Axes[1, Column].set_ylabel("force [kN]")
        Axes[2, Column].plot(Time, Readings["kinetic_J"] / 1000, label="kinetic")
        Axes[2, Column].plot(Time, (Readings["kinetic_J"] + Readings["potential_J"]) / 1000, label="kinetic + gravity")
        Axes[2, Column].set_ylabel("energy [kJ]")
        Axes[2, Column].set_xlabel("time [s]")
        for Row in range(3):
            Axes[Row, Column].grid(alpha=0.25)
            if Column == 0:
                Axes[Row, Column].legend(fontsize=7)
        shutil.copyfile(Traces / (Name + ".csv"), Gallery / (Name + ".csv"))
    Figure.savefig(Gallery / "physics-traces.png", dpi=125)
    Plot.close(Figure)
    if (Traces / "Proof.json").exists():
        shutil.copyfile(Traces / "Proof.json", Gallery / "DynamicsProof.json")

Sources = set(Shared + ReSTIR + Raster + ["Engine/GeometricRaster/ReservoirIntegrator.h", "Engine/Host/RayTracingSolver.h","Exhibits/Workbench/Automotive/DriveDynamicsProof.cpp",
              "Engine/PhysicalDynamics/Vehicle/VehicleSolver.cpp", "Engine/PhysicalDynamics/Vehicle/VehicleSolver.h",
              "Engine/PhysicalDynamics/Vehicle/XPBDSoftTyre.h", "Projects/Project-Drive/Source/DriveCourse.h",
              "Projects/Project-Drive/Source/VehicleInstanceSequence.cpp", "Projects/Project-Drive/Source/VehicleInstanceSequence.h",
              "Engine/Host/CameraPossessionSequence.h", "Engine/Shaders/DistanceFieldTransport.slang",
              "Engine/Shaders/ViewportIntegrator.slang", "Engine/Shaders/SlangCpuShim.h",
              "Engine/Shaders/MaterialEvaluation.slang", "Engine/Shaders/AutomotiveShowcase.slang",
              "Tools/Tests/RunDriveExhibit.py"])
Proof = {"generatedUtc": Date, "baseline": "1784c866a700bfe7a5d208fadf1ac2c5dfc625dc", "gpuExecution": False,
         "windowsExecution": False, "renderCommands": Commands,
         "binarySha256": {Name: hashlib.sha256((Scratch / Name).read_bytes()).hexdigest() for Name in ["DriveRenderProof", "DriveReservoirProof"]},
         "notes": ["Independent shared-engine CPU ReSTIR DI reference with shipped shader BSDFs and temporal/spatial reuse, not GPU dispatch. One-bounce GI is ordinary tracing, not GPU ReSTIR GI.",
                   "CPU raster is production VisibilityRaster.",
                   "SDF geometry/samples/persistence are production DistanceFieldStructure; secondary lighting is a proof-only one-bounce reference.",
                   "SDF does not reproduce GPU cards, half-resolution gather, temporal scheduling/denoising or exact appearance.",
                   "The existing CPU raster lacks the GPU resolve's directional sun/environment treatment, so it appears darker. No GPU appearance or pixel-parity comparison is claimed."],
         "sourceSha256": {Source: hashlib.sha256((Root / Source).read_bytes()).hexdigest() for Source in sorted(Sources)},
         "rawSha256": {File.name: hashlib.sha256(File.read_bytes()).hexdigest() for File in Raw.glob("orbit-*.png")}}
Proof["artifactSha256"] = {File.name: hashlib.sha256(File.read_bytes()).hexdigest() for File in Gallery.iterdir() if File.suffix in [".png", ".gif", ".csv"]}
(Gallery / "RenderProof.json").write_text(json.dumps(Proof, indent=2) + "\n")
(Gallery / "render-references.html").write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project-Drive — fresh CPU evidence</title><style>body{margin:0;background:#11151c;color:#eef2f7;font:16px system-ui;line-height:1.6}main{max-width:1500px;margin:40px auto;padding:0 24px}h1{line-height:1.15}.note{padding:18px;border:1px solid #977442;background:#211d17;color:#ffdc9a}img{width:100%;height:auto;border-radius:8px}.renders{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}a{color:#acc8ff}code{color:#e7c89b}@media(max-width:900px){.renders{grid-template-columns:1fr}}</style>
<main><p>FRONTIER / PROJECT-DRIVE</p><h1>Fresh CPU rendering &amp; vehicle evidence</h1>
<div class="note">These are new C++ CPU renders and real production-code dynamics traces, not AI images or Vulkan screenshots.
ReSTIR RT, SDF GI + raster, and GI-off raster are separate routes. The SDF picture uses the real persistent local fields,
but its one-bounce lighting is a reference only: it does not validate GPU cards, appearance, frame times or AMD device loss.
The ReSTIR reference implements DI reuse with a one-bounce GI continuation, not the GPU GI reservoir/atmosphere pipeline.
The current CPU raster has a simpler sun/environment treatment than the GPU resolve and looks darker here.</div>
<h2>Drive renders</h2><img src="render-modes.png" alt="Three labelled CPU rendering references">
<h2>Fresh turntables</h2><div class="renders"><section><h3>ReSTIR DI CPU reference</h3><img src="restir.gif" onerror="this.src='restir.png'" alt="Fresh Drive ReSTIR CPU render"></section><section><h3>Production CPU raster</h3><img src="raster.gif" alt="Fresh Drive raster turntable"></section><section><h3>SDF transport reference</h3><img src="sdf-reference.gif" alt="Fresh persistent SDF transport reference turntable"></section></div>
<h2>Vehicle physics: actual solver, fixed 240 Hz</h2><img src="physics-traces.png" alt="Five scenarios with height, force and energy traces">
<p><a href="settled.csv">Settled</a> · <a href="kerb.csv">Kerb</a> · <a href="airborne.csv">Airborne</a> · <a href="rollover.csv">Rollover</a> · <a href="landing.csv">Landing</a></p>
<p>Energy plots cover chassis kinetic and gravitational potential energy only, not full tyre/strut stored energy.
All exported body/force/energy trace values are compared bit-for-bit across repeats on this compiler/host; this is not cross-platform determinism.</p>
<p>F8 ejects into free flight without stopping simulation. F8 again repossesses the same vehicle; held/captured presses never repeat. Stop restores the editor camera.</p>
<p><a href="RenderProof.json">Render provenance</a> · <a href="DynamicsProof.json">Executed dynamics checks</a></p>
<p>Reproduce: <code>python Tools/Tests/CheckDriveDynamics.py</code> and <code>python Tools/Tests/RunDriveExhibit.py</code>.</p></main></html>''')
# Self-contained requested exhibit: image/GIF assets also work in a sandboxed file viewer without a web server.
HtmlPath = Gallery / "render-references.html"
Html = HtmlPath.read_text()
for Asset in Gallery.iterdir():
    if Asset.suffix not in [".png", ".gif", ".csv", ".json"]:
        continue
    Mime = mimetypes.guess_type(Asset.name)[0] or "application/octet-stream"
    Uri = "data:" + Mime + ";base64," + base64.b64encode(Asset.read_bytes()).decode("ascii")
    Html = Html.replace('src="' + Asset.name + '"', 'src="' + Uri + '"')
    Html = Html.replace('href="' + Asset.name + '"', 'download="' + Asset.name + '" href="' + Uri + '"')
HtmlPath.write_text(Html)
print("Published", Gallery)
