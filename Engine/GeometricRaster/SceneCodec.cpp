//============================================================================================================================================
//                                                        SCENECODEC.CPP
//============================================================================================================================================
// 🧩 glTF 2.0 decode via cgltf and a minimal embedded-buffer encoder.

#define CGLTF_IMPLEMENTATION
#include <cgltf.h>

#include "SceneCodec.h"
#include "ClipProjection.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <map>
#include <sstream>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                        DECODE
//------------------------------------------------------------------------------------------------------------------------

namespace {

const cgltf_accessor* FindAttribute(const cgltf_primitive& Primitive, cgltf_attribute_type Type, int Set = 0) noexcept
{
    for (cgltf_size I = 0; I < Primitive.attributes_count; ++I)
        if (Primitive.attributes[I].type == Type && Primitive.attributes[I].index == Set) return Primitive.attributes[I].data;
    return nullptr;
}

RadianceStructure DecodeMaterial(const cgltf_material* M, const SceneDecodeConfiguration& Config) noexcept
{
    RadianceStructure R{};
    R.AlbedoR = R.AlbedoG = R.AlbedoB = 0.8f;
    R.Roughness = 0.5f;
    R.Metallic  = 0.0f;
    if (!M) return R;
    if (M->has_pbr_metallic_roughness)
    {
        R.AlbedoR   = M->pbr_metallic_roughness.base_color_factor[0];
        R.AlbedoG   = M->pbr_metallic_roughness.base_color_factor[1];
        R.AlbedoB   = M->pbr_metallic_roughness.base_color_factor[2];
        R.Roughness = M->pbr_metallic_roughness.roughness_factor;
        R.Metallic  = M->pbr_metallic_roughness.metallic_factor;
    }
    const float Strength = (M->has_emissive_strength ? M->emissive_strength.emissive_strength : 1.0f) * Config.EmissiveRadiance;
    R.EmissiveR = M->emissive_factor[0] * Strength;
    R.EmissiveG = M->emissive_factor[1] * Strength;
    R.EmissiveB = M->emissive_factor[2] * Strength;
    return R;
}

} // namespace

