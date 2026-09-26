# Why the image stopped getting crisper, and why the patches stopped moving

Written 2026-09-26, in answer to three reports from the owner's machine (Windows, GTX 1650 SUPER,
NVIDIA 576.40):

1. “before it used to render after it converged — it would still render, giving more crisp results; now it doesn’t”
2. “the clusters we added don’t seem to change when I move closer / further”
3. “geometry patches aren’t updating”

This file is the diagnosis and the measurements. `Docs/ProgressiveRefinement.md` and `Docs/PatchGeometry.md`
describe the systems themselves; both are updated to match.

⚠️ **Nothing here has been executed on a GPU.** Everything below is CPU evidence from the shipped shader text
(the mechanical C++ port), the shared C++/GLSL policy headers and the real registration path, plus a full
SPIR-V lowering of all 22 shaders. The executable **and the shaders** must be rebuilt together.

---

## ① “It stops getting crisper”

Two independent causes, both real, both fixed.

### 1a. The à-trous fade was one weight for five very different levels

The filter is five à-trous levels with tap spacings 1, 2, 4, 8, 16 px. Since the previous change each level
faded with the pixel's own valid sample count, `33 / count`, and the same weight was used for **every** level.
That converges to an identity in the limit, but slowly and uniformly — and the levels do not cost the same
amount of detail. Level 0 mixes the neighbours one pixel away; level 4 mixes neighbours **thirty-two** pixels
away. At 256 samples the old policy still blended 13 % of a 32-pixel-wide blur into the presented image, and
that is what a held frame looks like when a reviewer calls it “blurry”.

The fade is now keyed to the level's own tap spacing as well as the age:

```
Strength(count, step) = (33 / count) ^ (1 + log2(step))      for count > 33
                      = 1                                     otherwise
```

The wide levels retire first — the same ordering SVGF derivatives use when they drop levels as history grows,
expressed as a continuous weight so nothing pops on the frame a level would have been dropped. Below the
bound every level is at full strength, so young and freshly disoccluded pixels are filtered **bit-identically**
to before (the gate asserts this).

Measured with the shipped shader's C++ port on a new fixture carrying detail at five spatial scales
(1/2/4/8/16 px bands), mean absolute detail bias, lower is crisper:

| valid samples | 1 px band | 2 px | 4 px | 8 px | 16 px | all |
|---|---|---|---|---|---|---|
| ≤ 33 (unchanged) | 0.00989 | 0.00988 | 0.00979 | 0.00958 | 0.00922 | 0.00968 |
| 64 — before | 0.00684 | 0.00830 | 0.00844 | 0.00806 | 0.00730 | 0.00780 |
| 64 — after | 0.00539 | 0.00575 | 0.00464 | 0.00331 | 0.00200 | **0.00425** |
| 256 — before | 0.00221 | 0.00323 | 0.00340 | 0.00313 | 0.00259 | 0.00292 |
| 256 — after | 0.00128 | 0.00110 | 0.00063 | 0.00035 | 0.00017 | **0.00071** |
| 8192 — after | 0.00004 | 0.00003 | 0.00002 | 0.00001 | 0.000004 | 0.00002 |

At 256 samples the frame keeps **4.1×** more of its detail overall and **15.6×** more of the 16 px detail.
The detail amplitude in the fixture is 0.02, so “0.00292” is 15 % of the feature gone and “0.00071” is 3.5 %.

### 1b. A twinkling star restarted the whole accumulation, every frame

The frame loop restarts the accumulation whenever the packed post record changes, comparing the bytes before
`Weather` (weather is deliberately excluded — it composites after clean lighting history, so wind must not
reset GI). `PostStarEffects.w` sits inside that compared head and is **seconds**: `CelestialSequence::Tick`
advances it every tick whenever stars are visible, and `StarTwinkle` defaults on.

So in any scene with visible stars the record differed on every single frame:

* accumulation index pinned at 1 → `count` never grew,
* `ProgressiveDenoiseStrength` therefore pinned at 1.0 → the filter never faded,
* the image could not converge no matter how still the camera was held.

The twinkle is now excluded from the compare exactly as weather is. It is a per-frame modulation applied to
the **sample** (`PostRecords.slang`: `Flux` from `sin(T)`, `T` from `PostStarEffects.w`), like the lens flare —
so leaving history alone does not corrupt the mean, it converges it. A held camera settles on the mean twinkle
instead of trading the entire frame's convergence for it. Every other field in the head still restarts.

### 1c. Every restart now names itself

