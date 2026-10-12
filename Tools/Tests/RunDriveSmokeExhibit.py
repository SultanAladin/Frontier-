#!/usr/bin/env python3
"""Publish fixed-world native density projections and tyre scalar traces; no GPU/raymarch appearance claim."""
from pathlib import Path
import argparse
import csv
import gzip
import hashlib
import html
import json
import math
import shutil
import struct
import sys

Root = Path(__file__).resolve().parents[2]
LocalPython = Root / "_AgentScratch/tmp/python-tools"
if LocalPython.exists():
    sys.path.insert(0, str(LocalPython))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as Plot
import numpy as Numpy
from PIL import Image, ImageDraw, ImageFont
from PlaybackCodec import EncodeClip, PlaybackScript


def Hash(File):
    return hashlib.sha256(File.read_bytes()).hexdigest()


def ReadCapture(File):
    with File.open("rb") as Input:
        assert Input.read(4) == b"FSKV"
        Version, Extent = struct.unpack("<II", Input.read(8))
        assert Version == 1 and Extent == 32
        Records = []
        while Raw := Input.read(37 * 4):
            assert len(Raw) == 37 * 4
            Pose = Numpy.frombuffer(Raw, dtype="<f4").copy()
            Resident = struct.unpack("<I", Input.read(4))[0]
            Bounds = Numpy.frombuffer(Input.read(16), dtype="<f4").copy()
            Density = Temperature = None
            if Resident:
                Density = Numpy.frombuffer(Input.read(Extent ** 3 * 4), dtype="<f4").reshape(Extent, Extent, Extent).copy()
                Temperature = Numpy.frombuffer(Input.read(Extent ** 3 * 4), dtype="<f4").reshape(Extent, Extent, Extent).copy()
                assert Numpy.isfinite(Density).all() and Numpy.isfinite(Temperature).all()
            Records.append((Pose, Bounds, Density, Temperature))
    assert len(Records) == 120
    return Records


