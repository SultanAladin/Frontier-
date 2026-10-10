//============================================================================================================================================
//                                                      BAKETRIANGLEFIELD.CPP
//============================================================================================================================================
// 📦 Import step: bakes a signed distance field per unique mesh, cached by content hash. The engine never calls this at runtime.
//
// Usage:
//   TriangleFieldImport <mesh.obj> <cache directory> [resolution=32] [padding=0.1]
//   TriangleFieldImport --dir <content root> <cache directory> [resolution=32] [padding=0.1]     (writes sdf_index.tsv)

#include "../../Engine/GeometricRaster/TriangleField.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>

int main(int Argc, char** Argv)
{
    if (Argc < 3)
    {
        std::fprintf(stderr, "usage: TriangleFieldImport <mesh.obj> <cache dir> [resolution=32] [padding=0.1]\n"
                             "       TriangleFieldImport --dir <content root> <cache dir> [resolution=32] [padding=0.1]\n");
        return 2;
    }
    const bool DirectoryMode = std::string(Argv[1]) == "--dir";
    const int  Shift         = DirectoryMode ? 1 : 0;
    if (Argc < 3 + Shift) { std::fprintf(stderr, "missing cache directory\n"); return 2; }
    const std::string Input    = Argv[1 + Shift];
    const std::string CacheDir = Argv[2 + Shift];
    const uint32_t    Resolution = Argc > 3 + Shift ? uint32_t(std::atoi(Argv[3 + Shift])) : 32u;
    const float       Padding    = Argc > 4 + Shift ? float(std::atof(Argv[4 + Shift])) : 0.1f;
    if (Resolution < 4u || Resolution > 256u) { std::fprintf(stderr, "resolution must be 4..256\n"); return 2; }

    const auto T0 = std::chrono::steady_clock::now();
    if (DirectoryMode)
    {
        uint32_t Hits = 0u;
        std::string Error;
        const int Count = TriangleField::ProjectDirectory(Input, CacheDir, Resolution, Padding, &Hits, &Error);
        if (Count < 0) { std::fprintf(stderr, "import failed: %s\n", Error.c_str()); return 1; }
        std::printf("[TriangleFieldImport] %d mesh(es) indexed, %u cache hit(s), %u baked, %.3f s (import time)\n", Count, Hits,
                    uint32_t(Count) - Hits, std::chrono::duration<double>(std::chrono::steady_clock::now() - T0).count());
        return 0;
    }
    uint64_t Hash = 0u;
    std::string FileName, Error;
    bool Hit = false;
    if (!TriangleField::ProjectSource(Input, CacheDir, Resolution, Padding, Hash, FileName, Hit, Error))
    {
        std::fprintf(stderr, "%s\n", Error.c_str());
        return 1;
    }
    std::printf("[TriangleFieldImport] %s %s/%s (%.3f s, import time)\n", Hit ? "cache hit" : "baked    ", CacheDir.c_str(), FileName.c_str(),
                std::chrono::duration<double>(std::chrono::steady_clock::now() - T0).count());
    return 0;
}
