#!/usr/bin/env python3
"""Hold the native gas inspector to the HTML it was ported from.

    python3 Tools/Build/GasInspectorParity.py

The browser card is the design reference and the C++ card is the port, exactly as the editor port worked.
A port is only a port on the day it is written unless something compares the two afterwards, so this reads
both sheets — Experimental/ProjectZeroEditor/GasSpecification.js and Engine/Editor/GasCardSurface.h — and
insists they describe the same eleven readings, the same seven emitter readings, the same transform rows
and the same four run policies.

It parses rather than imports: the JS is ES modules in a browser bundle and the C++ is a header, and a
check that needs a toolchain to run is a check that stops being run.
"""
import re
import sys
from pathlib import Path

Root = Path(__file__).resolve().parents[2]
Faults = []
Claims = 0


def Check(Condition, Claim):
    global Claims
    Claims += 1
    if Condition:
        print(f"  PASS  {Claim}")
    else:
        print(f"  FAIL  {Claim}")
        Faults.append(Claim)


def ReadBrowserSheet(Body, Name):
    """The JS sheets are built by the Slider/Switch helpers, so read those calls rather than the objects."""
    Block = Body[Body.index(f"export const {Name} = ["):]
    Block = Block[: Block.index("\n];")]
    Fields = []
    for Kind, Arguments in re.findall(r"\n\s*(Slider|Switch)\(([^)]*)\)", Block):
        Parts = [Part.strip() for Part in Arguments.split(",")]
        Label = Parts[0].strip('"')
        Key = Parts[2].strip('"')
        Entry = {"Label": Label, "Group": Parts[1].strip('"'), "Key": Key, "Control": Kind}
        if Kind == "Slider":
            Entry["Minimum"] = float(Parts[3])
            Entry["Maximum"] = float(Parts[4])
            Entry["Decimals"] = int(Parts[5])
        Fields.append(Entry)
    return Fields


def ReadNativeSheet(Body, Name):
    Block = Body[Body.index(f"inline const GasField* {Name}("):]
    Block = Block[: Block.index("\n}")]
    Fields = []
    for Line in re.findall(r"\{\s*\"[^\n]*\},", Block):
        Parts = [Part.strip() for Part in Line.strip().rstrip(",").strip("{}").split(",")]
        Entry = {
            "Label": Parts[0].strip('"'),
            "Group": Parts[1].strip('"'),
            "Key": Parts[2].strip('"'),
            "Control": "Switch" if "Switch" in Parts[3] else "Slider",
            "Minimum": float(Parts[4].rstrip("f")),
            "Maximum": float(Parts[5].rstrip("f")),
            "Decimals": int(Parts[7].rstrip("u")),
        }
        Fields.append(Entry)
    return Fields


def Compare(Browser, Native, Which):
    Check(len(Browser) == len(Native),
          f"{Which}: {len(Browser)} readings in the browser and {len(Native)} in the port")
    for Index, (Left, Right) in enumerate(zip(Browser, Native)):
        Where = f"{Which} #{Index + 1}"
        Check(Left["Label"] == Right["Label"], f"{Where}: both call it {Left['Label']!r}")
        Check(Left["Key"] == Right["Key"], f"{Where}: both write the simulator's {Left['Key']!r}")
        Check(Left["Group"] == Right["Group"], f"{Where}: both land it in the {Left['Group']!r} card")
        Check(Left["Control"] == Right["Control"], f"{Where}: both draw it as a {Left['Control']}")
        if Left["Control"] == "Slider":
            Check(abs(Left["Minimum"] - Right["Minimum"]) < 1e-6 and abs(Left["Maximum"] - Right["Maximum"]) < 1e-6,
                  f"{Where}: the same range, {Left['Minimum']:g} to {Left['Maximum']:g}")
            Check(Left["Decimals"] == Right["Decimals"], f"{Where}: the same {Left['Decimals']} decimals")


def Main():
    Sheet = (Root / "Experimental/ProjectZeroEditor/GasSpecification.js").read_text(encoding="utf-8")
    Surface = (Root / "Engine/Editor/GasCardSurface.h").read_text(encoding="utf-8")
    Residency = (Root / "Engine/VolumetricDynamics/GasDomainResidency.h").read_text(encoding="utf-8")

    print("GasInspectorParity - the port against the HTML it was ported from\n")
    print("The domain sheet")
    Compare(ReadBrowserSheet(Sheet, "GasSheet"), ReadNativeSheet(Surface, "GasSheet"), "domain")

    print("\nThe emitter sheet")
    Compare(ReadBrowserSheet(Sheet, "GasEmitterSheet"), ReadNativeSheet(Surface, "GasEmitterSheet"), "emitter")

    print("\nThe transform, and what is deliberately not a child")
    Rows = re.search(r"export const GasTransformRows = \[(.*?)\n\];", Sheet, re.S).group(1)
    Named = re.findall(r'\["([A-Za-z ]+)",\s*"([^"]*)"', Rows)
    Check([Name for Name, _ in Named] == ["Position", "Rotation", "Bounds"],
          "the browser's transform is Position, Rotation, Bounds")
    Check('const char* RowName[3] = { "Position", "Rotation", "Bounds" }' in Surface,
          "and so is the port's")
    Check(Named[2][1] == "m" and '"m", "deg", "m"' in Surface,
          "① bounds are metres in both — the domain's extent is its scale, not a child entity")
    Check("Scale" not in Rows and 'RowName[3] = { "Position", "Rotation", "Scale"' not in Surface,
          "and neither of them calls that row Scale")
    Check("OBSTACLES ARE NOT CHILDREN" in Sheet and "survive the deletion" in Surface,
          "③ both say why a collider is not parented to the domain")
    Check("ROTATION DOES NOT REACH THE SOLVER" in Sheet and "NOT THE LATTICE" in Surface,
          "⚠️ and both admit that rotation never reaches the axis-aligned lattice")

    print("\nThe run policy and the one-shot lifecycle")
    Policies = re.findall(r'Id: "(\w+)",\n\s*Name: "([^"]+)"', Sheet)
    Check([Id for Id, _ in Policies] == ["dormant", "triggered", "proximity", "always"],
          "four policies in the browser, dormant first because in a level it is the normal case")
    Check(all(f"{Name.capitalize()} " in Residency or f"    {Name}" in Residency.lower()
              for Name in ["Dormant", "Triggered", "Proximity", "Always"]),
          "and the same four in GasDomainResidency.h")
    for Id, Name in Policies:
        Check(f'case {["0u", "1u", "2u", "3u"][["dormant", "triggered", "proximity", "always"].index(Id)]}:'
              in Surface or Name in Surface, f"the port names the {Name!r} policy on the card")
    Check("GasRetires" in Sheet and "GasRetires" in Residency,
          "🔴 both sides spell the one-shot's retirement the same way")
    Check("GasFadeSeconds = 1.6" in Sheet and "1.6 s fade" in Surface,
          "and both quote the same fade before the fields are handed back")
    Check("Retire: true" in Sheet and "bool         Retire          = true" in Residency,
          "retirement is the default on both sides — holding the storage is the deliberate choice")

    print(f"\n{'PASS' if not Faults else 'FAIL'} {Claims}")
    if Faults:
        print(f"{len(Faults)} disagreement(s) between the card and its port")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(Main())
