//============================================================================================================================================
//                                                            SCREENSEQUENCE.JS
//============================================================================================================================================
// 📦 Flat device artwork, retained hit regions, launcher variations and local demonstration applications.

// 📝 Copied from Experimental/TabletPanel (arena/215a6f39-frontier) into the IlluminationHost cabin. Three changes, all
//    marked "Cabin:": the Garage preview may be External (the host renders the car into a GPU texture and the cabin
//    overlay composites it into the preview rectangle, so nothing is read back), and the Telemetry and Tyres
//    applications read Live — the car's real speed, tread temperatures and pressures — when the host provides it.

import { Applications, LauncherDesigns, ScreenWidth, ScreenHeight, ResolveApplication, ResolveDesign } from "./AppSpecification.js";
import { VehiclePaintCatalogue, VehicleFinishModes, VehicleWheelCatalogue } from "../MaterialSpecification.js";

const FontFamily = '"DM Sans", Arial, sans-serif';

export class ScreenSequence
{
    constructor(Canvas, Icons, Announce)
    {
        this.Canvas = Canvas;
        this.Preview = null;
        this.Context = Canvas.getContext("2d", { alpha: false });
        this.Icons = Icons;
        this.Announce = Announce;
        this.Design = "launchpad";
        this.Application = null;
        this.Regions = [];
        this.Hovered = "";
        this.Pressed = "";
        this.Pointer = null;
        this.FocusIndex = 0;
        this.Dirty = true;
        this.Revision = 0;
        this.Values = { steering: 50, height: 35, stiffness: 65, spoiler: 14, pressure: 185, temperature: 22,
            fan: 2, volume: 55, brightness: 90, laps: 8, zoom: 1 };
        this.VehicleTab = "Steering";
        this.RoomReady = false;
        this.Invited = "";
        this.MediaPlaying = false;
        this.Nickname = "Aladin";
        this.MessageDraft = "";
        this.Messages = [{ From: "Amelia", Text: "Same road. New adventure?" }, { From: "You", Text: "See you in the Drive Room." }];
        this.TextTarget = "";
        this.FinishColour = "#adc600";
        this.GarageTab = "paint";
        this.ActivePaintId = "lime";
        this.ActiveFinishId = "gloss";
        this.ActiveWheelId = "trail";
        this.ScanMode = 0;        // 0 = Solid, 1 = X-Ray Sweep, 2 = Ghost + Wireframe
        this.ScanWorld = true;    // Sync X-Ray Scan to the real car in the 3D scene
        this.ScanProgress = 0.0;
        this.OnApplyMaterial = null;
        this.OnScanModeChanged = null;
        this.Notice = "";
        this.Clock = "";
        this.ActiveTextInput = null;
        this.Live = null;   // Cabin: { Speed [km/h], Temperatures [°C ×4], Pressures [kPa ×4], Tread [0–1 ×4], States [string ×4] }
        this.Scale = 1.6;
        this.OffsetAcross = 0;
        this.OffsetDown = 0;
        this.PanelWidth = ScreenWidth;
        this.PanelHeight = ScreenHeight;
        this.PresentAspect(ScreenWidth / ScreenHeight);
    }

    // 📝 Every car's panel has its own proportions; the launcher keeps its 16:10 layout at uniform scale and the panel
    //    background continues into the spare band, so one UI serves every console without stretching.
    PresentAspect(Aspect)
    {
        const Reference = ScreenWidth / ScreenHeight;
        this.PanelWidth = Aspect >= Reference ? ScreenHeight * Aspect : ScreenWidth;
        this.PanelHeight = Aspect >= Reference ? ScreenHeight : ScreenWidth / Aspect;
        this.OffsetAcross = (this.PanelWidth - ScreenWidth) / 2;
        this.OffsetDown = (this.PanelHeight - ScreenHeight) / 2;
        this.Canvas.width = Math.round(this.PanelWidth * this.Scale);
        this.Canvas.height = Math.round(this.PanelHeight * this.Scale);
        this.Dirty = true;
    }

    QueryPanelPoint(FractionAcross, FractionDown)
    {
        return { Across: FractionAcross * this.PanelWidth - this.OffsetAcross, Down: FractionDown * this.PanelHeight - this.OffsetDown };
    }

    QueryPanelFraction(Across, Down)
    {
        return { Across: (Across + this.OffsetAcross) / this.PanelWidth, Down: (Down + this.OffsetDown) / this.PanelHeight };
    }

    PresentDesign(Identifier)
    {
        if (!ResolveDesign(Identifier)) return false;
        this.Design = Identifier;
        this.PresentHome();
        return true;
    }

    PresentHome()
    {
        this.Application = null;
        this.Notice = "";
        this.Pointer = null;
        this.Hovered = "";
        this.Pressed = "";
        this.TextTarget = "";
        this.ActiveTextInput?.blur();
        this.Dirty = true;
        this.Announce?.();
    }

    PresentApplication(Identifier)
    {
        if (!ResolveApplication(Identifier)) return false;
        this.Application = Identifier;
        this.Notice = "";
        this.Hovered = "";
        this.Pressed = "";
        this.TextTarget = "";
        this.ActiveTextInput?.blur();
        this.Dirty = true;
        this.Announce?.();
        return true;
    }

    AdvanceClock()
    {
        const Reading = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
        if (Reading !== this.Clock) { this.Clock = Reading; this.Dirty = true; }
    }

    RasterRectangle(Left, Top, Width, Height, Radius, Colour, Stroke = null)
    {
        const Context = this.Context;
        Context.beginPath();
        Context.roundRect(Left, Top, Width, Height, Radius);
        Context.fillStyle = Colour;
        Context.fill();
        if (Stroke) { Context.strokeStyle = Stroke; Context.lineWidth = 1; Context.stroke(); }
    }

    RasterText(Text, Left, Top, Size = 20, Colour = "#e8eeee", Align = "left", Weight = 400)
    {
        const Context = this.Context;
        Context.font = `${Weight} ${Size}px ${FontFamily}`;
        Context.textBaseline = "alphabetic";
        Context.textAlign = Align;
        Context.fillStyle = Colour;
        Context.fillText(String(Text), Left, Top);
    }

    RasterIcon(Identifier, Left, Top, Extent)
    {
        this.Context.drawImage(this.Icons[Identifier], Left, Top, Extent, Extent);
    }

    RasterRule(Left, Top, Width, Colour = "#ffffff15")
    {
        this.Context.fillStyle = Colour;
        this.Context.fillRect(Left, Top, Width, 1);
    }

    AdmitRegion(Identifier, Left, Top, Width, Height, Action, Extra = {})
    {
        this.Regions.push({ Identifier, Left, Top, Width, Height, Action, ...Extra });
    }

    RasterButton(Identifier, Text, Left, Top, Width, Height, Action, Colour = "#253939", Ink = "#d7e7df")
    {
        const Hover = this.Hovered === Identifier;
        this.RasterRectangle(Left, Top, Width, Height, 14, Hover ? "#466057" : Colour);
        this.RasterText(Text, Left + Width / 2, Top + Height / 2 + 7, 19, Ink, "center");
        this.AdmitRegion(Identifier, Left, Top, Width, Height, Action);
    }

    RasterBackground(Light = false)
    {
        const Context = this.Context;
        const Colour = Context.createLinearGradient(0, 0, ScreenWidth, ScreenHeight);
        Colour.addColorStop(0, Light ? "#f1f1e7" : "#17262c");
        Colour.addColorStop(1, Light ? "#dfe8db" : "#121a22");
        Context.fillStyle = Colour;
        Context.fillRect(-this.OffsetAcross, -this.OffsetDown, this.PanelWidth, this.PanelHeight);
        const Glow = Context.createRadialGradient(1010, 70, 20, 960, 50, 670);
        Glow.addColorStop(0, Light ? "#ffffff85" : "#8eb29b26");
        Glow.addColorStop(1, "#8eb29b00");
        Context.fillStyle = Glow;
        Context.fillRect(-this.OffsetAcross, -this.OffsetDown, this.PanelWidth, this.PanelHeight);
    }

