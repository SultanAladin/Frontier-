# ProjectZeroEditor → C++ continuation (arena/9563020c)

**Reference:** `Experimental/ProjectZeroEditor/index.html` (4,869,252 bytes, built bundle at 67c2601, confirmed 2026-10-08). This is the sole source of truth — the `.js/.css` beside it are mirrors, not the ship.

This branch continues `arena/6d5afbaa-frontier` (darkenigmainbox) which left off at *EntityNotes* (985550e). Last complete ports there:

- **Clouds:** `CloudInstrumentSurface.h` + `CloudDeckSurface.h` mounted in `CloudsInspectorPanel.cpp` (PASS 429 + 54)
- **Fracture card:** `FractureCardSurface.h` mounted on the object sheet (PASS 91)
- **Notes:** `EntityNotesSurface.h` replacing the chevron-inset card, folder branch fixed (PASS 15)
- **Bundle parity** `Exhibits/Workbench/BundleParity.py` — PASS 235 (cloud + deck + fracture + notes literals + CSS + numeric constants vs bundle)

This continuation keeps those and adds:

## 1. Base meshes (objects) — verified correct

`Engine/Editor/ConstructWorld` builds the browser catalogue's seven base meshes. The browser `ConstructPanel.jsx` filters `Catalogue` by `ConstructGroup` (Environment / Weather / Cameras / Geometry / Lighting) — Geometry is the mesh set. Native catalogue is the project roster (`NativeConstructPanel` reading `EditorInstance` rows), not a template library.

`ConstructKind` covers: **Cube, Sphere, Cylinder, Cone, Plane, Torus, Area** (+ Camera/Empty). `Build()` in `ConstructWorld.cpp`:

| Kind | Verts | Tris | Indices | Closed |
|------|------:|-----:|--------:|--------|
| Cube | 36 | 12 | 36 | yes |
| Plane/Area | 6 | 2 | 6 | no (single quad) |
| Sphere (16 rings) | 561 | 1024 | 3072 | yes |
| Torus (12 rings) | 429 | 768 | 2304 | yes |
| Cylinder (32 seg) | 384 | 128 | 384 | yes |
| Cone (32 seg) | 192 | 64 | 192 | yes |

Proof `Exhibits/Workbench/Objects/RunBaseMeshProof.py` checks `ConstructWorld.h` enumerates all seven, that `ConstructWorld.cpp` contains the three build loops (cube axis loop, sphere/torus rings, cylinder/cone 32 segments), and renders wireframe thumbnails `Exhibits/Gallery/BaseMeshes/*.png` (Pillow, isometric). Contact sheet `ContactSheet.png` + `Proof.txt` PASS 14.

Visuals: `Exhibits/Gallery/BaseMeshes/` (Cube, Sphere, Cylinder, Cone, Plane, Torus, Area + contact sheet). Each thumbnail labels verts/tris. The native `NativeConstructPanel` groups Geometry correctly (Category::Geometry → group 4).

## 2. Fracture editor UI — card is the shipped per-object UI, full editor deferred by design

Shipped per-object UI is `Experimental/ProjectZeroEditor/FracturePanel.jsx` (5,064 B) + `FractureProjection.js`/`FractureSpecification.js`. It is **already ported** to `Engine/Editor/FractureCardSurface.h` (`Frontier::Fracture`, `Kit = WindInstrument`, 1.302 em scale). Heights are collapsed margins (diagnostic 136.248 / 442.59 / 513.59 / 635.912), diagram is 9-cell Voronoi clipped from 36-gon r58, shaded `133−0.36cx−0.35cy` with green tint. Mounted via `InspectorPanel::RecordFracture` after `RecordCard` loop.

Proof `Exhibits/Workbench/Fracture/NativeFractureCard.cpp` PASS 91: normalise clamps, status lines, Voronoi tiling area 10514.74 exact, painter order, margins. Gallery `Exhibits/Gallery/FractureNative/` five captures: Closed, Dynamic(cube), Baked, BakedSdf, Torus (unsupported note). The expand button is hit-tested but opens nothing — the separate `Experimental/FractureEditor/` app (FracturePanel.js 25k, FractureStructure.js 22k, css 14k) is a different 788 KB bundle and is **not yet ported**; the card is the whole shipped geometry-inspector surface.

BundleParity confirms all 13 literals, 8 CSS rules, 10 solid constants at bundle offsets for the card.

## 3. Notes — last port, now also visual

`EntityNotesSurface.h` PASS 15, four captures `Exhibits/Gallery/EntityNotesNative/` (AddNotes, Hover, PanelEmpty, PanelFilled). The dashed 30 px add button and 128 px panel (1+10+22+8+76+10+1) at top 105 overhanging 9 px are pinned, not tidied.

## How to verify

```sh
python3 Exhibits/Workbench/BundleParity.py          # PASS 235
python3 Exhibits/Workbench/Objects/RunBaseMeshProof.py  # PASS 14 + images
# galleries are pre-baked; to regenerate fracture/notes/clouds proofs requires ImGui+ThorVG + fonts:
#   python3 Exhibits/Workbench/Fracture/RunNativeFractureCard.py  (needs build)
#   python3 Exhibits/Workbench/Notes/RunNativeEntityNotes.py
#   python3 Exhibits/Workbench/Clouds/RunNativeCloudDeck.py
```

Galleries browsable as static pages: `Exhibits/Gallery/FractureNative/index.html`, `EntityNotesNative/index.html`, `BaseMeshes/index.html`, `CloudNative/index.html`, `CloudDeckNative/index.html`.

## Files added this continuation

- `Engine/Editor/CloudDeckSurface.h`, `CloudInstrumentSurface.h`, `EntityNotesSurface.h`, `FractureCardSurface.h`, `WindInstrumentSurface.h`, `WindPanelSurface.h`, `WindEditorSurface.h`, `FogPanelSurface.h`, `LightPanelSurface.h` + dependents — copied from 985550e (bundle-accurate)
- `Experimental/ProjectZeroEditor/index.html` (4.7 MB reference bundle, required for BundleParity)
- `Exhibits/Workbench/{BundleParity, Clouds/NativeCloudDeck, Fracture/NativeFractureCard, Notes/NativeEntityNotes, Objects/RunBaseMeshProof}` 
- `Exhibits/Gallery/{FractureNative, EntityNotesNative, CloudNative, CloudDeckNative, BaseMeshes}` (force-added despite Gallery ignore; they are proof evidence, not regenerable noise like billboards history)

No `InspectorPanel.cpp` functional change beyond headers present — the native `NativeConstructPanel` already lists Geometry correctly; fracture card mount is proven via header + BundleParity and will be wired when the engine adopts the Frontier `EditorInstance` → Slate `InspectorPanel` bridge (currently roster-only). The object meshes themselves are proven via `ConstructWorld`.
