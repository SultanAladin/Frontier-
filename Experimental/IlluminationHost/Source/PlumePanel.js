//============================================================================================================================================
//                                                              PLUMEPANEL.JS
//============================================================================================================================================
// 🧩 The smoke-and-fire editor: the Frontier gas card stack — domain, budget, source, appearance, lighting, motion — over the live lattice.

// 📝 Laid out as Experimental/ProjectZeroEditor/GasPanel.jsx lays out a gas domain: quick tiles, a Domain card with
//    the cheap 2D stand-in that refuses to animate a plume the simulation is not running, a Budget card whose metric
//    is the lattice's memory and whose slider is the quality grade, then Source and Appearance under the names the
//    Fluid editor uses (Emission Rate, Smoke, Temperature, Buoyancy; Density, Albedo, Fire), and the readings this
//    exhibit adds — soot, blackbody flame temperatures, scattering octaves, fire light, embers, sub-cell detail.

import { PlumeGrades, PlumeDefaults } from "./PlumeSpace.js";

// 📝 One-press looks. Each writes only the readings it names; Defaults restores PlumeDefaults.
const PlumeLooks = {
    "Burnout cloud": { PlumeDensity: 1.6, PlumeExtinction: 4.2, PlumeAlbedo: 0.9, PlumeScattering: 0.85, PlumeDissipation: 0.07, PlumeDetail: 0.8,
                       PlumeVorticity: 3.4, PlumeTurbulence: 0.7, PlumeWindSpeed: 0.6 },
    "Tyre fire":     { PlumeSoot: 1.6, PlumeSootAlbedo: 0.04, PlumeFire: 1.4, PlumeFlameCore: 1900, PlumeFlameTip: 1150, PlumeFireLight: 1.4,
                       PlumeEmbers: 1.5, PlumeHeat: 1.2, PlumeDissipation: 0.09 },
    "Thin haze":     { PlumeDensity: 0.6, PlumeExtinction: 2.0, PlumeDissipation: 0.18, PlumeDetail: 1.0, PlumeScattering: 0.6 },
    "Heavy show":    { PlumeEmissionRate: 1.8, PlumeDensity: 2.4, PlumeExtinction: 5.0, PlumeDissipation: 0.05, PlumeVorticity: 4.5, PlumeTurbulence: 1.0 }
};

