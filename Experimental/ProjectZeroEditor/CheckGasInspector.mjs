//============================================================================================================================================
//                                                        CHECKGASINSPECTOR.MJS
//============================================================================================================================================
// 📦 The gas card's arithmetic, its wiring, and its presence in the shipped bundle — without a browser.
//
//    node Experimental/ProjectZeroEditor/CheckGasInspector.mjs
//
// 💡 WHY THIS ONE DOES NOT USE PLAYWRIGHT, WHEN CheckWind.mjs DOES.
//    The wind check drives a real page because what it is checking is a drag interaction on an SVG. What is
//    worth checking here is arithmetic that must agree with a C++ header, and whether the card survived the
//    build — neither needs a browser, and a check that needs one does not run on a machine without one.
//    A playwright pass over the rendered card belongs beside CheckWind.mjs when the card stops moving.
//
// 🔴 THE COST READOUT IS CHECKED AGAINST GasQualityAllowance.h BY READING IT.
//    A number copied from a header into a panel is correct on the day it is copied. These are compared
//    against the header itself, so the panel cannot keep showing 94 MB after the allowance changes.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ExposedGasFields,
  GasBytesPerVoxel,
  GasPresetChoices,
  GasRowSummary,
  GasRunPolicies,
  GasRunning,
  GasSummary,
  GasTiers,
  NewGasDomain,
  ResolveGas,
  SpellBytes,
  TierBytes,
  TierForDistance,
} from "./GasSpecification.js";

const Folder = path.dirname(fileURLToPath(import.meta.url));
const Root = path.resolve(Folder, "../..");
const Read = (Relative) => fs.readFileSync(path.join(Root, Relative), "utf8");

let Checks = 0;
const Check = (Condition, Claim) => {
  Checks++;
  assert.ok(Condition, Claim);
  console.log("  PASS  " + Claim);
};
const Banner = (Title) => console.log("\n" + Title);

console.log("CheckGasInspector — the gas card");

// ─── The ladder, against the header it mirrors ─────────────────────────────────────────────────────────────

Banner("The quality ladder agrees with GasQualityAllowance.h");
{
  const Header = Read("Engine/VolumetricDynamics/GasQualityAllowance.h");

  const Bytes = Number(/GasBytesPerVoxel\s*=\s*(\d+)u/.exec(Header)?.[1]);
  Check(Bytes === GasBytesPerVoxel, `bytes a voxel is ${Bytes} in both the header and the panel`);

  // Each rung's extent and sweeps, read out of the allowance table rather than trusted.
  const Table = /AllowanceFor[\s\S]*?\n}/.exec(Header)?.[0] || "";
  for (const Tier of GasTiers) {
    const Name = Tier.Name;
    const Row = new RegExp(`GasQuality::${Name}:[^;]*?return\\s*\\{\\s*(\\d+)u?\\s*,\\s*(\\d+)u?`, "i").exec(
      Table,
    );
    Check(Boolean(Row), `the header declares an allowance for ${Name}`);
    Check(
      Number(Row[1]) === Tier.Extent,
      `${Name} is ${Tier.Extent}³ in both — a panel showing a lattice the solver will not allocate is decoration`,
    );
    Check(Number(Row[2]) === Tier.Sweeps, `and ${Tier.Sweeps} pressure sweeps in both`);
  }

  // The distance bands, which decide which rung a domain is granted.
  const Bands = /QualityForDistance[\s\S]*?\n}/.exec(Header)?.[0] || "";
  for (const Tier of GasTiers.filter((Entry) => Number.isFinite(Entry.Within)))
    Check(
      Bands.includes(`${Tier.Within}.0f`),
      `the ${Tier.Name} band ends at ${Tier.Within} m in the header as it does in the panel`,
    );

  Check(
    TierForDistance(5).Id === "hero" &&
      TierForDistance(20).Id === "near" &&
      TierForDistance(50).Id === "mid" &&
      TierForDistance(120).Id === "far" &&
      TierForDistance(400).Id === "flipbook",
    "and the panel grants the same rung at 5, 20, 50, 120 and 400 metres",
  );
  Check(TierBytes(GasTiers[4]) === 0, "a flipbook costs no live storage, which is the point of the rung");
  Check(SpellBytes(TierBytes(GasTiers[0])) === "94 MB", "a Hero domain reads as 94 MB");
}

// ─── The run policy ────────────────────────────────────────────────────────────────────────────────────────

