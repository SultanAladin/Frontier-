//============================================================================================================================================
//                                                             FRACTUREPANEL.JS
//============================================================================================================================================
// 🧩 The fracture editor: a breakable's inspector card, and the expanded editor with its live fragment preview — over one per-prop recipe.

// 📝 Two views of the same recipe, as the Frontier editor has them (Experimental/ProjectZeroEditor/FracturePanel.jsx and
//    Experimental/FractureEditor/FracturePanel.html, branch arena/215a6f39-frontier):
//
//    | View              | What it shows                                                                              |
//    |-------------------|--------------------------------------------------------------------------------------------|
//    | inspector card    | enable, dynamic or baked, material, impact energy, seed, fragment ceiling, minimum size,     |
//    |                   | impact point, break threshold; fracture the prop in the yard or stand it again             |
//    | expanded editor   | the object column, a preview of the fragments the recipe makes now — orbit, separation,    |
//    |                   | wireframe — with fragments, occupied volume, worst triangle quality and closure, and the   |
//    |                   | same cards on the right                                                                    |
//
//    Dynamic fractures at the struck point with the strike's energy; Baked reuses the recipe's impact and energy every
//    time, so a prop always breaks into the pattern the preview shows. The preview runs the same FracturePart the yard
//    does, on the CPU, without touching the scene.

import { BreakableKinds } from "./YardStructure.js";
import { FractureMaterials, ResolveMoments, ResolveBounds } from "./FractureStructure.js";
import { ConstructMaterialSpecification } from "./MaterialSpecification.js";

const MaterialSwatches = { concrete: "#9d9d97", rock: "#7c7b78", wood: "#b5854a", glass: "#cfe6ea", tempered: "#cfe6ea", plastic: "#d8552f" };
const Materials = ConstructMaterialSpecification();

function ProjectSwatch(Family)
{
    const Albedo = Materials[Family] ? Materials[Family].Albedo : [0.5, 0.5, 0.5];
    return Albedo.map((Channel) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, Channel)), 1 / 2.2)));
}

// 📝 Recipe bindings for the kit: Read and Write through the depot, then the host refreshes the obstacle boxes.
function RecipeField(Context, Index, Key)
{
    const { Exhibit, Change } = Context;
    return {
        Read: () => Exhibit.Fragments.Recipes[Index][Key],
        Write: (Value) =>
        {
            Exhibit.Fragments.AssignRecipe(Index, { ...Exhibit.Fragments.Recipes[Index], [Key]: Value });
            Change(`FractureRecipe:${Index}`);
        }
    };
}

