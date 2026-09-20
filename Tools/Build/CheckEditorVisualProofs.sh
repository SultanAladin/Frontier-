#!/usr/bin/env bash
# Real ImGui visual proof for editor panes. This intentionally uses the same headless draw-list raster path as
# Exhibits/Workbench/Editor/EditorProof.cpp; it does not emit SVG mockups or simplified boards.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1

Compiler="${CXX:-g++}"
if ! command -v "$Compiler" >/dev/null 2>&1; then
    echo "[EditorVisualProof] SKIPPED — no C++ compiler ($Compiler) on PATH"
    exit 0
fi

ExpectedImgui="83f668625ad45364de71d385aeb6a5dd04bee02e"
Work="$(mktemp -d /tmp/SolidArcEditorProof.XXXXXX)"
trap 'rm -rf "$Work"' EXIT

PatchImguiRoot() {
    local Root="$1"
    local RepoRoot="$PWD"
    local Specs=(
        "PatchA-TrapezoidalTabs.patch|FRONTIER PATCH A"
        "PatchB-TabOverlapZOrder.patch|FRONTIER PATCH B"
        "PatchC-RoundTabButtons.patch|FRONTIER PATCH C"
        "PatchD-TabAddButton.patch|FRONTIER PATCH D"
        "PatchE-NoTabScrollButtons.patch|FRONTIER PATCH E"
    )
    local Spec PatchName Sentinel
    for Spec in "${Specs[@]}"; do
        IFS='|' read -r PatchName Sentinel <<< "$Spec"
        if grep -R -q "$Sentinel" "$Root/imgui.cpp" "$Root/imgui.h" "$Root/imgui_internal.h" "$Root/imgui_widgets.cpp" 2>/dev/null; then
            continue
        fi
        if ! git -C "$Root" apply --check "$RepoRoot/Tools/Build/Patches/$PatchName"; then
            echo "[EditorVisualProof] RED — $PatchName does not apply to $Root"
            return 1
        fi
        git -C "$Root" apply "$RepoRoot/Tools/Build/Patches/$PatchName"
    done
}

ImguiRoot="${IMGUI_INCLUDE_DIR:-}"
if [ -n "$ImguiRoot" ]; then
    echo "[EditorVisualProof] using IMGUI_INCLUDE_DIR=$ImguiRoot"
elif [ -f ExternalPackages/imgui/imgui.h ]; then
    ImguiRoot="ExternalPackages/imgui"
    echo "[EditorVisualProof] seating repository ImGui patches"
    python3 Tools/Build/ApplyImGuiPatches.py >/tmp/SolidArcEditorProof.imgui 2>&1 || {
        echo "[EditorVisualProof] RED — could not seat ImGui patches"
        sed 's/^/    /' /tmp/SolidArcEditorProof.imgui | head -30
        exit 1
    }
else
    ImguiRoot="$Work/imgui"
    echo "[EditorVisualProof] fetching patched ImGui input tree into $ImguiRoot"
    git init -q "$ImguiRoot"
    git -C "$ImguiRoot" remote add origin https://github.com/ocornut/imgui.git
    git -C "$ImguiRoot" fetch -q --depth 1 origin "$ExpectedImgui"
    git -C "$ImguiRoot" checkout -q FETCH_HEAD
fi

if [ ! -f "$ImguiRoot/imgui.h" ]; then
    echo "[EditorVisualProof] RED — missing ImGui at $ImguiRoot"
    exit 1
fi
if ! grep -q 'FRONTIER PATCH E' "$ImguiRoot/imgui.cpp" 2>/dev/null; then
    PatchImguiRoot "$ImguiRoot" >/tmp/SolidArcEditorProof.imgui 2>&1 || {
        sed 's/^/    /' /tmp/SolidArcEditorProof.imgui | head -30
        exit 1
    }
fi
if ! grep -q 'TabSlant' "$ImguiRoot/imgui.h" || ! grep -q 'FRONTIER PATCH E' "$ImguiRoot/imgui.cpp"; then
    echo "[EditorVisualProof] RED — ImGui is not patched with Frontier tab geometry"
    exit 1
fi

mkdir -p Exhibits/Gallery/Editor
Root="Editor/AuthoringTools/Modelling/SolidArc"

