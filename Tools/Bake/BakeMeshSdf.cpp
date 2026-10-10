//============================================================================================================================================
//                                                      BAKEMESHSDF.CPP
//============================================================================================================================================
// 📦 Import-time bake: one .fsdf signed distance field per unique mesh, named by a hash of its source bytes and resolution.
//    A cache hit skips the bake. Nothing in the engine calls this at runtime.
//
// Usage: BakeMeshSdf <mesh.obj> <output directory> [resolution=32] [padding=0.1]

#include "../../Engine/GeometricRaster/MeshDistanceField.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>

int main(int Argc, char** Argv)
{
    if (Argc < 3)
    {
        std::fprintf(stderr, "usage: BakeMeshSdf <mesh.obj> <output directory> [resolution=32] [padding=0.1]\n");
        return 2;
    }
    const std::string Source    = Argv[1];
    const std::string OutputDir = Argv[2];
    const uint32_t    Resolution = Argc > 3 ? uint32_t(std::atoi(Argv[3])) : 32u;
    const float       Padding    = Argc > 4 ? float(std::atof(Argv[4])) : 0.1f;
    if (Resolution < 4u || Resolution > 256u) { std::fprintf(stderr, "resolution must be 4..256\n"); return 2; }

    std::vector<MeshDistanceField::Triangle> Tris;
    std::string Bytes;
    if (!MeshDistanceField::LoadObj(Source, Tris, &Bytes)) { std::fprintf(stderr, "cannot read triangles from %s\n", Source.c_str()); return 1; }

    // Hash over source bytes, resolution and padding, so any change to any input yields a new cache name.
    uint64_t Hash = MeshDistanceField::Fnv1a(Bytes.data(), Bytes.size());
    Hash = MeshDistanceField::Fnv1a(&Resolution, sizeof(Resolution), Hash);
    Hash = MeshDistanceField::Fnv1a(&Padding, sizeof(Padding), Hash);
    Hash = MeshDistanceField::Fnv1a(&MeshDistanceField::FileVersion, sizeof(MeshDistanceField::FileVersion), Hash);

    const std::filesystem::path Stem = std::filesystem::path(Source).stem();
    char HashText[32];
    std::snprintf(HashText, sizeof(HashText), "%016llx", static_cast<unsigned long long>(Hash));
    const std::filesystem::path Target = std::filesystem::path(OutputDir) / (Stem.string() + "-" + HashText + ".fsdf");
    std::filesystem::create_directories(OutputDir);

    MeshDistanceField::Field Cached;
    if (std::filesystem::exists(Target) && MeshDistanceField::Load(Target.string(), Cached) && Cached.H.ContentHash == Hash)
    {
        std::printf("[BakeMeshSdf] cache hit  %s (no bake)\n", Target.string().c_str());
        return 0;
    }

    const auto T0 = std::chrono::steady_clock::now();
    MeshDistanceField::Field F = MeshDistanceField::Bake(Tris, Resolution, Padding, Hash);
    const double Seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - T0).count();
    if (!MeshDistanceField::Save(F, Target.string())) { std::fprintf(stderr, "cannot write %s\n", Target.string().c_str()); return 1; }
    std::printf("[BakeMeshSdf] baked      %s  triangles %zu  resolution %u  %.3f s (import time, once per hash)\n",
                Target.string().c_str(), Tris.size(), Resolution, Seconds);
    return 0;
}
