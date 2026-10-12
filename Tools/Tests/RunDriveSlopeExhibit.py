#!/usr/bin/env python3
"""Fast flat recorded-motion braking/rim-seat exhibit with signed grade diagnostics and exclusive paused clips."""
from pathlib import Path
import argparse
import base64
import concurrent.futures
import gzip
import hashlib
import html
import json
import shutil
import subprocess
import sys
import time

Root = Path(__file__).resolve().parents[2]
LocalPython = Root / "_AgentScratch/tmp/python-tools"
if LocalPython.exists():
    sys.path.insert(0, str(LocalPython))
from PIL import Image, ImageDraw, ImageFont
import numpy as Numpy
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as Plot
from PlaybackCodec import EncodeClip, ConfigureGallery, PlaybackScript

Parser = argparse.ArgumentParser(description=__doc__)
Parser.add_argument("--input", type=Path, default=Root / "_AgentScratch/tmp/DriveSlopeVerified")
Parser.add_argument("--before", type=Path, default=Root / "_AgentScratch/tmp/DriveSlopeAfter")
Parser.add_argument("--jobs", type=int, default=2, choices=range(1, 5))
Parser.add_argument("--publish-only", action="store_true")
Arguments = Parser.parse_args()
Folder, Before = Arguments.input.resolve(), Arguments.before.resolve()
Gallery = Root / "Exhibits/Gallery/ProjectDrive"
Raw = Root / "_AgentScratch/tmp/DriveSlopeRenders"
for Destination in [Raw, Gallery / "motion", Gallery / "brakes", Gallery / "charts"]:
    Destination.mkdir(parents=True, exist_ok=True)
if not Arguments.publish_only:
    subprocess.run([sys.executable, str(Root / "Tools/Tests/RunDriveFlightExhibit.py"), "--compile-only"], cwd=Root, check=True)
Renderer = Root / "_AgentScratch/build/DriveTumbleRender" / ("DriveTumbleRender.exe" if sys.platform == "win32" else "DriveTumbleRender")
RendererProof = json.loads((Renderer.parent / "CompilationProof.json").read_text())
Audit = json.loads((Folder / "SlopeAudit.json").read_text())
SourceProof = json.loads((Folder / "SlopeSourceProof.json").read_text())
Cases = {Case["name"]: Case for Case in Audit["cases"]}
assert len(Cases) == 14


def Hash(File):
    return hashlib.sha256(File.read_bytes()).hexdigest()


for Name, Expected in SourceProof["sourceSHA256"].items():
    assert Hash(Root / Name) == Expected, "Refuse stale source evidence: " + Name
for Name, Expected in RendererProof["sourceSHA256"].items():
    assert Hash(Root / Name) == Expected
RendererIdentity = hashlib.sha256(json.dumps(RendererProof["sourceSHA256"], sort_keys=True).encode()).hexdigest()
FontFile = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
Font = ImageFont.truetype(str(FontFile), 10) if FontFile.exists() else ImageFont.load_default()
Jobs = [(Name, "overview") for Name in sorted(Cases)]
Jobs += [("moving-20-heading-90-brakes-1", "bead"), ("moving-20-heading-0-brakes-2", "bead"), ("moving-35-downhill-service", "bead")]


