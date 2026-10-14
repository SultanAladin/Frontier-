#!/usr/bin/env python3
"""Encode the same recorded GIF frames as individually pausable videos; never invent/interpolate motion."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess
import sys

Root = Path(__file__).resolve().parents[2]
LocalPython = Root / "_AgentScratch/tmp/python-tools"
if LocalPython.exists():
    sys.path.insert(0, str(LocalPython))
from PIL import Image, ImageSequence
import imageio_ffmpeg


def Hash(File):
    return hashlib.sha256(File.read_bytes()).hexdigest()


def EncodeClip(Recording, Output):
    Witness = Output.with_suffix(".playback.json")
    Original = Hash(Recording)
    if Output.exists() and Witness.exists():
        Saved = json.loads(Witness.read_text())
        if Saved["gifSHA256"] == Original and Saved["videoSHA256"] == Hash(Output):
            return Saved
    with Image.open(Recording) as Animation:
        Width, Height = Animation.size
        assert Width % 2 == 0 and Height % 2 == 0
        Command = [imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
            "-s", f"{Width}x{Height}", "-r", "20", "-i", "-", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(Output)]
        Frames = 0
        with subprocess.Popen(Command, stdin=subprocess.PIPE) as Encoder:
            for Picture in ImageSequence.Iterator(Animation):
                Duration = Picture.info.get("duration", 100)
                Repetitions = round(Duration / 50)
                assert Repetitions > 0 and abs(Duration - Repetitions * 50) < 1
                Pixels = Picture.convert("RGB").tobytes()
                for Repeat in range(Repetitions):
                    Encoder.stdin.write(Pixels); Frames += 1
            Encoder.stdin.close()
            assert Encoder.wait() == 0
    Proof = {"gifSHA256": Original, "videoSHA256": Hash(Output), "durationS": Frames / 20,
        "frameInterpolation": False, "method": "Same recorded GIF images, repeated only to preserve their measured presentation duration.", "command": Command}
    Witness.write_text(json.dumps(Proof, indent=2) + "\n")
    return Proof


PlaybackScript = '''<script id="single-clip-playback">
document.addEventListener('play', function(Event) {
    if (Event.target.tagName !== 'VIDEO') return;
    document.querySelectorAll('video').forEach(function(Clip) { if (Clip !== Event.target) Clip.pause(); });
}, true);
function PauseClips() { document.querySelectorAll('video').forEach(function(Clip) { Clip.pause(); }); }
document.addEventListener('visibilitychange', function() { if (document.hidden) PauseClips(); });
</script>'''


def ConfigurePage(Document, Gallery):
    def ReplaceClip(Match):
        Attributes = Match.group(1)
        Name = Match.group(2)
        assert (Gallery / "motion" / (Name + ".mp4")).exists(), "Missing same-frame video: " + Name
        return f'<video class="recorded-clip" controls loop muted playsinline preload="none" poster="motion/{Name}.png" src="motion/{Name}.mp4" aria-label="Play or pause the actual {Name} recording"></video>'
    Document = re.sub(r'<img\b([^>]*?)src="motion/([^"/]+)\.gif"[^>]*>', ReplaceClip, Document)
    Featured = Gallery / "motion/launch-left-40.mp4"
    if Featured.exists():
        Document = re.sub(r'<img class="featured"[^>]*>', '<video class="featured" controls loop muted playsinline preload="none" poster="motion/launch-left-40.png" src="motion/launch-left-40.mp4" aria-label="Play or pause the actual two-wheel flip"></video>', Document)
    def ConfigureClip(Match):
        Markup = Match.group(0)
        Markup = re.sub(r"\s+preload\s*=\s*([\"'])[^\"']*\1", "", Markup)
        Markup = re.sub(r"\s+autoplay(?:\s*=\s*([\"'])[^\"']*\1)?", "", Markup)
        for Attribute in ["controls", "muted", "playsinline"]:
            if not re.search(r"\b" + Attribute + r"(?:\s|=|>)", Markup):
                Markup = Markup[:-1] + " " + Attribute + ">"
        if not re.search(r"\bposter\s*=", Markup):
            Recording = re.search(r"\bsrc\s*=\s*([\"'])(.*?)\1", Markup).group(2)
            Name = Path(Recording).stem
            if Name == "flying-and-tumbling":
                Name = "launch-left-40"
            elif Name == "incline-parking":
                Name = "slope-20-heading-0-brakes-1"
            Poster = Gallery / "motion" / (Name + ".png")
            assert Poster.exists(), "Missing paused poster: " + Name
            Markup = Markup[:-1] + f' poster="motion/{Name}.png">'
        return Markup[:-1] + ' preload="none">'

    Document = re.sub(r"<video\b[^>]*>", ConfigureClip, Document)
    if 'paused-clip-layout' not in Document:
        Document = Document.replace('</head>', '<style id="paused-clip-layout">video{display:block;width:100%;max-width:100%;height:auto}button:focus-visible{outline:3px solid #8ad6fb;outline-offset:3px}</style></head>')
    if 'single-clip-playback' not in Document:
        Document = Document.replace('</body>', PlaybackScript + '</body>')
        Document = Document.replace('<h1>', '<button type="button" onclick="PauseClips()">Pause all clips</button><p>All clips start paused. Native controls pause/resume the same recorded frames; playing one pauses the others. GIF downloads remain available.</p><h1>', 1)
    return Document


def ConfigureGallery(Gallery):
    Clips = {}
    for Recording in sorted((Gallery / "motion").glob("*.gif")):
        Clips[Recording.stem] = EncodeClip(Recording, Recording.with_suffix(".mp4"))
    assert Clips
    for Filename in ["flight-and-slopes.html", "index.html"]:
        File = Gallery / Filename
        if File.exists():
            File.write_text(ConfigurePage(File.read_text(), Gallery))
    Main = Gallery / "flight-and-slopes.html"
    Proof = {"sameRecordedImages": True, "autoplay": False, "simultaneousPlayback": False, "clips": Clips,
        "pageSHA256": Hash(Main), "sourceSHA256": Hash(Path(__file__))}
    (Gallery / "flight/PlaybackProof.json").write_text(json.dumps(Proof, indent=2) + "\n")
    Media = Gallery / "flight/MotionProof.json"
    if Media.exists():
        Previous = json.loads(Media.read_text())
        Previous["pageSHA256BeforePlaybackControls"] = Previous.get("pageSHA256BeforePlaybackControls", Previous["pageSHA256"])
        Previous["pageSHA256"] = Hash(Main)
        Previous["playbackProofSHA256"] = Hash(Gallery / "flight/PlaybackProof.json")
        Media.write_text(json.dumps(Previous, indent=2) + "\n")
    print(f"Configured {len(Clips)} exact recorded-frame clips: paused by default, exclusive play/pause, GIF downloads retained", flush=True)


if __name__ == "__main__":
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--gallery", type=Path, default=Root / "Exhibits/Gallery/ProjectDrive")
    Arguments = Parser.parse_args()
    ConfigureGallery(Arguments.gallery.resolve())
