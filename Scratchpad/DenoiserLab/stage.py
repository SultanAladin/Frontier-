#!/usr/bin/env python3
#============================================================================================================================================
#                                                          STAGE.PY
#============================================================================================================================================
# GLSL -> C++ staging for the lab, the same four mechanical substitutions the repo's own gate makes
# (Exhibits/Workbench/Materials/StageAtrousDenoise.py), relaxed only enough to accept the variant edits:
#   (1) drop `#version 460` and the `layout(local_size_...) in;` prologue lines
#   (2) the B3 kernel's GLSL array constructor -> a C++ brace initialiser, literals carried over verbatim
#   (3) split at the push-constant block's closing `};` -> part1 (through the block, closed as an instance) + part2
# Everything else compiles through DenoiseCpuShim.h / SlangCpuShim.h untouched.
import re
import sys

source, out1, out2 = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(source, encoding="utf-8").read().split("\n")

prologue = [i for i, l in enumerate(lines) if l.startswith("#version") or l.startswith("layout(local_size")]
assert len(prologue) == 2, "expected the two prologue lines"

array_lines = [i for i, l in enumerate(lines) if "float[5](" in l]
assert len(array_lines) == 1, "expected exactly one GLSL array constructor"
values = re.findall(r"-?\d+\.?\d*", lines[array_lines[0]].split("float[5](")[1])
assert len(values) == 5
lines[array_lines[0]] = "    const float Weights[5] = { " + ", ".join(values) + " };"

push = [i for i, l in enumerate(lines) if "push_constant" in l]
assert len(push) == 1, "push-constant block not found"
assert lines[push[0]] == "layout(push_constant) uniform DenoiseConstants", "unexpected push-constant opener"
lines[push[0]] = "struct DenoiseConstants"
close = next(i for i in range(push[0], len(lines)) if lines[i].strip() == "};")
lines[close] = "} DenoiseParameters;"

body = [l for i, l in enumerate(lines) if i not in set(prologue)]
# Recompute the split in the pruned list: the instance line is unique.
at = body.index("} DenoiseParameters;")
open(out1, "w", encoding="utf-8").write("\n".join(body[: at + 1]) + "\n")
open(out2, "w", encoding="utf-8").write("\n".join(body[at + 1 :]) + "\n")
print("staged", source)