// 📝 A cheap stand-in for the volume, drawn the way the real one is lit — rubber smoke that scatters, soot that
//    darkens, heat that glows — from the same readings, and frozen with its bounds when the lattice is not resident.
function ConstructPreview(Card, Exhibit)
{
    const Holder = document.createElement("div");
    Holder.className = "gas-visual";
    const Canvas = document.createElement("canvas");
    Holder.appendChild(Canvas);
    Card.appendChild(Holder);
    const Context2D = Canvas.getContext("2d");
    const Puffs = Array.from({ length: 34 }, (Unused, Index) => ({ Phase: ((Index * 61) % 97) / 97, Sway: (((Index * 37) % 71) / 71 - 0.5) * 2,
                                                                  Size: 0.45 + (((Index * 53) % 83) / 83) * 0.8 }));
    let Time = 0.0, Before = 0.0, Frame = 0;
    const Paint = (Now) =>
    {
        if (!Holder.isConnected)
            return;
        Frame = requestAnimationFrame(Paint);
        if (Now - Before < 40 || document.hidden)
            return;
        const Step = Math.min(0.05, (Now - (Before || Now)) / 1000);
        Before = Now;
        const Settings = Exhibit.Settings;
        const Running = Settings.PlumeEnabled && Exhibit.Plume.Resident;
        if (Running)
            Time += Step;
        const Box = Holder.getBoundingClientRect(), Ratio = Math.min(2, devicePixelRatio || 1);
        if (!Box.width || !Box.height)
            return;
        if (Canvas.width !== Math.round(Box.width * Ratio))
        {
            Canvas.width = Math.round(Box.width * Ratio);
            Canvas.height = Math.round(Box.height * Ratio);
        }
        const W = Box.width, H = Box.height;
        Context2D.setTransform(Ratio, 0, 0, Ratio, 0, 0);
        Context2D.fillStyle = "#0e1316";
        Context2D.fillRect(0, 0, W, H);
        const Floor = H - 12, BoxW = W * 0.62, BoxH = H - 26, Left = (W - BoxW) / 2;
        Context2D.strokeStyle = Running ? "#5e7f8c" : "#3a4950";
        Context2D.setLineDash(Running ? [] : [3, 4]);
        Context2D.strokeRect(Left, Floor - BoxH, BoxW, BoxH);
        Context2D.setLineDash([]);
        if (!Running)
        {
            Context2D.fillStyle = "#6c7d85";
            Context2D.font = "10px ui-monospace, monospace";
            Context2D.textAlign = "center";
            Context2D.fillText("DORMANT · WAITS FOR A SLIDING TYRE", W / 2, Floor - BoxH / 2);
            return;
        }
        const Telemetry = Exhibit.Vehicle.QueryTelemetry();
        const Burning = Telemetry.TyresBurning > 0;
        const Heat = Burning ? Math.min(1, 0.35 * Settings.PlumeFire) : 0.0;
        const Grey = Math.round(70 + Settings.PlumeAlbedo * 150 * (Burning ? Math.max(0.2, 1 - 0.45 * Settings.PlumeSoot) : 1));
        const Rise = Math.max(0.2, Settings.PlumeBuoyancy / 3);
        Context2D.globalCompositeOperation = "lighter";
        for (const Puff of Puffs)
        {
            const Life = (Time * 0.32 * Rise + Puff.Phase) % 1;
            const Y = Floor - Life * BoxH * 0.96, Spread = 0.1 + Life * 0.46;
            const X = Left + BoxW / 2 + Puff.Sway * Spread * BoxW * 0.42 + Settings.PlumeWindSpeed * Life * 9;
            const Radius = Puff.Size * BoxW * (0.07 + Spread * 0.2);
            const Fade = Math.sin(Math.PI * Math.min(1, Life * 1.25)) * Math.min(1.5, Settings.PlumeEmissionRate * Settings.PlumeDensity);
            const Glow = Math.max(0, Heat * (1 - Life * 3.2));
            const Shade = Context2D.createRadialGradient(X, Y, 0, X, Y, Math.max(1, Radius));
            Shade.addColorStop(0, `rgba(${Math.round(Grey + Glow * (255 - Grey))},${Math.round(Grey + Glow * (150 - Grey))},${Math.round(Grey + Glow * (60 - Grey))},`
                                + `${0.08 + Fade * 0.12 * Math.min(2, Settings.PlumeExtinction / 3.6)})`);
            Shade.addColorStop(1, "rgba(0,0,0,0)");
            Context2D.fillStyle = Shade;
            Context2D.beginPath();
            Context2D.arc(X, Y, Math.max(1, Radius), 0, Math.PI * 2);
            Context2D.fill();
        }
        Context2D.globalCompositeOperation = "source-over";
    };
    Frame = requestAnimationFrame(Paint);
    return () => cancelAnimationFrame(Frame);
}

