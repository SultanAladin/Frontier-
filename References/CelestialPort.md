# The Celestial Port

The reference celestial console — `https://sultanaladin.github.io/Frontier-/celestial/` — carries its entire
sky in one 497-line WebGL fragment program plus a panel that supplies its uniforms. This is the C++ port of
that program into Project Zero. There is no HTML in the engine and no browser in the loop: the same arithmetic
runs on the CPU, inside Frontier, and its output is a raster.

## Where things live

| Path | What it holds |
|:--|:--|
| `Projects/Project-Zero/Source/CelestialSpecification.h` | Scalar and spectral algebra, the world↔sky frame seam, and one parameter record per panel entity, each carrying the panel's own default. |
| `Projects/Project-Zero/Source/CelestialIntegrator.{h,cpp}` | The fragment program itself: atmosphere, twilight, stars, moons, volumetric clouds, cloud layer, local cloud, local fog, the two analytic fogs, wind, rainbow, lens flare, tonemap — plus the sky as a light source for ReSTIR. |
| `Projects/Project-Zero/Source/PrecipitationSolver.{h,cpp}` | The hydrometeor pool. The one celestial system the reference runs as a simulation rather than a shader, so it is ported as one. |
| `Projects/Project-Zero/Source/CelestialStage.{h,cpp}` | The combined scene: Cornell box with an opened ceiling, ReSTIR DI and GI, sky NEE, aerial perspective, precipitation, screen-space optics. |
| `Scratchpad/CelestialPhysicsProof.cpp` | 43 checks of the transcription against independent physics. |
| `Scratchpad/CelestialSceneProof.cpp` | The combined frame at four times of day, with numeric gates and the sky-off negative control. |
| `Scratchpad/CheckCelestialScene.sh` | Builds and runs both, returns the failure count. |
| `EngineContent/CelestialTextures/luna_1k.ppm` | The reference atlas's own `luna` plate (NASA LROC), decoded to P6. |

## The frame convention

The reference is authored **+Y up**, with azimuth zero pointing at −Z. Frontier is strictly **+Z up**. Rather
than re-derive every trigonometric identity — the surest way to introduce drift — the transcription keeps the
reference frame verbatim and rotates only at the seam:

```cpp
SkyFrameOf  (World) = { World.x,  World.z, -World.y };
WorldFrameOf(Sky)   = { Sky.x,   -Sky.z,    Sky.y   };
```

A pure axis relabel: no scale, no handedness change, exactly invertible, and checked as such in the proof.
Inside the celestial translation units, "up" is +Y exactly as the reference has it.

## What is transcribed, and how faithfully

Every numeric literal is the reference's own. Loop counts, early-outs and clamps are kept, because they are
visible in the image and not merely in the cost. The panel defaults were not transcribed by hand — the
reference's own `defaults()` routine was executed and its output read directly, so a typo in a slider default
is not possible.

- **Atmosphere.** Single-scatter Rayleigh + Mie + ozone, 20 view samples × 8 light samples, quadratic spacing.
  `betaR = (5.8, 13.5, 33.1)e-6`, `betaM = 21e-6` with the 1.1× extinction multiplier, `betaO = (0.65, 1.881,
  0.085)e-6`.
- **Twilight.** The five-colour ramp indexed by `log2(1 + 2·altitude)`, the azimuth envelopes, the pre-sunrise
  white line gated to −5.5°…0°, and the earth-shadow dome.
- **Stars.** Milky Way band with dust lanes, then up to four octahedral layers at frequencies 18/46/110/230 with
  a 3×3 neighbour search, flat-topped discs never smaller than a pixel, halo, and four-point spikes on the
  brightest first-layer stars. Gated by a Weber contrast test against the sky.
- **Moons.** Textured equirectangular spheres with axial tilt and spin, wrap-diffuse phase, limb darkening,
  atmospheric rim and a two-exponential glow.
- **Clouds.** The volumetric slab with six vertical profiles, dual-lobe HG, three-octave multiple scattering,
  Beer-powder, a five-tap growing-spaced light march and blue-noise jitter; plus the thin analytic layer.
- **Local media.** Local fog and local cloud marched over the *union* of their intervals in one pass, sharing a
  single four-tap shadow so each shadows the other without a second march.
- **Analytic fog.** Exact `exp(-y/H)` segment integrals; height fog uses exp² of distance; atmospheric fog is
  spectral. Both composite in one pass with cross-attenuated in-scatter.
- **Rainbow.** Fourteen wavelengths, Descartes' minimum deviation with Cauchy dispersion, both orders,
  Alexander's dark band and supernumeraries.
- **Lens flare.** Four types weighting ghosts, halo, anamorphic streak and bursts.
- **Post.** The automatic exposure ramp, five tonemaps, vignette, gamma and grain.
- **Precipitation.** Five hydrometeor classes with their measured terminal velocities, drag relaxation toward
  the local wind, spawn rate from mm/h gated by the cloud coverage overhead, bounce and splash.

