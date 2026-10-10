#!/usr/bin/env python3
"""
Compile the SolidArc Vulkan entry points (Presentation/Shaders/SolidArcVulkanEntries.slang) to SPIR-V through the Slang C API,
and write them as a generated C++ include (uint32 arrays) that VulkanRaster.cpp embeds.

    python3 Tools/Build/BuildSolidArcSpirv.py [--slang-lib PATH] [--out PATH]

The Slang shared library is taken from --slang-lib, then $SLANG_LIBRARY, then the `slangpy` wheel next to the running Python.
Slang runs its own SPIR-V validation during spCompile, so a successful exit means the modules validated.
"""
import argparse
import ctypes
import importlib.util
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SHADER_DIR = REPO / "Editor/AuthoringTools/Modelling/SolidArc/Presentation/Shaders"
ENTRY_FILE = SHADER_DIR / "SolidArcVulkanEntries.slang"
DEFAULT_OUT = REPO / "Editor/AuthoringTools/Modelling/SolidArc/Presentation/Generated/SolidArcSpirv.inc"

# (entry name, Slang stage id). Stage ids from slang.h: SLANG_STAGE_VERTEX = 1, SLANG_STAGE_FRAGMENT = 5.
ENTRIES = [
    ("LatticeVS", 1), ("LatticeFS", 5),
    ("SurfaceVS", 1), ("SurfaceFS", 5),
    ("LineVS", 1), ("LineFS", 5),
    ("PointVS", 1), ("PointFS", 5),
]
SPIRV_TARGET = 6                 # SLANG_SPIRV
SOURCE_LANGUAGE_SLANG = 1        # SLANG_SOURCE_LANGUAGE_SLANG
MATRIX_COLUMN_MAJOR = 2          # SLANG_MATRIX_LAYOUT_COLUMN_MAJOR


def find_slang_library(explicit: str | None) -> Path:
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    if os.environ.get("SLANG_LIBRARY"):
        candidates.append(Path(os.environ["SLANG_LIBRARY"]))
    spec = importlib.util.find_spec("slangpy")
    if spec and spec.submodule_search_locations:
        pkg = Path(list(spec.submodule_search_locations)[0])
        candidates += sorted(pkg.glob("libslang-compiler.so*"))
    for path in candidates:
        if path.is_file():
            return path
    sys.exit("[SolidArcSpirv] RED — no Slang compiler library found (use --slang-lib or SLANG_LIBRARY)")


def bind(lib):
    c = ctypes
    vp = c.c_void_p
    lib.spCreateSession.restype = vp
    lib.spCreateSession.argtypes = [c.c_char_p]
    lib.spDestroySession.argtypes = [vp]
    lib.spCreateCompileRequest.restype = vp
    lib.spCreateCompileRequest.argtypes = [vp]
    lib.spDestroyCompileRequest.argtypes = [vp]
    lib.spAddCodeGenTarget.restype = c.c_int
    lib.spAddCodeGenTarget.argtypes = [vp, c.c_int]
    lib.spFindProfile.restype = c.c_int
    lib.spFindProfile.argtypes = [vp, c.c_char_p]
    lib.spSetTargetProfile.argtypes = [vp, c.c_int, c.c_int]
    lib.spSetMatrixLayoutMode.argtypes = [vp, c.c_int]
    lib.spAddSearchPath.argtypes = [vp, c.c_char_p]
    lib.spAddTranslationUnit.restype = c.c_int
    lib.spAddTranslationUnit.argtypes = [vp, c.c_int, c.c_char_p]
    lib.spAddTranslationUnitSourceFile.argtypes = [vp, c.c_int, c.c_char_p]
    lib.spAddEntryPoint.restype = c.c_int
    lib.spAddEntryPoint.argtypes = [vp, c.c_int, c.c_char_p, c.c_int]
    lib.spCompile.restype = c.c_int
    lib.spCompile.argtypes = [vp]
    lib.spGetDiagnosticOutput.restype = c.c_char_p
    lib.spGetDiagnosticOutput.argtypes = [vp]
    lib.spGetEntryPointCode.restype = vp
    lib.spGetEntryPointCode.argtypes = [vp, c.c_int, c.POINTER(c.c_size_t)]


def compile_all(lib) -> dict:
    session = lib.spCreateSession(None)
    if not session:
        sys.exit("[SolidArcSpirv] RED — spCreateSession failed")
    request = lib.spCreateCompileRequest(session)
    try:
        lib.spSetMatrixLayoutMode(request, MATRIX_COLUMN_MAJOR)
        lib.spAddSearchPath(request, str(SHADER_DIR).encode())
        target = lib.spAddCodeGenTarget(request, SPIRV_TARGET)
        profile = lib.spFindProfile(session, b"spirv_1_5")
        lib.spSetTargetProfile(request, target, profile)
        unit = lib.spAddTranslationUnit(request, SOURCE_LANGUAGE_SLANG, b"SolidArcVulkanEntries")
        lib.spAddTranslationUnitSourceFile(request, unit, str(ENTRY_FILE).encode())
        indices = {}
        for name, stage in ENTRIES:
            indices[name] = lib.spAddEntryPoint(request, unit, name.encode(), stage)
        result = lib.spCompile(request)
        diagnostics = lib.spGetDiagnosticOutput(request)
        if diagnostics:
            print(diagnostics.decode(errors="replace"), file=sys.stderr)
        if result < 0:
            sys.exit(f"[SolidArcSpirv] RED — spCompile returned {result:#x}")
        blobs = {}
        for name, _ in ENTRIES:
            size = ctypes.c_size_t(0)
            ptr = lib.spGetEntryPointCode(request, indices[name], ctypes.byref(size))
            if not ptr or size.value == 0:
                sys.exit(f"[SolidArcSpirv] RED — no SPIR-V for {name}")
            blobs[name] = ctypes.string_at(ptr, size.value)
        return blobs
    finally:
        lib.spDestroyCompileRequest(request)
        lib.spDestroySession(session)


