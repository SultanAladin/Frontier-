# Base Mesh & Fracture Editor Port — Working Notes

Dated notes for the native port of the Project Zero editor's base meshes and of the separate fracture
editor page. The delivered description lives in `Docs/InspectorDepotConversion.md`; this file records
what was tried, what was rejected, and what was measured.

## 2026-10-08

### Branch

Continued from `darkenigmainbox/Frontier` `arena/6d5afbaa-frontier` rather than from scratch. Merged with
`--allow-unrelated-histories`; 125 add/add conflicts, all resolved in their favour, since their root
commit is a strict subset of ours and their files are the newer port. Merge `81cf192`.

### Base meshes — what was wrong before the port

The native editor had five base meshes it could construct and no way to tell them apart:

- `EngineContent/Icons/` ships `editor-{cube,sphere,cylinder,torus,cone}.svg`, but `IconSymbols.inc`
  registered 151 of the 161 SVGs and those five were among the ten missing. Every geometry row fell back
  to `IconSymbol::EditorMesh`.
- With no icon to read, `InspectorPanel.cpp:317` recovered the fracture card's primitive by matching
  `Picked.Label` against the five names. The browser never does this — `FractureSpecification.js` reads
  `Subject.Icon` — and the label is wrong in both directions: a duplicated "Cube 2" fails the match, and
  an imported mesh named "Cone bracket" passes one it should fail.

**Rejected:** widening `EditorGlyph`. It mirrors `OutlinerIconCategory` 1:1 offset by `Auto`, so adding
five entries means touching every consumer of both enumerations. The identity rides on
`EditorInstance::Artwork` (an `IconSymbol`) instead, which already existed and already won over the
category in `OutlinerPanel::ArtworkFor`.

**Checked before editing `IconSymbols.inc`:** both baked manifests
(`EngineContent/Icons/Baked/{Manifest,NativeConstructManifest}.json`) are name-keyed, not index-keyed, so
inserting the five enumerators in alphabetical position does not shift any baked lookup.

**Trap hit once, recorded so it is not hit again:** `ConstructKind` is
Cube/Sphere/Cylinder/Cone/Plane/Torus; the roster is Cube/Sphere/Cylinder/Torus/Cone. The first version
of `EditorFeedSequence.cpp` indexed `kBaseMeshArtwork` by `PlacementRecord::BaseMesh` directly and gave a
torus a cone's icon. Both crossings now go through a named function — `ConstructArtwork` and
`MarkerPrimitive` — and the proof asserts `int(Primitive::Cone) != int(Solid::Cone)` so a future cast
fails loudly.

`SceneCodec` was deliberately **not** touched: `PlacementRecord::BaseMesh` is authoring-only, defaulted
to `kNoBaseMesh`, and nothing serialises it yet.

### Fracture editor — what the bundle actually ships

Read from the built `Experimental/FractureEditor/index.html`, not from the `.js`/`.css` beside it.

- The embedded ProjectZeroEditor rules come **before** FracturePanel.css in the one `<style>`, so
  `input[type="range"]` keeps its gradient, height 26, radius 30 and border 0 even though the later
  `input,select{…border-radius:5px}` would otherwise flatten it. `select` does end at height 32,
  radius 5, padding 9. This ordering was verified in the 167,702-byte style block, not assumed.
- `MATERIALS` is not inlined in the page. The Gc and density figures come from
  `SourceDepot/Fragmentation/src/fracture/materials.ts`, and `BundleParity.py` now checks them there.
- The bake dot's three colours (`#89a591`, `#aa795a`, `#555`) are assigned by `Refresh()`, not by the
  stylesheet, so they are checked against the script text rather than the sheet.

### Deliberate deviations

| Deviation | Why |
| --- | --- |
| The `#viewport` canvas is stood in for by `CheckerViewport`'s analytical marker | UI-only port; no solver and no renderer behind it. The toolbar, overlay, controls and metrics are as shipped. |
| `SdfBlockHeight()` deleted | It was dead and wrong — it called `ProseHeight(nullptr, …)`. `StoredCardHeight` measures the SDF block inline. |
| `BaseMesh` kept as a spelling | `Base` and `Mesh` are both on the `SKILL-Naming.md` banned list, but "base mesh" is the reference's own term for these five analytical primitives and the register already uses it. Flagged for `Plans/Ongoing/BannedWordRemediation.md` rather than renamed unilaterally. |
| `Paint…`, `Settings`, `Mode` kept | Established vocabulary of the sibling `Engine/Editor/*Surface.h` headers. Diverging in two files would be worse than the existing debt. |

Renamed to clear the skill where nothing in the reference anchored the word: `Model` → `Subject`,
`Kind` → `Solid` (the roster) and `Shape` (the field), `Bake` (the enumeration) → `Freshness`.
`Storage` could not be used for the last of these because `Subject::Storage` is already the "Browser ·
per object" row.

### Measurements

| Check | Result |
| --- | --- |
| `Exhibits/Workbench/BaseMesh/RunNativeBaseMesh.py` | PASS 66, four captures |
| `Exhibits/Workbench/FractureEditor/RunNativeFractureEditor.py` | PASS 121, six captures |
| `Exhibits/Workbench/BundleParity.py` | PASS 428, up from 235 |

The fracture-editor page is captured at 1440 × 900 (dynamic, baked + SDF, fragments, disabled),
1120 × 760 (the ≤ 1180 breakpoint) and 1280 × 2080 (one tall frame so the whole inspector column is on
the page rather than under its scroll).
