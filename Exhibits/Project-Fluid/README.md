# Project Fluid — exact CPU shader-mirror proof

![Project Fluid exact CPU mirror](ProjectFluid_CPU_Mirror_Proof.png)

This 1280×720 frame was emitted by the native C++ `Project-Fluid-CPU`
executable in the Arena workspace on 2026-09-21. It is not an AI-generated
image, HTML capture, or a separate artistic renderer.

## Exact scene contract

The proof now mirrors the two Vulkan compute stages directly:

1. `OceanSurface.comp` ↔ `SpectralOcean::Evaluate`: the same 192 modes, phase,
   deep-water dispersion, height, slopes, Jacobian, 256×256 domain, and `t=9`.
2. `OceanPresent.comp` ↔ `RenderProof`: the same camera and ray construction,
   2 m height-field marching, six bisection refinements, bilinear field reads,
   sky/sun function, Fresnel water BRDF, specular response, distance haze,
   compression-driven particle test, linear-to-sRGB conversion, and 1280×720
   viewport.

This follows the same CPU-reference principle used by Project Zero: CPU code
executes the shader algorithm and scene rather than producing an unrelated
“representative” image.

## Reproduction command

```bash
g++ -std=c++20 -O3 -Wall -Wextra -Werror -Wpedantic \
  Projects/Project-Fluid/Source/SpectralOcean.cpp \
  Projects/Project-Fluid/Source/CpuMirrorMain.cpp \
  -o /tmp/project-fluid-test/cpu-mirror

/tmp/project-fluid-test/cpu-mirror \
  --render /tmp/ProjectFluid_CPU_Mirror_Proof.ppm

python3 Tools/PpmToPng.py \
  /tmp/ProjectFluid_CPU_Mirror_Proof.ppm \
  Exhibits/Project-Fluid/ProjectFluid_CPU_Mirror_Proof.png
```

Observed output:

```text
Project-Fluid CPU mirror: 192 shared spectral modes
height range [-0.9634, 0.9169] m, RMS 0.3498 m
CPU mirror proof rendered to /tmp/ProjectFluid_CPU_Mirror_Proof.ppm
render time: 2.360 seconds
```

PNG SHA-256:

```text
d66732021e63e0959ab7a727b4908b0dc52e0eca927f48e4fdf9f55614600aee
```

## GPU status

This proves the complete **CPU mirror of the Vulkan scene**. This Arena image
does not claim to be a GPU capture: the current sandbox exposes no Vulkan
loader/device, native display, CMake, or `glslc`. On a Vulkan-capable machine,
the interactive executable runs the corresponding compute shaders and reports
sampled CPU/GPU surface errors every 180 frames.
