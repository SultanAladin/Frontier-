#!/usr/bin/env python3
"""Publish only certified native Project-Zero 3D frames; no density projections, pose scripts or car stand-ins."""
from pathlib import Path
import csv
import hashlib
import html
import json
import shutil
import statistics
import subprocess
import sys

Root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Root / "_AgentScratch/tmp/python-tools"))
from PIL import Image
import imageio_ffmpeg

Raw = Root / "_AgentScratch/tmp/ZeroNative/Captures"
Build = Root / "_AgentScratch/build/ZeroNative"
Gallery = Root / "Exhibits/Gallery/ProjectZero"
for Folder in [Gallery / "motion", Gallery / "pictures", Gallery / "metrics"]:
    Folder.mkdir(parents=True, exist_ok=True)
Cases = {
    "combined-drift": ("Combined-slip drift", "One initial velocity seed; actual powered/coast contact, per-wheel heat and world-space tyre smoke."),
    "turning-drift": ("Turning drift", "Steering and a short rear-brake input; the car changes heading while emitted gas keeps its world orientation."),
    "scrolling-drift": ("Whole-cell scrolling", "A faster physical seed crosses the guard region. Retained gas is scrolled by whole cells, not carried with the chassis."),
    "diagnostic-ignition": ("Heat-driven tyre fire", "Explicit visual diagnostic: 100 J/K tread capacity, 315 K ignition, 310 K extinction and 0.2 s exposure. Production thresholds are unchanged."),
    "holding": ("Stationary holding", "Static support produces no sliding heat, no friction smoke and zero acquired fine-domain bytes."),
}
subprocess.run([sys.executable, str(Root / "Tools/Build/ProjectCodeSequence.py"), "--project", "Project-Zero", "--verify-only"],
               cwd=Root, check=True)
