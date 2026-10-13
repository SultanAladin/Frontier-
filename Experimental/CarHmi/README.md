# CarHmi prototype v2 — 3D glass tablet + 5 app grids

Rebuilt 2026-10-13 after the owner rejected v1 (page-based DOM tablet). This
version leads with the object: a 3D tablet with glass, an orbitable camera,
and 5 switchable interactive app-grid designs — per `Docs/CarHmiReport.md`.

```sh
cd Experimental/CarHmi
python3 serve.py --port 8099   # no-store headers; never plain http.server
node --test Checks.mjs          # icons / grids / views / app-screen pins
```

## What is in it

- **3D tablet**: aluminium body, bezel, camera dot, speaker slot, studio floor
  shadow. Drag the backdrop to orbit; sliders for tilt/turn/zoom; presets for
  **2D front** (flat tablet) vs **3D angle/side/top**; auto-spin toggle.
- **Glass**: pointer-transparent overlay; the sheen slides with yaw, glare
  grows and the screen dims toward grazing angles (the SpatialHud Fresnel
  finding, DOM edition).
- **5 grids**, all interactive: Pages (swipe + dock), Folders, Tiles (live
  widgets act without opening), Drawer (search + A–Z), Cards (snap carousel).
- **14 apps**, each a multicolour SVG icon opening a working mini-app (dial
  pad, chat, climate, dashcam, tune sliders, telemetry, lobby, analog clock…).
- Home bar always returns; toasts confirm actions.

## Files

| File | Owns |
|---|---|
| `js/icons.js` | 14 multicolour SVG icons + names/blurbs (DOM-free) |
| `js/grids.js` | 5-design registry, folders, dock (DOM-free) |
| `js/apps.js` | app screen strings + wiring (strings DOM-free) |
| `js/scene.js` | camera rig, VIEWS presets, glass response |
| `js/app.js` | shell: panel, grid renderers, app open/close |
| `Checks.mjs` | theme/grid/view/screen pins |
