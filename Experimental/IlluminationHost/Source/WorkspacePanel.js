//============================================================================================================================================
//                                                            WORKSPACEPANEL.JS
//============================================================================================================================================
// 🧩 The exhibit as a Frontier editor workspace: outliner, viewport and inspector docks, the debug windows and the live readouts.

// 📝 The Project-Zero editor's three docks (Experimental/ProjectZeroEditor/Editor.jsx): the outliner on the left lists
//    the yard — vehicle, smoke and fire, sun, GI, the collections and every breakable prop — the viewport in the
//    middle carries the WebGPU canvas with its header and footer, and the inspector on the right builds the page of
//    whatever is selected from InspectorPanel, PlumePanel and FracturePanel. H hides both docks and the debug windows
//    for a bare view and brings back what was showing; their state survives a reload, as the quality grade reloads.

import { InspectorKit, ConstructVehiclePage, ConstructLightingPage, ConstructRenderingPage, ConstructStressPage, ConstructSmashPage } from "./InspectorPanel.js";
import { ConstructPlumePage } from "./PlumePanel.js";
import { ConstructBreakablePage, FractureEditor } from "./FracturePanel.js";
import { BreakableKinds } from "./YardStructure.js";

export const OverlayKeys = ["HudEnabled", "InsetEnabled", "PanelEnabled"];
const OverlayStorageKey = "IlluminationHost.Overlays";
const RefreshMilliseconds = 200.0;

export function RetrieveOverlayConfiguration(Settings)
{
    try
    {
        const Stored = JSON.parse(window.localStorage.getItem(OverlayStorageKey) || "null");
        if (Stored)
            for (const Key of OverlayKeys)
                if (typeof Stored[Key] === "boolean")
                    Settings[Key] = Stored[Key];
    }
    catch (Failure)
    {
        console.warn("Overlay configuration could not be read", Failure);
    }
}

// 📝 Sixteen-pixel line glyphs for the outliner rows.
const Glyphs = {
    yard:     '<path d="M2 13h12M3 13V7l5-3 5 3v6M6 13v-3h4v3"/>',
    car:      '<path d="M2 10.5h12l-1.4-3.6a1.5 1.5 0 0 0-1.4-.9H4.8a1.5 1.5 0 0 0-1.4.9z"/><circle cx="4.8" cy="11.5" r="1.3"/><circle cx="11.2" cy="11.5" r="1.3"/>',
    flame:    '<path d="M8 14c-2.6 0-4.2-1.8-4.2-4 0-2.6 2.3-3.6 2.6-6.5C8.6 5 9 6.6 8.8 8c1-.4 1.6-1.3 1.7-2.3 1.3 1.3 1.7 2.7 1.7 4.2 0 2.3-1.6 4.1-4.2 4.1z"/>',
    sun:      '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>',
    layers:   '<path d="M8 2.5l5.5 3L8 8.5l-5.5-3zM2.5 8.3L8 11.3l5.5-3M2.5 10.8L8 13.8l5.5-3"/>',
    folder:   '<path d="M2 4.5h4l1.2 1.4H14v6.6H2z"/>',
    crate:    '<rect x="3" y="3" width="10" height="10" rx="0.8"/><path d="M3 3l10 10M13 3L3 13"/>',
    pane:     '<rect x="4" y="2" width="8" height="12" rx="0.6"/><path d="M6 4.5l2 2M6.5 8l3-3"/>',
    barrel:   '<ellipse cx="8" cy="3.8" rx="4" ry="1.6"/><path d="M4 3.8v8.4c0 .9 1.8 1.6 4 1.6s4-.7 4-1.6V3.8M4 8c0 .9 1.8 1.6 4 1.6s4-.7 4-1.6"/>',
    block:    '<path d="M2.5 6l5.5-2.5L13.5 6v4.5L8 13l-5.5-2.5z"/><path d="M2.5 6L8 8.5 13.5 6M8 8.5V13"/>',
    barrier:  '<path d="M2 13h12M4 13l1.2-7h5.6L12 13"/>',
    light:    '<path d="M5 14h6M8 14V5M8 5l4-1.6M10.5 2.5h3v2.2h-3z"/>',
    gauge:    '<path d="M2.5 11a5.5 5.5 0 1 1 11 0"/><path d="M8 11l3-3.5"/>',
    stack:    '<rect x="2" y="9" width="12" height="4"/><rect x="3" y="4" width="10" height="4"/>'
};
const KindGlyphs = { Crate: "crate", Pane: "pane", Barrel: "barrel", Block: "block", Barrier: "barrier" };