    RasterStatus(Light = false)
    {
        const Ink = Light ? "#394a46" : "#dae8e3";
        const Muted = Light ? "#86948a" : "#82978e";
        this.RasterText("F R O N T I E R", 48, 49, 15, Ink);
        this.RasterText("P", 242, 49, 16, Muted);
        this.RasterText("0", 269, 49, 24, Ink);
        this.RasterText("km/h", 290, 49, 12, Muted);
        this.Context.beginPath();
        this.Context.arc(941, 42, 3, 0, Math.PI * 2);
        this.Context.fillStyle = "#8dac8c";
        this.Context.fill();
        this.RasterText("LOCAL DEMO", 953, 48, 11, Muted);
        this.RasterText(this.Clock, 1150, 49, 17, Ink, "right");
        this.RasterRule(48, 74, 1104, Light ? "#283c2812" : "#ffffff0b");
    }

    RasterFooter(Light = false)
    {
        const Ink = Light ? "#5b6d5f" : "#879d92";
        this.RasterText("CONTROLVEHICLE", 50, 708, 12, Ink);
        this.RasterText("22°", 1096, 708, 19, Ink);
        this.RasterText("AUTO", 1129, 708, 10, Ink);
        this.RasterRectangle(553, 697, 94, 5, 3, Light ? "#8a9a8655" : "#e2eadd50");
        this.AdmitRegion("home", 505, 678, 190, 50, () => this.PresentHome());
        this.AdmitRegion("climate-shortcut", 1070, 678, 88, 50, () => this.PresentApplication("climate"));
    }

    RasterApplicationTile(Application, Left, Top, Width, Height, Style = "icon", Light = false)
    {
        const Identifier = "app:" + Application.Identifier;
        const Hover = this.Hovered === Identifier;
        const Pressed = this.Pressed === Identifier;
        const Ink = Light ? "#33453d" : "#e4ebe5";
        if (Style === "icon")
        {
            if (Hover || Pressed) this.RasterRectangle(Left + 8, Top, Width - 16, Height, 22, Light ? "#ffffff90" : "#ffffff0b");
            this.RasterIcon(Application.Identifier, Left + (Width - 85) / 2, Top + 17, 85);
            this.RasterText(Application.Name, Left + Width / 2, Top + 129, 21, Ink, "center");
            if (Application.Badge) this.RasterBadge(Application.Badge, Left + Width / 2 + 42, Top + 13);
        }
        else if (Style === "row")
        {
            this.RasterRectangle(Left, Top, Width, Height, 18, Hover ? "#41574c" : "#ffffff09");
            this.RasterIcon(Application.Identifier, Left + 16, Top + (Height - 55) / 2, 55);
            this.RasterText(Application.Name, Left + 86, Top + 37, 20, Ink);
            this.RasterText(Application.Caption, Left + 86, Top + 60, 12, Light ? "#7d8e79" : "#879b90");
            if (Application.Badge) this.RasterBadge(Application.Badge, Left + Width - 20, Top + 17);
        }
        else
        {
            const Colour = this.Context.createLinearGradient(Left, Top, Left + Width, Top + Height);
            Colour.addColorStop(0, Hover ? "#3c5548" : "#ffffff0d");
            Colour.addColorStop(1, "#ffffff04");
            this.RasterRectangle(Left, Top, Width, Height, 24, Colour, "#ffffff0a");
            this.RasterIcon(Application.Identifier, Left + 21, Top + 20, 58);
            this.RasterText(Application.Name, Left + 22, Top + 108, 23, Ink);
            if (Height > 145) this.RasterText(Application.Caption, Left + 22, Top + 133, 12, "#91a496");
            if (Application.Badge) this.RasterBadge(Application.Badge, Left + Width - 23, Top + 22);
        }
        this.AdmitRegion(Identifier, Left, Top, Width, Height, () => this.PresentApplication(Application.Identifier));
    }

    RasterBadge(Text, CentreX, CentreY)
    {
        this.RasterRectangle(CentreX - 12, CentreY - 10, 24, 20, 10, "#d3b3a3");
        this.RasterText(Text, CentreX, CentreY + 4, 12, "#3e3633", "center");
    }

    RasterLaunchpad()
    {
        this.RasterBackground();
        this.RasterStatus();
        this.RasterText("Welcome back, " + this.Nickname + ".", 56, 158, 41, "#ebefdf", "left", 300);
        this.RasterText("Your car. Your people. Your space.", 57, 197, 17, "#82968d");
        this.RasterRectangle(986, 120, 155, 68, 19, "#b1c5a115");
        this.RasterText("ALL APPS", 1008, 146, 10, "#9faf98");
        this.RasterText("12", 1008, 176, 25, "#d3dec7");
        for (let Index = 0; Index < Applications.length; ++Index)
        {
            const Column = Index % 6;
            const Row = Math.floor(Index / 6);
            this.RasterApplicationTile(Applications[Index], 40 + Column * 188, 255 + Row * 181, 176, 149);
        }
        this.RasterFooter();
    }

    RasterDashboard()
    {
        this.RasterBackground();
        this.RasterStatus();
        this.RasterText("A good day to drive.", 50, 151, 40, "#e4eddc", "left", 300);
        this.RasterText("Your essentials, brought together.", 52, 184, 16, "#83988a");
        const Hero = this.Context.createLinearGradient(50, 218, 385, 600);
        Hero.addColorStop(0, "#bbd2b0");
        Hero.addColorStop(1, "#86a698");
        this.RasterRectangle(50, 220, 340, 392, 29, Hero);
        this.RasterText("YOUR VEHICLE", 78, 264, 12, "#557362");
        this.RasterIcon("vehicle", 123, 295, 192);
        this.RasterText("ControlVehicle", 78, 531, 33, "#253e33", "left", 300);
        this.RasterText("Ready when you are.", 79, 562, 15, "#577867");
        this.RasterText("Explore  →", 79, 589, 15, "#304f3c");
        this.AdmitRegion("app:vehicle", 50, 220, 340, 392, () => this.PresentApplication("vehicle"));
        const Cards = Applications.filter(Application => Application.Identifier !== "vehicle" && !["account", "settings"].includes(Application.Identifier));
        for (let Index = 0; Index < Cards.length; ++Index)
            this.RasterApplicationTile(Cards[Index], 411 + (Index % 3) * 246, 220 + Math.floor(Index / 3) * 132, 230, 116, "card");
        this.RasterIcon("account", 54, 631, 28);
        this.RasterText(this.Nickname, 94, 653, 15, "#95aa97");
        this.AdmitRegion("app:account", 50, 623, 140, 40, () => this.PresentApplication("account"));
        this.RasterIcon("settings", 1010, 630, 27);
        this.RasterText("Settings", 1050, 651, 15, "#95aa97");
        this.AdmitRegion("app:settings", 997, 623, 148, 40, () => this.PresentApplication("settings"));
        this.RasterFooter();
    }

