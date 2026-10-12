# Road Editor

A standalone, browser-based road-network editor styled after the Frontier **Project-Zero /
FrontierEditor** UI (graphite panels, DM Sans, outliner · viewport · inspector). It generates and
edits a Need-for-Speed scale city map — no buildings — with a road graph, editable rail routes,
elevated suspended guideways, street-running tram rails, subways and animated rolling stock.

```
npm install
npm run dev            # vite on 0.0.0.0:5173
npm run build          # production bundle in dist/
npm run test:gen       # headless generator smoke test (node only, no browser)
npm run test:topology  # rail topology, train, undo and lane-transition geometry checks
npm run test:geometry  # centered medians, single rounded noses and roundabout placement
```

---

## What it generates

| Area | Content |
| --- | --- |
| **Surfaces** | asphalt, aged asphalt, concrete slabs, cobblestone, brick pavers, gravel, dirt, grass, ballast, quay stone — each a procedural diffuse texture (with normals where it matters) laid out in per-lane UVs |
| **Cross-sections** | 26 road profiles in 6 categories (highway · arterial · urban · residential · rural · active), assembled from 15 composable lane types: `drive, bus, bike, cycletrack, parking, shoulder, sidewalk, planter, median, buffer, tram, barrier, verge, gravel, path` |
| **Road edge** | raised curb built as granite top + face strips, sidewalk and frontage ribbon, speed humps and raised crossing tables (a real elevation profile, not paint), bus stops with shelter + yellow curbside box, painted parking bays and hatched no-parking zones near junctions, storm-drain inlets and manhole covers |
| **Markings** | dashed/solid lane rules per adjacent lane pair (US yellow centre / EU white), edge lines, stop bars, continental (zebra) crosswalks with tactile paving at the curb ramps, give-way teeth, hatched channelisation, turn arrows (`arrowS/L/R/SL/SR`), word decals (`BUS`, `ONLY`, `STOP`, `SLOW`, `KEEP CLEAR`, `BUS STOP`, `RXR`, tram and bike glyphs), zebra- and chevron-painted crossing tables |
| **Junctions** | auto-classified as `junction · roundabout · flush T · cul-de-sac · continuation`; corner fillets and radii fitted from each approach's width and rank; paved apron with a triangulated surface that absorbs all approaches; roundabouts get a central island with curb ring, truck-mountable cobble apron, grass centre and trees, plus the circulating edge line; tram rails run straight through opposing approaches; per-approach traffic control (signals, stop or yield) with mast arms, three-lamp signal heads and pedestrian signals |
| **Bridges & water** | elevated decks with concrete side walls down to the ground, parapets/railings, pier columns and caps placed clear of the carriageway below (piers are refused where they would land in a live lane); river with stone quay walls, coping and railing (skipped where roads and rail cross), riverbed, and an animated water-normal surface, with the terrain hole cut along the channel |
| **Rail & transit** | editable railway routes are planarized into a separate rail-node/edge graph; mainlines get ballast, sleepers, steel rails, catenary, fences and protected road crossings; tram lanes use swept grooved rails flush with road surfaces; suspended lines get a box guideway, clearance-checked columns and crossheads; procedural commuter, tram, subway and hanger-car trains animate along routes |
| **Lane transitions** | junctions match directed incoming/outgoing lane groups, sweep connector markings through straight or angled merges, and draw taper gore hatching when a lane is added or dropped (for example, a two-to-three lane transition) |
| **Subway** | cut-and-cover box tunnel with twin tracks, station boxes with side platforms, platform-edge walls and yellow caution strips, station columns, and up to 4 street entrances per station snapped onto nearby sidewalks |
| **Props** | 56 039 instanced placements: `lamp, lampPost, lampDouble, lampHigh` (with arms and luminaire), `signalPole / signalArm / signalHead / pedSignal`, `signStop, signYield, signHump, signCrossing, signRail, crossbuck`, `bollard, bollardSign, delineator, hydrant, bin, bench, busShelter`, `treeA, treeB`, bridge `pierCol / pierColWide / pierCap`, rail `sleeper, catenaryMast, catenaryArm, fencePost, gatePost, gateArm` (half-barriers are split into ≤ 7 m arms with a cabinet at each pivot, and each arm gets a counterweight housing behind it), subway `stationColumn, subwayEntrance` |

