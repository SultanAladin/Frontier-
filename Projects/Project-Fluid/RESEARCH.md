# Project Fluid — research and integration record

Last reviewed: 2026-09-21. This document replaces the skipped HTML prototype as
the implementation record for the native C++/Vulkan project.

## 1. Scope and decision

The source experiment was an ocean surface, not a general smoke solver. Project
Fluid therefore implements a **spectral free surface**. It does not relabel a
2D stable-fluids toy as an ocean. The first native version uses a bounded set of
spectral modes and direct summation. This is computationally heavier than an
IFFT at high mode counts, but it has three useful properties for engine
integration: a small reviewable implementation, deterministic CPU/GPU parity,
and no hidden FFT normalization mismatch. A Stockham FFT is the planned scale
path; the field ABI does not need to change.

The old hand-authored Gerstner approach was rejected because independent waves
produced repetition, CPU/GPU versions drifted, and apparent foam was mixed into
the water material. The new implementation has one seeded mode buffer shared by
both processors and a separate emission/particle appearance step.

## 2. Surface model

For wavevector **k**, the implementation stores amplitude `a`, random phase
`phi`, and deep-water angular frequency:

```text
omega(k) = sqrt(g |k|)
h(x,t) = sum_i a_i cos(k_i dot x + omega_i t + phi_i)
grad h = -sum_i a_i k_i sin(k_i dot x + omega_i t + phi_i)
```

Mode energy is sampled from a Phillips-style directional spectrum:

```text
P(k) = A exp(-1 / (k L)^2) / k^4 * max(k_hat dot w_hat, 0)^2
L = U^2 / g
```

A high-frequency damping term suppresses waves below the representable scale.
Polar stratification and a seeded PRNG make the finite mode set deterministic
and reduce square-lattice bias.

Horizontal choppiness follows the normalized wave direction. Its deformation
Jacobian is evaluated from the same modes:

```text
J = (1 + dDx/dx)(1 + dDz/dz) - (dDx/dz)(dDz/dx)
emission = clamp(1 - J, 0, 1)
```

`J < 1` indicates compression and `J <= 0` indicates folding. Compression is an
**emission signal**, not a white term in the water BRDF. The presentation pass
uses it to activate discrete seeded circular particles. This preserves the
standing “particle-only visible foam” rule.

## 3. CPU/GPU mirror contract

`OceanMode` is an aligned 32-byte structure whose two `vec4` blocks have the
same C++ and std430 layout. CPU and GPU consume exactly these values. Both paths
compute height, slopes, horizontal derivatives and compression from the same
phase equation. No CPU-side “representative waves” are permitted.

The Vulkan surface buffer is host-visible for this diagnostic build. Every 180
frames the host waits for the frame fence, compares 16 distributed cells, and
reports maximum height and slope errors. A 2 mm height tolerance accommodates
normal `sin/cos` implementation differences without hiding phase or indexing
bugs. Production can move the field to device-local memory and copy only a
small validation probe.

The `Project-Fluid-CPU` executable validates finite values and RMS energy
without Vulkan. It is the headless/server fallback and CI smoke test.

## 4. Vulkan synchronization and ownership

The frame has explicit ownership boundaries:

1. surface compute writes `height/slope/compression`;
2. a compute-write to compute-read memory barrier publishes the snapshot;
3. presentation compute reads the snapshot and writes packed BGRA pixels;
4. a shader-write to transfer-read buffer barrier publishes pixels;
5. the acquired swapchain image transitions to transfer destination, receives
   the buffer copy, transitions to present, then is presented under semaphores.

A frame fence protects mapped parity reads and command-buffer reuse. FIFO
presentation is chosen intentionally. This reference uses one queue to make
correctness obvious; an async-compute production path must use timeline
semaphores and queue-family ownership transfers where families differ.

## 5. Correct ReSTIR integration

ReSTIR must never call a moving simulation in the middle of candidate or reuse
passes. Project Fluid exposes a **versioned, immutable surface snapshot** after
the simulation barrier. Integration should follow this order:

1. Advance fluid at the fixed simulation clock and publish snapshot `S_n`.
2. Raster/trace water geometry from `S_n`; write world position, normal,
   material ID, linear depth, and motion vectors derived from `S_(n-1)` to
   `S_n`.
3. Generate ReSTIR DI candidates only after those buffers are visible to the
   graphics/ray queue.
4. Temporal reuse accepts a previous reservoir only if reprojection passes
   depth, normal, material, and surface-version tests. Rapid folding/foam
   emission lowers confidence; it must not blindly reuse history.
5. Spatial reuse must include the same geometry tests. Neighbouring screen
   pixels can lie on different wave sheets even when close in 2D.
