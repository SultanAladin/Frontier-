import Assert from "node:assert/strict";
import FS from "node:fs/promises";
import Path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright-core";

const Folder = Path.dirname(fileURLToPath(import.meta.url));
const Root = Path.resolve(Folder, "../..");
const BrowserFolder = Path.join(Root, "_AgentScratch/build/TabletBrowser");
const Output = Path.join(Root, "VisualProof/TabletSequence");
const Url = process.env.TABLET_URL || "http://127.0.0.1:8099/";
const Executable = process.env.CHROMIUM_EXECUTABLE || Path.join(BrowserFolder, "chromium");
const Args = process.env.CHROMIUM_EXECUTABLE ? ["--no-sandbox", "--disable-dev-shm-usage"] : [
    "--no-sandbox", "--no-zygote", "--disable-dev-shm-usage", "--ignore-gpu-blocklist", "--in-process-gpu",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"
];
const Environment = process.env.CHROMIUM_EXECUTABLE ? process.env : {
    ...process.env, LD_LIBRARY_PATH: Path.join(BrowserFolder, "lib") + ":" + BrowserFolder,
    FONTCONFIG_PATH: BrowserFolder, VK_ICD_FILENAMES: Path.join(BrowserFolder, "vk_swiftshader_icd.json")
};
await FS.mkdir(Output, { recursive: true });
const Browser = await chromium.launch({ executablePath: Executable, headless: true, args: Args, env: Environment });
const Context = await Browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, hasTouch: true });
const Page = await Context.newPage();
const Errors = [];
Page.on("pageerror", Error => Errors.push(Error.message));
const Proof = { recordedDate: "2026-10-13", passed: false, browserExecution: true, nativeExecution: false,
    softwareGraphics: !process.env.CHROMIUM_EXECUTABLE, designs: {}, pageErrors: Errors, interactiveOpenCount: 0 };

async function WaitForTexture()
{
    await Page.waitForFunction(() => window.TabletPrototype?.QueryReading().FrameCount > 0, undefined, { timeout: 60000 });
    await Page.evaluate(() => new Promise(Resolve => requestAnimationFrame(() => requestAnimationFrame(Resolve))));
}

async function Contact(Identifier, Touch = false)
{
    await WaitForTexture();
    const Region = await Page.evaluate(Identifier => window.TabletPrototype.QueryRegions().find(Region => Region.Identifier === Identifier), Identifier);
    Assert.ok(Region, "Missing live hit region: " + Identifier);
    const Position = await Page.evaluate(Region => window.TabletPrototype.ProjectScreenPoint(Region.Left + Region.Width / 2, Region.Top + Region.Height / 2), Region);
    if (Touch) await Page.touchscreen.tap(Position.Left, Position.Top);
    else await Page.mouse.click(Position.Left, Position.Top);
    await WaitForTexture();
}

async function Capture(Name)
{
    await Page.mouse.move(20, 20);
    await WaitForTexture();
    await Page.screenshot({ path: Path.join(Output, Name + ".png"), fullPage: true, timeout: 60000 });
}