    RasterCollections()
    {
        this.RasterBackground(true);
        this.RasterStatus(true);
        this.RasterText("Everything in its place.", 53, 154, 40, "#2f473b", "left", 300);
        this.RasterText("A little less searching. A little more driving.", 55, 191, 16, "#82947f");
        const Categories = ["Vehicle", "Connect", "Personal"];
        const Colours = ["#d5e5d4", "#e0dfcf", "#d8e0e5"];
        for (let Column = 0; Column < Categories.length; ++Column)
        {
            const Left = 49 + Column * 375;
            const Category = Categories[Column];
            this.RasterRectangle(Left, 234, 351, 414, 29, Colours[Column]);
            this.RasterText(Category, Left + 27, 280, 26, "#3c5443");
            this.RasterText("0" + (Column + 1), Left + 318, 279, 13, "#94a28d", "right");
            const Members = Applications.filter(Application => Application.Category === Category);
            for (let Index = 0; Index < Members.length; ++Index)
            {
                const Application = Members[Index];
                const Top = 305 + Index * 80;
                const Hover = this.Hovered === "app:" + Application.Identifier;
                this.RasterRectangle(Left + 13, Top, 325, 70, 15, Hover ? "#ffffff98" : "#ffffff40");
                this.RasterIcon(Application.Identifier, Left + 25, Top + 11, 48);
                this.RasterText(Application.Name, Left + 91, Top + 39, 20, "#425540");
                this.RasterText("›", Left + 312, Top + 39, 24, "#8b9e82", "right");
                this.AdmitRegion("app:" + Application.Identifier, Left + 13, Top, 325, 70, () => this.PresentApplication(Application.Identifier));
            }
        }
        this.RasterFooter(true);
    }

    RasterFocus()
    {
        this.RasterBackground();
        this.RasterStatus();
        this.RasterText("Make room for what matters.", 53, 144, 37, "#e3eddf", "left", 300);
        this.RasterText("Swipe to explore. Tap to step inside.", 55, 179, 15, "#859b8e");
        for (const Offset of [-1, 0, 1])
        {
            const Index = (this.FocusIndex + Offset + Applications.length) % Applications.length;
            const Application = Applications[Index];
            const Centre = 600 + Offset * 406;
            const Main = Offset === 0;
            const Width = Main ? 375 : 286;
            const Top = Main ? 220 : 252;
            const Height = Main ? 342 : 278;
            const Colour = this.Context.createLinearGradient(Centre, Top, Centre, Top + Height);
            Colour.addColorStop(0, Main ? "#d7dfc6" : "#253936");
            Colour.addColorStop(1, Main ? "#a3bba3" : "#1d2c2c");
            this.RasterRectangle(Centre - Width / 2, Top, Width, Height, 27, Colour);
            this.RasterIcon(Application.Identifier, Centre - (Main ? 55 : 37), Top + 38, Main ? 110 : 74);
            this.RasterText(Application.Name, Centre, Top + (Main ? 201 : 158), Main ? 32 : 24, Main ? "#314b39" : "#c0d4c2", "center", 300);
            this.RasterText(Application.Caption, Centre, Top + (Main ? 232 : 185), 13, Main ? "#698269" : "#7d9783", "center");
            this.RasterText(Main ? "Open application  →" : "Tap to focus", Centre, Top + Height - 32, Main ? 17 : 13, Main ? "#466749" : "#87a18a", "center");
            this.AdmitRegion(Main ? "app:" + Application.Identifier : "focus:" + Index, Centre - Width / 2, Top, Width, Height,
                () => { if (Main) this.PresentApplication(Application.Identifier); else { this.FocusIndex = Index; this.Dirty = true; } }, { Swipe: true });
        }
        for (let Index = 0; Index < Applications.length; ++Index)
        {
            const Left = 176 + Index * 71;
            const Selected = Index === this.FocusIndex;
            if (Selected) this.RasterRectangle(Left - 9, 598, 57, 57, 16, "#b8d5a320");
            this.RasterIcon(Applications[Index].Identifier, Left, 607, 39);
            this.AdmitRegion("focus-choice:" + Applications[Index].Identifier, Left - 9, 598, 57, 57,
                () => { this.FocusIndex = Index; this.Dirty = true; });
        }
        this.RasterFooter();
    }

    RasterConsole()
    {
        this.RasterBackground();
        this.RasterRectangle(-this.OffsetAcross, -this.OffsetDown, 250 + this.OffsetAcross, this.PanelHeight, 0, "#edf0e3");
        this.RasterText("F R O N T I E R", 34, 51, 13, "#62745f");
        this.RasterText("0", 125, 184, 93, "#344739", "center", 300);
        this.RasterText("km/h", 125, 216, 15, "#8c9b80", "center");
        this.RasterRectangle(75, 244, 100, 31, 15, "#dce5d2");
        this.RasterText("P  ·  PARKED", 125, 264, 11, "#6e8362", "center");
        this.RasterIcon("vehicle", 65, 351, 120);
        this.RasterText("ControlVehicle", 125, 517, 20, "#465e42", "center");
        this.RasterText("Welcome, " + this.Nickname, 125, 549, 13, "#899b7e", "center");
        this.RasterRule(42, 611, 166, "#617a4b22");
        this.RasterText("LOCAL", 125, 656, 10, "#82986f", "center");
        this.RasterText("YOUR APPS", 290, 52, 12, "#8a9d89");
        this.RasterText(this.Clock, 1151, 52, 17, "#a9bba4", "right");
        this.RasterText("Choose your next move.", 290, 143, 35, "#e0ebd6", "left", 300);
        this.RasterText("Simple controls. Clear choices.", 292, 177, 15, "#849b80");
        for (let Index = 0; Index < Applications.length; ++Index)
            this.RasterApplicationTile(Applications[Index], 286 + (Index % 3) * 293, 218 + Math.floor(Index / 3) * 111, 276, 94, "row");
        this.RasterRectangle(670, 697, 86, 5, 3, "#dbe8cc40");
        this.AdmitRegion("home", 625, 678, 180, 50, () => this.PresentHome());
    }

    RasterSlider(Identifier, Name, Unit, Left, Top, Width, Minimum, Maximum, Step = 1)
    {
        const Value = this.Values[Identifier];
        this.RasterText(Name, Left, Top, 22, "#d8e4d5");
        this.RasterText(Value + Unit, Left + Width, Top, 24, "#b5d4a8", "right");
        this.RasterRectangle(Left, Top + 29, Width, 5, 3, "#3b4b42");
        const Fraction = (Value - Minimum) / (Maximum - Minimum);
        this.RasterRectangle(Left, Top + 29, Math.max(2, Width * Fraction), 5, 3, "#a3c394");
        this.Context.beginPath();
        this.Context.arc(Left + Width * Fraction, Top + 31, 10, 0, Math.PI * 2);
        this.Context.fillStyle = "#dce9ce";
        this.Context.fill();
        this.AdmitRegion("slider:" + Identifier, Left - 12, Top + 6, Width + 24, 49, null,
            { Slider: Identifier, TrackLeft: Left, TrackWidth: Width, Minimum, Maximum, Step });
    }

    RasterApplication()
    {
        this.RasterBackground();
        this.RasterStatus();
        const Application = ResolveApplication(this.Application);
        this.RasterButton("back", "‹  Apps", 48, 103, 107, 48, () => this.PresentHome(), "#ffffff0b");
        this.RasterIcon(Application.Identifier, 190, 97, 65);
        this.RasterText(Application.Name, 273, 136, 35, "#e3eddd", "left", 300);
        this.RasterText(Application.Caption, 274, 164, 15, "#879e89");
        this.RasterText("LOCAL DEMONSTRATION", 1140, 133, 10, "#8ea18c", "right");
        this.RasterRectangle(48, 209, 1104, 430, 28, "#ffffff06", "#ffffff0b");
        this.RasterApplicationContent(Application.Identifier);
        this.RasterText(this.Notice || "Design prototype · no live vehicle or online service is connected", 64, 665, 12, "#708875");
        this.RasterFooter();
    }

