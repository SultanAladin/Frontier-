# Automotive materials — standalone preview plan

## Goal

Build and review the automotive material suite in a separate scene before touching Project-Zero's scene construction,
material serialization, or runtime UI. The preview is the acceptance gate: the material profile source and the CPU
reference render must use the same Slang text that the GPU material evaluator includes.

## Current milestone — standalone profile and render gate

Implemented in this branch:

- `Engine/Shaders/AutomotiveMaterialProfiles.slang`
  - shared constructors for the automotive profiles
  - included by `Engine/Shaders/MaterialEvaluation.slang`, so CPU and GPU see the same source
  - no duplicate CPU-only BSDF implementation
- `Exhibits/Workbench/Automotive/AutomotiveMaterialPreview.cpp`
  - procedural UV-parameterized sphere, torus, and cylinder geometry
  - separate rack scene, not Project-Zero
  - renders through the exact `MaterialEvaluation.slang` OpenPBR evaluator compiled as C++
- `Exhibits/Workbench/Automotive/RunAutomotiveMaterialPreview.sh`
  - reproducible build/render driver
- `Exhibits/Gallery/Automotive/`
  - review images and the scene README

### Profiles in the preview

| Profile | Shared evaluator features exercised |
|---|---|
| Tri-coat paint | metallic base, GGX, high-IOR clearcoat, coat roughness and layer darkening |
| Carbon/resin | dark metallic base, orthogonal anisotropy, clear resin coat |
| Clear headlight glass | solid transmission, IOR, Fresnel, Beer volume and medium traversal |
| Red tail-lens glass | red Beer-Lambert absorption, solid transmission and Fresnel |
| Brushed alloy / brake rotor | metallic F82 Fresnel, anisotropy and roughness |
| Heat-tinted titanium | metallic GGX plus the shared thin-film Airy model |
| Tire rubber | high roughness, low dielectric specular, high diffuse roughness |
| Alcantara | shared cloth/fuzz sheen lobe |

## Render outputs

- `Exhibits/Gallery/Automotive/AutomotiveMaterialSuite.png`
- `Exhibits/Gallery/Automotive/AutomotiveOpticsAndCoatings.png`

These are reference images, not GPU captures. They are rendered from the shipped evaluator compiled as C++ so the
material math is identical to the Slang evaluator. GPU lowering/runtime validation remains a separate machine gate.

## Next implementation stages

### A. Procedural flakes and flop

1. Add an explicit automotive parameter block to the material authoring/profile format.
2. Add deterministic dual-scale flake density/jitter and micro-roughness to the shared Slang profile layer.
3. Add view-angle flop from face tint to grazing tint using the canonical `AutomotiveFlopColor` curve.
4. Keep a texture-free analytic fallback for CPU/GPU parity.
5. Add a close-up render with direct sunlight and a grazing camera angle.

### B. UV-backed surface detail

1. Extend the preview mesh path to carry UVs through the CPU mirror.
2. Add UV dual-weave carbon and tire tread test textures.
3. Keep the authored textures outside Project-Zero until the preview acceptance sheet is approved.

### C. Lighting optics

1. Add Cauchy dispersion as a shared profile parameter and verify wavelength-separated paths.
2. Add faceted reflector geometry and a red/amber lens with measured attenuation distance.
3. Add a TIR/dispersion comparison sheet at multiple IOR values.

### D. Host integration — intentionally not started

Only after the standalone images are accepted:

1. add material serialization fields and decode/build parity checks;
2. map profiles into Project-Zero's material records;
3. integrate car meshes and UV assets in a separate Project-Zero automotive scene;
4. add UI controls and GPU SPIR-V captures;
5. preserve existing ReSTIR, GI, reflection controls and the deferred sky reservoir.

## Acceptance gate before integration

- CPU and Slang compile the same profile source.
- All profile renders have zero non-finite/out-of-range samples.
- Clear and red solid glass show transmission, Fresnel reflection, Beer tint, and TIR behavior.
- Aluminum/alloy reflections remain opaque and do not inherit glass medium attenuation.
- Thin film shows an angle-dependent tint without changing the metal transport branch.
- No Project-Zero source or scene is changed by the preview milestone.
- GPU capture is run only after the shader toolchain is available.
