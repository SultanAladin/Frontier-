# CarHmi prototype — tablet + cluster

HTML-first HMI for the PROTO-X interior, per `Docs/CarHmiReport.md` §10.
Landscape tablet (`index.html`) + instrument cluster (`cluster.html`).
Deliberately DOM + Canvas: this prototype pins layout, copy, touch feel and
the control bindings — the WebGPU fidelity questions (glass, off-axis, bloom)
were already answered by SpatialHud and are not re-proven here.

```sh
cd Experimental/CarHmi
python3 serve.py --port 8099   # no-store headers; never plain http.server
```

Then open `/index.html` (tablet) and `/cluster.html` (cluster).

```sh
node --test Checks.mjs          # theme / bindings / gesture / snapshot pins
```

## What is in it

- Tablet shell: status bar, icon rail, app grid, 12 pages, quick shade,
  on-screen keyboard, boot overlay (stardust → streak sweep → logo → systems).
- Vehicle pages bound to the real `arena/215a6f39-frontier` tunables
  (`BINDINGS` in `js/pages-vehicle.js` cites the owning C++ header per row).
- Online pages with mock data shaped like the EOS lobby/match split; the tab
  keeps the decided name **Session**.
- Car preview: own canvas world, own turntable camera, own studio rig,
  18 Hz, pauses when hidden.
- Cluster: tach + speed dual gauge, gear, shift lights, telltales, 30 Hz
  redraw with needle-sweep self-test.

## C++ landing spots (report §8)

| Prototype | C++ |
|---|---|
| `js/theme.js` | `HmiWorldStructure` theme block |
| `js/snapshot.js` | vehicle snapshot struct per HMI tick |
| `js/touch.js` | `HmiTouchProjection` (same state machine, ray→UV source) |
| `js/pages-vehicle.js` BINDINGS | `HmiWorldStructure` control bindings |
| `js/preview.js` | HMI 3D viewport (existing raster, new view setup) |
| `js/particles.js` BootFX | `HmiBootSequence` particle layer |
| `css/carhmi.css` | ControlKit-on-offscreen-target styling |