6. Trace final visibility against the current displaced surface. Do not reuse a
   stale undisplaced water BLAS. A practical path is procedural intersection
   against the height field or a refitted mesh BLAS; refit completion is a
   dependency of visibility.
7. Particle foam is a separate participating/alpha geometry class. It should
   not inherit the water reservoir merely because it occupies the same pixel.
8. Hold `S_n` stable until all ReSTIR consumers signal completion. Double or
   triple buffer surface snapshots; do not overwrite the field in place.

The reservoir itself stores lighting samples and weights, **not fluid state**.
Fluid version and material identity belong in validation metadata. This avoids
bias from carrying a sample across a changed visibility distribution. For
strongly deforming cells, rejection is safer than aggressive temporal reuse.
The ReSTIR estimator must still apply the implementation's target-function and
normalization rules; the fluid integration does not alter RIS mathematics.

Useful implementation sequence in Frontier:

```text
fixed fluid step -> publish SurfaceSnapshot + timeline value
geometry/visibility waits -> G-buffer + motion
ReSTIR candidate -> temporal validation -> spatial validation -> visibility
shade water/particles -> tone map/present
```

## 6. Validation gates

- **Determinism:** same seed/settings produce byte-identical mode buffers.
- **CPU health:** finite field, plausible nonzero RMS energy.
- **Parity:** sampled CPU/GPU height error below 0.002 m under normal drivers.
- **Synchronization:** Vulkan validation layers report no hazards in a Vulkan
  SDK debug run.
- **Foam separation:** water colour is calculated before the discrete particle
  compositor; compression only controls particle lifetime.
- **Temporal integration:** force a large time jump and verify ReSTIR history is
  rejected rather than streaked.
- **Resize/swapchain:** this first executable intentionally uses a fixed-size
  window; resize support is a stated limitation, not an untested path.

## 7. Limitations and next work

- Direct summation is `O(cells * modes)`. Replace it with 256²/512² Stockham
  IFFT cascades for production-scale spectra while retaining the output ABI.
- The model currently uses deep-water dispersion. Add
  `omega = sqrt(g k tanh(k d))`, a bathymetry/depth field, shoaling and a Miche
  breaker criterion for shore surf.
- Presentation is an oblique compute projection, not the final visibility
  buffer renderer. The simulation buffer is designed to feed a displaced mesh
  or procedural ray intersection later.
- Foam particles are screen-composited seeded sprites. A production system
  should persist particle state, advect it, and write reactive masks for the
  temporal upscaler.
- Wind changes currently require rebuilding/uploading the mode buffer; the UI
  exposes choppiness live and keeps wind state visible.
- Add swapchain recreation and device-local simulation memory before shipping.

## 8. Sources consulted

1. Jerry Tessendorf, *Simulating Ocean Water* (SIGGRAPH course notes), spectrum,
   dispersion, displacement, slopes and FFT construction:
   https://people.computing.clemson.edu/~jtessen/reports/papers_files/coursenotes2004.pdf
2. Horvath, *Empirical Directional Wave Spectra for Computer Graphics*, modern
   spectral controls and directional distributions:
   https://dl.acm.org/doi/10.1145/2791261.2791267
3. GPU Gems, Chapter 1, *Effective Water Simulation from Physical Models*,
   sum-of-sines derivatives, normals and parameter relationships:
   https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models
4. Bruneton, Neyret and Holzschuch, *Real-time Realistic Ocean Lighting using
   Seamless Transitions from Geometry to BRDF*, ocean lighting and scale
   transitions: https://inria.hal.science/inria-00443630
5. Miche breaking criterion overview and coastal-wave context (Coastal Wiki):
   https://www.coastalwiki.org/wiki/Breaker_index
6. Bitterli et al., *Spatiotemporal reservoir resampling for real-time ray
   tracing with dynamic direct lighting* (ReSTIR DI):
   https://research.nvidia.com/publication/2020-07_spatiotemporal-reservoir-resampling-real-time-ray-tracing-dynamic-direct
7. Ouyang et al., *ReSTIR GI: Path Resampling for Real-Time Path Tracing*,
   temporal/spatial validation and path reuse:
   https://research.nvidia.com/publication/2021-06_restir-gi-path-resampling-real-time-path-tracing
8. Vulkan specification, synchronization and swapchain requirements:
   https://registry.khronos.org/vulkan/specs/1.3-extensions/html/
9. Khronos Vulkan Guide, synchronization examples:
   https://docs.vulkan.org/guide/latest/synchronization_examples.html

Source URLs are retained here so implementation choices can be audited even
when no generated HTML report is shipped.
