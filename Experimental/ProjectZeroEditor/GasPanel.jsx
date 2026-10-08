//============================================================================================================================================
//                                                              GASPANEL.JSX
//============================================================================================================================================
// 📦 The gas domain as the inspector shows it — a small card with the settings worth having inline, and one button to the full editor.
//
// Two components, and the split is the whole design:
//
//    GasInspector   eleven settings, a preview that tells the truth about whether anything is running, a
//                   live cost readout, and ↗. Docked in a 320-pixel column, so it holds what someone
//                   actually adjusts while placing an effect in a level.
//    GasEditor      the full page, opened from ↗, exactly as the fracture card opens the fracture editor
//                   and the wind card opens WindEditor. It is not a second design: it hosts the Fluid
//                   simulator page that already exists in Experimental/Fluid.
//
// 🔴 THE PREVIEW REFUSES TO SHOW A PLUME THAT THE GAME WOULD NOT SHOW.
//    A dormant domain draws its bounds and nothing else. It would be easy — and much prettier — to animate
//    every card, and it would teach everyone that effects run by themselves. They do not: the budget admits
//    twelve live domains and most of a level's gas is dormant until something fires it. A preview that lies
//    about that is worse than no preview.

import React, { useEffect, useRef, useState } from "react";
import {
  ExposedGasFields,
  GasFieldGroups,
  GasPresetChoices,
  GasRowSummary,
  GasRunPolicies,
  GasRunning,
  GasSummary,
  GasTiers,
  NewGasDomain,
  ResolveGas,
  SpellBytes,
  TierForDistance,
} from "./GasSpecification.js";
import "./GasPanel.css";

export { GasRowSummary };

// ─── The preview ───────────────────────────────────────────────────────────────────────────────────────────