function Glyph(Name)
{
    return `<svg class="row-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${Glyphs[Name] || Glyphs.folder}</svg>`;
}

export class WorkspacePanel
{
    constructor(Exhibit, Settings, OnChange)
    {
        this.Exhibit   = Exhibit;
        this.Settings  = Settings;
        this.OnChange  = OnChange;
        this.Workspace = document.getElementById("workspace");
        this.Hud       = document.getElementById("hud");
        this.Rows      = document.getElementById("outliner-rows");
        this.Inspector = document.getElementById("inspector");
        this.Kit       = new InspectorKit(Settings, (Key) => this.Change(Key));
        this.Selection = "plume";
        this.Collapsed = new Set(["barriers", "containers-info"]);
        this.Filter    = "all";
        this.Search    = "";
        this.LastRefresh = 0.0;
        this.Editor    = new FractureEditor(document.body, () => this.ConstructContext(new InspectorKit(Settings, (Key) => this.Change(Key))));
        this.ConstructModel();
        this.ConstructChrome();
        this.ProjectOverlays();
        this.ProjectOutliner();
        this.ProjectInspector();
    }

    Change(Key)
    {
        if (Key === "ToggleOverlays")
            return this.ToggleOverlays();
        if (OverlayKeys.includes(Key))
            this.ProjectOverlays();
        this.OnChange(Key);
        if (Key.startsWith("FractureRecipe:") && this.Editor.Index === Number(Key.split(":")[1]))
            this.Editor.Invalidate();
        if (Key.startsWith("Break:") || Key.startsWith("Reassemble:") || Key === "BreakAll" || Key === "ReassembleAll")
            this.ProjectOutliner();
    }