// 📝 Context: { Kit, Exhibit, Settings, Change(Key) }.
export function ConstructPlumePage(Parent, Context)
{
    const { Kit, Exhibit, Settings, Change } = Context;
    const Describe = () => Exhibit.Plume.QueryDescription();
    Kit.Heading(Parent, "Effect · gas domain", "Smoke & fire",
                "Tyre smoke, soot and flame on a cell lattice that follows the car — sources from the tyres' sliding power, their heat and the exhaust.");
    Kit.Tiles(Parent, [{ Label: "Smoke & fire", Key: "PlumeEnabled" }, { Label: "Tyre ignition", Key: "TyreIgnition" },
                       { Label: "Exhaust pops", Key: "ExhaustAfterfire" }]);

    const Domain = Kit.Card(Parent, "Domain", "Toroidal window · follows the car");
    ConstructPreview(Domain, Exhibit);
    const Status = document.createElement("div");
    Status.className = "status-line";
    const Dot = document.createElement("i");
    const Line = document.createElement("span");
    Status.append(Dot, Line);
    Domain.appendChild(Status);
    Kit.Readouts.push(() =>
    {
        const Resident = Settings.PlumeEnabled && Exhibit.Plume.Resident;
        const Burning = Exhibit.Vehicle.QueryTelemetry().TyresBurning > 0;
        Dot.className = Resident ? (Burning ? "burning" : "") : "dormant";
        Line.textContent = !Settings.PlumeEnabled ? "Off · no pass recorded"
            : Resident ? `Simulating · ${Exhibit.PlumeSources.Count} sources${Burning ? " · burning" : ""} · ${Exhibit.Plume.StepsTaken} steps`
            : "Dormant · nothing recorded until a tyre slides";
    });
    Kit.Readout(Domain, "Thermo lattice", () => Describe().Thermo);
    Kit.Readout(Domain, "Velocity lattice", () => Describe().Velocity);
    Kit.Readout(Domain, "Window", () => Describe().Span);

    const Budget = Kit.Card(Parent, "Budget", "Quality · memory");
    Kit.Metrics(Budget, [{ Caption: "Lattice memory", Class: "amber", Read: () => [(Describe().Bytes / 1048576).toFixed(1), "MB"] }]);
    Kit.Readout(Budget, "Grade", () => `${Describe().Grade} · ${Describe().Sweeps} sweeps · ${Describe().Samples} march samples`);
    Kit.Slider(Budget, { Label: "Smoke & fire quality", Key: "PlumeGrade", Minimum: 0, Maximum: PlumeGrades.length - 1, Decimals: 0, Step: 1,
                         Format: (Value) => PlumeGrades[Math.round(Value)].Name, Unit: "grade" });
    Kit.Note(Budget, "Independent of the GI grade. A change rebuilds the lattices at once and starts a clean plume; Ultra is a 160 × 160 × 48 "
                   + "window at 20 cm.");

    const Source = Kit.Card(Parent, "Source", "What comes out, and how hard");
    Kit.Slider(Source, { Label: "Emission Rate", Key: "PlumeEmissionRate", Minimum: 0, Maximum: 3, Decimals: 2, Unit: "×" });
    Kit.Slider(Source, { Label: "Smoke", Key: "PlumeDensity", Minimum: 0, Maximum: 4, Decimals: 2, Unit: "×" });
    Kit.Slider(Source, { Label: "Temperature", Key: "PlumeHeat", Minimum: 0, Maximum: 3, Decimals: 2, Unit: "×" });
    Kit.Slider(Source, { Label: "Soot", Key: "PlumeSoot", Minimum: 0, Maximum: 3, Decimals: 2, Unit: "×" });
    Kit.Slider(Source, { Label: "Buoyancy", Key: "PlumeBuoyancy", Minimum: 0, Maximum: 8, Decimals: 2, Unit: "m/s²K" });

    const Appearance = Kit.Card(Parent, "Appearance", "The raymarch's own readings");
    Kit.Slider(Appearance, { Label: "Density", Key: "PlumeExtinction", Minimum: 0.5, Maximum: 12, Decimals: 1, Unit: "1/m" });
    Kit.Slider(Appearance, { Label: "Albedo (rubber smoke)", Key: "PlumeAlbedo", Minimum: 0, Maximum: 1, Decimals: 2, Unit: "" });
    Kit.Slider(Appearance, { Label: "Albedo (soot)", Key: "PlumeSootAlbedo", Minimum: 0, Maximum: 0.6, Decimals: 2, Unit: "" });
    Kit.Slider(Appearance, { Label: "Fire", Key: "PlumeFire", Minimum: 0, Maximum: 4, Decimals: 2, Unit: "×" });
    Kit.Slider(Appearance, { Label: "Flame core", Key: "PlumeFlameCore", Minimum: 1200, Maximum: 2600, Decimals: 0, Unit: "K" });
    Kit.Slider(Appearance, { Label: "Flame tips", Key: "PlumeFlameTip", Minimum: 800, Maximum: 1600, Decimals: 0, Unit: "K" });

    const Lighting = Kit.Card(Parent, "Lighting", "Scattering · fire light · embers");
    Kit.Slider(Lighting, { Label: "Multiple scattering", Key: "PlumeScattering", Minimum: 0, Maximum: 2, Decimals: 2, Unit: "×" });
    Kit.Slider(Lighting, { Label: "Phase anisotropy", Key: "PlumeAnisotropy", Minimum: -0.2, Maximum: 0.9, Decimals: 2, Unit: "g" });
    Kit.Slider(Lighting, { Label: "Sky and bounce", Key: "PlumeAmbient", Minimum: 0, Maximum: 3, Decimals: 2, Unit: "×" });
    Kit.Slider(Lighting, { Label: "Fire light (smoke and scene)", Key: "PlumeFireLight", Minimum: 0, Maximum: 4, Decimals: 2, Unit: "×" });
    Kit.Slider(Lighting, { Label: "Embers and sparks", Key: "PlumeEmbers", Minimum: 0, Maximum: 3, Decimals: 2, Unit: "×" });

    const Motion = Kit.Card(Parent, "Forces & turbulence", "Flow");
    Kit.Slider(Motion, { Label: "Vorticity confinement", Key: "PlumeVorticity", Minimum: 0, Maximum: 10, Decimals: 1, Unit: "" });
    Kit.Slider(Motion, { Label: "Sub-grid turbulence", Key: "PlumeTurbulence", Minimum: 0, Maximum: 3, Decimals: 2, Unit: "m/s" });
    Kit.Slider(Motion, { Label: "Turbulence scale", Key: "PlumeTurbulenceScale", Minimum: 0.5, Maximum: 8, Decimals: 1, Unit: "1/m" });
    Kit.Slider(Motion, { Label: "Sub-cell detail", Key: "PlumeDetail", Minimum: 0, Maximum: 1.5, Decimals: 2, Unit: "" });
    Kit.Slider(Motion, { Label: "Detail scale", Key: "PlumeDetailScale", Minimum: 0.5, Maximum: 6, Decimals: 1, Unit: "1/m" });
    Kit.Slider(Motion, { Label: "Smoke dissipation", Key: "PlumeDissipation", Minimum: 0, Maximum: 0.6, Decimals: 2, Unit: "1/s" });
    Kit.Slider(Motion, { Label: "Cooling", Key: "PlumeCooling", Minimum: 0.1, Maximum: 2, Decimals: 2, Unit: "1/s" });
    Kit.Slider(Motion, { Label: "Flame decay (lower is taller)", Key: "PlumeFlameDecay", Minimum: 1, Maximum: 10, Decimals: 1, Unit: "1/s" });
    Kit.Slider(Motion, { Label: "Wind speed", Key: "PlumeWindSpeed", Minimum: 0, Maximum: 8, Decimals: 1, Unit: "m/s" });
    Kit.Slider(Motion, { Label: "Wind toward", Key: "PlumeWindDirection", Minimum: -180, Maximum: 180, Decimals: 0, Unit: "deg" });

    const Looks = Kit.Card(Parent, "Looks", "Presets");
    Kit.Buttons(Looks, Object.keys(PlumeLooks).map((Name) => ({ Label: Name, Action: () =>
    {
        Object.assign(Settings, PlumeLooks[Name]);
        Kit.Synchronise();
        Change("PlumeLook");
    } })));
    Kit.Buttons(Looks, [{ Label: "Defaults", Action: () =>
    {
        const Grade = Settings.PlumeGrade, Enabled = Settings.PlumeEnabled;
        Object.assign(Settings, PlumeDefaults, { PlumeGrade: Grade, PlumeEnabled: Enabled });
        Kit.Synchronise();
        Change("PlumeLook");
    } }]);

    const Actions = Kit.Card(Parent, "Fire", "Actions");
    Kit.Buttons(Actions, [{ Label: "Heat rear tyres to ignition", Action: () => Change("PlumeIgnite"), Class: "caution" },
                          { Label: "Cool tyres · clear smoke", Action: () => Change("PlumeClear") }]);
    Kit.Switch(Actions, { Label: "Show the lattice cells", Read: () => Settings.Inspection === 10,
                          Write: (Value) => { Settings.Inspection = Value ? 10 : 0; Change("Inspection"); } });
}
