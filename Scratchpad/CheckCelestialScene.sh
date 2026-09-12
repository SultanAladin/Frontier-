#!/usr/bin/env bash
#=============================================================================================================================================
# 📦 Frontier/Scratchpad/CheckCelestialScene.sh — Numeric Gate for the Celestial Port
#=============================================================================================================================================
#
#    Four executables, four jobs:
#      · CelestialPhysicsProof  — the transcription against independent physics (Kasten-Young air mass, Descartes'
#        rainbow angles, spherical astronomy, the 1/λ⁴ law, HG normalisation, a quadrature of the fog kernel).
#      · CelestialGroundProof   — the world under the sky: ray/plane geometry in closed form, the box-filtered
#        checker's convergence, the traced height field against the field it traces, the inverse-square law and
#        the spot cone against cos(13°).
#      · CelestialCombinedProof — ablation: switch each element off ALONE, re-render, and require the image to
#        change. This is the only proof that answers "is every element actually IN the one frame", as opposed
#        to "does every element compute the right numbers somewhere". It is what would have caught the ground
#        plane being perfectly integrated and completely invisible.
#      · CelestialSceneProof    — the combined frame: ReSTIR + Cornell box + every celestial system at once,
#        including the sky-off negative control that proves the sky is a light and not a painted backdrop.
#
#    Each returns its failure count as the exit code, so this script is usable as a pre-commit gate.
#
#=============================================================================================================================================

set -u

RepositoryRoot="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${RepositoryRoot}" || exit 1

Compiler="${CXX:-g++}"
CompilerFlags="-std=c++20 -O2 -Wall -Wextra -Werror -pedantic -pthread"
BuildDirectory="Scratchpad/.build"
mkdir -p "${BuildDirectory}"

CelestialSources="
    Projects/Project-Zero/Source/CelestialIntegrator.cpp
    Projects/Project-Zero/Source/CelestialStage.cpp
    Projects/Project-Zero/Source/PrecipitationSolver.cpp
    Projects/Project-Zero/Source/RayTracingSolver.cpp
    Projects/Project-Zero/Source/FlyThroughSolver.cpp
    GeometricRaster/CameraProjection.cpp
    DeviceExchange/OrientationClassifier.cpp
    DeviceExchange/InputExchange.cpp
"

echo "──────────────────────────────────────────────────────────────────────────────────────────"
echo "  Building the celestial proofs"
echo "──────────────────────────────────────────────────────────────────────────────────────────"

# shellcheck disable=SC2086
${Compiler} ${CompilerFlags} -I. -o "${BuildDirectory}/CelestialPhysicsProof" \
    Scratchpad/CelestialPhysicsProof.cpp \
    Projects/Project-Zero/Source/CelestialIntegrator.cpp \
    DeviceExchange/OrientationClassifier.cpp || { echo "  physics proof failed to build"; exit 90; }

# shellcheck disable=SC2086
${Compiler} ${CompilerFlags} -I. -o "${BuildDirectory}/CelestialGroundProof" \
    Scratchpad/CelestialGroundProof.cpp \
    Projects/Project-Zero/Source/CelestialIntegrator.cpp \
    DeviceExchange/OrientationClassifier.cpp || { echo "  ground proof failed to build"; exit 92; }

# shellcheck disable=SC2086
${Compiler} ${CompilerFlags} -I. -o "${BuildDirectory}/CelestialCombinedProof" \
    Scratchpad/CelestialCombinedProof.cpp ${CelestialSources} || { echo "  combined proof failed to build"; exit 93; }

# shellcheck disable=SC2086
${Compiler} ${CompilerFlags} -I. -o "${BuildDirectory}/CelestialSceneProof" \
    Scratchpad/CelestialSceneProof.cpp ${CelestialSources} || { echo "  scene proof failed to build"; exit 91; }

TotalFailures=0

"${BuildDirectory}/CelestialPhysicsProof"
PhysicsFailures=$?
TotalFailures=$(( TotalFailures + PhysicsFailures ))

"${BuildDirectory}/CelestialGroundProof"
GroundFailures=$?
TotalFailures=$(( TotalFailures + GroundFailures ))

pushd Projects/Project-Zero > /dev/null || exit 1
mkdir -p Diagnostics
"../../${BuildDirectory}/CelestialCombinedProof"
CombinedFailures=$?
"../../${BuildDirectory}/CelestialSceneProof"
SceneFailures=$?
popd > /dev/null || exit 1
TotalFailures=$(( TotalFailures + CombinedFailures + SceneFailures ))

# The proof writes PPM; the repository ignores *.ppm, so publish the PNG sheet next to it.
for Stem in Dawn Noon Dusk Night; do
    Source="Projects/Project-Zero/Diagnostics/Celestial_${Stem}.ppm"
    if [ -f "${Source}" ]; then
        python3 Tools/PpmToPng.py "${Source}" "Projects/Project-Zero/Diagnostics/Celestial_${Stem}.png" > /dev/null
    fi
done

echo
echo "──────────────────────────────────────────────────────────────────────────────────────────"
if [ "${TotalFailures}" -eq 0 ]; then
    echo "  CELESTIAL GATE PASSED — physics 0, ground 0, combined 0, scene 0 failures"
else
    echo "  CELESTIAL GATE FAILED — physics ${PhysicsFailures}, ground ${GroundFailures}, combined ${CombinedFailures}, scene ${SceneFailures}"
fi
echo "──────────────────────────────────────────────────────────────────────────────────────────"
exit "${TotalFailures}"