    RasterApplicationContent(Identifier)
    {
        if (Identifier === "vehicle")
        {
            this.RasterText("VEHICLE SETUP", 79, 256, 12, "#8fa487");
            for (const [Index, Tab] of ["Steering", "Suspension", "Aerodynamics"].entries())
                this.RasterButton("tab:" + Tab, Tab, 80 + Index * 245, 279, 229, 50,
                    () => { this.VehicleTab = Tab; this.Dirty = true; }, this.VehicleTab === Tab ? "#a6c396" : "#243931", this.VehicleTab === Tab ? "#304734" : "#acbba8");
            if (this.VehicleTab === "Steering")
            {
                this.RasterSlider("steering", "Mouse steering sensitivity", "%", 93, 410, 686, 10, 100);
                this.RasterText("Fine adjustment for your next drive.", 93, 478, 17, "#859b80");
            }
            else if (this.VehicleTab === "Suspension")
            {
                this.RasterSlider("height", "Ride height", " mm", 93, 389, 686, 15, 70);
                this.RasterSlider("stiffness", "Spring stiffness", "%", 93, 497, 686, 20, 100);
            }
            else this.RasterSlider("spoiler", "Rear wing angle", "°", 93, 409, 686, 4, 22);
            this.RasterIcon("vehicle", 891, 374, 135);
            this.RasterButton("vehicle-reset", "Restore defaults", 91, 555, 205, 49,
                () => { Object.assign(this.Values, { steering: 50, height: 35, stiffness: 65, spoiler: 14 }); this.Dirty = true; });
        }
        else if (Identifier === "drive-room")
        {
            this.RasterText("THE EVENING DRIVE", 82, 265, 14, "#91a286");
            this.RasterText("Your room. Your rules.", 80, 313, 34, "#d9e6ca", "left", 300);
            for (const [Index, Name] of ["Aladin", "Amelia", "Noah"].entries())
            {
                this.RasterRectangle(80, 345 + Index * 72, 527, 58, 16, "#b7d0980b");
                this.RasterText(Name, 107, 382 + Index * 72, 20, "#c2d8b6");
                this.RasterText(Index === 0 ? "YOU" : "DEMO CONTACT", 583, 382 + Index * 72, 10, "#809b6d", "right");
            }
            this.RasterText("Highlands Loop", 688, 317, 26, "#cfdec3");
            this.RasterSlider("laps", "Laps", "", 688, 399, 379, 1, 20);
            this.RasterButton("ready", this.RoomReady ? "Ready" : "Mark as ready", 688, 510, 379, 64,
                () => { this.RoomReady = !this.RoomReady; this.Notice = "Local readiness updated. No network room is joined."; this.Dirty = true; }, this.RoomReady ? "#b6ca99" : "#33513c", this.RoomReady ? "#385032" : "#c4d8b4");
        }
        else if (Identifier === "messages")
        {
            this.RasterText("AMELIA", 85, 265, 15, "#9db6a1");
            const Recent = this.Messages.slice(-4);
            for (let Index = 0; Index < Recent.length; ++Index)
            {
                const Message = Recent[Index];
                const Own = Message.From === "You";
                const Left = Own ? 419 : 85;
                this.RasterRectangle(Left, 286 + Index * 65, 650, 52, 15, Own ? "#abc1a726" : "#edf8ef0a");
                this.RasterText(Message.Text.slice(0, 62), Left + 19, 319 + Index * 65, 18, Own ? "#cee6bd" : "#c1d8c8");
            }
            this.RasterRectangle(83, 575, 800, 44, 12, "#12221c");
            this.RasterText(this.MessageDraft || "Write a message…", 102, 604, 18, this.MessageDraft ? "#d9ead0" : "#78917b");
            this.AdmitRegion("message-input", 83, 575, 800, 44, () => this.ReceiveText("message"));
            this.RasterButton("send-message", "Send", 904, 575, 181, 44, () => this.DeliverMessage(), "#a6c795", "#34512e");
        }
        else if (Identifier === "contacts")
        {
            for (const [Index, Name] of ["Amelia", "Noah", "Zara"].entries())
            {
                const Top = 269 + Index * 104;
                this.RasterIcon("contacts", 86, Top, 66);
                this.RasterText(Name, 174, Top + 30, 24, "#d9e4cc");
                this.RasterText("Demo contact", 175, Top + 58, 14, "#7d997d");
                this.RasterButton("invite:" + Name, this.Invited === Name ? "Invited" : "Invite to room", 830, Top + 5, 255, 55,
                    () => { this.Invited = Name; this.Notice = Name + " invited in the local prototype only."; this.Dirty = true; });
            }
        }
        else if (Identifier === "account")
        {
            this.RasterIcon("account", 85, 277, 134);
            this.RasterText("YOUR PROFILE", 271, 281, 12, "#8d9d8b");
            this.RasterText(this.Nickname, 268, 331, 40, "#d6e8c9", "left", 300);
            this.RasterText("A local profile for this design study.", 270, 367, 18, "#7d9679");
            this.RasterButton("rename", "Edit display name", 269, 407, 270, 55, () => this.ReceiveText("nickname"));
            this.RasterText("Display name", 269, 526, 17, "#85997d");
            this.RasterRectangle(267, 546, 560, 47, 12, "#12221c");
            this.RasterText(this.Nickname, 287, 577, 20, "#d1e7c2");
            this.AdmitRegion("nickname-input", 267, 546, 560, 47, () => this.ReceiveText("nickname"));
            this.RasterButton("save-name", "Done", 850, 546, 236, 47, () => { this.ActiveTextInput?.blur(); this.TextTarget = ""; this.Notice = "Display name saved locally for this visit."; this.Dirty = true; });
        }
        else if (Identifier === "climate")
        {
            this.RasterText("SET YOUR COMFORT", 86, 263, 13, "#8ca68a");
            this.RasterText(this.Values.temperature + "°", 354, 418, 114, "#dcebcf", "center", 300);
            this.RasterButton("colder", "−", 144, 458, 88, 62, () => this.IncrementValue("temperature", -1, 16, 29));
            this.RasterButton("warmer", "+", 476, 458, 88, 62, () => this.IncrementValue("temperature", 1, 16, 29));
            this.RasterIcon("climate", 847, 285, 120);
            this.RasterSlider("fan", "Fan speed", "", 687, 494, 378, 0, 5);
        }
        else if (Identifier === "tyres")
        {
            this.RasterIcon("tyres", 85, 281, 135);
            this.RasterText("FOUR CORNERS. ONE DRIVE.", 267, 276, 12, "#90a995");
            this.RasterText("Cold pressure", 268, 324, 33, "#dbe7d6", "left", 300);
            this.RasterSlider("pressure", "Selected pressure", " kPa", 269, 420, 752, 140, 240);
            // Cabin: the four corners live — temperature, pressure, tread left and any failure.
            const Live = this.Live;
            if (Live)
            {
                for (const [Index, Name] of ["FL", "FR", "RL", "RR"].entries())
                {
                    const Left = 270 + Index * 196;
                    const State = Live.States[Index];
                    this.RasterText(`${Name} ${Math.round(Live.Temperatures[Index])}°C`, Left, 512, 19, State ? "#e2ada4" : "#94b9aa");
                    this.RasterText(`${Math.round(Live.Pressures[Index])} kPa · ${Math.round(Live.Tread[Index] * 100)}%`, Left, 538, 15, "#88a285");
                    if (State) this.RasterText(State.toUpperCase(), Left, 562, 12, "#e2ada4");
                }
                this.RasterText("Live tyre telemetry · the slider pumps every intact tyre.", 270, 600, 15, "#778f7c");
            }
            else
            {
                this.RasterText("FL 20°C       FR 20°C       RL 20°C       RR 20°C", 270, 523, 19, "#94b9aa");
                this.RasterText("Demonstration values, not live tyre telemetry.", 270, 564, 15, "#778f7c");
            }
        }
        else if (Identifier === "media")
        {
            const Colour = this.Context.createLinearGradient(85, 265, 363, 576);
            Colour.addColorStop(0, "#bbb3ca"); Colour.addColorStop(1, "#436a70");
            this.RasterRectangle(84, 265, 305, 311, 25, Colour);
            this.RasterIcon("media", 174, 336, 125);
            this.RasterText("OPEN ROADS", 417, 308, 12, "#97a98d");
            this.RasterText("A slower kind of rush", 414, 361, 33, "#e0e8d4", "left", 300);
            this.RasterText("Player interface demo · no audio stream", 418, 402, 16, "#7c9580");
            this.RasterButton("media-play", this.MediaPlaying ? "Pause" : "Play", 418, 439, 205, 53,
                () => { this.MediaPlaying = !this.MediaPlaying; this.Dirty = true; }, "#c0c9a7", "#3b5037");
            this.RasterSlider("volume", "Volume", "%", 418, 548, 650, 0, 100);
        }
        else if (Identifier === "navigation")
        {
            const Context = this.Context;
            this.RasterRectangle(78, 240, 730, 370, 19, "#284640");
            Context.save();
            Context.beginPath(); Context.roundRect(78, 240, 730, 370, 19); Context.clip();
            const CentreX = 443, CentreY = 425;
            Context.translate(CentreX, CentreY); Context.scale(this.Values.zoom, this.Values.zoom); Context.translate(-CentreX, -CentreY);
            for (let Index = 0; Index < 7; ++Index)
            {
                Context.beginPath();
                Context.moveTo(38, 264 + Index * 62);
                Context.bezierCurveTo(220, 170 + Index * 71, 630, 325 + Index * 58, 920, 227 + Index * 61);
                Context.strokeStyle = "#cbe1bc11"; Context.lineWidth = 1; Context.stroke();
            }
            Context.beginPath(); Context.moveTo(160, 630); Context.bezierCurveTo(315, 513, 237, 354, 596, 332); Context.bezierCurveTo(671, 328, 694, 272, 797, 217);
            Context.strokeStyle = "#8cccac"; Context.lineWidth = 8; Context.stroke();
            this.RasterIcon("navigation", 470, 360, 55);
            Context.restore();
            this.RasterText("HIGHLANDS LOOP", 838, 293, 12, "#89a38b");
            this.RasterText("Find your road.", 836, 336, 27, "#d3e5c8", "left", 300);
            this.RasterText("Local route illustration", 838, 369, 14, "#7c987c");
            this.RasterButton("zoom-in", "+", 841, 435, 99, 64, () => this.IncrementValue("zoom", 0.25, 0.75, 2));
            this.RasterButton("zoom-out", "−", 958, 435, 99, 64, () => this.IncrementValue("zoom", -0.25, 0.75, 2));
        }
        else if (Identifier === "telemetry")
        {
            this.RasterText("DEMONSTRATION READINGS", 83, 264, 12, "#90a38b");
            // Cabin: live readings when the host provides them.
            const Live = this.Live;
            const Readings = Live ? [["Speed", String(Math.round(Live.Speed)), "km/h"],
                                     ["Hottest tread", String(Math.round(Math.max(...Live.Temperatures))), "°C"],
                                     ["Lowest pressure", String(Math.round(Math.min(...Live.Pressures))), "kPa"]]
                                  : [["Speed", "0", "km/h"], ["Tread", "20", "°C"], ["Pressure", String(this.Values.pressure), "kPa"]];
            for (const [Index, Reading] of Readings.entries())
            {
                const Left = 83 + Index * 340;
                this.RasterRectangle(Left, 300, 316, 249, 21, "#c9d5b407");
                this.RasterText(Reading[0], Left + 24, 342, 18, "#8c9f87");
                this.RasterText(Reading[1], Left + 24, 446, 71, "#d4e4c4", "left", 300);
                this.RasterText(Reading[2], Left + 25, 486, 19, "#88a285");
            }
            this.RasterText(Live ? "Live from the ControlVehicle's solver." : "Native vehicle readings will connect in the C++ phase.", 87, 594, 17, "#8aa380");
        }
        else if (Identifier === "garage")
        {
            this.RasterGarageContent();
        }
        else
        {
            this.RasterText("MAKE THIS SCREEN YOURS", 84, 264, 12, "#8da086");
            this.RasterSlider("brightness", "Screen brightness", "%", 91, 361, 962, 40, 100);
            this.RasterText("App grid", 93, 452, 21, "#c5d9ba");
            this.RasterText("Pick how your launcher arranges the same twelve apps.", 93, 480, 15, "#84997f");
            for (const [Index, Design] of LauncherDesigns.entries())
            {
                const Left = 89 + Index * 202, Top = 500, Chosen = this.Design === Design.Identifier;
                this.RasterRectangle(Left, Top, 188, 118, 16, Chosen ? "#b2c899" : "#1f3328", Chosen ? "#dcebc8" : null);
                this.RasterDesignSchematic(Design.Identifier, Left + 16, Top + 14, 156, 54, Chosen ? "#365035" : "#a9c49c");
                this.RasterText(Design.Name, Left + 16, Top + 94, 17, Chosen ? "#365035" : "#d4e3c8", "left", 500);
                this.RasterText(Design.Number, Left + 172, Top + 94, 13, Chosen ? "#4d6a48" : "#7f9a7a", "right");
                this.AdmitRegion("design:" + Design.Identifier, Left, Top, 188, 118, () => this.PresentDesign(Design.Identifier));
            }
        }
    }

