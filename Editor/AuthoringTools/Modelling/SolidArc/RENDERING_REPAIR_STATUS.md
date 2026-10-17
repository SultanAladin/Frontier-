# SolidArc repair status — 2026-10-15

## Current result: approved browser UI on WebGL2; native Vulkan still pending

No commits, pushes, PRs, releases or workflow executions were made.

The approved UI is the recovered `Experimental/SolidArc` at
`arena/215a6f39-frontier`, `f2cfc57daaaf1fafc9a01a2002af6cad8cbd0f0f`.
That UI and its improved C++ geometry/gizmo sources are now reused in this checkout.
The browser stylesheet is byte-identical to that approved revision. Only rendering/input
integration and truthful transport/renderer labels were changed initially. The follow-up adds
requested startup/recovery and drafting prompts in a separate stylesheet; the approved base
stylesheet remains unchanged.

The previous October implementation's separate invented shell and CPU-pixel-upload Vulkan
loop were not imported. This branch starts at September main (`28ec0657a23e`).
`CLAUDE.md`/`claud.md` was not found in the checkout; existing naming/formatting and proof
conventions were followed.

## Empty/recoverable documents and staged drawing follow-up

Pinned published Pages source is retained unchanged in `Experimental/SolidArc/Reference/`;
its README distinguishes configured source from an independently fetched deployed response.
Fresh HTML documents start empty, with Welcome back / Continue previous / New document when
an autosave exists. Previous-copy recovery, debounced non-rendering native snapshots, explicit
workplane selection, click-to-size sketch primitives, GPU rubber bands, spatial DM Sans labels,
cancellation and one-step native undo/redo are implemented. Random ring placement was removed.

C++ `ToolSession` remains the modeling source. A transactional `draw` command validates before
editing. Native ImGui connects the actual Construct chip to its catalogue, displays spatial
`ToolPreview::Dimensions` using the UI font, adds local recovery and starts the interactive
C++ mirror empty. Native New clears document metadata, unlike the legacy script `reset`.
Native headless proof passes empty/dimension cleanup, actual Construct popup, modal rectangle
pointer completion and undo, in addition to prior camera/gizmo/device checks. Shared DM Sans
is explicitly loaded by that proof. Generated CPU evidence is not evidence of native Vulkan.

Native 17/17, browser workflow 9/9, existing browser 12/12, interaction 8/8, device 8/8,
startup transport 3/3 and packet 6/6 checks passed during this follow-up. The camera performance
regression still reports zero per-drag HTTP/uploads/readbacks under 800 ms artificial latency;
latest software run submitted 60 frames in 6,285.2 ms, **not a physical-GPU fps claim**.

Full controls, reproducible commands and explicit unported reference features are recorded in
`Experimental/SolidArc/WORKFLOW.md`. This pass does not claim full reference-app parity,
exact live spline rubber bands, browser object snapping, native Vulkan or a rebuilt WASM.

## Browser implementation

* `Presentation/CommandExchange.h`: injected native draw device records existing surface,
  segment, point, lattice and gizmo/overlay streams. It does not rasterize or return RGBA.
* `Experimental/SolidArc/Native/GeometryExchange.cpp`: shared C ABI bridge emits those
  vertex commands and accepts coordinate-specific GPU identities / compressed box-pick runs.
* `Native/GeometryHost.cpp`, `Native/ServeSequence.py`: local native C++ development
  transport, isolated per browser session, serialized requests, same-origin proxy.
* `src/DeviceExchange.js`: actual WebGL2 surface, instanced line/point, lattice and final
  display pipelines; multisampled linear colour/depth, independent unblended identity
  target, GPU resolve/display transfer, resize/resource destruction and adapter diagnostics.
* `src/ShaderCodec.js`: GLSL ES translation of the actual shared `.slang` bodies, not an
  unrelated recreation. The CPU raster still includes those shader bodies as C++.
* `Shaders/DisplayTransfer.slang`: original display curve shared by CPU and GPU. This
  preserves the approved appearance instead of displaying linear values as dark colours.
