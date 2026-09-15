# Rock field realism assessment

Written after rendering the kernel and actually looking at the output, rather than
reading step counts. The performance work in commits `18b345e` and `9c474ca` is
sound and stands. This note records a **visual** defect that the numeric gate cannot
see, and one rejected attempt at fixing it.

## What the renders show

`Diagnostics/RockField_Granite.png` and `RockField_Limestone.png` at 300 px, wide view.

Both read as **smooth beige blobs on a cracked plane**, not as rock. The macro view
(`RockField_GraniteMacro.png`) does show fine grain and a hairline joint trace, so the
fine detail terms are working. The failure is entirely at the **metre scale**: the
silhouette is an egg.

## Measured cause

Three independent measurements, all pointing the same way.

1. **The body is an ellipsoid plus two gentle noise octaves.** `RockProtolithMass`
   builds `RockEllipsoid` then adds `MassRelief` noise at 0.55/m and 1.30/m, i.e.
   wavelengths of 1.82 m and 0.77 m. That is a wobble, not a shape.

2. **Every lithology shares the same body.** `MassExtent (1.55, 1.35, 1.05)`,
   `MassRelief 0.16`, `Plinth 0.92` are set once in the shared defaults and never
   overridden. All five presets are the same potato wearing different surface noise.

3. **Joints barely cut it.** Max half aperture at the surface is 1.3–5.6 cm depending
   on preset, so the deepest joint carve measured into the body was 6.5–10.1 cm on a
   1.55 m half-extent, and only 1.6–16.5% of near-surface points are cut deeper than
   2 cm. Joints are scratches on an egg; they never divide it into blocks.

Surface relief measured radially (full field vs coarse body): mean 0.05–0.54 m, but
that number is dominated by the joint fissures themselves, not by form.

### The roughness amplitude is *not* the problem

Worth stating because it was the obvious suspect. Per octave at the shipping settings
(granite, H = 0.80, amplitude 0.020 m, wavelength 0.55 m):

| octave | wavelength m | relief mm |
|---|---|---|
| 0 | 0.550 | 20.00 |
| 1 | 0.275 | 11.49 |
| 2 | 0.138 | 6.60 |
| 3 | 0.069 | 3.79 |
| 4 | 0.034 | 2.18 |
| 5 | 0.017 | 1.25 |
| 6 | 0.009 | 0.72 |

Total 46 mm. Barton's amplitude/length relation gives `a ≈ JRC·L/450` at L = 1 m, so
JRC 10–20 implies 22–44 mm. **The roughness term is defensible as built.** Cranking it
up would produce a fuzzy egg, not a rock. The missing structure is above 0.55 m, where
the model currently has nothing but a smooth ellipsoid.

## Rejected attempt: per-block differential recession

The geologically correct fix is that a jointed outcrop is an **assembly of blocks**,
each weathering as a body and standing proud of or receding behind its neighbours.
That is what gives real jointed rock its stepped, faceted silhouette.

Implemented as a per-block rigid offset keyed on the joint lattice index, faded over
the rind depth. The appeal is that a rigid offset is **constant inside a block**, so it
contributes nothing to the gradient there — all the slope sits at the block boundary,
which is the joint being carved anyway. Large visible relief for a small Lipschitz
charge.

**It does not work, and the gate caught it.** Three successive discontinuities:

1. Blending the offset on `Coordinate` splits each block down its centre line, because
   `Coordinate` is the signed distance to the *nearest* plane and passes smoothly
   through zero at the block **centre** while the lattice index changes at the block
   **boundary**. Measured a 0.139 m cliff across 0.5 mm.
2. Fixing that by interpolating between the own-block and neighbour-block offsets
   across the boundary still tore, because `BoundaryDistance = S/2 - |Coordinate|`
   assumes a regular lattice. `Irregularity` scatters the plane positions, so the two
   half-cells are unequal and the fade is not symmetric from both sides.
3. Resolving the true scattered midpoint fixed *that* tear (verified locally: the field
   steps smoothly through the index change) but the gate still failed, with granite at
   `max |grad(f/L)| = 2.068`, 27 violations, and mean steps roughly doubled across all
   five lithologies.

The offset also invalidates the `BeyondCarveReach` early-out from `9c474ca`, since the
carve is no longer an identity out of aperture range — the skip has to be disabled
wherever recession is active, which is what doubled the step counts.

Reverted to `9c474ca`. All five lithologies PASS again with zero overshoots.

### Why it kept tearing

A per-block offset is a **piecewise constant function of a lattice index**. Any such
function is discontinuous at the cell boundary by construction. Smoothing it after the
fact means reconstructing, in the carve, the exact boundary geometry that
`RockJointCoordinate` computed internally — including the undulation and the scatter.
Every fix so far has been a patch on that duplication, and each one uncovered another
place where the two calculations disagree.

Fighting the symptom is the wrong move. The structure has to come from something that
is continuous by construction.

## Recommended direction

Give the body real form *before* jointing, instead of trying to derive form from the
joints afterwards:

- **Intersecting half-spaces.** Build the protolith as a smooth intersection of a
  handful of randomly oriented planes (a convex angular block), then round it. This is
  how a real joint-bounded corestone is actually shaped, it is exactly metric, it is
  continuous everywhere, and it costs a few `dot` products. The joint sets then open
  fissures *on* an already angular body rather than being asked to invent the form.
- **Per-lithology body parameters.** The five presets must stop sharing `MassExtent`
  and `MassRelief`. A columnar basalt and a platy schist are not the same ellipsoid.
- **A mid-scale octave band.** Nothing currently occupies 0.5–1.5 m. Even without
  blocks, one anisotropic octave in that band would break the egg silhouette.

