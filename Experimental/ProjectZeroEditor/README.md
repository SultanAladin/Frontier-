# Project Zero — Road Editor

An experimental 3D workbench for authoring **complete road networks** in the browser and
growing whole cities out of them. Everything is procedural: cross-sections are described as
lane lists, and the surface, kerbs, markings, furniture, bridges, tunnels and subway boxes
are generated from that description.

```bash
cd Experimental/ProjectZeroEditor
npm install
npm run dev        # http://localhost:5173
npm run check      # headless engine + geometry + UI checks (no browser needed)
```

**No build step needed to open it:** `standalone.html` is the entire editor — React,
three.js, the engine and the stylesheet — folded into one ~843 kB HTML file with a
classic (non-module) script, so it runs from any static host:

```
https://raw.githack.com/SultanAladin/Frontier-/8ff874fe3306b086e565e20eaab08884275f3947/Experimental/ProjectZeroEditor/standalone.html
```

(that one is pinned to commit `8ff874f`, which ships the current build).
See [Serving from GitHub (raw.githack)](#serving-from-github-rawgithack) below.

## What it does

* **A road catalogue of 50 profiles** across seven categories — motorways (2+2, 3+3, HOV/managed
  lanes, slip roads), urban streets (arterial with bus + cycle lanes, boulevard, avenue with
  parking, downtown grid, one-way with contraflow cycle, BRT corridor, street with tram tracks,
  industrial, dock, cobbled, market, school street), residential (street, narrow lane, mews,
  woonerf, fietsstraat, cul-de-sac, collector), rural (two-lane, wide shoulder, country lane,
  gravel, dirt, desert, forest, mountain pass), active travel (footway, promenade, shared-use,
  two-way cycle track, cycle superhighway, boardwalk, park trail, underpass), transit
  (double/single track railway, segregated tramway, railway with platforms) and structures
  (bridge deck, viaduct deck, footbridge, tunnel bore, cut-and-cover underpass).
* **Lane-level editing.** Every profile is a list of lanes (driving, bus, cycle, parking,
  shoulder, median, verge, footway, tram, rail, cycle-track, paved). Widths, direction and
  surface are editable per road; `‹`/`›` flip the direction of travel for that lane.
* **Real junctions.** Roundabouts with configurable inscribed diameter and circulatory width,
  T/Y/X junction patches, lane tapers, slip lanes and give-way markings.
* **Road markings** generated from the lane list: edge lines, lane lines with country-correct
  dash patterns, double whites, stop and give-way bars, zebra and signalised crossings, yellow
  box junctions, keep-clear hatchings, arrows, cycle symbols, bus lane lettering, parking bays,
  tactile paving and coloured cycle/bus surfaces.
* **26 placed details** — speed bumps, raised tables, rumble strips, pedestrian crossings,
  refuge islands, kerb extensions, railway crossings, bus stops, taxi ranks, tram stops,
  bollards, guardrails, tree pits, benches, litter bins, cycle stands, planters, street lights,
  traffic signals, signs, catenary masts, marker posts, gullies, manholes, loading bays and
  subway entrances. Drop one at the start, at the centre, or click the road to place it.
* **Bridges and structures** when a road crosses the river or another road at a different
  grade: decks, piers, parapets and abutments.
* **Subways** — underground lines with rectangular cutaway running tunnels, ballasted track,
  station boxes with platforms and entrances, drawn from a polyline and inspected with X-ray.
* **City generation** — a seeded, deterministic radial/subdivision generator that lays an
  arterial grid, subdivides blocks, allocates cycle/bus/parking lanes per street class, threads
  a river with bridges and a railway with level crossings, places roundabouts and buildings,
  and returns ~170 roads / 70 km of street in ~2 s.
* **Left- and right-hand traffic.** One `driveSide` switch mirrors every lane layout.
* **Unreal-style camera.** WASD + Q/E, right-drag to look, middle-drag to pan, alt-drag to orbit
  or dolly, wheel for speed, `F` to frame, `G`/`X` for grid and X-ray.

Buildings are optional and only massed as simple blocks to give the streets context.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move forwards / left / back / right |
| `Q` / `E` | Down / up |
| Right-drag | Free look |
| Middle-drag | Pan |
| Alt + right-drag | Dolly |
| Alt + left-drag | Orbit |
| Wheel | Camera speed |
| `Shift` / `Ctrl` | 4× faster / slower |
| `F` | Frame selection |
| `G` / `X` | Ground grid / X-ray |
| `Enter` / `Esc` | Finish / cancel the drawing tool |
| `Del` | Delete selection |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |

## Serving from GitHub (raw.githack)

raw.githack serves files straight out of the repository, so the file has to be committed
and it cannot rely on a bundler, bare imports, module MIME types or absolute asset paths.
`standalone.html` is built for exactly that:

```bash
npm run build:standalone   # vite (IIFE, no code splitting) + scripts/inline-build.mjs
git add standalone.html && git commit -m "Rebuild standalone.html" && git push
```

Then open (swap in your commit SHA — pinning it also busts the CDN cache):

```
https://raw.githack.com/SultanAladin/Frontier-/<commit-sha>/Experimental/ProjectZeroEditor/standalone.html
https://rawcdn.githack.com/SultanAladin/Frontier-/<commit-sha>/Experimental/ProjectZeroEditor/standalone.html
```

* `raw.githack.com` is uncached — use it right after a push.
* `rawcdn.githack.com` is the cached CDN — use it once the content has settled.
* A branch-following form also works:
  `…/SultanAladin/Frontier-/arena/e2c2e01b-frontier/Experimental/ProjectZeroEditor/standalone.html`

The standalone build targets ES2019, needs WebGL 2 and is ~843 kB (mostly three.js).
`dist/` stays git-ignored; only the finished single file is committed.

## Layout

```
src/
  engine/
    util.js          maths, splines, deterministic RNG
    textures.js      procedural asphalt/concrete/sett/grass/marking textures
    materials.js     cached PBR materials per surface
    profiles.js      the 50-entry road catalogue
    crossSection.js  lane list -> offset table + drive-side mirroring
    meshBuilder.js   chunked geometry sink with per-triangle owner ids
    network.js       document model (nodes, roads, subways), undo/redo, serialisation
    roadBuilder.js   surface/kerb/verge extrusion along a spline
    junctions.js     roundabouts, junction patches, tapers
    markings.js      line, symbol and area markings
    props.js         20 instanced street-furniture models
    details.js       the 26 placeable road details
    bridges.js       decks, piers, parapets
    subway.js        tunnels, track, stations
    terrain.js       heightfield + river water
    cityGenerator.js seeded city layout
    buildings.js     optional block massing
    world.js         RoadWorld: orchestrates a full rebuild into chunks
    cameraController.js  Unreal-style fly camera
    viewport.js      renderer, picking, tools, gizmos
  ui/                React panels (library, outliner, inspector, minimap, dialogs)
  App.jsx            shell: menu bar, tool rail, panels, HUD, status bar
scripts/
  check-road-editor.mjs  document-model checks (no DOM)
  check-geometry.mjs     full build pipeline with a stubbed canvas
  check-ui.mjs           server-side render smoke test of every panel
```

## Notes

* Geometry is chunked (256 m) and materials are batched per chunk, so a 2 km city renders in
  ~2 100 draw calls / ~500 k triangles at interactive rates.
* Picking uses a per-triangle owner table, so clicking a lane selects the road that owns it.
* The document is plain JSON: **File → Save road network** writes it, **Open** restores it.
