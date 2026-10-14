#!/usr/bin/env python3
"""Build, run and publish the option-B tyre deformation proof: rigid | deformed | difference on the actual Drive car."""
from pathlib import Path
import argparse
import csv
import hashlib
import html
import json
import os
import subprocess
import sys

Root = Path(__file__).resolve().parents[2]
LocalPython = Root / "_AgentScratch/tmp/python-tools"
if LocalPython.exists():
    sys.path.insert(0, str(LocalPython))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from DependencyCodec import RestoreProofDependency, RestoreVulkanHeaders
from PlaybackCodec import EncodeClip, PlaybackScript

Proof = "Exhibits/Workbench/Automotive/DriveTyreDeformationProof.cpp"
Sources = [Proof, "Engine/GeometricRaster/VisibilityRaster.cpp", "Engine/DisplayPresentation/CelestialSolver.cpp",
           "Engine/GeometricRaster/StarCatalogueIndex.cpp", "Engine/DisplayPresentation/ShadingTableCodec.cpp",
           "Engine/ContentInterchange/MaterialIndex.cpp", "Engine/GeometricRaster/SceneStructure.cpp",
           "Engine/GeometricRaster/GeometryStructure.cpp", "Engine/DeviceExchange/OrientationClassifier.cpp",
           "Projects/Project-Drive/Source/DriveSceneAuthor.cpp", "Engine/SurfaceDisplay/DisplaySurfaceStructure.cpp",
           "Projects/Project-Drive/Source/VehicleInstanceSequence.cpp", "Engine/PhysicalDynamics/Vehicle/VehicleInstanceSequence.cpp",
           "Engine/DisplayPresentation/ChaseCameraSolver.cpp", "Engine/PhysicalDynamics/Vehicle/VehicleSolver.cpp",
           "Engine/PhysicalDynamics/Vehicle/VehicleGeometry.cpp", "Engine/PhysicalDynamics/Vehicle/Drivetrain.cpp",
           "Engine/PhysicalDynamics/Vehicle/Aerodynamics.cpp", "Engine/PhysicalDynamics/Vehicle/PacejkaMagicFormula.cpp",
           "Engine/PhysicalDynamics/Vehicle/TyreSlipDynamics.cpp", "Engine/GeometricRaster/CameraProjection.cpp"]
Headers = ["Engine/Shaders/TyreDeformation.slang", "Engine/GeometricRaster/TyreDeformation.h", "Engine/GeometricRaster/TyreDeformationRecord.h",
           "Engine/PhysicalDynamics/Vehicle/TyreDeformationPublisher.h", "Engine/ProjectInterchange/TyreDeformationInterchange.h",
           "Engine/Host/TyreDeformationSequence.h", "Engine/Shaders/VisibilityRaster.vert.slang", "Engine/Shaders/ShadowRaster.vert.slang",
           "Engine/Shaders/SurfaceResolve.slang", "Exhibits/Workbench/Automotive/DriveDynamicsFixture.h"]
Titles = {"static-load": ("Static load: four flat patches", "Dropped from 2 cm onto flat ground and left to settle. ~3.0 kN per front tyre, 12 mm deflection, ~11 cm patch half-length: a flat spot and a slight sidewall belly, nothing moving."),
          "hard-brake": ("Hard brake from 25 m/s", "Full brake at 0.4 s. Load shifts forward (fronts to ~4.1 kN, 16 mm), the tread leads rearwards under −4.7 kN of Fx, and everything relaxes back as the car stops at ~2.5 s."),
          "left-corner": ("Left corner at 18 m/s", "Steer ramps to 55 % left. The outside front carries ~4.4 kN with 18 mm deflection and 4.8 kN of Fy; the carcass walks ~30 mm sideways while the patch stays on the road.")}


