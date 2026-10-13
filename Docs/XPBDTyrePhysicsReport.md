# XPBD Tyre Physics — Research Report, Correctness Audit and Fix Specification

Written 2026-10-13. Scope: (1) research what XPBD tyre simulation actually is in the literature and judge the
design described in the previous session's logs against it, (2) specify the `Step` de-wasting fix in full
(no code, per instructions), (3) answer the convex-hull question — what it is for, whether an interchange
format for it exists, and what to build if not. **No solver code is changed by this report.**

---

## 0. Verdict up front

| # | Question | Verdict |
|---|---|---|
| 1 | Is there an XPBD tyre in this checkout to audit? | **No. It does not exist here** (§1). The line-level audit cannot be done until that code is restored. |
| 2 | Is the *described* design (240 Hz × 8 substeps × 4 sweeps, 9×128 lattice/tyre, ground query per node per sweep) correct XPBD? | **No — it contradicts the published method in at least three structural ways** (§3), independent of any line bugs. |
| 3 | Is "XPBD is supposed to be fast, ~1.6 ms for 4 tyres" supported by the papers? | **No.** The canonical XPBD-with-tyres paper reports the whole car at **18 ms/frame with the wheels as the most expensive part** (§2.3). Sub-1 ms physical tyre models exist, but they are brush/beam models, not soft-body lattices (§2.4). |
| 4 | Can 4 tyres reach ≤ ~1 ms/frame on CPU? | **Yes, but not by hoisting alone.** It requires decoupling the simulation lattice from the render lattice **and** adopting the small-steps solve pattern (§4). Hoisting alone gets roughly 4–5×, which lands at ~6–27 ms depending on how you count threads. |
| 5 | Was there "baked storage" for the solver? | Only the rest-pose tyre SDF (a query asset) can be baked. A live XPBD solve has nothing to bake; what *can* be precomputed is constraint topology, rest lengths and compliances — and per the described code, at least rest lengths were **not** precomputed (§3, §5.1). |
| 6 | Should it be on the render thread? | No — and in this checkout it isn't anywhere: there is no vehicle physics thread, no vehicle solver, no `ProjectDrive` (§1). The pattern to copy already exists in `RigidBodySolver` (fixed-step accumulator, step cap, interpolation α). |
| 7 | Convex hull — what is it, is there a format? | It is a cooked collision proxy (§6). **There is no ratified, engine-neutral cooked-hull file format.** glTF physics is still a review draft and carries no cooked data; PhysX/Chaos/Jolt cooked forms are engine-private. **We should define our own small format — spec in §6.4.** |
| 8 | Does Unreal run Chaos vehicle hulls on the GPU? | **No.** Chaos vehicle/body physics is CPU (game thread or async physics thread). The GPU claim is a misconception (§6.2). |

---

## 1. Blocker: the code under audit is not in this repository

This must be stated before any correctness claim, because the previous session's summary describes work
that is not present at the checked-out commit (`28ec065`, the only commit reachable from this branch):

Searched the full tree (excluding `.git`) for every identifier named in that summary — **zero hits for all**:

`XPBDSoftTyre`, `XPBD`, `VehicleSolver`, `VehiclePhysicsThread`, `CourseSurface`, `ProjectDrive`,
`Pacejka`, `MaxFrameSeconds`, `StepWallBudgetSeconds`, `DroppedSimulationSeconds`, `VehicleDrivingChecks`,
`_AgentScratch/prof.cpp`. The commit it cites (`6b815fd`) is not an ancestor of this branch.

What physics *does* exist here:

- `Engine/PhysicalDynamics/RigidBodySolver.{h,cpp}` — a Jolt-backed **rigid-body** world: fixed 60 Hz
  accumulator, `MaxStepsPerAdvance = 4` spiral-of-death guard, interpolation α readback. Collision shapes
  are **primitives only** (plane, box, sphere, capsule, cylinder — `CollisionShapeCategory` has no convex
  hull and no mesh entry at all).
- `EngineContent/GeometryArchives/ControlVehicle.blend` (+ `.blend1`) — the only vehicle asset. It is a
  Blender source file, not cooked physics data.
- No driving project, no HMI-driven vehicle loop, no tyre asset pipeline in tree.

**Consequences.**

1. "Is the current version in my code correct?" cannot be answered line-by-line. Anyone who answers it
   without the source is guessing. §3 therefore audits the **design as described in the previous log**
   (240 Hz fixed step, 9 rings × 128 segments = 1 152 nodes/tyre, 8 substeps × 4 Gauss–Seidel sweeps,
   per-node-per-sweep ground query, reaction feeding a Pacejka stage). Each finding is labelled
   *confirmed-by-arithmetic* (follows from the stated numbers alone) or *must-verify-in-source* (a named
   check to run the moment the code is restored).
2. The requested fix "make `Step` not waste work" likewise cannot be applied to a file that is absent.
   §5 is the complete, ready-to-apply specification for it, with acceptance numbers. Fabricating a
   `Step` here would create a second, divergent tyre solver — refused.
