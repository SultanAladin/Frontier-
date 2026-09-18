# Project-Zero — analysis of your build + run log

Analysed from `unassignedinbox/Slate` @ `arena/01a0b5cf-slate` (commit `dce02b8`).

**Important:** the repo this session is attached to (`SultanAladin/Frontier-`) does **not** contain
Project-Zero. It holds the older *architecture-plan* tree (docs, `Shaders/*.comp` stubs, skeleton
`.cpp`). The engine you are building — `Engine/DeviceExchange/VisibilityExchange.cpp`,
`FrameTelemetryLedger`, `MaterialEvaluation.slang`, `SlangCpuShim.h` — lives only in the Slate repo,
which the agent token can read but **not** push to. So the fix below is delivered here as a patch.

---

## 1. Why every GPU timer reads `0.00` — found, proven, fixed

This is the headline bug, and it invalidates the rest of your log's conclusions.

`VisibilityExchange::ReadTelemetry()` reads back the timestamp pool like this:

```cpp
if (vkGetQueryPoolResults(..., VK_QUERY_RESULT_64_BIT
                             | VK_QUERY_RESULT_WITH_AVAILABILITY_BIT) == VK_SUCCESS)
```

The pool is `kTimestampCount = 20` queries per slot. All 20 are reset every frame, but only a
subset is ever written:

| queries | stage | written? |
|---|---|---|
| 0–11 | cull / raster / HiZ / resolve / trailing | every frame |
| 12–13 | shadow | only on a GI-**off** frame |
| 14–15 | ReSTIR dispatch | only when the kernel runs |
| 16–19 | sky, volume | **never — zero call sites in the whole tree** |

I verified 16–19 have no writer anywhere:

```
$ grep -rn "RecordSkyBegin|RecordSkyEnd|RecordVolumeBegin|RecordVolumeEnd" --include=*.cpp Engine Projects \
    | grep -v VisibilityExchange.cpp
(no results)
```

Per the Vulkan spec, without `VK_QUERY_RESULT_WAIT_BIT` the call **returns `VK_NOT_READY` if *any*
query in the range is unavailable**. Queries 16–19 are unavailable on *every* frame by construction,
so the call returns `VK_NOT_READY` **always**, the `== VK_SUCCESS` test is **never** true, and the
entire timing block **never executed once** in the lifetime of the program.

That is exactly your log: `GPU 0.00 ms total | cull 0.00 · raster 0.00 · … · volume 0.00` on every
single line — not a slow GPU, a branch that never ran.

**It also invalidates the `CPU-BOUND` verdict.** `PerformanceTelemetrySequence` derives
"CPU-BOUND or presenting-limited … kernel 0% of GPU frame" from those zeros. With GPU total
identically 0, that line can only ever say CPU-bound. You do not currently know where your frame
time goes.

Proof without a GPU — `GpuTimingProof.cpp` in this folder emulates the driver's documented
behaviour:

```
current  : result=1 -> block SKIPPED, cull reported = 0.00 ms
fixed    : result=1 -> block ran,  cull reported = 0.10 ms, sky = 0.00 ms (correctly 0, never written)
```

**Fix** (`0001-fix-gpu-timing-vk-not-ready.patch`): accept `VK_NOT_READY` as the normal result and
let the per-query availability word decide which stamps are real — which is precisely what
`WITH_AVAILABILITY` was already requested for, and what the existing `Have()` guard already does
correctly. One-line semantic change; the arithmetic below it was already right.

Apply in your Slate checkout:

```bash
git apply docs/analysis/0001-fix-gpu-timing-vk-not-ready.patch
```

Fix this **first** — every other performance question is unanswerable until these numbers are real.

---

## 2. Why you see no shadows and no GI — they are mutually exclusive by design

These are not two bugs; they are one design consequence.

In `SwapchainExchange.cpp:2992` the shadow stage only runs when GI is **off**:

```cpp
const bool GlobalIlluminationOff = (Dispatch.FeatureFlags & DispatchFeatureGlobalIllumination) == 0u;
if (Frame.DebugView == Off && GlobalIlluminationOff && ShadowFrameValid && Visibility.IsShadowReady())
```

And GI defaults to **on** (`ReSTIRIntegrator.h:39`, `ControlCentreHost.h:119`). So on a default run
the shadow-map path is **never recorded** — consistent with `shadow 0.00` in your log — and light
visibility is supposed to come from ReSTIR ray queries instead.

