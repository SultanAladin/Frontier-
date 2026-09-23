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
- `AutomotiveUvSurfaceDetail.png` — close standalone carbon dual-weave and wrapped tire-tread UV review. The UVs are
  carried per triangle, interpolated at each hit, and evaluated by the shared analytic surface-detail functions.
- `AutomotiveDispersionAndTir.png` — three solid dielectric IOR cases traced with wavelength-specific Cauchy indices,
  including the runtime TIR/refracting validation gate.
- `AutomotiveLightingOptics.png` — real faceted reflector geometry with red and amber solid lenses using separate
  attenuation distances.
- `AutomotivePaintFlakeFlopComparison.png` — the same red tri-coat paint from a face-on and grazing camera. The
  deterministic analytic flake signal and grazing-angle flop are active in both panels.

The geometry is generated from UV-parameterized spheres, torus rings, and a cylinder. The flake and UV detail passes
are texture-free analytic fallbacks in the shared Slang profile so the CPU review remains exact; host texture binding
and authored assets remain deferred until this preview is accepted.

The saved implementation plan is `References/AutomotiveMaterials-Plan.md`.

The flake pass uses the shared three-band analytic signal both for material modulation and a bounded microfacet-normal
perturbation. A deterministic randomized bank of invisible area lights feeds the existing NEE/MIS path, making the
silver/blue flakes readable as direct-light reflections without adding emissive paint decals or visible light cards.