    RasterDesignSchematic(Identifier, Left, Top, Width, Height, Colour)
    {
        // 📝 Miniature of each grid so the Settings picker shows the arrangement, not just a name.
        const Cell = (Across, Down, CellWidth, CellHeight) => this.RasterRectangle(Left + Across, Top + Down, CellWidth, CellHeight, 3, Colour);
        if (Identifier === "launchpad") { for (let Row = 0; Row < 2; ++Row) for (let Column = 0; Column < 6; ++Column) Cell(Column * 26, Row * 28, 20, 22); }
        else if (Identifier === "dashboard") { Cell(0, 0, 50, 54); for (let Row = 0; Row < 2; ++Row) for (let Column = 0; Column < 3; ++Column) Cell(58 + Column * 34, Row * 28, 30, 24); }
        else if (Identifier === "collections") { for (let Column = 0; Column < 3; ++Column) { Cell(Column * 54, 0, 48, 10); for (let Row = 0; Row < 2; ++Row) Cell(Column * 54, 16 + Row * 20, 48, 16); } }
        else if (Identifier === "focus") { Cell(50, 0, 56, 54); Cell(10, 14, 30, 30); Cell(116, 14, 30, 30); }
        else { Cell(0, 0, 40, 54); for (let Row = 0; Row < 4; ++Row) Cell(48, Row * 14, 108, 10); }
    }

    IncrementValue(Identifier, Difference, Minimum, Maximum)
    {
        this.Values[Identifier] = Math.max(Minimum, Math.min(Maximum, Math.round((this.Values[Identifier] + Difference) * 100) / 100));
        this.Dirty = true;
    }

    ReceiveText(Target)
    {
        this.TextTarget = Target;
        if (!this.ActiveTextInput) return;
        this.ActiveTextInput.value = Target === "message" ? this.MessageDraft : this.Nickname;
        this.ActiveTextInput.focus({ preventScroll: true });
        this.ActiveTextInput.setSelectionRange(this.ActiveTextInput.value.length, this.ActiveTextInput.value.length);
        this.Notice = Target === "message" ? "Type your message, then press Send or Enter." : "Type a name, then press Done or Enter.";
        this.Dirty = true;
    }

    AdmitText(Value)
    {
        if (this.TextTarget === "message") this.MessageDraft = Value.slice(0, 100);
        else if (this.TextTarget === "nickname") this.Nickname = Value.slice(0, 22);
        this.Dirty = true;
    }

