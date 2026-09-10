#!/usr/bin/env bash
# Sync tool panels into docs/ for GitHub Pages.
set -euo pipefail; cd "$(dirname "$0")/.."
cp Editor/EditorTools/ParametricSketcher/Panel/index.html docs/solidarc/index.html
echo "docs/ synced"