    ConstructContext(Kit)
    {
        return { Kit, Exhibit: this.Exhibit, Settings: this.Settings, Change: (Key) => this.Change(Key),
                 OpenFractureEditor: (Index) => this.Editor.Open(Index) };
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                    OUTLINER
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Rows: { Id, Name, Glyph, Depth, Tags, Parent, Summary(), Status(), Page(Parent, Context) }.
    ConstructModel()
    {
        const Exhibit = this.Exhibit;
        const Rows = [];
        const Info = (Title, Eyebrow, Text, Facts) => (Parent, Context) =>
        {
            Context.Kit.Heading(Parent, Eyebrow, Title, Text);
            const Card = Context.Kit.Card(Parent, "Collection", "Static occupants");
            for (const [Label, Read] of Facts)
                Context.Kit.Readout(Card, Label, Read);
        };
        Rows.push({ Id: "yard", Name: "Drift yard", Glyph: "yard", Depth: 0, Tags: ["all"], Summary: () => `${Exhibit.Scene.Occupants.length} occupants`,
                    Page: Info("Drift yard", "Scene", "A 120 m asphalt pad: burnout box, figure eight, warehouse, container wall, barrier straight and smash zone.",
                               [["Occupants", () => String(Exhibit.Scene.Occupants.length)], ["Distance occupants", () => String(Exhibit.Scene.DistanceCount)],
                                ["Surface cards", () => String(Exhibit.Cards.Cards.length)], ["Distance volumes", () => `${Exhibit.Volumes.Volumes.length} · ${Exhibit.Volumes.SpaceExtent.join(" × ")} texels`],
                                ["Breakable props", () => String(Exhibit.Scene.Breakables.length)]]) });
        Rows.push({ Id: "vehicle", Name: "ControlVehicle", Glyph: "car", Depth: 1, Tags: ["vehicle"], Summary: () => `${(Math.abs(Exhibit.Vehicle.QueryTelemetry().Speed) * 3.6).toFixed(0)} km/h`,
                    Status: () => Exhibit.Vehicle.QueryTelemetry().TyresBurning > 0 ? "burning" : "", Page: ConstructVehiclePage });
        Rows.push({ Id: "plume", Name: "Smoke & fire", Glyph: "flame", Depth: 1, Tags: ["effects"], Summary: () => Exhibit.Plume.QueryDescription().Grade,
                    Status: () => !this.Settings.PlumeEnabled ? "idle" : Exhibit.Plume.Resident ? (Exhibit.Vehicle.QueryTelemetry().TyresBurning > 0 ? "burning" : "") : "idle",
                    Page: ConstructPlumePage });
        Rows.push({ Id: "sun", Name: "Sun & sky", Glyph: "sun", Depth: 1, Tags: ["lights"], Summary: () => `${this.Settings.SunElevation.toFixed(0)}°`, Page: ConstructLightingPage });
        Rows.push({ Id: "render", Name: "Global illumination", Glyph: "layers", Depth: 1, Tags: ["render"], Summary: () => Exhibit.GradeName, Page: ConstructRenderingPage });
        Rows.push({ Id: "lights", Name: "Floodlights · strip lights", Glyph: "light", Depth: 1, Tags: ["lights"], Summary: () => "8 + 15",
                    Page: Info("Floodlights", "Lights · emitters", "Eight floodlight poles round the pad and a strip light under every roof module. Their emission is "
                               + "captured by the surface cards, so at night they light the yard through the indirect term.",
                               [["Emission scale", () => `${this.Settings.EmissionScale.toFixed(2)} ×`], ["Sun elevation", () => `${this.Settings.SunElevation.toFixed(1)}°`]]) });
        const Breakables = Exhibit.Scene.Breakables;
        const Collection = (Id, Name, Glyph, Filter, Page) =>
        {
            const Members = Breakables.map((Entry, Index) => ({ Entry, Index })).filter(({ Entry }) => Filter(Entry));
            Rows.push({ Id, Name, Glyph, Depth: 1, Tags: ["breakables"], Collection: true,
                        Summary: () => `${Members.filter(({ Index }) => Exhibit.Fragments.QueryBroken(Index)).length} / ${Members.length} broken`, Page });
            for (const { Entry, Index } of Members)
                Rows.push({ Id: `breakable:${Index}`, Name: Entry.Name, Glyph: KindGlyphs[Entry.Kind], Depth: 2, Tags: ["breakables"], Parent: Id,
                            Summary: () => BreakableKinds[Entry.Kind].Material, Status: () => Exhibit.Fragments.QueryBroken(Index) ? "broken" : "",
                            Page: (Parent, Context) => ConstructBreakablePage(Parent, Context, Index) });
        };
        Collection("smash", "Smash zone", "folder", (Entry) => ["Pane", "Crate", "Barrel", "Block"].includes(Entry.Kind) && !Entry.Name.startsWith("Warehouse"), ConstructSmashPage);
        Collection("barriers", "Barrier straight", "barrier", (Entry) => Entry.Kind === "Barrier", ConstructSmashPage);
        Collection("warehouse", "Warehouse", "folder", (Entry) => Entry.Name.startsWith("Warehouse"),
                   Info("Warehouse", "Collection · structure", "40 × 24 m, 8 m high, an open 16 m door, three skylights and a strip light under every roof module "
                        + "— bounce light, sun shafts, and smoke trapped under a roof.", [["Modules", () => "5 + 6 + 4 walls · 2 lintels · 15 roof · dock"]]));
        Rows.push({ Id: "containers-info", Name: "Container wall", Glyph: "stack", Depth: 1, Tags: ["all"], Summary: () => "26 · ISO 20 ft",
                    Page: Info("Container wall", "Collection · structure", "Twenty-six twenty-foot containers in trade colours, stacked two high along the east edge "
                               + "and loose round the pad — large coloured walls for the indirect term to carry.", [["Footprint", () => "6.06 × 2.44 × 2.59 m"]]) });
        Rows.push({ Id: "stress", Name: "Stress test", Glyph: "gauge", Depth: 1, Tags: ["render"], Summary: () => `${Exhibit.Debris.Bodies.length} objects`, Page: ConstructStressPage });
        this.Model = Rows;
    }

    ProjectOutliner()
    {
        const Visible = this.Model.filter((Row) =>
        {
            if (Row.Parent && this.Collapsed.has(Row.Parent) && !this.Search)
                return false;
            if (this.Search && !Row.Name.toLowerCase().includes(this.Search))
                return false;
            if (this.Filter !== "all" && !Row.Tags.includes(this.Filter) && Row.Id !== "yard")
                return false;
            return true;
        });
        this.Rows.replaceChildren();
        this.RowStatus = [];
        for (const Row of Visible)
        {
            const Node = document.createElement("div");
            Node.className = "outliner-row" + (Row.Id === this.Selection ? " selected" : "");
            Node.style.setProperty("--depth", Row.Depth);
            const HasMembers = this.Model.some((Other) => Other.Parent === Row.Id);
            Node.innerHTML = `<button class="row-disclosure ${HasMembers ? "" : "empty"}">${this.Collapsed.has(Row.Id) ? "▸" : "▾"}</button>${Glyph(Row.Glyph)}`;
            const Name = document.createElement("span");
            Name.className = "row-name";
            Name.textContent = Row.Name;
            const Summary = document.createElement("small");
            const Status = document.createElement("i");
            Status.className = "row-status";
            Node.append(Name, Summary, Status);
            Node.querySelector(".row-disclosure").addEventListener("click", (Event) =>
            {
                Event.stopPropagation();
                if (this.Collapsed.has(Row.Id))
                    this.Collapsed.delete(Row.Id);
                else
                    this.Collapsed.add(Row.Id);
                this.ProjectOutliner();
            });
            Node.addEventListener("click", () =>
            {
                this.Selection = Row.Id;
                this.ProjectOutliner();
                this.ProjectInspector();
            });
            this.Rows.appendChild(Node);
            this.RowStatus.push(() =>
            {
                Summary.textContent = Row.Summary ? Row.Summary() : "";
                Status.className = "row-status " + (Row.Status ? Row.Status() : "");
            });
        }
        for (const Refresh of this.RowStatus)
            Refresh();
        document.getElementById("outliner-count").textContent = `${this.Exhibit.Scene.Breakables.length} breakables · ${this.Model.length} rows`;
    }

    ProjectInspector()
    {
        const Row = this.Model.find((Candidate) => Candidate.Id === this.Selection) || this.Model[0];
        this.Kit.Reset();
        this.Inspector.replaceChildren();
        Row.Page(this.Inspector, this.ConstructContext(this.Kit));
        document.getElementById("inspector-subject").textContent = Row.Name;
    }

    // 📝 Selects a row from outside (a click on a prop, the editor), revealing its collection.
    SelectRow(Id)
    {
        const Row = this.Model.find((Candidate) => Candidate.Id === Id);
        if (!Row)
            return;
        if (Row.Parent)
            this.Collapsed.delete(Row.Parent);
        this.Selection = Id;
        this.ProjectOutliner();
        this.ProjectInspector();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                 VIEWPORT CHROME
    //--------------------------------------------------------------------------------------------------------------------

    ConstructChrome()
    {
        const Search = document.getElementById("outliner-search");
        Search.addEventListener("input", () => { this.Search = Search.value.trim().toLowerCase(); this.ProjectOutliner(); });
        for (const Chip of document.querySelectorAll("#filter-chips button"))
        {
            Chip.addEventListener("click", () =>
            {
                Chip.blur();
                this.Filter = Chip.dataset.filter;
                for (const Other of document.querySelectorAll("#filter-chips button"))
                    Other.setAttribute("aria-pressed", Other === Chip);
                this.ProjectOutliner();
            });
        }
        const Camera = document.getElementById("camera-mode");
        for (const Button of Camera.querySelectorAll("button"))
            Button.addEventListener("click", () =>
            {
                Button.blur();
                if ((Button.dataset.mode === "free") !== this.Exhibit.FreeCamera)
                    this.OnChange("ToggleCamera");
            });
        const Burnout = document.getElementById("burnout-button");
        Burnout.addEventListener("click", () =>
        {
            Burnout.blur();
            this.Settings.LineLockLatched = !this.Settings.LineLockLatched;
            this.Kit.Synchronise();
        });
        document.getElementById("respawn-button").addEventListener("click", (Event) => { Event.currentTarget.blur(); this.OnChange("Respawn"); });
        document.getElementById("bare-button").addEventListener("click", (Event) => { Event.currentTarget.blur(); this.ToggleOverlays(); });
        const Restore = document.getElementById("overlay-restore");
        Restore.addEventListener("click", () =>
        {
            Restore.blur();
            if (!OverlayKeys.some((Key) => this.Settings[Key]))
                this.ToggleOverlays();
            else
            {
                this.Settings.PanelEnabled = true;
                this.ProjectOverlays();
            }
        });
        this.AssignCameraMode(false);
    }

    AssignCameraMode(Free)
    {
        for (const Button of document.querySelectorAll("#camera-mode button"))
            Button.setAttribute("aria-pressed", (Button.dataset.mode === "free") === Free);
    }

    // 📝 Applies the overlay toggles and remembers them. The restore button appears whenever the docks are hidden.
    ProjectOverlays()
    {
        this.Hud.classList.toggle("hidden", !this.Settings.HudEnabled);
        document.getElementById("inset-legend").classList.toggle("hidden", !this.Settings.InsetEnabled);
        this.Workspace.classList.toggle("bare", !this.Settings.PanelEnabled);
        document.getElementById("overlay-restore").classList.toggle("hidden", !!this.Settings.PanelEnabled);
        try
        {
            window.localStorage.setItem(OverlayStorageKey, JSON.stringify(Object.fromEntries(OverlayKeys.map((Key) => [Key, !!this.Settings[Key]]))));
        }
        catch (Failure)
        {
            console.warn("Overlay configuration could not be stored", Failure);
        }
    }

    // 📝 H: hides every dock and debug window, or restores the ones that were showing before.
    ToggleOverlays()
    {
        const Shown = OverlayKeys.some((Key) => this.Settings[Key]);
        if (Shown)
        {
            this.SuspendedOverlays = Object.fromEntries(OverlayKeys.map((Key) => [Key, !!this.Settings[Key]]));
            for (const Key of OverlayKeys)
                this.Settings[Key] = false;
        }
        else
        {
            const Prior = this.SuspendedOverlays && OverlayKeys.some((Key) => this.SuspendedOverlays[Key]) ? this.SuspendedOverlays : null;
            for (const Key of OverlayKeys)
                this.Settings[Key] = Prior ? Prior[Key] : true;
        }
        this.Kit.Synchronise();
        this.ProjectOverlays();
        this.OnChange("Overlays");
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  MEASUREMENTS
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Readouts refresh at 5 Hz; the measurements are smoothed upstream. Lines: the heads-up readout.
    PresentMeasurements(Now, Lines, Footer)
    {
        const Burnout = document.getElementById("burnout-button");
        Burnout.classList.toggle("on", !!this.Settings.LineLockLatched || this.Exhibit.Keys.has("KeyB"));
        if (Now - this.LastRefresh < RefreshMilliseconds)
            return;
        this.LastRefresh = Now;
        if (this.Settings.HudEnabled)
            this.Hud.textContent = Lines.join("\n");
        if (!this.Settings.PanelEnabled)
            return;
        this.Kit.Refresh();
        this.Editor.Refresh();
        for (const Refresh of this.RowStatus)
            Refresh();
        document.getElementById("viewport-footer").innerHTML = Footer.Viewport;
        document.getElementById("outliner-footer").innerHTML = Footer.Outliner;
        document.getElementById("inspector-status").textContent = Footer.Inspector;
    }

    AssignStressCapacity()
    {
        this.Kit.Refresh();
    }
}