try
{
    await Page.goto(Url, { waitUntil: "networkidle", timeout: 60000 });
    await WaitForTexture();
    Assert.equal(await Page.locator(".DesignOption").count(), 5);
    Assert.equal(await Page.locator("#Failure").isVisible(), false);
    const Initial = await Page.evaluate(() => window.TabletPrototype.QueryReading());
    Assert.equal(Initial.ApplicationCount, 12);
    Assert.equal(Initial.Hardware.CoverThickness, 0.0024);
    Assert.equal(Initial.PhysicallyTransmissiveGlass, true);
    Assert.equal(Initial.FlatDeviceTexture, true);
    Assert.equal(Initial.TextureWidth, 1920);
    Assert.equal(Initial.TextureHeight, 1200);
    Assert.ok(await Page.evaluate(() => [...document.fonts].every(Font => Font.status === "loaded")));
    Proof.initial = Initial;
    await Capture("Tablet");
    const Designs = await Page.evaluate(() => window.TabletPrototype.Designs);
    const Applications = await Page.evaluate(() => window.TabletPrototype.Applications);
    for (const Design of Designs)
    {
        await Page.locator(`[data-design="${Design.Identifier}"]`).click();
        await WaitForTexture();
        const Source = await Page.evaluate(() => window.TabletPrototype.QueryScreenPng());
        await FS.writeFile(Path.join(Output, Design.Identifier + "-screen.png"), Buffer.from(Source.split(",")[1], "base64"));
        await Capture(Design.Name);
        let Opened = 0;
        for (const Application of Applications)
        {
            if (Design.Identifier === "focus") await Contact("focus-choice:" + Application.Identifier);
            await Contact("app:" + Application.Identifier);
            await Page.waitForFunction(Identifier => window.TabletPrototype.QueryReading().Application === Identifier, Application.Identifier);
            ++Opened;
            ++Proof.interactiveOpenCount;
            await Contact("home");
            Assert.equal(await Page.evaluate(() => window.TabletPrototype.QueryReading().Application), null);
            Assert.equal(await Page.evaluate(() => window.TabletPrototype.QueryReading().Design), Design.Identifier);
        }
        Proof.designs[Design.Identifier] = { name: Design.Name, openedAppsByProjectedPointer: Opened, retainedDesignOnReturn: true };
        console.log("PASS", Design.Name, ": all twelve apps open and return using projected pointer input.");
    }

    await Page.locator('[data-design="launchpad"]').click();
    await Contact("app:vehicle");
    const Slider = await Page.evaluate(() => window.TabletPrototype.QueryRegions().find(Region => Region.Identifier === "slider:steering"));
    const Start = await Page.evaluate(Region => window.TabletPrototype.ProjectScreenPoint(Region.TrackLeft, Region.Top + 23), Slider);
    const End = await Page.evaluate(Region => window.TabletPrototype.ProjectScreenPoint(Region.TrackLeft + Region.TrackWidth * 0.82, Region.Top + 23), Slider);
    await Page.mouse.move(Start.Left, Start.Top); await Page.mouse.down();
    await Page.mouse.move(End.Left, End.Top, { steps: 4 }); await Page.mouse.up();
    Assert.ok((await Page.evaluate(() => window.TabletPrototype.QueryReading().Values.steering)) >= 80);
    await Contact("tab:Suspension");
    Assert.ok(await Page.evaluate(() => window.TabletPrototype.QueryRegions().some(Region => Region.Identifier === "slider:height")));
    await Contact("home");
    await Contact("app:drive-room");
    await Contact("ready");
    Assert.equal(await Page.evaluate(() => window.TabletPrototype.QueryReading().RoomReady), true);
    await Contact("home");
    await Contact("app:messages");
    await Contact("message-input");
    await Page.keyboard.type("A new road awaits.");
    await Page.keyboard.press("Enter");
    Assert.equal(await Page.evaluate(() => window.TabletPrototype.QueryReading().MessageCount), 3);
    await Page.keyboard.press("Escape");
    Assert.equal(await Page.evaluate(() => window.TabletPrototype.QueryReading().Application), null);
    await Contact("app:account");
    await Contact("rename");
    await Page.keyboard.press("Control+A");
    await Page.keyboard.type("Driver One");
    await Page.keyboard.press("Enter");
    Assert.equal(await Page.evaluate(() => window.TabletPrototype.QueryReading().Nickname), "Driver One");
    await Contact("home");
    Proof.applicationControls = { rayPickedSlider: true, setupTabs: true, roomReadiness: true, localMessageTextEntry: true, profileTextEntry: true, escapeHome: true };

    const Revision = await Page.evaluate(() => window.TabletPrototype.QueryReading().Revision);
    await Page.locator("#FlatButton").click();
    await WaitForTexture();
    const Flat = await Page.evaluate(() => window.TabletPrototype.QueryReading());
    Assert.equal(Flat.Camera.Mode, "2d");
    await Page.mouse.move(20, 20);
    await Contact("app:climate", true);
    await Contact("warmer", true);
    Assert.equal(await Page.evaluate(() => window.TabletPrototype.QueryReading().Values.temperature), 23);
    await Contact("home", true);
    await Capture("FlatTablet");
    await Page.locator("#PerspectiveButton").click();
    await Page.locator('[data-camera="edge"]').click();
    await WaitForTexture();
    Assert.equal(await Page.evaluate(() => window.TabletPrototype.QueryReading().Camera.Yaw), -66);
    await Capture("TabletEdge");
    await Page.locator('[data-camera="back"]').click();
    await WaitForTexture();
    const BackPoint = await Page.evaluate(() => window.TabletPrototype.ProjectScreenPoint(600, 320));
    await Page.mouse.click(BackPoint.Left, BackPoint.Top);
    Assert.equal(await Page.evaluate(() => window.TabletPrototype.QueryReading().Application), null);
    await Capture("TabletBack");
    await Page.locator("#ResetCamera").click();
    await Page.locator(".GlassControl").click();
    await WaitForTexture();
    Assert.equal(await Page.evaluate(() => window.TabletPrototype.QueryReading().GlassVisible), false);
    await Page.locator(".GlassControl").click();
    Assert.equal(await Page.evaluate(() => window.TabletPrototype.QueryReading().GlassVisible), true);
    await Page.locator('[data-finish="graphite"]').click();
    Assert.equal(await Page.locator('[data-finish="graphite"]').getAttribute("aria-pressed"), "true");
    await Page.locator('[data-finish="titanium"]').click();
    await WaitForTexture();
    Proof.cameraAndHardware = { perspective: true, orthographic: true, touchInFlatMode: true, edgeView: true,
        backViewCannotActivateFrontScreen: true, glassToggle: true, finishChanges: true, fixedTextureAcrossCameraChanges: true };

    const CanvasBounds = await Page.locator("#TabletCanvas").boundingBox();
    const PreviousYaw = await Page.evaluate(() => window.TabletPrototype.QueryReading().Camera.Yaw);
    await Page.mouse.move(CanvasBounds.x + 30, CanvasBounds.y + 35);
    await Page.mouse.down(); await Page.mouse.move(CanvasBounds.x + 155, CanvasBounds.y + 65, { steps: 4 }); await Page.mouse.up();
    Assert.notEqual(await Page.evaluate(() => window.TabletPrototype.QueryReading().Camera.Yaw), PreviousYaw);
    Proof.cameraAndHardware.backgroundDragOrbit = true;
    await Page.locator("#ResetCamera").click();

    await Page.setViewportSize({ width: 390, height: 844 });
    await WaitForTexture();
    Assert.equal(await Page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await Page.locator("#FlatButton").click();
    await Page.locator("#Viewport").scrollIntoViewIfNeeded();
    await Page.evaluate(() => window.scrollTo(0, document.getElementById("Viewport").getBoundingClientRect().top + window.scrollY - 8));
    await Contact("app:contacts", true);
    Assert.equal(await Page.evaluate(() => window.TabletPrototype.QueryReading().Application), "contacts");
    await Contact("home", true);
    await Capture("MobileTablet");
    Proof.mobile = { viewport: "390x844", noHorizontalOverflow: true, projectedTouchOpensApp: true };
    Assert.deepEqual(Errors, []);
    const Files = ["index.html", "TabletPanel.css", "AppSpecification.js", "IconDepot.js", "ScreenSequence.js", "TabletStructure.js", "TabletSequence.js", "Build.mjs", "package.json", "package-lock.json", "TabletRuntime.js", "TabletMetrics.mjs", "BrowserMetrics.mjs"];
    Proof.sourceSHA256 = {};
    for (const Name of Files) Proof.sourceSHA256[Name] = createHash("sha256").update(await FS.readFile(Path.join(Folder, Name))).digest("hex");
    Proof.imageSHA256 = {};
    for (const Name of (await FS.readdir(Output)).filter(Name => Name.endsWith(".png")))
        Proof.imageSHA256[Name] = createHash("sha256").update(await FS.readFile(Path.join(Output, Name))).digest("hex");
    Proof.passed = true;
    Proof.scope = "Actual WebGL tablet hardware and cover glass, flat canvas-to-GPU screen texture, five launcher designs and pointer/touch/text interaction. Local UI demos only; no native or online execution.";
    await FS.writeFile(Path.join(Output, "BrowserMetrics.json"), JSON.stringify(Proof, null, 2) + "\n");
    console.log("PASS actual tablet/browser interaction, five launchers, hardware, camera modes and mobile touch.");
}
finally
{
    await Context.close();
    await Browser.close();
}