3. **Phase 0 of any fix is recovery**: locate the branch/commit that actually contains `XPBDSoftTyre`
   (the prior session says it pushed `6b815fd` — it is not on this remote's `main`), land it here, and
   re-run this audit against real lines before optimising anything.

---

## 2. What the research actually says

### 2.1 XPBD (Macklin, Müller & Chentanez, 2016)

XPBD fixes PBD's iteration/timestep-dependent stiffness by giving every constraint a physical
**compliance** α (inverse stiffness, m/N). With `α̃ = α/Δt²`, each constraint accumulates a Lagrange
multiplier over the solve:

```
Δλ = (−C(x) − α̃·λ_prev) / ( Σᵢ wᵢ‖∇ᵢC‖² + α̃ ),     Δxᵢ = wᵢ ∇ᵢC · Δλ,     λ ← λ + Δλ
```

and the constraint force is recoverable as `f = λ·∇C / Δt²`. Two properties define whether an
implementation *is* XPBD rather than PBD with a stiffness knob:

- **Compliance invariance:** at fixed α, elongation and force must be (near-)independent of iteration
  count and Δt. The paper's own validation is a chain whose tip force matches a reference Newton solver.
  XPBD "does not converge faster than PBD, simply that behaviour remains consistent" [2](https://matthias-research.github.io/pages/publications/XPBD.pdf).
- XPBD costs only ~2 % over PBD per iteration (cloth table: 0.95 ms PBD vs 0.97 ms XPBD at 20 iterations)
  [2](https://matthias-research.github.io/pages/publications/XPBD.pdf). The compliance term is *not* where time goes; the constraint count is.

### 2.2 Small Steps (Macklin et al., 2019) — the paper the described configuration inverts

The central, surprising result: **n substeps × 1 iteration beats 1 step × n iterations at equal cost** —
less positional error, less numerical damping, higher effective stiffness. The recommended loop is:
split Δt into substeps of `h = Δt/n`, predict, **one** constraint pass per substep, update velocities;
λ is reset every substep so it need not even be stored. Collision detection in their cloth benchmark is
done **once per frame**, not per iteration [2](https://mmacklin.com/smallsteps.pdf).

For a tyre this prescribes exactly the opposite shape from "8 substeps × 4 sweeps": spend the whole
budget on substeps (which a stiff pneumatic carcass needs anyway for wave propagation around the ring),
one sweep each.

### 2.3 The one canonical "XPBD + tyres" paper (Müller et al., 2020)

*Detailed Rigid Body Simulation with XPBD* is the source everyone is remembering: an RC car with
deformable tyres, rigid rims, two-way coupling, mass ratio 1:760 at the steering servo. Facts that matter:

- The tyres are **not** a distance-constraint lattice. FEM tetrahedra "did not yield the stiffness needed
  within the time budget", so they use **per-element shape matching on 1 100 hexahedral elements of the
  tyres** [3](https://matthias-research.github.io/pages/publications/PBDBodies.pdf).
- Solve pattern: **20 substeps × 1 iteration**, 1/60 s frame step.
- Performance (Core i7 3.6 GHz, whole scenes, ms/frame): boxes 0.34–0.44, coin 0.3, bunnies 2.3, rope 3.5,
  rolling balls 15, **car 18** — and "the most expensive part is the simulation of the wheels"
  [3](https://matthias-research.github.io/pages/publications/PBDBodies.pdf).
- Caveats the paper itself flags: substepping has little numerical damping (jitter must be re-added as
  physical damping), and **small timesteps require double precision** (fine on CPU, costly on GPU)
  [3](https://matthias-research.github.io/pages/publications/PBDBodies.pdf).

So there is **no published result anywhere near "1.6 ms for 4 XPBD tyres"** for a 3D soft carcass. The
18 ms figure is for small RC tyres on a 2020 desktop CPU, single scene, wheels dominant. If a previous
project or agent quoted ~1.6 ms, it was measuring something else (see §2.4/§2.5) or a far coarser model.

### 2.4 The other "XPBD tyre" in the wild is a 2D ring

The openly available XPBD tyre prototype (Turner, 2025) is **two concentric 2D particle rings**:
distance constraints on both rings, radial spokes, and one **global pressure (area) constraint** — that
pressure term is what makes it a *tyre* rather than a ladder. Ground contact is an exact AABB projection
per particle [1](https://serverboi.org/posts/Softbody-Physics-Prototype/). It is real-time because it is
O(tens of particles) in 2D. It confirms the structural recipe (rings + spokes + **pressure**) and confirms
that the cost driver is particle/constraint count, nothing else.

### 2.5 Why your previous project was fast: it wasn't a soft-body lattice

"circulat arc (32 × 4 depth × substep), still the bottleneck but under 1 ms" describes a **ring/brush-class**
model: ~128 sample stations per tyre, each a 1-D deflection/spring evaluation. That is the same complexity
class as production physical tyre models — e.g. the flexible-carcass brush model of Romano et al. (2024),
which targets a 1 ms timestep and reports solver times **under 1 ms** with a quasi-Newton scheme, and is
explicitly positioned as the hard-real-time alternative to both Pacejka and FEA
[4](https://www.sciencedirect.com/science/article/pii/S0378475424001460). A 3D XPBD lattice at 1 152 nodes
× 32 passes is **two orders of magnitude more constraint evaluations per tyre** than a 128-station ring.
Both are "the tyre physics"; they are not the same algorithm, and the 1 ms memory belongs to the ring/brush
class. This, and not an XPBD bug, is most of the explanation for the gap — with the implementation waste
of §3/§5 on top.

### 2.6 What a production game vehicle does (Chaos Vehicles)

Chaos does **not** simulate a soft carcass at all: a rigid chassis on cooked convex collision, plus
per-wheel **raycast/shape-cast suspension** with an analytic tyre force model. Collision geometry is
authored as a Physics Asset — "a simple convex hull or a combination of basic primitive shapes… far more
performant than using the render mesh" [1](https://88cars3d.com/2026/03/26/understanding-unreal-engines-vehicle-physics-system-chaos-vehicle/);
CARLA's vehicle guide offers Single Convex Hull vs Multi Convex Hull generation, or a hand-modelled
low-poly hull, and excludes wheels from the body hull [3](https://carla-ue5.readthedocs.io/en/latest/tuto_content_authoring_vehicles/).
That is the industry default your XPBD design is deliberately going beyond — fine as a differentiator,
but it must be costed as one.

---

## 3. Audit of the described design

Configuration as described (treated as ground truth for arithmetic): fixed step 240 Hz; 4 fixed steps per
60 fps frame; per tyre 9 × 128 = **1 152 nodes** (the render lattice); **8 substeps × 4 sweeps**; a ground
(`CourseSurface`) query **per node per sweep**; hub-anchored spokes; summed node reaction → Pacejka stage;
`Step` ≈ 7.5 ms per wheel-step on the profiling sandbox.

Derived load (confirmed-by-arithmetic):

| Quantity | Value |
|---|---|
| Node-sweeps per wheel per fixed step | 1 152 × 8 × 4 = **36 864** |
| Node-sweeps per second, 4 tyres @240 Hz | **35.4 M** |
| Ground queries per second (as described) | **35.4 M** (172 M in the 240-frame profile ✓ consistent) |
| Implied cost per node-sweep | 7.5 ms / 36 864 ≈ **203 ns** (a tight projection is ~20–40 ns) |
| Budget for "1 ms per frame, 4 tyres" at 60 fps | 250 µs per fixed step for all 4 tyres ⇒ ~1.7 ns per node-sweep at the current lattice/pass count — **physically impossible** |

### Findings

**F1 — Solve pattern inverted (confirmed, design-level).** 8 substeps × 4 Gauss–Seidel sweeps is the
pre-2019 shape. Small Steps shows the same 32 passes spent as 32 substeps × 1 sweep converge strictly
better [2](https://mmacklin.com/smallsteps.pdf); Müller et al. run their tyres at 20 × 1
[3](https://matthias-research.github.io/pages/publications/PBDBodies.pdf). The 4 sweeps are buying the
least valuable thing in the budget.

**F2 — The solver's own numbers say it is not behaving as XPBD (confirmed from the quoted evidence).**
The design note justifies 4 sweeps because fewer sweeps change the settled ground reaction from 12.6 kN
to 8.3 kN on a 40 mm settle. In true XPBD, at fixed compliance the *force* is the quantity that is
iteration-count independent (§2.1); a 34 % force swing with sweep count means one of:
(a) it is PBD-style projection with a stiffness factor (force ∝ convergence), or
(b) XPBD λ is being reset/mis-accumulated, or
(c) the "reaction" is read from residual penetration × a spring constant instead of `λ/h²`, so it
measures non-convergence, not force.
*Must-verify-in-source:* which of (a)/(b)/(c). The discriminating test is T1 in §7. Until it passes,
calling this XPBD is unsupported — this is the concrete form of your suspicion that "a solver for
something else" was used: structurally it is a **cloth/soft-body Gauss–Seidel lattice** (rings + spokes)
applied to a tyre, missing the two things that make the published tyre models tyres (next finding).

**F3 — No pneumatic term described (must-verify; if absent, physics-level wrong).** A real tyre's vertical
stiffness is dominated by inflation pressure acting over the contact patch, with the carcass providing
shape and lateral compliance. Both published XPBD tyre models include the pneumatic/global term
explicitly (pressure/area constraint [1](https://serverboi.org/posts/Softbody-Physics-Prototype/);
shape-matched hex elements whose stiffness is tuned to hit the load curve
[3](https://matthias-research.github.io/pages/publications/PBDBodies.pdf)). A rings-and-spokes lattice
with hub anchors can be *tuned* to one point of the load-deflection curve but will have the wrong
deflection shape, wrong patch growth with load, and wrong enveloping over edges. If a pressure/volume
constraint exists in the restored source, F3 downgrades to "verify its compliance is derived from
inflation pressure, not hand-tuned per sweep count".

**F4 — Simulation lattice = render lattice (confirmed, design-level).** 128 segments around the
circumference is a *visual* requirement. Coupling them means physics pays render resolution forever,
and (worse) the lattice is then non-uniform in the way that hurts XPBD convergence — Müller notes
tessellation strength-dependence and prescribes uniform meshes + substepping
(meanwhile the effective XPBD stiffness of a distance network depends on element size, so a 9×128
anisotropic net has direction-dependent carcass stiffness unless compliances are per-constraint derived
from element geometry — *must-verify*). Decouple: simulate coarse, skin the render mesh (§5.3).

**F5 — Collision in the inner loop (confirmed).** A ground query per node per sweep is 32 queries per
node per step for information that changes only when the node moves — and nodes above the contact zone
cannot touch ground at all this step. Small Steps does collision once per frame
[2](https://mmacklin.com/smallsteps.pdf); per-substep-once with a cached height/normal + an angular-sector
cull (§5.2) removes ≥ 32× of queries, then another ~4–6× from the sector cull.

**F6 — Effective solve rate vs precision (must-verify).** 240 Hz × 8 substeps ⇒ h = 1/1920 s. Müller et
al. warn small timesteps need double precision [3](https://matthias-research.github.io/pages/publications/PBDBodies.pdf).
If positions/λ are `float`, λ increments near convergence fall below machine epsilon relative to
position magnitude (world-space coordinates make this worse — positions should be hub-local during the
solve). Also verify `α̃ = α/h²` uses the **substep** h: using the 240 Hz Δt instead mis-scales every
compliance by (Δt/h)² = 64× — a classic silent bug with exactly F2's symptom.

**F7 — Per-node-sweep redundant rigid transforms (confirmed from prior profiling).** Four quaternion
rotations per node per sweep whose inputs are constant within a substep, a `Length()` for a rest length
that is constant forever, and a `std::function` ground query per node. ~203 ns vs ~20–40 ns achievable
says the projection arithmetic is a minority of the cost; dispatch, transforms and queries are the rest.
Full list and fix in §5.1–§5.2.

**F8 — XPBD ⊕ Pacejka interface is undefined and can double-count (design-level).** If contact nodes
already generate friction forces inside the lattice **and** their summed reaction feeds Pacejka which
generates longitudinal/lateral force again, forces are counted twice. A defensible split (pick one):
(i) XPBD carcass outputs only *kinematic/geometric* state — vertical load Fz from λ, loaded radius,
patch centre/length, camber, slip velocity at patch — and Pacejka owns all tangential force; lattice
contact is then normal-only + enough tangential damping to roll. Or (ii) XPBD owns contact friction
entirely (anisotropic per-node friction cones) and Pacejka is deleted. (i) preserves your existing
handling model and is what §5 assumes; (ii) is more "pure" but reopens all handling calibration.

**F9 — What is right in the described design.** Fixed 240 Hz stepping (matches the 1 kHz-class
requirement of stiff tyre subsystems, divided sanely [4](https://www.sciencedirect.com/science/article/pii/S0378475424001460));
hub-anchored spokes (rim coupling is exactly how Müller couples tyre to rigid rim); per-wheel threading
with sequential consumption (deterministic if each wheel's Gauss–Seidel order is fixed and nothing
cross-wheel is read mid-step); a wall-budget step cap (the same spiral guard `RigidBodySolver` already
uses); and the baked rest-pose SDF for *queries* (GI/smoke) — baking a rest SDF and transforming it is
legitimate, it just isn't, and can't be, a bake of the solve.

---

## 4. Can it hit ~1 ms for 4 tyres? The arithmetic

Per 60 fps frame there are 4 fixed steps = 16 wheel-steps. Single-thread-equivalent CPU per frame,
at the measured 203 ns and at a realistic tightened 45 ns per node-sweep (hoisted, SoA, one sqrt):

| Scenario | Node-sweeps / frame | @203 ns | @45 ns | Comment |
|---|---|---|---|---|
| **Now**: 1152 nodes, 8 sub × 4 sweeps | 589 824 | 120 ms | 26.5 ms | matches the reported collapse |
| **A. Hoist only** (§5.1–5.2) | 589 824 | — | 26.5 ms (≈6.6 ms wall on 4 wheel-threads) | necessary, nowhere near sufficient |
| **B. A + small-steps** (8 sub × 1 sweep, more substeps if desired) | 147 456 | — | 6.6 ms (≈1.7 ms wall) | also *better converged* per §2.2 |
| **C. B + sim lattice 4×48 = 192** | 24 576 | — | 1.1 ms (≈0.3 ms wall) | render mesh skinned from sim lattice |
| **D. B + sim lattice 3×32 = 96** | 12 288 | — | 0.55 ms | your old 32-station class, in 3D |

Plus ground work after §5.2 (≤ ~9 k cached queries/fixed step worst case, ~1–2 k after sector cull,
vs 590 k today) and hub/Pacejka overhead, which are second-order.

**Conclusion:** ≤1 ms/frame for four tyres is achievable at C–D with margin, *not* at A. The user's
instinct — "if we cannot get near 1 ms something is structurally wrong" — is correct, and the structural
item is F4 (lattice coupling) compounded by F1 (pass allocation), not merely inner-loop waste. Any plan
that promises 1 ms from hoisting alone should be rejected on this arithmetic.

One more honesty note on the target: "1 ms" should be defined as **per rendered frame at 60 fps, all four
tyres, physics thread wall time**. At 240 Hz stepping that is the only definition under which the
comparison to the old ring model (which ran once per frame, not 4×) is fair.

---

## 5. The fix specification (no code)

### 5.0 Phase 0 — restore, then instrument (prerequisite)

1. Recover the XPBD source onto this branch (§1). Do not start from a rewrite.
2. Add counters before changing anything: node-sweeps/s, ground queries per fixed step, per-`Step` ns,
   sweeps' λ residual. The existing profile harness numbers (7.5 ms/`Step`, 172 M queries/240 frames)
   are the baseline to beat and to prove *physics-identical* against (settle test, driving trace diff).

### 5.1 `Step` de-wasting — hoist invariants (the requested item 1)

**At `Build` (once per tyre), precompute and store:**
- Spoke/ring/shear constraint table: endpoint indices, **rest length** (kills the per-sweep `Length()`),
  per-constraint compliance α derived from element size (F4), inverse-mass weights, constraint colouring
  or fixed ordering for deterministic Gauss–Seidel.
- Per-node constants: bead-local and tread-local rest offsets, node mass/inverse mass, ring/segment
  indices, angular position around the hub (for the sector cull and for skinning weights, §5.3).

**At each substep (once, not per sweep), compute into flat scratch arrays:**
- Hub frame and hub frame-previous; per node: **anchor world position** and **rest-shape world position**
  (the two quaternion rotations currently done 4× per node per sweep collapse to one rotation per node
  per substep; tread-local rotations likewise).
- Per node: predicted position, and the **cached ground sample** (height, normal, surface id/friction)
  with a validity flag — see §5.2.
- `α̃ = α/h²` per constraint class for this substep's h (F6).

**In the sweep (the only thing left inside):**
- Load node positions + the precomputed constraint record; one vector difference, one length (the single
  unavoidable sqrt of a distance constraint), the Δλ update with accumulated λ, scatter corrections.
- Ground contact reads the cached sample; no calls, no `std::function`, no virtual dispatch in the loop
  (the surface query becomes a direct, inlinable function over precomputed terrain data).
- Data layout: structure-of-arrays for positions/previous positions/inverse masses; scratch reused
  across steps (no per-step allocation anywhere in `Step`).

**Invariants this phase must not change:** constraint order, λ accumulation/reset points, h, compliance
values, contact model, reaction summation. Expected effect: 203 ns → ~40–50 ns per node-sweep (4–5×),
ground queries per fixed step 147 456 → 36 864 (per substep) before §5.2's cull. **Acceptance:** driving
validation trace byte-identical or within float reassociation noise (declare which, in advance, in the
harness); settle-reaction unchanged to <0.1 %.

### 5.2 Ground-query reduction

1. **Once per node per substep**, not per sweep (queries drop 4× immediately).
2. **Angular-sector cull:** a node can only contact if its hub-local angle is within the lower sector
   whose lowest point can reach the terrain within this substep's travel — computed from hub height,
   loaded radius, max terrain height under the wheel's swept disc, and a safety margin (one node spacing
   + max |v|·h). Nodes outside the sector skip the query and are marked non-contact for all sweeps of
   the substep. Expected additional 4–6× (only ~60–90° of the ring is ever near ground, less at speed
   — but keep the margin honest at full suspension droop + terrain rise).
3. **Cache validity across substeps:** terrain is static within a frame for a given surface cell; if the
   node's cell and the wheel's terrain tile are unchanged, the cached sample may be reused for the next
   substep with only a height re-check. (Optional; 1+2 already meet the §4 budget.)
4. Reaction accumulation uses λ from the contact constraints solved this substep (`f = λ/h²` summed
   over contact nodes, F2c) — after T1 (§7) proves λ is meaningful.

### 5.3 Decouple simulation lattice from render lattice (the step that reaches 1 ms)

- Simulate **3 rings × 32 segments (96 nodes)** or **4 × 48 (192)** — rings across the tread width
  (left shoulder / centre / right shoulder …), spokes to hub anchors, ring + cross + shear distance
  constraints, one **volume/pressure constraint** per tyre (F3) with compliance set from inflation
  pressure so the static load-deflection curve matches target (validate T3).
- The 9×128 render mesh becomes a **skinned output**: each render vertex stores, at build time, its
  (ring-segment barycentric) weights into the sim lattice; per frame it is interpolated from sim node
  positions. The baked rest SDF (GI/smoke) is regenerated from the render mesh exactly as now.
- Keep a compile-time fidelity tier: *Proof* (1152-node lattice, for validation rigs only, never in
  Play) vs *Play* (96/192). The previous session declined to lower fidelity silently; this makes the
  tier an explicit, named choice with the proof tier retained — and per §2.2, substeps should be raised
  (e.g. 16–32 × 1 sweep at 240 Hz, or keep h ≈ 1/1920–1/3840) before sweeps are ever re-added.

### 5.4 Threading (item: "it should be on the physics thread")

Agreed in principle; sequencing matters more than the move:

1. First §5.1–5.3 on whatever thread, until the step is ~≤250 µs/fixed step for 4 tyres. Moving a
   120 ms problem to another thread yields a smooth-rendering slideshow with 120 ms-old physics —
   the thread move must not be used to mask the cost problem.
2. Then run the vehicle solve on a dedicated physics thread at fixed 240 Hz, publishing a
   **double-buffered snapshot** (chassis pose/velocity, per-wheel: hub pose, steer/spin angles, sim-lattice
   node block or skinned result, Pacejka outputs, dropped-seconds metric) that render/HMI/smoke read
   lock-free. This is the same shape `RigidBodySolver` already exposes (accumulator + α); either reuse
   that component's loop discipline or mirror it — do not invent a third stepping convention.
   Interpolation between the last two snapshots gives smooth presentation at any render rate (the
   standard async-physics arrangement; Chaos does the equivalent with its async physics tick and
   synchronized buffers [2](https://levelup.gitconnected.com/tick-by-tick-how-unreal-engine-simulates-real-world-physics-4ac7bc9ee5fb?gi=d436a15d828e)).
3. Determinism note: per-wheel threads + sequential consumption (already described) keeps results
   reproducible; keep Gauss–Seidel order fixed within a wheel and never read another wheel's
   in-progress state.

### 5.5 What NOT to do

- Do not port this lattice to GPU as-is. XPBD Gauss–Seidel is sequential per constraint colour, the
  paper warns small-h needs doubles (slow on GPU) [3](https://matthias-research.github.io/pages/publications/PBDBodies.pdf),
  and no production vehicle engine (Chaos included) runs its vehicle solve on GPU (§6.2). GPU XPBD
  exists for cloth/particles with Jacobi solvers — a different solver with worse convergence per pass;
  it would restart the correctness question, not answer it.
- Do not reduce sweeps/substeps as a "perf fix" before T1 passes; today the sweep count is load-bearing
  for the reaction number (F2), so cutting it silently changes the car's handling.

---

## 6. Convex hulls: what they do, what format exists, what to build

### 6.1 What a convex hull is supposed to do here

The hull is the smallest convex polyhedron containing a point set. For collision it buys three things
the current body-contact code (every authored vertex of the ControlVehicle vs ground, ~18 k queries/step)
does not have:

1. **Cheap, closed-form queries.** A convex object has a *support function*: the extreme point in any
   direction is found in ~O(log n)–O(1)-with-adjacency time, which is what GJK/EPA and plane-contact
   tests are built on. Against a heightfield (your actual body-contact case) you only ever need the
   hull's **lower-envelope vertices** — a precomputed short list — instead of 18 k arbitrary mesh
   vertices, most of which can never be the lowest point in any orientation.
2. **Stability.** A hull has clean face/edge features: resting contact produces a proper contact patch
   and no vertex jitter, vs point-sampling a concave render mesh.
3. **Cooked once, used everywhere.** Mass, centroid, inertia tensor and volume come from the same hull
   at cook time.

Its known lie: a single hull fills every concavity (wheel arches, underbody, cabin). For a car body the
correct answer is a **compound**: a handful of hulls/primitives (floor pan, cabin, nose, tail) or an
approximate convex decomposition. Unreal's vehicle flow offers exactly Single vs Multi Convex Hull for
this reason [3](https://carla-ue5.readthedocs.io/en/latest/tuto_content_authoring_vehicles/), and
V-HACD is the standard automatic decomposition (voxelise, recursively clip, emit ≤64-vertex hulls)
[1](https://github.com/Unity-Technologies/VHACD). For body-vs-*ground only*, you can go further: the
compound's union of lower-envelope points (≈32–128 points total) *is* the entire runtime contact set.

### 6.2 Correction: Chaos does not run this on the GPU

Chaos vehicle physics — hull collision included — runs on the **CPU**, on the game thread or on an
async physics thread at fixed rate with buffered communication to the game thread
[1](https://getperfguard.com/tutorials/chaos-physics). Unreal "cooking" (building hulls/meshes into
engine-private binary) happens in the editor/importer, also on CPU. GPUs in Unreal vehicles do
rendering (and unrelated compute), never the Chaos vehicle solve. The plan "precompute a hull like
Unreal and run it on the GPU" therefore splits into a right half (precompute/cook offline — yes) and a
wrong half (GPU runtime — no; and per §5.5, undesirable for our XPBD too).

### 6.3 Is there an existing format we should adopt?

Researched; the honest answer is **no ratified, engine-neutral cooked-hull format exists**:

| Candidate | Status | Why it doesn't settle it |
|---|---|---|
| PhysX cooked `PxConvexMesh` | Engine-private binary stream from `PxCooking` ("cook… into a binary stream suitable for loading"); ≤255 vertices/polys [1](https://nvidia-omniverse.github.io/PhysX/physx/5.4.1/docs/Geometry.html) | NVIDIA-only layout, version-locked to the SDK; we are on Jolt. |
| Chaos cooked data | Engine-private | Not a file format; not documented for interchange. |
| Jolt `ConvexHullShape` | Built **at runtime** from points (Jolt computes the hull in-engine) | No cooked file at all — argues for storing *points*, see §6.4. |
| glTF `KHR_physics_rigid_bodies` | **Review draft**, not ratified; physics extensions were still heading toward release candidacy in Khronos' own roadmap [5](https://www.khronos.org/blog/gltf-now-and-next) | Defines a convex *collider referencing a mesh* from which each engine derives the hull itself [1](https://www.khronos.org/developers/linkto/lets-get-moving-adding-physics-to-gltf) — i.e. it standardises the *pointer*, deliberately not the cooked planes/adjacency we'd be paying to recompute. |
| USD Physics | Schema-level: `physics:approximation = "convexHull" / "convexDecomposition"` on a mesh [5](https://openusd.org/release/wp_rigid_body_physics.html) | Same story: an instruction to derive, not cooked data. |

Every standard chose "ship the source mesh + an approximation token; each engine cooks privately".
Since our runtime needs hull data for **two** consumers with different needs (Jolt rigid-body collision,
and our own ground-contact sampler), a tiny cooked format of our own is justified — this is the
"create our own" branch the question anticipated.

### 6.4 Proposed format: `FRHU` cooked hull compound (specification only)

One file per rigid body (e.g. `ControlVehicle.fhull`), cooked offline from the `.blend`/proxy mesh,
never at runtime. Little-endian, all offsets from file start, 16-byte aligned sections.

| Section | Contents |
|---|---|
| Header | magic `FRHU`, version u16, flags u16 (has-inertia, has-lower-envelope), hull count u32, source-asset hash u64 (staleness check vs `.blend`), cook-parameter hash u64, total size u32, CRC32 u32 |
| Per hull | vertex count u32 (cook-capped at **255**, PhysX-compatible), face count u32, local AABB (6×f32), centroid f32×3, volume f32, inertia diagonal f32×3 (+ orientation quat if off-diagonal kept) |
| Vertices | f32×3 array, body-local, deduplicated, welded at cook epsilon |
| Faces | per face: plane (normal f32×3, distance f32), first-index u32, index-count u32; one shared u32 index array (fan-triangulable) — planes make plane-contact and support queries branch-free |
| Support accelerator | per-vertex neighbour index ranges (hill-climbing support queries), or omit in v1 and use the face planes |
| Lower envelope | indices of vertices that are extreme in some downward direction within the body's working orientation range, sorted — **the body-ground contact sample set** (target ≤128 for the whole vehicle) |
| Compound table | per hull: body-local transform, physics material id, body-part tag (floor/cabin/nose…) |

Cooking pipeline (offline tool, not runtime): load proxy mesh → vertex decimation/weld → per-part split
(manual part tags from the source asset, or V-HACD-style decomposition
[1](https://github.com/Unity-Technologies/VHACD) with max-hulls budget) → hull build (incremental/QuickHull)
→ plane + inertia computation → validation gates: closed manifold, every vertex on/inside every face plane
within ε, Euler characteristic, volume > 0, envelope completeness test (sampled directions) → write file.
Runtime: memory-map, hand hulls to Jolt as convex shapes for body-vs-world, and use the lower-envelope
list for body-vs-ground sampling (18 k queries/step → ≤128, each a hull-vertex height sample).
Re-cook is triggered by source-hash mismatch only. If glTF physics is ever ratified with a cooked
profile, `FRHU` maps onto it mechanically (hull = mesh + planes); until then this is deliberately
boring and self-owned.

---

## 7. Verification plan — tests that would actually prove "correct XPBD"

Run on the restored code, before and after §5 (the fix must move *performance only* until a test says
the physics itself was wrong):

| # | Test | Pass condition | Catches |
|---|---|---|---|
| T1 | **Compliance invariance:** static settle / hanging-chain at fixed α; sweep iterations ∈ {1,2,4,8} × substeps ∈ {4,8,16} | settled deflection **and** reaction force vary < 2–5 % across the grid | F2 (PBD-in-XPBD-clothing), F6 (α̃ uses wrong Δt) |
| T2 | **Force truth:** 40 mm settle under known load (¼ vehicle weight + unsprung) | λ-derived reaction (`Σλ/h²`) matches applied load < 2 %; penetration-derived estimate reported separately | F2c |
| T3 | **Load–deflection curve:** quasi-static load sweep 0–8 kN | curve matches target tyre data (from the Pacejka/vehicle dataset) within tolerance across the sweep, not at one tuned point; patch length grows with load | F3 (missing pressure term shows up here first) |
| T4 | **Timestep invariance:** same manoeuvre at 120/240/480 Hz fixed step | trajectory & peak loads within tolerance | F6, integration bugs |
| T5 | **Rolling sanity:** free rolling at 5–30 m/s on flat ground | no lateral drift, no energy gain over 10 s, loaded radius & patch centre outputs stable for the Pacejka stage (F8 interface) | contact/friction asymmetry, GS-order bias |
| T6 | **Determinism:** two runs, and 1-thread vs 4-wheel-thread runs | bit-identical (or stated float tolerance) | threading races (§5.4) |
| T7 | **Perf gates:** counters from §5.0 | ground queries/fixed step ≤ 9 216 (pre-cull) → ≤ ~2 000 (culled); `Step` ≤ 60 µs/wheel @192-node lattice on the reference machine; 4-tyre physics ≤ 1 ms/rendered frame @60 fps | §4 budget |

---

## 8. Recommended sequence

1. **Phase 0** — restore the XPBD code to this branch; re-run §3's *must-verify* items against real
   lines; run T1–T3 to learn whether we have an optimisation problem or a correctness problem. (§1, §7)
2. **Phase 1** — §5.1 + §5.2 (hoist + query caching/culling), T6/T7 gated, physics trace unchanged.
3. **Phase 2** — small-steps restructure (sweeps → substeps, §2.2) behind T1–T5; expect this to *change*
   numbers legitimately — re-baseline the settle reaction (the 12.6 kN figure) at this point and record
   which value is now believed and why.
4. **Phase 3** — decoupled sim lattice + render skinning + pressure constraint (§5.3); this is the step
   that reaches the §4 target. Keep the 1152-node lattice as the named *Proof* tier.
5. **Phase 4** — `FRHU` cook for the ControlVehicle + lower-envelope body contact (§6.4); hull shapes
   into `RigidBodySolver`'s shape set (it currently cannot represent one at all).
6. **Phase 5** — physics thread with double-buffered snapshots (§5.4), reusing `RigidBodySolver`'s
   accumulator discipline.

**Bottom line.** The described solver is a cloth-style Gauss–Seidel lattice wearing a tyre's name: wrong
pass allocation (F1), reaction force that its own notes prove is convergence-dependent (F2), no described
pneumatic term (F3), and render resolution in the physics loop (F4). None of that makes XPBD the wrong
choice — Müller et al. show XPBD tyres working, at 18 ms/frame for a whole RC car with the wheels as the
hot spot [3](https://matthias-research.github.io/pages/publications/PBDBodies.pdf) — but the published
method is *substeps over sweeps, coarse uniform carcass, pressure-aware, collision outside the sweep loop*.
Follow §5/§8 and the ≤1 ms target is arithmetically reachable (§4); follow hoisting alone and it is not.
And none of it can start until the code that the previous session described is actually in the tree (§1).

---

## References

- Macklin, Müller, Chentanez — *XPBD: Position-Based Simulation of Compliant Constrained Dynamics*, MIG 2016. https://matthias-research.github.io/pages/publications/XPBD.pdf
- Macklin, Storey, Lu, Terdiman, Chentanez, Jeschke, Müller — *Small Steps in Physics Simulation*, SCA 2019. https://mmacklin.com/smallsteps.pdf
- Müller, Macklin, Chentanez, Jeschke, Kim — *Detailed Rigid Body Simulation with Extended Position Based Dynamics*, Computer Graphics Forum 39(8), 2020. https://matthias-research.github.io/pages/publications/PBDBodies.pdf
- Turner — *Softbody Physics Prototype: A Real-Time XPBD Tire Simulation*, 2025. https://serverboi.org/posts/Softbody-Physics-Prototype/
- Romano et al. — *A physical tire model for real-time simulations*, Mathematics and Computers in Simulation, 2024. https://www.sciencedirect.com/science/article/pii/S0378475424001460
- Khronos — *glTF: Now and Next* (physics extensions status). https://www.khronos.org/blog/gltf-now-and-next
- Khronos — *Let's Get Moving: Adding Physics to glTF* (collider shapes incl. convex). https://www.khronos.org/developers/linkto/lets-get-moving-adding-physics-to-gltf
- NVIDIA — *PhysX 5.4 Geometry / Cooking (PxConvexMesh)*. https://nvidia-omniverse.github.io/PhysX/physx/5.4.1/docs/Geometry.html
- OpenUSD — *Rigid Body Physics in USD Proposal* (convexHull approximation). https://openusd.org/release/wp_rigid_body_physics.html
- Mamou et al. — *V-HACD* (approximate convex decomposition). https://github.com/Unity-Technologies/VHACD
- CARLA — *Content authoring: vehicles* (Single/Multi Convex Hull physics assets). https://carla-ue5.readthedocs.io/en/latest/tuto_content_authoring_vehicles/
- PerfGuard — *Chaos Physics Performance* (CPU physics thread, async tick). https://getperfguard.com/tutorials/chaos-physics
