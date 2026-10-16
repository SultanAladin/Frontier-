# Vehicle + WebGPU/ReSTIR archive

Saved under `Experimental/` for later use, without integration into SolidArc,
other native C++ targets, or the current preview servers. Imported 16 October 2026.
No application, dependency installer or renderer was run for this import.

## Exact snapshot

- Source: <https://github.com/streamlinkinbox/Frontier>
- Requested commit: `8c375ce1a0384ca03971f0316b307089c8f7606d`
- Commit title: “Checkpoint complete vehicle prototype and reference configurator before lighting work”.
- Complete `Experimental/VehicleHmiPrototype/` and
  `Experimental/interactive-vehicle-hmi-configurator/` directories are copied
  byte-for-byte, not merely the files changed in that commit.
- Source, WGSL shaders, vehicle facet archives, font licence, documentation,
  tools/tests, package manifests and lockfiles retain their upstream paths.
- `UPSTREAM_MANIFEST.json` covers both directories with upstream Git blob IDs,
  byte sizes and SHA-256 checksums. Import notes/manifests are additions; original
  application files are not edited. No nested `.git`, `node_modules` or build
  output was added.

## What is actually here

1. **VehicleHmiPrototype**: JavaScript/WebGPU, WGSL, Jolt WebAssembly physics,
   vehicle driving and cabin HMI. Includes distance-field GI, surface cards,
   ReSTIR GI temporal/spatial reservoir reuse, reflections and reconstruction.
   See `Source/ResamplingSequence.js`, `Shader/ReservoirTemporal.wgsl`,
   `Shader/ReservoirSpatial.wgsl` and the original [README.md](README.md).
2. **interactive-vehicle-hmi-configurator**: separate React/Three.js reference
   configurator, preserved alongside this prototype at its original path.
   Rendering code is in `../interactive-vehicle-hmi-configurator/src/`.

These are source identifications, not new rendering/performance validation.
Browser/WebGPU capability and package installation are still needed when used.

## History retained, not just a flattened copy

The import merge retains the exact `8c375ce…` commit and all five commits in its
upstream history as Git ancestors, while keeping this repository's existing
working tree as the first-parent baseline.

The upstream vehicle README traces the earlier GI/ReSTIR implementation to
`SultanAladin/Slate`, commit
`e7c4ea47b9a8880f476f31b79863d7b8b2dcaff6` (“Add WebGPU distance-field GI exhibit:
one scene distance field, surface cards, ReSTIR GI, ControlVehicle”). That exact
commit and its 94-commit history are also retained as an import-merge ancestor.
Its original exhibit was `Exhibits/IlluminationHost`; the supplied vehicle snapshot
remains the version copied into this working tree. No later Slate screen-trace
revision is imported into the archived application.

Original upstream root files, including its root patch, remain accessible through
that history instead of overwriting this repository's root files:

```sh
git show 8c375ce1a0384ca03971f0316b307089c8f7606d:Experimental/README.md
git log --oneline 8c375ce1a0384ca03971f0316b307089c8f7606d
git log --oneline e7c4ea47b9a8880f476f31b79863d7b8b2dcaff6 -- Exhibits/IlluminationHost
python3 Tools/Build/VerifyVehicleArchive.py
```

The existing SolidArc changes and shader-editor archive are preserved in the
first-parent commit immediately before this import. Neither application is
connected to the vehicle archive.
