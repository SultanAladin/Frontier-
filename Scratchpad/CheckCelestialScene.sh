#!/usr/bin/env bash
#=============================================================================================================================================
# 📦 Frontier/Scratchpad/CheckCelestialScene.sh — Numeric Gate for the Celestial Port
#=============================================================================================================================================
#
#    Two executables, two jobs:
#      · CelestialPhysicsProof  — the transcription against independent physics (Kasten-Young air mass, Descartes'
#        rainbow angles, spherical astronomy, the 1/λ⁴ law, HG normalisation, a quadrature of the fog kernel).
#      · CelestialSceneProof    — the combined frame: ReSTIR + Cornell box + every celestial system at once,
#        including the sky-off negative control that proves the sky is a light and not a painted backdrop.
#
#    Both return their failure count as the exit code, so this script is usable as a pre-commit gate.
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
${Compiler} ${CompilerFlags} -I. -o "${BuildDirectory}/CelestialSceneProof" \
    Scratchpad/CelestialSceneProof.cpp ${CelestialSources} || { echo "  scene proof failed to build"; exit 91; }

TotalFailures=0

"${BuildDirectory}/CelestialPhysicsProof"
PhysicsFailures=$?
TotalFailures=$(( TotalFailures + PhysicsFailures ))

pushd Projects/Project-Zero > /dev/null || exit 1
mkdir -p Diagnostics
"../../${BuildDirectory}/CelestialSceneProof"
SceneFailures=$?
popd > /dev/null || exit 1
TotalFailures=$(( TotalFailures + SceneFailures ))

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
    echo "  CELESTIAL GATE PASSED — physics 0 failures, scene 0 failures"
else
    echo "  CELESTIAL GATE FAILED — physics ${PhysicsFailures}, scene ${SceneFailures}"
fi
echo "──────────────────────────────────────────────────────────────────────────────────────────"
exit "${TotalFailures}"
