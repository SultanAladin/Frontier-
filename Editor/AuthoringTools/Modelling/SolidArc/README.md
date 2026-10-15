# SolidArc

SolidArc is the C++ CAD/modelling tool ported from `streamlinkinbox/Frontier` branch `arena/01a0b989-frontier`.

Current placement:

```text
Editor/AuthoringTools/Modelling/SolidArc
```

This keeps it in the editor authoring-tool tree beside future `TexturePainting`, `Baking`, and `Terrain` tools, instead of mixing it into the runtime `Engine/Editor` panel code.

This import contains the C++ side of the tool:

- kernel NURBS/B-rep modelling code,
- document/undo model,
- console command host,
- interaction and gizmo helpers,
- software-raster presentation proof path,
- a standalone C++ GLFW/ImGui shell with Vulkan swapchain presentation,
- a Construct catalogue for reference planes, sketch primitives, solids and surface primitives,
- shared-editor outliner, viewport and inspector adapters,
- optional ImGui editor shell,
- C++ verification sources,
- lightweight `.arc` sample construction journals for ToyCar, ToySailboat and ToyBiplane testing.

The SolidArc editor shell reuses the engine editor panels while presenting SolidArc-specific content:

- `OutlinerPanel` is fed CAD folders matching the live HTML panel: `Sketches`, `Bodies`, `Surfaces`, `Construction`, `Dimensions`, `Constraints`, with SolidArc-only filter labels (`Lines`, `Profiles`, `Bodies`, `Surfaces`, `Construction`, `Dimensions`) and the exact CAD category colours from the web editor (`#4fd8e0`, `#ffb454`, `#4da3ff`, `#b48cff`, `#e5d33a`).
- `ViewportPanel` switches to SolidArc chrome with `Construct`, `Body/Face/Edge/Vertex`, shared `Flat/Matcap` shading, `Move/Rotate/Scale`, and view controls. The default is the shared baked shiny-chrome matcap.
- `InspectorPanel` receives a CAD sheet with identity, B-rep/NURBS geometry, bounds, parametric blueprint slots, sub-selection counts, and display controls.

The upstream browser HTML panel and PNG proof artifacts are still not built into the runtime; the native editor reproduces the relevant controls in ImGui.

Frontier and SolidArc share `Engine/Shaders/BakedMatcapSampling.slang`, the same embedded 128×128 chrome matcap (`EngineContent/Matcaps/MetalChrome.ppm`), the same flat-color rule, and the same Flat/Matcap mode contract. SolidArc's software raster samples the baked lookup directly and its optional Vulkan shell presents that result; Frontier's visibility resolve uses the same lookup on the GPU. Both start in the shiny Chrome Matcap mode; F7 switches Frontier between Flat and Matcap, while SolidArc has Flat/Matcap toolbar buttons (and `show shading flat|matcap` in its console).

## Sample scripts

Native `.arc` construction journals live under:

```text
Editor/AuthoringTools/Modelling/SolidArc/Samples/
```

They can be replayed with the standalone console build:

```bash
SolidArc --continue Editor/AuthoringTools/Modelling/SolidArc/Samples/ToyCar.arc
SolidArc --continue Editor/AuthoringTools/Modelling/SolidArc/Samples/ToySailboat.arc
SolidArc --continue Editor/AuthoringTools/Modelling/SolidArc/Samples/ToyBiplane.arc
```

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

## Standalone Vulkan editor

The command-line target above remains dependency-free. To build the interactive window separately, first install CMake 3.20+, a C++20 compiler, GLFW/ImGui sources, and a Vulkan SDK/loader with a working graphics driver. The repository bootstrap supplies the locked GLFW/ImGui sources and Vulkan headers; it does not install the Vulkan loader or driver.

```bash
python Tools/Bootstrap.py --package glfw --package imgui --package vulkan-headers
cmake -S Editor/AuthoringTools/Modelling/SolidArc -B /tmp/solidarc-vulkan -DSOLIDARC_BUILD_VULKAN_APP=ON -DSOLIDARC_BUILD_VERIFICATION=OFF
cmake --build /tmp/solidarc-vulkan --target SolidArcVulkan
```

Run `SolidArcVulkan` to open the standalone CAD window. The Flat/Matcap buttons switch the shared viewport shading; the default is the baked shiny Chrome Matcap. The Construct button offers the reference, sketch, solid and surface catalogues. Choose a tile, click the XY workplane to set its anchor, then press Enter to place; Escape cancels. While placing, cyan cursor-aligned guides and an XYZ readout remain visible. The viewport uses a 10 mm lattice, left-drag orbit, Shift+left-drag pan and wheel dolly.

This first standalone Vulkan shell presents the established SolidArc `SoftwareRaster` image through a Vulkan sampled texture and uses the Vulkan swapchain + ImGui Vulkan backend for the window/UI. CAD geometry, depth and pick generation therefore remain on the proven CPU raster path; the Vulkan target is optional and kept separate from the console build.

The `SolidArc binaries` GitHub Actions workflow builds the console and Vulkan executables for Linux x86_64 and Windows x64, then uploads 30-day downloadable artifacts on pushes to `arena/0f8acff0-frontier` (or a manual workflow dispatch). Both packages include a short runtime note; the Vulkan app still requires a compatible graphics driver.

The dependency-free repository gate is:

```bash
Tools/Build/CheckSolidArc.sh
```

It compiles and links the console target with `g++`, checks the CAD outliner/inspector adapter, executes the Construct catalogue against all 22 command-backed primitive types, verifies the `.arc` samples are present, then compile-checks every C++ verification translation unit. This is the fallback gate for sandboxes that do not have CMake installed.

High-fidelity editor visual proofs are checked with:

```bash
Tools/Build/CheckEditorVisualProofs.sh
```

That gate uses the same headless ImGui draw-list raster path as `Exhibits/Workbench/Editor/EditorProof.cpp`; it verifies the canonical game editor proof at `Exhibits/Gallery/Editor/EditorProof_Inspector.png` and regenerates the SolidArc editor proof at `Exhibits/Gallery/Editor/EditorProof_SolidArc.png`. It does not emit SVG or simplified mockup boards.
