# SolidArc Panel — Outliner · Viewport · Inspector (HTML)

Single-file UI (`index.html`, no build step) for exercising SolidArc through a UI before the
C++ console host is bridged. Same visual language as the Celestial panel on GitHub Pages
(glass panels, Outfit / JetBrains Mono, tick-track sliders, presence grid, stat tiles) — but the
three panels are **separate floating cards**: Outliner (left), Viewport (centre), Inspector (right).

Run: `python3 -m http.server 8080` in this folder → http://localhost:8080/

| Panel | What works today (JS model) | Hook-up point for the C++ host |
|---|---|---|
| Outliner | groups by figure kind (Sketches → curves, Bodies, Surfaces, Construction, Dimensions), search, kind filter chips, visibility eye, multi-select (⇧), status tiles, undo counter | `doc.figures` ← `SceneDocument` listing |
| Viewport | software raster (Z-up orbit camera, ortho/persp, canonical views), wire/flat/plastic/matcap, lattice, dimension lines, GizmoPRO stub, axis triad, prompt bar for modal tools (L/C/R/B/Y), pick, body/face/edge/vertex mode | replace `draw()` with the PNG/stream from `SoftwareRaster`; forward pointer/keys as `InputEvent` |
| Inspector | hero card (volume/area/length + B-rep stats), presence grid (Visible/Locked/Construction/Dims), transform XYZ steppers + rotation, live parameter sliders that rebuild derived figures, recipe chain, sketch curves + constraint summary, dimensions list (+ add/remove), duplicate/isolate/delete, command line (`box`, `cylinder`, `extrude`, `dim on|off`, `hide`, `show`, `select`, `view`) | `runCmd()` ← send verb to `ConsoleHost`; sliders ← `FigureRecipe` param edit |

Keyboard: `1–4` select mode · `5` ortho · numpad `1/3/7` front/right/top · `L C R B Y` tools · `G R S` (reserved) · `H` hide · `Alt+H` unhide all · `F` frame · `D` dims · `⌫` delete · `Ctrl+Z / Ctrl+Shift+Z` undo/redo · `Esc` cancel/deselect.
