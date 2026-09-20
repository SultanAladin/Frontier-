# SolidArc

SolidArc is the C++ CAD/modelling tool ported from `streamlinkinbox/Frontier` branch `arena/01a0b989-frontier`.

Current placement:

```text
Editor/AuthoringTools/Modelling/SolidArc
```

This keeps it in the editor authoring-tool tree beside future `TexturePainting`, `Baking`, and `Terrain` tools, instead of mixing it into the runtime `Engine/Editor` panel code.

This import intentionally contains the C++ side only:

- kernel NURBS/B-rep modelling code,
- document/undo model,
- console command host,
- interaction and gizmo helpers,
- software-raster presentation proof path,
- C++ verification sources.

It intentionally excludes the upstream HTML panel, PNG proof artifacts, `.arc` script assets, and browser-only verification files.

## Standalone build

```bash
cmake -S Editor/AuthoringTools/Modelling/SolidArc -B /tmp/solidarc-build
cmake --build /tmp/solidarc-build --target SolidArc
```

To compile the C++ verification targets too:

```bash
cmake --build /tmp/solidarc-build --target SolidArcVerification
ctest --test-dir /tmp/solidarc-build --output-on-failure
```

The dependency-free repository gate is:

```bash
Tools/Build/CheckSolidArc.sh
```

It compiles and links the console target with `g++`, then compile-checks every C++ verification translation unit. This is the fallback gate for sandboxes that do not have CMake installed.
