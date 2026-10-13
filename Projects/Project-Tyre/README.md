# Project-Tyre — the redesigned XPBD tyre system, as a WebGPU prototype

Companion to `Docs/XPBDTyrePhysicsReport.md`. The report said what was wrong; this is the better system,
built so the theory can be **measured**, not argued. Prototype: `Web/XPBDTyreLab.html` (single file, WebGPU).

## The design in one picture

```
CPU (physics, fixed 240 Hz)                     GPU (presentation, frame rate)
─────────────────────────────                   ─────────────────────────────────
coarse XPBD lattice                              18 432-vertex render tyre ×4
  NEW: 4 rings × 48 seg = 192 nodes/tyre           (256 around × 72 profile)
  ├─ spokes → rotating rim anchors                 ▲ skinned in the VERTEX SHADER:
  ├─ ring + cross distance constraints             │   local = rest + (skinnedAnchor − restAnchor)
  ├─ 1 global pressure (mean-radius) term          │   4 sim nodes per render vertex,
  ├─ ground: coarse query + sector cull,           │   bilinear weights, baked at build
  │   cached ONCE per substep                      │
  ├─ 8 substeps × 1 sweep (Small Steps)            └─ node block upload: 192 × vec4 / tyre
  └─ deflection → load curve (185 N/mm class)
        → hub DOF → suspension → chassis heave/pitch/roll
```

Rules this enforces (each is a finding from the report):
1. **Physics never touches render vertices.** The 9×128-class mesh is GPU-skinned output only.
2. **Substeps over sweeps.** Sweeps exist in the UI only to A/B the old allocation.
3. **Collision leaves the sweep loop.** One coarse ground query per wheel per substep, then queries only
   for nodes inside the reachable sector; the sample is cached for every sweep of that substep.
4. **Everything invariant is baked at Build:** constraint topology + rest lengths (flat typed arrays),
   anchor positions per substep, skin weights per render vertex. No allocation in the step loop.
5. **Load path is explicit:** the lattice *measures* deflection and patch; tyre load comes from a
   deflection curve. (Feeding raw λ/h² impulse sums into the hub at h = 1/1920 s pumped energy in
   testing — documented in the code. In the native solver this is where a Pacejka stage would hang:
   Fz, deflection, patch node count are exported per tyre for exactly that.)

## What the prototype simulates

Per tyre: particle lattice in world space, XPBD distance constraints with compliance α
(α̃ = α/h², pressure slider scales α), rim anchors rotating with spin, ground contact (analytic
treadmill terrain: travelling speed-bumps + washboard), contact friction, pressure term.
Per wheel: a vertical hub DOF on a suspension spring/damper. Chassis: heave/pitch/roll driven by the
four suspension forces. **Fixed 240 Hz step with an accumulator — physics rate is independent of your
display's refresh rate.** Front wheels steer (visual + anchor frame).

Honest prototype simplifications (not hidden): tyre load uses a deflection curve rather than the summed
contact λ; chassis is 3-DOF + hub DOFs, not a full rigid body; terrain is analytic, not a mesh;
delta-skinning carries the rest-profile offset rigidly (production would add deformation-gradient
normals). None of these affect the thing under test: **cost scaling of lattice × passes, and CPU vs GPU skinning.**

## Running it

Serve the folder (WebGPU needs https or localhost):

```
cd Projects/Project-Tyre/Web && python3 -m http.server 8765
# open http://localhost:8765/XPBDTyreLab.html   (current Chrome/Edge; Safari 26+)
```

Presets (top of panel):
- **NEW** — 4×48 lattice, 8 substeps × 1 sweep, GPU skin. The proposed system.
- **LEAN** — 3×32. The floor of the design.
- **A (hoisted only)** — 9×128 render-coupled lattice, 8×1. Isolates what hoisting alone buys.
- **OLD** — 9×128, 8 substeps × 4 sweeps. The configuration described in the earlier session. Expect a crawl.

Skinning toggle switches the same 73 728 render vertices between vertex-shader skinning and a CPU loop
that recomputes and re-uploads every vertex each frame (that's the "CPU skin ms" metric).

## Reading the frame times — and sending logs

Panel shows, rolling over the last ~240 frames: **frame ms** (avg/p95), **CPU physics ms**, **CPU skin ms**
(0.00 in GPU mode), **GPU render ms** (WebGPU timestamp queries when the adapter exposes them, else n/a),
sim nodes/tyre, constraint evaluations per rendered frame, ground queries per fixed step (+ sector-culled
count), per-tyre Fz / patch nodes / deflection, and a frame-time history graph (white = 16.7 ms).

**To send results:** run each preset for ~10 s (let it settle, drive over the bumps), then click
**⬇ Download log (.json)** once at the end. Every sample in the series is tagged with its config
(`rings×seg/substeps×sweeps/skin/speed`), so one file can contain all four presets — just change preset,
wait 10 s, repeat, download once. The file also carries the adapter/browser info and avg/p50/p95/max
summaries. Send that file back.

## Sandbox reference numbers (indicative only — NOT your machine)

Headless Node run of the extracted physics core (2-vCPU sandbox, JavaScript — a native SoA build should
be far faster; treat these as *ratios*, not targets):

| preset | CPU physics / rendered frame | ground queries / fixed step |
|---|---|---|
| NEW 4×48, 8×1 | 3.44 ms | 1 843 (whole step; sector-culled rest) |
| LEAN 3×32, 8×1 | 1.58 ms | 933 |
| A 9×128, 8×1 | 19.1 ms | 10 463 |
| OLD 9×128, 8×4 | 49.4 ms | 10 618 |

Settled state in the same run: chassis height 0.748 m (0.757 predicted from spring rates), Fz ≈ 3.3 kN
per front tyre at 1 350 kg, deflection 17–24 mm over bumps, no NaNs over 8 simulated seconds per preset.
WGSL for both pipelines was compile- and draw-validated headlessly (Dawn null backend); the live
frame/GPU numbers are what your log is for.
