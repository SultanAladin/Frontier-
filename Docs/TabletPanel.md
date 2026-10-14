# Tablet HMI prototype

`Experimental/TabletPanel/` is the browser-first design study for the in-car tablet. The replaced
`Experimental/SpatialHud` page is gone; only its generated shader copy survives at
`Experimental/InterfaceProjection/SignedDistance.generated.js`, still produced by
`Tools/Build/GenerateHudShader.py`.

## Use

```
python3 Tools/Build/ServeExperiments.py --port 8099
```

`/` opens the tablet. Tap or click apps on the screen; drag the background to orbit; scroll to zoom;
`2D view` shows the display straight on; `Esc` returns to the launcher. The inspector switches between
five launcher designs (Launchpad, Dashboard, Collections, Focus, Console), four console families or any
custom width / height / thickness, four driver-cluster outlines, three finishes and the cover glass.
On the device itself the launcher design is chosen in the **Settings** app; the **Garage** app shows the
project car and orbits it when you drag on the panel.

## How it is built

- The user interface is drawn into one canvas (1200 × 750 logical points at 1.6× ) and used as the flat
  screen texture of the console tablet with a 2.4 mm transmissive cover glass.
- **Modular console.** `TabletStructure.js` rebuilds the chassis from width, height and console thickness
  (`TabletFamilies`: Coupé 300 × 200 × 10, Grand tourer 400 × 250 × 12, Wide estate 480 × 220 × 14,
  Utility 260 × 330 × 16 mm, or custom sliders). The launcher never stretches: `ScreenSequence.PresentAspect`
  keeps the 16:10 layout at uniform scale and continues the panel background into the spare band; touch
  mapping goes through `QueryPanelPoint` / `QueryPanelFraction`. A resized canvas texture is disposed and
  reallocated (three.js uses immutable storage, so a sub-upload would silently keep the old picture).
- **Driver cluster.** `ClusterSequence.js` rasters speed / rpm / gear into its own texture at its own 30 Hz
  cadence, clipped to an irregular outline (hexagon, ≈70 % circle, trapezoid, wide pill). The raster takes the
  outline's physical aspect (`ResolveClusterHeight`: 1000 × 559 hexagon, 1000 × 1000 arc, 1000 × 472 trapezoid,
  1000 × 325 pill) so nothing is stretched onto the housing, and `ConstructCluster` extrudes the housing from
  the same unit polygon so bezel, bed and masked face agree.
- **Real car preview.** This is the Project-Drive car. `Projects/Project-Zero/Content/Scenes/Vehicle.gltf` is
  written by `Projects/Project-Drive/Source/DriveSceneAuthor.cpp` (the `ControlVehicleStructure.inl` body with
  authored per-face families, the authored RimFL rims, the tread lattice, and `AuthorMaterials` colours such as
  MetalicCoat 0.680005 / 0.800458 / 0). `Tools/Build/ExtractVehiclePreview.py` packs the body and four tyres of
  that scene byte-for-byte into `ControlVehicle.glb` (19,948 facets, manifest `ControlVehicle.json` with SHA256s
  and the authored base colours). The preview promotes the materials the way Drive describes them — lime
  dielectric basecoat under a 0.03 clearcoat, smoked glazing, blue metal mag accents, emissive lamps. `VehiclePreviewSequence.js` renders it in
  its own scene with its own camera, floor and lighting into a 640 × 400 render target at 30 Hz, reads the
  pixels back and composites them 1:1 into the Garage page. It is visual only; nothing drives the physics.
- Touch is resolved by ray intersection with the screen surface, converted to screen UV, then to
  retained hit regions. Captured drags continue off the display by plane intersection.
- Twelve applications use original multicolour SVG icons in `IconDepot.js`. Application screens are local
  demonstrations: no vehicle, network or account service is connected.
- The texture is redrawn only when UI state changes; camera moves re-render the scene without repainting it.

## Checks

```
npm --prefix Experimental/TabletPanel install
npm --prefix Experimental/TabletPanel run build          # TabletRuntime.js from the sources
node Experimental/TabletPanel/TabletMetrics.mjs         # CPU: layouts, icons, regions, interaction
node Experimental/TabletPanel/BrowserMetrics.mjs        # real headless browser; writes VisualProof/TabletSequence
python3 Tools/Build/ExtractVehiclePreview.py --check    # packed car matches its manifest (and the source scene when present)
```

The browser check needs the served page on port 8099 and either the scratch Chromium or
`CHROMIUM_EXECUTABLE`. Proof images and `BrowserMetrics.json` (13 October 2026) live in
`VisualProof/TabletSequence/`.

## Not yet done

Boot sequence with particles, live vehicle / cluster bindings (the cluster shows a demonstration drive),
the remaining HMIs and the C++ port. The cluster is placed above the console in the studio scene; in-car
placement belongs to the interior stage.
