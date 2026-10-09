// Checks the Particle Editor's scene handoff — the only part of the page a host depends on.
//
//     node Experimental/ParticleEditor/CheckHandoff.mjs
//
// The page is three IIFEs over a window global rather than modules, so this builds the smallest window
// they need and evaluates handoff.js into it. That is uglier than an import and it is the honest cost of
// the file not being a module; it is recorded in Docs/ParticleEditor.md as the thing to fix.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const Here = dirname(fileURLToPath(import.meta.url));

let Checks = 0;
function Check(Condition, Claim) {
  Checks++;
  if (!Condition) {
    console.error("  FAIL  " + Claim);
    process.exit(1);
  }
  console.log("  PASS  " + Claim);
}
function Banner(Title) {
  console.log("\n" + Title);
}

// ── Load handoff.js into a window of our own ────────────────────────────────────────────────────────
const Posted = [];
const Listeners = [];
const Window = {
  addEventListener: (Kind, Handler) => Kind === "message" && Listeners.push(Handler),
  removeEventListener: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  parent: null,
};
Window.window = Window;
const Sandbox = vm.createContext({ window: Window, JSON, Object, Array, Number });
vm.runInContext(readFileSync(join(Here, "js/handoff.js"), "utf8"), Sandbox);
const Handoff = Window.PE.Handoff;

Banner("Describing what is selected");
{
  const State = {
    selection: { type: "system", id: 2 },
    systems: [
      { id: 1, presetId: "sparks", name: "Sparks", p: { rate: 100 } },
      { id: 2, presetId: "embers", name: "Hearth embers", p: { rate: 40, origin: [0, 1, 0], loop: true, blend: "add" } },
    ],
  };
  const Said = Handoff.Describe(State);
  Check(Said.Frontier === "particle-system-changed", "a description is tagged the way GasPanel.jsx tags its own");
  Check(Said.Preset === "embers" && Said.Name === "Hearth embers",
        "and it names the preset and the system that is actually selected, not the first one");
  Check(Said.Settings.rate === 40 && Said.Settings.loop === true && Said.Settings.blend === "add",
        "numbers, booleans and strings all cross");
  Check(Array.isArray(Said.Settings.origin) && Said.Settings.origin !== State.systems[1].p.origin,
        "an array crosses as a copy, so the host cannot reach back into the page's live parameters");

  Check(Handoff.Describe({ selection: { type: "wind" }, systems: [] }) === null,
        "with the wind selected there is no system to describe, and it says null rather than inventing one");
  Check(Handoff.Describe({ selection: { type: "system", id: 9 }, systems: [] }) === null,
        "and a selection pointing at a system that is gone describes nothing");
}

Banner("Admitting what a host sends");
{
  const Parameters = { rate: 40, origin: [0, 1, 0], loop: true, blend: "add", capacity: 1024 };
  const Taken = Handoff.Admit(Parameters, { rate: 90, origin: [1, 2, 3], loop: false });
  Check(Taken === 3, "three known fields are taken");
  Check(Parameters.rate === 90 && Parameters.loop === false, "and written in place");
  Check(Parameters.origin[0] === 1 && Parameters.origin[2] === 3, "including the vector");

  Check(Handoff.Admit(Parameters, { nothingAtAll: 5 }) === 0,
        "a field the system does not have is ignored -- a message is untrusted input, not a merge source");
  Check(Parameters.nothingAtAll === undefined, "and it is not added either");
  Check(Handoff.Admit(Parameters, { rate: "fast" }) === 0 && Parameters.rate === 90,
        "a number sent as a string is refused rather than coerced to NaN by the uniform packer");
  Check(Handoff.Admit(Parameters, { rate: Number.NaN }) === 0 && Parameters.rate === 90,
        "and so is a NaN, which is the one value that would silently blank a whole draw");
  Check(Handoff.Admit(Parameters, { origin: [1, 2] }) === 0,
        "a vector of the wrong length is refused; a three-component origin is not two");
  Check(Handoff.Admit(Parameters, { loop: 1 }) === 0,
        "and a boolean sent as 1 is refused, because 1 is not false and guessing which was meant is worse");
  Check(Handoff.Admit(null, { rate: 1 }) === 0 && Handoff.Admit({}, null) === 0,
        "neither side being absent throws");
}

Banner("Only plain values cross");
{
  const Out = Handoff.Writable({ rate: 1, name: "x", on: true, origin: [1, 2, 3], gpu: { buffer: 1 },
                                 tick: () => 0, stops: [{ col: [1, 1, 1] }] });
  Check(Out.rate === 1 && Out.name === "x" && Out.on === true, "scalars cross");
  Check(Array.isArray(Out.origin), "and numeric vectors");
  Check(Out.gpu === undefined && Out.tick === undefined,
        "a GPU handle and a function do not -- postMessage would throw on the function and clone "
        + "nonsense out of the handle");
  Check(Out.stops === undefined,
        "and neither does an array of objects, which is the one case where a shallow copy would have "
        + "aliased the page's own state into the message");
}

Banner("Noticing a change");
{
  const A = { Frontier: "particle-system-changed", Preset: "p", Name: "n", Settings: { rate: 1 } };
  const B = { Frontier: "particle-system-changed", Preset: "p", Name: "n", Settings: { rate: 1 } };
  const C = { Frontier: "particle-system-changed", Preset: "p", Name: "n", Settings: { rate: 2 } };
  Check(Handoff.Same(A, B), "two identical descriptions are the same scene");
  Check(!Handoff.Same(A, C), "one moved slider is not");
  Check(Handoff.Same(null, null) && !Handoff.Same(A, null), "and null is only the same as null");
}

Banner("Standing alone");
{
  Window.parent = Window;   // not framed
  const Stop = Handoff.Install({ selection: { type: "wind" }, systems: [] }, {});
  Check(typeof Stop === "function" && Listeners.length === 0,
        "with no host above it the page installs nothing at all -- no listener, no interval, no posting "
        + "into its own window");
}

console.log("\nPASS " + Checks);