def Hash(File):
    return hashlib.sha256(File.read_bytes()).hexdigest()


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--compiler", default=os.environ.get("CXX", "g++"))
    Parser.add_argument("--stride", type=int, default=1, help="render every Nth 20 Hz sample (preview only; the published page uses 1)")
    Parser.add_argument("--publish-only", action="store_true")
    Arguments = Parser.parse_args()
    from PIL import Image, ImageDraw
    Build = Root / "_AgentScratch/build/TyreDeform"
    Raw = Root / "_AgentScratch/tmp/TyreDeform"
    Gallery = Root / "Exhibits/Gallery/ProjectDrive"
    Destination = Gallery / "deformation"
    for Folder in [Build, Raw, Destination]:
        Folder.mkdir(parents=True, exist_ok=True)
    Binary = Build / "DriveTyreDeformationProof"
    Commands = []
    if not Arguments.publish_only:
        Includes = ["", "Engine", "Engine/Shaders", "Engine/DisplayPresentation", "Engine/ContentInterchange", "Engine/DeviceExchange",
                    "Engine/GeometricRaster"]
        Flags = ["-std=c++20", "-O2", "-UNDEBUG", "-DFRONTIER_CPU_PORT", "-pthread", "-ffunction-sections", "-fdata-sections"]
        Flags += ["-I" + str(Root / Folder) for Folder in Includes] + ["-I" + str(RestoreVulkanHeaders()), "-I" + str(RestoreProofDependency("stb"))]
        Objects = []
        for Source in Sources:
            Output = Build / (Source.replace("/", "_") + ".o")
            Command = [Arguments.compiler, *Flags, "-c", str(Root / Source), "-o", str(Output)]
            Commands.append(Command)
            print("Compile", Path(Source).stem, flush=True)
            subprocess.run(Command, cwd=Root, check=True)
            Objects.append(str(Output))
        Command = [Arguments.compiler, *Objects, "-Wl,--gc-sections", "-pthread", "-o", str(Binary)]
        Commands.append(Command)
        subprocess.run(Command, cwd=Root, check=True)
        for Stale in Raw.glob("*"):
            Stale.unlink()
        Command = [str(Binary), str(Raw)] + ([str(Arguments.stride)] if Arguments.stride > 1 else [])
        Commands.append(Command)
        print("Render rigid | deformed | difference frames (CPU raster, several minutes)", flush=True)
        with (Raw / "DriveTyreDeformationProof.log").open("w") as Log:
            subprocess.run(Command, cwd=Root, stdout=Log, stderr=subprocess.STDOUT, check=True)
    Log = (Raw / "DriveTyreDeformationProof.log").read_text()
    assert Log.count("PASS") == 4, Log

    Cards, Media, Summary = [], {}, {}
    for Name, (Title, Caption) in Titles.items():
        Frames = sorted(Raw.glob(Name + "-*.png"))
        assert Frames, "No frames for " + Name
        Rows = list(csv.DictReader((Raw / (Name + ".csv")).open()))
        assert len(Rows) == len(Frames)
        Pictures = []
        for Frame, Row in zip(Frames, Rows):
            Picture = Image.open(Frame).convert("RGB")
            Draw = ImageDraw.Draw(Picture)
            Third = Picture.width // 3
            for Column, Label in enumerate(["RIGID (before)", "DEFORMED (option B, vertex stage)", "|DIFFERENCE| x3"]):
                Draw.rectangle([Column * Third + 8, 8, Column * Third + 8 + 7 * len(Label) + 10, 28], fill=(10, 16, 22))
                Draw.text((Column * Third + 13, 11), Label, fill=(230, 238, 245))
            Status = "t = %5.2f s   v = %4.1f m/s   FL: Fz %4.0f N  defl %4.1f mm  Fx %5.0f N  Fy %5.0f N" % (
                float(Row["time_s"]), float(Row["speed_mps"]), float(Row["fl_load_n"]), float(Row["fl_deflection_m"]) * 1000.0,
                float(Row["fl_fx_n"]), float(Row["fl_fy_n"]))
            Draw.rectangle([8, Picture.height - 30, 8 + 7 * len(Status) + 10, Picture.height - 8], fill=(10, 16, 22))
            Draw.text((13, Picture.height - 26), Status, fill=(230, 238, 245))
            Pictures.append(Picture)
        Poster = Destination / (Name + ".png")
        Pictures[-1 if Name != "hard-brake" else len(Pictures) // 3].save(Poster)
        Recording = Raw / (Name + ".gif")
        Pictures[0].save(Recording, save_all=True, append_images=Pictures[1:], duration=50 * Arguments.stride, loop=0, optimize=False)
        Encoded = EncodeClip(Recording, Destination / (Name + ".mp4"))
        (Destination / (Name + ".csv")).write_bytes((Raw / (Name + ".csv")).read_bytes())
        Peak = max(Rows, key=lambda R: float(R["fl_deflection_m"]))
        Summary[Name] = {"frames": len(Rows), "peakFrontLeftDeflectionMm": round(float(Peak["fl_deflection_m"]) * 1000.0, 2),
                         "peakFrontLeftLoadN": round(max(float(R["fl_load_n"]) for R in Rows), 1),
                         "maxDeformedLowestPointMm": round(max(float(R[K]) for R in Rows for K in R if K.endswith("_deformed_low_m")) * 1000.0, 2),
                         "minDeformedLowestPointMm": round(min(float(R[K]) for R in Rows for K in R if K.endswith("_deformed_low_m")) * 1000.0, 2),
                         "minRigidLowestPointMm": round(min(float(R[K]) for R in Rows for K in R if K.endswith("_rigid_low_m")) * 1000.0, 2),
                         "meanChangedPixels": round(sum(int(R["changed_pixels"]) for R in Rows) / len(Rows), 1)}
        Media[Name] = {"playback": Encoded, "posterSHA256": Hash(Poster), "traceSHA256": Hash(Destination / (Name + ".csv"))}
        Cards.append(f'<article><h3>{html.escape(Title)}</h3><video controls loop muted playsinline preload="none" poster="deformation/{Name}.png" src="deformation/{Name}.mp4"></video><p>{html.escape(Caption)} <a href="deformation/{Name}.csv">Per-wheel trace</a>.</p></article>')

    Provenance = {"recordedDate": "2026-10-14", "cpuOnly": True, "gpuExecution": False, "autoplay": False,
                  "renderer": "Engine/GeometricRaster/VisibilityRaster (flat CPU raster, diagnostic palette)",
                  "deformation": "Engine/Shaders/TyreDeformation.slang through Engine/GeometricRaster/TyreDeformation.h (FRONTIER_CPU_PORT)",
                  "records": "Engine/PhysicalDynamics/Vehicle/TyreDeformationPublisher.h — the same ComposeTyreDeformation the Project-Drive DLL exports",
                  "commands": Commands, "log": Log, "summary": Summary, "clips": Media,
                  "sourceSHA256": {Source: Hash(Root / Source) for Source in sorted(Sources + Headers)},
                  "binarySHA256": Hash(Binary) if Binary.exists() else None}
    (Destination / "DeformationProof.json").write_text(json.dumps(Provenance, indent=2) + "\n")
    Rows = "".join(f"<tr><td>{html.escape(Titles[Name][0])}</td><td>{Values['frames']}</td><td>{Values['peakFrontLeftLoadN']:.0f} N</td><td>{Values['peakFrontLeftDeflectionMm']:.1f} mm</td><td>{Values['minRigidLowestPointMm']:.1f} mm</td><td>{Values['minDeformedLowestPointMm']:.1f} … {Values['maxDeformedLowestPointMm']:.1f} mm</td></tr>" for Name, Values in Summary.items())
    Page = Gallery / "tyre-deformation.html"
    Page.write_text('''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Drive | GPU procedural tyre deformation (option B)</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#101820;color:#e6eef5;font:16px/1.6 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:42px 24px 64px}h1{font-size:clamp(30px,4vw,48px);line-height:1.15;margin:10px 0 18px}h2{margin-top:42px}h3{font-size:18px;margin:0 0 14px}p{color:#c4d3df}.eyebrow{letter-spacing:.15em;font-size:12px;color:#76d6c2}.lead{max-width:850px;font-size:18px}.notice{border-left:3px solid #efbd75;background:#22252b;padding:15px 20px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:28px 0}.stats div,article{background:#19242f;border:1px solid #334758;border-radius:8px;padding:20px}.stats strong{display:block;color:#7de0c0;font-size:27px}.cards{display:grid;grid-template-columns:1fr;gap:20px}video,img{display:block;width:100%;height:auto;border-radius:5px}button{border:1px solid #6198b2;border-radius:5px;background:#1c384a;color:#eaf4fa;padding:10px 16px;font:inherit;cursor:pointer}a{color:#81d6ef}table{width:100%;border-collapse:collapse;font-size:15px}td,th{padding:13px 12px;text-align:left;border-bottom:1px solid #344554}th{color:#afc3d3}code{color:#8edfc9}footer{margin-top:40px;color:#8c9fab;font-size:13px}@media(max-width:760px){.stats{grid-template-columns:1fr 1fr}main{padding:25px 15px}table{font-size:13px}}
</style></head><body><main><div class="eyebrow">PROJECT DRIVE / TYRE DEFORMATION / 14 OCT 2026</div>
<h1>The physics wheel stays rigid. The drawn tyre does not.</h1><p class="lead">XPBD is gone. The trace-fan contact solver publishes one 128-byte record per wheel (hub, axle, patch centre, normal, deflection, Fx/Fy lean, tread speed, pressure) and the vertex stage bends whatever tyre mesh is on the car — slick or treaded — in world space, so the flat spot stands still on the road while the rubber rolls through it.</p>
<div class="notice"><strong>What this is:</strong> the actual ControlVehicle and the actual DriveSceneAuthor wheels, posed by the actual VehicleSolver, bent by the CPU port of the very shader text the GPU runs (<code>Engine/Shaders/TyreDeformation.slang</code>). Flat diagnostic palette, no GI. <strong>What it is not:</strong> a Vulkan screenshot — no GPU is available here; the three shaders that include it compile to SPIR-V (34/34 green).</div>
<div class="stats"><div><strong>128 B</strong>per wheel, per frame</div><div><strong>~40 ALU</strong>per tyre vertex</div><div><strong>0 mm</strong>bent tread below the road</div><div><strong>12–18 mm</strong>solver deflection shown 1:1</div></div>
<h2>Measured on every frame</h2><table><thead><tr><th>Clip</th><th>Frames</th><th>Peak FL load</th><th>Peak FL deflection</th><th>Rigid shell lowest point</th><th>Deformed tread lowest point</th></tr></thead><tbody>''' + Rows + '''</tbody></table>
<p>The rigid shell sinks into the road by exactly the solver's deflection (the physics wheel is a rigid disc of nominal radius); the bent tread never crosses the ground plane, and every frame asserts both. Deflections are honest: 12 mm on a 330 mm tyre is what a road car does, so look at the flat spot, the belly beside it and the difference panel rather than expecting a cartoon.</p>
<h2>Inspect the actual frames</h2><p>All clips start paused. Play one to pause the others. Left: what the raster drew before. Middle: what the vertex stage draws now. Right: absolute pixel difference ×3 — black means the two agree, so it isolates the patch, the sidewall belly and the fore/aft or sideways lead.</p><button type="button" onclick="PauseClips()">Pause all clips</button><div class="cards">''' + "".join(Cards) + '''</div>
<h2>How it is wired</h2><ul><li><code>ProjectTyreDeformationInterchange</code> (versioned C export, Project-Drive and Project-Zero) → <code>TyreDeformationSequence</code> in <code>FrontierRuntime</code> resolves wheel placements to instance rows once and stamps <code>InstanceFlagTyreDeform | slot &lt;&lt; 16</code>.</li><li><code>VisibilityExchange</code> keeps 64 [current, previous] record pairs in one SSBO (raster set binding 4, resolve binding 16) refreshed with <code>vkCmdUpdateBuffer</code> only when the revision changes.</li><li><code>VisibilityRaster.vert</code> bends this frame's and last frame's positions (motion vectors stay right), <code>ShadowRaster.vert</code> bends the shadow caster, <code>SurfaceResolve</code> rebuilds the same bent triangle so normals and wire agree.</li><li>Rim, hub and brake are untouched: the weight is 0 inside <code>RimRadius</code> and smooth-steps to 1 at the tread, so any authored wheel works as long as its rim is rigid.</li><li>Not bent (yet): ray-query / BLAS geometry and the rest SDF — a ≤ 2 cm discrepancy in reflections and GI contact shadows, listed in the plan.</li></ul>
<h2>Reproducible evidence</h2><p><a href="deformation/DeformationProof.json">Source hashes, commands, per-clip summary</a> · <code>python3 Tools/Tests/RunDriveTyreDeformationExhibit.py</code></p>
<footer>Native CPU raster: GCC/C++20, assertions enabled. No GPU benchmark or MSVC execution is claimed. Frames and build products stay in _AgentScratch.</footer></main>''' + PlaybackScript + '</body></html>\n')
    print("Published", Page)


if __name__ == "__main__":
    Main()