// A cheap 2D stand-in for the volume, drawn the way the real one is lit: smoke that scatters, heat that
//    emits, both rising. It is not the simulator and is not pretending to be — it reads the same settings so
//    that turning Fire down darkens this, which is what a preview is for.
export function GasPreview({ Resolved, Active = true, Playing = true, Running = true }) {
  const Canvas = useRef(null),
    Latest = useRef({});
  Latest.current = { Resolved, Active, Playing, Running };

  useEffect(() => {
    const Node = Canvas.current,
      Context = Node.getContext("2d");
    let Frame,
      Before = 0,
      Time = 0;
    // Deterministic seeds: the same card always draws the same plume, so a screenshot is comparable.
    const Puffs = Array.from({ length: 34 }, (_, Index) => ({
      Phase: ((Index * 61) % 97) / 97,
      Sway: (((Index * 37) % 71) / 71 - 0.5) * 2,
      Size: 0.45 + (((Index * 53) % 83) / 83) * 0.8,
    }));

    const Paint = (Now) => {
      Frame = requestAnimationFrame(Paint);
      if (Now - Before < 32 || !Node.getClientRects().length || document.hidden) return;
      const Step = Math.min(0.05, (Now - (Before || Now)) / 1000);
      Before = Now;
      const { Resolved, Active, Playing, Running } = Latest.current;
      if (Playing && Active && Running) Time += Step;

      const Box = Node.getBoundingClientRect(),
        W = Box.width,
        H = Box.height,
        Ratio = Math.min(2, devicePixelRatio || 1);
      if (!W || !H) return;
      if (Node.width !== Math.round(W * Ratio) || Node.height !== Math.round(H * Ratio)) {
        Node.width = Math.round(W * Ratio);
        Node.height = Math.round(H * Ratio);
      }
      Context.setTransform(Ratio, 0, 0, Ratio, 0, 0);
      Context.fillStyle = "#0e1316";
      Context.fillRect(0, 0, W, H);

      // The bounds box, always. It is the part of a domain that exists whether or not anything is simulating.
      const Settings = Resolved.Settings,
        Aspect = Settings.boundsHeight / Math.max(0.1, Settings.boundsWidth),
        BoxH = Math.min(H - 26, (W - 60) * Aspect),
        BoxW = BoxH / Math.max(0.2, Aspect),
        Left = (W - BoxW) / 2,
        Floor = H - 13;
      Context.strokeStyle = Running ? "#5e7f8c" : "#3a4950";
      Context.setLineDash(Running ? [] : [3, 4]);
      Context.lineWidth = 1;
      Context.strokeRect(Left, Floor - BoxH, BoxW, BoxH);
      Context.setLineDash([]);

      if (!Running) {
        Context.fillStyle = "#6c7d85";
        Context.font = "10px ui-monospace, monospace";
        Context.textAlign = "center";
        Context.fillText("DORMANT · NOT SIMULATING", W / 2, Floor - BoxH / 2);
        return;
      }

      // Smoke and heat. Extinction darkens, albedo lightens, fire intensity and emitter temperature set how
      //    much of the base is incandescent — the same four readings the raymarch gives the most weight to.
      const Heat = Math.min(1, (Settings.fireIntensity / 10) * Math.min(1, Settings.emitterTemperature / 4)),
        Albedo = Math.min(1, Settings.smokeAlbedo),
        Thickness = Math.min(1, Settings.densityExtinction / 40),
        Rate = Math.max(0.05, Settings.emitterRate),
        Rise = Math.max(0.2, Settings.buoyancy / 6);
      Context.globalCompositeOperation = "lighter";
      for (const Puff of Puffs) {
        const Life = (Time * 0.32 * Rise + Puff.Phase) % 1,
          Y = Floor - Life * BoxH * 0.96,
          Spread = 0.1 + Life * 0.46,
          X = Left + BoxW / 2 + Puff.Sway * Spread * BoxW * 0.42,
          Radius = Puff.Size * BoxW * (0.07 + Spread * 0.2),
          Fade = Math.sin(Math.PI * Math.min(1, Life * 1.25)) * Rate;
        const Glow = Math.max(0, Heat * (1 - Life * 3.2));
        const Shade = Context.createRadialGradient(X, Y, 0, X, Y, Math.max(1, Radius));
        const Grey = Math.round(70 + Albedo * 150);
        Shade.addColorStop(
          0,
          `rgba(${Math.round(Grey + Glow * (255 - Grey))},${Math.round(Grey + Glow * (150 - Grey))},${Math.round(Grey + Glow * (60 - Grey))},${0.1 + Fade * 0.3 * (0.35 + Thickness)})`,
        );
        Shade.addColorStop(1, "rgba(0,0,0,0)");
        Context.fillStyle = Shade;
        Context.beginPath();
        Context.arc(X, Y, Math.max(1, Radius), 0, Math.PI * 2);
        Context.fill();
      }
      Context.globalCompositeOperation = "source-over";
    };

    Frame = requestAnimationFrame(Paint);
    return () => cancelAnimationFrame(Frame);
  }, []);

  return (
    <div className="gas-visual">
      <canvas ref={Canvas} aria-label="Gas domain preview" />
    </div>
  );
}

// ─── The inspector card ────────────────────────────────────────────────────────────────────────────────────

