#!/usr/bin/env bash
#=============================================================================================================================================
# 📦 Frontier/Scratchpad/RockFieldProof/VerifyRockField.sh — Regression Gate for the Geologic Rock Signed Distance Field
#=============================================================================================================================================
#
# Runs every check that guards the kernel:
#   ① the shared kernel compiles as C++20 against the GLSL compatibility layer
#   ② the field is Lipschitz valid on the exterior for all five lithologies (the tracer can never overshoot)
#   ③ a full camera of rays converges without tunnelling into the solid
#   ④ the same kernel text parses as GLSL ES 3.00 when wrapped by the WebGL preview
#
# Usage:  Scratchpad/RockFieldProof/VerifyRockField.sh
#
#=============================================================================================================================================

set -euo pipefail

RepositoryRoot="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RepositoryRoot"

echo "── ① compiling the shared kernel as C++20 ─────────────────────────────────────────────"
g++ -std=c++20 -O2 -Wall -Wextra \
    -o Scratchpad/RockFieldProof/rockproof \
    Scratchpad/RockFieldProof/RockFieldProof.cpp
echo "   ok"
echo

echo "── ② ③ measuring field validity and trace behaviour ──────────────────────────────────"
MeasurementOutput="$(./Scratchpad/RockFieldProof/rockproof --measure)"
echo "$MeasurementOutput"
echo

if grep -q "FAIL" <<< "$MeasurementOutput"; then
    echo "REGRESSION: the field is no longer safe to sphere trace."
    exit 1
fi

echo "── ④ parsing the kernel as GLSL ES 3.00 ───────────────────────────────────────────────"
if node -e "require(require('path').join(process.env.HOME||'','node_modules/@shaderfrog/glsl-parser'))" 2>/dev/null \
   || [ -d node_modules/@shaderfrog/glsl-parser ]; then
    node Scratchpad/RockFieldProof/ParseRockShader.js
else
    echo "   skipped (install @shaderfrog/glsl-parser to enable)"
fi
echo

echo "All rock field checks passed."