A progressive integrator that never converges looks exactly like a broken one, and the difference is a fact
the frame loop already knew and threw away: **which** comparison restarted the history.
`ReSTIRIntegrator::ResetAccumulation` now takes a string literal, and both readouts show it:

* the scene telemetry line — `… | frame 412 (restart: camera move) | …`
* the render panel — `Frame 412 accumulated` / `Restart camera move (57 total)`

A still camera on a settled scene must leave the reason and the total **alone** while the frame count climbs.
If they climb together, the name on screen is the subsystem to look at — no guessing, no instrumented build.
Named sources: camera move / camera turn / viewport resize / camera projection / sky record / moon record /
post record / material apply / instance motion / debug popup / exposure / and one per quality dial.

### What was ruled out (measured, not assumed)

* **A 256-frame cap.** There is none. `BakeFrameCount` only raises the “Initial accumulation ready — refinement
  continues” notification; the integrator keeps incrementing and `ResolveSurface` keeps updating the mean.
* **The SVGF moving-history clamp pinning a still frame at 32 samples.** `kMovingHistoryBound` applies only when
  `prevPx != pixel`. Motion vectors are built from **unjittered** current and previous clip positions
  (`VisibilityRaster.vert/frag`), so a still camera yields exactly zero motion and `prevPx == pixel` — the count
  stays unbounded. AA jitter is applied to `gl_Position` only, after the motion attributes are written.
* **History ping-pong / denoise binding 4 format.** Checked by `Tools/Tests/TestDenoiseSafety.py`; unchanged.
* **Cloud-shadow drift as a per-frame reset source.** `FoldShadowDrift` uses `ShadowTimeSeconds`, a frozen slider
  value, not a clock.
* **An animating sun.** `CelestialClock::Animate` defaults **false**; with the defaults a six-tick CPU run shows
  the sky, moon and post records byte-identical every tick.

---

## ② / ③ The patches were not broken — their error number was ~10× too big

The preview selects a patch's coarse alternative when its projected geometric error is within tolerance:

```
projected = focal · (error · scale) · (1 + (lateral + radius)/nearest) / nearest        ≤ tolerance (px)
```

`error` is the patch's object-space deviation, produced by the bake. v1 computed it as

```
radius[a] = max(radius[a], radius[b] + |ab|)         // the full edge length, summed along the collapse chain
```

which is a chain **sum of edge lengths**, not a deviation. On the native 960-triangle sphere it reported
0.19–0.47 object-space units for patches whose surface actually moves by a few hundredths. The selector divides
the camera distance by exactly that number, so a 10× over-statement is a 10× further switch: nothing changed
until the camera was hundreds of metres from a 2 m ball. That is report ② and ③ — not “not wired”, but
“wired to a number that never fires at a distance a person would dolly”.

The bake now **measures** the deviation: the one-sided distance from the original patch surface to the
simplified one, sampled at every fine vertex, every fine edge midpoint and every fine triangle centroid
(6 samples per fine triangle, ≤ 768 per patch), each closed against every simplified triangle with the exact
point-in-Voronoi-region closest-point test. It is a **sampled** Hausdorff estimate, not a certified bound —
the true maximum can sit between samples — and for a ≤128-triangle patch the sampling is dense against the
triangles that remain.

Measured, native sphere (radius ~1, 8 patches, 960 triangles):

| | patch errors | first distance where detail drops |
|---|---|---|
| v1 chain sum | 0.194 – 0.468 | ≈ 300 m |
| measured (v2) | 0.018 – 0.041 | **21.6 m** |

Torus: 0.014 – 0.037, switch at **17.8 m**.

The patch cache moves to **v2** (`.frontier/cache/patch-geometry-v2/`, version word 2) so no v1 entry can keep
the old distance alive. `FRONTIER_PATCH_CACHE` still overrides the location.

### The tolerance is now a dial — F6

One alternative at a strict one-pixel bound is, correctly, a rare event: one pixel of geometric error is a
tight budget. To watch the transition at a normal viewing distance — and to confirm from the screen that the
selector is live — **F6 in the debug popup (F3) cycles the preview's screen-error tolerance 1 → 2 → 4 → 8 px**.
It is shown in the popup (`patch error 4 px`), persisted as `[render] patch_error_pixels`, and written once per
frame into `Projection.z`, so both cull phases and the vertex shader cannot disagree about it.

First distance at which the selection drops, 720 p, 60° vertical field of view:

| tolerance | sphere | torus |
|---|---|---|
| 1 px (default) | 21.6 m | 17.8 m |
| 2 px | 12.8 m | 9.7 m |
| 4 px | 7.3 m | 5.6 m |
| 8 px | 4.5 m | 3.6 m |

Triangle counts for the sphere (960 fine → 550 fully coarse), by camera distance:

| | 1.7 m | 3 m | 5 m | 8 m | 12 m | 20 m | 35 m | 60 m |
|---|---|---|---|---|---|---|---|---|
| 1 px | 960 | 960 | 960 | 960 | 960 | 960 | 800 | 550 |
| 2 px | 960 | 960 | 960 | 960 | 914 | 800 | 550 | 550 |
| 4 px | 960 | 960 | 960 | 914 | 574 | 550 | 550 | 550 |
| 8 px | 960 | 960 | 914 | 550 | 550 | 550 | 550 | 550 |

### What did NOT change, deliberately

* Selection is still **preview-only**: `Control.z ∈ {14, 15}`, i.e. the quick tile must read **Patch Tiles** or
  **Tiles + Wireframe**. Normal shaded rendering, ray traversal, shadows and luminaire sampling always use the
  fine triangles. Primary/secondary surface correspondence is not implemented, and a coarse raster against a
  fine ray scene is a self-shadowing mismatch, not an optimisation.
* Still **one** alternative per patch (≈ half the triangles). This is not an adaptive hierarchy: past the switch
  distance nothing further happens. Patch tile **colours are stable by design** — in `Patch Tiles` the tiles will
  look identical near and far, and the triangle change is only visible in **Tiles + Wireframe**, or in the
  triangle counter in the F3 popup, which drops as the alternative is taken.
* Protected materials (glass, transmission, subsurface, emissive, layered, uncertain textures, thin slabs) never
  take an alternative, at any tolerance or distance. The gate re-checks this at 1000 distances.

---

## Which “clusters”? — the HTML lab is a different thing, and it is fine

`Experimental/FrontierEditor/cluster-lod.html` (the Nanite-style cluster-LOD lab, `Docs/ClusterLodLab.md`) is an
HTML/Canvas demo with no engine integration. It was checked here and it does respond to distance — same scene,
`buildMesh` triangle count by eye distance: 18 240 (2.2) · 11 248 (4) · 4 928 (8) · 2 784 (16) · 1 552 (24).
If “the clusters don't change” was about the lab, that is not reproducible; the report matches the **engine**
patch preview, which is what ② and ③ above fix. The two systems share a name and nothing else.

---

## Validation run here

| gate | result |
|---|---|
| `bash Tools/Build/CheckPatchGeometry.sh` | PASS, **83 322** CPU checks — new: switch-distance bounds (> 3 m at 1 px, < 150 m at 1 px, < 15 m at 8 px), monotonicity in distance at every tolerance, measured deviation < ¼ of the patch radius |
| `bash Tools/Build/CheckProgressiveDenoise.sh` | PASS — five-scale detail table above, per-band improvement, young-history identity, disabled-filter identity, integrator past 8192 |
| `python3 Tools/Tests/TestDenoiseSafety.py` | PASS — 102 429 arithmetic checks + descriptor/barrier/source guards |
| `bash Tools/Build/CheckShaders.sh` | **GREEN — 22/22 shaders lowered to SPIR-V** (glslang built from source here via `Tools/Build/BuildGlslang.sh`; previous runs of this gate reported SKIPPED) |
| `bash Tools/Build/CheckShaderTableParity.sh`, `CheckBuildSourceList.sh` | GREEN |
| `bash Tools/Build/CheckDriverProgress.sh`, `CheckPipelineCache.sh`, `CheckPerformanceTelemetry.sh` | PASS / GREEN |
| `bash Tools/Build/CheckTelemetryProbe.sh` | **RED before and after this change** — `SyntheticGpu` in the gate has no `HistorySnapshotMilliseconds`; verified identical on the untouched tree, so it is pre-existing and not part of this work |
| C++20 syntax check with real dependency headers | `GameExecution.cpp`, `VisibilityExchange.cpp`, `ReSTIRIntegrator.cpp`, `DiagnosticInspector.cpp`, `ConfigurationRegistry.cpp`, `SceneStructure.cpp` |

The cold-load cost of measuring the deviation is pruned rather than paid: a fine triangle that survives into
the alternative is skipped (it is part of the simplified surface), and a candidate triangle whose bounding
sphere is already further than the incumbent is skipped. Identical errors, 4.3× faster — the sphere's eight
patches measure in 2.04 ms, 15 % of their cold bake. It is cached (`.pgeom`) after the first load either way.