export function GasInspector({ Values, Change, Open, Hidden }) {
  const Resolved = ResolveGas(Values),
    [Fired, Fire] = useState(false),
    [Group, ShowGroup] = useState("domain");
  const Running = GasRunning(Resolved, Fired) && !Hidden;
  const Domain = { ...NewGasDomain(), ...(Values.Gas || {}) };
  const Assign = (Key, Reading) => Change("Gas", { ...Domain, [Key]: Reading });
  const Override = (Key, Reading) =>
    Change("Gas", { ...Domain, Overrides: { ...Domain.Overrides, [Key]: Reading } });

  // A domain over the ceiling on its own is a configuration mistake worth saying out loud here, where it is
  //    made, rather than in a frame-rate report later.
  const Heavy = Resolved.Bytes > 96 * 1024 * 1024;

  return (
    <section className="property-card gas-inspector" data-card="Gas domain">
      <div className="gas-section-head">
        <div>
          <span className="eyebrow">VOLUMETRICS · GAS</span>
          <h2>Gas domain</h2>
        </div>
        <button onClick={Open} aria-label="Expand FluidEditor" title="Open the full Fluid editor">
          ↗
        </button>
      </div>

      <GasPreview Resolved={Resolved} Active={!Hidden} Running={Running} />

      <div className={"gas-status " + (Running ? "live" : "idle")}>
        <i />
        <span>{GasSummary(Resolved)}</span>
      </div>

      <label className="gas-row">
        Preset
        <select
          aria-label="Gas preset"
          value={Resolved.Preset}
          onChange={(Event) => Change("Gas", { ...Domain, Preset: Event.target.value, Overrides: {} })}
        >
          {GasPresetChoices.map((Entry) => (
            <option key={Entry.Id} value={Entry.Id}>
              {Entry.Name}
              {Entry.OneShot ? " · one-shot" : ""}
            </option>
          ))}
        </select>
      </label>

      <h4>WHEN IT RUNS</h4>
      <div className="gas-policy" role="group" aria-label="Gas run policy">
        {GasRunPolicies.map((Policy) => (
          <button
            key={Policy.Id}
            aria-pressed={Resolved.Policy.Id === Policy.Id}
            title={Policy.Description}
            onClick={() => Assign("Run", Policy.Id)}
          >
            {Policy.Name}
            <small>{Policy.Short}</small>
          </button>
        ))}
      </div>
      <p className="gas-note">{Resolved.Policy.Description}</p>

      {Resolved.Policy.Id === "triggered" && (
        <label className="gas-row">
          Lifetime
          <input
            type="number"
            aria-label="Gas lifetime"
            min={0.2}
            max={60}
            step={0.1}
            value={Resolved.Lifetime}
            onChange={(Event) => Assign("Lifetime", Number(Event.target.value) || 0.2)}
          />
          <small>s</small>
        </label>
      )}

      {Resolved.Policy.Id !== "always" && (
        <button className="gas-wide-button" onClick={() => Fire(!Fired)} aria-pressed={Fired}>
          {Fired ? "■ Stop preview" : "▶ Fire preview"}
        </button>
      )}

      <h4>COST</h4>
      <div className="gas-readout">
        <div>
          <strong>{Resolved.Tier.Name}</strong>
          <small>{Resolved.QualityPin === "auto" ? "granted by distance" : "pinned"}</small>
        </div>
        <div>
          <strong>{Resolved.Tier.Extent ? `${Resolved.Tier.Extent}³` : "card"}</strong>
          <small>lattice</small>
        </div>
        <div className={Heavy ? "heavy" : ""}>
          <strong>{SpellBytes(Resolved.Bytes)}</strong>
          <small>live, of 256 MB</small>
        </div>
        <div>
          <strong>{Resolved.Hertz ? `${Resolved.Hertz} Hz` : "—"}</strong>
          <small>solver rate</small>
        </div>
      </div>

      <label className="gas-row">
        Quality
        <select
          aria-label="Gas quality"
          value={Resolved.QualityPin}
          onChange={(Event) => Assign("QualityPin", Event.target.value)}
        >
          <option value="auto">Auto · by distance</option>
          {GasTiers.map((Tier) => (
            <option key={Tier.Id} value={Tier.Id}>
              Pin to {Tier.Name}
            </option>
          ))}
        </select>
      </label>

      {Resolved.QualityPin === "auto" && (
        <label className="gas-row gas-slider">
          Viewer at
          <input
            type="range"
            aria-label="Gas viewer distance"
            min={1}
            max={200}
            step={1}
            value={Resolved.Distance}
            onChange={(Event) => Assign("Distance", Number(Event.target.value))}
          />
          <small>
            {Math.round(Resolved.Distance)} m → {TierForDistance(Resolved.Distance).Name}
          </small>
        </label>
      )}

      <h4>PHYSICS</h4>
      <label className="switch-row">
        <span>Obstructs gas</span>
        <button
          className={"toggle " + (Resolved.Obstructs ? "on" : "")}
          role="switch"
          aria-label="Obstructs gas"
          aria-checked={Resolved.Obstructs}
          onClick={() => Assign("Obstructs", !Resolved.Obstructs)}
        >
          <i />
        </button>
      </label>
      <label className="switch-row">
        <span>Pushes objects · two-way</span>
        <button
          className={"toggle " + (Resolved.Coupled ? "on" : "")}
          role="switch"
          aria-label="Two-way coupling"
          aria-checked={Resolved.Coupled}
          onClick={() => Assign("Coupled", !Resolved.Coupled)}
        >
          <i />
        </button>
      </label>
      <p className="gas-note">
        Obstructing the gas is cheap and almost always wanted. Being pushed by it is neither, so it is off
        until a body opts in — debris and cloth clearly yes, a vehicle shoved by its own exhaust clearly not.
      </p>

      <h4>SETTINGS</h4>
      <div className="gas-tabs" role="group" aria-label="Gas setting groups">
        {GasFieldGroups.map((Entry) => (
          <button
            key={Entry.Id}
            aria-pressed={Group === Entry.Id}
            onClick={() => ShowGroup(Entry.Id)}
          >
            {Entry.Name}
          </button>
        ))}
      </div>
      {ExposedGasFields.filter((Field) => Field.Group === Group).map((Field) =>
        Field.Switch ? (
          <label className="switch-row" key={Field.Key}>
            <span>{Field.Label}</span>
            <button
              className={"toggle " + (Resolved.Settings[Field.Key] ? "on" : "")}
              role="switch"
              aria-label={Field.Label}
              aria-checked={Boolean(Resolved.Settings[Field.Key])}
              onClick={() => Override(Field.Key, !Resolved.Settings[Field.Key])}
            >
              <i />
            </button>
          </label>
        ) : (
          <label className="gas-row gas-slider" key={Field.Key}>
            {Field.Label}
            <input
              type="range"
              aria-label={Field.Label}
              min={Field.Min}
              max={Field.Max}
              step={Field.Step}
              value={Resolved.Settings[Field.Key] ?? Field.Min}
              onChange={(Event) => Override(Field.Key, Number(Event.target.value))}
            />
            <small>
              {Number(Resolved.Settings[Field.Key] ?? 0).toFixed(2)} {Field.Unit}
            </small>
          </label>
        ),
      )}
      {Object.keys(Domain.Overrides || {}).length > 0 && (
        <button className="gas-wide-button quiet" onClick={() => Assign("Overrides", {})}>
          Revert {Object.keys(Domain.Overrides).length} override
          {Object.keys(Domain.Overrides).length === 1 ? "" : "s"} to the preset
        </button>
      )}

      <button className="gas-wide-button" onClick={Open}>
        Open FluidEditor · all {85} settings, viewport and flipbook bake ↗
      </button>
      <p className="gas-note">
        Eleven settings here, the rest one button away. Saved with the scene and exported to the engine as
        .gasscene.toml.
      </p>
    </section>
  );
}