Sources=(
    Exhibits/Workbench/Editor/SolidArcEditorProof.cpp
    "$Root/Kernel/CurveSpecification.cpp"
    "$Root/Kernel/SurfaceSpecification.cpp"
    "$Root/Kernel/TopologySpecification.cpp"
    "$Root/Kernel/SkinSolver.cpp"
    "$Root/Kernel/IntersectionSolver.cpp"
    "$Root/Kernel/FairPatchSolver.cpp"
    "$Root/Kernel/ProfileSolver.cpp"
    "$Root/Kernel/ConstraintSolver.cpp"
    "$Root/Kernel/ConstraintGraph.cpp"
    "$Root/Kernel/MirrorSolver.cpp"
    "$Root/Kernel/BlendSolver.cpp"
    "$Root/Presentation/SoftwareRaster.cpp"
    "$Root/Presentation/ScenePresentation.cpp"
    "$Root/Interaction/CameraProjection.cpp"
    "$Root/Interaction/SnapResolution.cpp"
    "$Root/Interaction/InputEvent.cpp"
    "$Root/Interaction/HotkeyChart.cpp"
    "$Root/Interaction/ToolSession.cpp"
    "$Root/Interaction/TransformGizmo.cpp"
    "$Root/Document/SceneDocument.cpp"
    "$Root/Document/FigureRecipe.cpp"
    "$Root/Document/UndoSequence.cpp"
    "$Root/Console/CommandCodec.cpp"
    "$Root/Console/ConsoleHost.cpp"
    "$Root/Console/ConsoleInteraction.cpp"
    "$Root/Console/ConsoleSelection.cpp"
    "$Root/Editor/SolidArcOutlinerAdapter.cpp"
    "$Root/Editor/SolidArcEditorHost.cpp"
    Engine/Editor/ControlPanel.cpp
    Engine/Editor/OutlinerPanel.cpp
    Engine/Editor/ViewportPanel.cpp
    Engine/Editor/InspectorPanel.cpp
    Engine/DisplayPresentation/GlyphSpace.cpp
    Engine/DisplayPresentation/VectorCodec.cpp
    Engine/DisplayPresentation/PixelSpace.cpp
    "$ImguiRoot/imgui.cpp"
    "$ImguiRoot/imgui_draw.cpp"
    "$ImguiRoot/imgui_tables.cpp"
    "$ImguiRoot/imgui_widgets.cpp"
)

if ! "$Compiler" -std=c++20 -O2 -Wall -Wextra -Wpedantic -Wno-unused-function -DFRONTIER_DEVELOPMENT \
    -I"$ImguiRoot" -I. -IEngine/Editor -IEngine/DisplayPresentation -IExhibits/Workbench/Editor \
    -I"$Root" -I"$Root/Presentation" \
    "${Sources[@]}" -o "$Work/SolidArcEditorProof" >/tmp/SolidArcEditorProof.build 2>&1; then
    echo "[EditorVisualProof] RED — SolidArc editor proof did not compile"
    sed 's/^/    /' /tmp/SolidArcEditorProof.build | head -40
    exit 1
fi

if ! "$Work/SolidArcEditorProof" >/tmp/SolidArcEditorProof.run 2>&1; then
    echo "[EditorVisualProof] RED — SolidArc editor proof did not run"
    sed 's/^/    /' /tmp/SolidArcEditorProof.run | head -40
    exit 1
fi
sed 's/^/    /' /tmp/SolidArcEditorProof.run | head -20

GameProof="Exhibits/Gallery/Editor/EditorProof_Inspector.png"
SolidArcProof="Exhibits/Gallery/Editor/EditorProof_SolidArc.png"
if [ ! -s "$GameProof" ]; then
    echo "[EditorVisualProof] RED — missing canonical game editor proof: $GameProof"
    echo "    Run Exhibits/Workbench/Editor/CheckEditorProof.sh when full editor proof dependencies are available."
    exit 1
fi
if [ ! -s "$SolidArcProof" ]; then
    echo "[EditorVisualProof] RED — missing SolidArc editor proof: $SolidArcProof"
    exit 1
fi
if [ -n "$(find Exhibits/Gallery/EditorPanels -type f 2>/dev/null | head -1)" ]; then
    echo "[EditorVisualProof] RED — simplified EditorPanels mockups are still present"
    exit 1
fi

echo "[EditorVisualProof] game proof:     $GameProof"
echo "[EditorVisualProof] SolidArc proof: $SolidArcProof"
echo "[EditorVisualProof] GREEN — real ImGui editor proofs, no SVG/mockup boards"
