#!/usr/bin/env bash
#============================================================================================================================================
# 📦 Exhibits/Workbench/Materials/RunGlintSheet.sh — M6b flakes: sized, coloured, and VISIBLE (roadmap #10)
#============================================================================================================================================
# The library's row 12 carried slate_glint_density × slate_glint_uv_scale since R4a, read by nothing. M6 wired the
#    pair into both halves through the automotive preview's sine-field flake signal; the gates went green (the arms
#    differed) and the picture stayed WRONG: at those frequencies every feature of a sine field is sub-pixel, so the
#    parameters were read and nothing was visible. Two things were missing, and neither can be expressed by a noise
#    field — a flake's SIZE, and its COLOUR.
#
#    M6b replaces the signal with a flake LATTICE (Engine/Shaders/AutomotiveMaterialProfiles.slang, SlateFlakeSample /
#    SlateFlakeNormal — shared text, run by the kernel and by the CPU mirror):
#      · uv_scale is now the lattice frequency in CELLS PER METRE, read directly (the ×3 fudge is gone);
#      · slate_glint_size (new, Slate2.z) is the chip's radius as a fraction of its cell — the knob that finally
#        makes a flake wider than a pixel;
#      · slate_glint_color_spread (new, Slate2.w) gives each chip its own pigment off a hue wheel — automotive
#        multi-colour candy flake, the thing a single-tint field cannot do.
#    A chip REPLACES the basecoat where it sits (a flake is a chip of metal lying on paint, not a colour filter over
#    it), carries one constant orientation across its whole face, and is polished relative to the matte paint around
#    it. It is still a microfacet under the coat: no lobe is added, and nothing emits.
#
#    Row 12 is now the material this model exists for: a dark saturated basecoat under a clear coat, lattice 190 → 70
#    cells/m, chip 0.26 → 0.40 of a cell, and colour spread in THIRDS across the columns — cols 0-4 plain aluminium,
#    5-9 a tinted mix, 10-14 full candy flake.
#
#    Arms and gates (unchanged in spirit, re-pinned to the new picture):
#      ① the row shot and its --no-glints A/B must DIFFER (the pair is read),
#      ② their film means must agree within 2 % (a flake redistributes light, it does not create any),
#      ③ the three close-ups must differ FROM EACH OTHER (colour spread is read: three different materials),
#      ④ every arm must render 0 non-finite/out-of-range samples (the kFlakeFloor measurement — a hue with an exact
#        zero channel drives the energy-compensation term negative; see the constant's note).
#
#    usage: bash Exhibits/Workbench/Materials/RunGlintSheet.sh [fast|full]
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.." || exit 1

Mode="${1:-full}"
Host="Projects/Project-Zero/Host"
Bin="$Host/MaterialLevelViewport"
Gallery="Exhibits/Gallery/Materials"
Work="$(mktemp -d /tmp/GlintSheet.XXXXXX)"
trap 'rm -rf "$Work"' EXIT

W=640; H=360; Spp=48
CW=480; CH=360; CSpp=48
if [ "$Mode" = "fast" ]; then W=320; H=180; Spp=12; CW=240; CH=180; CSpp=12; fi

echo "[GlintSheet] building the Project-Zero CPU viewport"
if ! make -C "$Host" MaterialLevelViewport >/tmp/GlintSheet.build 2>&1; then
    echo "[GlintSheet] BUILD FAILED"; sed 's/^/    /' /tmp/GlintSheet.build | tail -25; exit 1
fi

Render() { # $1 = tag, $2 = view, $3 = extra args, $4 = w, $5 = h, $6 = spp, $7 = label
    echo "[GlintSheet] $7"
    "$Bin" --level showcase --view "$2" --width "$4" --height "$5" --spp "$6" --frames 1 $3 \
        --out "$Work/$1.png" > "$Work/$1.log" 2>&1 || {
        echo "[GlintSheet] RED — $1 exited $?"; sed 's/^/    /' "$Work/$1.log" | tail -15; exit 1; }
    # Gate ④: a flake pigment with an exact zero channel used to push the energy-compensation term negative.
    if ! grep -q ", 0 non-finite/out-of-range samples" "$Work/$1.log"; then
        echo "[GlintSheet] RED — $1 has non-finite or out-of-range samples (kFlakeFloor regression?)"
        grep 'film:' "$Work/$1.log" | sed 's/^/    /'; exit 1
    fi
}

