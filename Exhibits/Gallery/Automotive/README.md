# Automotive material preview

This is a standalone review scene. It is intentionally **not** part of Project-Zero and does not change the existing
runtime material records or scene.

## Exact CPU reference

The preview is built by:

```text
bash Exhibits/Workbench/Automotive/RunAutomotiveMaterialPreview.sh
```

The harness includes `Engine/Shaders/MaterialEvaluation.slang` as C++ through the same CPU-port path used by the
materials furnace. The automotive profile constructors live in `Engine/Shaders/AutomotiveMaterialProfiles.slang`, which
is included by `MaterialEvaluation.slang` and therefore is shared with the GPU shader source.

## Sheets

- `AutomotiveMaterialSuite.png` — tri-coat paint, carbon/resin, red tail lens, brushed brake alloy, heat-tinted
  titanium, tire rubber, and Alcantara on procedural preview geometry.
- `AutomotiveOpticsAndCoatings.png` — clear headlight glass, red tail-lens glass, blue tri-coat paint, brushed alloy,
  and thin-film titanium in a closer optics/coating arrangement.

The geometry is generated from UV-parameterized spheres, torus rings, and a cylinder. The current profiles are
constants-only; UV-backed carbon weave, flakes, and tread textures are deliberately deferred until this preview is
accepted.

The saved implementation plan is `References/AutomotiveMaterials-Plan.md`.
