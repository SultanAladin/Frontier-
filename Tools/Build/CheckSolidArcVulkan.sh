#!/usr/bin/env bash
# Build gate for SolidArc's Vulkan raster path. Compiles VulkanRaster.cpp against Vulkan headers and checks that the committed
# SPIR-V include matches the Slang source. It does NOT run Vulkan: executing needs a loader, an ICD and a device.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1
Root="Editor/AuthoringTools/Modelling/SolidArc"
Compiler="${CXX:-g++}"

Include=""
if [ -n "${VULKAN_SDK:-}" ] && [ -f "$VULKAN_SDK/include/vulkan/vulkan.h" ]; then Include="$VULKAN_SDK/include"
elif [ -n "${VULKAN_HEADERS:-}" ] && [ -f "$VULKAN_HEADERS/include/vulkan/vulkan.h" ]; then Include="$VULKAN_HEADERS/include"
elif [ -f /usr/include/vulkan/vulkan.h ]; then Include="/usr/include"
fi
if [ -z "$Include" ]; then
    echo "[SolidArcVulkan] SKIPPED — no vulkan/vulkan.h (set VULKAN_SDK or VULKAN_HEADERS). Nothing was compiled."
    exit 0
fi
if ! command -v "$Compiler" >/dev/null 2>&1; then
    echo "[SolidArcVulkan] SKIPPED — no C++ compiler ($Compiler)"
    exit 0
fi

echo "[SolidArcVulkan] headers: $Include"
"$Compiler" -std=c++20 -Wall -Wextra -Wpedantic -Wno-missing-field-initializers -Wno-unused-function \
    -I"$Include" -I"$Root" -I"$Root/Presentation" \
    -fsyntax-only "$Root/Presentation/VulkanRaster.cpp"
echo "[SolidArcVulkan] VulkanRaster.cpp compiles against the Vulkan headers"

# The committed SPIR-V include must be the output of the current Slang source (regenerate and compare when the compiler is present).
if PYTHON="$(command -v python3)" && "$PYTHON" -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('slangpy') else 1)" 2>/dev/null; then
    Tmp="$(mktemp -d /tmp/SolidArcSpirvGate.XXXXXX)"
    trap 'rm -rf "$Tmp"' EXIT
    "$PYTHON" Tools/Build/BuildSolidArcSpirv.py --out "$Tmp/SolidArcSpirv.inc" >/dev/null
    if cmp -s "$Tmp/SolidArcSpirv.inc" "$Root/Presentation/Generated/SolidArcSpirv.inc"; then
        echo "[SolidArcVulkan] committed SPIR-V matches the Slang source"
    else
        echo "[SolidArcVulkan] RED — Generated/SolidArcSpirv.inc is stale; run Tools/Build/BuildSolidArcSpirv.py"
        exit 1
    fi
else
    echo "[SolidArcVulkan] SPIR-V freshness not checked — slangpy (Slang compiler) not installed"
fi
echo "[SolidArcVulkan] GREEN — compile gate passed (execution on a Vulkan device not performed)"
