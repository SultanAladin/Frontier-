#!/usr/bin/env python3
"""Preserve the 2500 J / 3% necessary available-energy bound independently of the stricter flight audit."""
from pathlib import Path
import argparse
import csv
import hashlib
import json


def Validate(Folder):
    Cases = []
    for File in sorted(Folder.glob("*.csv")):
        with File.open() as Stream:
            Rows = list(csv.DictReader(Stream))
        assert Rows and "mechanical_J" in Rows[0], "Use mechanical recordings, not chassis-only energy traces"
        Initial = float(Rows[0]["mechanical_J"]); Budget = max(2500.0, Initial * 0.03)
        Peak = max(Rows, key=lambda Row: float(Row["increase_J"]))
        Cases.append({"case": File.stem, "passed": float(Peak["increase_J"]) <= Budget, "peakIncreaseJ": float(Peak["increase_J"]),
            "budgetJ": Budget, "peakTime": float(Peak["t"]), "traceSHA256": hashlib.sha256(File.read_bytes()).hexdigest()})
    assert Cases
    Proof = {"passed": all(Case["passed"] for Case in Cases), "cpuOnly": True, "energyAccountClosed": False, "cases": Cases,
        "minimumAllowanceJ": 2500, "relativeAllowance": 0.03, "limitations": "Necessary bound only; partitioned coupling remains unclosed. Stricter flight gates remain separate."}
    (Folder / "EnergyBudgetProof.json").write_text(json.dumps(Proof, indent=2) + "\n")
    return Proof


if __name__ == "__main__":
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--output", type=Path, required=True)
    Arguments = Parser.parse_args(); Proof = Validate(Arguments.output)
    print(f"Necessary energy bound: {sum(Case['passed'] for Case in Proof['cases'])}/{len(Proof['cases'])} pass")
    raise SystemExit(0 if Proof["passed"] else 1)
