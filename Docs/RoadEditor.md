# Road Editor (Experimental)

A browser prototype for designing large, clean road networks: roads only, with
curbs, paving, bridges, pathways, markings, street furniture, bus/cycle/parking
lanes and subways. Buildings are optional and are not generated.

Entry point: `Experimental/FrontierEditor/road-editor.html`
Source: `Experimental/FrontierEditor/road-editor/`
Run: `npm --prefix Experimental/FrontierEditor run dev -- --port 5173`, then open `/road-editor.html`.

> **Naming.** The request named "ProjctZeroEditor". No folder by that name exists.
> `Projects/Project-Zero` is native C++, and this prototype is browser-based, so it
> sits beside the other browser studies in `Experimental/FrontierEditor/`.

## Using it

| Input | Action |
| --- | --- |
| W A S D | Fly forward, left, back, right (view-relative, Unreal style) |
| Q / E | Down / up |
| Right-drag | Look around |
| Shift | Fast fly (×4) |
| Wheel | Change fly speed |
| 1–5 | Tools: select & move, draw road, street furniture, deck height, delete |
| Enter / right-click | Finish drawing |
| Esc | Cancel drawing / clear selection |
| F | Focus camera on selection |
| Delete | Delete selected road or furniture |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo (60 steps, includes city generation) |

Select a road to edit its name, preset, speed, centre marking, deck height and
lane layout. The lane editor sets kind, direction and width per lane; "Apply
lanes" commits it and "Reset to preset" removes the override. Dragging a node
moves it on the ground; connected roads follow when you release the mouse.

Autosave is written to `localStorage` under `frontier-road-editor` after each
change (skipped above 4.5 MB; use Export). Export and Import use JSON
(`format: frontier.road-network`, version 1).

## Road types (`road-editor/road-catalog.js`)

- **Urban:** residential, local (no parking), one-way, shared street (woonerf),
  avenue with bike lanes, boulevard with bus lanes and median, bus corridor,
  cycle street, tram street.
- **Roads:** arterial, primary, motorway (divided), slip road, country lane,
  service road, roundabout ring.
- **Tracks & paths:** dirt track, footpath, gravel path.
- **Rail:** mainline rail, subway (underground).

Lane kinds: sidewalk, verge, paved footpath, gravel, shared paving, drive, bus,
bike lane, cycle track, parking, hard shoulder, median, tram, railway ballast.
Lanes are `[kind, direction, width]`, listed left to right looking from the
road's first node to its last.

## Topology (`road-editor/road-graph.js`)

- A new road is split and joined wherever it crosses roads at the same height.
  Crossings at a height gap of 0.3 m or more are grade-separated and do not
  join. This is how overpasses work.
- An endpoint within 2.5 m of a road or node snaps onto it, forming a T or
  merging into a junction.
- Nodes closer than 2.0 m merge, so no sliver edges form.
- Dense curve sampling adapts to bend angle: about 2 cm chord error on bends,
  one sample per 16 m on straights.

## Geometry (`road-editor/road-geometry.js`)

Meshes are built per 500 m chunk into four layers, each `{position, normal,
color}` typed arrays: `surface` (asphalt, kerbs, paving), `markings` (lane lines,
centre lines, stop lines, zebra crossings and arrows at junction arms, lift
14 mm above asphalt), `props` (bollards, speed bumps, level-crossing barriers and lights,
subway kiosks, bridge parapets and piers at 25 m spacing), and `underground`
(subway tunnels, drawn translucent when "Subways" is on).

Junction fills use the outer paving and the carriageway at the node's height.
Level crossings are placed automatically on each road arm that meets a railway
at a junction. Zebra crossings, stop lines and arrows are drawn at junction arms
by the geometry pass.

## City generator (`road-editor/city-generator.js`)

Seeded and deterministic (`same seed → same network`). Options: seed, size
(2–10 km, default 6), block size (360/480/600 m), local street spacing
(120/240/360 m), grid warp, and per-feature toggles.

It produces:
- a warped arterial grid, with bus-lane boulevards and avenues with bike lanes;
- local streets in every block, some with parking, some one-way, some cycle streets, and some dead ends;
- a mainline railway crossing the city, with automatic level crossings;
- two underground subway lines with portals outside the map and two station kiosks each;
- an elevated motorway ring at 6 m with slip-road interchanges on the grid;
- speed bumps on local streets and bollards on cycle streets.

Default size: about 1,285 roads, 724 nodes, 671 junctions and 276 street-furniture items.

## Verification

- `npm run test:roads` (run from `Experimental/FrontierEditor`): 21 node checks
  covering RNG determinism, catalogue validity, topology (cross, elevated cross,
  T-snap, closed ring, round-trip, no slivers), mesh finiteness and normals,
  generator determinism, density, presence of every requested road and detail
  type, and mesh build time.
- `npm run build` produces `dist/road-editor.html` alongside the existing pages.
- Headless Chromium (software WebGL) loads the page with no JavaScript errors,
  and the city builds in about 1.5 s. Screenshots are in `RoadEditorEvidence/`.
- Driven with real pointer and key input: drawing three points and pressing
  Enter added 4 road segments; Ctrl+Z restored the count exactly; the furniture
  tool placed a bollard; the delete tool removed a road; clicking a road opened
  its inspector with the lane editor.

## Known limits

- Junction corners are flat paving. Raised curb returns are not modelled.
- Every edit rebuilds all chunks (about 1.1–1.6 s on the default city). There is
  no incremental chunk rebuild yet.
- Changing a road's deck height moves the nodes at its ends, so roads that
  share those nodes move too. Grade-separated roads are unaffected.
- No buildings, no traffic signals, no signage meshes, no roundabout generation.
- The three.js bundle for this page is about 600 kB (minified). The Vite
  chunk-size warning for this page is expected.