def DrawRecording(Records, Rows, Title, Output, Poster):
    FontLocation = next((Location for Location in [Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
                         Path("C:/Windows/Fonts/arial.ttf")] if Location.exists()), None)
    Font = ImageFont.truetype(str(FontLocation), 12) if FontLocation else ImageFont.load_default()
    Small = ImageFont.truetype(str(FontLocation), 10) if FontLocation else ImageFont.load_default()
    Bold = ImageFont.truetype(str(FontLocation), 16) if FontLocation else ImageFont.load_default()
    MinimumX = min(float(Pose[1]) for Pose, _, _, _ in Records) - 12
    MaximumX = max(float(Pose[1]) for Pose, _, _, _ in Records) + 12
    MinimumY = min(float(Pose[2]) for Pose, _, _, _ in Records) - 12
    MaximumY = max(float(Pose[2]) for Pose, _, _, _ in Records) + 12
    WorldWidth, WorldHeight = MaximumX - MinimumX, MaximumY - MinimumY
    PanelWidth, PanelHeight = 454, 282
    Scale = min(PanelWidth / WorldWidth, PanelHeight / WorldHeight)
    OffsetX = 16 + (PanelWidth - Scale * WorldWidth) / 2
    OffsetY = 76 + (PanelHeight - Scale * WorldHeight) / 2

    def Position(X, Y):
        return OffsetX + (X - MinimumX) * Scale, OffsetY + (MaximumY - Y) * Scale

    Pictures = []
    for Index, (Pose, Bounds, Density, Temperature) in enumerate(Records):
        Picture = Image.new("RGBA", (720, 420), (14, 21, 29, 255))
        Draw = ImageDraw.Draw(Picture)
        Draw.text((16, 14), Title, font=Bold, fill="#eef4fa")
        Draw.text((16, 43), "NATIVE 32 CUBED | FIXED WORLD +Z PROJECTION | 20 Hz recorded samples", font=Small, fill="#91a7bb")
        Draw.rectangle((15, 75, 470, 359), fill="#141e29", outline="#314354")
        for X in range(math.ceil(MinimumX / 5) * 5, math.floor(MaximumX / 5) * 5 + 1, 5):
            Point = Position(X, MinimumY)
            End = Position(X, MaximumY)
            Draw.line((Point, End), fill="#233343")
        for Y in range(math.ceil(MinimumY / 5) * 5, math.floor(MaximumY / 5) * 5 + 1, 5):
            Draw.line((Position(MinimumX, Y), Position(MaximumX, Y)), fill="#233343")
        if Density is not None:
            Cell = float(Bounds[3]) / 32
            Opacity = 1 - Numpy.exp(-0.8 * Density.sum(axis=0) * Cell)
            Colour = Numpy.zeros((32, 32, 4), dtype=Numpy.uint8)
            Colour[:, :, :3] = [221, 226, 232]
            Colour[:, :, 3] = Numpy.rint(Opacity * 230).astype(Numpy.uint8)
            Layer = Image.fromarray(Colour).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            Pixels = max(1, round(float(Bounds[3]) * Scale))
            Layer = Layer.resize((Pixels, Pixels), Image.Resampling.BILINEAR)
            Left, Top = Position(float(Bounds[0]), float(Bounds[1] + Bounds[3]))
            Overlay = Image.new("RGBA", Picture.size)
            Overlay.alpha_composite(Layer, (round(Left), round(Top)))
            Clip = Image.new("L", Picture.size)
            ImageDraw.Draw(Clip).rectangle((16, 76, 469, 358), fill=255)
            Picture = Image.composite(Image.alpha_composite(Picture, Overlay), Picture, Clip)
            Draw = ImageDraw.Draw(Picture)
            Right, Bottom = Position(float(Bounds[0] + Bounds[3]), float(Bounds[1]))
            Draw.rectangle((Left, Top, Right, Bottom), outline="#7092a4", width=1)
        Draw = ImageDraw.Draw(Picture)
        Centre = (float(Pose[1]), float(Pose[2]))
        Yaw = float(Pose[4])
        Cosine, Sine = math.cos(Yaw), math.sin(Yaw)
        Corners = [Position(Centre[0] + X * Cosine - Y * Sine, Centre[1] + X * Sine + Y * Cosine)
                   for X, Y in [(-2.5, -0.95), (2.5, -0.95), (2.5, 0.95), (-2.5, 0.95)]]
        Draw.polygon(Corners, fill="#263d50", outline="#61c9ef")
        for Wheel in range(4):
            First = 5 + Wheel * 8
            Point = Position(float(Pose[First]), float(Pose[First + 1]))
            Burning = Pose[First + 6] > 0.5
            Colour = "#ffa161" if Burning else "#7ee4c0"
            Draw.ellipse((Point[0] - 3, Point[1] - 3, Point[0] + 3, Point[1] + 3), fill=Colour)
        Row = Rows[Index]
        Readouts = [f"t = {Pose[0]:.2f} s", f"car x / y = {Pose[1]:.1f} / {Pose[2]:.1f} m", f"height = {Pose[3]:.1f} m",
                    f"yaw = {Pose[4]:.2f} rad", f"resident domain: {Row['resident']}", f"acquisitions / shifts: {Row['acquisitions']} / {Row['relocations']}",
                    f"quiet: {float(Row['quiet_seconds']):.2f} s", f"peak density: {float(Row['peak_density']):.3f}",
                    f"peak gas excess: {float(Row['peak_temperature']):.3f} K", "", "WHEEL   TREAD C    SLIDING W"]
        for Wheel in range(4):
            Readouts.append(f" {Wheel}       {float(Row[f'surface_C_{Wheel}']):6.1f}     {float(Row[f'sliding_W_{Wheel}']):8.0f}")
        Readouts.append(f"ignited tyres: {sum(Pose[5 + Wheel * 8 + 6] > 0.5 for Wheel in range(4))}")
        for Line, Text in enumerate(Readouts):
            Draw.text((490, 78 + Line * 16), Text, font=Font if Line < 10 else Small, fill="#d5e2ee")
        Draw.text((18, 365), "5 m world lines. Box: domain bounds. Car rectangle: native pose guide, not a mesh render.", font=Small, fill="#9bafbf")
        Draw.text((18, 388), "Density-only transport diagnostic. No GPU shading, depth composition or flame appearance claim.", font=Small, fill="#b2bccc")
        Pictures.append(Picture.convert("RGB"))
    PosterIndex = next((Index for Index, Record in enumerate(Records) if Record[2] is not None), 0)
    Pictures[PosterIndex].save(Poster)
    Pictures[0].save(Output, save_all=True, append_images=Pictures[1:], duration=50, loop=0, disposal=2, optimize=False)
    return {"frames": len(Pictures), "durationS": 6, "interpolation": False, "worldLimits": [MinimumX, MaximumX, MinimumY, MaximumY],
            "projection": "Vertical scalar-density integration from recorded native 32-cubed samples; fixed world limits; bilinear image enlargement only; native pose guide, not mesh geometry."}