* `src/WorkspacePanel.js`: original UI, with command transport and device presentation
  replacing `Canvas2D.putImageData`. There is no CPU raster fallback in the GPU route.

Click picking reads one GPU identity pixel; box selection explicitly reads a GPU identity
plane, not a display image. Native analytic gizmo logic stays in C++. Geometry, grid, edges,
control points, gizmo and overlays rasterize through the browser graphics device. HTML/CSS
panels remain browser UI; no custom native Vulkan UI implementation is claimed.

See `Experimental/SolidArc/README.md` for commands and transport limitations.

## Viewport performance follow-up

The first GPU integration still put full native HTTP/draw-packet reconstruction on every
camera update. Measured scene: 4,410 triangles / 1,350 segments, roughly 0.6 MB JSON per
response and 29–32 ms native preparation/pipe time before network overhead. This was an
integration bottleneck, not evidence of excessive polygon count or a tessellated grid.

`CameraSequence.js` now predicts camera-only motion using the original C++ matrix conventions;
`NativeChannel.js` coalesces local animation-frame updates and synchronizes the final camera
back to C++. Geometry and native gizmo edits remain C++ authoritative. The device retains
meshes, uploads view uniforms once per pipeline/pass, renders interactive color at 1 sample,
restores up-to-4x idle quality, lazily renders picking, and bakes the shared matcap studios on
GPU. Unchanged idle hover suppresses redraws. Actual GPU overlay geometry gates native gizmo
starts; exact grip hit/drag behavior remains native.

Fresh checks: native 13/13, packet 6/6, browser 12/12, device 8/8, startup/transport 3/3,
interaction 8/8, and production build passed. Performance regression: 12 native camera parity
cases (max relative error 4.14e-9), ordinary LMB orbit under 800 ms artificial network latency
with zero per-drag HTTP/native requests, vertex uploads or GPU readbacks, exact final yaw sync,
and zero redraws for 20 unchanged hover events. CSS remains unchanged.

Limitations: software ANGLE/SwiftShader only; latest concurrent run submitted 60 frames in
8,493.4 ms (~7 fps), earlier isolated run in 5,506.5 ms (~11 fps). Headless/software/compositor
cadence has not been isolated; **physical GPU, embedded smoothness and 60 fps are unverified**.
Native geometry-edit/gizmo drag still uses serialized full native responses. View-dependent
helpers refresh natively after camera movement. See README for reproducible commands and
`BROWSER_ARTIFACTS/SolidArcPerformance.json` output; no native Vulkan completion is implied.

## CPU and native counterparts

* The retained recovered WASM module is explicitly a **legacy CPU reference**. It is not
  initialized by the default native/GPU browser transport and cannot satisfy the new GPU
  export contract. `test:reference` is labeled separately from current-native tests.
* A CPU browser screenshot was captured from the unchanged approved revision at 1440×900.
  A GPU screenshot uses the same scene, camera, UI and size. Antialiasing/float precision
  differences mean pixel identity is not claimed.
* `Verification/CommandVerification.cpp` checks the actual C++ scene/gizmo command device,
  no CPU image readback, full identity values, exact pick coordinates, distinct identity
  regions, point streams and resize.
* The earlier native editor input fixes remain: injected `RasterExchange`, real editor
  texture seam, owned pointer capture, native input journal with camera/extent, undo and
  save/reopen replay. They were merged back after importing the newer geometry sources.
* `Tools/Build/RunSolidArcEditorProof.py` still builds/runs the existing C++ editor CPU proof.
  Its older native panel layout is not being substituted for the approved browser layout.
* `SolidArcMirror.html` / `ServeSolidArcMirror.py` remain explicitly **CPU proof tools**.
  The actual GPU HTML implementation is `Experimental/SolidArc/index.html`, not that
  CPU-image transport page.

## Verification performed

* Native standalone CMake build: all 56 verification executables plus console/UI libraries
  compile (the original 55 plus the new command-device counterpart).