CodeImageInputs = json.loads((Root / "_AgentScratch/build/CodeImages/ProjectZero/CodeImageSourceProof.json").read_text())
Compilation = json.loads((Build / "CompilationProof.json").read_text())
assert CodeImageInputs["codeImageSHA256"] == Compilation["codeImageSHA256"]
Identity = hashlib.sha256(json.dumps(Compilation["sourceSHA256"], sort_keys=True).encode()).hexdigest()
Device = json.loads((Raw / "DeviceMetrics.json").read_text())
assert Device["passed"]
Results = {}
Cards = []
for Case, (Title, Description) in Cases.items():
    Fixture = Raw / Case
    Audit = json.loads((Fixture / "NativeMetrics.json").read_text())
    assert Audit["passed"] and Audit["loadedActualCodeImage"] and Audit["project"] == "ProjectZero"
    assert Audit["sourceIdentitySHA256"] == Identity
    assert Audit["executableSHA256"] == Compilation["executableSHA256"]
    assert Audit["codeImageSHA256"] == Compilation["codeImageSHA256"]
    Rows = list(csv.DictReader((Fixture / "Trace.csv").open()))
    assert len(Rows) == 360 and Audit["frames"] == 60
    Picture = max((Row for Row in Rows if int(Row["volume_pixels"]) > 0),
                  key=lambda Row: int(Row["volume_pixels"]), default=Rows[0])
    PosterIndex = min(59, int(round(float(Picture["time_s"]) * 60.0 - 1.0)) // 6)
    if Case == "diagnostic-ignition":
        PosterIndex = 25
    Poster = Gallery / "pictures" / (Case + ".png")
    Image.open(Fixture / ("Picture-%04d.png" % PosterIndex)).save(Poster, optimize=True)
    Video = Gallery / "motion" / (Case + ".mp4")
    Command = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-framerate", "10", "-i",
               str(Fixture / "Picture-%04d.png"), "-frames:v", "60", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
               "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(Video)]
    subprocess.run(Command, cwd=Root, check=True)
    shutil.copy2(Fixture / "Trace.csv", Gallery / "metrics" / (Case + ".csv"))
    Timings = {}
    for Name in ["physics_ms", "snapshot_ms", "transport_ms", "render_ms"]:
        Samples = [float(Row[Name]) for Row in Rows if float(Row[Name]) > 0.0]
        if Name == "render_ms":
            Samples = [float(Row[Name]) for Index, Row in enumerate(Rows) if Index % 6 == 0 and float(Row[Name]) > 0.0]
        if Samples:
            Ordered = sorted(Samples)
            Timings[Name] = {"median": statistics.median(Samples), "p95": Ordered[min(len(Ordered) - 1, int(len(Ordered) * 0.95))]}
    Audit["timingsMilliseconds"] = Timings
    Audit["peakTreadCelsius"] = max(float(Row["tread_c"]) for Row in Rows)
    Audit["peakGaugeKPa"] = max(float(Row["gauge_kpa"]) for Row in Rows)
    Audit["videoSHA256"] = hashlib.sha256(Video.read_bytes()).hexdigest()
    Audit["posterSHA256"] = hashlib.sha256(Poster.read_bytes()).hexdigest()
    Audit["traceSHA256"] = hashlib.sha256((Fixture / "Trace.csv").read_bytes()).hexdigest()
    Results[Case] = Audit
    Peak = "0 W" if Case == "holding" else ("%.1f kW" % (Audit["peakSlidingPowerW"] / 1000.0))
    Bytes = Audit["peakDeviceBytes"] / 1048576.0
    Cards.append(f'''<article class="card" id="{Case}">
      <div class="media"><video controls preload="none" muted loop playsinline poster="pictures/{Case}.png" aria-label="{html.escape(Title)}">
        <source src="motion/{Case}.mp4" type="video/mp4"></video><span class="badge">Native 3D · 6 seconds</span></div>
      <div class="card-body"><h2>{html.escape(Title)}</h2><p>{html.escape(Description)}</p>
      <div class="stats"><span>Peak wheel sliding <b>{Peak}</b></span><span>Fine storage <b>{Bytes:.2f} MiB</b></span>
      <span>World scrolls <b>{Audit['scrolls']}</b></span><span>Tread peak <b>{Audit['peakTreadCelsius']:.1f} °C</b></span></div>
      <a href="metrics/{Case}.csv" download>Native measurements CSV</a></div></article>''')
Report = {
    "recordedDate": "2026-10-13", "passed": True, "actualProject": "ProjectZero", "actualAuthoredCar": "ControlVehicle / PROTO-X",
    "renderer": "shared CPU 3D VisibilityRaster matcap + shared Vulkan SmokeExchange transport and HDR composition",
    "softwareVulkan": True, "hardwareGpuBenchmark": False, "windowedFrontierExecution": False,
    "nativeCodeImageExecution": True, "physicsRateHz": 240, "gasRateHz": 60, "captureRateHz": 10,
    "fineScalarFormat": "RGBA16F density, excess heat, combustion provenance and reserved lane",
    "sourceIdentitySHA256": Identity, "cases": Results, "deviceChecks": Device,
    "sourceSHA256": Compilation["sourceSHA256"], "codeImageInputs": CodeImageInputs,
    "limits": ["No empirical tyre-compound calibration claim.", "Diagnostic flame clip uses labelled shortened ignition settings.",
               "SDF tyre deformation remains deferred.", "No physical-GPU timing or native windowed-execution claim.",
               "Fine transport follows the coarse solved velocity plus world-anchored divergence-free curl; it is not a separate fine pressure solver."]
}
(Gallery / "metrics/NativeProof.json").write_text(json.dumps(Report, indent=2) + "\n")
Markup = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Project-Zero · actual car, tyre smoke and fire</title><style>
:root{color-scheme:dark;font-family:Inter,Segoe UI,Arial,sans-serif;background:#0c1118;color:#e8eef4}
*{box-sizing:border-box}body{margin:0}main{max-width:1160px;margin:auto;padding:56px 28px 40px}
.eyebrow{text-transform:uppercase;font-size:12px;letter-spacing:.2em;color:#a4b2bf}h1{font-size:clamp(32px,5vw,55px);line-height:1.08;font-weight:620;margin:15px 0 22px;letter-spacing:-.035em}
.intro{max-width:810px;color:#b6c5d3;line-height:1.7;font-size:16px}code{color:#d8eaae}.toolbar{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:26px 0 38px}
button,a{color:#cce0b0}button{background:#1b2836;border:1px solid #354b61;border-radius:8px;padding:10px 16px;cursor:pointer}.note{font-size:13px;color:#98aabc}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.card{overflow:hidden;background:#151e29;border:1px solid #2b3949;border-radius:12px}
.media{position:relative;background:#5b626b}video{display:block;width:100%;aspect-ratio:8/5}.badge{position:absolute;top:14px;left:14px;background:#10161ee6;color:#d7e1eb;padding:6px 9px;border-radius:5px;font-size:11px;pointer-events:none}
.card-body{padding:23px}h2{font-size:20px;margin:0 0 10px}.card p{min-height:70px;font-size:14px;line-height:1.55;color:#aebfcf}.stats{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin:22px 0;font-size:11px;color:#99acbf}.stats b{display:block;color:#e6eef6;margin-top:5px;font-size:17px}
.card a{font-size:12px}.boundary{margin-top:35px;padding:24px;border-left:3px solid #738856;background:#151e29;font-size:13px;line-height:1.7;color:#afbfce}.boundary h2{font-size:16px;color:#e8eef4}
footer{font-size:12px;color:#8094a8;margin-top:25px}@media(max-width:750px){.grid{grid-template-columns:1fr}main{padding:30px 18px}.card p{min-height:0}}
</style></head><body><main><div class="eyebrow">Frontier / Project-Zero / native evidence</div>
<h1>The actual car.<br>Real mechanics. World-space smoke.</h1>
<p class="intro">The authored <b>ControlVehicle</b> is decoded as a 3D scene and simulated by the actual <code>ProjectZero.dll</code>.
Trace-fan tyre contact, Pacejka powered response, thermal pressure and tyre fuel drive the sources.
The shared Vulkan facility advects a fine world volume and clips its linear-radiance resolve against the actual scene surface.</p>
<div class="toolbar"><button id="pause">Pause all clips</button><span class="note">All clips start paused. Playing one pauses the others.</span>
<a href="metrics/NativeProof.json">Execution certificate</a></div><section class="grid">''' + "\n".join(Cards) + '''</section>
<section class="boundary"><h2>What was actually executed</h2>
<p>Actual Project-Zero DLL, actual authored 3D geometry and live tyre geometry, the engine's diagnostic CPU visibility raster,
and the production Vulkan fine-transport/viewport shaders on <b>SwiftShader software Vulkan</b>. These are not 2D density projections or a substitute car.</p>
<p><b>Device checks:</b> per-tick batch equivalence, exact three-axis GPU relocation, world-yaw independence, caller-owned snapshot lifetime,
rapid restart reuse, malformed-payload refusal, measured 64/128 storage and full retirement. The clips also assert opaque-depth interception and paused revision reuse.</p>
<p><b>Boundary:</b> software-device timestamps are not hardware-GPU frame budgets. The full windowed Frontier executable was not run here.
The flame clip deliberately shortens ignition settings; an additional thermal test exercises the untouched 623.15 K / 4 s production settings.
Appearance is art-directed, not a calibrated Planck spectrum. Empirical compound calibration and deformed tyre SDFs are not claimed.</p></section>
<footer>Recorded 13 October 2026 · 240 Hz physics · 60 Hz gas · 10 Hz diagnostic captures · one on-demand world domain per car</footer>
</main><script>const clips=[...document.querySelectorAll('video')];for(const clip of clips){clip.pause();clip.addEventListener('play',()=>{for(const other of clips)if(other!==clip)other.pause()})}
document.getElementById('pause').addEventListener('click',()=>clips.forEach(clip=>clip.pause()));</script></body></html>'''
(Gallery / "index.html").write_text(Markup)
print("Published actual native 3D Project-Zero gallery:", Gallery / "index.html")
