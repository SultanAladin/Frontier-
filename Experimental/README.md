# Experimental browser prototypes

These browser design studies are separate from the native C++ editor.

| Prototype | Entry point |
| --- | --- |
| Frontier Editor — outliner, inspector and sliding Construct menu | [FrontierEditor/index.html](FrontierEditor/index.html) |
| SVG icon gallery | [FrontierEditor/icons.html](FrontierEditor/icons.html) |
| Collection-icon options | [FrontierEditor/collection-icon-options.html](FrontierEditor/collection-icon-options.html) |
| Interactive vehicle HMI configurator — paint/wheel drag-and-drop, holographic scan and Three.js vehicle preview | [interactive-vehicle-hmi-configurator/index.html](interactive-vehicle-hmi-configurator/index.html) |
| **IlluminationHost vehicle/HMI prototype (pre-C++)** — WebGPU/ReSTIR GI, proving grounds, vehicle simulation, cabin TabletPanel, live material editing, ghost/wireframe Garage preview | [IlluminationHost/index.html](IlluminationHost/index.html) |

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

The vehicle configurator is a separate React/Vite study:

```sh
npm --prefix Experimental/interactive-vehicle-hmi-configurator ci
npm --prefix Experimental/interactive-vehicle-hmi-configurator run dev -- --host 0.0.0.0
npm --prefix Experimental/interactive-vehicle-hmi-configurator run build
```

`IlluminationHost/` is a static WebGPU application; run it from its own folder
with `python3 -m http.server 8080` and open `http://localhost:8080/` in a WebGPU
capable browser. Its cabin Garage applies materials to the live vehicle model.

Native C++ sources and runtime assets have **not** moved. Generated native
proof/report HTML stays in `Exhibits/Gallery/` with its associated evidence.
The native icon import/bake tools now use the approved SVG sources here.

`IlluminationHost/` is the reconstructed JavaScript/WebGPU vehicle and HMI
prototype to iterate on before the future native C++ port. It was imported from
`SultanAladin/Slate` (branch `arena/c6cba543-slate`, commit `e7c4ea47`) and
developed further here — the Frontier Editor shell, proving grounds, lighting,
vehicle simulation, cockpit TabletPanel, and live Garage materials. See
[IlluminationHost/README.md](IlluminationHost/README.md).
