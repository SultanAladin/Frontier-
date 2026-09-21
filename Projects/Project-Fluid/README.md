# Project Fluid

A native C++20, interactive Vulkan spectral-ocean project for Frontier. This is
not an HTML/WebGL wrapper. The same deterministic mode buffer drives:

- a Vulkan compute surface simulation and compute presentation path;
- a C++ CPU mirror used for headless/server execution and live parity checks;
- a compression/Jacobian field consumed by a discrete particle-pull foam pass.

The CPU mirror is deliberately not a second approximation. `OceanMode` is the
shared ABI, and both paths evaluate the same phase, dispersion, slope and
Jacobian equations. The window prints sampled CPU/GPU errors every 180 frames.

## Build

Requirements for the window: CMake 3.20+, C++20 compiler, Vulkan 1.1 loader and
headers, `glslc`, and GLFW 3.3+. The CPU mirror requires only a C++20 compiler.

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --target Project-Fluid -j
./build/Projects/Project-Fluid/Project-Fluid
```

Headless CPU validation:

```bash
cmake --build build --target Project-Fluid-CPU -j
ctest --test-dir build -R ProjectFluidCpuMirror --output-on-failure
```

If Vulkan development packages are absent, CMake reports why the window target
was skipped and still generates `Project-Fluid-CPU`.

### Controls

| Input | Action |
|---|---|
| W/A/S/D | Pan across the ocean domain |
| Q / E | Zoom out / in |
| Up / Down | Increase / decrease choppiness |
| Left / Right | Decrease / increase wind speed and rebuild the shared spectrum |
| Space | Pause simulation time |
| C | Toggle CPU-parity marker |
| Escape | Exit |

## Architecture

1. `SpectralOcean` creates a seeded Phillips/Tessendorf-style directional mode
   set once. It uses deep-water dispersion `omega = sqrt(g |k|)`.
2. `OceanSurface.comp` evolves all modes into height, two slopes, and horizontal
   displacement Jacobian compression on a 256x256 field.
3. A compute-to-compute barrier publishes that immutable field snapshot.
4. `OceanPresent.comp` shades the water and composites seeded circular foam
   particles only where compression emits them. There is no continuous white
   foam mask in the water colour calculation.
5. The packed BGRA compute result is copied to a Vulkan swapchain image.
6. C++ periodically evaluates the exact same cells and checks GPU parity.

## Captured execution proof

The repository includes a real native CPU-mirror frame and its exact reproduction
command in [`Exhibits/Project-Fluid`](../../Exhibits/Project-Fluid/README.md).
The exhibit explicitly distinguishes verified CPU execution from the Vulkan
runtime, which this Arena sandbox cannot launch because it has no Vulkan loader,
window system, CMake, or `glslc`.

See [RESEARCH.md](RESEARCH.md) for equations, source review, ReSTIR integration,
validation criteria, and limitations.