def Animate(Job):
    Name, View = Job
    Key = Name if View == "overview" else Name + "-rim-closeup"
    Output, Poster, Witness = Raw / (Key + ".gif"), Raw / (Key + ".png"), Raw / (Key + ".json")
    First = 0 if View == "overview" else 80
    Final = round(Cases[Name]["seconds"] * 20) if View == "overview" else 140
    Stride = 4
    Expected = {"recordingSHA256": Hash(Folder / (Name + ".frames")), "terrainSHA256": Hash(Folder / (Name + ".terrain")),
                "rendererFingerprint": RendererIdentity, "view": View, "firstFrame": First, "lastFrameExclusive": Final, "stride": Stride}
    if Witness.exists() and Output.exists() and Poster.exists():
        Proof = json.loads(Witness.read_text())
        if all(Proof.get(Key) == Value for Key, Value in Expected.items()) and Proof["gifSHA256"] == Hash(Output):
            return Proof
    assert not Arguments.publish_only, "Missing matching flat render: " + Key
    Destination = Raw / Key
    if Destination.exists():
        shutil.rmtree(Destination)
    Command = [str(Renderer), str(Folder / (Name + ".frames")), str(Destination), str(Stride), str(First), str(Final), "flat", "bead" if View == "bead" else "overview"]
    Start = time.perf_counter()
    subprocess.run(Command, cwd=Root, check=True)
    Elapsed = time.perf_counter() - Start
    Rows = Numpy.genfromtxt(Folder / (Name + ".csv"), delimiter=",", names=True)
    Pictures = []
    for File in sorted(Destination.glob("*.png"), key=lambda File: int(File.stem)):
        Time = (int(File.stem) + 1) / 20
        Row = Rows[Numpy.argmin(Numpy.abs(Rows["t"] - Time))]
        Picture = Image.open(File).convert("RGB")
        Surface = Image.new("RGB", (320, 434), "#111d2a"); Surface.paste(Picture, (0, 114))
        Pen = ImageDraw.Draw(Surface)
        Phase = "HOLD" if Row["phase"] == 0 else "DRIVE" if Row["phase"] == 1 else "BRAKE / COAST"
        Pen.text((7, 5), Name, font=Font, fill="#edf5ff")
        Pen.text((7, 22), f"Actual {Time:.2f}s | {Phase} | speed {Row['tangent_speed']:.3f}m/s", font=Font, fill="#bcd8e9")
        Pen.text((7, 39), f"Uphill +X: {Row['uphill_m']:+.3f}m | v {Row['uphill_speed']:+.3f}m/s", font=Font, fill="#ffd08d")
        Pen.text((7, 56), f"Across +Y: {Row['across_m']:+.3f}m | height/N {Row['normal_height_m']:.3f}m", font=Font, fill="#bcd8e9")
        Pen.text((7, 73), f"Brake power {Row['brake_power_W']:+.1f}W | bead {Row['native_bead_gap_m']*1000:.4f}mm", font=Font, fill="#bcd8e9")
        Pen.text((7, 91), "Actual solved nodes | fast flat/matcap | no lights/shadows", font=Font, fill="#9fb5c9")
        Pictures.append(Surface.quantize(colors=128, dither=Image.Dither.NONE))
    assert len(Pictures) == len(range(First, Final, Stride))
    Pictures[0].save(Output, save_all=True, append_images=Pictures[1:], duration=Stride * 50, loop=0, disposal=2, optimize=False)
    Pictures[0].convert("RGB").save(Poster)
    Proof = dict(Expected, key=Key, case=Name, gifSHA256=Hash(Output), posterSHA256=Hash(Poster), sourceFrames=len(Pictures),
                 secondsShown=(Final-First)/20, flatRenderWallSeconds=Elapsed, command=Command, actualMotion=True, frameInterpolation=False)
    Witness.write_text(json.dumps(Proof, indent=2) + "\n"); shutil.rmtree(Destination)
    print("Flat-rendered", Key, f"{len(Pictures)} frames / {Elapsed:.3f}s", flush=True)
    return Proof


with concurrent.futures.ThreadPoolExecutor(max_workers=Arguments.jobs) as Executor:
    Motion = list(Executor.map(Animate, Jobs))
for Proof in Motion:
    for Extension in ["gif", "png"]:
        shutil.copyfile(Raw / (Proof["key"] + "." + Extension), Gallery / "motion" / (Proof["key"] + "." + Extension))
    Proof["playback"] = EncodeClip(Gallery / "motion" / (Proof["key"] + ".gif"), Gallery / "motion" / (Proof["key"] + ".mp4"))
for Name in ["SlopeAudit.json", "SlopeResults.json", "SlopeSourceProof.json"]:
    shutil.copyfile(Folder / Name, Gallery / "brakes" / Name)
TraceDestination = Gallery / "brakes/traces"; TraceDestination.mkdir(exist_ok=True)
for File in Folder.glob("*.csv"):
    with (TraceDestination / (File.stem + ".csv.gz")).open("wb") as Stream:
        with gzip.GzipFile(filename=File.name, mode="wb", fileobj=Stream, mtime=0) as Compressed:
            Compressed.write(File.read_bytes())
