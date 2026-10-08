//============================================================================================================================================
//                                                           GASSPECIFICATION.JS
//============================================================================================================================================
// 📦 What a gas domain is in a scene, which few of its settings the inspector exposes, and what it costs.
//
// 🔴 A DOMAIN IS IN THE SCENE WHETHER OR NOT IT IS SIMULATING, AND THOSE ARE DIFFERENT QUESTIONS.
//    An outliner row exists from the moment it is added — it has bounds, a preset, a name, a place in the
//    hierarchy, and it draws its box in the viewport. Simulating is a separate state that something has to
//    ask for. A level with forty gas domains in it is ordinary; forty live solvers is not, and the budget
//    ceiling is 12. So every domain carries a Run policy, and the default is Dormant.
//
// 💡 WHY THE POLICY LIVES HERE RATHER THAN IN GAMEPLAY CODE.
//    The native side currently has to *infer* that a scene is a one-shot — "no emitter and a loaded blast"
//    is true of the two burst samples and is still a guess. A policy on the domain ends the guess, and it is
//    the authoring tool's business to state it, not the runtime's to deduce it.
//
// ⚠️ THE EXPOSED SET IS DELIBERATELY SMALL. The full simulation has 85 settings; this exposes eleven. The
//    rest are not hidden, they are one button away in the Fluid Editor — which is the same page the browser
//    simulator already is. An inspector that exposes everything is a worse version of that page docked in a
//    320-pixel column.
//
// Mirrors Engine/VolumetricDynamics/GasQualityAllowance.h. The numbers below are that file's, not new ones:
//    a cost shown here and a cost charged there must be the same number or the readout is decoration.

import { PRESETS, DEFAULT_PARAMS } from "../Fluid/src/presets.js";

// ─── The run policy ────────────────────────────────────────────────────────────────────────────────────────

export const GasRunPolicies = [
  {
    Id: "dormant",
    Name: "Dormant",
    Short: "never until fired",
    Description:
      "Present in the scene and drawing its bounds, simulating nothing. A gameplay event fires it. This is what a fracture burst or a detonation is.",
  },
  {
    Id: "triggered",
    Name: "On trigger",
    Short: "fires, runs, stops",
    Description:
      "Dormant until triggered, then simulates for its lifetime and returns to dormant. The lifetime is what stops a one-shot from becoming a permanent domain.",
  },
  {
    Id: "proximity",
    Name: "On proximity",
    Short: "within range",
    Description:
      "Simulates while the viewer is inside the far band and sleeps beyond it. The budget may still demote it; proximity decides whether it runs, the governor decides how well.",
  },
  {
    Id: "always",
    Name: "Always",
    Short: "persistent",
    Description:
      "A camp fire, a chimney, a vent. Runs whenever the level is loaded, at whatever tier the budget grants.",
  },
];

// ─── The quality ladder, from GasQualityAllowance.h ────────────────────────────────────────────────────────

export const GasBytesPerVoxel = 47;
export const GasMasterHertz = 60;

export const GasTiers = [
  { Id: "hero", Name: "Hero", Extent: 128, Sweeps: 24, StepDivision: 1, Within: 8 },
  { Id: "near", Name: "Near", Extent: 96, Sweeps: 18, StepDivision: 1, Within: 25 },
  { Id: "mid", Name: "Mid", Extent: 64, Sweeps: 12, StepDivision: 2, Within: 60 },
  { Id: "far", Name: "Far", Extent: 32, Sweeps: 8, StepDivision: 4, Within: 150 },
  { Id: "flipbook", Name: "Flipbook", Extent: 0, Sweeps: 0, StepDivision: 0, Within: Infinity },
];

export const GasCeiling = { Bytes: 256 * 1024 * 1024, DomainLimit: 12 };

export function TierForDistance(Distance) {
  return GasTiers.find((Tier) => Distance < Tier.Within) || GasTiers[4];
}

export function TierById(Id) {
  return GasTiers.find((Tier) => Tier.Id === Id) || GasTiers[2];
}

// Live storage for one domain at a tier. Flipbook costs nothing live — it is a texture, shared between every
//    domain using the same preset, which is the whole reason the rung exists.
export function TierBytes(Tier) {
  return Tier.Extent ? Math.pow(Tier.Extent, 3) * GasBytesPerVoxel : 0;
}

export function SpellBytes(Bytes) {
  if (!Bytes) return "0 MB";
  const Mega = Bytes / (1024 * 1024);
  return Mega >= 10 ? `${Math.round(Mega)} MB` : `${Mega.toFixed(1)} MB`;
}

// The sim rate is not the frame rate: a Mid domain steps every second master tick, a Far one every fourth.
export function TierHertz(Tier) {
  return Tier.StepDivision ? GasMasterHertz / Tier.StepDivision : 0;
}

// ─── The domain ────────────────────────────────────────────────────────────────────────────────────────────

export const GasPresetChoices = Object.entries(PRESETS).map(([Id, Entry]) => ({
  Id,
  Name: Entry.name,
  Description: Entry.description,
  OneShot: Boolean(Entry.triggerExplosionOnLoad),
}));