Of these, the intersecting half-spaces is the one that addresses the root cause and
is continuous by construction, so it should be tried first.

## Outcome: the half-space corestone works

Implemented as `RockCorestoneBody`. Facet normals come from a Fibonacci sphere rotated
by the seed, each placed on the support plane of the envelope ellipsoid in its own
direction (`length(MassExtent * Normal)`) and pushed inward per facet by a hashed
amount so the fragment is irregular rather than a tidy polyhedron. Arrises are rounded
with the existing smooth intersection. The ellipsoid is retained only as a bounding
clip, so the body can never exceed the nominal extent.

**It passed the gate on the first run, with no tear chasing at all.** This is the
direct consequence of the primitive being continuous by construction: a plane is
exactly 1-Lipschitz, a smooth intersection of unit-gradient fields stays unit-gradient,
and the only charge needed was 0.35 for the blend overshoot near an arris. Compare the
block-offset attempt, which produced three successive discontinuities and never passed.

Cost is about five extra steps per ray (granite 44.4 -> 48.9, limestone 85.9 -> 90.1),
with zero overshoots and coverage unchanged.

### Evidence that the form actually changed

Measuring the **mass surface only** (before joints and detail), by bisecting the radius
from the body centre over 6000 directions:

| | radius sdev | radius min | planar over 5 cm |
|---|---|---|---|
| Granite baseline | 0.1292 | 1.0468 | 55.5% |
| Granite faceted  | 0.1569 | 0.8934 | 66.5% |
| Basalt baseline  | 0.1292 | 1.0468 | 55.5% |
| Basalt faceted   | 0.1663 | 0.8058 | 79.0% |
| Schist faceted   | 0.1732 | 0.7788 | 32.9% |

The baseline rows for granite and basalt are **identical to four decimal places**,
which is the clearest possible confirmation of the "all five presets are the same
potato" finding: they were literally the same body. After the change the presets
diverge, and the planarity spread (basalt 79% flat and blocky, schist 33% and slabby)
matches how those rocks actually break.

A caution on metrics: an earlier attempt measured angularity on the **full** field and
showed basalt at 32% crease coverage even in the baseline. That metric is dominated by
the joint fissures cut into the surface and is nearly blind to body form, so it could
not tell an egg from a block. Only isolating the mass term exposed the difference.

### Still outstanding

The renders are visibly better — flat faces, real arrises, and granite now reads as a
rounded corestone while basalt reads as an angular block — but this is form, not
finish. Remaining gaps, in priority order:

1. ~~**Material response is flat.**~~ Addressed, see below.
2. `MassExtent` and `MassRelief` are still shared across all five presets. The facet
   parameters differentiate the bodies, but the underlying envelope does not.
3. The plinth still reads as a cracked plane rather than bedrock.


## Material response

Albedo was duplicated verbatim in the CPU renderer and again in the WebGL module, which
guarantees drift. It now lives once in the kernel as `RockLithologyAlbedo(Position,
Normal, Footprint)` and both renderers call it through a thin wrapper.

### The band-limiting bug

`GrainSignal` measured **exactly 0.000** for sandstone, basalt and limestone at the wide
render footprint. Cause: grain relief is band limited against the pixel cone, which is
correct for *geometry* (1.2-8 mm grains are genuinely sub-pixel at a 20 mm footprint, and
rendering them would alias), but the same gate was also killing the **colour** mottle.
A granite face at ten metres still reads as speckled because the eye integrates the
mineral colours even when no crystal is resolvable.

Relief and colour are now separated: relief still fades with the cone, while the mottle
falls back to the coarsest still-resolvable cell size so it stays stable instead of
dissolving or aliasing.

### What was added

- **Mineral species for granite** — a three-way feldspar / quartz / mica split rather
  than a uniform brightness scale, which is why granite reads speckled rather than
  tinted. This is clearly visible in `RockField_GraniteMacro.png`.
- **Patchy alteration** at the decimetre scale, two octaves.
- **Iron staining** keyed to drainage and exposure.
- **Lichen colonisation** keyed to patch, stability, dampness and surface orientation,
  with a per-lithology `BioCover` (schist 0.70 down to basalt 0.22).

### Two modelling errors caught by measurement

1. **`BeddingPhase` as an "upward facing" proxy.** It is position *within a stratum* and
   is identically zero for unbedded rock, so it silently suppressed lichen on granite and
   basalt. The albedo function had no surface normal at all; one is now passed in.
2. **Multiplying five independent sub-unit factors.** Patch 0.264 x stability 0.921 x
   damp 0.789 x upward 0.843 x biocover 0.550 = **0.088**, which is invisible. Each factor
   looked reasonable alone. Patch now decides *where* growth sits and the rest only
   modulate *how strongly*, applied as a partial attenuation.

Measured on real surface points, fraction of samples carrying a visible hue shift:

| | greenish | reddish |
|---|---|---|
| Granite | 16.4% | 39.3% |
| Sandstone | 19.7% | 54.5% |
| Basalt | 0.0% | 14.4% |
| Limestone | 0.0% | 16.9% |
| Schist | 16.8% | 16.5% |

Before this work every one of those columns was effectively zero.

### Still outstanding

- **Sandstone, basalt and limestone still read smooth even in macro**, because their
  grains are 1.2-2.2 mm and remain sub-pixel at the macro footprint. Granite (8 mm)
  resolves. These need a resolvable intermediate texture band, not finer grains.
- No wet/dry contrast and no subsurface scattering; both matter for close-up realism.
- `MassExtent` and `MassRelief` are still shared across all five presets.
- The plinth still reads as a cracked plane rather than bedrock.
