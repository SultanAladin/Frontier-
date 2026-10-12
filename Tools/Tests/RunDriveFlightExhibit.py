#!/usr/bin/env python3
"""Publish verified recorded Drive motion through the shared CPU raster, with energy/parking failures preserved."""
from pathlib import Path
import argparse
import base64
import concurrent.futures
import gzip
import hashlib
import html
import json
import os
import shutil
import subprocess
import sys
from DependencyCodec import RestoreVulkanHeaders

Root = Path(__file__).resolve().parents[2]
LocalPython = Root / "_AgentScratch/tmp/python-tools"
if LocalPython.exists():
    sys.path.insert(0, str(LocalPython))
from PIL import Image, ImageDraw, ImageFont, ImageSequence
import numpy as Numpy
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as Plot
import imageio_ffmpeg

Parser = argparse.ArgumentParser(description=__doc__)
Parser.add_argument("--after", type=Path, default=Root / "_AgentScratch/tmp/DriveFlightAfter")
Parser.add_argument("--baseline", type=Path, default=Root / "_AgentScratch/tmp/DriveReconstructionStart")
Parser.add_argument("--compiler", default=os.environ.get("CXX", "cl.exe" if sys.platform == "win32" else "g++"))
Parser.add_argument("--jobs", type=int, default=2, choices=range(1, 5))
Parser.add_argument("--compile-only", action="store_true")
Parser.add_argument("--publish-only", action="store_true")
Arguments = Parser.parse_args()
After, Before = Arguments.after.resolve(), Arguments.baseline.resolve()
Gallery = Root / "Exhibits/Gallery/ProjectDrive"
Build, Raw = Root / "_AgentScratch/build/DriveTumbleRender", Root / "_AgentScratch/tmp/DriveFlightRenders"
for Folder in [Gallery / "flight", Gallery / "motion", Gallery / "charts", Build, Raw]:
    Folder.mkdir(parents=True, exist_ok=True)

Sources = ["Engine/DisplayPresentation/ShadingTableCodec.cpp", "Engine/ContentInterchange/MaterialIndex.cpp",
           "Engine/GeometricRaster/SceneStructure.cpp", "Engine/GeometricRaster/GeometryStructure.cpp",
           "Engine/DeviceExchange/OrientationClassifier.cpp", "Engine/GeometricRaster/VisibilityRaster.cpp",
           "Engine/GeometricRaster/DistanceFieldStructure.cpp", "Engine/DisplayPresentation/CelestialSolver.cpp",
           "Engine/GeometricRaster/StarCatalogueIndex.cpp", "Exhibits/Workbench/Automotive/DriveTumbleRender.cpp"]
Headers = sorted(File for Folder in ["Engine", "Projects/Project-Drive/Source"] for File in (Root / Folder).rglob("*") if File.suffix in [".h", ".inl"])


def Hash(File):
    return hashlib.sha256(File.read_bytes()).hexdigest()


def RendererFingerprint():
    return {str(File.relative_to(Root)): Hash(File) for File in [*(Root / Source for Source in Sources), *Headers]}


RendererHashes = RendererFingerprint()
RendererIdentity = hashlib.sha256(json.dumps(RendererHashes, sort_keys=True).encode()).hexdigest()
Windows = sys.platform == "win32"
Executable = Build / ("DriveTumbleRender.exe" if Windows else "DriveTumbleRender")
Commands = []
if Arguments.publish_only and (Build / "CompilationProof.json").exists():
    Compilation = json.loads((Build / "CompilationProof.json").read_text())
    assert Compilation["sourceSHA256"] == RendererHashes
    Commands = Compilation["commands"]