Banner("A domain is in the scene whether or not it simulates");
{
  const Dormant = ResolveGas({ Gas: { ...NewGasDomain(), Run: "dormant" } });
  Check(!GasRunning(Dormant, false), "a dormant domain does not simulate");
  Check(GasRunning(Dormant, true), "and does once something fires it");
  Check(
    GasSummary(Dormant).includes("not simulating"),
    "the card says so in words rather than only in a colour",
  );

  const Always = ResolveGas({ Gas: { ...NewGasDomain(), Run: "always" } });
  Check(GasRunning(Always, false), "an always-on domain simulates with nothing firing it");

  const Distant = ResolveGas({ Gas: { ...NewGasDomain(), Run: "proximity", Distance: 400 } });
  Check(
    !GasRunning(Distant, true),
    "a domain past the ladder does not simulate even when fired — beyond 150 m it is a flipbook, and firing a card does nothing",
  );

  const Near = ResolveGas({ Gas: { ...NewGasDomain(), Run: "proximity", Distance: 40 } });
  Check(GasRunning(Near, false), "and inside the ladder proximity alone is enough");

  Check(GasRunPolicies[0].Id === "dormant", "dormant is first, because in a level it is the normal case");
  Check(
    NewGasDomain("camp_fire").Run === "always" && NewGasDomain("ue5_pyro_default").Run === "triggered",
    "a new domain defaults to the policy its preset implies: a fire burns, a detonation waits",
  );
  Check(
    NewGasDomain().Coupled === false,
    "🔴 two-way coupling is off on a new domain, as GasWindContribution.h has it",
  );
}

// ─── Resolution ────────────────────────────────────────────────────────────────────────────────────────────

Banner("Defaults, then preset, then this domain's own differences");
{
  Check(GasPresetChoices.length === 18, "all eighteen presets are offered, read from presets.js rather than listed again");
  Check(
    GasPresetChoices.filter((Entry) => Entry.OneShot).length > 0,
    "and the one-shots are marked, because the policy a user should pick depends on it",
  );

  const Plain = ResolveGas({ Gas: { Preset: "camp_fire" } });
  const Changed = ResolveGas({ Gas: { Preset: "camp_fire", Overrides: { boundsWidth: 7.5 } } });
  Check(Changed.Settings.boundsWidth === 7.5, "an override wins over the preset");
  Check(
    Changed.Settings.buoyancy === Plain.Settings.buoyancy,
    "and changes nothing else, so a domain cannot freeze a preset reading it never touched",
  );
  Check(
    ResolveGas({}).Settings.gridResolution > 0,
    "a domain with no stored settings at all still resolves rather than throwing",
  );

  for (const Field of ExposedGasFields)
    Check(
      Field.Switch || Plain.Settings[Field.Key] !== undefined,
      `the exposed setting ${Field.Key} exists in the simulator's own parameters`,
    );
  Check(
    ExposedGasFields.length === 11,
    "eleven settings are exposed inline; the other seventy-four are one button away",
  );

  Check(
    GasRowSummary({ Gas: { Preset: "camp_fire", Run: "always", Distance: 4 } }).includes("Hero"),
    "the outliner row carries preset, tier and policy in one line, as the wind and fog rows do",
  );
}

// ─── The wiring, and the bundle ────────────────────────────────────────────────────────────────────────────

Banner("Wired into the editor, and present in what ships");
{
  const Editor = Read("Experimental/ProjectZeroEditor/Editor.jsx");
  const Inspectors = Read("Experimental/ProjectZeroEditor/Inspectors.jsx");
  const Panel = Read("Experimental/ProjectZeroEditor/GasPanel.jsx");

  Check(/\[\s*"gas-domain",/.test(Editor), "a gas domain is an outliner row");
  Check(
    /"gas-domain"[\s\S]{0,160}"showcase"/.test(Editor),
    "and it sits in the scene collection rather than under World — it is an object, not a global field",
  );
  Check(Editor.includes("GasRowSummary(Record)"), "the row carries its summary");
  Check(Editor.includes("<GasEditor"), "the full editor is mounted beside WindEditor");
  Check(Editor.includes('aria-label="Expand FluidEditor"'), "and focus returns to the expand button on close");
  Check(Inspectors.includes("<GasInspector"), "the card is rendered for a gas subject");
  Check(Inspectors.includes("OpenGas"), "and its expand button is wired to the drawer");

  Check(
    Panel.includes('data-card="Gas domain"'),
    "the card declares itself the way every other property card does",
  );
  Check(
    Panel.includes("DORMANT · NOT SIMULATING"),
    "🔴 the preview refuses to animate a domain the game would not run",
  );
  Check(
    /iframe/.test(Panel) && Panel.includes("Experimental/Fluid"),
    "the full editor hosts the existing simulator rather than reimplementing it — that is what keeps the two the same UI",
  );

  const Bundle = Read("Experimental/ProjectZeroEditor/index.html");
  Check(Bundle.includes("Gas domain"), "the card survived the build into the standalone bundle");
  Check(Bundle.includes("Expand FluidEditor"), "so did the expand button");
  Check(Bundle.includes("DORMANT"), "and the dormant state");
  for (const Policy of GasRunPolicies)
    Check(Bundle.includes(Policy.Description.slice(0, 40)), `the ${Policy.Name} policy explains itself in the bundle`);
}

console.log(`\nPASS ${Checks}`);
