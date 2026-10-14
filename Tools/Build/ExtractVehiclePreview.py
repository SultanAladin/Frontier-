#!/usr/bin/env python3
"""Pack the actual authored ControlVehicle (body plus four tyres, no proving ground) into one small binary glTF.

    python3 Tools/Build/ExtractVehiclePreview.py            # write Experimental/TabletPanel/ControlVehicle.glb
    python3 Tools/Build/ExtractVehiclePreview.py --check    # fail if the written file is stale

The source is the engine-authored Projects/Project-Zero/Content/Scenes/Vehicle.gltf (git-ignored, rebuilt by the
host from the shared VehicleStructure). Only the vehicle nodes are kept, and they are copied byte for byte: no
retopology, no material invention. The output is the car the HMI previews are allowed to show.
"""
import argparse
import base64
import hashlib
import json
import struct
from pathlib import Path

Root = Path(__file__).resolve().parents[2]
Source = Root / "Projects/Project-Zero/Content/Scenes/Vehicle.gltf"
Target = Root / "Experimental/TabletPanel/ControlVehicle.glb"
Manifest = Root / "Experimental/TabletPanel/ControlVehicle.json"


def Pack():
    Scene = json.loads(Source.read_text())
    Buffer = Scene["buffers"][0]["uri"]
    Prefix = "data:application/octet-stream;base64,"
    if not Buffer.startswith(Prefix):
        raise SystemExit("ExtractVehiclePreview: Vehicle.gltf no longer embeds its buffer")
    Bytes = base64.b64decode(Buffer[len(Prefix):])
    KeptNodes = [Index for Index, Node in enumerate(Scene["nodes"]) if "proving ground" not in Node["name"]]
    KeptMeshes = sorted({Scene["nodes"][Index]["mesh"] for Index in KeptNodes})
    Accessors, Views, Materials = {}, {}, {}
    OutBytes = bytearray()
    OutViews, OutAccessors, OutMaterials, OutMeshes, OutNodes = [], [], [], [], []

    def CopyView(ViewIndex):
        if ViewIndex in Views:
            return Views[ViewIndex]
        View = Scene["bufferViews"][ViewIndex]
        Start = View.get("byteOffset", 0)
        while len(OutBytes) % 4:
            OutBytes.append(0)
        Copy = {"buffer": 0, "byteOffset": len(OutBytes), "byteLength": View["byteLength"]}
        if "byteStride" in View:
            Copy["byteStride"] = View["byteStride"]
        if "target" in View:
            Copy["target"] = View["target"]
        OutBytes.extend(Bytes[Start:Start + View["byteLength"]])
        OutViews.append(Copy)
        Views[ViewIndex] = len(OutViews) - 1
        return Views[ViewIndex]

    def CopyAccessor(AccessorIndex):
        if AccessorIndex in Accessors:
            return Accessors[AccessorIndex]
        Accessor = dict(Scene["accessors"][AccessorIndex])
        Accessor["bufferView"] = CopyView(Accessor["bufferView"])
        OutAccessors.append(Accessor)
        Accessors[AccessorIndex] = len(OutAccessors) - 1
        return Accessors[AccessorIndex]

    def CopyMaterial(MaterialIndex):
        if MaterialIndex in Materials:
            return Materials[MaterialIndex]
        OutMaterials.append(Scene["materials"][MaterialIndex])
        Materials[MaterialIndex] = len(OutMaterials) - 1
        return Materials[MaterialIndex]

    MeshMap = {}
    for MeshIndex in KeptMeshes:
        Mesh = Scene["meshes"][MeshIndex]
        Primitives = []
        for Primitive in Mesh["primitives"]:
            Copy = {"attributes": {Name: CopyAccessor(Index) for Name, Index in Primitive["attributes"].items()},
                    "indices": CopyAccessor(Primitive["indices"]), "material": CopyMaterial(Primitive["material"]),
                    "mode": Primitive.get("mode", 4)}
            Primitives.append(Copy)
        OutMeshes.append({"name": Mesh["name"], "primitives": Primitives})
        MeshMap[MeshIndex] = len(OutMeshes) - 1
    for Index in KeptNodes:
        Node = Scene["nodes"][Index]
        OutNodes.append({"name": Node["name"], "mesh": MeshMap[Node["mesh"]]})
    Document = {
        "asset": {"version": "2.0", "generator": "Frontier ExtractVehiclePreview"},
        "extensionsUsed": Scene.get("extensionsUsed", []),
        "scene": 0, "scenes": [{"name": "ControlVehicle preview", "nodes": list(range(len(OutNodes)))}],
        "nodes": OutNodes, "meshes": OutMeshes, "materials": OutMaterials, "accessors": OutAccessors,
        "bufferViews": OutViews, "buffers": [{"byteLength": len(OutBytes)}],
    }
    while len(OutBytes) % 4:
        OutBytes.append(0)
    Json = json.dumps(Document, separators=(",", ":")).encode()
    while len(Json) % 4:
        Json += b" "
    Length = 12 + 8 + len(Json) + 8 + len(OutBytes)
    Glb = b"glTF" + struct.pack("<II", 2, Length) + struct.pack("<I", len(Json)) + b"JSON" + Json \
        + struct.pack("<I", len(OutBytes)) + b"BIN\0" + bytes(OutBytes)
    Facets = sum(Scene["accessors"][Primitive["indices"]]["count"] // 3
                 for MeshIndex in KeptMeshes for Primitive in Scene["meshes"][MeshIndex]["primitives"])
    Record = {
        "source": str(Source.relative_to(Root)), "sourceSHA256": hashlib.sha256(Source.read_bytes()).hexdigest(),
        "glbSHA256": hashlib.sha256(Glb).hexdigest(), "glbBytes": len(Glb), "nodes": [Node["name"] for Node in OutNodes],
        "materials": [{"name": Material["name"], "baseColor": Material.get("pbrMetallicRoughness", {}).get("baseColorFactor", [1, 1, 1, 1])[:3]}
                      for Material in OutMaterials], "facets": Facets,
        "authoredBy": "Projects/Project-Drive/Source/DriveSceneAuthor.cpp (ControlVehicleStructure.inl body, ControlWheelStructure.inl rims, tread lattice)",
        "statement": "Byte-identical geometry and materials of the Drive-authored ControlVehicle; the proving ground is omitted. Visual preview only.",
    }
    return Glb, Record


