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
five launcher designs (Launchpad, Dashboard, Collections, Focus, Console), three finishes and the cover glass.

## How it is built

- The user interface is drawn into one 1920 × 1200 canvas at a fixed device resolution and used as the
  flat screen texture of a 400 × 250 mm tablet with a 2.4 mm transmissive cover glass.
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
```

The browser check needs the served page on port 8099 and either the scratch Chromium or
`CHROMIUM_EXECUTABLE`. Proof images and `BrowserMetrics.json` (13 October 2026) live in
`VisualProof/TabletSequence/`.

## Not yet done

Dashboard cluster, actual-car 3D preview, boot sequence, live vehicle bindings and the C++ port.
