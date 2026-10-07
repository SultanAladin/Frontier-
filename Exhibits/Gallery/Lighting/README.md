# Scene emitter evidence

Browser reference captures for the five scene emitters, beside the native conversion in
`../LightingNative`. Both sets are regenerated from source, not retouched.

| Set                | Produced by                                                    | Checks |
| ------------------ | -------------------------------------------------------------- | ------ |
| `Lighting`         | `Exhibits/Workbench/Lighting/CaptureEmitterCards.mjs`           | 162    |
| `LightingNative`   | `Exhibits/Workbench/Lighting/RunNativeEmitterCards.py`          | 19     |

Each emitter is captured at a wide and a narrow width so the responsive behaviour is visible.
`EditorWithLighting.png` is the whole editor showing the new `Lighting` outliner group.

```sh
# Browser reference
npm --prefix Experimental/FrontierEditor install --no-save puppeteer
npm --prefix Experimental/FrontierEditor run dev -- --host 0.0.0.0 --port 5173
node Exhibits/Workbench/Lighting/CaptureEmitterCards.mjs

# Native conversion
python3 Exhibits/Workbench/Lighting/RunNativeEmitterCards.py
```

The derived photometry is asserted in both runners against the same figures, so the browser and the
native panel cannot drift apart without a proof failing.