But on your GTX 1650 SUPER the log says:

```
Ray tracing: supported = Software BVH … [AS ext 0 feat 0 | RQ ext 0 feat 0]
```

The 1650 SUPER (TU116) has no RT cores and NVIDIA does not expose `VK_KHR_ray_query` on it, so you
are on the software-BVH path — traversing a CWBVH in a compute shader. That is the slow path, and
it is the only thing producing shadowing/GI while GI is on.

So the two states are: **GI on** → no shadow maps, all occlusion via slow software traversal;
**GI off** → shadow maps, but the tier also gates GI. Note `FidelityCriteria.GlobalIlluminationEnabled`
is **set in all five tiers and then read nowhere** —

```
$ grep -rn "GlobalIlluminationEnabled" Engine Projects
FidelityClassifier.cpp:40,65,90,115,141   (assignments only)
FidelityClassifier.h:152                  (declaration)
```

— it is dead. GI actually follows the Control Centre toggle (`S.GlobalIllumination`), so selecting
Minimal/Economy does *not* turn GI off as the tier table claims, and therefore does not turn shadows
on either. That mismatch is very likely why shadows "used to work and are now gone": whatever used
to set GI off no longer does.

**To get shadows back right now:** turn GI off in the Control Centre. To have both, the shadow stage
needs to stop being an `else` branch of GI — it should run whenever sun/moon/emissive taps exist, and
feed its visibility term into the kernel rather than replacing it.

---

## 3. `SlangCpuShim.h` in a Release build — the previous answer was correct

Those `C4244`/`C4305` lines are **warnings, not errors** — your build linked (`Linking Project-Zero.exe`).
They come from `Engine/Shaders/MaterialEvaluation.slang` compiled *as host C++* via the shim, pulled
in by `ShaderballExhibit.cpp`, the editor's material-preview renderer. Commit `dce02b8` already gated
that TU behind `FRONTIER_DEVELOPMENT` in both CMake (`FRONTIER_ZERO_DEVELOPMENT`) and the PowerShell
batch (`-Development`).

The catch: `CMakeLists.txt:349` has `option(FRONTIER_ZERO_DEVELOPMENT ... ON)` — **default ON**. So a
plain `Release` build still compiles it. Configure with `-DFRONTIER_ZERO_DEVELOPMENT=OFF` (or drop
`-Development`) and the file and its warnings disappear. The warnings are cosmetic either way.

---

## 4. Startup time — ~2.3 s is three rebuilds of data that never changes

From your log:

| phase | cost |
|---|---|
| texture decode (6 textures, 64 MB) | **1116 ms** |
| CWBVH build (92 670 tris, SBVH spatial splits) | **388 ms** |
| two-level BLAS/TLAS build | **823 ms** |

There is **no disk cache for any of it** — `grep -rni "bvhcache|CacheFile|LoadFromDisk"` returns
nothing. Every launch rebuilds an SBVH for geometry that hasn't changed.

The blobs are already flat, contiguous, `memcpy`-ready byte arrays (`TraversalIndex.cpp:75-76`) —
~7.5 MB CWBVH + ~5.7 MB two-level. Serialising them is genuinely easy: write
`{magic, version, source-hash, node/leaf counts}` + the two blobs; on load, `mmap`/read and skip the
build. Keyed on a hash of the source geometry + `kShowcaseRevision` so a changed scene rebuilds
automatically. That alone should take ~1.2 s off startup, and the decoded+mipped textures can be
cached the same way for the other ~1.1 s.

Note also `BuildHQ` (SBVH with spatial splits) is the most expensive builder tinybvh offers. For
iteration you want a fast binned build; keep SBVH for the cached/shipping artefact.

---

## 5. "Data on CPU RAM not GPU RAM" — you are right, and it is deliberate but costly

`CreateBuffer(..., HostVisible=true, ...)` selects `HOST_VISIBLE | HOST_COHERENT` and maps
permanently (`VisibilityExchange.cpp:206-221`). Instances, frame constants and counter readback all
use it. `RefreshInstances` explicitly relies on it (`:892`) — "plain memcpy into memory the GPU
already sees", which is what lets it run per frame without reallocating.