The whole change is ONE commit on top of the imported engine tree, so it lands on
`streamlinkinbox/Frontier@arena/01a0c77d-frontier` as a single conflict-free cherry-pick — the import commit's
tree is byte-identical to `ceee3d2`'s, and the cherry-picked result's tree hash matches this branch's exactly.

## How to confirm it on the machine that has the GPU

1. Rebuild **executable and shaders together** (the patch cache rebakes itself; v1 entries are ignored).
2. Shaded view, native resolution, hold the camera still past the “Initial accumulation ready” notification.
   The scene line must show `frame N (restart: …)` with **N climbing** and the restart total steady. If N sticks
   at 1, the reason printed next to it is the subsystem that is still wiggling — that is the whole point of it
   being on screen.
3. Compare a fine texture or a specular edge at ~30 s of hold against the same frame at one second. The first
   second is unchanged by design; the difference is everything after it.
4. Patches: F3 to open the popup, quick tile to **Tiles + Wireframe**, F6 until it reads `patch error 8 px`,
   then dolly an opaque smooth mesh between 3 m and 10 m. The wireframe inside the tiles must thin out, the tile
   colours must not change, and the popup's triangle count must drop. Glass and emissive objects must keep their
   full wireframe at every distance.

---

# Second pass — 2026-09-26 evening, from the owner's screenshots

Five items came back from the running build. What each one was, and what changed.

## ① "The clusters are there but don't seem to update"

The screenshots are `Patch Tiles` at ~10 m over the showcase grid. **Nothing in that image can tell you whether a
patch swapped**, because the preview was built to keep a patch's colour *stable* across a detail change — that was
a deliberate choice (identity must not flicker) and it made the feature invisible without the wireframe.

Two additions, so the answer is on screen either way:

* **The alternative now shades itself.** In `Patch Tiles` and `Tiles + Wireframe` a patch drawn through its coarse
  alternative keeps its hue and drops to 34 % value. Dolly out and the tiles darken one at a time as each patch
  crosses its error bound; dolly in and they light back up. Identity still never changes hue.
* **The F3 popup counts them**: `patch coarse 312/1240 → 52 100 fine, -25.3%` — how many drawn clusters took the
  alternative, what the frame would have cost at full detail, and the saving. Two new GPU counters
  (`kCounterCoarseDrawn`, `kCounterTriangleFine`) written by the cull, read back with the existing funnel.

With the measured error from the first pass, a 1 m sphere switches at ~10 m at the strict 1 px bound, so in that
exact screenshot most of the grid should already be dark; **F6** raises the tolerance (1 → 2 → 4 → 8 px) and pulls
the transition into arm's reach.

## ② "Are those fireflies? I wanted to see the flakes"

They are **sampling noise, not flakes** — and the sphere in the inspector (`grid_r10_c19`) has no flakes to see.
The showcase grid is one material study per row, and glints live on **row 12** (`ShowcaseStructure.cpp`, case 12:
Deliot–Belcour flake density 1 → 8 across the columns over 0.8-metalness hue-tinted metal). Row 10 is the
dielectric → metal morph: metalness sweep, roughness 0.22, no `slate_glint_*` at all. Fly to `grid_r12_c00` …
`grid_r12_c19` and the flakes are the thing that changes along the row.

The speckle itself is the path tracer at a low sample count — roughness 0.22 at metalness 1.0 is the classic
firefly material, and every one of those frames was taken with the camera moving, which restarts the history by
design. Hold still: with the first pass's fixes the frame count climbs, the speckle averages out and the image
sharpens instead of stopping at "blurred". If it does NOT settle, the scene line now prints the reason
(`frame 1 (restart: …)`) and that name is the bug.

Rain is not the answer here: precipitation at 12 mm/h is simulation state feeding the media, and nothing in
`Engine/Shaders` draws drops.

## ③ The disc shelf over the viewport is gone

Twelve editor proxies for sky, sun, stars, moons, flare, wind, the cloud deck, precipitation and the two global
fogs were laid out as a camera-facing shelf across the top of the render — markers for entities that have no
position. They are removed. The **local cloud and local fog keep their markers**, because those are real
world-space centres, they are how the volume is grabbed, and the gizmo now follows them (⑤). Global systems stay
where they belong, in the outliner.

## ④ The outliner moves now