Two deliberate departures, both documented at their call sites:

1. `SampleEnvironmentRadiance` — the environment term a GI bounce sees — includes the atmosphere, twilight and
   the moons, but **not** the point stars. Their contribution to a diffuse bounce is negligible while the
   octahedral neighbour search is the most expensive thing in the integrator.
2. The local fog and local cloud volumes are placed for a 2 m room rather than at the panel's defaults, which
   are positioned for a 600 m ground plane. Left at the defaults, the fog volume engulfs the entire Cornell box.

## The combined scene

The proof the port has to survive is not "the sky renders" next to "the Cornell box renders". It is one frame
where the sky is the light source for path-traced geometry and the geometry occludes the sky.

So the stage is the Cornell box with its ceiling opened. The sun and sky reach the floor through the aperture;
ReSTIR's GI bounces that light onto the coloured walls; the walls occlude the sky. The original emissive
luminaire stays — relocated to the far end of the ceiling so it does not sit inside the aperture — so the
classic DI/GI path is still under test alongside the new one.

## Proofs

```
bash Scratchpad/CheckCelestialScene.sh
```

**`CelestialPhysicsProof`** — 43 checks, none of which compare the port to itself:

- Kasten-Young air mass against its published values (1.00 at the zenith, 2.00 at 30°, 37.9 at the horizon).
- Rainbow geometry against Descartes: primary red at 42.4°, violet at 40.6°, secondary at 50.3° with the colour
  order reversed, and a dark band between them.
- Spherical astronomy: equinox noon elevation is 90 − |latitude|, sunrise at 06:00, a southern observer sees
  the sun to the north.
- The 1/λ⁴ law: the transcribed coefficients reproduce `(700/440)⁴`, the clear zenith renders blue, and the
  solar aureole renders white.
- Differential extinction: the horizon beam is redder than the noon beam, and blue is extinguished more.
- Henyey-Greenstein normalisation by numerical integration over the sphere, at three asymmetries.
- The fog height kernel against a 200 000-sample quadrature of the same integral.

**`CelestialSceneProof`** — the combined frame at dawn, noon, dusk and night, gating that the frame is not flat,
that geometry and sky share it, that the room is lit, that the solar disc dominates by a margin that scales with
air mass, that a low sun is reddened, that rain is falling, and that the star field resolves point sources
(peak/mean > 20).

**The negative control.** Switch the sky off and the room must go dark. It measures 0.212 lit against 0.000
unlit. This is the check that makes the others mean anything, and it caught two real bugs: a constant
`albedo × 0.015` ambient term that lit every surface with all lights off, and the analytic fogs in-scattering
sky light along a path the control did not switch off.

## Bugs this work found and fixed

- **Project Zero rendered nothing.** The committed `ProjectZero_ReSTIR_GI.ppm` held exactly one colour across
  all 307 200 pixels. The Cornell box was authored +Y up while `CameraProjection` builds its basis from a +Z
  world up, so every primary ray left the room. Geometry, box yaw, face winding and the camera eye point are
  now all in the engine's convention.
- **The ReSTIR GI estimator was biased.** The radiance handed to the bilateral filter was the reservoir's single
  surviving sample, which is selected with probability proportional to its own brightness. Read undivided, it is
  biased high and inconsistent between neighbours — a scan across a flat wall varied 20..103 in 8-bit. Adding
  samples did not help, which is what identified it as bias rather than variance. The filter now reads the
  unbiased mean of every candidate; the same scan varies 8..21. Fixed in both `CelestialStage` and
  `RendererHost`.
- **Moonlight did not light anything.** `SampleEnvironmentRadiance` returned zero across the whole night
  hemisphere, so a bounce ray aimed at a full moon carried nothing.

---

## Session 3 — the world half: ground, terrain, local lights, and making them visible

### New entities ported

| Panel entity | Record | Default | Where it is evaluated |
|---|---|---|---|
| `plane` | `PlaneCriteria` | size 600, `y = 0`, cell 1, graticule on, tints `#f2f2f2`/`#c9ccd2` | `CelestialIntegrator::SampleGround` |
| `terrain` | `TerrainCriteria` | **off**, size 180, height 12, freq 1.2, seed 417, roughness 0.88 | `TerrainField` / `TraceTerrain` |
| `point light` | `PointLightCriteria` | on, (6, 2.2, −4), `#ffd9a0`, I 14, reach 26, decay 2 | `LocalLightsOnSurface`, `MarchLocalVolumes`, `CelestialStage::LocalLightContribution` |
| `spot light` | `SpotLightCriteria` | on, (−5, 6, −8) → (0, 0, −6), `#e8f0ff`, I 62, cone 26°, penumbra 0.42 | as above |