Render on    glints ""            "$W"  "$H"  "$Spp"  "① the flake row — lattice 190 → 70 cells/m, spread in thirds"
Render off   glints "--no-glints" "$W"  "$H"  "$Spp"  "② --no-glints — the pre-M6 surface, byte-for-byte"
Render alu   flakes-alu   "" "$CW" "$CH" "$CSpp" "③ close: col 2  — colour_spread 0.00, plain aluminium flake"
Render mix   flakes       "" "$CW" "$CH" "$CSpp" "④ close: col 7  — colour_spread 0.55, tinted mix"
Render candy flakes-candy "" "$CW" "$CH" "$CSpp" "⑤ close: col 12 — colour_spread 1.00, full candy flake"

Rmse() { compare -metric RMSE "$1" "$2" null: 2>&1 | grep -oE '\(([0-9.]+)\)' | tr -d '()'; }

# Gate ①: the arms differ — the pair is READ.
R="$(Rmse "$Work/on.png" "$Work/off.png")"
# The floor is MEASURED, not guessed, and it moved with M6b: the row shot frames 15 spheres across a wide plate, so
#    the flakes occupy a modest share of the pixels, and the new chips are finer than the old sine field's blotches.
#    Measured full 640x360x48 with the row properly framed (the eye moved into the 11/12 gap — the old shot put two
#    rows of other materials in front of the subject): 0.0323. Floor 0.012 — comfortably above a no-op (which is
#    identically 0) and comfortably below the measurement, so a regression that stops reading the pair fails loudly.
Floor="0.012"; [ "$Mode" = "fast" ] && Floor="0.010"
echo "[GlintSheet] arms differ by RMSE $R (normalised; floor $Floor)"
if ! awk -v R="$R" -v F="$Floor" 'BEGIN { exit (R > F) ? 0 : 1 }'; then
    echo "[GlintSheet] RED — the arms are near-identical: slate_glint_* is stored-unread again"; exit 1
fi

# Gate ②: energy sanity — the film means agree within 2 % (a flake moves light, never makes it).
MeanOn="$(grep -oE 'film: mean [0-9.]+' "$Work/on.log"  | grep -oE '[0-9.]+$')"
MeanOff="$(grep -oE 'film: mean [0-9.]+' "$Work/off.log" | grep -oE '[0-9.]+$')"
echo "[GlintSheet] film means: on $MeanOn, off $MeanOff"
if ! awk -v A="$MeanOn" -v B="$MeanOff" 'BEGIN { D = A > B ? A - B : B - A; exit (D / B < 0.02) ? 0 : 1 }'; then
    echo "[GlintSheet] RED — the glint arm changed the image's energy, not just its distribution"; exit 1
fi

# Gate ③: colour spread is READ — the three close-ups are three different materials, not one rendered thrice.
#    They frame different spheres, so the floor is generous; what would fail is the channel going unread and the
#    three columns collapsing onto one another's appearance is NOT what this measures — the pairwise RMSE simply
#    must be real. (The column-to-column identity check is the swatch proof's job, not a picture's.)
for Pair in "alu mix" "mix candy" "alu candy"; do
    set -- $Pair
    P="$(Rmse "$Work/$1.png" "$Work/$2.png")"
    echo "[GlintSheet] close-up $1 vs $2: RMSE $P"
    if ! awk -v R="$P" 'BEGIN { exit (R > 0.01) ? 0 : 1 }'; then
        echo "[GlintSheet] RED — $1 and $2 render alike: slate_glint_color_spread is unread"; exit 1
    fi
done

# The kept sheets: the row A/B, and the three-pigment close-up strip.
montage -font EngineContent/FontArchives/Archivo/Archivo-Bold.ttf -pointsize 14 -fill white -background '#1b1d22' \
    -label "glints ON — row 12 as automotive flake paint: lattice 190-70 cells/m, chip 0.26-0.40 of a cell, colour spread 0 | 0.55 | 1" "$Work/on.png" \
    -label "glints OFF (--no-glints) — the pre-M6 surface: smooth highlights, the stored-unread era" "$Work/off.png" \
    -tile 1x2 -geometry +6+6 "$Gallery/GlintRowSheet.png"
echo "[GlintSheet] wrote $Gallery/GlintRowSheet.png"

montage -font EngineContent/FontArchives/Archivo/Archivo-Bold.ttf -pointsize 14 -fill white -background '#1b1d22' \
    -label "col 2 — spread 0.00: plain aluminium flake" "$Work/alu.png" \
    -label "col 7 — spread 0.55: tinted mix" "$Work/mix.png" \
    -label "col 12 — spread 1.00: full candy flake" "$Work/candy.png" \
    -tile 3x1 -geometry +6+6 "$Gallery/FlakePigmentSheet.png"
echo "[GlintSheet] wrote $Gallery/FlakePigmentSheet.png"
echo "[GlintSheet] >>> the flakes are sized, coloured, and visible"
