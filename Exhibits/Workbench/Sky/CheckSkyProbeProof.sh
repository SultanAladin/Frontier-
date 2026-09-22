#!/usr/bin/env bash
#============================================================================================================================================
# 📦 Exhibits/Workbench/Sky/CheckSkyProbeProof.sh — The Sky Probe Gate (roadmap #26 stage A)
#============================================================================================================================================
# Compiles and runs SkyProbeProof: the 256² HDR octahedral bake against the analytic march at six times of
#    day, every point feature (sun disc, moon, stars, animated cirrus) staying analytic, the horizon band
#    marched. GREEN means every hour's probe error, panel RMSE and fetch speed-up passed their gates and the
#    six stacked A/B sheets exist in the Gallery.
set -u
cd "$(dirname "$0")/../../.."

Fail=0
echo "[SkyProbeProof] the bake against the march — compile, run, gate the sheets"

Binary="$(mktemp -u /tmp/SkyProbeProof.XXXXXX)"
if ! g++ -std=c++20 -O2 -Wall -Wextra \
     -I Exhibits/Workbench/Editor -I Projects/Project-Zero/Source -pthread \
     Exhibits/Workbench/Sky/SkyProbeProof.cpp \
     Engine/DeviceExchange/OrientationClassifier.cpp \
     -o "$Binary" 2>/tmp/SkyProbeProof.build; then
    echo "  COMPILE FAILED"; sed 's/^/    /' /tmp/SkyProbeProof.build | head -25; Fail=1
else
    "$Binary" || Fail=1
fi
rm -f "$Binary"

for Sheet in 06h00 09h00 12h00 15h00 17h56 21h00; do
    if [[ ! -s Exhibits/Gallery/Sky/SkyProbeProof_$Sheet.png ]]; then
        echo "  MISSING Exhibits/Gallery/Sky/SkyProbeProof_$Sheet.png"; Fail=1
    else
        echo "  wrote Exhibits/Gallery/Sky/SkyProbeProof_$Sheet.png"
    fi
done

# The engine half (roadmap #26 stage A wiring): SkyDomeSheet.h's bake against AtmosphereModel's march, read
#    through the kernel's own fetch arithmetic, plus the boolean's guardrails and the staleness rule.
Binary2="$(mktemp -u /tmp/SkyDomeKernelProof.XXXXXX)"
if ! g++ -std=c++20 -O2 -Wall -Wextra \
     -I Engine/DisplayPresentation \
     Exhibits/Workbench/Sky/SkyDomeKernelProof.cpp \
     -o "$Binary2" 2>/tmp/SkyDomeKernelProof.build; then
    echo "  COMPILE FAILED (SkyDomeKernelProof)"; sed 's/^/    /' /tmp/SkyDomeKernelProof.build | head -25; Fail=1
else
    "$Binary2" || Fail=1
fi
rm -f "$Binary2"

# The two copies of the split's constants — SkyDomeSheet.h (host) and SkyRecords.slang (kernel) — pinned
#    against each other, the kAureole precedent: a drifted copy is two skies.
for Pin in "kSkyDomeSide.*256" "kSkyDomeHorizonSine.*0.02618" "kSkyDomeSunConeCos.*0.99756"; do
    grep -qE "$Pin" Engine/DisplayPresentation/SkyDomeSheet.h || { echo "  PIN MISSING in SkyDomeSheet.h: $Pin"; Fail=1; }
    grep -qE "$Pin" Engine/Shaders/SkyRecords.slang           || { echo "  PIN MISSING in SkyRecords.slang: $Pin"; Fail=1; }
done
# The kernel's refusals and the host's boolean, present by name: the fetch may never run without them.
grep -q "SkyDomeCovers" Engine/Shaders/SkyRecords.slang || { echo "  SkyRecords.slang lost SkyDomeCovers - the fetch would answer for the sun cone and the horizon"; Fail=1; }
grep -q "SkyDomeStagingMatches" Projects/Project-Zero/Source/CelestialSequence.cpp || { echo "  CelestialSequence lost the staleness compare - a scrubbed sun could render yesterday's air"; Fail=1; }
grep -q "sky_dome_baked" Engine/DisplayPresentation/ConfigurationRegistry.cpp || { echo "  the [render] sky_dome_baked seat is gone"; Fail=1; }

if (( Fail )); then echo "  >>> SKY PROBE PROOF FAILED"; exit 1; fi
echo "  >>> the probe agrees with the march"