    DeliverMessage()
    {
        if (!this.MessageDraft.trim()) return;
        this.Messages.push({ From: "You", Text: this.MessageDraft.trim() });
        this.MessageDraft = "";
        this.Notice = "Message added locally. Nothing was sent online.";
        if (this.ActiveTextInput) this.ActiveTextInput.value = "";
        this.Dirty = true;
    }

    RasterScreen()
    {
        if (!this.Dirty) return false;
        const Context = this.Context;
        Context.setTransform(this.Scale, 0, 0, this.Scale, this.OffsetAcross * this.Scale, this.OffsetDown * this.Scale);
        this.Regions = [];
        if (this.Application) this.RasterApplication();
        else if (this.Design === "dashboard") this.RasterDashboard();
        else if (this.Design === "collections") this.RasterCollections();
        else if (this.Design === "focus") this.RasterFocus();
        else if (this.Design === "console") this.RasterConsole();
        else this.RasterLaunchpad();
        if (this.Values.brightness < 100)
        {
            Context.fillStyle = `rgba(0, 0, 0, ${(100 - this.Values.brightness) / 140})`;
            Context.fillRect(-this.OffsetAcross, -this.OffsetDown, this.PanelWidth, this.PanelHeight);
        }
        ++this.Revision;
        this.Dirty = false;
        return true;
    }

    QueryContact(Across, Down)
    {
        return [...this.Regions].reverse().find(Region => Across >= Region.Left && Across <= Region.Left + Region.Width &&
            Down >= Region.Top && Down <= Region.Top + Region.Height) || null;
    }

    ForwardPointer(Phase, Across, Down)
    {
        const Contact = this.QueryContact(Across, Down);
        if (Phase === "hover")
        {
            const Identifier = Contact?.Identifier || "";
            if (Identifier !== this.Hovered) { this.Hovered = Identifier; this.Dirty = true; }
            return Boolean(Contact);
        }
        if (Phase === "down")
        {
            this.Pointer = { Contact, Across, Down, LastAcross: Across, LastDown: Down, PreviousAcross: Across, PreviousDown: Down, Moved: false };
            this.Pressed = Contact?.Identifier || "";
            if (Contact?.Slider) this.AdvanceSlider(Contact, Across);
            this.Dirty = true;
            return true;
        }
        if (Phase === "move" && this.Pointer)
        {
            const Active = this.Pointer;
            Active.LastAcross = Across;
            Active.LastDown = Down;
            if (Math.hypot(Across - Active.Across, Down - Active.Down) > 9) Active.Moved = true;
            if (Active.Contact?.Slider) this.AdvanceSlider(Active.Contact, Across);
            if (Active.Contact?.Orbit && this.Preview) { this.Preview.Orbit((Across - Active.PreviousAcross) * 0.012, (Down - Active.PreviousDown) * 0.008); this.Dirty = true; }
            if (Active.Contact?.MaterialDrag && Active.Moved) this.Dirty = true;
            Active.PreviousAcross = Across; Active.PreviousDown = Down;
            return true;
        }
        if (Phase === "up" && this.Pointer)
        {
            const Active = this.Pointer;
            const FinalAcross = Across || Active.LastAcross;
            const FinalDown = Down || Active.LastDown;
            if (Active.Contact?.MaterialDrag && Active.Moved)
            {
                const OverWell = FinalAcross >= 78 && FinalAcross <= 718 && FinalDown >= 248 && FinalDown <= 648;
                if (OverWell)
                {
                    const Origin = this.ResolvePreviewDropOrigin(FinalAcross, FinalDown, Active.Contact.MaterialDrag.kind);
                    this.ApplyGarageMaterial(Active.Contact.MaterialDrag, Origin, true);
                }
                else
                {
                    this.Notice = "Material drag cancelled — drop onto the 3D vehicle well or tap a swatch to apply.";
                }
            }
            else if (Active.Contact?.Swipe && Active.Moved && Math.abs(FinalAcross - Active.Across) > 45)
            {
                this.FocusIndex = (this.FocusIndex + (FinalAcross < Active.Across ? 1 : -1) + Applications.length) % Applications.length;
            }
            else if (!Active.Moved && Active.Contact && Contact?.Identifier === Active.Contact.Identifier)
                Active.Contact.Action?.();
            this.Pointer = null;
            this.Pressed = "";
            this.Dirty = true;
            return true;
        }
        if (Phase === "cancel")
        {
            if (this.Pointer?.Contact?.MaterialDrag && this.Pointer.Moved)
            {
                const FinalAcross = this.Pointer.LastAcross, FinalDown = this.Pointer.LastDown;
                if (FinalAcross >= 78 && FinalAcross <= 718 && FinalDown >= 248 && FinalDown <= 648)
                {
                    const Origin = this.ResolvePreviewDropOrigin(FinalAcross, FinalDown, this.Pointer.Contact.MaterialDrag.kind);
                    this.ApplyGarageMaterial(this.Pointer.Contact.MaterialDrag, Origin, true);
                }
            }
            this.Pointer = null;
            this.Pressed = "";
            this.Dirty = true;
        }
        return false;
    }

    ResolvePreviewDropOrigin(Across, Down, Kind)
    {
        const U = (Across - 78) / 640.0 - 0.5;
        const V = 0.5 - (Down - 248) / 400.0;
        const Yaw = this.Preview?.Yaw ?? 0.6;
        const OriginX = Math.max(-2.6, Math.min(2.6, -U * 4.4 * Math.sin(Yaw) + V * 1.3 * Math.cos(Yaw)));
        const OriginY = Math.max(-1.05, Math.min(1.05, U * 2.2 * Math.cos(Yaw)));
        const OriginZ = Math.max(-0.35, Math.min(0.85, V * 1.15 + (Kind === "wheel" ? -0.15 : 0.25)));
        return [OriginX, OriginY, OriginZ];
    }

    ApplyGarageMaterial(Spec, Origin = null, FromDrop = false)
    {
        if (Spec.kind === "paint")
        {
            this.ActivePaintId = Spec.paintId;
            if (Spec.finishId)
                this.ActiveFinishId = Spec.finishId;
            const Entry = VehiclePaintCatalogue.find((Item) => Item.id === this.ActivePaintId) || VehiclePaintCatalogue[0];
            this.FinishColour = Entry.hex;
            this.Notice = `${FromDrop ? "Dropped" : "Applied"} ${Entry.name} (${this.ActiveFinishId}) — real car & GI cards updated.`;
        }
        else if (Spec.kind === "finish")
        {
            this.ActiveFinishId = Spec.finishId;
            const Entry = VehiclePaintCatalogue.find((Item) => Item.id === this.ActivePaintId) || VehiclePaintCatalogue[0];
            this.Notice = `Updated clear-coat finish to ${this.ActiveFinishId} on ${Entry.name} — real car updated.`;
        }
        else if (Spec.kind === "wheel")
        {
            this.ActiveWheelId = Spec.wheelId;
            const Entry = VehicleWheelCatalogue.find((Item) => Item.id === this.ActiveWheelId) || VehicleWheelCatalogue[0];
            this.Notice = `${FromDrop ? "Dropped" : "Equipped"} ${Entry.name} (${Entry.size}) wheels — real car rims updated.`;
        }
        this.Dirty = true;
        this.OnApplyMaterial?.(Spec, Origin);
    }

    SetGarageScanMode(Mode, World = this.ScanWorld)
    {
        this.ScanMode = Mode;
        this.ScanWorld = World;
        const Labels = ["Solid coat", "X-Ray Perception Sweep", "Ghost + Wireframe"];
        this.Notice = `View mode: ${Labels[this.ScanMode] || "Solid"} (${this.ScanWorld ? "HMI + real car" : "HMI preview only"}).`;
        this.Dirty = true;
        this.OnScanModeChanged?.(this.ScanMode, this.ScanWorld);
    }

