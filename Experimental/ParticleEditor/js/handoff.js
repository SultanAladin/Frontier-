// Scene handoff for the Particle Editor: the one sentence in each direction that lets a host editor open
// this page for an emitter and get the authored system back.
//
// 🔴 WHY THIS EXISTS. As merged, the Particle Editor had no persistence of any kind — no save, no load, no
//    export. Fifty-two presets can be tuned in it and nothing can leave. That is survivable for a
//    standalone toy and fatal for an editor the gas emitter card opens, so this adds the smallest thing
//    that makes the trip possible: postMessage in, postMessage out, in the same shape GasPanel.jsx already
//    speaks to the Fluid simulator ("gas-scene" / "gas-scene-changed").
//
// ⚠️ KNOWN COMPROMISE. app.js has no single commit point for a parameter change: every inspector row
//    writes straight into sys.p from its own closure. There is therefore nothing to subscribe to, and this
//    diffs a snapshot on an interval instead. The right fix is a setParam(sys, key, value) funnel that the
//    rows call and this listens to; until that lands, a change is seen within one poll rather than at once.
(function () {
  "use strict";
  const PE = (window.PE = window.PE || {});

  const POLL_MS = 500;   // [ms] how long a change can sit before the host hears about it

  // Values a host is allowed to set. Anything else in an arriving message is ignored rather than merged:
  //    a message is untrusted input, and Object.assign over sys.p would let a sender invent fields that
  //    the uniform packer then reads as NaN.
  function Writable(p) {
    const Out = {};
    for (const [Key, Value] of Object.entries(p)) {
      if (typeof Value === "number" || typeof Value === "boolean" || typeof Value === "string") Out[Key] = Value;
      else if (Array.isArray(Value) && Value.every((One) => typeof One === "number")) Out[Key] = Value.slice();
    }
    return Out;
  }

  // 📦 What this page would tell a host about the system it is editing.
  //    Returns null when nothing is selected, which a caller must treat as "say nothing", not as "empty".
  function Describe(state) {
    if (!state || state.selection?.type !== "system") return null;
    const sys = (state.systems || []).find((One) => One.id === state.selection.id);
    if (!sys) return null;
    return {
      Frontier: "particle-system-changed",
      Preset: sys.presetId,
      Name: sys.name,
      Settings: Writable(sys.p),
    };
  }

  // 📦 Apply a host's message to a system's parameters.
  //    in    p         the system's live parameters, written in place
  //    in    Settings  an arriving object, untrusted
  //    out   number    how many fields were taken; a field of the wrong shape is skipped, not coerced
  function Admit(p, Settings) {
    if (!p || !Settings || typeof Settings !== "object") return 0;
    let Taken = 0;
    for (const [Key, Value] of Object.entries(Settings)) {
      if (!Object.hasOwn(p, Key)) continue;                       // no inventing fields
      const Was = p[Key];
      if (Array.isArray(Was)) {
        if (!Array.isArray(Value) || Value.length !== Was.length) continue;
        if (!Value.every((One) => Number.isFinite(One))) continue;
        p[Key] = Value.slice();
      } else if (typeof Was === "number") {
        if (!Number.isFinite(Value)) continue;
        p[Key] = Value;
      } else if (typeof Was === "boolean") {
        if (typeof Value !== "boolean") continue;
        p[Key] = Value;
      } else if (typeof Was === "string") {
        if (typeof Value !== "string") continue;
        p[Key] = Value;
      } else continue;
      Taken++;
    }
    return Taken;
  }

  // Two descriptions are the same scene when their preset, name and every setting agree.
  function Same(A, B) {
    return A === B || (!!A && !!B && JSON.stringify(A) === JSON.stringify(B));
  }

  // 📦 Wire the page to whatever window opened it.
  //    in    state    the application state
  //    in    Host     { Open(presetId, name), Rebuild(sys), Refresh() } — app.js's own verbs
  function Install(state, Host) {
    if (typeof window === "undefined" || !window.parent || window.parent === window) return () => {};
    let Last = null;

    const Receive = (Event) => {
      const Message = Event.data;
      if (!Message || Message.Frontier !== "particle-system") return;
      const sys = Host.Open(Message.Preset, Message.Name);
      if (!sys) return;
      if (Admit(sys.p, Message.Settings) > 0) Host.Rebuild(sys);
      Host.Refresh();
      Last = Describe(state);
    };
    window.addEventListener("message", Receive);

    const Poll = window.setInterval(() => {
      const Now = Describe(state);
      if (!Now || Same(Now, Last)) return;
      Last = Now;
      window.parent.postMessage(Now, "*");
    }, POLL_MS);

    window.parent.postMessage({ Frontier: "particle-editor-ready" }, "*");
    return () => { window.removeEventListener("message", Receive); window.clearInterval(Poll); };
  }

  PE.Handoff = { Describe, Admit, Writable, Same, Install, POLL_MS };
})();
