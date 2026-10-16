//============================================================================================================================================
//                                                            INSPECTORPANEL.JS
//============================================================================================================================================
// 🧩 The inspector's control vocabulary — cards, pill sliders, switches, selectors, tiles, metrics — and the vehicle, light and render pages.

// 📝 Every control is the Frontier editor's own (Experimental/ProjectZeroEditor/Inspectors.jsx Control, Card, Tile,
//    Metric), rebuilt without React: a slider is a label with a split numeric field and a pill range, a switch is the
//    green toggle, a card is the gradient section with a title and a small-caps subtitle. A control binds either to a
//    settings key or to a Read / Write pair, and every bound control and live readout registers with the kit, so a
//    preset, a key press or the host's measurements bring the page up to date without rebuilding it.

export const InspectionModes = [
    ["Final image", 0], ["Direct sun only", 1], ["Indirect diffuse (GI)", 2], ["Indirect irradiance (denoised)", 3],
    ["ReSTIR irradiance (raw, no denoise)", 4], ["Glossy reflections", 5], ["Global distance field", 6],
    ["Surface cards (texel space)", 7], ["Normals", 8], ["Albedo", 9], ["Smoke lattice cells", 10]
];

export const DistanceInspections = [
    ["Field normals · cascades · rewritten bricks", 1], ["Traversal step heat", 2], ["Surface cache as the tracer sees it", 3]
];

export const LightingPresets = {
    Noon:   { SunElevation: 64,  SunAzimuth: 145, SolarIlluminance: 12, EmissionScale: 1.0 },
    Golden: { SunElevation: 10,  SunAzimuth: 160, SolarIlluminance: 12, EmissionScale: 1.0 },
    Dusk:   { SunElevation: 1.5, SunAzimuth: 172, SolarIlluminance: 12, EmissionScale: 1.0 },
    Night:  { SunElevation: -14, SunAzimuth: 172, SolarIlluminance: 12, EmissionScale: 1.0 }
};