bool SceneCodec::Decode(const std::string& Path, SceneStructure& Out, const SceneDecodeConfiguration& Config, std::string* Error) noexcept
{
    Out.Clear();

    cgltf_options Options{};
    cgltf_data*   Data = nullptr;
    cgltf_result  Result = cgltf_parse_file(&Options, Path.c_str(), &Data);
    if (Result != cgltf_result_success) { if (Error) *Error = "cgltf_parse_file failed (" + std::to_string(static_cast<int>(Result)) + ")"; return false; }
    Result = cgltf_load_buffers(&Options, Data, Path.c_str());
    if (Result != cgltf_result_success) { if (Error) *Error = "cgltf_load_buffers failed (" + std::to_string(static_cast<int>(Result)) + ")"; cgltf_free(Data); return false; }

    // Materials: glTF order, plus one fallback slot at the end for primitives without a material.
    std::vector<uint32_t> MaterialSlot(Data->materials_count);
    for (cgltf_size I = 0; I < Data->materials_count; ++I)
        MaterialSlot[I] = Out.RegisterMaterial(DecodeMaterial(&Data->materials[I], Config));
    const uint32_t FallbackSlot = Out.RegisterMaterial(DecodeMaterial(nullptr, Config));

    // Meshes are decoded once into GeometryStructures (object space, engine axes) and instanced per node.
    struct DecodedPrimitive { GeometryStructure Geometry; uint32_t Material; uint32_t Flags; };
    std::map<const cgltf_primitive*, DecodedPrimitive> Decoded;

    const Matrix4x4 AxisSwap = ConstructGltfToWorldProjection();
    Matrix4x4 Scale;
    Scale.Columns[0][0] = Scale.Columns[1][1] = Scale.Columns[2][2] = Config.UniformScale;
    const Matrix4x4 Root = MultiplyProjection(Scale, AxisSwap);

    uint32_t Skipped = 0u;
    for (cgltf_size N = 0; N < Data->nodes_count; ++N)
    {
        const cgltf_node& Node = Data->nodes[N];
        if (!Node.mesh) continue;

        float WorldColumns[16];
        cgltf_node_transform_world(&Node, WorldColumns);
        const Matrix4x4 World = MultiplyProjection(Root, ProjectionFromColumns(WorldColumns));

        for (cgltf_size P = 0; P < Node.mesh->primitives_count; ++P)
        {
            const cgltf_primitive& Primitive = Node.mesh->primitives[P];
            if (Primitive.type != cgltf_primitive_type_triangles) { ++Skipped; continue; }

            auto Found = Decoded.find(&Primitive);
            if (Found == Decoded.end())
            {
                const cgltf_accessor* Position = FindAttribute(Primitive, cgltf_attribute_type_position);
                if (!Position) { ++Skipped; continue; }
                const cgltf_accessor* Normal   = FindAttribute(Primitive, cgltf_attribute_type_normal);
                const cgltf_accessor* Tangent  = FindAttribute(Primitive, cgltf_attribute_type_tangent);
                const cgltf_accessor* Texcoord = FindAttribute(Primitive, cgltf_attribute_type_texcoord);

                DecodedPrimitive& D = Decoded[&Primitive];
                std::vector<VertexRecord> Vertices(Position->count);
                for (cgltf_size V = 0; V < Position->count; ++V)
                {
                    VertexRecord& R = Vertices[V];
                    float Tmp[4] = { 0.0f, 0.0f, 0.0f, 1.0f };
                    cgltf_accessor_read_float(Position, V, Tmp, 3);
                    R.SpatialLocation = Vector3{ Tmp[0], Tmp[1], Tmp[2] };   // glTF axes; World carries the swap
                    Tmp[0] = 0.0f; Tmp[1] = 1.0f; Tmp[2] = 0.0f;
                    if (Normal) cgltf_accessor_read_float(Normal, V, Tmp, 3);
                    R.NormalDirection = Vector3{ Tmp[0], Tmp[1], Tmp[2] };
                    Tmp[0] = 1.0f; Tmp[1] = 0.0f; Tmp[2] = 0.0f; Tmp[3] = 1.0f;
                    if (Tangent) cgltf_accessor_read_float(Tangent, V, Tmp, 4);
                    R.TangentDirection = Vector4{ Tmp[0], Tmp[1], Tmp[2], Tmp[3] };
                    Tmp[0] = 0.0f; Tmp[1] = 0.0f;
                    if (Texcoord) cgltf_accessor_read_float(Texcoord, V, Tmp, 2);
                    R.TextureCoordinateU = Tmp[0];
                    R.TextureCoordinateV = Tmp[1];
                }
                D.Geometry.AppendVertices(Vertices.data(), Vertices.size());

                std::vector<uint32_t> Indices;
                if (Primitive.indices)
                {
                    Indices.resize(Primitive.indices->count);
                    cgltf_accessor_unpack_indices(Primitive.indices, Indices.data(), sizeof(uint32_t), Indices.size());
                }
                else
                {
                    Indices.resize(Position->count);
                    for (cgltf_size I = 0; I < Position->count; ++I) Indices[I] = static_cast<uint32_t>(I);
                }
                Indices.resize(Indices.size() - Indices.size() % 3u);
                D.Geometry.AppendIndices(Indices.data(), Indices.size());

                D.Material = Primitive.material ? MaterialSlot[static_cast<size_t>(Primitive.material - Data->materials)] : FallbackSlot;
                D.Flags    = (Primitive.material && Primitive.material->double_sided) ? InstanceFlagDoubleSided : 0u;
                Found = Decoded.find(&Primitive);
            }

            (void)Out.RegisterInstance(Found->second.Geometry, World, Found->second.Material, Found->second.Flags);
        }
    }

    cgltf_free(Data);
    Out.Finalise();

    if (Out.QueryTriangleCount() == 0u) { if (Error) *Error = "no triangle primitives found"; return false; }
    if (Skipped && Error) *Error = std::to_string(Skipped) + " non-triangle primitive(s) skipped";
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        ENCODE
//------------------------------------------------------------------------------------------------------------------------
// One mesh, one primitive per material (flat-shaded: three unique vertices per triangle so per-face normals survive).

namespace {

std::string Base64(const std::vector<uint8_t>& Bytes)
{
    static const char* Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string Out;
    Out.reserve((Bytes.size() + 2u) / 3u * 4u);
    for (size_t I = 0; I < Bytes.size(); I += 3)
    {
        const uint32_t B0 = Bytes[I];
        const uint32_t B1 = I + 1 < Bytes.size() ? Bytes[I + 1] : 0u;
        const uint32_t B2 = I + 2 < Bytes.size() ? Bytes[I + 2] : 0u;
        const uint32_t Triple = (B0 << 16) | (B1 << 8) | B2;
        Out.push_back(Alphabet[(Triple >> 18) & 63u]);
        Out.push_back(Alphabet[(Triple >> 12) & 63u]);
        Out.push_back(I + 1 < Bytes.size() ? Alphabet[(Triple >> 6) & 63u] : '=');
        Out.push_back(I + 2 < Bytes.size() ? Alphabet[Triple & 63u] : '=');
    }
    return Out;
}

void AppendFloats(std::vector<uint8_t>& Bytes, const float* F, size_t Count)
{
    const size_t Offset = Bytes.size();
    Bytes.resize(Offset + Count * sizeof(float));
    std::memcpy(Bytes.data() + Offset, F, Count * sizeof(float));
}

std::string Number(float F)
{
    char Buffer[32];
    std::snprintf(Buffer, sizeof(Buffer), "%.9g", static_cast<double>(F));
    std::string S = Buffer;
    if (S.find_first_of(".einf") == std::string::npos) S += ".0";
    return S;
}

} // namespace

bool SceneCodec::Encode(const std::string& Path, const std::vector<TriangleIndex>& Triangles,
                        const std::vector<RadianceStructure>& Materials, std::string* Error) noexcept
{
    std::vector<uint8_t> Buffer;
    std::ostringstream Views, Accessors, Primitives;
    uint32_t ViewIndex = 0u, AccessorIndex = 0u;
    bool FirstPrimitive = true;

    for (uint32_t M = 0u; M < Materials.size(); ++M)
    {
        std::vector<float> Positions, Normals;
        std::vector<uint32_t> Indices;
        float Minimum[3] = {  1e30f,  1e30f,  1e30f };
        float Maximum[3] = { -1e30f, -1e30f, -1e30f };
        for (const TriangleIndex& T : Triangles)
        {
            uint32_t Slot; std::memcpy(&Slot, &T.MaterialSlot, sizeof(Slot));
            if (Slot != M) continue;
            const Vector3 Corners[3] = { WorldToGltf(Vector3{ T.VertexAlphaX, T.VertexAlphaY, T.VertexAlphaZ }),
                                         WorldToGltf(Vector3{ T.VertexBetaX,  T.VertexBetaY,  T.VertexBetaZ  }),
                                         WorldToGltf(Vector3{ T.VertexGammaX, T.VertexGammaY, T.VertexGammaZ }) };
            const Vector3 N = WorldToGltf(Vector3{ T.NormalX, T.NormalY, T.NormalZ });
            for (const Vector3& C : Corners)
            {
                Indices.push_back(static_cast<uint32_t>(Positions.size() / 3u));
                Positions.insert(Positions.end(), { C.x, C.y, C.z });
                Normals.insert(Normals.end(), { N.x, N.y, N.z });
                Minimum[0] = std::min(Minimum[0], C.x); Minimum[1] = std::min(Minimum[1], C.y); Minimum[2] = std::min(Minimum[2], C.z);
                Maximum[0] = std::max(Maximum[0], C.x); Maximum[1] = std::max(Maximum[1], C.y); Maximum[2] = std::max(Maximum[2], C.z);
            }
        }
        if (Indices.empty()) continue;

        const auto EmitView = [&](size_t ByteOffset, size_t ByteLength, int Target)
        {
            if (ViewIndex) Views << ",";
            Views << "{\"buffer\":0,\"byteOffset\":" << ByteOffset << ",\"byteLength\":" << ByteLength << ",\"target\":" << Target << "}";
            return ViewIndex++;
        };

        size_t Offset = Buffer.size();
        AppendFloats(Buffer, Positions.data(), Positions.size());
        const uint32_t PositionView = EmitView(Offset, Positions.size() * 4u, 34962);
        Offset = Buffer.size();
        AppendFloats(Buffer, Normals.data(), Normals.size());
        const uint32_t NormalView = EmitView(Offset, Normals.size() * 4u, 34962);
        Offset = Buffer.size();
        Buffer.resize(Offset + Indices.size() * 4u);
        std::memcpy(Buffer.data() + Offset, Indices.data(), Indices.size() * 4u);
        const uint32_t IndexView = EmitView(Offset, Indices.size() * 4u, 34963);

        const uint32_t Count = static_cast<uint32_t>(Positions.size() / 3u);
        if (AccessorIndex) Accessors << ",";
        Accessors << "{\"bufferView\":" << PositionView << ",\"componentType\":5126,\"count\":" << Count << ",\"type\":\"VEC3\""
                  << ",\"min\":[" << Number(Minimum[0]) << "," << Number(Minimum[1]) << "," << Number(Minimum[2]) << "]"
                  << ",\"max\":[" << Number(Maximum[0]) << "," << Number(Maximum[1]) << "," << Number(Maximum[2]) << "]}";
        const uint32_t PositionAccessor = AccessorIndex++;
        Accessors << ",{\"bufferView\":" << NormalView << ",\"componentType\":5126,\"count\":" << Count << ",\"type\":\"VEC3\"}";
        const uint32_t NormalAccessor = AccessorIndex++;
        Accessors << ",{\"bufferView\":" << IndexView << ",\"componentType\":5125,\"count\":" << Indices.size() << ",\"type\":\"SCALAR\"}";
        const uint32_t IndexAccessor = AccessorIndex++;

        if (!FirstPrimitive) Primitives << ",";
        FirstPrimitive = false;
        Primitives << "{\"attributes\":{\"POSITION\":" << PositionAccessor << ",\"NORMAL\":" << NormalAccessor << "},\"indices\":" << IndexAccessor
                   << ",\"material\":" << M << ",\"mode\":4}";
    }

    std::ostringstream MaterialsJson;
    for (uint32_t M = 0u; M < Materials.size(); ++M)
    {
        const RadianceStructure& R = Materials[M];
        if (M) MaterialsJson << ",";
        const float Peak = std::max({ R.EmissiveR, R.EmissiveG, R.EmissiveB, 0.0f });
        MaterialsJson << "{\"name\":\"material_" << M << "\",\"pbrMetallicRoughness\":{\"baseColorFactor\":["
                      << Number(R.AlbedoR) << "," << Number(R.AlbedoG) << "," << Number(R.AlbedoB) << ",1.0],"
                      << "\"metallicFactor\":" << Number(R.Metallic) << ",\"roughnessFactor\":" << Number(R.Roughness) << "}";
        if (Peak > 0.0f)
        {
            // emissiveFactor is clamped to [0,1] by the spec; the magnitude rides in KHR_materials_emissive_strength.
            MaterialsJson << ",\"emissiveFactor\":[" << Number(R.EmissiveR / Peak) << "," << Number(R.EmissiveG / Peak) << "," << Number(R.EmissiveB / Peak) << "]"
                          << ",\"extensions\":{\"KHR_materials_emissive_strength\":{\"emissiveStrength\":" << Number(Peak) << "}}";
        }
        MaterialsJson << "}";
    }

    std::ofstream File(Path, std::ios::binary | std::ios::trunc);
    if (!File) { if (Error) *Error = "cannot open " + Path + " for writing"; return false; }
    File << "{\"asset\":{\"version\":\"2.0\",\"generator\":\"Frontier SceneCodec\"},"
         << "\"extensionsUsed\":[\"KHR_materials_emissive_strength\"],"
         << "\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0,\"name\":\"CornellBox\"}],"
         << "\"meshes\":[{\"name\":\"CornellBox\",\"primitives\":[" << Primitives.str() << "]}],"
         << "\"materials\":[" << MaterialsJson.str() << "],"
         << "\"accessors\":[" << Accessors.str() << "],"
         << "\"bufferViews\":[" << Views.str() << "],"
         << "\"buffers\":[{\"byteLength\":" << Buffer.size() << ",\"uri\":\"data:application/octet-stream;base64," << Base64(Buffer) << "\"}]}\n";
    return static_cast<bool>(File);
}

} // namespace Frontier
