#!/usr/bin/env python3
"""Verify paused, exclusive recorded-motion playback; optionally exercise the controls in a real browser.

Static verification needs only Python. For browser verification, install playwright outside source and supply
--chromium with an existing browser executable, plus --url for a running gallery server. No browser is downloaded.
"""
from pathlib import Path
from html.parser import HTMLParser
import argparse
import hashlib
import json
import os
import sys
import urllib.parse

Root = Path(__file__).resolve().parents[2]
LocalPython = Root / "_AgentScratch/tmp/python-tools"
if LocalPython.exists():
    sys.path.insert(0, str(LocalPython))


class PlaybackClassifier(HTMLParser):
    def __init__(self):
        super().__init__()
        self.Clips = []
        self.AnimatedImages = []

    def handle_starttag(self, Tag, Attributes):
        Attributes = dict(Attributes)
        if Tag == "video":
            self.Clips.append(Attributes)
        if Tag == "img" and urllib.parse.urlparse(Attributes.get("src", "")).path.endswith(".gif"):
            self.AnimatedImages.append(Attributes["src"])


def Hash(File):
    return hashlib.sha256(File.read_bytes()).hexdigest()


def ValidateMarkup(Gallery, Names):
    Pages = {}
    for Name in Names:
        File = Gallery / Name
        Document = File.read_text()
        Markup = PlaybackClassifier()
        Markup.feed(Document)
        assert Markup.Clips, f"No recorded clips: {Name}"
        assert not Markup.AnimatedImages, f"Uncontrolled animated GIF images: {Name}"
        assert 'id="single-clip-playback"' in Document
        assert "PauseClips()" in Document
        for Clip in Markup.Clips:
            assert "controls" in Clip and "playsinline" in Clip
            assert "autoplay" not in Clip and Clip.get("preload") == "none"
            for Attribute in ["src", "poster"]:
                Relative = urllib.parse.unquote(urllib.parse.urlparse(Clip[Attribute]).path)
                assert (File.parent / Relative).is_file(), f"Missing {Attribute}: {Name}: {Relative}"
        Pages[Name] = {"clips": len(Markup.Clips), "pageSHA256": Hash(File), "pausedMarkup": True,
                       "uncontrolledGifImages": 0}
    return Pages


def ValidateBrowser(Arguments, Pages):
    from playwright.sync_api import sync_playwright
    BrowserArguments = ["--no-sandbox", "--disable-dev-shm-usage"]
    BrowserEnvironment = os.environ.copy()
    if Arguments.browser_configuration:
        Configuration = json.loads(Arguments.browser_configuration.read_text())
        BrowserArguments = Configuration["args"]
        BrowserEnvironment.update(Configuration.get("environment", {}))
    with sync_playwright() as Playback:
        Browser = Playback.chromium.launch(executable_path=str(Arguments.chromium.resolve()),
                                           args=BrowserArguments, env=BrowserEnvironment, headless=True)
        Context = Browser.new_context(viewport={"width": 1440, "height": 1000})
        for Name, Reading in Pages.items():
            Page = Context.new_page()
            Failures = []
            Page.on("pageerror", lambda Error: Failures.append(str(Error)))
            Page.goto(Arguments.url.rstrip("/") + "/" + Name, wait_until="load")
            Page.evaluate("document.fonts.ready")
            assert Page.evaluate("document.createElement('canvas').getContext('2d').measureText('Moving brakes').width") > 10.0, "Browser fonts must render the diagnoses"
            assert Page.locator("video").count() == Reading["clips"]
            assert Page.evaluate("Array.from(document.querySelectorAll('video')).every(Clip => Clip.paused && !Clip.autoplay)")
            Page.evaluate("document.querySelectorAll('video')[0].play()")
            Page.wait_for_function("document.querySelectorAll('video')[0].currentTime > 0.15")
            Page.evaluate("document.querySelectorAll('video')[0].pause()")
            Frozen = Page.evaluate("document.querySelectorAll('video')[0].currentTime")
            Page.wait_for_timeout(200)
            assert Page.evaluate("document.querySelectorAll('video')[0].currentTime") == Frozen
            Page.evaluate("document.querySelectorAll('video')[0].play()")
            Page.wait_for_function("document.querySelectorAll('video')[0].currentTime > " + str(Frozen + 0.1))
            Page.evaluate("document.querySelectorAll('video')[1].play()")
            Page.wait_for_function("document.querySelectorAll('video')[0].paused && !document.querySelectorAll('video')[1].paused")
            assert Page.evaluate("Array.from(document.querySelectorAll('video')).filter(Clip => !Clip.paused).length") == 1
            Page.get_by_role("button", name="Pause all clips").click()
            assert Page.evaluate("Array.from(document.querySelectorAll('video')).every(Clip => Clip.paused)")
            # Exercise the hidden-document event without claiming to have switched a physical browser tab.
            Page.evaluate("""async () => {
                await document.querySelectorAll('video')[0].play();
                Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
                document.dispatchEvent(new Event('visibilitychange'));
            }""")
            assert Page.evaluate("Array.from(document.querySelectorAll('video')).every(Clip => Clip.paused)")
            assert not Failures, Failures
            Reading["browser"] = {"startsPaused": True, "timeAdvancesOnPlay": True, "pauseFreezesTime": True,
                                  "resumeContinuesTime": True, "exclusivePlayback": True, "pauseAll": True,
                                  "hiddenDocumentEventPause": True, "textRendering": True, "scriptErrors": Failures}
            if Name == Arguments.pages[0]:
                Page.evaluate("delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))")
                Arguments.output.parent.mkdir(parents=True, exist_ok=True)
                Page.screenshot(path=str(Arguments.output.with_suffix(".png")), full_page=False)
                if Name == "airborne-tyres.html":
                    Page.locator(".cards").scroll_into_view_if_needed()
                    Page.screenshot(path=str(Arguments.output.with_name(Arguments.output.stem + "-clips").with_suffix(".png")), full_page=False)
            Page.close()
        Context.close()
        Browser.close()


def Main():
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--gallery", type=Path, default=Root / "Exhibits/Gallery/ProjectDrive")
    Parser.add_argument("--pages", nargs="+", default=["brakes-and-rim.html", "flight-and-slopes.html", "index.html"])
    Parser.add_argument("--chromium", type=Path)
    Parser.add_argument("--browser-configuration", type=Path)
    Parser.add_argument("--url", help="Gallery URL, without a filename; required for browser verification")
    Parser.add_argument("--output", type=Path, default=Root / "_AgentScratch/tmp/DrivePlayback/PlaybackAudit.json")
    Arguments = Parser.parse_args()
    if Arguments.chromium and not Arguments.url:
        Parser.error("--url is required with --chromium")
    Pages = ValidateMarkup(Arguments.gallery.resolve(), Arguments.pages)
    if Arguments.chromium:
        ValidateBrowser(Arguments, Pages)
    Proof = {"passed": True, "recordedDate": "2026-10-12", "browserExecution": bool(Arguments.chromium),
             "pages": Pages, "sourceSHA256": Hash(Path(__file__))}
    Arguments.output.parent.mkdir(parents=True, exist_ok=True)
    Arguments.output.write_text(json.dumps(Proof, indent=2) + "\n")
    print(f"PASS {len(Pages)} gallery pages: paused clips, individual controls and exclusive playback"
          + ("; real browser pause/resume verified" if Arguments.chromium else "; markup verification only"))


if __name__ == "__main__":
    Main()