function Construct(Tag, Class = "", Text = "")
{
    const Node = document.createElement(Tag);
    if (Class)
        Node.className = Class;
    if (Text)
        Node.textContent = Text;
    return Node;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONTROL KIT
//------------------------------------------------------------------------------------------------------------------------

export class InspectorKit
{
    constructor(Settings, Change)
    {
        this.Settings = Settings;
        this.Change = Change;
        this.Synchronisers = [];
        this.Readouts = [];
    }

    Reset()
    {
        this.Synchronisers = [];
        this.Readouts = [];
    }

    Synchronise()
    {
        for (const Synchronise of this.Synchronisers)
            Synchronise();
    }

    Refresh()
    {
        for (const Refresh of this.Readouts)
            Refresh();
    }

    // 📝 Field: { Key } reads and writes Settings[Key] and reports Key; { Read, Write } goes through the caller.
    Bind(Field)
    {
        const Read = Field.Read || (() => this.Settings[Field.Key]);
        const Write = Field.Write || ((Value) => { this.Settings[Field.Key] = Value; this.Change(Field.Key); });
        return { Read, Write };
    }

    Heading(Parent, Eyebrow, Title, Text = "")
    {
        const Heading = Construct("div", "inspector-heading");
        Heading.appendChild(Construct("div", "eyebrow", Eyebrow));
        Heading.appendChild(Construct("h1", "", Title));
        if (Text)
            Heading.appendChild(Construct("p", "", Text));
        Parent.appendChild(Heading);
        return Heading;
    }

    Card(Parent, Title, Subtitle = "", Expand = null)
    {
        const Card = Construct("section", "property-card");
        const Header = Construct("header");
        const Titles = Construct("div");
        Titles.appendChild(Construct("h3", "", Title));
        if (Subtitle)
            Titles.appendChild(Construct("small", "", Subtitle));
        Header.appendChild(Titles);
        if (Expand)
        {
            const Button = Construct("button", "", "↗");
            Button.title = Expand.Title || "Expand";
            Button.addEventListener("click", () => { Button.blur(); Expand.Action(); });
            Header.appendChild(Button);
        }
        Card.appendChild(Header);
        Parent.appendChild(Card);
        return Card;
    }

    // 📝 Field: { Label, Key | Read/Write, Minimum, Maximum, Decimals, Unit, Format(value) → text for a stepped
    //    slider whose value field shows a name instead of a number }.
    Slider(Card, Field)
    {
        const { Read, Write } = this.Bind(Field);
        const Minimum = Field.Minimum ?? 0, Maximum = Field.Maximum ?? 1, Decimals = Field.Decimals ?? 2;
        const Step = Field.Step ?? Math.pow(10, -Decimals);
        const Label = Construct("label", "field");
        Label.appendChild(Construct("span", "", Field.Label));
        const Pill = Construct("div", "slider-pill");
        const Split = Construct("div", Field.Format ? "split-value wide" : "split-value");
        const Entry = Construct("input");
        Entry.type = Field.Format ? "text" : "number";
        Entry.readOnly = !!Field.Format;
        Entry.step = Step;
        Entry.setAttribute("aria-label", `${Field.Label} value`);
        Split.appendChild(Entry);
        Split.appendChild(Construct("small", "", Field.Unit || ""));
        const Range = Construct("input");
        Range.type = "range";
        Range.min = Minimum;
        Range.max = Maximum;
        Range.step = Step;
        Range.setAttribute("aria-label", Field.Label);
        Pill.appendChild(Split);
        Pill.appendChild(Range);
        Label.appendChild(Pill);
        Card.appendChild(Label);
        const Show = (Value) =>
        {
            Range.value = Value;
            Range.style.setProperty("--fill", `${100 * (Value - Minimum) / Math.max(1.0e-9, Maximum - Minimum)}%`);
            Entry.value = Field.Format ? Field.Format(Value) : Number(Value).toFixed(Decimals);
        };
        const Commit = (Input) =>
        {
            const Value = Math.min(Maximum, Math.max(Minimum, Number(Input)));
            if (!Number.isFinite(Value))
                return;
            Write(Value);
            Show(Value);
        };
        Range.addEventListener("input", () => Commit(Range.value));
        Range.addEventListener("change", () => Range.blur());
        Entry.addEventListener("change", () => Commit(Entry.value));
        Show(Read());
        this.Synchronisers.push(() => { if (document.activeElement !== Entry && document.activeElement !== Range) Show(Read()); });
        return Label;
    }

    Switch(Card, Field)
    {
        const { Read, Write } = this.Bind(Field);
        const Row = Construct("label", "switch-row");
        Row.appendChild(Construct("span", "", Field.Label));
        const Toggle = Construct("button", "toggle");
        Toggle.setAttribute("role", "switch");
        Toggle.setAttribute("aria-label", Field.Label);
        Toggle.appendChild(Construct("i"));
        const Show = () => { const On = !!Read(); Toggle.classList.toggle("on", On); Toggle.setAttribute("aria-checked", On); };
        Toggle.addEventListener("click", (Event) => { Event.preventDefault(); Toggle.blur(); Write(!Read()); Show(); });
        Row.appendChild(Toggle);
        Card.appendChild(Row);
        Show();
        this.Synchronisers.push(Show);
        return Row;
    }

    // 📝 Options: [[Caption, Value]]; values are numbers unless Field.Text.
    Select(Card, Field)
    {
        const { Read, Write } = this.Bind(Field);
        const Label = Construct("label", "field");
        Label.appendChild(Construct("span", "", Field.Label));
        const Select = Construct("select");
        for (const [Caption, Value] of Field.Options)
        {
            const Option = Construct("option", "", Caption);
            Option.value = Value;
            Select.appendChild(Option);
        }
        Select.addEventListener("change", () => { Write(Field.Text ? Select.value : Number(Select.value)); Select.blur(); });
        Label.appendChild(Select);
        Card.appendChild(Label);
        const Show = () => { Select.value = Read(); };
        Show();
        this.Synchronisers.push(Show);
        return Label;
    }

    Segmented(Card, Field)
    {
        const { Read, Write } = this.Bind(Field);
        const Holder = Construct("div", "field");
        if (Field.Label)
            Holder.appendChild(Construct("span", "", Field.Label));
        const Group = Construct("div", "segmented");
        const Buttons = Field.Options.map(([Caption, Value]) =>
        {
            const Button = Construct("button", "", Caption);
            Button.addEventListener("click", () => { Button.blur(); Write(Value); Show(); });
            Group.appendChild(Button);
            return { Button, Value };
        });
        const Show = () => { for (const { Button, Value } of Buttons) Button.setAttribute("aria-pressed", Read() === Value); };
        Holder.appendChild(Group);
        Card.appendChild(Holder);
        Show();
        this.Synchronisers.push(Show);
        return Holder;
    }

    // 📝 Actions: [{ Label, Action, Class, Disabled() }].
    Buttons(Card, Actions)
    {
        const Row = Construct("div", "card-buttons");
        for (const Item of Actions)
        {
            const Button = Construct("button", Item.Class || "", Item.Label);
            Button.addEventListener("click", () => { Button.blur(); Item.Action(); });
            if (Item.Disabled)
                this.Readouts.push(() => { Button.disabled = !!Item.Disabled(); });
            Row.appendChild(Button);
        }
        Card.appendChild(Row);
        return Row;
    }

    // 📝 Items: [{ Caption, Read → [value, unit], Class }], refreshed with the readouts.
    Metrics(Card, Items)
    {
        const Row = Construct("div", "metric-row");
        for (const Item of Items)
        {
            const Cell = Construct("div");
            const Value = Construct("div", "metric " + (Item.Class || ""));
            Cell.appendChild(Value);
            Cell.appendChild(Construct("div", "caption", Item.Caption));
            Row.appendChild(Cell);
            const Show = () =>
            {
                const [Text, Unit] = Item.Read();
                Value.textContent = Text;
                if (Unit)
                    Value.appendChild(Construct("small", "", Unit));
            };
            Show();
            this.Readouts.push(Show);
        }
        Card.appendChild(Row);
        return Row;
    }

    Readout(Card, Label, Read)
    {
        const Row = Construct("div", "readout");
        Row.appendChild(Construct("span", "", Label));
        const Output = Construct("output");
        Row.appendChild(Output);
        Card.appendChild(Row);
        const Show = () => { Output.textContent = Read(); };
        Show();
        this.Readouts.push(Show);
        return Row;
    }

    Block(Card, Read)
    {
        const Block = Construct("pre", "readout-block");
        Card.appendChild(Block);
        const Show = () => { Block.textContent = Read(); };
        Show();
        this.Readouts.push(Show);
        return Block;
    }

    // 📝 Quick tiles: [{ Label, Key | Read/Write }] — the editor's ON / OFF tiles.
    Tiles(Parent, Items)
    {
        const Grid = Construct("div", "quick-tiles");
        for (const Item of Items)
        {
            const { Read, Write } = this.Bind(Item);
            const Tile = Construct("button", "quick-tile");
            Tile.appendChild(Construct("i"));
            Tile.appendChild(Construct("span", "quick-label", Item.Label));
            const Status = Construct("small", "quick-status");
            Tile.appendChild(Status);
            const Show = () => { const On = !!Read(); Tile.classList.toggle("on", On); Status.textContent = On ? "ON" : "OFF"; };
            Tile.addEventListener("click", () => { Tile.blur(); Write(!Read()); Show(); });
            Grid.appendChild(Tile);
            Show();
            this.Synchronisers.push(Show);
        }
        Parent.appendChild(Grid);
        return Grid;
    }

    Note(Card, Text)
    {
        const Note = Construct("p", "note", Text);
        Card.appendChild(Note);
        return Note;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   VEHICLE PAGE
//------------------------------------------------------------------------------------------------------------------------

// 📝 Context: { Kit, Exhibit, Settings, Change(Key) }.
export function ConstructVehiclePage(Parent, Context)
{
    const { Kit, Exhibit, Change } = Context;
    const Telemetry = () => Exhibit.Vehicle.QueryTelemetry();
    Kit.Heading(Parent, "Vehicle · Project-Drive", "ControlVehicle", "GT-R powertrain, MF6.1 tyres, socket struts. W/S throttle and brake, A/D steer, Space handbrake, B line lock.");

    const Live = Kit.Card(Parent, "Telemetry", "Live");
    Kit.Metrics(Live, [
        { Caption: "Speed", Read: () => [(Math.abs(Telemetry().Speed) * 3.6).toFixed(0), "km/h"] },
        { Caption: "Engine", Read: () => [Telemetry().EngineRPM.toFixed(0), "rpm"] },
        { Caption: "Gear", Read: () => [Telemetry().Gear, ""] }]);
    Kit.Readout(Live, "Rear wheel speed", () => `${(Math.abs(Telemetry().RearSurfaceSpeed) * 3.6).toFixed(0)} km/h`);
    Kit.Readout(Live, "Sliding power FL · FR · RL · RR", () => Telemetry().SlidingPower.map((Watts) => (Watts / 1000).toFixed(0)).join(" · ") + " kW");
    Kit.Readout(Live, "Contacts", () => `${Telemetry().Contacts} / 4`);

    const Burnout = Kit.Card(Parent, "Burnout", "Line lock");
    Kit.Switch(Burnout, { Label: "Line lock latched (or hold B)", Key: "LineLockLatched" });
    Kit.Switch(Burnout, { Label: "Burnout hold — keep the car in its box", Key: "BurnoutHold" });
    Kit.Note(Burnout, "Line lock holds the front calipers and releases the rears; full throttle spins the driven wheels in first gear "
                    + "off the limiter. A long burnout heats the tread past ignition and wears it through to a burst.");
    Kit.Buttons(Burnout, [{ Label: "Respawn (R)", Action: () => Change("Respawn") }, { Label: "Free camera (F8)", Action: () => Change("ToggleCamera") }]);

    const Tyres = Kit.Card(Parent, "Tyres", "Heat · tread · grip");
    Kit.Readout(Tyres, "Tread °C FL · FR · RL · RR", () => Telemetry().TyreTemperatures.map((Celsius) => Celsius.toFixed(0)).join(" · "));
    Kit.Readout(Tyres, "Carcass °C", () => Telemetry().CarcassTemperatures.map((Celsius) => Celsius.toFixed(0)).join(" · "));
    Kit.Readout(Tyres, "Tread left", () => Telemetry().TreadFractions.map((Fraction, Index) => Telemetry().Bursts[Index] ? "burst" : `${(Fraction * 100).toFixed(0)}%`).join(" · "));
    Kit.Slider(Tyres, { Label: "Sliding heat gain (1 = Frontier)", Key: "PlumeHeatGain", Minimum: 0.25, Maximum: 4, Decimals: 2, Unit: "×" });
    Kit.Switch(Tyres, { Label: "Tread wear and burst", Key: "TyreWear" });
    Kit.Slider(Tyres, { Label: "Wear rate", Key: "TyreWearScale", Minimum: 0.1, Maximum: 5, Decimals: 2, Unit: "×" });
    Kit.Switch(Tyres, { Label: "Hot tyres lose grip", Key: "ThermalGrip" });
    Kit.Buttons(Tyres, [{ Label: "Fresh cold tyres", Action: () => Change("TyresFresh") }]);

    const Ignition = Kit.Card(Parent, "Ignition", "When rubber catches fire");
    Kit.Switch(Ignition, { Label: "Tyres can ignite", Key: "TyreIgnition" });
    Kit.Slider(Ignition, { Label: "Ignition temperature", Key: "TyreIgnitionTemperature", Minimum: 300, Maximum: 650, Decimals: 0, Unit: "°C" });
    Kit.Slider(Ignition, { Label: "Held above it before igniting", Key: "TyreIgnitionSeconds", Minimum: 0.5, Maximum: 15, Decimals: 1, Unit: "s" });
    Kit.Note(Ignition, "Frontier's specification ignites at 350 °C after 4 s; the exhibit opens at 450 °C, inside the autoignition range quoted "
                     + "for tyre rubber. Drifting stays well below it; a sustained burnout reaches it in about twenty seconds.");
    Kit.Buttons(Ignition, [{ Label: "Heat rear tyres to ignition", Action: () => Change("PlumeIgnite"), Class: "caution" }]);

    const Exhaust = Kit.Card(Parent, "Exhaust and rubber", "Afterfire · marks");
    Kit.Switch(Exhaust, { Label: "Afterfire pops on lift-off", Key: "ExhaustAfterfire" });
    Kit.Switch(Exhaust, { Label: "Tyres lay rubber on the asphalt", Key: "TyreMarks" });
    Kit.Slider(Exhaust, { Label: "Rubber laid", Key: "TyreMarkAmount", Minimum: 0, Maximum: 3, Decimals: 2, Unit: "×" });
    Kit.Buttons(Exhaust, [{ Label: "Sweep the yard clean", Action: () => Change("MarksClear") }]);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   LIGHTING PAGE
//------------------------------------------------------------------------------------------------------------------------

export function ConstructLightingPage(Parent, Context)
{
    const { Kit, Settings, Change } = Context;
    Kit.Heading(Parent, "World · atmosphere", "Sun & sky", "The sun drives the cascaded shadows, the card lighting and the sky view the indirect rays escape to.");
    const Presets = Kit.Card(Parent, "Time of day", "Presets");
    Kit.Buttons(Presets, Object.keys(LightingPresets).map((Name) => ({ Label: Name, Action: () =>
    {
        Object.assign(Settings, LightingPresets[Name]);
        Kit.Synchronise();
        Change("Preset");
    } })));
    const Sun = Kit.Card(Parent, "Sun", "Direction · intensity");
    Kit.Slider(Sun, { Label: "Elevation", Key: "SunElevation", Minimum: -20, Maximum: 85, Decimals: 1, Unit: "deg" });
    Kit.Slider(Sun, { Label: "Azimuth", Key: "SunAzimuth", Minimum: -180, Maximum: 180, Decimals: 0, Unit: "deg" });
    Kit.Slider(Sun, { Label: "Solar intensity", Key: "SolarIlluminance", Minimum: 1, Maximum: 30, Decimals: 1, Unit: "" });
    Kit.Switch(Sun, { Label: "Sun shadows", Key: "DirectShadow" });
    const Sky = Kit.Card(Parent, "Sky and exposure", "Ambient · emitters · camera");
    Kit.Slider(Sky, { Label: "Sky intensity", Key: "SkyScale", Minimum: 0, Maximum: 3, Decimals: 2, Unit: "×" });
    Kit.Slider(Sky, { Label: "Emission (strip lights, floodlights)", Key: "EmissionScale", Minimum: 0, Maximum: 4, Decimals: 2, Unit: "×" });
    Kit.Slider(Sky, { Label: "Exposure", Key: "ExposureCompensation", Minimum: -4, Maximum: 4, Decimals: 1, Unit: "EV" });
    Kit.Switch(Sky, { Label: "Auto exposure", Key: "AutoExposure" });
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   RENDERING PAGE
//------------------------------------------------------------------------------------------------------------------------

export function ConstructRenderingPage(Parent, Context)
{
    const { Kit, Exhibit, Change } = Context;
    Kit.Heading(Parent, "Rendering · Slate GI", "Global illumination",
                "One scene distance field in four toroidal cascades, surface cards with radiosity, a ReSTIR GI final gather and SVGF.");

    const Quality = Kit.Card(Parent, "Quality", "Grade · resolution");
    Kit.Select(Quality, { Label: "Quality grade (reloads the page)", Key: "Quality", Options: [["Low", 0], ["Medium", 1], ["Balanced (120 Hz)", 2], ["High", 3]] });
    Kit.Select(Quality, { Label: "Trace resolution", Key: "TraceScale", Options: [["Half (default)", 2], ["Full", 1]] });
    Kit.Switch(Quality, { Label: "Temporal antialiasing", Key: "Antialias" });
    Kit.Readout(Quality, "Frame", () => Exhibit.QueryFrameDescription());

    const Gather = Kit.Card(Parent, "Final gather", "ReSTIR GI");
    Kit.Switch(Gather, { Label: "Indirect lighting", Key: "Indirect" });
    Kit.Switch(Gather, { Label: "Temporal reuse", Key: "TemporalReuse" });
    Kit.Switch(Gather, { Label: "Spatial reuse", Key: "SpatialReuse" });
    Kit.Switch(Gather, { Label: "Visibility validation", Key: "VisibilityReuse" });
    Kit.Switch(Gather, { Label: "Refresh reused radiance", Key: "RadianceRefresh" });
    Kit.Slider(Gather, { Label: "Spatial candidates", Key: "SpatialCount", Minimum: 0, Maximum: 8, Decimals: 0, Unit: "" });
    Kit.Slider(Gather, { Label: "Spatial radius", Key: "SpatialRadius", Minimum: 2, Maximum: 48, Decimals: 0, Unit: "px" });
    Kit.Slider(Gather, { Label: "Temporal M limit", Key: "TemporalTallyLimit", Minimum: 1, Maximum: 40, Decimals: 0, Unit: "" });
    Kit.Slider(Gather, { Label: "Indirect intensity", Key: "IndirectScale", Minimum: 0, Maximum: 3, Decimals: 2, Unit: "×" });
    Kit.Switch(Gather, { Label: "Denoiser (SVGF)", Key: "VarianceKernel" });
    Kit.Switch(Gather, { Label: "Glossy reflections", Key: "Reflection" });

    const Field = Kit.Card(Parent, "Global distance field", "Cascades · bricks");
    Kit.Switch(Field, { Label: "Freeze field updates", Key: "FreezeDistance" });
    Kit.Block(Field, () => Exhibit.QueryFieldLines().join("\n"));

    const Depot = Kit.Card(Parent, "Surface cache", "Cards · radiosity");
    Kit.Switch(Depot, { Label: "Card radiosity (multi-bounce)", Key: "CardRadiosity" });
    Kit.Slider(Depot, { Label: "Static tiles relit per frame", Key: "CardTileBudget", Minimum: 0, Maximum: 8192, Decimals: 0, Step: 64, Unit: "" });
    Kit.Block(Depot, () => Exhibit.QueryDepotLines().join("\n"));

    const Display = Kit.Card(Parent, "Display", "Inspection · debug windows");
    Kit.Select(Display, { Label: "Display", Key: "Inspection", Options: InspectionModes });
    Kit.Select(Display, { Label: "Distance view", Key: "DistanceInspection", Options: DistanceInspections });
    Kit.Slider(Display, { Label: "Slice height", Key: "SliceHeight", Minimum: 0.05, Maximum: 4, Decimals: 2, Unit: "m" });
    Kit.Switch(Display, { Label: "Heads-up readout", Key: "HudEnabled" });
    Kit.Switch(Display, { Label: "Distance slice inset and legend", Key: "InsetEnabled" });
    Kit.Buttons(Display, [{ Label: "Hide every panel and window (H)", Action: () => Change("ToggleOverlays") }]);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    STRESS PAGE
//------------------------------------------------------------------------------------------------------------------------

export function ConstructStressPage(Parent, Context)
{
    const { Kit, Exhibit, Change } = Context;
    Kit.Heading(Parent, "Diagnostics · load", "Stress test", "Adds scene occupants — rigid bodies that drop and settle, or static props — to measure what the GI pays for them.");
    const Spawn = Kit.Card(Parent, "Occupants", "Distance field · cards · raster runs");
    Kit.Select(Spawn, { Label: "Spawn as", Key: "StressMode", Options: [["Rigid bodies (drop + settle)", 0], ["Static props (placed)", 1]] });
    Kit.Buttons(Spawn, [64, 256, 1024].map((Count) => ({ Label: `+${Count}`, Action: () => Change(`StressAdd:${Count}`),
                                                         Disabled: () => Exhibit.QueryStressRemaining() <= 0 })));
    Kit.Buttons(Spawn, [{ Label: "Clear objects", Action: () => Change("StressClear") }, { Label: "Wake / re-drop", Action: () => Change("StressWake") }]);
    Kit.Block(Spawn, () => Exhibit.QueryStressLines().join("\n"));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  SMASH ZONE PAGE
//------------------------------------------------------------------------------------------------------------------------

export function ConstructSmashPage(Parent, Context)
{
    const { Kit, Exhibit, Change } = Context;
    Kit.Heading(Parent, "Collection · breakables", "Smash zone",
                "Glass panels, crates, crash barrels, concrete blocks and the barrier straight. Strike one hard enough and it fractures — select a prop to edit its fracture.");
    const Rules = Kit.Card(Parent, "Fracture", "Every breakable");
    Kit.Switch(Rules, { Label: "Props break when struck", Key: "FractureEnabled" });
    Kit.Switch(Rules, { Label: "Concrete, stone and wood throw dust", Key: "FractureDust" });
    Kit.Slider(Rules, { Label: "Sweep wrecks after (0 = keep)", Key: "FragmentLifetime", Minimum: 0, Maximum: 180, Decimals: 0, Unit: "s" });
    Kit.Metrics(Rules, [
        { Caption: "Wrecks", Read: () => [String(Exhibit.Fragments.QueryStatistics().Wrecks), ""] },
        { Caption: "Fragments", Read: () => [String(Exhibit.Fragments.QueryStatistics().Fragments), `/ ${Exhibit.Fragments.QueryStatistics().Capacity}`] }]);
    Kit.Buttons(Rules, [{ Label: "Break every prop", Action: () => Change("BreakAll"), Class: "caution" },
                        { Label: "Reassemble all", Action: () => Change("ReassembleAll"), Class: "emphasis" }]);
    Kit.Note(Rules, "Fragments are raster and dynamic: one draw call for all of them, sun shadows from the cascades, rigid-body contacts "
                  + "with the road, the walls and the car. The distance field drops a broken prop at once.");
}
