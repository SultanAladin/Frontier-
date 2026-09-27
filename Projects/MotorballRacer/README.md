# Motorball Speedway — a racecar redesign of Alita: Battle Angel's motorball arena

A small, self-contained browser 3D prototype (Three.js + Vite) so the redesigned track can be
test-driven immediately — no engine build, no GPU drivers beyond a browser with WebGL.

It deliberately lives outside the Frontier C++/Vulkan engine tree (`Projects/MotorballRacer`)
as a fast web prototype for iterating on the track layout and car feel before anything gets
ported into the real engine's `TrackSequence` / `VehicleSolver` systems in `Project-F20`.

## Run it

```bash
cd Projects/MotorballRacer
npm install
npm run dev
```

Open the printed URL. The dev server is pinned to **port 6931** (see `vite.config.js`) — not
5173 (Vite's default), 800, or 8080, per the request.

## Controls

| Key | Action |
|---|---|
| `W` / `↑` | Throttle |
| `S` / `↓` | Brake / reverse |
| `A` `D` / `← →` | Steer |
| `Space` | Handbrake (looser grip / slide) |
| `C` | Toggle chase camera distance |
| `R` | Reset onto the track |

## Design notes: from motorball arena to racecar circuit

Research pass (film stills + concept art + the Motorball wiki/production write-ups) called out
a few recurring details of the movie's track: a steel-and-concrete arena bowl, hazard-striped
crash barriers, chain-link crowd fencing, floodlight trusses, and — notably — the race spilling
out of the stadium into Iron City's underpasses/sewageways. The redesign keeps that industrial
arena identity but reshapes the circuit specifically for wheeled racecars instead of skaters:

- **Two 16°-banked speedway turns** (`TrackSequence`-style ovals bank at a fraction of this in
  the source engine stub) replace the motorball's tight skate-loop corners, so a car can actually
  carry cornering speed instead of scrubbing it off.
- **A tabletop jump** on the back straight reworks the movie's ramp/gag setup: a smooth
  ramp-up → flat table → ramp-down profile so a car launches cleanly at speed instead of relying
  on a void a wheeled vehicle could get stranded in.
- **A sunken tunnel dip** under a stadium overpass on the front straight, narrowing the road,
  echoing the film's underpass/sewer sections without needing an actual enclosed tunnel mesh.
- **Hazard-striped crash barriers, chain-link fencing, curved grandstands with a crowd texture,
  floodlight trusses, and a checkered start/finish gantry** all around the loop, plus a small
  spiked-motorball monument in the infield as a nod to the source material.

All of the above is generated procedurally (`src/trackBuilder.js`) from one analytic centerline
function, so the drivable surface (physics) and the rendered mesh are always exactly the same
geometry — what you see is what you drive on.

## The car

`src/car.js` builds a low-poly compact-sedan silhouette (three-box shape, short overhangs,
upright greenhouse with a raked windshield/rear glass — a stylized nod to a Nissan Sentra-style
compact) entirely from primitive geometry, so there are no imported 3D assets. Handling is an
arcade heading+velocity model with grip blending (`src/car.js` → `CarController`): easy to drive
with digital keyboard input, with a jump-launch impulse authored specifically at the tabletop
ramp's crest.

## Testing without a browser

`test/smoke.mjs` is a headless Node smoke test (no WebGL/browser needed) that builds the real
track + car modules, checks for degenerate/NaN geometry, verifies the loop closes and the
authored jump/tunnel/banking are present, and drives a simulated lap with a simple centerline-
following autopilot to confirm the circuit is actually navigable (walls, jump launch, tunnel
narrowing) end to end.

```bash
node test/smoke.mjs
```