On a discrete card that means those reads cross PCIe every access instead of living in VRAM. It is a
reasonable choice for small per-frame-updated buffers, but the large **static** payloads — flat
triangles, vertices, indices, CWBVH node/leaf blobs — should be `DEVICE_LOCAL` with a staging upload.
Your RSS wandering 460→1192 MiB across the run is consistent with large host-visible allocations plus
the reservoir pools being reallocated on resize (`Reservoirs: 2 x 70 MB` → `2 x 73 MB`).

---

## 6. The telemetry ledger — good design, barely wired in

`FrameTelemetryLedger` does what you asked: preallocated 64 MB ring of 32-byte POD samples, no
allocation/locking/formatting/IO on the hot path, RAII scopes, written once at shutdown, and fully
`#ifdef FRONTIER_DEVELOPMENT`'d out (the non-dev macros expand to `do {} while(false)`). That matches
your requirement exactly.

The problem is coverage. You asked for "very verbose, every frame". Actual instrumentation:

```
$ grep -c "FRONTIER_TELEMETRY_" Projects/Project-Zero/Source/GameExecution.cpp
8
```

and **inside the render loop there is exactly one scope** — `FRONTIER_TELEMETRY_SCOPE("Frame")`.
So the per-frame log currently records one number per frame: total frame time. No breakdown of
input/sim/cull/record/submit/present, which is the thing that would tell you where your 30–80 ms is
going. Startup has 8 scopes (`SwapchainBring`, `ShadingTableBake`, `UploadScene`, `TextureDecode`) but
**no scope around the two BVH builds** — the single largest startup cost after texture decode is
unmeasured.

Also: shader module loads are never timed (no `FRONTIER_TELEMETRY_SHADER` call site exists), so
"shader times" — which you explicitly asked for — are not recorded at all.

Next step is straightforward: nest scopes through the loop body and wrap the BVH builds and each
SPIR-V load. The facility is sound; it just needs call sites.

---

## 7. ReSTIR on a GTX 1650 SUPER — honest assessment

**Blunt version: this GPU is the wrong hardware for this renderer, and no amount of tuning changes that.**

- **No RT cores, no `VK_KHR_ray_query`** (`RQ ext 0 feat 0`). TU116 is Turing-without-RT; NVIDIA does
  not expose ray query on it. Every ray walks a CWBVH in compute. Expect roughly an order of
  magnitude off a hardware-BVH card.
- **4 GB VRAM.** Your reservoir pools alone are `2 × 73 MB` (DI) + `2 × 73 MB` (GI) = ~292 MB at
  80 B/px, plus 64 MB textures, ~13 MB BVH blobs, G-buffer, HiZ, shadow maps. Workable at 720p,
  nothing to spare at 1080p.
- **Note the CWBVH traversal caveat** in `TraversalIndex.cpp:165-184`: tinybvh's packed CWBVH CPU
  walker is AVX-only, and your build log shows `AVX not enabled in compilation`. That affects the CPU
  reference path, not the GPU kernel — but it means any CPU-side tracing is on the slow fallback.

Your log does show the settings ladder behaving sanely: at `16 candidates + 4 extra + 4 spatial taps`
you get ~16–19 fps; dropping to `1 candidate + 0 + 0` gets you to 50–60 fps. That is the expected
shape.

**But I cannot give you the ReSTIR performance report you asked for, and I want to be straight about
why:** with the GPU timers dead, there is no measurement of how long the ReSTIR kernel actually takes.
Every ReSTIR figure in your log is `0.00`. The frame-time correlation above is suggestive, not
attribution — the cost could be in traversal, the denoiser, or the resolve. Apply the patch in §1,
re-run, and the `GpuReSTIRMs` / `GpuShadowMs` / `GpuPostMs` rows will give real numbers. I'd rather
hand you that than invent a breakdown.

---

## Suggested order

1. **Apply the GPU-timing patch** — nothing else is measurable until then. ← fixed, patch included
2. Re-run, capture real per-stage GPU numbers.
3. Decide the shadow/GI relationship (§2) — this is a design call, not a bug fix.
4. Cache the BVH + decoded textures to disk (§4) — ~2 s off every launch.
5. Fill in telemetry call sites (§6) — loop breakdown, BVH builds, shader loads.
6. Move static payloads to `DEVICE_LOCAL` (§5).