if not Arguments.publish_only:
    IncludePaths = [Root / Folder for Folder in ["Engine", "Engine/Shaders", "Engine/DisplayPresentation", "Engine/ContentInterchange", "Engine/DeviceExchange", "Engine/GeometricRaster"]]
    IncludePaths.append(RestoreVulkanHeaders())
    Flags = ["/nologo", "/std:c++20", "/EHsc", "/utf-8", "/O2", "/MD", "/DNOMINMAX", "/DFRONTIER_CPU_PORT", "/Gy"] if Windows else ["-std=c++20", "-O2", "-DFRONTIER_CPU_PORT", "-ffunction-sections", "-fdata-sections", "-pthread"]
    Flags += [("/I" if Windows else "-I") + str(Folder) for Folder in IncludePaths]
    LastHeader = max(File.stat().st_mtime_ns for File in Headers)
    Objects = []
    for Source in Sources:
        Output = Build / (Source.replace("/", "_") + (".obj" if Windows else ".o"))
        if not Output.exists() or Output.stat().st_mtime_ns < max(LastHeader, (Root / Source).stat().st_mtime_ns):
            Command = [Arguments.compiler, *Flags, "/c" if Windows else "-c", str(Root / Source)]
            Command += [f"/Fo:{Output}"] if Windows else ["-o", str(Output)]
            Commands.append(Command); subprocess.run(Command, cwd=Root, check=True)
        Objects.append(str(Output))
    Command = [Arguments.compiler, "/nologo", *Objects, f"/Fe:{Executable}", "/link", "/OPT:REF"] if Windows else [Arguments.compiler, *Objects, "-Wl,--gc-sections", "-pthread", "-o", str(Executable)]
    Commands.append(Command); subprocess.run(Command, cwd=Root, check=True)
    (Build / "CompilationProof.json").write_text(json.dumps({"commands": Commands, "sourceSHA256": RendererHashes}, indent=2) + "\n")
assert RendererFingerprint() == RendererHashes
if Arguments.compile_only:
    print("PASS compiled current shared CPU recorded-motion renderer", flush=True); sys.exit(0)

Audit = json.loads((After / "FlightAudit.json").read_text())
PhysicsProof = json.loads((After / "SourceProof.json").read_text())
for Filename, Expected in PhysicsProof["sourceSHA256"].items():
    assert Hash(Root / Filename) == Expected, "Recordings do not match current source: " + Filename
assert not PhysicsProof["shortened"] and len(Audit["cases"]) == 68
from CheckDriveFlightDeformation import Validate as CheckShapeRate
CheckShapeRate(After)
DeformationProof = json.loads((After / "FlightDeformationProof.json").read_text())
Cases = {Case["name"]: Case for Case in Audit["cases"]}
FontPath = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
Font = ImageFont.truetype(str(FontPath), 10) if FontPath.exists() else ImageFont.load_default()
Jobs = []
for Name in sorted(Cases):
    if Name.startswith("launch-"):
        Jobs.append((Name, 0, 120, 4))
    elif Name.startswith("air-"):
        Jobs.append((Name, 0 if Name in ["air--1_0_1", "air-1_-1_-1"] else 80, 120, 4))
    elif Name in ["landing--1_0_1", "landing-0_0_1", "landing-1_-1_-1"]:
        Jobs.append((Name, 0, 160, 4))
    elif Name in ["slope-20-heading-0-brakes-1", "slope-20-heading-180-brakes-1", "slope-20-heading-90-brakes-1", "slope-20-heading--90-brakes-1",
                  "slope-20-heading-0-brakes-2", "slope-20-heading-180-brakes-2", "slope-20-heading-0-brakes-0", "limit-35-heading-90-friction-0", "limit-35-heading-0-friction-80", "limit-35-heading-90-friction-80"]:
        Jobs.append((Name, 0, round(Cases[Name]["seconds"] * 20), 8))


