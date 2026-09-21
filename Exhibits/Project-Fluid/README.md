# Project Fluid — corrected Flux PBF proof

Source: `eosclient0001-rgb/Frontier`, commit
`c708b47926dec2e31d08b2a0bc01ab15c84983c8`, branch
`arena/01a0c4da-frontier`.

![Animated fixed-step PBF collision](ProjectFluid_Flux_PBF_Collision.gif)

![Bounds and collision frame](ProjectFluid_Flux_PBF_Bounds_Collision.png)

These are native C++ execution outputs, not generated artwork or captures from
the removed ocean project. The orange box is the real solver domain. The striped
sphere is the source scene's stationary obstacle. Every cyan sphere is one PBF
simulation particle; visible separation around the obstacle comes from the same
sphere non-penetration projection used during pressure iterations.

## Recorded run

```text
Flux PBF C++ mirror | particles 1440 | t 0.30000 s
bounds [-1.95,1.95] x [0.19,3.70] x [-1.25,1.25] m
sphere contacts 26 | wall contacts 2868 | minimum sphere distance 0.36000 m
pressure passes 4 | mean/peak compression 0.00198 / 0.02686
```

Build and reproduce:

```bash
g++ -std=c++20 -O3 -Wall -Wextra -Werror -Wpedantic \
  Projects/Project-Fluid/Source/PbfFluid.cpp \
  Projects/Project-Fluid/Source/CpuProofMain.cpp \
  -o /tmp/flux-proof
/tmp/flux-proof /tmp/flux.ppm 18
python3 Tools/PpmToPng.py /tmp/flux.ppm \
  Exhibits/Project-Fluid/ProjectFluid_Flux_PBF_Bounds_Collision.png
```

Checksums:

```text
51056578c59fefec7c766017147d4e8fcbef4aeda2d3349d7c324ff87fd35de1  ProjectFluid_Flux_PBF_Bounds_Collision.png
55e890da9efc72208926f0b5ab518f9338157947422cce516db38b1d58dbf658  ProjectFluid_Flux_PBF_Collision.gif
```

The GIF samples twelve deterministic fixed-step states. The interactive Vulkan
window advances continuously at 1/60 s, supports reset/stir/pour/material input,
and shows live contact counts in its title and diagnostics in the console.