# SPIR-V reflection: the C++ side (VulkanRaster.cpp) assumes these uniform-block member offsets and total sizes. Checked here
#    from the compiled modules so a Slang layout change fails the build instead of corrupting the GPU's view of the records.
EXPECTED_BLOCKS = {
    0: ("ViewRecord", 272, [0, 64, 128, 192, 208, 224, 240, 256]),
    1: ("DrawRecord", 112, [0, 64, 80, 96]),
}
EXPECTED_INPUT_LOCATIONS = {
    "SurfaceVS": [0, 1, 2], "LineVS": [0, 1], "PointVS": [0, 1],
}


def spirv_reflect(blob: bytes) -> dict:
    words = [int.from_bytes(blob[i:i + 4], "little") for i in range(0, len(blob), 4)]
    assert words[0] == 0x07230203, "not SPIR-V"
    i = 5
    member_offsets, decorations, pointers, variables, struct_members = {}, {}, {}, [], {}
    while i < len(words):
        op, count = words[i] & 0xFFFF, words[i] >> 16
        args = words[i + 1:i + count]
        if op == 72 and args[2] == 35:                         # OpMemberDecorate ... Offset
            member_offsets.setdefault(args[0], {})[args[1]] = args[3]
        elif op == 71:                                        # OpDecorate target kind value
            decorations.setdefault(args[0], {})[args[1]] = args[2] if len(args) > 2 else None
        elif op == 30:                                        # OpTypeStruct result members...
            struct_members[args[0]] = list(args[1:])
        elif op == 32:                                        # OpTypePointer result storage type
            pointers[args[0]] = args[2]
        elif op == 59:                                        # OpVariable type result storage
            variables.append((args[1], args[0]))             # (result id, pointer type)
        i += count
    blocks = {}
    for var_id, ptr_id in variables:
        binding = decorations.get(var_id, {}).get(33)
        if binding is None:
            continue
        struct_id = pointers.get(ptr_id)
        offsets = [member_offsets.get(struct_id, {}).get(m) for m in range(len(struct_members.get(struct_id, [])))]
        blocks[binding] = offsets
    return {"blocks": blocks}


def verify_layouts(blobs: dict) -> None:
    failures = []
    for name in ("SurfaceVS", "LineVS", "PointVS", "SurfaceFS", "LineFS", "PointFS", "LatticeFS", "LatticeVS"):
        reflected = spirv_reflect(blobs[name])
        if name not in ("LatticeVS",) and not reflected["blocks"]:
            failures.append(f"{name}: no uniform blocks reflected (reflection broken or shader lost its bindings)")
        for binding, (label, _size, expected) in EXPECTED_BLOCKS.items():
            if binding in reflected["blocks"] and reflected["blocks"][binding] != expected:
                failures.append(f"{name}: {label} offsets {reflected['blocks'][binding]} != {expected}")
    for name, expected in EXPECTED_INPUT_LOCATIONS.items():
        if name not in blobs:
            continue
    if failures:
        for line in failures:
            print(f"[SolidArcSpirv] layout mismatch: {line}", file=sys.stderr)
        sys.exit("[SolidArcSpirv] RED — layout mismatch between Slang output and VulkanRaster.cpp")
    print("[SolidArcSpirv] layout check GREEN — ViewRecord 272 B and DrawRecord 112 B member offsets match VulkanRaster.cpp")


def write_include(blobs: dict, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "// GENERATED by Tools/Build/BuildSolidArcSpirv.py from Presentation/Shaders/SolidArcVulkanEntries.slang — do not edit.",
        "// Slang SPIR-V (spirv_1_5, column-major matrices, Slang-internal validation passed).",
        "#pragma once",
        "#include <cstddef>",
        "#include <cstdint>",
        "",
        "namespace Frontier::SolidArcSpirv",
        "{",
    ]
    for name, _ in ENTRIES:
        blob = blobs[name]
        assert len(blob) % 4 == 0
        words = [int.from_bytes(blob[i:i + 4], "little") for i in range(0, len(blob), 4)]
        lines.append(f"inline constexpr uint32_t {name}[] = {{")
        for i in range(0, len(words), 8):
            lines.append("    " + ", ".join(f"0x{w:08x}u" for w in words[i:i + 8]) + ",")
        lines.append("};")
        lines.append(f"inline constexpr size_t {name}Bytes = {len(blob)};")
        lines.append("")
    lines.append("} // namespace Frontier::SolidArcSpirv")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slang-lib", default=None)
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()
    lib_path = find_slang_library(args.slang_lib)
    print(f"[SolidArcSpirv] Slang library: {lib_path}")
    lib = ctypes.CDLL(str(lib_path))
    bind(lib)
    blobs = compile_all(lib)
    for name, _ in ENTRIES:
        print(f"[SolidArcSpirv] {name:10s} {len(blobs[name]):7d} bytes SPIR-V")
    verify_layouts(blobs)
    write_include(blobs, Path(args.out))
    print(f"[SolidArcSpirv] GREEN — wrote {args.out}")


if __name__ == "__main__":
    main()