// ─── The full editor ───────────────────────────────────────────────────────────────────────────────────────

// Where the Fluid simulator page is served from. It is the same application as Experimental/Fluid — this
//    drawer frames it rather than reimplementing it, which is the only way the two stay the same UI.
export function FluidEditorSource() {
  // The built simulator, because an iframe cannot reach a dev server on another port when the browser is
  //    not on the same machine as the sandbox. `npm run build` in Experimental/Fluid produces it; pointing
  //    window.FrontierFluidEditorUrl at a running `npm run dev` is the other way, and is the one to use
  //    while working on the simulator itself.
  return (
    (typeof window !== "undefined" && window.FrontierFluidEditorUrl) ||
    "../Fluid/dist/index.html"
  );
}

export default function GasEditor({ Subject, Values, Change, Domains, SelectDomain, Rename, Close, Hidden }) {
  const Resolved = ResolveGas(Values),
    Root = useRef(null),
    Frame = useRef(null),
    [Reached, Reach] = useState(false);

  useEffect(() => {
    const Before = document.activeElement;
    Root.current?.querySelector("button")?.focus();
    return () => Before?.isConnected && Before.focus();
  }, []);

  // 📝 THE HANDOFF, AND IT IS ONE SENTENCE IN EACH DIRECTION.
  //    The drawer posts the resolved scene in; the page posts a changed scene back. Nothing else crosses —
  //    no shared store, no imported module — so the simulator can keep being an independent application and
  //    this editor keeps working when it is not being served.
  useEffect(() => {
    const Receive = (Event) => {
      if (Event.data?.Frontier !== "gas-scene-changed" || !Event.data.Settings) return;
      Change("Gas", {
        ...(Values.Gas || {}),
        Overrides: { ...(Values.Gas?.Overrides || {}), ...Event.data.Settings },
      });
    };
    window.addEventListener("message", Receive);
    return () => window.removeEventListener("message", Receive);
  }, [Values, Change]);

  const Hand = () => {
    Reach(true);
    Frame.current?.contentWindow?.postMessage(
      { Frontier: "gas-scene", Name: Subject.Name, Preset: Resolved.Preset, Settings: Resolved.Settings },
      "*",
    );
  };

  const Key = (Event) => {
    if (Event.key === "Escape") {
      Event.stopPropagation();
      Close();
    }
  };

  return (
    <div className="gas-editor-backdrop">
      <section
        className="gas-editor"
        role="dialog"
        aria-modal="true"
        aria-label="FluidEditor"
        ref={Root}
        onKeyDown={Key}
      >
        <header className="gas-editor-header">
          <div>
            <span className="eyebrow">VOLUMETRICS / FULL SIMULATION</span>
            <h1>FluidEditor</h1>
          </div>
          <select
            aria-label="Edited gas domain"
            value={Subject.Id}
            onChange={(Event) => SelectDomain(Event.target.value)}
          >
            {(Domains || []).map((Item) => (
              <option key={Item.Id} value={Item.Id}>
                {Item.Name}
              </option>
            ))}
          </select>
          <label className="gas-name">
            Name
            <input
              aria-label="Gas domain name"
              value={Subject.Name}
              maxLength={80}
              onChange={(Event) => Rename(Event.target.value)}
            />
          </label>
          <button className="gas-close" aria-label="Close FluidEditor" onClick={Close}>
            ×
          </button>
        </header>

        <div className="gas-editor-body">
          <iframe
            ref={Frame}
            className="gas-editor-frame"
            title="Fluid simulator"
            src={FluidEditorSource()}
            onLoad={Hand}
          />
          {!Reached && (
            <div className="gas-editor-absent">
              <h3>The Fluid simulator page is not being served</h3>
              <p>
                This drawer hosts <code>Experimental/Fluid</code> rather than reimplementing it, so the full
                editor here and the standalone one are the same UI by construction. Build it with
                <code> cd Experimental/Fluid &amp;&amp; npm run build</code>, or set
                <code> window.FrontierFluidEditorUrl</code> to a running <code>npm run dev</code>.
              </p>
              <p>
                It carries the preset rail and its four filters, the grouped inspector over all 85 settings,
                the viewport with bounds box and lattice lines, the debug channel selector, and the flipbook
                bake panel. The eleven settings on the card are a subset of that page, not a parallel copy.
              </p>
            </div>
          )}
        </div>

        <footer>
          <span>
            <i className={Hidden ? "red" : "green"} />
            {Hidden ? "Domain hidden · nothing simulates" : GasSummary(Resolved)}
          </span>
          <span>Saved with the scene · crosses to the engine as .gasscene.toml</span>
        </footer>
      </section>
    </div>
  );
}