// 📝 Eleven settings, and each one earns its place by being the reason somebody opens this card. Everything
//    else is behind the expand button. `Key` is the browser simulator's own parameter name where one exists,
//    so a value changed here is the same value the Fluid Editor shows — not a parallel copy that drifts.
export const ExposedGasFields = [
  { Key: "boundsWidth", Label: "Bounds width", Unit: "m", Min: 0.5, Max: 12, Step: 0.05, Group: "domain" },
  { Key: "boundsHeight", Label: "Bounds height", Unit: "m", Min: 0.5, Max: 12, Step: 0.05, Group: "domain" },
  { Key: "dynamicBounds", Label: "Dynamic bounds", Group: "domain", Switch: true },
  { Key: "emitterRate", Label: "Emission rate", Unit: "×", Min: 0, Max: 3, Step: 0.05, Group: "source" },
  { Key: "emitterSmoke", Label: "Smoke", Unit: "", Min: 0, Max: 8, Step: 0.1, Group: "source" },
  { Key: "emitterTemperature", Label: "Temperature", Unit: "K", Min: 0, Max: 12, Step: 0.1, Group: "source" },
  { Key: "buoyancy", Label: "Buoyancy", Unit: "m/s²", Min: -4, Max: 16, Step: 0.1, Group: "source" },
  { Key: "densityExtinction", Label: "Density", Unit: "1/m", Min: 0, Max: 60, Step: 0.5, Group: "look" },
  { Key: "smokeAlbedo", Label: "Albedo", Unit: "", Min: 0, Max: 1, Step: 0.01, Group: "look" },
  { Key: "fireIntensity", Label: "Fire", Unit: "×", Min: 0, Max: 20, Step: 0.1, Group: "look" },
  { Key: "exposure", Label: "Exposure", Unit: "×", Min: 0.1, Max: 4, Step: 0.05, Group: "look" },
];

export const GasFieldGroups = [
  { Id: "domain", Name: "Domain" },
  { Id: "source", Name: "Source" },
  { Id: "look", Name: "Look" },
];

export function NewGasDomain(Preset = "camp_fire") {
  const Entry = PRESETS[Preset];
  return {
    Preset,
    Run: Entry?.triggerExplosionOnLoad ? "triggered" : "always",
    Lifetime: 4,
    QualityPin: "auto",
    Distance: 12,
    Obstructs: true,
    // 🔴 Two-way stays off until something turns it on, per object, exactly as GasWindContribution.h has it.
    //    A default-on coupling is a vehicle being shoved by its own exhaust.
    Coupled: false,
    Overrides: {},
  };
}

// Defaults → preset → the few things this domain overrides. The same three-step resolution the sample scenes
//    use, and for the same reason: a domain must not freeze a default that later changes.
export function ResolveGas(Values = {}) {
  const Domain = { ...NewGasDomain(), ...(Values.Gas || {}) };
  const Preset = PRESETS[Domain.Preset] || PRESETS.camp_fire;
  const Settings = { ...DEFAULT_PARAMS, ...(Preset?.params || {}), ...(Domain.Overrides || {}) };
  const Policy = GasRunPolicies.find((Entry) => Entry.Id === Domain.Run) || GasRunPolicies[0];
  const Tier =
    Domain.QualityPin === "auto" ? TierForDistance(Domain.Distance) : TierById(Domain.QualityPin);
  return {
    ...Domain,
    PresetName: Preset?.name || Domain.Preset,
    OneShot: Boolean(Preset?.triggerExplosionOnLoad),
    Settings,
    Policy,
    Tier,
    Bytes: TierBytes(Tier),
    Hertz: TierHertz(Tier),
  };
}

// Is it simulating *right now*, in the editor's sense? The editor has no gameplay, so a dormant domain is
//    shown dormant rather than being quietly run for the preview — showing a plume where the game will show
//    nothing is the single most misleading thing this card could do.
export function GasRunning(Resolved, Fired = false) {
  if (Resolved.Tier.Id === "flipbook") return false;
  if (Resolved.Policy.Id === "always") return true;
  if (Resolved.Policy.Id === "proximity") return Resolved.Distance < 150;
  return Fired;
}

// What the card says under the readout. One sentence, and it must be true of the game and not of the editor.
export function GasSummary(Resolved) {
  if (Resolved.Tier.Id === "flipbook")
    return "Beyond the live ladder · drawn as a flipbook card, no solver";
  if (Resolved.Policy.Id === "dormant") return "In the scene, not simulating · waits to be fired";
  if (Resolved.Policy.Id === "triggered")
    return `Fires on trigger · runs ${Resolved.Lifetime.toFixed(1)} s, then sleeps`;
  if (Resolved.Policy.Id === "proximity")
    return `Simulates inside 150 m · ${Resolved.Tier.Name} at ${Math.round(Resolved.Distance)} m`;
  return `Always on · ${Resolved.Tier.Name} tier at ${Resolved.Hertz} Hz`;
}

// A compact line for the outliner row, in the same shape as the wind and fog rows beside it.
export function GasRowSummary(Values = {}) {
  const Resolved = ResolveGas(Values);
  return `${Resolved.PresetName.split(" ")[0]} · ${Resolved.Tier.Name} · ${Resolved.Policy.Name.toLowerCase()}`;
}
