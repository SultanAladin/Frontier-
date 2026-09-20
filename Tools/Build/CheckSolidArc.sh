#!/usr/bin/env bash
# Build gate for the standalone SolidArc C++ CAD/modelling tool.
#
# SolidArc intentionally lives under Editor/AuthoringTools/Modelling instead of the Project-Zero runtime source batch.
# This gate proves the C++ side still compiles without CMake or external packages: kernel, document, console,
# interaction, software-raster presentation, console executable, and every C++ verification TU.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1

Compiler="${CXX:-g++}"
if ! command -v "$Compiler" >/dev/null 2>&1; then
    echo "[SolidArc] SKIPPED — no C++ compiler ($Compiler) on PATH"
    exit 0
fi

Root="Editor/AuthoringTools/Modelling/SolidArc"
if [ ! -d "$Root" ]; then
    echo "[SolidArc] RED — $Root is missing"
    exit 1
fi

Work="$(mktemp -d /tmp/SolidArcGate.XXXXXX)"
trap 'rm -rf "$Work"' EXIT
mkdir -p "$Work/obj" "$Work/proofs"

Flags=(-std=c++20 -Wall -Wextra -Wpedantic -Wno-unused-function -I"$Root" -I"$Root/Presentation" -DSOLIDARC_PROOF_FOLDER="\"$Work/proofs\"")
Core=(
    Kernel/CurveSpecification.cpp
    Kernel/SurfaceSpecification.cpp
    Kernel/TopologySpecification.cpp
    Kernel/SkinSolver.cpp
    Kernel/IntersectionSolver.cpp
    Kernel/FairPatchSolver.cpp
    Kernel/ProfileSolver.cpp
    Kernel/ConstraintSolver.cpp
    Kernel/ConstraintGraph.cpp
    Kernel/MirrorSolver.cpp
    Kernel/BlendSolver.cpp
    Presentation/SoftwareRaster.cpp
    Presentation/ScenePresentation.cpp
    Interaction/CameraProjection.cpp
    Interaction/SnapResolution.cpp
    Interaction/InputEvent.cpp
    Interaction/HotkeyChart.cpp
    Interaction/ToolSession.cpp
    Interaction/TransformGizmo.cpp
    Document/SceneDocument.cpp
    Document/FigureRecipe.cpp
    Document/UndoSequence.cpp
    Console/CommandCodec.cpp
    Console/ConsoleHost.cpp
    Console/ConsoleInteraction.cpp
    Console/ConsoleSelection.cpp
)

Objects=()
for Rel in "${Core[@]}"; do
    Obj="$Work/obj/${Rel//\//_}.o"
    "$Compiler" "${Flags[@]}" -c "$Root/$Rel" -o "$Obj"
    Objects+=("$Obj")
done

ConsoleObj="$Work/obj/SolidArcConsole.o"
"$Compiler" "${Flags[@]}" -c "$Root/Console/SolidArcConsole.cpp" -o "$ConsoleObj"
"$Compiler" "${Objects[@]}" "$ConsoleObj" -o "$Work/SolidArc"
"$Work/SolidArc" --help >/dev/null

echo "[SolidArc] console target links and starts"

VerifyCount=0
while IFS= read -r Source; do
    Name="$(basename "$Source" .cpp)"
    "$Compiler" "${Flags[@]}" -c "$Source" -o "$Work/obj/${Name}.o"
    VerifyCount=$((VerifyCount + 1))
done < <(find "$Root/Verification" -maxdepth 1 -name '*Verification.cpp' | sort)

echo "[SolidArc] compiled $VerifyCount C++ verification translation units"
echo "[SolidArc] GREEN — C++ side builds without external packages"