RimProof = json.loads((Root / "_AgentScratch/tmp/DriveRimSeat/AuthoredRimSeatProof.json").read_text())
shutil.copyfile(Root / "_AgentScratch/tmp/DriveRimSeat/AuthoredRimSeatProof.json", Gallery / "brakes/AuthoredRimSeatProof.json")
Plot.rcParams.update({"figure.facecolor": "#f4f7fb", "axes.facecolor": "white", "font.size": 9})
Charts = []


def Save(Name):
    File = Gallery / "charts" / (Name + ".png"); Plot.savefig(File, dpi=135, bbox_inches="tight"); Plot.close(); Charts.append(File)


Figure, Axes = Plot.subplots(2, 2, figsize=(12, 7))
for Axis, Heading in zip(Axes.flat, [0, 180, 90, -90]):
    for Brakes, Label in [(0, "Released"), (1, "Service"), (2, "Rear only")]:
        Name = f"moving-20-heading-{Heading}-brakes-{Brakes}"
        Rows = Numpy.genfromtxt(Folder / (Name + ".csv"), delimiter=",", names=True)
        Axis.plot(Rows["t"], Rows["tangent_speed"], label=Label)
    Axis.axvline(1.5, color="#777", linestyle=":"); Axis.axvline(3.5, color="#333", linestyle="--")
    Axis.set_title(f"20 degrees; heading {Heading}"); Axis.set_xlabel("Time [s]"); Axis.set_ylabel("Tangent speed [m/s]"); Axis.grid(alpha=.2)
Axes.flat[0].legend(); Figure.suptitle("Actual powered approach, moving brake application, and hold/sliding behaviour")
Figure.tight_layout(); Save("moving-slope-brakes")
Figure, Axes = Plot.subplots(2, 1, figsize=(11, 7))
for Heading in [90, -90]:
    Name = f"moving-20-heading-{Heading}-brakes-1"
    Rows = Numpy.genfromtxt(Folder / (Name + ".csv"), delimiter=",", names=True)
    Axes[0].plot(Rows["t"], Rows["uphill_m"], label=f"Signed U; heading {Heading}")
    Axes[1].plot(Rows["t"], Rows["z"] - Rows["z"][0], label=f"World Z; heading {Heading}")
    Axes[1].plot(Rows["t"], Rows["vertical_from_uphill_m"], linestyle="--", label=f"Z from grade travel {Heading}")
    Axes[1].plot(Rows["t"], Rows["vertical_from_normal_m"], linestyle=":", label=f"Z from normal suspension motion {Heading}")
Axes[0].axhline(0, color="#333", linewidth=.8); Axes[0].set_ylabel("Uphill-positive displacement [m]"); Axes[1].set_ylabel("Vertical displacement [m]"); Axes[1].set_xlabel("Time [s]")
for Axis in Axes: Axis.legend(fontsize=8); Axis.grid(alpha=.2)
Figure.suptitle("Contour travel: world height is not the sign of uphill displacement")
Figure.tight_layout(); Save("signed-grade-vs-suspension")
Figure, Axes = Plot.subplots(2, 1, figsize=(11, 7))
for Name in ["moving-20-heading-180-brakes-1", "moving-20-heading-90-brakes-1", "moving-35-downhill-service"]:
    Rows = Numpy.genfromtxt(Folder / (Name + ".csv"), delimiter=",", names=True)
    Axes[0].plot(Rows["t"], Rows["brake_power_W"], label=Name)
    Axes[1].plot(Rows["t"], Rows["gearbox_drive_torque_Nm"], label=Name)