def Animate(Job):
    Name, First, Final, Stride = Job
    Recording, Terrain = After / (Name + ".frames"), After / (Name + ".terrain")
    Output, Poster, Sidecar = Raw / (Name + ".gif"), Raw / (Name + ".png"), Raw / (Name + ".json")
    Expected = {"recordingSHA256": Hash(Recording), "terrainSHA256": Hash(Terrain), "rendererFingerprint": RendererIdentity,
        "firstFrame": First, "finalFrameExclusive": Final, "stride": Stride, "rasterExtent": 320, "shadowMapSide": 0, "renderMode": "flat-matcap-diagnostic"}
    if Output.exists() and Poster.exists() and Sidecar.exists():
        Saved = json.loads(Sidecar.read_text())
        if all(Saved.get(Key) == Value for Key, Value in Expected.items()) and Hash(Output) == Saved["gifSHA256"]:
            return Saved
    assert not Arguments.publish_only, "Missing matching actual-motion render: " + Name
    Folder = Raw / Name
    if Folder.exists():
        shutil.rmtree(Folder)
    Invocation = [str(Executable), str(Recording), str(Folder), str(Stride), str(First), str(Final)]
    subprocess.run(Invocation, cwd=Root, check=True)
    Rows = Numpy.genfromtxt(After / (Name + ".csv"), delimiter=",", names=True)
    Pictures = []
    for File in sorted(Folder.glob("*.png"), key=lambda Entry: int(Entry.stem)):
        Time = (int(File.stem) + 1) / 20; Row = Rows[Numpy.argmin(Numpy.abs(Rows["t"] - Time))]
        Picture = Image.open(File).convert("RGB"); Surface = Image.new("RGB", (320, 414), "#111d2a"); Surface.paste(Picture, (0, 94))
        Pen = ImageDraw.Draw(Surface)
        Pen.text((8, 6), Name, font=Font, fill="#e4eefb")
        Pen.text((8, 24), f"Actual t={Time:.2f}s | angular {Row['angular_speed']:.2f} rad/s", font=Font, fill="#c3d9e9")
        Pen.text((8, 41), f"Mechanical change {Row['increase_J']:+.1f} J", font=Font, fill="#ffd28b")
        Pen.text((8, 58), f"Radius {Row['radius_m']:.4f}m | {'AIRBORNE' if Row['airborne'] else 'CONTACT'}", font=Font, fill="#c3d9e9")
        Pen.text((8, 76), "Fast flat CPU raster | actual nodes | seated beads", font=Font, fill="#9cb8d2")
        Pictures.append(Surface.quantize(colors=128, dither=Image.Dither.NONE))
    assert len(Pictures) == len(range(First, Final, Stride)) and len(Pictures) >= 10
    Pictures[0].save(Output, save_all=True, append_images=Pictures[1:], duration=Stride * 50, loop=0, disposal=2, optimize=False)
    Pictures[0].convert("RGB").save(Poster)
    Saved = dict(Expected, case=Name, sourceFrames=len(Pictures), firstSimulationTimeS=(First + 1) / 20,
        lastSimulationTimeS=(Final - Stride + 1) / 20, gifSHA256=Hash(Output), posterSHA256=Hash(Poster),
        actualMotion=True, renderer="Engine/GeometricRaster/VisibilityRaster", invocation=Invocation)
    Sidecar.write_text(json.dumps(Saved, indent=2) + "\n"); shutil.rmtree(Folder)
    print("Rendered actual motion:", Name, flush=True); return Saved


with concurrent.futures.ThreadPoolExecutor(max_workers=Arguments.jobs) as Executor:
    MotionProof = list(Executor.map(Animate, Jobs))
assert RendererFingerprint() == RendererHashes
for Filename, Expected in PhysicsProof["sourceSHA256"].items():
    assert Hash(Root / Filename) == Expected
for Phase, Folder in [("after", After), ("reconstruction-start", Before)]:
    for Filename in ["FlightResults.json", "FlightAudit.json", "SourceProof.json"]:
        shutil.copyfile(Folder / Filename, Gallery / "flight" / (Phase + "-" + Filename))
    Destination = Gallery / "flight/traces" / Phase; Destination.mkdir(parents=True, exist_ok=True)
    for File in Folder.glob("*.csv"):
        with (Destination / (File.stem + ".csv.gz")).open("wb") as Stream:
            with gzip.GzipFile(filename=File.name, mode="wb", fileobj=Stream, mtime=0) as Compressed:
                Compressed.write(File.read_bytes())
shutil.copyfile(After / "FlightDeformationProof.json", Gallery / "flight/FlightDeformationProof.json")
for Proof in MotionProof:
    for Extension in ["gif", "png"]:
        shutil.copyfile(Raw / (Proof["case"] + "." + Extension), Gallery / "motion" / (Proof["case"] + "." + Extension))

