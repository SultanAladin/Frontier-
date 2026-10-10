#!/usr/bin/env bash
# Builds the CPU exact-mirror harness at -O2, runs it, then builds this exhibit. Needs g++, Python with Pillow, numpy, matplotlib.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
SA="$ROOT/Editor/AuthoringTools/Modelling/SolidArc"
WORK="$(mktemp -d /tmp/SolidArcProof.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/obj" "$WORK/out"
CORE=(Kernel/CurveSpecification.cpp Kernel/SurfaceSpecification.cpp Kernel/TopologySpecification.cpp Kernel/SkinSolver.cpp
      Kernel/IntersectionSolver.cpp Kernel/FairPatchSolver.cpp Kernel/ProfileSolver.cpp Kernel/ConstraintSolver.cpp
      Kernel/ConstraintGraph.cpp Kernel/MirrorSolver.cpp Kernel/BlendSolver.cpp Presentation/SoftwareRaster.cpp
      Presentation/ScenePresentation.cpp Interaction/CameraProjection.cpp)
OBJS=()
for F in "${CORE[@]}" Verification/PipelineMirrorProof.cpp; do
    O="$WORK/obj/$(echo "$F" | tr / _).o"
    g++ -std=c++20 -O2 -Wall -Wextra -Wno-unused-function -I"$SA" -I"$SA/Presentation" -c "$SA/$F" -o "$O"
    OBJS+=("$O")
done
g++ -O2 "${OBJS[@]}" -o "$WORK/pipeline_mirror_proof"
"$WORK/pipeline_mirror_proof" "$WORK/out"
python3 "$HERE/build_proofs.py" "$WORK/out"
