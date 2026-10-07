#!/usr/bin/env python3
"""Exercise the offline EOS SDK layout verifier using a tiny synthetic SDK tree."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "Online" / "verify_eos_sdk.py"
VERSION_HEADER = """\
#define EOS_MAJOR_VERSION 1
#define EOS_MINOR_VERSION 19
#define EOS_PATCH_VERSION 2
#define EOS_HOTFIX_VERSION 1
"""


class EosSdkVerifierTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        for relative in (
            "Include/Windows/eos_Windows.h",
            "Lib/EOSSDK-Win64-Shipping.lib",
            "Bin/EOSSDK-Win64-Shipping.dll",
        ):
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"test fixture")
        (self.root / "Include/eos_sdk.h").write_text("#pragma once\n", encoding="utf-8")
        (self.root / "Include/eos_version.h").write_text(VERSION_HEADER, encoding="utf-8")

    def run_verifier(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), str(self.root), *arguments],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_accepts_matching_sdk_and_reports_hashes(self) -> None:
        result = self.run_verifier()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("EOS SDK 1.19.2.1", result.stdout)
        self.assertEqual(result.stdout.count("SHA-256"), 2)

    def test_rejects_an_unexpected_sdk_version(self) -> None:
        result = self.run_verifier("--expected-version", "1.19.2.2")
        self.assertEqual(result.returncode, 2)
        self.assertIn("found EOS SDK 1.19.2.1", result.stderr)

    def test_rejects_an_incomplete_layout(self) -> None:
        (self.root / "Bin/EOSSDK-Win64-Shipping.dll").unlink()
        result = self.run_verifier()
        self.assertEqual(result.returncode, 2)
        self.assertIn("missing Bin/EOSSDK-Win64-Shipping.dll", result.stderr)


if __name__ == "__main__":
    unittest.main()