VideoProof = []
for Section, Filename in [("flight", "flying-and-tumbling.mp4"), ("parking", "incline-parking.mp4")]:
    Selected = [Proof for Proof in MotionProof if (not Proof["case"].startswith(("slope-", "limit-"))) == (Section == "flight")]
    VideoPath = Gallery / "flight" / Filename
    Invocation = [imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "320x414", "-r", "10", "-i", "-", "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(VideoPath)]
    Chapters, FrameCount = [], 0
    with subprocess.Popen(Invocation, stdin=subprocess.PIPE) as Encoder:
        for Proof in Selected:
            Chapters.append({"case": Proof["case"], "videoStartS": FrameCount / 10})
            with Image.open(Raw / (Proof["case"] + ".gif")) as Animation:
                for Picture in ImageSequence.Iterator(Animation):
                    Duration = Picture.info.get("duration", Proof["stride"] * 50); Repetitions = round(Duration / 100)
                    assert Repetitions > 0 and abs(Duration - Repetitions * 100) < 1
                    Pixels = Picture.convert("RGB").tobytes()
                    for Repeat in range(Repetitions):
                        Encoder.stdin.write(Pixels); FrameCount += 1
        Encoder.stdin.close(); assert Encoder.wait() == 0
    VideoProof.append({"file": Filename, "sha256": Hash(VideoPath), "durationS": FrameCount / 10, "chapters": Chapters, "interpolatedPoses": False, "invocation": Invocation})
    print("Encoded actual-motion video:", Filename, flush=True)

Plot.rcParams.update({"figure.facecolor": "#f4f7fb", "axes.facecolor": "white", "font.size": 9})
Charts = []


def SaveChart(Name):
    File = Gallery / "charts" / (Name + ".png"); Plot.savefig(File, dpi=140, bbox_inches="tight"); Plot.close(); Charts.append(File)


Air = sorted(Name for Name in Cases if Name.startswith("air-")); Positions = Numpy.arange(len(Air))
BeforeCases = {Case["name"]: Case for Case in json.loads((Before / "FlightAudit.json").read_text())["cases"]}
Plot.figure(figsize=(12, 5))
Plot.bar(Positions - 0.2, [BeforeCases[Name]["peakIncreaseJ"] for Name in Air], width=0.4, label="Reconstruction start (0.5 s only)", color="#c8674d")
Plot.bar(Positions + 0.2, [Cases[Name]["peakIncreaseJ"] for Name in Air], width=0.4, label="Reconstructed production (6 s)", color="#28719e")
Plot.plot(Positions, [Cases[Name]["energyBudgetJ"] for Name in Air], color="#333", label="Unchanged 100 J / 0.1% allowance")
Plot.xticks(Positions, [Name[4:] for Name in Air], rotation=65, ha="right"); Plot.ylabel("Peak modeled mechanical increase [J]")
Plot.title("All 26 signed free-flight directions; initial altitude cannot pad the budget"); Plot.legend(); SaveChart("signed-air-energy")
Figure, Axes = Plot.subplots(2, 2, figsize=(11, 7))
for Axis, Name in zip(Axes.flat, sorted(Name for Name in Cases if Name.startswith("launch-"))):
    Rows = Numpy.genfromtxt(After / (Name + ".csv"), delimiter=",", names=True); Axis.plot(Rows["t"], Rows["increase_J"])
    Axis.axhline(Cases[Name]["energyBudgetJ"], color="#a54f35", linestyle="--"); Axis.set_title(Name); Axis.set_xlabel("Time [s]"); Axis.set_ylabel("Mechanical change [J]"); Axis.grid(alpha=0.2)
Figure.suptitle("Actual two-wheel strikes, airborne inversion and landing"); Figure.tight_layout(); SaveChart("launch-energy")
Figure, Axes = Plot.subplots(1, 3, figsize=(13, 4))
for Axis, Name in zip(Axes.flat, ["landing-0_0_1", "landing--1_0_1", "landing-1_-1_-1"]):
    Rows = Numpy.genfromtxt(After / (Name + ".csv"), delimiter=",", names=True)
    for Field, Label in [("increase_J", "Mechanical change"), ("contact_elastic_J", "Ground compliance"), ("carcass_J", "Carcass elastic")]:
        Axis.plot(Rows["t"], Rows[Field], label=Label)
    Axis.set_yscale("symlog", linthresh=100); Axis.set_title(Name); Axis.set_xlabel("Time [s]"); Axis.set_ylabel("Energy [J]")
Axes.flat[0].legend(fontsize=7); Figure.suptitle("Hard-landing energy failures remain visible, not cropped or clipped"); Figure.tight_layout(); SaveChart("hard-landing-energy")
Figure, Axes = Plot.subplots(2, 2, figsize=(11, 7))
for Axis, Heading in zip(Axes.flat, [0, 180, 90, -90]):
    for Brakes, Label in [(0, "Released"), (1, "Service brake"), (2, "Rear parking brake")]:
        Rows = Numpy.genfromtxt(After / (f"slope-20-heading-{Heading}-brakes-{Brakes}.csv"), delimiter=",", names=True)
        Axis.plot(Rows["t"], Rows["parking_drift_m"] * 1000, label=Label)
    Axis.set_title(f"20-degree slope, heading {Heading}"); Axis.set_ylabel("Tangent drift after 2 s [mm]"); Axis.set_xlabel("Time [s]"); Axis.grid(alpha=0.2)
Axes.flat[0].legend(fontsize=8); Figure.tight_layout(); SaveChart("parking-directions")
Names = sorted(Cases); Figure, Axes = Plot.subplots(2, 1, figsize=(12, 6))
Axes[0].bar(range(68), [Cases[Name]["radiusM"] * 1000 for Name in Names]); Axes[0].axhline(508.55 * 1.05, color="#b44e35", linestyle="--"); Axes[0].set_ylabel("Peak radius [mm]")
Axes[1].bar(range(68), [Cases[Name]["airShapeMaxM"] * 1000 for Name in Names]); Axes[1].axhline(35, color="#b44e35", linestyle="--"); Axes[1].set_ylabel("Peak air node offset [mm]")
Axes[1].set_xticks(range(68)); Axes[1].set_xticklabels(Names, rotation=90, fontsize=5); Figure.suptitle("Every case, every 240 Hz tick: expansion/deformation"); Figure.tight_layout(); SaveChart("all-case-deformation")
Wobble = sorted(DeformationProof["cases"], key=lambda Measurement: Measurement["case"]); Positions = Numpy.arange(26)
Plot.figure(figsize=(12, 5)); Plot.bar(Positions - 0.2, [Measurement["positionDerivativeRmsPeakMPerS"] * 1000 for Measurement in Wobble], width=0.4, label="Late position-derived shape rate")
Plot.bar(Positions + 0.2, [Measurement["lateParticleVelocityMinusEndpointRimRmsMeanMPerS"] * 1000 for Measurement in Wobble], width=0.4, label="Particle/endpoint-rim velocity timing residual")
Plot.yscale("log"); Plot.xticks(Positions, [Measurement["case"][4:] for Measurement in Wobble], rotation=65, ha="right"); Plot.ylabel("RMS speed [mm/s]"); Plot.legend(fontsize=8); SaveChart("wobble-and-velocity-timing")


def Embed(File):
    return "data:image/" + ("gif" if File.suffix == ".gif" else "png") + ";base64," + base64.b64encode(File.read_bytes()).decode()


Cards = []
for Proof in MotionProof:
    Name = Proof["case"]; Case = Cases[Name]
    Group = "launch" if Name.startswith("launch-") else "air" if Name.startswith("air-") else "landing" if Name.startswith("landing-") else "parking"
    Failed = ", ".join(Check for Check, Passed in Case["checks"].items() if not Passed)
    Cards.append((Group, f'''<article><h3>{html.escape(Name)}</h3><img loading="lazy" src="motion/{Name}.gif" alt="Actual recorded chassis and every tyre particle: {Name}"><p class="{'pass' if Case['passed'] else 'fail'}">{'Necessary screens pass' if Case['passed'] else 'OPEN: '+html.escape(Failed)}</p><p>Shown {Proof['firstSimulationTimeS']:.2f}–{Proof['lastSimulationTimeS']:.2f} s of {Case['seconds']:.0f} s. Airborne {Case['longestAirS']:.3f} s, primary-flight up-Z {Case['primaryFlightMinimumUpZ']:.3f}; peak radius {Case['radiusM']*1000:.2f} mm.</p><a href="motion/{Name}.gif" download>Download GIF</a> · <a href="flight/traces/after/{Name}.csv.gz">Complete 240 Hz trace</a></article>'''))
Sections = []
for Group, Title, Description in [("launch", "Two-wheel ramp flips", "Both sides, 30/40 m/s initial speed, zero motor work. Collision must cause the angular motion; no scripted flip."),
    ("air", "26 signed midair directions", "Six seconds, 12 rad/s initial spin, gravity on, disconnected drive and zero chassis damping. Most GIFs show the last two seconds; critical diagonals show all six."),
    ("landing", "Spinning landings", "Eight-second contact evolutions, 8 rad/s initial spin. Round-looking tyres do not invalidate failing energy peaks."),
    ("parking", "Uphill, downhill and both sideways headings", "Service/rear brakes, released wheels and friction controls. Tangent drift excludes normal settling; legitimate rolling/sliding is not artificial acceleration.")]:
    Sections.append(f'<section id="{Group}"><h2>{Title}</h2><p>{Description}</p><div class="cards">'+''.join(Card for Key, Card in Cards if Key==Group)+'</div></section>')
Rows = []
for Name in Names:
    Case = Cases[Name]; Failed = ", ".join(Check for Check, Passed in Case["checks"].items() if not Passed)
    Rows.append(f"<tr><td><a href='flight/traces/after/{Name}.csv.gz'>{html.escape(Name)}</a></td><td class='{ 'pass' if Case['passed'] else 'fail' }'>{'PASS' if Case['passed'] else html.escape(Failed)}</td><td>{Case['peakIncreaseJ']:.1f} / {Case['energyBudgetJ']:.1f}</td><td>{Case['radiusM']*1000:.2f}</td><td>{Case['parkingDriftM']*1000:.3f}</td></tr>")
ChartHtml = ''.join(f'<figure><img src="{Embed(File)}" alt="{File.stem}"><figcaption>{File.stem.replace("-", " ")}</figcaption></figure>' for File in Charts)
Passing = sum(Case["passed"] for Case in Cases.values()); Featured = Embed(Gallery / "motion/launch-left-40.gif")
Document = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Drive reconstructed — flying and slope parking</title><style>:root{{color-scheme:dark;font:15px/1.55 system-ui;background:#0d1520;color:#deebf8}}body{{margin:0}}header,main{{max-width:1250px;margin:auto;padding:28px}}h1{{font-size:clamp(32px,5vw,58px);line-height:1.1}}h2{{margin-top:45px}}p{{color:#b7cadd}}a{{color:#81ccf5}}.notice{{background:#302416;border:1px solid #b98742;padding:20px;border-radius:10px}}nav,.stats{{display:flex;gap:18px;flex-wrap:wrap}}.stats{{margin:24px 0}}.stats b{{font-size:28px}}.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}}article{{background:#142131;border:1px solid #2b4259;border-radius:10px;padding:14px}}article img{{width:100%}}article p{{font-size:12px}}h3{{font-size:14px;overflow-wrap:anywhere}}.pass{{color:#8ed8b4}}.fail{{color:#ffc084}}figure{{background:#f4f7fb;padding:10px;margin:22px 0;border-radius:10px;color:#28425a}}figure img{{width:100%}}figcaption{{font-size:12px;text-align:center}}.scroll{{overflow-x:auto}}table{{width:100%;border-collapse:collapse;font-size:11px}}td,th{{padding:8px;border-bottom:1px solid #29425c;text-align:left}}video{{width:min(100%,640px)}}.featured{{width:min(100%,480px)}}footer{{margin-top:40px;border-top:1px solid #29425c;padding-top:20px}}</style></head><body><header><p>Third reconstruction · fresh production measurements · 12 October 2026</p><h1>Flying, flipping<br>and parking on grades.</h1><nav><a href="#launch">Two-wheel flips</a><a href="#air">26 midair directions</a><a href="#landing">Landings</a><a href="#parking">Slope parking</a><a href="#measurements">Measurements</a><a href="render-references.html">Fresh render references</a></nav><div class="stats"><span><b>68</b> cases</span><span><b>43</b> actual GIFs</span><span><b>{Passing}/68</b> necessary-screen passes</span><span><b>240 Hz</b> traces</span></div><div class="notice"><strong>{'Necessary bounds pass; conservation still unclosed.' if Audit['passed'] else 'Physics sign-off incomplete: failures are preserved below.'}</strong><p>NEW results from remotely checkpointed reconstructed code, not missing historical results. The orange comparison is a fresh half-second diagnostic, not the lost full BEFORE dataset. No live Windows/AMD/Vulkan/GPU certification or universal stability guarantee.</p></div><p>Actual chassis and all solved tyre nodes; shared CPU raster, diagnostic materials/simplified amber rims. No artwork generation, static-orbit substitution, pose interpolation, radius/velocity clamps or added damping.</p><img class="featured" src="{Featured}" alt="Actual 40 m/s two-wheel airborne ramp flip"></header><main><h2>Actual motion as video</h2><video controls preload="metadata" src="flight/flying-and-tumbling.mp4"></video><p><a href="flight/flying-and-tumbling.mp4" download>Flying/tumbling video</a></p><video controls preload="metadata" src="flight/incline-parking.mp4"></video><p><a href="flight/incline-parking.mp4" download>Incline-parking video</a></p>{''.join(Sections)}<section id="measurements"><h2>Mechanical energy and deformation diagnostics</h2><p>Body, particles, rim translation/absolute axial spin, referenced gravity for all represented mass, carcass/gas, floored/preloaded springs/bars, bump/rim stops, ground compliance and active bristles. Unchanged 100 J / 0.1% bounds. Partitioned hub/strut timing/work remains unclosed.</p>{ChartHtml}<div class="notice"><strong>Position wobble and velocity timing are distinct.</strong><p>Recorded position derivatives remove solved material poses; raw particle/endpoint-rim velocity residuals expose remaining consistency issues. 20 Hz derivatives cannot exclude above-Nyquist vibration. Full 240 Hz scalar deformation traces remain available.</p><a href="flight/FlightDeformationProof.json">Independent deformation proof</a></div><h2>Every case and failed check</h2><div class="scroll"><table><thead><tr><th>Case / full trace</th><th>Result</th><th>Increase / allowance [J]</th><th>Radius [mm]</th><th>Park drift [mm]</th></tr></thead><tbody>{''.join(Rows)}</tbody></table></div></section><footer><a href="flight/ReconstructedSource.patch" download>Download source recovery patch</a> · <a href="render-references.html">Fresh CPU raster/SDF/ReSTIR references</a> · <a href="flight/after-FlightAudit.json">Current audit</a> · <a href="flight/after-SourceProof.json">Source/output hashes</a> · <a href="flight/MotionProof.json">Media provenance</a><p>5 Hz flight/2.5 Hz parking excerpts from 20 Hz recorded poses, no interpolation. Source is committed and pushed to the fixed arena/561c913e-frontier branch.</p></footer></main></body></html>'''
MainFile = Gallery / "flight-and-slopes.html"; MainFile.write_text(Document); (Gallery / "index.html").write_text(Document)
Proof = {"date": "2026-10-12", "cpuOnly": True, "generatedArtwork": False, "physicsPassed": Audit["passed"], "energyAccountClosed": False,
    "commands": Commands, "rendererSHA256": RendererHashes, "clips": MotionProof, "videos": VideoProof, "pageSHA256": Hash(MainFile),
    "physicsSourceProofSHA256": Hash(After / "SourceProof.json"), "deformationProofSHA256": Hash(After / "FlightDeformationProof.json"),
    "charts": {File.name: Hash(File) for File in Charts}, "reconstructionStartIsShortened": True, "historicalMissingMediaReused": False}
(Gallery / "flight/MotionProof.json").write_text(json.dumps(Proof, indent=2) + "\n")
from PlaybackCodec import ConfigureGallery
ConfigureGallery(Gallery)
print(f"PUBLISHED 43 actual GIFs / 2 MP4s, {Passing}/68 necessary-screen passes: {MainFile}", flush=True)
