# Frontier RoadForge

A standalone browser-based road-network editor in `Experimental/RoadForge`, separate from the Fracture editor. It uses React/Vite for the workspace and a WebGPU-first Three.js viewport (with an explicit WebGL fallback when WebGPU cannot initialize).

## Start

```sh
npm install
npm run dev
```

For plain static hosting (including Raw.githack), build the self-contained page:

```sh
npm run build:standalone
```

This writes `RoadForge.html` with the JavaScript and CSS bundled inline. Open that file’s Raw.githack URL—not the source `index.html`, which expects Vite to resolve its React modules.

The local scene is saved in browser storage. `npm test` runs the CPU geometry checks; `npm run build` creates the static app bundle.

## Implemented in this prototype

- Cubic Bézier road drawing with anchor snapping, generated quad strips, editable cross-sections, and a right-side scene graph / inspector.
- Intersection construction from trimmed road arms, boolean union of the asphalt footprint, and triangulated junction / footway patches. Acute approaches use the same merged patch path and produce a diagnostic rather than retaining overlapping center quads.
- Selectable junction nodes, numeric positioning, and a translate gizmo that moves connected spline handles with the node. The scene graph can add a four-arm junction preset.
- Procedural PBR asphalt and paving, a reorderable surface layer list, albedo/opacity/roughness controls, and road-aligned metric UV repeat controls.
- Crosswalks, lane / edge / parking-bay markings, curbs, footways, optional pothole decals and speed tables, reconstruction patches / cones, streetlights, signal heads, crossing signs, bollards, and optional roadside billboard panels.
- An editable bridge/flyover deck rise with parapets and piers; a below-grade road-underpass treatment with a terrain cutout; an at-grade commuter rail spline crossing with rails, sleepers, crossing bars, and optional four-car train animation.
- Optional animated road traffic, clamped centrally to **25 vehicles maximum**.
- Open city-block pads without buildings, JSON scene export, triangulated OBJ export, undo/redo, and keyboard shortcuts.

The starter scene is an editable demonstration network, not a surveyed real-world interchange. Its bridge dimensions are authored in metric units and remain adjustable.

## Current limits / next engineering steps

This is an early vertical slice, not a finished infrastructure-design suite. AI traffic is a visual lane-following preview rather than a routed, collision-aware traffic simulation. Rail is currently an at-grade crossing; a full underground/subway corridor authoring workflow, rail signaling logic, train timetables, and multi-level station systems are not implemented. Tunnel geometry is currently a simple under-grade road corridor with an open terrain cut, not a configurable bored tunnel or complete portal/liner system. Interchange ramp curvature validation, superelevation, drainage, detailed curb-return design standards, imported survey/GIS data, and full civil-engineering deliverables remain future work. Procedural material layers currently expose tint, opacity, roughness, and the wearing-course UV repeat; they are not a general-purpose shader-node or scanned-material authoring system.

## Validation

The geometry tests exercise normal and acute-angle junction unions, tunnel grade/cutout generation, rail crossings, construction and surface details, node snapping/movement, four-arm presets, finite/indexed buffers, and the 25-vehicle cap. Build and headless checks do not substitute for testing WebGPU on physical GPU/browser combinations; hardware runtime validation remains outstanding.