`uSLDir = (0.62017367, −0.74420841, 0.24806947)`, `uSLCos = cos 13° = 0.97437006`.

### ⚠️ The bug that hid the entire world half

Everything above integrated correctly and rendered **zero pixels** for a long stretch. Three separate
occluders had to be removed before a single ground pixel appeared, and none of the existing gates could
see the problem — the sky still rendered, the room was still lit, the frame was still colourful:

1. **The room is a closed box.** With only the ceiling aperture, every downward ray terminates on the
   Cornell floor. A skylight shows you sky; it can never show you ground. → cut a window in the far wall
   (`kWindowHalfX 0.94`, z ∈ [0, 1.90], sill at floor level).
2. **The floor and the plane were coplanar.** The Cornell floor is at world z = 0 and the reference's
   plane is at `pl_y = 0`, so even through a window the floor won every intersection. → the room now
   stands on a terrace, `CelestialStageCriteria::FloorElevation = 6 m`. This is also the only arrangement
   in which the room can cast a shadow onto the ground.
3. **The Cornell boxes occluded the window** from the old crouched camera at z = 0.55. → eye height
   1.20 m, pitch −6°, yaw −7°, which clears the tall box and puts horizon, ground and floor in one frame.

The terrace introduces a second frame seam on top of the existing world↔sky one. Sky-frame **points**
crossing into the room must lose the terrace (`WorldFrameOf(p).z −= FloorElevation`); sky-frame
**directions** must not. This applies to the rain splat, both local lights, and the observer frame.

### Also fixed

- **`InsideChecker` had its `Step` arguments transposed** and then negated, so the checker extent was
  "outside" everywhere and the ground was a flat untextured tone. GLSL `step(edge, x)` is `x < edge ? 0 : 1`
  — edge is the radius, x is the extent: `Step(max(|x|,|z|), HalfSize)`.
- **The Makefile tracked no header dependencies.** A header-only change rebuilt nothing, so stale `.o`
  files kept the old struct layout while new ones used the new one; the link succeeded and the program
  segfaulted on a corrupted object. It presented as a logic bug in the precipitation solver and was
  nothing of the sort. Now `-MMD -MP` with `-include $(GAME_OBJS:.o=.d)`.

### Proofs

`Scratchpad/CelestialGroundProof.cpp` — **26 checks**, wired into `Scratchpad/CheckCelestialScene.sh`
between the physics and scene proofs (exit 92 on build failure). Plane hit matches `−h/d.y` exactly;
checker spread 0.158 near → 0.062 far, box filter 2.0942 between tiles 2.2740/1.8715; terrain 40/40 hits,
worst residual 0.047 m, worst normal deviation 0.034°; point light inverse-square 4.000000 exactly over two
octaves; spot cut-off 2.308682 m = 10·tan 13°; penumbra soft 0.008711 < hard 0.010999 at 0.85 r.

`CelestialStage::Statistics` gained `GroundPixels` / `MeanGroundLuminance`, and the scene proof now gates
on them at all four times of day — so the world half can never silently vanish again.

**Proof-isolation traps hit while writing these** (do not reintroduce): sampling a checkerboard along
`x = 0` measures a constant, because any x-XOR-z pattern cancels on a cell boundary — sample off-axis;
`Sun.Visible = false` suppresses only the sun *disc*, and `Sun.Intensity` must also go to zero to remove
the sun as an illuminant; probing the spot penumbra inside ~0.78 of the edge radius compares two saturated
values and proves nothing.

### Reference provenance

The reference is published from branch `arena/01a08c57-frontier`, path `/docs` — **not** `main`, and there
is no separate `CelestialPanel.html`: the panel is the 2 343-line main `<script>` block inlined in
`docs/celestial/index.html`. It is preserved here as `Scratchpad/.ref_panel.js`, alongside the verbatim
fragment shader in `Scratchpad/.ref_fs_snapshot.glsl` (verified byte-identical to the live page).
Retrieve with:

```
gh api repos/SultanAladin/Frontier-/contents/docs/celestial/index.html?ref=arena/01a08c57-frontier \
  --jq .content | base64 -d
```

Plain `curl` on the Pages URL fails with SSL error 35 and `raw.githubusercontent.com/.../main/...` is 404.

### Rain was not depth-tested

Precipitation is splatted in screen space in phase 7, after the composition pass, and it never consulted
scene depth — it only ever bounds-checked against the framebuffer. Every drop in the open world therefore
painted straight over the Cornell walls and boxes, so the closed room appeared to be raining indoors. It
was invisible as a bug while the window did not exist, because before that there was no correct answer to
compare against: drops over the walls looked like drops in the room.