* **Folding is a movement.** Each row carries an open phase that chases its collapsed state with a ~90 ms time
  constant; a folder's children draw at that phase — full height at 1, nothing at 0, every height between — with
  their ink fading as the square of it and a clip rect so nothing spills. Nested folders multiply, so a
  grandchild folds with its grandparent. A subtree whose phase reaches 0 is skipped exactly as before, so a
  closed tree still costs nothing.
* **The chevron sweeps** its quarter turn with that same phase instead of snapping (the two end poses are the
  float-identical ones it drew before).
* **The wheel glides.** The tree takes the wheel itself (`NoScrollWithMouse`) and eases toward the target
  (frame-rate independent, stops dead under a pixel so a resting list is bit-stable). A pick that scrolls itself
  into view still wins its frame; the glide adopts the new position on the next one.

## ⑤ Local volumetric fog and clouds move with the gizmo

Selecting the local cloud or the local fog — in the outliner or by its viewport marker — now seats the transform
gizmo on the volume's centre and drags it. Translate only, on purpose: a centre has no orientation and no scale,
and the extent is the inspector's own figure. Escape restores the centre from the press, exactly as it restores
an instance's world, and the release commits. The move restarts the accumulation (`restart: volume move`),
because the lighting in the history was gathered through the volume where it used to be.

One shared answer decides all of it — `EditorInspectorSequence::VolumeCentre` — so the marker, the gizmo and the
drag cannot disagree about which entities are movable.

## Also worth knowing, from the log you sent

* `SceneDecode` took **95.8 s**. That is the patch bake running COLD: the v1 → v2 cache bump invalidated every
  entry, so every one of the 3 590 clusters rebaked on that launch. It is cached afterwards
  (`.frontier/cache/patch-geometry-v2/`) — the second launch should be back to a few seconds. The measurement
  itself is ~15 % of that; the greedy collapse loop is the rest.
* The freeze after `CpuAnimationMirrorCapacity` is not something this change can explain from here — the line
  after it is the first frame's work. If it happens again, the startup CSV
  (`Build/Diagnostics/startup-*.csv`) plus the last `[GPU startup]` line is what identifies the stage.

## Gates for this pass

`CheckShaders.sh` **22/22 to SPIR-V** (ClusterCull, SurfaceResolve and the rest, with a glslang built here),
`CheckPatchGeometry.sh` 83 322 checks, `CheckProgressiveDenoise.sh`, `TestDenoiseSafety.py`, and C++20 syntax
checks of every touched translation unit against real headers. `CheckEditorVisualProofs.sh` is RED before and
after — its source list has drifted (22 undefined references) and the icon path needs thorvg, which is not
installed here; `CheckTelemetryProbe.sh` likewise. Neither was disturbed by this work, and **none of this ran on
a GPU**.

---

# Third pass — the pointer while flying, 2026-09-26

**Report:** flying the scene (right mouse held + WASD) ends up hovering rows in the outliner and opening the
Construct menu, which is then not visible.

Two separate causes, both fixed.

* **Shift+A is the Construct menu AND “boost + strafe left”.** `EditorHost::RecordTabAdd` opened Construct on
  `Shift + A` with no regard for what the camera was doing, so every boosted leftward strafe opened it — behind
  the viewport, where you would not see it. The shortcut is now refused while the camera steers.
* **GLFW puts the cursor in disabled mode while the right button is held**, which means the pointer no longer
  sits where you left it: it travels with the look. ImGui kept receiving those positions, so rows lit up under a
  cursor that is not drawn, and a click landed wherever the look had carried it. `RenderScheduler::Present` now
  raises `ImGuiConfigFlags_NoMouse` for any frame in which the camera is steering: ImGui discards the position
  and the buttons for that frame — hover, clicks, drags and `WantCaptureMouse` all go quiet — and lowers it again
  on release. Flight itself reads nothing through ImGui, so the camera is untouched.

One flag decides both (`EditorHost::AssignCameraSteering`, set from `FlyThroughSolver::IsSteeringActive()`), so the
pointer and the shortcuts can never disagree about who owns the input.

If the Construct menu is still invisible when you open it **deliberately** (the dock's + or Shift+A while not
flying), that is a separate defect in where the panel places itself — say so and it gets its own pass.

## Viewport header

`Docs/Design/ViewportHeader.html` is the redesign proposal: today's rail annotated with what is wrong with it,
then three options drawn with the engine's own tokens, live (the modes and toggles click), plus every state of the
recommended option, the narrow-rail behaviour, and a table of what each piece costs in `ViewportPanel.cpp`.
Nothing is implemented yet — it is a mockup waiting on a choice.