    RasterGarageContent()
    {
        const Context = this.Context;
        const Preview = this.Preview;
        const DragItem = this.Pointer?.Contact?.MaterialDrag && this.Pointer.Moved ? this.Pointer.Contact.MaterialDrag : null;
        const OverWell = !!(DragItem && this.Pointer.LastAcross >= 78 && this.Pointer.LastAcross <= 718
                            && this.Pointer.LastDown >= 248 && this.Pointer.LastDown <= 648);

        // ① 640 × 400 live 3D vehicle preview well
        this.RasterRectangle(78, 248, 640, 400, 22, "#0d1416",
                             OverWell ? "#34d399" : (this.ScanMode > 0 ? "#38bdf866" : "#ffffff14"));
        if (!Preview?.External && Preview?.Loaded)
        {
            Context.save();
            Context.beginPath(); Context.roundRect(78, 248, 640, 400, 22); Context.clip();
            Context.translate(78, 648); Context.scale(1, -1);
            Context.drawImage(Preview.Readback, 0, 0, 640, 400);
            Context.restore();
        }
        else if (!Preview?.External && !Preview?.Loaded)
        {
            this.RasterText(Preview?.Failure ? "Preview unavailable: " + Preview.Failure : "Loading your car…", 398, 455, 20, "#7d968b", "center");
        }
        this.AdmitRegion("preview-orbit", 78, 248, 640, 400, null, { Orbit: true });

        // ② X-Ray Scan HUD overlay inside the preview well (composited over PreviewTexture by CabinOverlay.wgsl)
        if (this.ScanMode > 0)
        {
            this.RasterRectangle(94, 262, 232, 28, 14, "#152b36", "#38bdf8");
            this.RasterText(this.ScanMode === 1 ? "● PERCEPTION SCAN · SWEEP" : "● GHOST + WIREFRAME · HOLD", 108, 280, 11, "#7dd3fc", "left", 500);

            const Pct = Math.round((this.ScanMode === 2 ? 1.0 : (this.ScanProgress || 0.0)) * 100);
            this.RasterRectangle(566, 262, 136, 28, 14, "#152b36", "#38bdf888");
            this.RasterText(`LiDAR 360° · ${Pct}%`, 634, 280, 11, "#bae6fd", "center", 500);

            // Corner HUD brackets
            Context.save();
            Context.strokeStyle = "#38bdf8";
            Context.lineWidth = 2;
            const Corners = [[94, 304, 1, 1], [702, 304, -1, 1], [94, 604, 1, -1], [702, 604, -1, -1]];
            for (const [Cx, Cy, Dx, Dy] of Corners)
            {
                Context.beginPath();
                Context.moveTo(Cx, Cy + Dy * 16);
                Context.lineTo(Cx, Cy);
                Context.lineTo(Cx + Dx * 16, Cy);
                Context.stroke();
            }
            Context.restore();

            // Component callout tags over the transparent ghost/wireframe car
            const Callouts = [
                [112, 342, "Double-Wishbone Struts"],
                [488, 336, "Cockpit · Live HMI + Mirrors"],
                [112, 566, "MF6.1 Tyres · 220 kPa"],
                [488, 566, "ReSTIR Surface Cards"]
            ];
            for (const [Tx, Ty, Label] of Callouts)
            {
                this.RasterRectangle(Tx, Ty, 196, 24, 8, "#142630", "#38bdf855");
                this.RasterText(Label, Tx + 10, Ty + 16, 11, "#93c5fd");
            }
        }

        // Bottom caption / drop hint inside the preview well
        if (DragItem)
        {
            this.RasterRectangle(168, 608, 460, 30, 15, OverWell ? "#12382c" : "#182830", OverWell ? "#34d399" : "#38bdf888");
            this.RasterText(OverWell ? `● RELEASE TO APPLY ${DragItem.name.toUpperCase()} TO VEHICLE`
                                     : `Drag onto vehicle to apply ${DragItem.name}`, 398, 627, 12,
                            OverWell ? "#6ee7b7" : "#bae6fd", "center", 500);
        }
        else
        {
            const Facets = Preview?.Facets ? Preview.Facets.toLocaleString("en-GB") + " facets · " : "";
            this.RasterRectangle(92, 614, 496, 24, 10, "#142228");
            this.RasterText(Facets + "Drag swatch onto car or tap to apply · Drag car to orbit", 104, 630, 11, "#9ab4a8");
            this.RasterButton("preview-spin", Preview?.Spin ? "Pause spin" : "Spin", 598, 610, 106, 30,
                () => { if (Preview) { Preview.Spin = !Preview.Spin; Preview.Dirty = true; this.Dirty = true; } }, "#1d332c", "#bde0c8");
        }

        // ③ Right-hand Configurator Panel (x: 740..1136)
        const ActivePaint = VehiclePaintCatalogue.find((Item) => Item.id === this.ActivePaintId) || VehiclePaintCatalogue[0];
        const ActiveWheel = VehicleWheelCatalogue.find((Item) => Item.id === this.ActiveWheelId) || VehicleWheelCatalogue[0];

        this.RasterText("STUDIO CONFIGURATOR · REAL-CAR SYNC", 744, 236, 11, "#7dd3fc", "left", 500);
        this.RasterText(`${ActivePaint.name} · ${this.ActiveFinishId === "matte" ? "Matte" : "Gloss"} · ${ActiveWheel.name}`,
                        744, 258, 15, "#dce8cc", "left", 500);

        // X-Ray Ghost / Wireframe Scan Mode selector row
        const ScanModes = [[0, "Solid"], [1, "X-Ray Sweep"], [2, "Ghost + Wire"]];
        for (const [Index, [Mode, Label]] of ScanModes.entries())
        {
            const Left = 744 + Index * 98, Top = 270, Active = this.ScanMode === Mode;
            this.RasterRectangle(Left, Top, 92, 32, 10, Active ? "#164e63" : "#1a2b27", Active ? "#38bdf8" : "#ffffff14");
            this.RasterText(Label, Left + 46, Top + 20, 12, Active ? "#e0f2fe" : "#9cb3a5", "center", Active ? 500 : 400);
            this.AdmitRegion("scan-mode:" + Mode, Left, Top, 92, 32, () => this.SetGarageScanMode(Mode, this.ScanWorld));
        }
        // World-car sync toggle pill
        const WorldActive = this.ScanWorld;
        this.RasterRectangle(1040, 270, 92, 32, 10, WorldActive ? "#193b2f" : "#1a2624", WorldActive ? "#34d399" : "#ffffff14");
        this.RasterText(WorldActive ? "World: ON" : "World: OFF", 1086, 290, 11, WorldActive ? "#a7f3d0" : "#8ba195", "center", 500);
        this.AdmitRegion("scan-world", 1040, 270, 92, 32, () => this.SetGarageScanMode(this.ScanMode, !this.ScanWorld));

        // Category Tabs: Paint & Finish vs Wheels
        const Tabs = [["paint", "Paint & Coat (9)"], ["wheels", "Wheel Rims (4)"]];
        for (const [Index, [TabId, Label]] of Tabs.entries())
        {
            const Left = 744 + Index * 196, Top = 312, Chosen = this.GarageTab === TabId;
            this.RasterRectangle(Left, Top, 190, 34, 11, Chosen ? "#b5cf9e" : "#1c2e28", Chosen ? "#e2f0d5" : "#ffffff12");
            this.RasterText(Label, Left + 95, Top + 22, 13, Chosen ? "#253b29" : "#b8ccb9", "center", 500);
            this.AdmitRegion("garage-tab:" + TabId, Left, Top, 190, 34, () => { this.GarageTab = TabId; this.Dirty = true; });
        }

        if (this.GarageTab === "paint")
        {
            // Finish mode toggle (Gloss vs Matte)
            this.RasterText("FINISH", 744, 372, 11, "#8fa898", "left", 500);
            for (const [Index, Finish] of VehicleFinishModes.entries())
            {
                const Left = 810 + Index * 160, Top = 354, Selected = this.ActiveFinishId === Finish.id;
                this.RasterRectangle(Left, Top, 152, 28, 9, Selected ? "#2a473c" : "#182622", Selected ? "#a7f3d0" : "#ffffff12");
                this.RasterText(Finish.id === "gloss" ? "Gloss Clearcoat" : "Matte Satin", Left + 76, Top + 18, 12,
                                Selected ? "#ecfdf5" : "#9cb3a5", "center", Selected ? 500 : 400);
                this.AdmitRegion("finish:" + Finish.id, Left, Top, 152, 28,
                    () => this.ApplyGarageMaterial({ kind: "finish", finishId: Finish.id }));
            }

            // 3 × 3 Paint Swatch Grid (drag onto car OR tap to apply)
            for (const [Index, Paint] of VehiclePaintCatalogue.entries())
            {
                const Col = Index % 3, Row = Math.floor(Index / 3);
                const Left = 744 + Col * 131, Top = 392 + Row * 82, Width = 124, Height = 74;
                const Selected = this.ActivePaintId === Paint.id;
                this.RasterRectangle(Left, Top, Width, Height, 14, "#152320", Selected ? "#e2f2d5" : "#ffffff16");
                // Colour well inside card
                this.RasterRectangle(Left + 8, Top + 8, Width - 16, 36, 9, Paint.hex, Selected ? "#ffffffaa" : "#00000044");
                // Specular highlight sheen for gloss/metallic
                if (this.ActiveFinishId === "gloss")
                {
                    this.RasterRectangle(Left + 14, Top + 12, Width - 48, 6, 3, Paint.metallic ? "#ffffff55" : "#ffffff28");
                }
                this.RasterText(Paint.name, Left + 10, Top + 62, 12, Selected ? "#f0f9e8" : "#b8cab8", "left", Selected ? 500 : 400);
                const DragSpec = { kind: "paint", paintId: Paint.id, finishId: this.ActiveFinishId, name: Paint.name, hex: Paint.hex };
                this.AdmitRegion("paint:" + Paint.id, Left, Top, Width, Height,
                    () => this.ApplyGarageMaterial(DragSpec, null, false),
                    { MaterialDrag: DragSpec });
            }
        }
        else
        {
            // 2 × 2 Wheel Rim Finish Cards (drag onto car OR tap to apply)
            for (const [Index, Wheel] of VehicleWheelCatalogue.entries())
            {
                const Col = Index % 2, Row = Math.floor(Index / 2);
                const Left = 744 + Col * 196, Top = 360 + Row * 136, Width = 188, Height = 124;
                const Selected = this.ActiveWheelId === Wheel.id;
                this.RasterRectangle(Left, Top, Width, Height, 16, Selected ? "#1f3830" : "#152320", Selected ? "#a7f3d0" : "#ffffff16");
                this.RasterWheelDiagram(Left + 44, Top + 52, 34, Wheel);
                this.RasterText(Wheel.size, Left + 92, Top + 36, 12, "#7dd3fc", "left", 500);
                this.RasterText(Wheel.name, Left + 92, Top + 56, 14, Selected ? "#f0fdf4" : "#d2e2d4", "left", 500);
                this.RasterText(`${Wheel.spokes} spokes · ${Wheel.machined ? "Machined" : "Satin"}`, Left + 92, Top + 76, 11, "#8fa898");
                this.RasterText(Selected ? "● Equipped" : "Drag or tap", Left + 92, Top + 102, 11, Selected ? "#6ee7b7" : "#7fa090", "left", 500);
                const DragSpec = { kind: "wheel", wheelId: Wheel.id, name: Wheel.name, hex: Wheel.rim };
                this.AdmitRegion("wheel:" + Wheel.id, Left, Top, Width, Height,
                    () => this.ApplyGarageMaterial(DragSpec, null, false),
                    { MaterialDrag: DragSpec });
            }
        }

        // ④ Floating DragGhost chip when dragging a Paint or Wheel card across the HMI screen
        if (DragItem)
        {
            this.RasterGarageDragGhost(this.Pointer.LastAcross, this.Pointer.LastDown, DragItem, OverWell);
        }
    }

