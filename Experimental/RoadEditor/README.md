# Frontier Road Editor (experimental)

A browser road editor for large, NFS-style maps: roads only (no buildings), Unreal-style fly camera, and a planar topology that merges crossings without booleans.

```sh
cd Experimental/RoadEditor
npm install
npm run dev        # http://localhost:5180
npm test           # topology, generator and mesh tests (node --test)
npm run build
```

## Topology rules

- Roads on the **same layer** that cross are cut at the crossing and joined into one shared junction node (plus, T, Y, X).
- A road end landing on another road snaps onto it (T-junction).
- Roads on **different layers** (surface 0, bridge +1, subway −1) are never merged; they pass over or under each other.
- A road end landing on another layer's road creates a ramp/portal junction.
- `validateTopology()` reports any unmerged crossing or collinear overlap. The Validate button marks them in the scene.

## Road types

Defined in `src/profiles.js`: avenue, boulevard, residential street, cycle street, highway, country road, offroad track, pedestrian pathway, railway, subway, and three bridge types (box girder, steel arch, cable-stayed).

Lanes are built from the cross-section: drive lanes, bus lanes, bike lanes, parking, sidewalks with kerbs, medians, barriers and shoulders. Markings are dashed, solid, double-yellow and parking stalls. Bollards, speed bumps and railway level crossings are generated.

Every road gets its own seed, which drives lane-width jitter, dash phase, bump positions, bollard spacing and vertex tint. Rerolling a road's look changes it without changing its shape.

## Files

| File | Purpose |
|---|---|
| `src/geometry.js` | Vector maths, Catmull-Rom curves, grid-indexed planarisation, topology validation |
| `src/profiles.js` | Road types and per-road lane profiles |
| `src/mesh.js` | Triangle batches: surfaces, markings, junction fans, bridges, tunnels; chunked at 300 m |
| `src/generator.js` | Seeded city, countryside and offroad generators |
| `src/app.js` | three.js scene, WASD camera, draw/select tools, undo, import/export |
| `test/*.test.mjs` | Node tests |

## Known limits

- Junctions are fan-filled with kerb wedges, not filleted corner curves.
- Bridge ramps are smooth height blends, not engineered grades.
- Buildings, trees and traffic are out of scope.
- Rebuilds are full rebuilds (about 2 s for the generated city); there is no incremental update yet.
- Roughly 14 road types. "Every road in the world" needs more presets.