Axes[0].set_ylabel("Disc brake power [W]"); Axes[1].set_ylabel("Gearbox drive torque [N m]"); Axes[1].set_xlabel("Time [s]")
for Axis in Axes: Axis.axvline(3.5, color="#333", linestyle="--"); Axis.legend(fontsize=7); Axis.grid(alpha=.2)
Figure.suptitle("Brake work must be non-positive; idle drive must not fight held brakes")
Figure.tight_layout(); Save("brake-work-and-idle-torque")
Figure, Axes = Plot.subplots(1, 2, figsize=(11, 4))
for Axis, Heading in zip(Axes.flat, [90, -90]):
    Name = f"moving-20-heading-{Heading}-brakes-2"
    for Source, Label in [(Before, "Earlier contact rule"), (Folder, "Lateral-slip eligibility")]:
        Rows = Numpy.genfromtxt(Source / (Name + ".csv"), delimiter=",", names=True)
        Axis.plot(Rows["t"], Rows["tangent_speed"], label=Label)
    Axis.axvline(3.5, color="#333", linestyle="--"); Axis.set_title(f"Rear brake; heading {Heading}"); Axis.set_xlabel("Time [s]"); Axis.set_ylabel("Tangent speed [m/s]"); Axis.legend(fontsize=8); Axis.grid(alpha=.2)
Figure.suptitle("Remaining rear-brake cross-slope failures are retained, not labelled stopped")
Figure.tight_layout(); Save("rear-cross-slope-open")
Plot.figure(figsize=(8, 4)); Plot.bar(["Old physical shoulder-width anchor", "Corrected bead / authored rim"], [RimProof["oldShoulderWidthAnchor"]["maximumAuthoredSurfaceDistanceM"]*1000, RimProof["correctedRimSeat"]["maximumAuthoredSurfaceDistanceM"]*1000], color=["#c36f4d", "#2c849c"])
Plot.ylabel("Maximum nearest authored rim surface distance [mm]"); Plot.title("Actual rigid rim triangles, not only a cylindrical proxy"); Save("physical-bead-authored-rim-gap")


def Embed(File):
    return "data:image/png;base64," + base64.b64encode(File.read_bytes()).decode()


Cards = []
for Proof in Motion:
    Name, Key = Proof["case"], Proof["key"]; Case = Cases[Name]
    Failed = ", ".join(Check for Check, Passed in Case["checks"].items() if not Passed)
    Cards.append(f'''<article><h3>{html.escape(Key)}</h3><video controls loop muted playsinline preload="none" poster="motion/{Key}.png" src="motion/{Key}.mp4"></video><p class="{'pass' if Case['passed'] else 'fail'}">{'Measured checks pass' if Case['passed'] else 'OPEN: '+html.escape(Failed)}</p><p>Brake start {Case['brakeStartSpeed']:.3f} m/s; final {Case['finalSpeed']:.6f} m/s; stop time {Case['stopTime']:.3f} s. Drive-phase signed uphill displacement {Case['driveUphillM']:+.4f} m.</p><a href="motion/{Key}.gif" download>Original recorded GIF</a> · <a href="brakes/traces/{Name}.csv.gz">240 Hz trace</a></article>''')
