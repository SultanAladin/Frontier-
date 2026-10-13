import Assert from "node:assert/strict";
import { Applications, LauncherDesigns, ScreenWidth, ScreenHeight, ResolveApplication, ResolveDesign } from "./AppSpecification.js";
import { ResolveIconSvg } from "./IconDepot.js";
import { ScreenSequence } from "./ScreenSequence.js";

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
console.log(`PASS ${Assertions} source/layout/interaction assertions. These checks do not claim browser or GPU execution.`);
