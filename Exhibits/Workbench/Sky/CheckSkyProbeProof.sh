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

if (( Fail )); then echo "  >>> SKY PROBE PROOF FAILED"; exit 1; fi
echo "  >>> the probe agrees with the march"
