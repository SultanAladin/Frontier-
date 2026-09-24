# Tyrannosaurus rex — realistic articulated skeleton

A procedurally-built, anatomically-referenced *Tyrannosaurus rex* skeleton
(FMNH PR 2081 **"Sue"** scale) animated entirely in code: idle, walk, run with
smooth transitions, in-place turning, attacks (bite / tail swipe / roar) and a
"hunt the ball" behaviour. Plain static files, three.js vendored in `vendor/`,
no build step.

**Run:** `npm run serve` (or `python3 -m http.server 8080`), then open
<http://localhost:8080>. Serve over **http://** — do not open the file as
`file://`, or the browser will block the ES-module import map.

## What this build is

This is a merge of two earlier prototypes, polished into one:

* **Skeleton look — from the CFC3 prototype.** The bones use a per-fragment
  "real bone" finish (cortical grain, warm mottling, roughness break-up) with a
  fossil-cast toggle, giving the clean, realistic fossil appearance of that
  build.
* **Animation & mechanics — from the CF3D prototype.** One continuous
  speed-driven gait (inverted-pendulum walk → spring-mass run with an aerial
  phase, switching near Froude ≈ 1), planted-foot IK with no foot sliding,
  distributed spine/neck/tail articulation on turns, and a closed-loop hunt
  brain that chooses run / walk / pivot / bite / tail-swipe against a target.

Beyond a straight merge:

* **All sci-fi hardware removed.** Earlier the skull carried "alien receiver
  antennae", external hydraulic jaw actuators and three coloured Verlet cables.
  For a realistic skeleton these are gone — `decorations.js` is now an empty
  no-op and the rig is purely anatomical.
* **Idle reworked** for life: an asymmetric respiration cycle (quick inhale,
  longer exhale) with occasional deeper breaths driving the ribcage and flanks;
  event-driven resting **weight shifts** (the hips cock over one leg, roll into
  it and settle lower, then square up) with no foot slip; slow wandering head
  micro-drift plus an occasional alert head-lift; ambient tail flicks; and the
  existing look-around, jaw and air/ground sniff beats.
* **Bite reworked** into a staged orthal (up-and-down) feeding strike:
  anticipation gather → wide gape → committed downward strike driven by the neck
  and head (the torso only braces) → decisive orthal jaw close → a brief
  puncture **press/clamp** → a **puncture-and-pull** with a worrying head shake
  → recovery with a small elastic rebound. Three variants cycle: straight
  puncture-pull, a lateral rake, and a lift-and-crush.

## Controls

| Key | Action |
|---|---|
| W / S | speed up / slow down |
| A / D | steer while moving (turns on the spot when stopped) |
| Q / E | turn 90° left / right in place (feet step round, no sliding) |
| F | bite (cycles three orthal bite variants) |
| Z / C | tail swipe left / right |
| R · O | roar · roar in place (planted feet) |
| L | look around · Y / U sniff air / ground |
| T | start / stop hunting the ball |
| 1 / 2 / 3 | idle / walk / run |
| Space · H | pause · hide the UI |

On-screen panels expose the same actions plus camera presets, bone finishes
(ivory / brown / ochre / grey), a fossil-cast toggle, X-ray and flesh views.

**Hunt the ball.** Press *Start hunt* and drag the red ball (flick to throw).
The animal tracks it with its head, runs / walks / pivots toward it, bites when
it is close in front, and tail-swipes when it is beside or behind the hips. Hits
are checked against the real geometry (the tooth row at the snap; each caudal
vertebra during a sweep).

## Tests

`npm test` builds the rig headlessly and verifies bone counts and scale, the
retarget joints, idle → walk → run → stop (no foot sliding, no stretched bones,
no ground penetration, no NaNs), the jaw-down roar, look, sniff, planted roar,
turns, the three distinct bite variants, tail wave, hunt speed policy — and that
**no sci-fi decoration meshes remain** on the rig.

`node tests/render.mjs side|front|top|threeq|skull <t> <speed> out.png [flesh]`
renders PNG stills without a browser (used to eyeball poses).
