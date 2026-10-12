# Frontier Editor — experimental HTML prototype

This folder contains the browser editor and its companion design studies:

- `index.html`: the React outliner/inspector and Construct menu (requires Vite).
- `road-editor.html`: the spline Road Editor — procedural 6×6 km road network
  workbench (Unreal fly cam, 33 road types, 8 bridge families, topology audit).
- `icons.html`: standalone SVG icon gallery.
- `collection-icon-options.html`: standalone collection-icon design options.

```sh
# Run from this directory
npm ci
npm run dev -- --port 5173
npm run build
```

Visit `/`, `/road-editor.html`, `/icons.html` or `/collection-icon-options.html`
on the dev server. The build places all pages and required SVGs in `dist/`.

## Road Editor (`road-core/` + `road-editor.jsx`)

Headless core (runs in Node, no DOM): `graph.js` (spline network, precise
non-boolean merging — crossings split and share one junction polygon, never
stacked slabs), `cityGen.js` (seeded 6×6 km city + countryside generator),
`meshBuilder.js` (ribbons, markings, furniture, bridges), `bridges.js`,
`roadTypes.js`, `validate.js` (8-check topology audit), `viewport.js`
(Three.js Unreal fly-cam viewport). React workbench in `road-editor.jsx`.

```sh
# headless audit across seeds (expect 8/8 CLEAN, 0 down-facing tris)
node --input-type=module -e "
import('./road-core/cityGen.js').then(async ({ generateCity }) => {
  const { buildNetworkMeshes } = await import('./road-core/meshBuilder.js');
  const { auditTopology } = await import('./road-core/validate.js');
  for (const seed of [20261012, 777, 424242]) {
    const { graph } = generateCity(seed);
    const meshes = buildNetworkMeshes(graph, { groundYAt: () => 0 });
    const a = auditTopology(graph, meshes);
    console.log(seed, a.passed + '/' + a.total, a.clean ? 'CLEAN' : 'DIRTY');
  }
});"
```

Camera: WASD fly · Q/E down/up · RMB look · wheel speed+dolly · Shift boost ·
F focus. Editing: V select (drag orange handles, crossings re-merge) · D draw
(click points, Enter commits). Height gaps ≥ 0.6 m stay grade-separated.

The existing Construct creation bridge remains a separate native process. Start
it from the **repository root**, not this directory:

```sh
python3 Exhibits/Workbench/Construct/Build.py
python3 Exhibits/Workbench/Construct/Serve.py
```

Vite still proxies `/api/construct` to port 5191. Without that service, native
creation reports an error; the editor and standalone galleries still load.
Native C++ panel integration is documented in
[Native.md](../../Exhibits/Workbench/Construct/Native.md).

Browser scripts are in `scripts/`; run them from this directory. For example:

```sh
python3 scripts/serve-icons.py --port 5174
```

Keep approved SVG sources in `custom-icons/` and `ui-icons/`, and preserve vendor
notices in `vendor/`. Native runtime copies remain in `EngineContent/Icons/` at
the repository root. This move does not expand the engine's supported entities.
