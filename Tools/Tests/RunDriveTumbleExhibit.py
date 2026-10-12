#!/usr/bin/env python3
"""Publish the reconstructed consolidated Drive flight/tumble/incline evidence without hiding failing audits."""
from pathlib import Path
import subprocess
import sys

if __name__ == "__main__":
    raise SystemExit(subprocess.run([sys.executable, str(Path(__file__).with_name("RunDriveFlightExhibit.py")), *sys.argv[1:]]).returncode)