The composition pass already computes an occluder distance per pixel for the light glyphs (room geometry
or celestial ground, whichever it resolved). That is now retained as a `SceneDepth` buffer, and all three
splat paths — streak, splash ring, and the hail/snow disc — test against it. The streak interpolates depth
along its length, since a near-vertical drop can span a lot of Z.

At 480×320 this took the rain from 2751 pixels to 770: roughly 72% of what was being drawn was in front of
geometry it should have been behind. The scene proof now gates rain coverage below 25% of the frame, since
the room subtends most of the image and only the window shows open air.

### Uniform coverage

All 190 uniforms declared in the reference fragment shader were enumerated and matched against the C++.
Every one is accounted for; the thirteen that did not match by name are naming differences only
(`uCLWindDir` → `DriftDegrees`, `uHLInt`/`uHLAuto` → `LineIntensity`/`LineAtCivilOnly`, `uSunDiscBoost` →
`DiscRadiance`, `uWLink*` → `Drives*`, `uMoonTex0..3` → the `MoonAlbedoSurface` atlas, `uCamFwd` → the
observer frame). No reference uniform is unported.

A GPU-side differential test against the live GLSL was attempted and is not possible in this sandbox:
there is no EGL/GL driver and no `moderngl`/`glslangValidator`. Equivalence therefore rests on the
line-by-line transcription plus the 69 arithmetic checks in the two proofs.

---

## The ablation proof — is every element actually IN the one frame?

`Scratchpad/CelestialCombinedProof.cpp` — **19 checks**, wired into the gate as the third of four proofs.

The other proofs answer "does each system compute the right numbers" and "does a frame come out lit". Neither
answers the question the port is judged on: *is every element simultaneously present in the single combined
render?* That has a sharp, falsifiable form — render the combined frame, then switch **one element alone**
off, re-render, and require the image to change. If the frame is identical without an element, that element
is not in the picture, however perfectly its physics integrates.

This is exactly the test that would have caught the ground plane in one run: it integrated flawlessly, the
frame looked lovely, and removing it changed nothing, because it was occluded and never reached a pixel.

Every element passes. Representative deltas against the shipped noon frame (320×224):

| Element | Pixels moved | Peak Δ |
|---|---:|---:|
| sun | 71 604 | 2.405 |
| sky / atmosphere | 70 957 | 1.448 |
| ground plane | 56 729 | 1.985 |
| point light | 60 790 | 0.091 |
| atmospheric fog | 19 666 | 0.428 |
| volumetric clouds | 6 965 | 1.400 |
| wind | 7 539 | 1.509 |
| local volumetric fog | 3 503 | 1.594 |
| spot light | 1 267 | 0.001 |
| local cloud volume | 473 | 0.633 |
| precipitation | 336 | 1.637 |
| Cornell luminaire (ReSTIR DI) | 59 175 | 163.783 |
| window admits the world | 68 977 | 2.403 |
| star field (midnight) | 170 | 0.003 |
| moon (midnight) | 40 812 | 0.060 |

### Three elements that correctly contribute nothing at noon

The first run reported the rainbow, the lens flare and the cloud layer at **zero pixels**. All three turned
out to be correct behaviour, and asserting them at noon would have been asserting a bug:

- **Rainbow.** The bow is a 42° circle about the antisolar point, whose elevation is −sunElev, so its top sits
  at (42 − sunElev). With the sun at 64° the whole bow is 22° *below the horizon* — no rainbow can exist at
  noon, and the reference cannot draw one either. It is also centred on the antisolar *azimuth* (99.6° at
  16:36) while the shipped camera looks at 7°. Proved instead at 16:36 with the camera turned toward the bow:
  3 215 px, peak Δ 2.384. Sampled directly, the response peaks at exactly **42.00°** from the antisolar point.
- **Lens flare.** An artefact of the sun being *on screen*. At noon the sun is 64° up while the camera looks
  6° down through the window — 2.68 screen-heights outside the frame, and the flare fades out past 1.25.
  Tilt the camera up through the ceiling aperture: 71 680 px, peak Δ 0.946.
- **Cloud layer.** The reference uploads `uCloudOn = 0`; the thin analytic slab is legacy and inert in the
  live page, and is ported switched off to match. Making it contribute at its shipped default would mean the
  port had *diverged* from the reference. Gated instead as "inert by default but functional when enabled":
  25 px when switched on.

### A GPU differential test is not possible in this sandbox

Confirmed, not assumed: there is no `libGL`/`libEGL`/OSMesa, `moderngl` cannot create a standalone context
("libGL.so not found"), there is no `glslangValidator`, and `apt-get` cannot install one without root. So
equivalence to the live page rests on the line-by-line transcription, the 190-uniform audit, and the 88
arithmetic and ablation checks across the four proofs — **not** on a pixel diff against the real shader.
Screenshotting the reference page at a known camera and diffing against `Celestial_Noon.png` remains the one
check that would close that gap, and it needs a machine with a GPU.
