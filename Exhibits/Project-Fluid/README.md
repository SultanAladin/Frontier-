# Project Fluid — Flux PBF continuous-surface proof

Source: `eosclient0001-rgb/Frontier`, commit
`c708b47926dec2e31d08b2a0bc01ab15c84983c8`, branch
`arena/01a0c4da-frontier`.

![Animated continuous PBF collision](ProjectFluid_Flux_PBF_Collision.gif)

![Continuous surface, bounds and collision](ProjectFluid_Flux_PBF_Bounds_Collision.png)

## Material and optical response

![Water, milk, honey and chocolate continuous surfaces](ProjectFluid_Flux_Surface_Material_Comparison.png)

The four panels are separate deterministic native runs at the same 1.50000 s
simulation budget with pouring enabled. They use the requested source commit's
base colour, absorption, opacity, roughness and IOR, while viscosity, surface
tension, wetting and shear thinning alter the corresponding simulation state.

These are C++ CPU-mirror execution outputs, not generated artwork or captures
from the removed ocean project. The proof executes the same scene and same
front-depth/thickness surface algorithm as the Vulkan `.slang` path: overlapping
particle kernels build continuous front depth and optical thickness, depth and
thickness are filtered, and a resolve reconstructs normals and applies
refraction, Beer–Lambert attenuation, Fresnel response and rough highlights.
Individual simulation particles are not directly drawn in the default proof.

The orange box is the real solver domain. The striped sphere is the source
scene's stationary obstacle and is depth-tested against the liquid. The visible
liquid separation around it comes from the same sphere non-penetration
projection used during pressure iterations.

## Recorded run

```text
Flux PBF C++ mirror | material Water | particles 1620 | t 1.50000 s
bounds [-1.95,1.95] x [0.19,3.70] x [-1.25,1.25] m
sphere contacts 75 | wall contacts 5922 | minimum sphere distance 0.36001 m
pressure passes 6 | mean/peak compression 0.00323 / 0.05044
```

Build and reproduce:

```bash
g++ -std=c++20 -O3 -Wall -Wextra -Werror -Wpedantic \
  Projects/Project-Fluid/Source/PbfFluid.cpp \
  Projects/Project-Fluid/Source/CpuProofMain.cpp \
  -o /tmp/flux-proof
/tmp/flux-proof /tmp/flux.ppm 90 water
python3 Tools/PpmToPng.py /tmp/flux.ppm \
  Exhibits/Project-Fluid/ProjectFluid_Flux_PBF_Bounds_Collision.png
```

Checksums:

```text
928cf073cf30e01444ee7c383ed9628c3bc7f2040020c480f7adbed8defef368  ProjectFluid_Flux_PBF_Bounds_Collision.png
f19c6d2e3415b4dea06aa35a80b2e9c07aefe699f8e0af2098b46a8ceda3cf8a  ProjectFluid_Flux_PBF_Collision.gif
c356f4b1c71c1af45cae899b2eda78988ebcf5ea155fe8098db1418fbd0e8136  ProjectFluid_Flux_Surface_Material_Comparison.png
```

The GIF samples twelve independently reproduced fixed-step states. The
interactive Vulkan window advances at 1/60 s, starts with pouring enabled,
supports reset/stir/pour/material input, and shows live contact counts.
