#!/usr/bin/env python3
"""Restore verified locked proof dependencies without editing vendored source or relying on a prior sandbox."""
from pathlib import Path
import hashlib
import json
import tarfile
import urllib.request

Root = Path(__file__).resolve().parents[2]


def RestoreVulkanHeaders():
    Installed = Root / "ExternalPackages/vulkan-headers/include"
    if (Installed / "vulkan/vulkan.h").exists():
        return Installed
    Contents = json.loads((Root / "ExternalPackages/Dependencies.lock.json").read_text())

    def Locate(Entry):
        if isinstance(Entry, dict):
            if Entry.get("name") == "vulkan-headers":
                return Entry
            for Content in Entry.values():
                Reading = Locate(Content)
                if Reading:
                    return Reading
        elif isinstance(Entry, list):
            for Content in Entry:
                Reading = Locate(Content)
                if Reading:
                    return Reading
        return None

    Specification = Locate(Contents)
    assert Specification, "Vulkan headers must be pinned in the authoritative dependency lock"
    Destination = Root / "_AgentScratch/tmp/Dependencies"
    Include = Destination / ("Vulkan-Headers-" + Specification["revision"]) / "include"
    if (Include / "vulkan/vulkan.h").exists():
        return Include
    assert Specification["url"].startswith("https://codeload.github.com/KhronosGroup/Vulkan-Headers/")
    Archive = urllib.request.urlopen(Specification["url"], timeout=60).read()
    assert hashlib.sha256(Archive).hexdigest() == Specification["sha256"], "Dependency archive hash mismatch"
    Destination.mkdir(parents=True, exist_ok=True)
    Compressed = Destination / "VulkanHeaders.tar.gz"
    Compressed.write_bytes(Archive)
    with tarfile.open(Compressed) as Input:
        for Member in Input.getmembers():
            assert not Path(Member.name).is_absolute() and ".." not in Path(Member.name).parts
            assert not Member.issym() and not Member.islnk()
        Input.extractall(Destination)
    assert (Include / "vulkan/vulkan.h").exists()
    return Include


def RestoreProofDependency(Name):
    """Restore one hash-locked source dependency into disposable native-proof storage."""
    Entries = json.loads((Root / "ExternalPackages/Dependencies.lock.json").read_text())["packages"]
    Specification = next(Entry for Entry in Entries if Entry["name"] == Name)
    Destination = Root / "_AgentScratch/tmp/Dependencies"
    Folder = Destination / (Name + "-" + Specification["revision"])
    if Folder.exists():
        return Folder
    Destination.mkdir(parents=True, exist_ok=True)
    Compressed = Destination / (Name + ".tar.gz")
    if not Compressed.exists() or hashlib.sha256(Compressed.read_bytes()).hexdigest() != Specification["sha256"]:
        Compressed.write_bytes(urllib.request.urlopen(Specification["url"], timeout=60).read())
    assert hashlib.sha256(Compressed.read_bytes()).hexdigest() == Specification["sha256"]
    with tarfile.open(Compressed) as Input:
        Members = Input.getmembers()
        Top = Members[0].name.split("/")[0]
        for Member in Members:
            assert not Path(Member.name).is_absolute() and ".." not in Path(Member.name).parts
        # Source archives are locked; do not materialize archive links in disposable proof storage.
        Input.extractall(Destination, members=[Member for Member in Members if not Member.issym() and not Member.islnk()])
    Extracted = Destination / Top
    if Extracted != Folder:
        Extracted.rename(Folder)
    return Folder