// 📝 The cards both views share: material, impact, fragment quality, strike.
function ConstructRecipeCards(Parent, Context, Index)
{
    const { Kit, Exhibit } = Context;
    const Entry = Exhibit.Scene.Breakables[Index];
    const Kind = BreakableKinds[Entry.Kind];

    const Material = Kit.Card(Parent, "Material", "Fracture response · not surface appearance");
    const Grid = document.createElement("div");
    Grid.className = "material-grid";
    const Buttons = Object.entries(FractureMaterials).map(([Key, Definition]) =>
    {
        const Button = document.createElement("button");
        const Swatch = document.createElement("i");
        Swatch.style.background = MaterialSwatches[Key];
        Button.append(Swatch, document.createTextNode(Definition.Label));
        Button.addEventListener("click", () => { Button.blur(); RecipeField(Context, Index, "Material").Write(Key); Kit.Synchronise(); });
        Grid.appendChild(Button);
        return { Button, Key };
    });
    Material.appendChild(Grid);
    Kit.Synchronisers.push(() => { for (const { Button, Key } of Buttons) Button.setAttribute("aria-pressed", Exhibit.Fragments.Recipes[Index].Material === Key); });
    Kit.Synchronise();
    Kit.Metrics(Material, [
        { Caption: "Crack resistance", Read: () => [String(FractureMaterials[Exhibit.Fragments.Recipes[Index].Material].Gc), "J/m²"] },
        { Caption: "Density", Read: () => [FractureMaterials[Exhibit.Fragments.Recipes[Index].Material].Density.toLocaleString("en"), "kg/m³"] }]);
    Kit.Note(Material, "Fragment area is bought with impact energy at 2·Gc per square metre. Tempered glass carries stored energy and dices; "
                     + "wood cuts along its grain.");

    const Impact = Kit.Card(Parent, "Impact", "Energy · pattern · point");
    Kit.Slider(Impact, { Label: "Impact energy (editor and baked)", ...RecipeField(Context, Index, "Energy"), Minimum: 0, Maximum: 50000, Decimals: 0, Step: 50, Unit: "J" });
    Kit.Slider(Impact, { Label: "Pattern seed", ...RecipeField(Context, Index, "Seed"), Minimum: 1, Maximum: 9999, Decimals: 0, Unit: "#" });
    const Axes = document.createElement("div");
    Axes.className = "axes-row";
    for (const Axis of ["X", "Y", "Z"])
    {
        const Label = document.createElement("label");
        const Name = document.createElement("b");
        Name.textContent = Axis;
        const Input = document.createElement("input");
        Input.type = "number";
        Input.step = "0.05";
        Input.setAttribute("aria-label", `Impact ${Axis}`);
        const Field = RecipeField(Context, Index, Axis);
        Input.addEventListener("change", () => { Field.Write(Number(Input.value) || 0); Input.blur(); });
        Kit.Synchronisers.push(() => { if (document.activeElement !== Input) Input.value = Number(Field.Read()).toFixed(2); });
        Label.append(Name, Input);
        Axes.appendChild(Label);
    }
    const Centre = document.createElement("button");
    Centre.textContent = "Centre";
    Centre.addEventListener("click", () =>
    {
        Centre.blur();
        Exhibit.Fragments.AssignRecipe(Index, { ...Exhibit.Fragments.Recipes[Index], X: 0, Y: 0, Z: 0 });
        Kit.Synchronise();
        Context.Change(`FractureRecipe:${Index}`);
    });
    Axes.appendChild(Centre);
    Impact.appendChild(Axes);
    Kit.Synchronise();
    Kit.Note(Impact, "Impact · local metres from the prop's centre. Closer, larger pieces receive cut priority.");

    const Quality = Kit.Card(Parent, "Fragment quality", "Ceiling · minimum size");
    Kit.Slider(Quality, { Label: "Maximum fragments", ...RecipeField(Context, Index, "Ceiling"), Minimum: 2, Maximum: 160, Decimals: 0, Unit: "" });
    Kit.Slider(Quality, { Label: "Minimum fragment size", ...RecipeField(Context, Index, "MinimumSize"), Minimum: 0.002, Maximum: 0.3, Decimals: 3, Unit: "m" });

    const Strike = Kit.Card(Parent, "Strike", "When the car breaks it");
    Kit.Slider(Strike, { Label: "Break threshold", Read: () => Exhibit.Fragments.Recipes[Index].BreakEnergy / 1000,
                         Write: (Value) => RecipeField(Context, Index, "BreakEnergy").Write(Value * 1000), Minimum: 0.05, Maximum: 200, Decimals: 2, Unit: "kJ" });
    Kit.Readout(Strike, "Strike speed that breaks it (1300 kg)", () =>
        `${(Math.sqrt(2 * Exhibit.Fragments.Recipes[Index].BreakEnergy / 1300) * 3.6).toFixed(0)} km/h head-on`);
    Kit.Readout(Strike, "Mass", () => `${Kind.Mass.toFixed(0)} kg`);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  INSPECTOR PAGE
//------------------------------------------------------------------------------------------------------------------------

// 📝 Context: { Kit, Exhibit, Settings, Change(Key), OpenFractureEditor(Index) }.
export function ConstructBreakablePage(Parent, Context, Index)
{
    const { Kit, Exhibit, Change } = Context;
    const Entry = Exhibit.Scene.Breakables[Index];
    const Kind = BreakableKinds[Entry.Kind];
    const Recipe = () => Exhibit.Fragments.Recipes[Index];
    Kit.Heading(Parent, `Breakable · ${Kind.Name.toLowerCase()}`, Entry.Name,
                `${Kind.Extent.map((Length) => Length.toFixed(2)).join(" × ")} m · ${Kind.Mass.toFixed(0)} kg · ${FractureMaterials[Kind.Material].Label}`);

    const Fracture = Kit.Card(Parent, "Fracture", "Per-object geometry", { Title: "Open fracture editor for this object", Action: () => Context.OpenFractureEditor(Index) });
    Kit.Switch(Fracture, { Label: "Enable fracture", ...RecipeField(Context, Index, "Enabled") });
    Kit.Segmented(Fracture, { Label: "Bake", ...RecipeField(Context, Index, "Mode"), Options: [["Dynamic", "dynamic"], ["Baked", "baked"]] });
    const Explain = Kit.Note(Fracture, "");
    Kit.Readouts.push(() =>
    {
        Explain.textContent = Recipe().Mode === "dynamic" ? "Generate fragments on demand at the struck point, with the strike's energy."
                                                          : "Reuse the recipe's impact and energy: the prop always breaks as the preview shows.";
    });
    Kit.Readout(Fracture, "State", () => Exhibit.Fragments.QueryBroken(Index) ? "broken" : "standing");
    Kit.Buttons(Fracture, [{ Label: "Fracture object", Action: () => Change(`Break:${Index}`), Class: "caution", Disabled: () => Exhibit.Fragments.QueryBroken(Index) },
                           { Label: "Reassemble", Action: () => Change(`Reassemble:${Index}`), Disabled: () => !Exhibit.Fragments.QueryBroken(Index) }]);
    Kit.Buttons(Fracture, [{ Label: `Edit ${Entry.Name} fracture ↗`, Action: () => Context.OpenFractureEditor(Index), Class: "wide" }]);
    ConstructRecipeCards(Parent, Context, Index);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 EXPANDED EDITOR
//------------------------------------------------------------------------------------------------------------------------

export class FractureEditor
{
    // 📝 Host: the element the overlay mounts into; Context as for the inspector page, with its own kit.
    constructor(Host, ContextFactory)
    {
        this.Host = Host;
        this.ContextFactory = ContextFactory;
        this.Index = -1;
        this.Yaw = 0.7;
        this.Pitch = 0.45;
        this.Separation = 0.18;
        this.Wireframe = false;
        this.Fragments = true;
        this.Preview = null;
    }

    Open(Index)
    {
        this.Close();
        this.Index = Index;
        this.Context = this.ContextFactory();
        const { Kit, Exhibit, Change } = this.Context;
        const Entry = Exhibit.Scene.Breakables[Index];
        const Kind = BreakableKinds[Entry.Kind];
        const Overlay = document.createElement("div");
        Overlay.className = "fracture-editor";
        Overlay.innerHTML = `
            <div class="tab-strip"><div class="document-tab active">Fracture ↗</div><div class="notch"><b>Frontier</b> · IlluminationHost · drift yard</div></div>
            <div class="editor-bar"><span class="crumb">${Entry.Name} / <b>Fracture</b></span><span style="flex:1"></span>
                <button data-action="break">Fracture object</button><button data-action="reassemble">Reassemble</button><button data-action="close">Close ↙</button></div>
            <div class="editor-body">
                <div class="editor-column" data-column="object"></div>
                <div class="editor-centre">
                    <div class="preview-head"><div class="segmented" data-segment="view"><button data-view="source">Source</button><button data-view="fragments">Fragments</button></div>
                        <span class="spacer"></span><button data-action="wireframe">Wireframe</button><button data-action="fit">Fit</button></div>
                    <div class="preview"><canvas></canvas><div class="preview-title"><small></small><h2></h2><p></p></div></div>
                    <div class="preview-controls"></div>
                    <div class="preview-stats"><div><strong data-stat="fragments">0</strong><small>Fragments</small></div>
                        <div><strong data-stat="volume">0</strong><small>Occupied volume</small></div>
                        <div><strong data-stat="quality">0</strong><small>Min triangle quality</small></div>
                        <div><strong data-stat="topology">—</strong><small>Topology</small></div></div>
                </div>
                <div class="editor-column" data-column="inspector"></div>
            </div>
            <div class="editor-status"><span data-status="line">Ready</span><span>HTML preview · the yard fractures with the same recipe</span></div>`;
        this.Host.appendChild(Overlay);
        this.Overlay = Overlay;

        // ① object column
        const Column = Overlay.querySelector('[data-column="object"]');
        const Card = document.createElement("div");
        Card.className = "object-card";
        Card.innerHTML = `<div><b>${Entry.Name}</b><small>${Kind.Name}</small></div><i></i>`;
        Column.appendChild(Card);
        const Facts = Kit.Card(Column, "Source", "Prop in the yard");
        const Blank = Exhibit.Fragments.ResolveFracture(Index).Blank;
        const Volume = ResolveMoments(Blank).Volume;
        Kit.Readout(Facts, "Primitive", () => Kind.Primitive);
        Kit.Readout(Facts, "Dimensions", () => Kind.Extent.map((Length) => Length.toFixed(3)).join(" × ") + " m");
        Kit.Readout(Facts, "Source volume", () => `${Volume.toFixed(4)} m³`);
        Kit.Readout(Facts, "Mass", () => `${Kind.Mass.toFixed(0)} kg`);
        Kit.Readout(Facts, "Position", () => Entry.Position.map((Coordinate) => Coordinate.toFixed(1)).join(", "));
        Kit.Readout(Facts, "Storage", () => "Browser · per object");
        Kit.Readouts.push(() => { Card.querySelector("i").className = Exhibit.Fragments.QueryBroken(Index) ? "broken" : ""; });

        // ② inspector column — the shared recipe cards
        const Inspector = Overlay.querySelector('[data-column="inspector"]');
        const Fracture = Kit.Card(Inspector, "Fracture inspector", "Per object");
        Kit.Switch(Fracture, { Label: "Enable fracture", ...RecipeField(this.Context, Index, "Enabled") });
        Kit.Segmented(Fracture, { Label: "Bake", ...RecipeField(this.Context, Index, "Mode"), Options: [["Dynamic", "dynamic"], ["Baked", "baked"]] });
        ConstructRecipeCards(Inspector, this.Context, Index);

        // ③ preview controls
        const Controls = Overlay.querySelector(".preview-controls");
        Kit.Slider(Controls, { Label: "Fragment separation · inspection only", Read: () => this.Separation * 100,
                               Write: (Value) => { this.Separation = Value / 100; this.Paint(); }, Minimum: 0, Maximum: 60, Decimals: 0, Unit: "%" });
        const Again = document.createElement("button");
        Again.textContent = "Preview again";
        Again.addEventListener("click", () => { Again.blur(); this.Recompute(); });
        Controls.appendChild(Again);

        Overlay.querySelector('[data-action="close"]').addEventListener("click", () => this.Close());
        Overlay.querySelector('[data-action="break"]').addEventListener("click", (Event) => { Event.currentTarget.blur(); Change(`Break:${Index}`); });
        Overlay.querySelector('[data-action="reassemble"]').addEventListener("click", (Event) => { Event.currentTarget.blur(); Change(`Reassemble:${Index}`); });
        Overlay.querySelector('[data-action="wireframe"]').addEventListener("click", (Event) =>
        {
            this.Wireframe = !this.Wireframe;
            Event.currentTarget.classList.toggle("on", this.Wireframe);
            Event.currentTarget.blur();
            this.Paint();
        });
        Overlay.querySelector('[data-action="fit"]').addEventListener("click", (Event) => { Event.currentTarget.blur(); this.Yaw = 0.7; this.Pitch = 0.45; this.Paint(); });
        for (const Button of Overlay.querySelectorAll("[data-view]"))
            Button.addEventListener("click", () => { Button.blur(); this.Fragments = Button.dataset.view === "fragments"; this.ShowView(); this.Paint(); });
        const Canvas = Overlay.querySelector("canvas");
        let Dragging = false, LastX = 0, LastY = 0;
        Canvas.addEventListener("pointerdown", (Event) => { Dragging = true; LastX = Event.clientX; LastY = Event.clientY; Canvas.setPointerCapture(Event.pointerId); });
        Canvas.addEventListener("pointerup", () => { Dragging = false; });
        Canvas.addEventListener("pointermove", (Event) =>
        {
            if (!Dragging)
                return;
            this.Yaw -= (Event.clientX - LastX) * 0.008;
            this.Pitch = Math.max(-1.3, Math.min(1.3, this.Pitch + (Event.clientY - LastY) * 0.006));
            LastX = Event.clientX;
            LastY = Event.clientY;
            this.Paint();
        });
        this.Resize = new ResizeObserver(() => this.Paint());
        this.Resize.observe(Canvas);
        this.ShowView();
        this.Recompute();
    }

    ShowView()
    {
        for (const Button of this.Overlay.querySelectorAll("[data-view]"))
            Button.setAttribute("aria-pressed", (Button.dataset.view === "fragments") === this.Fragments);
    }

    // 📝 Called by the host when the recipe changed; the preview is recomputed a moment after the last edit.
    Invalidate()
    {
        if (!this.Overlay)
            return;
        clearTimeout(this.Pending);
        this.Pending = setTimeout(() => this.Recompute(), 140);
    }

    Recompute()
    {
        if (!this.Overlay)
            return;
        const { Exhibit } = this.Context;
        const Resolved = Exhibit.Fragments.ResolveFracture(this.Index);
        const Kind = Resolved.Kind;
        const SourceVolume = ResolveMoments(Resolved.Blank).Volume;
        const Occupied = Resolved.Result.Parts.reduce((Sum, Part) => Sum + ResolveMoments(Part).Volume, 0) / SourceVolume;
        this.Preview = { Resolved, Shell: ProjectSwatch(Kind.Family), Core: ProjectSwatch(Kind.Core), Centre: ResolveBounds(Resolved.Blank).Centre,
                         Radius: Math.hypot(...Kind.Extent) * 0.5 };
        const Stat = (Name, Value) => { this.Overlay.querySelector(`[data-stat="${Name}"]`).textContent = Value; };
        Stat("fragments", String(Resolved.Result.Parts.length));
        Stat("volume", `${(Occupied * 100).toFixed(3)}%`);
        Stat("quality", Resolved.Result.Quality.toFixed(3));
        Stat("topology", Resolved.Result.VolumeError < 1.0e-6 ? "Closed" : "Open");
        const Title = this.Overlay.querySelector(".preview-title");
        Title.querySelector("small").textContent = `${Resolved.Recipe.Mode.toUpperCase()} / GEOMETRY`;
        Title.querySelector("h2").textContent = Resolved.Entry.Name;
        Title.querySelector("p").textContent = `${Resolved.Result.Parts.length} closed fragments · ${FractureMaterials[Resolved.Recipe.Material].Label}`;
        this.Overlay.querySelector('[data-status="line"]').textContent =
            `Generated ${Resolved.Result.Parts.length} closed fragments in ${Resolved.Result.Milliseconds.toFixed(1)} ms · occupied volume ${(Occupied * 100).toFixed(6)}% · `
          + `${Resolved.Result.Triangles} triangles · ${Resolved.Result.Spent.toFixed(0)} J spent`;
        this.Paint();
    }

    // 📐 A flat-shaded painter's projection: every face of every part, offset outward from the blank's centre by the
    //    separation, sorted far to near, lit by one key light. Enough to judge a pattern; the yard renders the real thing.
    Paint()
    {
        if (!this.Overlay || !this.Preview)
            return;
        const Canvas = this.Overlay.querySelector("canvas");
        const Box = Canvas.getBoundingClientRect(), Ratio = Math.min(2, devicePixelRatio || 1);
        if (!Box.width || !Box.height)
            return;
        Canvas.width = Math.round(Box.width * Ratio);
        Canvas.height = Math.round(Box.height * Ratio);
        const Context2D = Canvas.getContext("2d");
        Context2D.setTransform(Ratio, 0, 0, Ratio, 0, 0);
        Context2D.clearRect(0, 0, Box.width, Box.height);
        const { Resolved, Shell, Core, Centre, Radius } = this.Preview;
        const Parts = this.Fragments ? Resolved.Result.Parts : [Resolved.Blank];
        const CosYaw = Math.cos(this.Yaw), SinYaw = Math.sin(this.Yaw), CosPitch = Math.cos(this.Pitch), SinPitch = Math.sin(this.Pitch);
        const Scale = Math.min(Box.width, Box.height) * 0.36 / Math.max(Radius, 0.05);
        const View = (Point) =>
        {
            const X = Point[0] - Centre[0], Y = Point[1] - Centre[1], Z = Point[2] - Centre[2];
            const Rx = X * CosYaw - Y * SinYaw, Ry = X * SinYaw + Y * CosYaw;
            return [Rx, Ry * CosPitch - Z * SinPitch, Ry * SinPitch + Z * CosPitch];
        };
        const Light = [0.45, -0.55, 0.7];
        const Faces = [];
        for (const Part of Parts)
        {
            const Moments = ResolveMoments(Part);
            const Offset = this.Fragments ? [0, 1, 2].map((Axis) => (Moments.Centroid[Axis] - Centre[Axis]) * this.Separation) : [0, 0, 0];
            const Points = Part.Vertices.map((Point) => View([Point[0] + Offset[0], Point[1] + Offset[1], Point[2] + Offset[2]]));
            for (const Face of Part.Faces)
            {
                const Corners = Face.Indices.map((Index) => Points[Index]);
                const A = Corners[0], B = Corners[1], C = Corners[2];
                const Normal = [(B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]),
                                (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]),
                                (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])];
                const Length = Math.hypot(...Normal) || 1;
                if (Normal[1] / Length > 0.02 && !this.Wireframe)
                    continue;
                const Depth = Corners.reduce((Sum, Corner) => Sum + Corner[1], 0) / Corners.length;
                const Shade = 0.32 + 0.68 * Math.max(0, -(Normal[0] * Light[0] + Normal[1] * Light[1] + Normal[2] * Light[2]) / Length);
                Faces.push({ Corners, Depth, Shade, Interior: Face.Interior });
            }
        }
        Faces.sort((Left, Right) => Right.Depth - Left.Depth);
        const CentreX = Box.width / 2, CentreY = Box.height / 2 + 10;
        for (const Face of Faces)
        {
            Context2D.beginPath();
            Face.Corners.forEach((Corner, Slot) =>
            {
                const X = CentreX + Corner[0] * Scale, Y = CentreY - Corner[2] * Scale;
                if (Slot === 0)
                    Context2D.moveTo(X, Y);
                else
                    Context2D.lineTo(X, Y);
            });
            Context2D.closePath();
            const Colour = (Face.Interior ? Core : Shell).map((Channel) => Math.round(Channel * Face.Shade));
            if (!this.Wireframe)
            {
                Context2D.fillStyle = `rgb(${Colour.join(",")})`;
                Context2D.fill();
            }
            Context2D.strokeStyle = this.Wireframe ? (Face.Interior ? "#ffb454" : "#bdbdbd") : "rgba(0,0,0,0.35)";
            Context2D.lineWidth = this.Wireframe ? 0.8 : 0.6;
            Context2D.stroke();
        }
    }

    Refresh()
    {
        if (this.Context)
            this.Context.Kit.Refresh();
    }

    Close()
    {
        if (this.Resize)
            this.Resize.disconnect();
        if (this.Overlay)
            this.Overlay.remove();
        this.Overlay = null;
        this.Preview = null;
        this.Index = -1;
    }
}