* Focused CTest: **8/8 passed** — ArrayAndBridge, Command, Document, Interaction, Kernel,
  Raster, Selection, Topology. The stale ten-studio assertion was updated to assert the
  recovered fourteen named studios, including rubber, glass, headlight and taillight.
* Fresh native geometry transport: **12/12 passed**, including original example studies,
  all 22 Construct entries, dimensions/undo/redo, hole extrusion, native save/reopen,
  malformed input, documents, OBJ, camera, point streams, refusals and box identity runs.
* Original browser integration: **12/12 groups passed**, including real face/edge/filled
  region picking, edits, documents, import/export, catalogue and responsive layout.
* Original mouse/navigation/gizmo checks: **8/8 groups passed** — coalesced deltas, wheel,
  right/middle pan, original gizmo move/rotate/scale/planar grips, snapping, Escape, undo,
  native save/reopen, transform inspector and mobile catalogue.
* GPU-specific checks: **8/8 groups passed** — real draw calls, compiled shared shaders,
  multisample resolve, colour/camera changes, distinct box regions, native point picks,
  `0xfedcba98` RGBA8 identity round-trip, resize and cleanup. Observed **zero CPU image
  blits and zero image texture uploads**. Full display readback occurs only in tests.
* Retained CPU WASM reference: **24/24 passed**, explicitly not current-native GPU evidence.
* Native editor CPU proof: passed, including actual ImGui pointer/gizmo interaction,
  release outside the viewport, undo/redo and native save/open replay.
* Vite production build: passed. Python syntax and `git diff --check` checked separately.

Browser execution used ANGLE/Vulkan **SwiftShader software driver**. It validates the GPU
API/command/shader path but **does not prove physical GPU acceleration**. UI metrics label
software drivers honestly; physical-device execution is still required.

## Unfinished scope — not concealed by the browser result

1. Rebuild and validate the new C++ command bridge with Emscripten. The SDK was unavailable
   in this environment. Current working preview uses the native C++ service, not WASM.
2. Produce/test a browser-only GPU artifact; deployment currently needs the native service.
3. Implement native Vulkan `RasterExchange` and the real native ImGui Vulkan backend,
   then validate SPIR-V, synchronization, resize, picking and GPU diagnostics. An interface
   or CPU image upload is not that implementation.
4. Correct/validate the binary publishing workflow only against a verified actual native
   application. No workflow run or publication is being claimed.
5. Full long-running native test suite and physical-GPU validation have not been completed.
   Focused suites are not represented as a full-suite pass.

## Follow-up: reported missing-frame failure in the live preview

The reported `undefined.cpuFragments` error exposed an unchecked response contract.
A retained CPU worker can return `description` plus `pixels`, while the new renderer
requires `frame`. This reproduces the error; the remote browser cache itself was not
inspected directly. The worker URL and ready handshake are now protocol-versioned,
development responses disable caching, and both transport and UI validate command
packets before touching document/frame fields. Startup rejections are handled.
Six packet unit tests and two browser regressions cover stale ready messages and
legacy pixel responses without unhandled errors. The working native/GPU startup and
all eight device checks were rerun successfully after this change.

## Follow-up: reload did not repair the user's embedded preview

The user still received the worker-handshake failure after reload. The earlier
cache explanation was not sufficient and was not confirmed in their browser.
The native preview now uses `NativeChannel` async HTTP directly, with no browser
Worker dependency. Geometry computation stays in the separate C++ process and
rendering stays WebGL2; this is not a CPU-render fallback. The optional WASM route
still uses its worker. The old 5174 preview was stopped and a fresh editor preview
started on 5176. Tests deliberately disable the global Worker constructor and
verify that all seven initial figures load on WebGL2. Additional regressions
cover malformed legacy responses and unavailable service without unhandled
exceptions. All eight GPU checks passed on the new port. Remote embedded-browser
success still requires the user to open this fresh preview; it is not inferred
from a local browser test.