def DrawConditions(Traces, Destination):
    Names = ["lateral-drift", "turning-drift", "diagnostic-ignition"]
    Figure, Axes = Plot.subplots(3, 3, figsize=(13, 8), constrained_layout=True)
    Figure.patch.set_facecolor("#f8fafc")
    Colours = ["#007caa", "#e55a27", "#744ac1", "#168765"]
    for Index, Name in enumerate(Names):
        Rows = Traces[Name]
        Time = [float(Row["t"]) for Row in Rows]
        for Wheel in range(4):
            Axes[Index, 0].plot(Time, [float(Row[f"surface_C_{Wheel}"]) for Row in Rows], color=Colours[Wheel], label=f"Wheel {Wheel}")
            Axes[Index, 1].plot(Time, [float(Row[f"pressure_kPa_{Wheel}"]) for Row in Rows], color=Colours[Wheel])
            Axes[Index, 2].plot(Time, [float(Row[f"sliding_W_{Wheel}"]) / 1000 for Row in Rows], color=Colours[Wheel])
        Axes[Index, 0].set_ylabel(Name.replace("-", " ") + "\nTread temperature (C)")
        Axes[Index, 1].set_ylabel("Gauge pressure (kPa)")
        Axes[Index, 2].set_ylabel("Sliding dissipation (kW)")
        for Axis in Axes[Index]:
            Axis.grid(alpha=0.18)
            Axis.set_xlabel("Recorded seconds")
    Axes[0, 0].legend(fontsize=8, ncol=2)
    Figure.suptitle("Actual wheel readings; diagnostic ignition uses explicitly lowered thresholds", fontsize=13)
    Figure.savefig(Destination, dpi=135)
    Plot.close(Figure)


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--input", type=Path, default=Root / "_AgentScratch/tmp/SmokeSequence/Native")
    Arguments = Parser.parse_args()
    Folder = Arguments.input.resolve()
    Gallery = Root / "Exhibits/Gallery/ProjectDrive"
    Destination = Gallery / "smoke"
    Scratch = Root / "_AgentScratch/tmp/SmokeSequence/Images"
    Destination.mkdir(parents=True, exist_ok=True)
    Scratch.mkdir(parents=True, exist_ok=True)
    Proof = json.loads((Folder / "SmokeSourceProof.json").read_text())
    assert Proof["passed"] and Proof["cpuOnly"] and not Proof["gpuExecution"]
    for Name, Expected in Proof["sourceSHA256"].items():
        assert Hash(Root / Name) == Expected, "Source no longer matches native proof: " + Name
    for Name, Expected in Proof["outputs"].items():
        assert Hash(Root / Name) == Expected, "Recording no longer matches proof: " + Name
    Titles = {"holding": "Static support: no false sliding heat or smoke", "lateral-drift": "Combined-slip drift, two integer-cell scrolls",
              "turning-drift": "Turning car, world-aligned retained plume", "airborne": "Airborne friction: no emission or domain",
              "diagnostic-ignition": "Sustained ignition: LOW-THRESHOLD DIAGNOSTIC"}
    Traces = {}
    Media = {}
    Cards = []
    for Name, Title in Titles.items():
        Rows = list(csv.DictReader((Folder / (Name + ".csv")).open()))
        Traces[Name] = Rows
        Recording = ReadCapture(Folder / (Name + ".smoke"))
        assert all(abs(float(Record[0][0]) - float(Row["t"])) < 0.00001 for Record, Row in zip(Recording, Rows))
        Projection = DrawRecording(Recording, Rows, Title, Scratch / (Name + ".gif"), Destination / (Name + ".png"))
        Encoded = EncodeClip(Scratch / (Name + ".gif"), Destination / (Name + ".mp4"))
        Projection.update({"recordingSHA256": Hash(Folder / (Name + ".smoke")), "traceSHA256": Hash(Folder / (Name + ".csv")),
                           "posterSHA256": Hash(Destination / (Name + ".png")), "playback": Encoded})
        Media[Name] = Projection
        (Destination / (Name + ".csv.gz")).write_bytes(gzip.compress((Folder / (Name + ".csv")).read_bytes(), mtime=0))
        Cards.append(f'<article><h3>{html.escape(Title)}</h3><video controls loop muted playsinline preload="none" poster="smoke/{Name}.png" src="smoke/{Name}.mp4"></video><p>6 s, actual 20 Hz snapshots. <a href="smoke/{Name}.csv.gz">Scalar trace</a>.</p></article>')
    DrawConditions(Traces, Destination / "conditions.png")
    shutil.copy2(Folder / "SmokeSourceProof.json", Destination / "SmokeSourceProof.json")
    for Name in ["SmokeMetrics.log", "VehicleMetrics.log"]:
        shutil.copy2(Folder / Name, Destination / Name)
    BrakeFolder = Root / "_AgentScratch/tmp/SmokeSequence/DriveSlope"
    Brake = json.loads((BrakeFolder / "SlopeAudit.json").read_text())
    assert Brake["passed"] and len(Brake["cases"]) == 14
    shutil.copy2(BrakeFolder / "SlopeAudit.json", Destination / "SlopeAudit.json")
    shutil.copy2(BrakeFolder / "SlopeSourceProof.json", Destination / "SlopeSourceProof.json")
    Page = Gallery / "tyre-smoke.html"
    Page.write_text('''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Drive | Tyre heat and world-space smoke</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#101820;color:#e6eef5;font:16px/1.6 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:42px 24px 64px}h1{font-size:clamp(30px,4vw,48px);line-height:1.15;margin:10px 0 18px}h2{margin-top:42px}h3{font-size:18px;margin:0 0 14px}p{color:#c4d3df}.eyebrow{letter-spacing:.15em;font-size:12px;color:#76d6c2}.lead{max-width:850px;font-size:18px}.notice{border-left:3px solid #efbd75;background:#22252b;padding:15px 20px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:28px 0}.stats div,article{background:#19242f;border:1px solid #334758;border-radius:8px;padding:20px}.stats strong{display:block;color:#7de0c0;font-size:27px}.cards{display:grid;grid-template-columns:1fr 1fr;gap:20px}video,img{display:block;width:100%;height:auto;border-radius:5px}button{border:1px solid #6198b2;border-radius:5px;background:#1c384a;color:#eaf4fa;padding:10px 16px;font:inherit;cursor:pointer}a{color:#81d6ef}table{width:100%;border-collapse:collapse;font-size:15px}td,th{padding:13px 12px;text-align:left;border-bottom:1px solid #344554}th{color:#afc3d3}code{color:#8edfc9}footer{margin-top:40px;color:#8c9fab;font-size:13px}@media(max-width:760px){.cards{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}main{padding:25px 15px}table{font-size:13px}}
</style></head><body><main><div class="eyebrow">PROJECT DRIVE / NATIVE FIRST MILESTONE / 12 OCT 2026</div>
<h1>Hot tyres. Smoke that stays in the world.</h1><p class="lead">Independent tread, carcass and gas temperatures now feed XPBD inflation pressure and each wheel's grip. Actual combined sliding creates one on-demand world-aligned smoke domain per car.</p>
<div class="notice"><strong>Scope matters:</strong> these are native CPU transport diagnostics, not screenshots of finished in-game smoke. Host-owned C snapshots are connected; fine-grid GPU residency, opaque-depth composition and final smoke/flame shading remain unfinished. SDF tyre deformation stays deferred.</div>
<div class="stats"><div><strong>14 / 14</strong>native brake cases pass</div><div><strong>5 / 5</strong>vehicle smoke fixtures pass</div><div><strong>0 W</strong>holding / airborne slide heat</div><div><strong>1 domain</strong>on demand, shared by tyres</div></div>
<h2>What the native measurements show</h2><table><thead><tr><th>Fixture</th><th>Observed result</th></tr></thead><tbody>
<tr><td>Holding / airborne</td><td>0 W sliding dissipation, 0 J sliding heat, zero domain acquisitions. Compression/expansion can still change gas temperature.</td></tr>
<tr><td>Lateral drift</td><td>73.9 kW peak wheel sliding; largest per-wheel heat gain 21.29 kJ. One domain, two scrolls; injection active for 1.2 s, then a lingering/fading plume.</td></tr>
<tr><td>Turning drift</td><td>1.550 rad actual heading change, 33.3 kW peak sliding, one world-aligned domain. Existing smoke receives no car yaw or translation.</td></tr>
<tr><td>Ignition diagnostic</td><td>Sustained-overheat trigger and rubber consumption pass. Lowered heat capacity / thresholds are explicit test overrides; this does not calibrate a real compound.</td></tr>
<tr><td>Pressure / energy</td><td>Hot gas raises pressure without rebuilding XPBD particles. Three-capacity thermal balance residual 0.000000584 J in the independent heat test. Not a closed whole-vehicle energy proof.</td></tr>
<tr><td>Lifetime / ownership</td><td>Exact overlapping density, temperature and world velocities survive cell relocation. Stop/start reuses storage; quiet bounds freeze, contents fade before release. Pause/reset/retirement and transactional C copying pass.</td></tr>
</tbody></table><h2>Inspect the actual recordings</h2><p>All clips start paused. Play one to pause the others. The pale plume is a vertical projection of recorded density; the outlined rectangle is the finite world-space domain. The car rectangle is only a native pose guide.</p><button type="button" onclick="PauseClips()">Pause all clips</button><div class="cards">''' + ''.join(Cards) + '''</div>
<h2>Independent wheel conditions</h2><img src="smoke/conditions.png" alt="Native per-wheel tread temperatures, gauge pressure and sliding dissipation over time"><p>Gas starts near 20 C and cools during XPBD inflation/volume expansion; tread heat does not instantly become gas heat. The runtime thermal and ignition numbers are provisional, not measured tyre-compound properties.</p>
<h2>Implementation boundary</h2><ul><li>Live Drive runs tyres at 240 Hz and gas at 60 Hz. World contact samples sweep the source path; no smoke lattice is allocated at spawn.</li><li>Current transport is 32 cubed over 24 m: 0.75 m cells. This proves motion/ownership, not tyre-scale visual detail or performance parity with Unreal.</li><li>Sliding heat excludes static support, normal-impact work, rolling loss and brake-disc work. Fire requires authored sustained overheat plus remaining rubber, never randomness.</li><li>Drive obstruction uses actual terrain queries plus a conservative authored chassis-box proxy. Exact tyre-SDF smoke obstruction and SDF deformation are not added.</li><li>Fine-resolution GPU upload/rendering, calibrated smoke onset/hysteresis, material wear and calibrated fire appearance are still open milestones.</li><li>Existing hard-landing energy-accounting failures are not repaired or hidden by this work.</li></ul>
<h2>Reproducible evidence</h2><p><a href="smoke/SmokeMetrics.log">Thermal / relocation assertions</a> · <a href="smoke/VehicleMetrics.log">Vehicle and actual C-lifecycle checks</a> · <a href="smoke/SmokeSourceProof.json">Native source / capture hashes</a> · <a href="smoke/SlopeAudit.json">14-case brake audit</a> · <a href="smoke/SlopeSourceProof.json">Brake source provenance</a> · <a href="smoke/MediaProof.json">Projection / playback provenance</a></p>
<footer>Native simulation: GCC/C++20, assertions enabled. No GPU benchmark, native host graphics build or MSVC execution is claimed. Large raw voxel captures and build products stay in _AgentScratch.</footer></main>''' + PlaybackScript + '</body></html>\n')
    MediaProof = {"recordedDate": "2026-10-12", "cpuOnly": True, "gpuExecution": False, "autoplay": False,
        "pageSHA256": Hash(Page), "rendererSHA256": Hash(Path(__file__)), "clips": Media,
        "files": {File.name: Hash(File) for File in sorted(Destination.iterdir()) if File.is_file() and File.name not in ["MediaProof.json", "PlaybackAudit.json", "PlaybackAudit.png"]}}
    (Destination / "MediaProof.json").write_text(json.dumps(MediaProof, indent=2) + "\n")
    print("Published five individually pausable native density projections:", Page)


if __name__ == "__main__":
    Main()