if __name__ == "__main__":
    Parser = argparse.ArgumentParser(description=__doc__)
    Parser.add_argument("--check", action="store_true")
    Arguments = Parser.parse_args()
    if not Source.exists():
        if Arguments.check and Target.exists() and Manifest.exists():
            # 📝 The engine-authored scene is not committed; CI can still prove the committed glb is the manifest's glb.
            Record = json.loads(Manifest.read_text())
            if hashlib.sha256(Target.read_bytes()).hexdigest() != Record["glbSHA256"]:
                raise SystemExit("ExtractVehiclePreview: ControlVehicle.glb does not match its manifest")
            print(f"ExtractVehiclePreview: source scene absent; {Target.relative_to(Root)} matches its manifest "
                  f"({Record['facets']} facets, source {Record['sourceSHA256'][:12]}…)")
            raise SystemExit(0)
        raise SystemExit(f"ExtractVehiclePreview: {Source.relative_to(Root)} is absent; open Project-Zero once to author it")
    Glb, Record = Pack()
    if Arguments.check:
        if not Target.exists() or hashlib.sha256(Target.read_bytes()).hexdigest() != Record["glbSHA256"]:
            raise SystemExit("ExtractVehiclePreview: ControlVehicle.glb is stale - re-run the extractor")
        print(f"ExtractVehiclePreview: {Target.relative_to(Root)} is current ({Record['facets']} facets)")
    else:
        Target.write_bytes(Glb)
        Manifest.write_text(json.dumps(Record, indent=2) + "\n")
        print(f"ExtractVehiclePreview: wrote {Target.relative_to(Root)} {len(Glb)} bytes, {Record['facets']} facets, "
              f"{len(Record['nodes'])} nodes")
