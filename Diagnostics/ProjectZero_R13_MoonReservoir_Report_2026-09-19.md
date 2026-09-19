# Project-Zero R13 — Moon Reservoir Candidate

Branch: `arena/01a0b62f-frontier`

## Implemented

The moon is no longer only a flat ambient term. It now participates in the ReSTIR direct-light reservoir as an analytic distant disc light.

### What changed in `Engine/Shaders/ReSTIRViewport.slang`

- Added analytic moon sentinels:
  - `0xFFFFFFF0..0xFFFFFFF3` for up to four moon slots.
  - The sun remains `0xFFFFFFFF`.
- Added moon helpers:
  - phase factor
  - solid angle
  - irradiance estimate
  - disc radiance
  - cone sampling
  - weighted moon-slot selection
- Added a three-way direct candidate picker:
  - sun
  - moon
  - emissive mesh luminaires
- Moon candidates use the same reservoir machinery as sun/mesh candidates:
  - RIS initial candidates
  - extra same-pixel candidates
  - temporal reuse
  - compatibility-guided spatial reuse
  - M clamp
  - final visibility trace
  - GI reservoir reuse at first-bounce vertices
- Analytic moon samples are stored as far points like the sun, so `TraceShadow()` casts a real scene shadow ray toward the sampled moon direction.

## Expected visual result

At night, if a visible moon is above the horizon, surfaces can now receive **directional moonlight with shadows** instead of only `MoonAmbient()`.

This matters for the user's screenshot case: sun elevation was about `-32.5°`, so sun shadows were physically impossible. With this patch, a visible moon can still cast direct ReSTIR shadows at night.

## Probability model

Candidate shares:

- Night moon vs mesh lights: moon gets 25% of direct candidates when it is up.
- Day moon: moon gets 5% so it remains discoverable but does not steal the sun/lamp budget.
- If moon is the only direct source, it gets 100%.

Moon slot selection is weighted by estimated moon irradiance:

- brightness
- phase
- elevation over horizon
- direct irradiance scale

## Still pending

- Moon direct lighting is now in the ReSTIR direct and GI-reservoir candidate paths.
- The separate SSS below-stratum and non-GI-pool fallback bounce path still only sample sun/mesh; this is a smaller follow-up if moon-through-SSS is needed.
- Moon ambient remains in place, so night scenes keep a soft fill under moonlight. The new direct term adds directional shadows on top.
- Full polymorphic punctual/spot/IES light buffer is still pending.

## Validation in sandbox

- `Tools/Build/CheckShaderTableParity.sh` — GREEN.
- `Tools/Build/CheckShowcaseLevel.sh` — GREEN.
- `Tools/Build/CheckTelemetryProbe.sh` — GREEN.
- `Tools/Build/CheckPerformanceTelemetry.sh` — GREEN.
- `Tools/Build/CheckBuildSourceList.sh` — GREEN.
- `Tools/Build/CheckShaders.sh` — SKIPPED: no Vulkan SDK shader compiler in this sandbox.

## What to verify on Windows

1. Set a night time where the moon is above the horizon.
2. Confirm the ground/object shadows are visible under moonlight, not only under emissive spot/panel lights.
3. Compare Standard FPS and Ultra/Reference FPS, because moon candidates reserve some sampling probability at night.
4. Send the next telemetry report and screenshot so we can tune `kMoonDirectIrradianceScale` and the 25% night candidate share if it is too weak or too bright.
