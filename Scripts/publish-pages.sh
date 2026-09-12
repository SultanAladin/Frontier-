#!/usr/bin/env bash
# Sync the canonical SolidArc browser panel into docs/ for GitHub Pages.
set -euo pipefail
cd "$(dirname "$0")/.."
stamp="$(date -u +%Y%m%d-%H%M)-$(git rev-parse --short HEAD)"
source_dir="Editor/EditorTools/ParametricSketcher/Panel"
target_dir="docs/solidarc"
mkdir -p "$target_dir"
sed "s/__BUILD__/$stamp/" "$source_dir/index.html" > "$target_dir/index.html"
cp "$source_dir/solidarc-bridge.js" "$target_dir/solidarc-bridge.js"
echo "SolidArc Pages build $stamp"
