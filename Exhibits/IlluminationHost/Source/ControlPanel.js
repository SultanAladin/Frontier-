//============================================================================================================================================
//                                                             CONTROLPANEL.JS
//============================================================================================================================================
// 🧩 The inspection panel and the heads-up readout: every exhibit toggle, the lighting presets and the live measurements.

export const InspectionModes = [
    ["Final image", 0], ["Direct sun only", 1], ["Indirect diffuse (GI)", 2], ["Indirect irradiance (denoised)", 3],
    ["ReSTIR irradiance (raw, no denoise)", 4], ["Glossy reflections", 5], ["Global distance field", 6],
    ["Surface cards (texel space)", 7], ["Normals", 8], ["Albedo", 9]
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

export class ControlPanel
{
    constructor(Root, Hud, Settings, OnChange)
    {
        this.Root     = Root;
        this.Hud      = Hud;
        this.Settings = Settings;
        this.OnChange = OnChange;
        this.Inputs   = new Map();
        this.LastHud  = 0.0;
        this.ConstructControls();
    }

    ConstructControls()
    {
        const Section = (Title) =>
        {
            const Element = document.createElement("section");
            Element.className = "panel-section";
            const Heading = document.createElement("h2");
            Heading.textContent = Title;
            Element.appendChild(Heading);
            this.Root.appendChild(Element);
            return Element;
        };
        const Row = (Parent, Label, Control, Readout) =>
        {
            const Element = document.createElement("label");
            Element.className = "panel-row";
            const Caption = document.createElement("span");
            Caption.textContent = Label;
            Element.appendChild(Caption);
            Element.appendChild(Control);
            if (Readout)
                Element.appendChild(Readout);
            Parent.appendChild(Element);
        };
        const Toggle = (Parent, Label, Key) =>
        {
            const Input = document.createElement("input");
            Input.type = "checkbox";
            Input.checked = !!this.Settings[Key];
            Input.addEventListener("change", () => { this.Settings[Key] = Input.checked; this.OnChange(Key); });
            this.Inputs.set(Key, Input);
            Row(Parent, Label, Input);
        };
        const Slider = (Parent, Label, Key, Minimum, Maximum, Step, Format = (Scalar) => Scalar.toFixed(2)) =>
        {
            const Input = document.createElement("input");
            Input.type = "range";
            Input.min = Minimum;
            Input.max = Maximum;
            Input.step = Step;
            Input.value = this.Settings[Key];
            const Readout = document.createElement("output");
            Readout.textContent = Format(Number(this.Settings[Key]));
            Input.addEventListener("input", () =>
            {
                this.Settings[Key] = Number(Input.value);
                Readout.textContent = Format(this.Settings[Key]);
                this.OnChange(Key);
            });
            this.Inputs.set(Key, { Input, Readout, Format });
            Row(Parent, Label, Input, Readout);
        };
        const Selector = (Parent, Label, Key, Options) =>
        {
            const Input = document.createElement("select");
            for (const [Caption, Scalar] of Options)
            {
                const Option = document.createElement("option");
                Option.value = Scalar;
                Option.textContent = Caption;
                Input.appendChild(Option);
            }
            Input.value = this.Settings[Key];
            Input.addEventListener("change", () => { this.Settings[Key] = Number(Input.value); this.OnChange(Key); });
            this.Inputs.set(Key, Input);
            Row(Parent, Label, Input);
        };
        const Button = (Parent, Label, Action) =>
        {
            const Element = document.createElement("button");
            Element.textContent = Label;
            Element.addEventListener("click", Action);
            Parent.appendChild(Element);
            return Element;
        };

        const View = Section("View");
        Selector(View, "Quality (reloads)", "Quality", [["Low", 0], ["Medium", 1], ["High", 2]]);
        Selector(View, "Display", "Inspection", InspectionModes);
        Selector(View, "Distance view", "DistanceInspection", DistanceInspections);
        Toggle(View, "Distance slice inset", "InsetEnabled");
        Slider(View, "Slice height [m]", "SliceHeight", 0.05, 4.0, 0.05);
        const CameraRow = document.createElement("div");
        CameraRow.className = "panel-buttons";
        View.appendChild(CameraRow);
        this.CameraButton = Button(CameraRow, "Free camera (F8)", () => this.OnChange("ToggleCamera"));
        Button(CameraRow, "Respawn vehicle (R)", () => this.OnChange("Respawn"));

        const Lighting = Section("Lighting");
        const Presets = document.createElement("div");
        Presets.className = "panel-buttons";
        Lighting.appendChild(Presets);
        for (const Name of Object.keys(LightingPresets))
            Button(Presets, Name, () => this.ApplyPreset(Name));
        Slider(Lighting, "Sun elevation [deg]", "SunElevation", -20, 85, 0.5, (Scalar) => Scalar.toFixed(1));
        Slider(Lighting, "Sun azimuth [deg]", "SunAzimuth", -180, 180, 1, (Scalar) => Scalar.toFixed(0));
        Slider(Lighting, "Solar intensity", "SolarIlluminance", 1, 30, 0.5, (Scalar) => Scalar.toFixed(1));
        Slider(Lighting, "Sky intensity", "SkyScale", 0, 3, 0.05);
        Slider(Lighting, "Emission scale", "EmissionScale", 0, 4, 0.05);
        Slider(Lighting, "Exposure [EV]", "ExposureCompensation", -4, 4, 0.1, (Scalar) => Scalar.toFixed(1));
        Toggle(Lighting, "Auto exposure", "AutoExposure");
        Toggle(Lighting, "Sun shadows", "DirectShadow");

        const Gather = Section("Final gather · ReSTIR GI");
        Toggle(Gather, "Indirect lighting", "Indirect");
        Toggle(Gather, "Temporal reuse", "TemporalReuse");
        Toggle(Gather, "Spatial reuse", "SpatialReuse");
        Toggle(Gather, "Visibility validation", "VisibilityReuse");
        Toggle(Gather, "Refresh reused radiance", "RadianceRefresh");
        Slider(Gather, "Spatial candidates", "SpatialCount", 0, 8, 1, (Scalar) => Scalar.toFixed(0));
        Slider(Gather, "Spatial radius [px]", "SpatialRadius", 2, 48, 1, (Scalar) => Scalar.toFixed(0));
        Slider(Gather, "Temporal M limit", "TemporalTallyLimit", 1, 40, 1, (Scalar) => Scalar.toFixed(0));
        Slider(Gather, "Indirect intensity", "IndirectScale", 0, 3, 0.05);
        Toggle(Gather, "Denoiser (SVGF)", "VarianceKernel");
        Toggle(Gather, "Glossy reflections", "Reflection");
        Toggle(Gather, "Temporal antialiasing", "Antialias");
        Selector(Gather, "Trace resolution", "TraceScale", [["Half (default)", 2], ["Full", 1]]);

        const Field = Section("Global distance field");
        Toggle(Field, "Freeze field updates", "FreezeDistance");
        this.FieldReadout = document.createElement("pre");
        this.FieldReadout.className = "panel-readout";
        Field.appendChild(this.FieldReadout);

        const Depot = Section("Surface cache (cards)");
        Toggle(Depot, "Card radiosity (multi-bounce)", "CardRadiosity");
        Slider(Depot, "Static tiles per frame", "CardTileBudget", 0, 8192, 64, (Scalar) => Scalar.toFixed(0));
        this.DepotReadout = document.createElement("pre");
        this.DepotReadout.className = "panel-readout";
        Depot.appendChild(this.DepotReadout);
    }

    ApplyPreset(Name)
    {
        Object.assign(this.Settings, LightingPresets[Name]);
        this.SynchroniseInputs();
        this.OnChange("Preset");
    }

    SynchroniseInputs()
    {
        for (const [Key, Control] of this.Inputs)
        {
            if (Control instanceof HTMLInputElement && Control.type === "checkbox")
                Control.checked = !!this.Settings[Key];
            else if (Control instanceof HTMLSelectElement)
                Control.value = this.Settings[Key];
            else if (Control.Input)
            {
                Control.Input.value = this.Settings[Key];
                Control.Readout.textContent = Control.Format(Number(this.Settings[Key]));
            }
        }
    }

    AssignCameraMode(Free)
    {
        this.CameraButton.textContent = Free ? "Chase camera (F8)" : "Free camera (F8)";
    }

    // 📝 Readouts refresh at 5 Hz; the measurements are smoothed upstream.
    PresentMeasurements(Now, Lines, FieldLines, DepotLines)
    {
        if (Now - this.LastHud < 200.0)
            return;
        this.LastHud = Now;
        this.Hud.textContent = Lines.join("\n");
        this.FieldReadout.textContent = FieldLines.join("\n");
        this.DepotReadout.textContent = DepotLines.join("\n");
    }
}
