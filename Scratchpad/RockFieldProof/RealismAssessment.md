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