    RasterWheelDiagram(CentreX, CentreY, Radius, Wheel)
    {
        const Context = this.Context;
        Context.save();
        // Outer rubber tyre
        Context.beginPath();
        Context.arc(CentreX, CentreY, Radius, 0, Math.PI * 2);
        Context.fillStyle = "#111618";
        Context.fill();
        Context.lineWidth = 3;
        Context.strokeStyle = "#2b373d";
        Context.stroke();
        // Alloy rim barrel
        const RimRadius = Radius * 0.74;
        Context.beginPath();
        Context.arc(CentreX, CentreY, RimRadius, 0, Math.PI * 2);
        Context.fillStyle = "#0b0f12";
        Context.fill();
        Context.lineWidth = 3.5;
        Context.strokeStyle = Wheel.rim;
        Context.stroke();
        // Spokes
        Context.strokeStyle = Wheel.machined ? "#e2e8f0" : Wheel.rim;
        Context.lineWidth = Wheel.spokes > 7 ? 2.2 : 3.2;
        for (let Index = 0; Index < Wheel.spokes; ++Index)
        {
            const Angle = (Index / Wheel.spokes) * Math.PI * 2;
            Context.beginPath();
            Context.moveTo(CentreX + Math.cos(Angle) * (Radius * 0.22), CentreY + Math.sin(Angle) * (Radius * 0.22));
            Context.lineTo(CentreX + Math.cos(Angle) * (RimRadius - 1.5), CentreY + Math.sin(Angle) * (RimRadius - 1.5));
            Context.stroke();
        }
        // Centre hub cap
        Context.beginPath();
        Context.arc(CentreX, CentreY, Radius * 0.22, 0, Math.PI * 2);
        Context.fillStyle = Wheel.hub;
        Context.fill();
        Context.restore();
    }

    RasterGarageDragGhost(Across, Down, DragItem, OverWell)
    {
        const Width = 224, Height = 58;
        const Left = Math.max(84, Math.min(1110 - Width, Across - Width * 0.5));
        const Top = Math.max(216, Math.min(640 - Height, Down - Height - 14));
        this.RasterRectangle(Left, Top, Width, Height, 16, "#1d2e36", OverWell ? "#34d399" : "#7dd3fc");
        this.RasterRectangle(Left + 10, Top + 10, 38, 38, 12, DragItem.hex, "#ffffff66");
        this.RasterText(DragItem.name, Left + 58, Top + 27, 14, "#f1f5f9", "left", 500);
        this.RasterText(OverWell ? "● Release to apply" : "Drag to 3D car well", Left + 58, Top + 45, 11,
                        OverWell ? "#6ee7b7" : "#94a3b8", "left", 500);
    }

    AdvanceSlider(Contact, Across)
    {
        const Fraction = Math.max(0, Math.min(1, (Across - Contact.TrackLeft) / Contact.TrackWidth));
        this.Values[Contact.Slider] = Math.round((Contact.Minimum + Fraction * (Contact.Maximum - Contact.Minimum)) / Contact.Step) * Contact.Step;
        this.Dirty = true;
    }

    QueryReading()
    {
        return { Design: this.Design, Application: this.Application, Revision: this.Revision,
            ApplicationCount: Applications.length, Values: { ...this.Values }, RoomReady: this.RoomReady,
            Nickname: this.Nickname, MessageCount: this.Messages.length, FocusIndex: this.FocusIndex,
            TextTarget: this.TextTarget, RegionCount: this.Regions.length };
    }
}
