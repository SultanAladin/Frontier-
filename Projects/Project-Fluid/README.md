# Project Fluid — Flux native port

Native C++20/Vulkan conversion of Flux 0.3 from
`eosclient0001-rgb/Frontier@c708b47926dec2e31d08b2a0bc01ab15c84983c8`.
This is the requested 3D PBF basin simulation—not the unrelated ocean prototype,
which has been removed.

## Included

- CPU 3D PBF simulation with 1,440 initial / 2,800 maximum particles
- 0.31 m support, poly6 density, adaptive balanced pressure projection
- fixed 1/60 s clock, maximum two steps per displayed frame
- visible `[-1.95,1.95] x [0.19,3.70] x [-1.25,1.25] m` collision bounds
- visible stationary sphere obstacle and non-penetration projection
- pairwise surface response, viscosity and shear-thinning material response
- water, milk, honey and chocolate presets
- pouring, stirring, pause and deterministic reset
- Vulkan compute particle splatting into a depth/pixel buffer and swapchain
- native CPU proof renderer using the same positions, bounds and obstacle

## Build

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --target Project-Fluid -j
./build/Projects/Project-Fluid/Project-Fluid
```

Vulkan window requirements: Vulkan SDK/loader, `glslc`, GLFW3 and a C++20
compiler. Without those packages, the CPU target remains available:

```bash
cmake --build build --target Project-Fluid-CPU -j
./build/Projects/Project-Fluid/Project-Fluid-CPU proof.ppm 18
```

## Interactive controls

| Input | Action |
|---|---|
| Space | Pause/resume fixed-step simulation |
| R | Deterministic basin reset |
| S | Stir the actual particle velocities |
| Hold P | Pour particles until the 2,800 capacity |
| 1 / 2 / 3 / 4 | Water / milk / honey / chocolate |
| Escape | Exit |

The window title reports particle and collision counts. Every 180 frames the
console reports pressure passes, measured compression, and sphere/wall contacts.

## Proof and research

- [`../../Exhibits/Project-Fluid`](../../Exhibits/Project-Fluid/README.md) contains
  a native execution frame with visible bounds and sphere interaction.
- [`RESEARCH.md`](RESEARCH.md) records provenance, C++ adaptations, limitations,
  equations and the complete research notes from the requested source commit.
