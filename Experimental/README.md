# Experimental browser prototypes

These browser design studies are separate from the native C++ editor.

| Prototype | Entry point |
| --- | --- |
| Frontier Editor — outliner, inspector and sliding Construct menu | [FrontierEditor/index.html](FrontierEditor/index.html) |
| SVG icon gallery | [FrontierEditor/icons.html](FrontierEditor/icons.html) |
| Collection-icon options | [FrontierEditor/collection-icon-options.html](FrontierEditor/collection-icon-options.html) |
| Project Zero Road Editor — large-map road and city editor (lanes, junctions, props, undo, JSON and glTF) | [ProjectZeroRoadEditor/index.html](ProjectZeroRoadEditor/index.html) |

The editor's JSX/CSS, SVG assets, package files, browser scripts and vendor
provenance moved together into `FrontierEditor/`, preserving relative links.
The two standalone galleries can also be opened directly in a browser.

From the repository root:

```sh
npm --prefix Experimental/FrontierEditor ci
npm --prefix Experimental/FrontierEditor run dev -- --port 5173
npm --prefix Experimental/FrontierEditor run build
```

Production output goes to `Experimental/FrontierEditor/dist/` and includes all
three pages plus their assets. No npm package or web entry point remains at the
repository root.

Native C++ sources and runtime assets have **not** moved. Generated native
proof/report HTML stays in `Exhibits/Gallery/` with its associated evidence.
The native icon import/bake tools now use the approved SVG sources here.

## Project Zero Road Editor

`ProjectZeroRoadEditor/` is a standalone Vite app (three.js, plain JS) for
road networks on an NFS-scale map. Roads are Catmull-Rom centrelines with
per-road lane lists, markings and props. Junctions are shared nodes with one
asphalt pad each. The map is streamed in 400 m tiles. Buildings are not
generated.

```sh
npm --prefix Experimental/ProjectZeroRoadEditor ci
npm --prefix Experimental/ProjectZeroRoadEditor run dev
npm --prefix Experimental/ProjectZeroRoadEditor test
npm --prefix Experimental/ProjectZeroRoadEditor run build
```

Known limitations: junction pads are convex hulls, so corner quadrants are not
filled and there are no fillets. The editor has not been run in a real browser
in this environment, so visual checks are still needed.