### Reference build — seed 1337, 4 × 4 km

```
1192 nodes · 1629 edges · 224 km of road · 519 lane-km
792 junctions · 18 roundabouts · 196 cul-de-sacs · 71 flush T · 115 continuations
7.2 km rail (including 2.7 km suspended guideway) · 5.1 km subway (2 lines × 5 stations)
4 derived rail nodes · 2 rail segments · 20.1 km bus lanes · 57.8 km cycle lanes · 97.9 km parking lanes
1.26 M triangles · 0 warnings · 0 non-finite values · 2,778 lane movements / 240 adds / 60 drops
generate 1.2 s · mesh build 0.9 s (single node thread)
```

---

## Controls

Unreal-style free camera: `W A S D` fly, `Q`/`E` down/up, `Shift` boost ×4, `RMB + mouse` look,
`RMB + wheel` fly speed, `MMB drag` pan, `Alt + LMB` orbit around the cursor, `wheel` dolly to cursor,
`F` frame the selection. Look-mode ignores tool keys, so `WASD` never fights the editor.

| Key | Action |
| --- | --- |
| `V` / `1` | Select tool |
| `B` / `2` | Draw a road (uses the profile in the toolbar picker) |
| `R` / `4` | Draw an at-grade railway or suspended guideway |
| `X` / `3` | Bulldoze tool |
| `Enter` | Finish the current draw |
| `Backspace` | While drawing: drop the last point · otherwise delete the selection |
| `Del` | Delete selection |
| `Esc` | Cancel draft → close library → back to Select → deselect |
| `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Undo / redo |
| `G` | Toggle snapping |
| `Shift + click` while drawing | Snap the segment direction to 15° steps |
| `Shift+A` | Road library |
| `Ctrl + click` | Select the whole street (every segment of that name) |
| `double-click` a road or railway | Insert a bend point at the cursor |

Road drawing snaps to existing street nodes/centrelines so junctions form automatically. Railway
routes are edited as independent polylines; their own graph planarizes same-layer crossings and keeps
at-grade, elevated and street-running tracks separate from road junctions. With snap on, free clicks
round to the metre grid.

## Panels

* **Outliner** — roads grouped by category → named street → segment, with search, per-group counts,
  expand/collapse, and click-to-focus selection. Long groups cap at 120 streets with a "+N more" row
  that asks you to refine the search.
* **Viewport** — tool strip (Select · Draw · Rail · Bulldoze, road profile or rail system, track count,
  elevation, undo/redo and snap), view-mode switch (Lit · Topology · Underground), day/night, controls,
  a live perf HUD and a minimap. Draw at-grade railway routes or select Suspended to place a guideway
  above streets; railway intersections are derived as a separate topology layer.
* **Inspector** — *City*: network metrics (roads, junctions, lane-km, rail km, suspended km, rail-node
  counts and subway), the generator (seed, map size 2–8 km, density, river, freeway, railway, suspended
  monorail, subway, tram avenues, roundabouts, old town, suburbs and parks) and display toggles including
  animated trains. *Railway*: mode, track count, train frequency, elevation, track-graph statistics,
  route name and delete; drag white points to reshape or double-click to add a bend. *Segment*: live
  cross-section diagram, lane editing, profile picker and geometry. *Node/Junction*: junction kind,
  curb radius, traffic control and elevation. *Street*: rename or re-profile all segments at once.
* **Road library** (`Shift+A`) — sliding modal in the Frontier Construct-menu style: category rail,
  search, 26 profile tiles drawn at true scale, *Apply to selection* and *Draw with…* — double-click a
  tile to start drawing that profile immediately.

---

## Architecture

```
src/
  main.jsx  App.jsx  styles.css        shell: outliner | viewport | inspector
  editor/editor.js                     Editor store: tools, selection, drag, undo, generate()
  ui/*.jsx                             React panels; useEditor() subscribes to the store
  road/                                data + geometry, three.js-free
    math.js                            rng, noise, resample, curve helpers
    centerline.js                      Centerline: arc-length frames (t,n,y,curvature)
    profiles.js                        LANE_TYPES, PROFILES (26), layout() widths/offsets
    network.js                         RoadNetwork graph + SpatialIndex + derived rail maps
    railTopology.js                    layer/elevation-aware derived rail nodes and edges
    tramRoutes.js                      directed street-tram path assembly
    planarize.js                       intersection detection & node insertion
    junction.js                        approach detection, auto radii, control class
    geom/out.js                        Out: material-keyed p/uv/i buckets + bbox + prop records
    geom/edge.js                       road surface, curbs, sidewalk, humps, markings per edge
    geom/junctionMesh.js               junction surfaces, lane-count merge tapers, aprons & islands
    geom/markings.js decals.js         line/dashed/bar/tooth/hatch + decal-atlas quads
    geom/control.js                    traffic-control resolution & hardware placement
    geom/water.js rail.js subway.js    river & quays, railway, tunnels & stations
    builder.js                         NetworkBuilder: element -> renderable + prop instances
    cityGen.js                         DEFAULT_GEN, generateCity()
  render/                              three.js layer
    textures.js                        procedural texture set + decal/sign atlases
    materials.js                       PBR materials (roads) and prop materials (vertex colour)
    propsLib.js                        prop geometry; front = local +x, [x,y,z,yaw,pitch,sx,sy,sz]
    world.js                           chunks, LOD, shadow sun, sky/PMREM, picking, overlays
    transit.js                         procedural rail/tram/subway rolling stock and animation
    camera.js                          CameraController (fly / look / orbit, speed steps)
```

**Pipeline.** `generateCity()` returns a purely topological `RoadNetwork`. `NetworkBuilder` sweeps
each element into an `Out` — flat per-material vertex/UV/index arrays plus instanced prop records —
and `World` merges those into **512 m road chunks** (paving + curbs in one mesh per material,
markings in a second group) and **400 m prop chunks** (one `InstancedMesh` per prop part). Editing an
element rebuilds only the chunks that reference it (`applyUpdate`), which is what keeps dragging a
handle interactive on a 224 km map.

**LOD & culling.** Road chunks cull on their real bbox; prop chunks on cell distance
(`propDist` 620 m, trees 1.5×). Markings drop out past `markDist` (1600 m). Everything is merged, so
in-view draw calls stay between 150 and 700 while up to 3.7 M triangles are drawn — the scene is
fill-rate bound, not draw-call bound.

**Lighting.** Sky shader + PMREM environment, ACES tone mapping, and a camera-following directional
sun (2048² PCF-soft, texel-snapped focus to stop shimmer) with a deliberately strong key / weak fill
ratio so cast shadows stay readable on dark asphalt. Normal bias (0.25) keeps the merged road ribbons
from acne-ing themselves.

## Scripts

* `scripts/smoke-generate.mjs` — generate + build headlessly, print triangle/prop/material counts,
  assert no NaN and no missing materials.
* `scripts/winding-test.mjs` — checks every swept quad and arc strip is CCW when seen from outside.
* `scripts/transit-topology-test.mjs` — checks rail switches vs grade separation, suspended supports
  and trains, rail undo/redo, and angled two-to-three lane transition geometry.
* `scripts/geometry-regression-test.mjs` — checks mismatched sidewalk widths blend into a constant-width
  rounded corner, boulevard/BRT medians merge into one centered island without changing road width,
  each road end gets one rounded nose, and roundabout islands remain centered on their junction nodes.

## Notes & limits

* Buildings are intentionally out of scope: blocks are paved/grassed parcels with street trees.
* Roads, railways and subways keep independent editable/derived graphs. Road crossings do not create
  rail switches; rail crossings only connect within matching system layers and compatible elevations.
* Terrain is a district-coloured displaced grid with a rasterised river cut; `groundAt()` is the
  single height authority, and raised elements are consistent across edges, junctions, rail and subway.
* Props cast shadows but do not receive them — a fill-rate tradeoff, easy to flip in
  `World.buildPropChunk`.
* Undo keeps up to 100 compact changed-element transactions, including railway routes and control points.
* Subway stairs are intentionally not modelled below grade — the raised sidewalk would hide them.
