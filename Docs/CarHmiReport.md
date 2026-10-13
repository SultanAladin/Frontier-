# Car HMI & interior displays — report

Written 2026-10-13. Context: the driving vehicle is complete on
`arena/215a6f39-frontier` (Pacejka drivetrain, XPBD soft tyres, suspension,
adaptive aero, thermals, drift smoke). This report is the first interior task:
the HMI and the car's interior HUDs/dashboards. Standing rule applies — **a UI
is designed where it can be looked at before it is ported**, so the HTML
prototype comes first (§10) and the C++ port follows it (§9).

Branch note: this report and the prototype live on `arena/331f5180-frontier`
(this session's branch, cut from an older `main`). The vehicle, SpatialHud and
ParticleEditor code it references live on `arena/215a6f39-frontier`, which was
fetched and reviewed for this report. Merging forward is the owner's click.

---

## 1. The texture debate, settled

The argument so far: one side says render the screens in the same scene in one
draw call (the SpatialHud position); you say the screens must be **flat like a
tablet**, i.e. each its own texture, the UI itself its own world.

**You are right for the HMI — and the repo already proved it**, in
`Docs/SpatialHud.md` on `arena/215a6f39-frontier`:

1. That doc states an offscreen target "earns its cost for exactly three
   things": **bloom**, **a camera of its own**, or **a resolution and refresh
   rate decoupled from the panel's**.
2. The tablet then grew all three anyway: it renders into its own `1440×845
   rgba16f` display target through an **off-axis projection** (apex at the real
   eye, near plane = the panel rectangle), and the glass **samples** that
   texture with real refraction (2.4 mm cover, −7.8 px shift at 60°), a true
   Fresnel split (`transmitted × (1−F) + reflected × F`), and bloom added
   *inside* the glass.

So the "one draw, same scene" claim already has a documented exception, and the
car HMI triggers **all three** of its conditions at once:

| Condition | Tablet | Cluster | Preview |
|---|---|---|---|
| Own camera | touch UI plane | gauge plane | turntable studio camera — impossible in-scene |
| Own lighting/background | wallpaper/particles | dark binnacle | studio key/fill/rim, independent of the level's sun |
| Own resolution/rate | 1440×845 @ on-demand/30 Hz | ~1024×512 @ 30 Hz | ~720p @ 15–20 Hz |

Three more reasons, specific to a phone-like HMI rather than a gauge panel:

- **Text density.** SpatialHud draws one SDF figure per glyph. A contacts list,
  a message thread, or a settings page is hundreds of figures that re-layout on
  every scroll — the retained-graph advantage (mutate one float, nothing
  re-tessellates) inverts: *everything* re-lays-out. A texture UI rasterises
  text once per change.
- **Touch UI is 2D-immediate, not 3D-retained.** Buttons, sliders, sheets,
  keyboards, scroll physics — the engine already has this vocabulary in
  `ControlKit`/`PixelSpace` (immediate-mode 2D) plus `FontCodec`,
  `TypefaceRegistry`, `GlyphSpace` and the ThorVG audit. Porting *that* into an
  offscreen target is weeks; re-inventing it as SDF figures is months, and the
  result still wouldn't scroll like a phone.
- **Glass needs a texture to be glass.** The SpatialHud finding stands:
  additive compositing can only add — it can't refract, dim, or Fresnel-split
  what's underneath. Every HMI sits behind glass or a gloss cover.

**Decision: every HMI is a texture. The UI is its own world.** The one-draw
SDF path keeps exactly one job — world-anchored 3D HUD (§3).

---

## 2. How many HMIs, and what each one is

At most 4–5. Proposed set, in build order:

| # | HMI | Where | Texture? | Touch? | Content | Rate |
|---|---|---|---|---|---|---|
| 1 | **Centre tablet** (main console) | console, portrait or landscape ~10–12″ | yes, 1440×845-class | **yes** — primary touch surface | vehicle tune + data, car preview, messaging, contacts, lobby/match, account, settings | on-demand + 30 Hz while animated |
| 2 | **Instrument cluster** | behind the wheel | yes, ~1024×512 | no | dual gauge (tach + speed), gear, shift lights, telltales, trip/odo, warnings | **30 Hz** while driving, lower when parked |
| 3 | **Windshield HUD** | projected / combiner | **no — stays SpatialHud SDF**, same-scene 1 draw | no | speed, nav arrow, warnings — world-anchored, always facing the eye | every frame (it's one draw) |
| 4 | Passenger display | dash, passenger side | yes, small | yes | media + nav subset, mirrors tablet pages | on-demand (later) |
| 5 | Wheel strip / mirror | wheel spoke / mirror glass | tiny texture *or* SDF lamps | no | mode, shift flash, indicators | on change (later) |

Build 1 + 2 now; 3 is SpatialHud repurposed (its "different purpose"); 4 + 5
are the same pipeline with smaller targets, explicitly later.

Uniform rule: **all texture HMIs share one pipeline**; a 2D-only HMI is just an
HMI world with no 3D viewport in it. Nothing branches on "is this 2D or 3D"
except whether a viewport exists.

---

## 3. What SpatialHud becomes

SpatialHud (`Experimental/SpatialHud`) stays, with a narrower job: **things
that live in the world, not on a screen.** World-anchored speed readout,
navigation arrows pinned to the road, floating labels over cars/waypoints,
interaction prompts. That is the workload the SDF one-draw architecture is
genuinely best at: a few dozen figures, mutated per frame, no text walls, no
touch, no own-camera, no own-rate.

What moves *off* SpatialHud: the tablet fascia composition (`layout.js`'s
bands), the streak-field backdrop category, and the chassis/glass sampling —
they become the HMI prototype's starting point (§10), not the HUD's.

---

## 4. HMI world architecture (the C++ target)

One `HmiWorld` per texture screen. Each world owns:

```
HmiWorld[n]
├── Scene          — 2D UI layer (full-screen) + zero or more 3D viewports (rects)
├── Camera(s)      — orthographic UI camera + one perspective camera per 3D viewport
├── Lighting       — UI theme light + per-viewport studio rig (key/fill/rim + backdrop)
├── Target         — RGBA16F render target, fixed size, own refresh policy
├── Touch router   — UV → px → gesture pipeline (tap, long-press, drag, swipe, pinch)
└── Refresh policy — continuous-Hz | on-demand | dirty-region
```

### 4.1 Rendering

- The 2D layer renders first (full target). Each 3D viewport renders into its
  rect (scissor), at its own rate, with its own clear colour/backdrop — the
  tablet's car preview is exactly this: a studio scene that never sees the
  level's sun, fog, or post chain.
- Glass compositing reuses the proven SpatialHud treatment: the interior mesh
  samples the HMI target with a refraction offset, Fresnel split, and
  in-glass bloom. No new material science; port `display.js`'s math.
- Targets are fixed-size (tablet 1440×845-class, cluster ~1024×512, preview
  sub-rect ~640×400 inside the tablet target or its own target composited in).
  Fixed pixels = the UI lays out once, and touch math is a stable mapping.
- RGBA16F, not 8-bit: emissive UI + bright-pass bloom need values above 1.0 to
  survive the trip (SpatialHud measured this).

### 4.2 Refresh rates (per-HMI, decoupled — the whole point)

| HMI / layer | Policy | Notes |
|---|---|---|
| Cluster gauges | **30 Hz continuous while driving**, 1–5 Hz parked | needles/numbers only; telltales on change |
| Tablet 2D layer | **on-demand + 30 Hz while animating** (scrolls, sheets, boot) | static page = zero redraws; touch wakes it |
| Tablet preview viewport | 15–20 Hz, pauses when page hidden | turntable + studio light; cheapest 3D in the car |
| Tablet particle layer (boot/wallpaper) | 30 Hz while visible, off otherwise | §7 |
| Passenger / wheel strip | on change | later |

The physics runs at 240 Hz substeps; the HMI *reads* vehicle state through a
snapshot (speed, rpm, gear, temps, pressures, damper travels, wing angle…),
never the live solver structs. A torn read across a gauge redraw is a flicker;
a torn read inside the solver is a crash. Snapshot per HMI tick.

### 4.3 Touch: behaves like Android/iPhone

Input path: pointer ray → screen-quad intersect → UV → HMI-local px → touch
router. The router speaks phone, not mouse:

- **Tap, long-press** (context menus, ~500 ms), **drag** (sliders, scrub),
  **swipe** (pages, dismiss sheets, notification shade), **pinch** (preview
  zoom), multi-touch slots (pinch needs two; max 2–5 tracks per HMI).
- No hover states as primary affordance (a finger has no hover); pressed +
  selected + focus states only. Mouse/driving-rig cursor is a *second* pointer
  that maps to single-touch + hover — touch-first, cursor-compatible.
- Scroll physics: fling with friction, edge overscroll glow (not bounce —
  overscroll is cheaper to port and reads the same), nested scroll (list inside
  a sheet) with the standard child-first-then-parent handoff.
- System gestures: swipe-from-edge = back, swipe-down-from-status = quick
  settings shade, home bar = home. Exactly the phone contract, so no tutorial.
- Keyboard: one on-screen keyboard, owned by the tablet HMI world, summoned by
  any text field (messages, contacts search, lobby note). The C++ side already
  has `TextEntryState` — the missing piece is the key *layout*, not the state
  machine.

Hit-testing is in HMI-local px against the 2D layout tree — **not** the 3D
pointer projection (`InterfacePointerProjection` answers "which SDF figure";
the HMI answers "which widget at this px"). The only 3D math is ray→UV on the
screen quad, which is one ray-plane intersection per touch.

### 4.4 Why "own world" also fixes the preview-background problem

The tablet's car preview needs "its own background lighting" — a studio that
doesn't change when the car drives from noon into a tunnel. Because each 3D
viewport has its own camera + lights + clear/backdrop and renders into a rect
of the HMI target, the preview is *by construction* isolated from the level.
Same mechanism serves a future paint-booth, damage inspector, or photo mode:
new viewport, same pipeline.

---

## 5. Tablet content map (first HMI)

Phone contract: status bar (time, signal, fuel/battery, tyre-temp dot), app
grid home, bottom dock, swipe pages, modal sheets for tuning, toasts for
confirmations. Two halves: **Car** and **Online**.

### 5.1 Car — controls (each row binds to a real vehicle parameter)

All names/ranges below are the actual `arena/215a6f39-frontier` tunables, so
the prototype's sliders are already specified:

**Steering** (`InputConfiguration` in `DriverInputIntegrator.h`)
- Steering sensitivity (scales resolved steer; note: this shapes the *stick/
  key* response — mouse-look sensitivity is a separate camera knob, keep them
  on different rows so nobody tunes the wrong one)
- Steering linearity (exponent, >1 = finer near centre)
- Steering dead zone (analog band around centre)
- Wheel rotation range (900° default; racing-wheel mapping)
- Steer ramp / return rates (keyboard feel: build 3.5/s, centre 5.0/s)
- Force-feedback strength (surfaced for the FFB driver)

**Suspension** (`SuspensionSpecification` + `AntiRollBar`, per axle F/R)
- Natural frequency, F/R (2.0 Hz default — *the* ride knob; rate derives)
- Damping ratio, F/R (0.6 default)
- Ride height: static preload/compression + bump (2 cm) / droop (8 cm) envelope
  display; the honest UI shows frequency + sag + travel bars, not a fake
  "height mm" slider that fights the solver
- Spring curve (Linear / Progressive / Digressive) + hardening factor (1.5)
- Anti-roll bar stiffness, F/R (80 kN/m) + enable
- Live readouts: per-corner compression, damper velocity (from the snapshot)

**Aero** (`Aerodynamics.h` — GT3 adaptive kit)
- Rear wing angle (live 4–22°, default 14°) + adaptive enable + speed
  threshold (35 m/s) + brake-deploy extra angle (10° air-brake)
- Splitter / canards / skirts / diffuser: enable + live downforce split F/R
- DRS-style presets: Corner / Straight / Air-brake test button
- Live readouts: total downforce, drag, F/R split, current wing angle

**Powertrain & brakes** (`Drivetrain.h`, `BrakingSystem.h`)
- Upshift / downshift RPM (6800 / 2600), shift cooldown (0.35 s)
- Induction + diff mode display (Open / Locked / LSD / Torque-vectoring)
- ABS enable + slip target (0.12) + min speed; brake bias if/when it exists
- Live: rpm, gear, boost, oil/coolant if modelled, brake temps, pad wear later

**Tyres** (`XPBDSoftTyre`, `PacejkaMagicFormula`, `ThermalIntegrator`)
- Per-corner: pressure (when modelled), carcass temp, tread temp, wear, slip
  ratio/lateral readouts — the thermal coupling (`7fa53e5`) already feeds this
- Slip-solver + Pacejka preset display (not user-tuned at first; read-only)

**Data** (telemetry page): speed, rpm, gear, throttle/brake traces, G-G
diagram, lap timer later. Reads the same snapshot as the cluster.

### 5.2 Car — preview

A 3D viewport (studio backdrop + key/fill/rim + turntable camera, 15–20 Hz)
showing the `ControlVehicle` PROTO-X mesh (wheelbase 3.396 m, track 2.095 m —
`VehicleGeometry.h`). Interactions: drag to orbit, pinch to zoom, paint/wheel
options later. Pauses when its page is not visible. This is the viewport that
proves the "own background lighting" requirement.

### 5.3 Online — messaging, contacts, lobby/match, account

Mirrors the proven EOS structure (`Docs/NetworkingLobbyPlan.md`: lobby object
+ *separate* match session + RTC voice + browsers + history) without exposing
EOS vocabulary to the driver:

- **Messages** — threads + chat input (summons the on-screen keyboard); lobby
  chat and DMs share the thread UI, different badges.
- **Contacts** — friends list, presence (online / in-lobby / in-race), invite
  to lobby, block/mute. Presence maps to the lobby member attributes the plan
  already publishes (readiness etc.).
- **Lobby + match settings** — see §6 for the name. Contains: current lobby
  (player cards, readiness, voice strip), match setup (map/mode/region, max
  players, permissions, join-in-progress), browser (filter + join-by-list/ID),
  history. This is the `Lobby / Browse / Settings / History` tab set from the
  networking plan, restyled as car UI.
- **Account & settings** — profile, login state, auto-login toggle, language
  (EN + ZH switchable live, per the plan), audio (voice mute, mic), graphics
  (HMI brightness, cluster units km/h–mph), storage scope. Never shows tokens.

### 5.4 What the tablet looks like

The two references supplied (modern EV tablet + cluster aesthetic — dark glass,
cyan/amber accents on near-black, card rows, bottom dock) map directly onto
the SpatialHud palette habit (`Slot.Accent` cyan, `Slot.Caution` amber,
near-black card): keep that palette as the HMI theme so the prototype, the
cluster, and the HUD read as one car. Exact theme tokens get pinned in the
prototype (§10), not here.

---

## 6. The "Session" name — decided: keep it

"Session" is the worst available name *inside this codebase*: the networking
plan already distinguishes the **lobby object** from the **match session
object**, so a tab called "Session" is ambiguous between the two things it
contains. Candidates, car-flavoured:

| Name | Reads as | Verdict |
|---|---|---|
| **Paddock** | motorsport team area + race control; naturally holds lobby *and* race setup | was recommended — **rejected by owner 2026-10-13** |
| Convoy | driving together; weak for match settings/screens | rejected |
| Grid | the start grid; race-only, says nothing about the lobby | rejected |
| Race Control | authoritative; cold, and clashes with "Controls" (car) | rejected |
| Meetup | casual; undersells ranked/match machinery | rejected |
| **Session** | the current name; ambiguous lobby-vs-match in code, familiar in UI | **kept by owner 2026-10-13** |

**Decision: Session.** Tabs inside: `Session / Browse / Setup / History` —
the networking plan's four tabs, renamed, same contents. The code keeps the
lobby-object vs match-session distinction internally; only the tab title says
"Session". To limit the ambiguity damage, the UI copy inside the tab always
says which object an action touches ("Leave lobby" vs "End match session",
never "Leave session").

---

## 7. Boot sequence (with particles)

The tablet and cluster boot; the HUD wakes with the car. Staged state machine,
owned by each HMI world (tablet ~4 s, cluster ~2.5 s, skippable by touch after
the logo):

| T | Stage | What's on screen |
|---|---|---|
| 0.0 s | Power | black glass, faint backlight ramp |
| 0.0–1.2 s | Stardust | particle field condenses (see below) |
| 0.8–2.0 s | Lines sweep | light streaks draw the layout grid / logo lines |
| 1.8–2.6 s | Logo | wordmark resolves, version + VIN line |
| 2.4–3.2 s | Systems | telltales self-test (cluster), module checklist (tablet) |
| 3.0–4.0 s | Settle | crossfade to home / gauges, haptic tick |

Particles come from the existing VFX work, not new tech:

- **Lines**: `Experimental/ParticleEditor`'s **Light streaks** preset
  (`light-streaks`, group *Light fibres*) — analytic Bézier fibres
  (`fibres.js`: `shape: streak`, `spread`/`amplitude`/`intensity` params),
  already proven behind the SpatialHud tablet at panel scale.
- **Stardust**: the *Pollen & dust motes* / *Sparks* presets reduced to a few
  hundred GPU points with slow drift + twinkle — same buffer shape, calmer
  parameters. No new emitter code; a boot parameter set over existing systems.
- The boot layer is just another layer in the HMI world at 30 Hz, destroyed
  (not hidden) after settle so it costs nothing while driving.

The cluster boot is the same machine with fewer stages (backlight → sweep test
→ gauges); the famous needle sweep is one animated value, free.

---

## 8. C++ port shape (after the prototype)

New engine module following repo naming habits (role suffixes already in use:
`Structure`, `Sequence`, `Exchange`, `Projection`, `Codec`):

```
Engine/HmiDisplay/
├── HmiWorldStructure.{h,cpp}    — retained per-HMI scene: 2D tree + viewport rects + theme
├── HmiRenderSequence.{h,cpp}    — per-HMI tick: snapshot → layout → 2D record → viewports → target
├── HmiTouchProjection.{h,cpp}   — ray→UV→px + gesture recogniser (tap/long/drag/swipe/pinch)
├── HmiTextureExchange.{h,cpp}   — target pool (RGBA16F), refresh policies, glass sampling bind
└── HmiBootSequence.{h,cpp}      — staged boot state machine + particle-layer lifetime
```

- 2D recording reuses `ControlKit`/`PixelSpace` retargeted at an offscreen
  target (today they composite onto the swapchain; the seam is already
  pixels-and-colours, §`PixelSpace.h`), text via `TypefaceRegistry`/`FontCodec`
  (+ ThorVG where the audit landed it).
- 3D viewports reuse the existing raster path at reduced size with per-viewport
  camera/lights/clear — no new renderer, just new view setup.
- Glass sampling ports `Experimental/SpatialHud/js/display.js` math
  (off-axis projection, refraction offset, Fresnel split, in-glass bloom).
- Vehicle snapshot struct feeds both the tablet data pages and the 30 Hz
  cluster from one copy per HMI tick.
- Checks follow the `CheckHud.mjs` habit: pin the aperture clip site, the
  off-axis mapping to float precision, the touch UV mapping at corners/edges,
  and the refresh policies (parked cluster ≤5 Hz, hidden preview = 0 draws).

Rough order: tablet 2D + touch → cluster gauges → preview viewport → boot →
passenger/wheel later.

---

## 9. Prototype plan (HTML first)

Per the standing rule, nothing above is ported until it has been looked at.
`Experimental/CarHmi/` on this branch, served by `Tools/Build/ServeExperiments.py`
(same versioned-module + MIME discipline as SpatialHud — never plain
`http.server`):

```
Experimental/CarHmi/
├── index.html            — tablet shell: status bar, app grid, dock, shade, keyboard
├── cluster.html          — dual-gauge cluster + telltales (30 fps rAF throttle demo)
├── boot.html             — boot timeline with streaks + stardust (shared layer)
├── css/                  — theme tokens (the cyan/amber/near-black contract)
├── js/
│   ├── theme.js          — palette, type scale, radii, motion curve (→ C++ theme)
│   ├── touch.js          — gesture recogniser over Pointer Events (→ HmiTouchProjection)
│   ├── pages-vehicle.js  — Steering/Suspension/Aero/Powertrain/Tyres/Data pages + bindings table
│   ├── pages-online.js   — Messages/Contacts/Paddock/Account pages (mock data, real layout)
│   ├── preview.js        — canvas/WebGL turntable car + studio light (→ 3D viewport)
│   ├── particles.js      — boot streaks + stardust (parameters from ParticleEditor presets)
│   └── snapshot.js       — fake vehicle snapshot @ rates (→ C++ snapshot struct)
└── Checks.mjs            — layout/token/gesture pins (the CheckHud habit, DOM edition)
```

Deliberately **DOM + Canvas**, not WebGPU/SDF: the tablet is a phone UI, and
the prototype must iterate on *layout, copy, touch feel, and information
density* — all of which are days in DOM and weeks in a shader. The WebGPU
fidelity questions (glass, off-axis, bloom) are already answered by SpatialHud
and don't need re-proving. What the prototype pins instead: the theme tokens,
the page map, the control bindings (§5.1), the gesture set (§4.3), and the boot
timeline (§7) — each with a named C++ landing spot, so the port is transcription.

---

## 10. Decisions — resolved 2026-10-13

1. **Prototype scope**: ~~tablet only first, or tablet + cluster side by side?~~
   → **tablet + cluster together** (`Experimental/CarHmi/index.html` +
   `cluster.html`).
2. **Session name**: ~~Paddock, Convoy, or keep Session?~~ → **keep Session**
   (§6). UI copy must still disambiguate lobby vs match-session actions.
3. **Tablet orientation**: ~~landscape or portrait?~~ → **landscape** (keeps
   the measured 1440×845 SpatialHud target).
4. The two look references didn't arrive as viewable images in this session —
   re-attach them (or confirm the dark-glass/cyan/amber read in §5.4) before
   the prototype's theme tokens are treated as final. The prototype currently
   pins the SpatialHud-derived cyan/amber/near-black contract in
   `Experimental/CarHmi/js/theme.js`.

## 11. Deferred alongside this task

- **Wheelspin in place** → `Plans/Deferred/WheelspinInPlace.md` (added this
  turn): needs a line-lock input mode, AMT burnout inhibit, stationary thermal
  + continuous-source smoke cases, and a `CheckDriveBurnout` exhibit. Nothing
  about it blocks the HMI.
