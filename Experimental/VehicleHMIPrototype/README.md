# Vehicle HMI / RESTIR prototype reconstruction

This directory contains the text-source reconstruction of the prototype carried by `01a141bc-a4a3-72ce-8295-398724231feb.patch` in the upstream `RESTIR DEMO + HMI` commit (`66e358850689cd65c7dbcef12d2183d9e684385a`). It is organized as a normal project tree rather than retaining the patch file. The HMI app is in `../interactive-vehicle-hmi-configurator/`.

## Source-fidelity note

The committed patch used Git's abbreviated `Binary files differ` representation for three `.facet` geometry archives and three WOFF2 font files; those binary payloads are not embedded in that patch and cannot be reconstructed from it. The text files have been restored under `IlluminationHost/`. Recreate the facet archives with `IlluminationHost/Archive/FacetArchiveCodec.py` from the documented Frontier source checkout before running the host; supply the font files separately as described in the host README. No opaque or fabricated binary placeholders are included.

## HMI material and vehicle display

The configurator uses Zustand state for paint/finish and wheel choices. Dragging a swatch dispatches an `applyReq` with the selected material and raycast position; the Three.js truck applies the choice to the hit body panel (or the whole paintable body for a non-targeted finish change). The truck also has the scan/ghost presentation with transparent hologram and clipped wire edges. This is an interactive Three.js prototype, not a connection to a separate native C++ runtime: applying a material updates the car rendered in this HMI scene.

Run from `Experimental/interactive-vehicle-hmi-configurator/` with `npm ci`, `npm run dev`; use `npm run build` for a production build.

## Next-iteration vehicle plan

1. Remove/disable tyre carcass deformation until its behavior and visual quality are validated.
2. Upgrade sparks: collision against world geometry, physically plausible yellow-white hot core fading through orange to darker tones, and emissive contribution/nearby light response.
3. When a tyre is shredded, stop generating rubber skid marks and emit rim-contact marks instead.
4. Add steering assistance (likely steering-angle/heading correction; confirm the desired assist behavior and strength before implementation).
5. Verify the physics backend and report whether Jolt is actually integrated before planning a migration. Do not assume the prototype's custom rigid-body code is Jolt.

These are planning items only; no tyre, spark, steering, or physics changes are made in this reconstruction pass.