ChartHtml = ''.join(f'<figure><img src="{Embed(File)}" alt="{File.stem}"></figure>' for File in Charts)
Passes = sum(Case["passed"] for Case in Cases.values())
Document = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Drive: moving slope brakes and tyre/rim seats</title><style>:root{{color-scheme:dark;font:15px/1.55 system-ui;background:#0d1520;color:#e0edf9}}body{{margin:0}}header,main{{max-width:1260px;margin:auto;padding:28px}}h1{{font-size:clamp(30px,4.5vw,52px);line-height:1.15}}a{{color:#8ad6fb}}p{{color:#bacee0}}.notice{{border:1px solid #aa8145;background:#302417;border-radius:10px;padding:20px}}.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:20px}}article{{background:#142334;border:1px solid #2b445b;border-radius:10px;padding:14px}}video{{width:100%}}h3{{font-size:14px;overflow-wrap:anywhere}}article p{{font-size:12px}}.pass{{color:#86d8b3}}.fail{{color:#ffc58b}}figure{{background:#f4f7fb;padding:9px;border-radius:10px;margin:22px 0}}figure img{{width:100%}}button{{border:0;border-radius:6px;background:#31759d;color:white;padding:9px 16px}}h2{{margin-top:40px}}</style></head><body><header><p>Actual production simulation · fast flat/matcap views · 12 October 2026</p><h1>Moving brakes, signed grade motion,<br>and seated tyre beads.</h1><button onclick="PauseClips()">Pause all clips</button><p>All clips start paused. Native play/pause controls resume the recorded frames; playing one pauses every other clip. Original GIF downloads remain available.</p><div class="notice"><strong>{Passes}/14 moving slope/brake/seat checks pass.</strong><p>The service brakes stop and hold in the measured 20-degree cases, including both contour headings. Remaining rear-only cross-slope sliding is marked OPEN. A rear parking brake is not an all-wheel service brake. These are new moving tests, not the historical 58/68 flight sign-off.</p></div><p>Plane normal (-sin θ,0,cos θ): positive U/+X is uphill; negative is downhill. Heading ±90 travels along contours. The traces separate world-Z height, true grade displacement, and suspension-normal motion.</p><p><a href="flight-and-slopes.html">Historical flying/tumbling recordings — now paused</a> · <a href="brakes/SlopeAudit.json">Moving brake audit</a> · <a href="brakes/AuthoredRimSeatProof.json">Authored rim-seat proof</a></p></header><main><h2>Measured diagnoses</h2><p>Brake torque must oppose rotor spin, brake power must be non-positive, and idle gearbox torque is zero while brakes are held. A corrected Coulomb projection and brake-at-speed eligibility replace the earlier contact defects; no pose/velocity clamps or extra damping are used.</p><p>The previous physical bead width used the tread shoulders. The authored-rim surface distance was {RimProof['oldShoulderWidthAnchor']['maximumAuthoredSurfaceDistanceM']*1000:.3f} mm. Shared rim-seat geometry reduces it to {RimProof['correctedRimSeat']['maximumAuthoredSurfaceDistanceM']*1000:.3f} mm of polygon faceting. Native and physical bead anchors are independently recorded; diagnostic sidewalls now close onto those anchors rather than leaving an open tread tube.</p><h2>Controlled actual-motion clips and rim close-ups</h2><div class="cards">{''.join(Cards)}</div><h2>Speed, work, signed displacement and bead geometry</h2>{ChartHtml}<p><a href="brakes/SlopeSourceProof.json">Production source and output hashes</a> · <a href="brakes/MotionProof.json">Flat raster and exact-frame playback provenance</a></p><div class="notice"><strong>Verification limits</strong><p>CPU production-code evidence only. Not a live Vulkan/AMD/GPU capture or a closed conservation proof. Earlier hard-landing energy failures remain open; this braking/rim-seat diagnostic does not erase them.</p></div></main>{PlaybackScript}</body></html>'''
Main = Gallery / "brakes-and-rim.html"; Main.write_text(Document)
HistoricalBanner = '<aside style="padding:18px;background:#263b50;color:#eaf5ff;font:15px/1.5 system-ui"><strong>Historical pre-brake/rim-fix recordings below.</strong> <a style="color:#8edbff" href="brakes-and-rim.html">Open fresh moving-brake, signed-slope and rim-seat evidence</a>. The earlier 58/68 audit is preserved at its original source revision, not current-source certification.</aside>'
for Filename in ["flight-and-slopes.html", "index.html"]:
    File = Gallery / Filename
    Original = File.read_text()
    if 'Historical pre-brake/rim-fix recordings below.' not in Original:
        File.write_text(Original.replace('<body>', '<body>'+HistoricalBanner, 1))
ConfigureGallery(Gallery)
Proof = {"cpuOnly": True, "flatColouring": True, "poseInterpolation": False, "rendererCompilation": RendererProof,
    "sourceProofSHA256": Hash(Folder / "SlopeSourceProof.json"), "clips": Motion, "pageSHA256": Hash(Main), "autoplay": False,
    "exclusivePlayback": True, "sourceSHA256": Hash(Path(__file__)), "charts": {File.name:Hash(File) for File in Charts}}
(Gallery / "brakes/MotionProof.json").write_text(json.dumps(Proof, indent=2)+'\n')
print(f"PUBLISHED fast flat brakes/rim gallery: {Passes}/14 checks, {len(Motion)} controlled clips: {Main}", flush=True)
