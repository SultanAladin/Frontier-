#!/usr/bin/env python3
"""Publish airborne native tyre close-ups and a scoped brake/landing report without hiding measurement failures."""
from pathlib import Path
import argparse
import base64
import concurrent.futures
import csv
import gzip
import hashlib
import html
import json
import shutil
import subprocess
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


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--input", type=Path, default=Root / "_AgentScratch/tmp/DriveAirTyre")
    Parser.add_argument("--landings", type=Path, default=Root / "_AgentScratch/tmp/DriveLandingCurrent")
    Parser.add_argument("--jobs", type=int, default=2, choices=range(1, 5))
    Parser.add_argument("--publish-only", action="store_true")
    Arguments = Parser.parse_args()
    Folder, Landings = Arguments.input.resolve(), Arguments.landings.resolve()
    Gallery = Root / "Exhibits/Gallery/ProjectDrive"
    Destination = Gallery / "air"
    Raw = Root / "_AgentScratch/tmp/DriveAirTyreRenders"
    for Directory in [Destination, Destination / "traces", Raw]:
        Directory.mkdir(parents=True, exist_ok=True)
    Audit = json.loads((Folder / "AirTyreAudit.json").read_text())
    SourceProof = json.loads((Folder / "AirTyreSourceProof.json").read_text())
    LandingAudit = json.loads((Landings / "FlightAudit.json").read_text())
    LandingProof = json.loads((Landings / "SourceProof.json").read_text())
    for Proof, Dataset in [(SourceProof, Folder), (LandingProof, Landings)]:
        for Name, Expected in Proof["sourceSHA256"].items():
            assert Hash(Root / Name) == Expected, "Refuse stale physics evidence: " + Name
        for Name, Expected in Proof["outputs"].items():
            assert Hash(Dataset / Name) == Expected, "Refuse modified recordings: " + Name
    assert Audit["validatorSHA256"] == Hash(Root / "Tools/Tests/CheckDriveAirTyre.py")
    assert LandingAudit["validatorSHA256"] == Hash(Root / "Tools/Tests/CheckDriveFlight.py")
    assert len(LandingAudit["cases"]) == 8 and not LandingProof["shortened"]
    if not Arguments.publish_only:
        subprocess.run([sys.executable, str(Root / "Tools/Tests/RunDriveFlightExhibit.py"), "--compile-only"], cwd=Root, check=True)
    Build = Root / "_AgentScratch/build/DriveTumbleRender"
    RendererProof = json.loads((Build / "CompilationProof.json").read_text())
    for Name, Expected in RendererProof["sourceSHA256"].items():
        assert Hash(Root / Name) == Expected, Name
    RendererIdentity = hashlib.sha256(json.dumps(RendererProof["sourceSHA256"], sort_keys=True).encode()).hexdigest()
    Executable = Build / ("DriveTumbleRender.exe" if sys.platform == "win32" else "DriveTumbleRender")
    Font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 10) if Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf").exists() else ImageFont.load_default()
    Cases = {Case["name"]: Case for Case in Audit["cases"]}
    Titles = {"held-hub-gravity": "Wheel suspended from a stationary hub",
              "no-gravity-wheel": "Zero-gravity inflation reference",
              "freefall-wheel": "Ballistic wheel, gravity on",
              "freefall-spinning-wheel": "Ballistic wheel, prescribed 80 rad/s spin",
              "unload-held-wheel": "Compressed tyre released from ground contact",
              "vehicle-freefall": "Actual vehicle freefall, no drive",
              "vehicle-tumbling": "Actual vehicle tumble, no drive"}
    Jobs = [(Name, "tyre-side") for Name in sorted(Cases)]
    Jobs += [(Name, "tyre-oblique") for Name in ["unload-held-wheel", "vehicle-tumbling"]]

    def Animate(Job):
        Name, View = Job
        Key = "air-tyre-" + Name + "-" + View.removeprefix("tyre-")
        Recording = Folder / (Name + ".frames")
        Output, Poster, Witness = Raw / (Key + ".gif"), Raw / (Key + ".png"), Raw / (Key + ".json")
        Expected = {"recordingSHA256": Hash(Recording), "scalarTraceSHA256": Hash(Folder / (Name + ".csv")),
                    "rendererFingerprint": RendererIdentity, "view": View, "stride": 4, "firstFrame": 0, "lastFrameExclusive": 120}
        if Output.exists() and Poster.exists() and Witness.exists():
            Saved = json.loads(Witness.read_text())
            if all(Saved.get(Key) == Value for Key, Value in Expected.items()) and Saved["gifSHA256"] == Hash(Output) and Saved["posterSHA256"] == Hash(Poster):
                return Saved
        assert not Arguments.publish_only, "Missing matching air close-up: " + Key
        Directory = Raw / Key
        if Directory.exists():
            shutil.rmtree(Directory)
        Invocation = [str(Executable), str(Recording), str(Directory), "4", "0", "120", "flat", View]
        subprocess.run(Invocation, cwd=Root, check=True)
        Rows = Numpy.genfromtxt(Folder / (Name + ".csv"), delimiter=",", names=True)
        Pictures = []
        for File in sorted(Directory.glob("*.png"), key=lambda File: int(File.stem)):
            Time = (int(File.stem) + 1) / 20
            Row = Rows[Numpy.argmin(Numpy.abs(Rows["t"] - Time))]
            Centre = Numpy.sqrt(sum(Row["centre_" + Axis + "_m"] ** 2 for Axis in ["x", "y", "z"]))
            Surface = Image.new("RGB", (320, 430), "#111d2a")
            Surface.paste(Image.open(File).convert("RGB"), (0, 110))
            Pen = ImageDraw.Draw(Surface)
            Pen.text((7, 6), Name, font=Font, fill="#e4edf8")
            Pen.text((7, 23), f"Actual {Time:.2f}s | AIR | {View}", font=Font, fill="#c2d7e9")
            Pen.text((7, 40), f"Tread centre / rim offset: {Centre*1000:.4f} mm", font=Font, fill="#ffd28b")
            Pen.text((7, 57), f"Mean radius growth: {(Row['mean_radius_m']-0.50855)*1000:+.3f} mm", font=Font, fill="#c2d7e9")
            Pen.text((7, 74), f"Bead: {Row['native_bead_gap_m']*1000:.4f} mm | contacts {int(Row['contacts'])}", font=Font, fill="#c2d7e9")
            Pen.text((7, 91), "Native tyre / authored rigid rim | no shape clamp", font=Font, fill="#9cb4c7")
            Pictures.append(Surface.quantize(colors=128, dither=Image.Dither.NONE))
        assert len(Pictures) == 30
        Pictures[0].save(Output, save_all=True, append_images=Pictures[1:], duration=200, loop=0, disposal=2, optimize=False)
        Pictures[0].convert("RGB").save(Poster)
        Saved = dict(Expected, case=Name, key=Key, invocation=Invocation, sourceFrames=30,
                     actualMotion=True, poseInterpolation=False, singleNativeWheel=True,
                     gifSHA256=Hash(Output), posterSHA256=Hash(Poster))
        Witness.write_text(json.dumps(Saved, indent=2) + "\n")
        shutil.rmtree(Directory)
        return Saved

    with concurrent.futures.ThreadPoolExecutor(max_workers=Arguments.jobs) as Executor:
        Motion = list(Executor.map(Animate, Jobs))
    for Clip in Motion:
        for Suffix in ["gif", "png"]:
            shutil.copyfile(Raw / (Clip["key"] + "." + Suffix), Gallery / "motion" / (Clip["key"] + "." + Suffix))
        Clip["playback"] = EncodeClip(Gallery / "motion" / (Clip["key"] + ".gif"), Gallery / "motion" / (Clip["key"] + ".mp4"))
    for Name in ["AirTyreAudit.json", "AirTyreSourceProof.json"]:
        shutil.copyfile(Folder / Name, Destination / Name)
    for Name in ["FlightAudit.json", "FlightResults.json", "SourceProof.json"]:
        shutil.copyfile(Landings / Name, Destination / ("landing-" + Name))
    for Dataset, Prefix in [(Folder, "tyre"), (Landings, "landing")]:
        Directory = Destination / "traces" / Prefix
        Directory.mkdir(exist_ok=True)
        for File in Dataset.glob("*.csv"):
            with (Directory / (File.name + ".gz")).open("wb") as Stream:
                with gzip.GzipFile(filename=File.name, mode="wb", fileobj=Stream, mtime=0) as Compressed:
                    Compressed.write(File.read_bytes())
    Figure, Axes = Plot.subplots(2, 1, figsize=(10, 8), sharex=True)
    for Name in ["no-gravity-wheel", "held-hub-gravity", "vehicle-freefall", "vehicle-tumbling"]:
        Rows = Numpy.genfromtxt(Folder / (Name + ".csv"), delimiter=",", names=True)
        Centre = Numpy.sqrt(sum(Rows["centre_" + Axis + "_m"] ** 2 for Axis in ["x", "y", "z"]))
        Axes[0].plot(Rows["t"], Centre * 1000, label=Titles[Name])
        Axes[1].plot(Rows["t"], (Rows["mean_radius_m"] - 0.50855) * 1000, label=Titles[Name])
    Axes[0].set_ylabel("Tread-centre offset from rigid rim [mm]")
    Axes[1].set_ylabel("Mean radius growth from rest lattice [mm]")
    Axes[1].set_xlabel("Time [s]")
    for Axis in Axes:
        Axis.grid(alpha=0.25)
        Axis.legend(fontsize=8)
    Figure.suptitle("Sag/concentricity and inflation are different measurements")
    Figure.tight_layout()
    Chart = Destination / "air-centre-vs-inflation.png"
    Figure.savefig(Chart, dpi=120)
    Plot.close(Figure)
    Rows = Numpy.genfromtxt(Folder / "unload-held-wheel.csv", delimiter=",", names=True)
    Figure, Axis = Plot.subplots(figsize=(10, 4))
    Axis.plot(Rows["t"], Rows["shape_max_m"] * 1000, label="Maximum node displacement from rest lattice")
    Axis.set_xlim(0, 0.1)
    Axis.set_xlabel("Time after ground release [s]")
    Axis.set_ylabel("Displacement [mm]")
    Axis.set_title("Initially compressed tyre recovers; it does not remain hanging")
    Axis.grid(alpha=0.25)
    Axis.legend()
    Figure.tight_layout()
    ReleaseChart = Destination / "air-unloading-recovery.png"
    Figure.savefig(ReleaseChart, dpi=120)
    Plot.close(Figure)
    BrakeAudit = json.loads((Gallery / "brakes/SlopeAudit.json").read_text())
    Baseline = json.loads((Gallery / "brakes/baseline-SlopeAudit.json").read_text())
    BrakeCases = {Case["name"]: Case for Case in BrakeAudit["cases"]}
    OldCases = {Case["name"]: Case for Case in Baseline["cases"]}
    BrakeRows = []
    for Heading in [90, -90]:
        Name = f"moving-20-heading-{Heading}-brakes-2"
        BrakeRows.append(f"<tr><td>20° contour {Heading:+g}°, rear-only</td><td>{OldCases[Name]['finalSpeed']:.4f} m/s after 7 s</td><td>Stops after {BrakeCases[Name]['stopTime']:.3f} s; final {BrakeCases[Name]['finalSpeed']:.6f} m/s</td></tr>")
    TyreRows = []
    for Name, Case in Cases.items():
        TyreRows.append(f"<tr><td>{Titles[Name]}</td><td>{Case['lateMeanCentreOffsetM']*1000:.4f}</td><td>{Case['maximumRecordedRingCentreOffsetM']*1000:.3f}</td><td>{Case['lateMeanInflationGrowthM']*1000:.3f}</td><td>{Case['lateMaximumCircumferentialRangeM']*1000:.3f}</td><td>{Case['nativeBeadGapM']*1000:.4f}</td></tr>")
    LandingRows = []
    for Case in sorted(LandingAudit["cases"], key=lambda Case: Case["name"]):
        Failed = ", ".join(Name for Name, Passed in Case["checks"].items() if not Passed)
        LandingRows.append(f"<tr><td>{Case['name']}</td><td>{Case['peakIncreaseJ']:,.1f}</td><td>{Case['energyBudgetJ']:.1f}</td><td>{'PASS' if Case['passed'] else html.escape(Failed)}</td></tr>")
    Cards = []
    for Clip in Motion:
        Key, Name = Clip["key"], Clip["case"]
        Cards.append(f'''<article><h3>{Titles[Name]} · {Clip['view'].removeprefix('tyre-')}</h3><video controls loop muted playsinline preload="none" poster="motion/{Key}.png" src="motion/{Key}.mp4"></video><p>Six seconds of recorded native motion, 5 Hz displayed poses. Camera follows the rim material frame to expose relative tyre motion.</p><a href="air/traces/tyre/{Name}.csv.gz">240 Hz scalar trace</a> · <a href="motion/{Key}.gif" download>Recorded GIF</a></article>''')
    Images = ''.join(f'<figure><img src="data:image/png;base64,{base64.b64encode(File.read_bytes()).decode()}" alt="{File.stem}"></figure>' for File in [Chart, ReleaseChart])
    Passing = sum(Case["passed"] for Case in LandingAudit["cases"])
    Rear = BrakeCases["moving-20-heading-180-brakes-2"]
    VehicleTumbling = Cases["vehicle-tumbling"]
    Document = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Drive: airborne tyre sag and scoped brake/landing report</title><style>:root{{color-scheme:dark;font:15px/1.6 system-ui;background:#0d1520;color:#e0edf9}}body{{max-width:1260px;margin:auto;padding:28px}}h1{{font-size:clamp(30px,4vw,48px);line-height:1.15}}h2{{margin-top:42px}}a{{color:#8bd7fb}}p{{color:#bfcede}}.notice{{border:1px solid #aa8145;background:#302417;padding:18px;border-radius:10px}}.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}}article{{padding:15px;background:#142334;border:1px solid #2b445b;border-radius:10px}}article h3{{font-size:15px}}video,figure img{{width:100%}}figure{{margin:24px 0;padding:8px;background:#f4f7fb;border-radius:8px}}table{{width:100%;border-collapse:collapse;font-size:13px}}th,td{{text-align:left;padding:10px;border-bottom:1px solid #2b445b}}.scroll{{overflow-x:auto}}button{{border:0;border-radius:6px;background:#31759d;color:white;padding:10px 16px}}</style></head><body><header><p>Actual native measurements · 12 October 2026</p><h1>Airborne tyre shape, brake findings,<br>and what the landing warning means.</h1><button type="button" onclick="PauseClips()">Pause all clips</button><p>All clips start paused; playing one pauses the others. <a href="brakes-and-rim.html">Moving brake/rim gallery</a></p></header><main><h2>1. The brake claim, narrowed to the evidence</h2><p>Your stable service-brake experience is consistent with the baseline measurements. The previous source did not generally have broken service brakes: all measured moving service-brake stops passed. The reproducible defect was rear-only braking on the two 20° contour approaches; it left approximately 0.29 m/s of creep. The current joint rotor/disc/chassis/contact solve removes that residual. No velocity clamp, pose pin or extra damping was added.</p><div class="scroll"><table><thead><tr><th>Moving condition</th><th>Linked-source baseline</th><th>Current source</th></tr></thead><tbody>{''.join(BrakeRows)}</tbody></table></div><p>The earlier claim that the rear brake could not stop downhill was not established by a 7-second recording. The extended test now records a stop after {Rear['stopTime']:.3f} seconds of braking and a subsequent hold. Service braking stops the same 20° downhill approach in {BrakeCases['moving-20-heading-180-brakes-1']['stopTime']:.3f} seconds. Current moving brake/seat checks: 14/14. These are measured conditions with μ=0.8, not a promise for every road, speed or vehicle configuration.</p><h2>2. Airborne tyre: concentricity, inflation and attachment are different</h2><p>Bead seating alone did not answer your observation. This new check measures the centre of the actual outer tread relative to the rigid rim, the radius growth caused by inflation/spin, and the circumferential variation within each tread ring. It uses the production XPBD tyre, closed native tyre projection, actual pressure-surface beads and authored rigid rim. The actual vehicle freefall/tumble cases include gravity and suspension, with no ground, drive or chassis damping.</p><div class="notice"><strong>No sustained, visibly hanging tread was reproduced on the current source.</strong><p>The actual vehicle's settled centre offset is about 0.05–0.07 mm; the maximum recorded all-node centre offset during tumbling is about {VehicleTumbling['maximumCentreOffsetM']*1000:.3f} mm. Averaging all nodes can hide variation across the width: the worst individual-ring centre offset is {VehicleTumbling['maximumRecordedRingCentreOffsetM']*1000:.3f} mm, and late circumferential variation reaches {VehicleTumbling['lateMaximumCircumferentialRangeM']*1000:.3f} mm at this fast tumble rate. These are reported rather than forcing a perfect circle. By contrast, mean inflation changes the outer radius by about 4.2 mm. A rigid rim must not deform along with the pneumatic tread. Different-looking inner and outer contours do not by themselves demonstrate detachment.</p><p>The controlled pre-compressed wheel begins with 38.553 mm of loaded node deformation and 149 contact nodes. After release, contacts are zero, the maximum offset drops to 8.200 mm after one 4.167 ms step and about 6.250 mm after two steps. The remaining few millimetres are primarily inflated shape, not a carcass hanging away from its rim. No shape clamp or artificial rigidification was used.</p></div><div class="scroll"><table><thead><tr><th>Condition</th><th>Settled centre offset [mm]</th><th>Max recorded ring-centre offset [mm]</th><th>Mean radius growth [mm]</th><th>Late ring roundness range [mm]</th><th>Max native bead mismatch [mm]</th></tr></thead><tbody>{''.join(TyreRows)}</tbody></table></div><p>Roundness is measured within each ring, separately from the crown across the tyre width. Small world-coordinate projection errors grow as the ballistic tyre travels away from the origin; they are reported, not described as an exact zero gap. These results do not disprove a different older runtime/build showing sag.</p>{Images}<h2>Recorded airborne rim/tyre close-ups</h2><div class="cards">{''.join(Cards)}</div><h2>3. Why apparently stable landings can still flag energy</h2><p>The original phrase meant that the brake/rim check did not certify the separate landing energy budget. It did not mean that these brake images visibly demonstrate an instability. The current source has now been rechecked in all eight historical spinning-drop conditions: initial centre-of-mass height 9 m, upward velocity 8 m/s and initial angular speed 8 rad/s, flat ground, disconnected drive and no applied brake. {Passing}/8 pass the complete necessary-screen set.</p><div class="scroll"><table><thead><tr><th>Spinning landing</th><th>Peak modeled energy increase [J]</th><th>Allowance [J]</th><th>Current screen result</th></tr></thead><tbody>{''.join(LandingRows)}</tbody></table></div><p>The diagnostic sums body/particle/rim kinetic energy, referenced gravity, gas/carcass/suspension elasticity and ground-compliance potential. The biggest peaks are dominated by the ground-compliance potential calculated from transient particle penetration; the tyres remain within the shape bounds and the motion can still settle afterwards. A short impact-time excess can be invisible in a 5 Hz clip. This is an unresolved impact/contact-coupling or energy-accounting issue, not evidence that the service brakes fail. The account remains unclosed, so this report does not claim exact whole-vehicle conservation or identify a final cause.</p><p>One diagonal landing also records a small positive static-contact-power peak above the existing 1 W screen. That result is preserved in the audit rather than removed to make the report green.</p><p><a href="air/AirTyreAudit.json">Airborne tyre audit</a> · <a href="air/AirTyreSourceProof.json">Native tyre source/output hashes</a> · <a href="air/landing-FlightAudit.json">Current landing audit</a> · <a href="air/landing-SourceProof.json">Landing source/output hashes</a> · <a href="air/MotionProof.json">Native close-up provenance</a> · <a href="air/PlaybackAudit.json">Real-browser playback audit</a></p></main>{PlaybackScript}</body></html>'''
    MainPage = Gallery / "airborne-tyres.html"
    MainPage.write_text(Document)
    Proof = {"recordedDate": "2026-10-12", "nativeTyreEmitter": True, "authoredRigidRim": True,
             "poseInterpolation": False, "autoplay": False, "exclusivePlayback": True,
             "rendererCompilation": RendererProof, "sourceProofSHA256": Hash(Destination / "AirTyreSourceProof.json"),
             "landingSourceProofSHA256": Hash(Destination / "landing-SourceProof.json"),
             "clips": Motion, "pageSHA256": Hash(MainPage), "sourceSHA256": Hash(Path(__file__)),
             "charts": {File.name: Hash(File) for File in [Chart, ReleaseChart]}}
    (Destination / "MotionProof.json").write_text(json.dumps(Proof, indent=2) + "\n")
    print(f"PUBLISHED airborne tyre report: {len(Motion)} controlled native close-ups; landing failures preserved", flush=True)


if __name__ == "__main__":
    Main()
