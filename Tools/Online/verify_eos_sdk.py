#!/usr/bin/env python3
"""Validate a locally unpacked EOS SDK layout without copying SDK files into Git."""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from pathlib import Path

DEFAULT_VERSION = "1.19.2.1"
VERSION_FIELDS = (
    ("major", "EOS_MAJOR_VERSION"),
    ("minor", "EOS_MINOR_VERSION"),
    ("patch", "EOS_PATCH_VERSION"),
    ("hotfix", "EOS_HOTFIX_VERSION"),
)
REQUIRED_FILES = (
    Path("Include/eos_sdk.h"),
    Path("Include/eos_version.h"),
    Path("Include/Windows/eos_Windows.h"),
    Path("Lib/EOSSDK-Win64-Shipping.lib"),
    Path("Bin/EOSSDK-Win64-Shipping.dll"),
)
HASH_FILES = (
    Path("Lib/EOSSDK-Win64-Shipping.lib"),
    Path("Bin/EOSSDK-Win64-Shipping.dll"),
)


def read_version(header: Path) -> str:
    text = header.read_text(encoding="utf-8", errors="replace")
    values: dict[str, int] = {}
    for label, macro in VERSION_FIELDS:
        match = re.search(
            rf"^\s*#\s*define\s+{re.escape(macro)}\s+(\d+)\b",
            text,
            re.MULTILINE,
        )
        if match is None:
            raise ValueError(f"missing {macro} in {header}")
        values[label] = int(match.group(1))
    return ".".join(str(values[label]) for label, _ in VERSION_FIELDS)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify(sdk_root: Path, expected_version: str) -> int:
    sdk_root = sdk_root.expanduser().resolve()
    if not sdk_root.is_dir():
        print(f"ERROR: EOS SDK root is not a directory: {sdk_root}", file=sys.stderr)
        return 2

    missing = [relative for relative in REQUIRED_FILES if not (sdk_root / relative).is_file()]
    if missing:
        print(f"ERROR: incomplete EOS SDK layout under {sdk_root}:", file=sys.stderr)
        for relative in missing:
            print(f"  missing {relative.as_posix()}", file=sys.stderr)
        return 2

    try:
        version = read_version(sdk_root / "Include/eos_version.h")
    except (OSError, ValueError) as error:
        print(f"ERROR: could not read EOS SDK version: {error}", file=sys.stderr)
        return 2

    if version != expected_version:
        print(
            f"ERROR: found EOS SDK {version}, expected {expected_version}; "
            "pass --expected-version explicitly to validate a deliberate upgrade.",
            file=sys.stderr,
        )
        return 2

    print(f"EOS SDK {version}: Win64 layout verified at {sdk_root}")
    for relative in HASH_FILES:
        path = sdk_root / relative
        print(f"SHA-256  {sha256_file(path)}  {relative.as_posix()}")
    print("Runtime: link EOSSDK-Win64-Shipping.lib and deploy the matching DLL beside the executable.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "sdk_root",
        nargs="?",
        type=Path,
        default=os.environ.get("EOS_SDK_ROOT"),
        help="unpacked SDK root (defaults to EOS_SDK_ROOT)",
    )
    parser.add_argument(
        "--expected-version",
        default=DEFAULT_VERSION,
        help=f"required SDK version (default: {DEFAULT_VERSION})",
    )
    arguments = parser.parse_args()
    if arguments.sdk_root is None:
        parser.error("provide sdk_root or set EOS_SDK_ROOT")
    return verify(arguments.sdk_root, arguments.expected_version)


if __name__ == "__main__":
    raise SystemExit(main())
