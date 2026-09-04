//============================================================================================================================================
//                                                         SCENECODEC.H
//============================================================================================================================================
// 🧩 glTF 2.0 ⇄ SceneStructure. Decode: cgltf (ExternalPackages/cgltf) → GeometryStructure per primitive, one
//    SceneStructure instance per node×primitive, RadianceStructure per material (flat factors; textures are R2b).
//    Encode: a minimal writer (positions/normals/uvs, indices, KHR_materials_emissive_strength) used once to turn the
//    hard-coded Cornell box into Content/Scenes/CornellBox.gltf so the reference image survives the import path.
//
// Axis convention: glTF is right-handed Y-up; the engine is right-handed Z-up (CLAUDE.md §7). The decode applies
//    ClipProjection::ConstructGltfToWorldProjection() to every node's world matrix, the encode applies the inverse to
//    every vertex, so a round trip is exact.

#pragma once

#include "SceneStructure.h"
#include <string>

namespace Frontier {

struct SceneDecodeConfiguration
{
    float   UniformScale     = 1.0f;    // [-] applied after the axis swap (Sponza's node already carries 0.008)
    float   EmissiveRadiance = 1.0f;    // [-] multiplier on emissiveFactor × emissiveStrength
    bool    MergePrimitives  = false;   // [-] reserved (R7): merge same-material primitives before clustering
};

class SceneCodec
{
public:
    // Fills `Out` (cleared first) from a .gltf / .glb file. Returns false and sets `Error` on failure.
    [[nodiscard]] static bool Decode(const std::string& Path, SceneStructure& Out, const SceneDecodeConfiguration& Config, std::string* Error) noexcept;

    // Writes a world-space triangle soup (one mesh, one primitive per material) as an embedded-buffer .gltf.
    [[nodiscard]] static bool Encode(const std::string& Path, const std::vector<TriangleIndex>& Triangles,
                                     const std::vector<RadianceStructure>& Materials, std::string* Error) noexcept;
};

} // namespace Frontier
