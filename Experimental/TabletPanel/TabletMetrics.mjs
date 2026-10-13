import Assert from "node:assert/strict";
import { Applications, LauncherDesigns, ScreenWidth, ScreenHeight, ResolveApplication, ResolveDesign } from "./AppSpecification.js";
import { ResolveIconSvg } from "./IconDepot.js";
import { ScreenSequence } from "./ScreenSequence.js";
import { ClusterSequence, ClusterOutlines, ClusterWidth, ClusterHeight } from "./ClusterSequence.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

let Assertions = 0;
function Require(Condition, Explanation)
{
    Assert.ok(Condition, Explanation);
    ++Assertions;
}
const Gradient = { addColorStop() {} };
const Context = new Proxy({}, { get(Target, Name)
{
    if (Name === "createLinearGradient" || Name === "createRadialGradient") return () => Gradient;
    return typeof Target[Name] === "function" ? Target[Name] : () => {};
}, set(Target, Name, Value) { Target[Name] = Value; return true; } });
const Canvas = { width: 0, height: 0, getContext: () => Context };
const ActiveScreen = new ScreenSequence(Canvas, Object.fromEntries(Applications.map(Application => [Application.Identifier, {}])), () => {});
ActiveScreen.AdvanceClock();
Require(Applications.length === 12, "Twelve declared applications");
Require(LauncherDesigns.length === 5, "Five distinctly identified launcher designs");
Require(new Set(Applications.map(Application => Application.Identifier)).size === 12, "Unique application identities");
Require(!ActiveScreen.PresentApplication("missing"), "Unknown applications are refused");
Require(!ActiveScreen.PresentDesign("missing"), "Unknown designs are refused");
for (const Application of Applications)
{
    const Svg = ResolveIconSvg(Application.Identifier);
    Require(Svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), Application.Name + " has SVG artwork");
    Require(new Set(Svg.match(/#[0-9a-fA-F]{6}/g)).size >= 4, Application.Name + " is genuinely multicolour");
    Require(ResolveApplication(Application.Identifier) === Application, "Application identity resolves");
}
for (const Design of LauncherDesigns)
{
    Require(ResolveDesign(Design.Identifier) === Design, "Design identity resolves");
    ActiveScreen.PresentDesign(Design.Identifier);
    Require(ActiveScreen.RasterScreen(), "Changed design generates a fresh flat image");
    Require(!ActiveScreen.RasterScreen(), "Unchanged UI retains its texture without redrawing");
    for (const Region of ActiveScreen.Regions)
    {
        Require(Region.Left >= 0 && Region.Top >= 0 && Region.Left + Region.Width <= ScreenWidth && Region.Top + Region.Height <= ScreenHeight,
            Design.Name + ": touch region lies inside the device screen: " + Region.Identifier);
    }
    const Prefix = Design.Identifier === "focus" ? "focus-choice:" : "app:";
    for (const Application of Applications)
    {
        const Region = ActiveScreen.Regions.find(Candidate => Candidate.Identifier === Prefix + Application.Identifier);
        Require(Boolean(Region), Design.Name + ": every app is reachable: " + Application.Identifier);
        ActiveScreen.ForwardPointer("down", Region.Left + Region.Width / 2, Region.Top + Region.Height / 2);
        ActiveScreen.ForwardPointer("up", Region.Left + Region.Width / 2, Region.Top + Region.Height / 2);
        if (Design.Identifier === "focus")
        {
            ActiveScreen.RasterScreen();
            const Focus = ActiveScreen.Regions.find(Candidate => Candidate.Identifier === "app:" + Application.Identifier);
            ActiveScreen.ForwardPointer("down", Focus.Left + Focus.Width / 2, Focus.Top + Focus.Height / 2);
            ActiveScreen.ForwardPointer("up", Focus.Left + Focus.Width / 2, Focus.Top + Focus.Height / 2);
        }
        Require(ActiveScreen.Application === Application.Identifier, Design.Name + ": touch opens the selected app");
        ActiveScreen.RasterScreen();
        const Home = ActiveScreen.Regions.find(Candidate => Candidate.Identifier === "home");
        ActiveScreen.ForwardPointer("down", Home.Left + Home.Width / 2, Home.Top + Home.Height / 2);
        ActiveScreen.ForwardPointer("up", Home.Left + Home.Width / 2, Home.Top + Home.Height / 2);
        Require(ActiveScreen.Application === null, "Device home returns to its current launcher");
        ActiveScreen.RasterScreen();
    }
}
ActiveScreen.PresentApplication("vehicle");
ActiveScreen.RasterScreen();
const Slider = ActiveScreen.Regions.find(Region => Region.Identifier === "slider:steering");
ActiveScreen.ForwardPointer("down", Slider.TrackLeft, Slider.Top + 20);
ActiveScreen.ForwardPointer("move", Slider.TrackLeft + Slider.TrackWidth * 4, Slider.Top + 120);
Require(ActiveScreen.Values.steering === 100, "Captured slider continues outside its bounds and clamps to its maximum");
ActiveScreen.ForwardPointer("cancel", 0, 0);
Require(ActiveScreen.Pointer === null && ActiveScreen.Pressed === "", "Pointer cancellation releases the active control");
ActiveScreen.PresentApplication("messages");
ActiveScreen.TextTarget = "message";
ActiveScreen.AdmitText("See you at the start.");
ActiveScreen.DeliverMessage();
Require(ActiveScreen.Messages.length === 3 && ActiveScreen.MessageDraft === "", "Local message composition and send action");
ActiveScreen.TextTarget = "nickname";
ActiveScreen.AdmitText("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
Require(ActiveScreen.Nickname.length === 22, "Profile text entry has a finite bound");
// Modular panel: the same launcher at every console aspect, with exact round-trip touch mapping.
for (const Aspect of [1.5, 1.6, 2.22, 0.79])
{
    ActiveScreen.PresentAspect(Aspect);
    Require(Math.abs(ActiveScreen.PanelWidth / ActiveScreen.PanelHeight - Aspect) < 0.002, "Panel raster follows console aspect " + Aspect);
    Require(ActiveScreen.PanelWidth >= ScreenWidth - 0.001 && ActiveScreen.PanelHeight >= ScreenHeight - 0.001, "Launcher layout is never cropped at aspect " + Aspect);
    const Fraction = ActiveScreen.QueryPanelFraction(300, 200);
    const Point = ActiveScreen.QueryPanelPoint(Fraction.Across, Fraction.Down);
    Require(Math.abs(Point.Across - 300) < 1e-6 && Math.abs(Point.Down - 200) < 1e-6, "Touch mapping round-trips at aspect " + Aspect);
    ActiveScreen.PresentHome();
    ActiveScreen.RasterScreen();
    Require(ActiveScreen.Regions.some(Region => Region.Identifier === "app:garage"), "Launcher regions exist at aspect " + Aspect);
}
ActiveScreen.PresentAspect(1.6);
// Settings app owns the launcher picker.
ActiveScreen.PresentApplication("settings");
ActiveScreen.RasterScreen();
for (const Design of LauncherDesigns)
    Require(ActiveScreen.Regions.some(Region => Region.Identifier === "design:" + Design.Identifier), "Settings offers launcher " + Design.Name);
const Pick = ActiveScreen.Regions.find(Region => Region.Identifier === "design:focus");
ActiveScreen.ForwardPointer("down", Pick.Left + 5, Pick.Top + 5); ActiveScreen.ForwardPointer("up", Pick.Left + 5, Pick.Top + 5);
Require(ActiveScreen.Design === "focus", "Launcher design is chosen from inside the Settings app");
// Garage page carries the real-car preview region and orbit gesture.
const Orbits = [];
ActiveScreen.Preview = { Loaded: true, Facets: 19948, Spin: true, Readback: {}, Orbit: (Yaw, Pitch) => Orbits.push([Yaw, Pitch]) };
ActiveScreen.PresentApplication("garage");
ActiveScreen.RasterScreen();
const OrbitRegion = ActiveScreen.Regions.find(Region => Region.Identifier === "preview-orbit");
Require(OrbitRegion?.Orbit === true, "Garage exposes a car-preview orbit surface");
ActiveScreen.ForwardPointer("down", OrbitRegion.Left + 100, OrbitRegion.Top + 100);
ActiveScreen.ForwardPointer("move", OrbitRegion.Left + 160, OrbitRegion.Top + 110);
ActiveScreen.ForwardPointer("up", OrbitRegion.Left + 160, OrbitRegion.Top + 110);
Require(Orbits.length === 1 && Orbits[0][0] > 0, "Dragging the preview orbits the car instead of activating a button");
// Cluster: irregular outlines, masked raster, independent 30 Hz cadence.
const ClusterCanvas = { width: 0, height: 0, getContext: () => Context };
const Cluster = new ClusterSequence(ClusterCanvas);
Require(Object.keys(ClusterOutlines).length === 4 && ["hexagon", "arc", "trapezoid", "pill"].every(Key => ClusterOutlines[Key]), "Four irregular cluster outlines");
for (const [Key, Outline] of Object.entries(ClusterOutlines))
{
    const Points = Outline.Points();
    Require(Points.length >= 4 && Points.every(([Across, Down]) => Math.abs(Across) <= 1.0001 && Math.abs(Down) <= 1.0001), Key + " outline is a closed unit polygon");
    Require(Outline.Width > 0.1 && Outline.Height > 0.1, Key + " has physical housing dimensions");
}
const Arc = ClusterOutlines.arc.Points();
Require(Math.hypot(Arc[0][0] - Arc.at(-1)[0], Arc[0][1] - Arc.at(-1)[1]) > 1, "Arc outline is a partial (≈70 %) circle, not a full ring");
Require(!Cluster.PresentOutline("octagon") && Cluster.PresentOutline("trapezoid"), "Unknown cluster outlines are refused");
Require(ClusterCanvas.width === ClusterWidth * 1.5 && ClusterCanvas.height === ClusterHeight * 1.5, "Cluster raster has its own resolution");
Require(Cluster.RasterCluster(0) && !Cluster.RasterCluster(0.01), "Cluster re-rasters only when dirty");
Cluster.AdvanceDemonstration(1.0);
Require(Cluster.Dirty && !Cluster.RasterCluster(0.02) && Cluster.RasterCluster(0.05), "Cluster cadence is capped at its own 30 Hz");
// Real-car preview asset is the extracted project vehicle.
const Manifest = JSON.parse(readFileSync(new URL("./ControlVehicle.json", import.meta.url), "utf8"));
const Digest = createHash("sha256").update(readFileSync(new URL("./ControlVehicle.glb", import.meta.url))).digest("hex");
Require(Digest === Manifest.glbSHA256, "ControlVehicle.glb matches its extraction manifest");
Require(Manifest.facets === 19948 && Manifest.nodes?.length === 5, "Preview carries the body and four XPBD tyres of the project car");
console.log(`PASS ${Assertions} source/layout/interaction assertions. These checks do not claim browser or GPU execution.`);
