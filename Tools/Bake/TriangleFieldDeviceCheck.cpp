//============================================================================================================================================
//                                                    TRIANGLEFIELDDEVICECHECK.CPP
//============================================================================================================================================
// Device run for the mesh SDF kernels. Lists every Vulkan GPU it sees and picks one with a compute queue (discrete preferred).
// Then it runs ProjectGridMain and ClipMinimumMain and compares the results with the CPU exact mirror (TriangleFieldDeviceMirror) and the CPU bake.
// Exit code 0 only when every check passes. Tolerance: 1e-3 (float rounding across driver and CPU arithmetic).
//
// Build (Linux, Vulkan loader present):
//    g++ -std=c++20 -O2 -I<Vulkan headers> Tools/Bake/TriangleFieldDeviceCheck.cpp Engine/GeometricRaster/TriangleFieldVulkanExchange.cpp -lvulkan -o meshsdf_device_check
// Run:
//    ./meshsdf_device_check
//
// Timings are submit-to-fence wall-clock seconds per dispatch. They include driver overhead and are not GPU-only timestamps.
// Status: compile-checked only. NOT RUN on a device yet.

#include "../../Engine/GeometricRaster/TriangleField.h"
#include "../../Engine/GeometricRaster/TriangleFieldDeviceMirror.h"
#include "../../Engine/GeometricRaster/TriangleFieldVulkanExchange.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

namespace
{
int Failures = 0;

void Check(bool Ok, const char* Name, const std::string& Detail = "")
{
    std::printf("%s  %s %s\n", Ok ? "PASS" : "FAIL", Name, Detail.c_str());
    if (!Ok) ++Failures;
}

// Unit cube, 12 triangles.
std::vector<TriangleField::Triangle> UnitCube()
{
    const float V[8][3] = { { -1, -1, -1 }, { 1, -1, -1 }, { 1, 1, -1 }, { -1, 1, -1 }, { -1, -1, 1 }, { 1, -1, 1 }, { 1, 1, 1 }, { -1, 1, 1 } };
    const int Quads[6][4] = { { 0, 3, 2, 1 }, { 4, 5, 6, 7 }, { 0, 1, 5, 4 }, { 3, 7, 6, 2 }, { 0, 4, 7, 3 }, { 1, 2, 6, 5 } };
    std::vector<TriangleField::Triangle> Out;
    for (const auto& Q : Quads)
    {
        const int TriA[3] = { Q[0], Q[1], Q[2] };
        const int TriB[3] = { Q[0], Q[2], Q[3] };
        for (const int* Idx : { TriA, TriB })
        {
            TriangleField::Triangle T{};
            for (int C = 0; C < 3; ++C) for (int A = 0; A < 3; ++A) T.V[C][A] = V[Idx[C]][A];
            Out.push_back(T);
        }
    }
    return Out;
}
} // namespace

int main()
{
    TriangleFieldVulkanExchange::Context Ctx;
    std::string Log, Error;
    if (!TriangleFieldVulkanExchange::CreateContext(Ctx, Log, Error))
    {
        std::printf("%s", Log.c_str());
        std::printf("RED - device selection: %s\n", Error.c_str());
        return 1;
    }
    std::printf("%s", Log.c_str());

    TriangleFieldVulkanExchange::Kernels K;
    if (!K.Create(Ctx, Error))
    {
        std::printf("RED - kernel creation: %s\n", Error.c_str());
        TriangleFieldVulkanExchange::DestroyContext(Ctx);
        return 1;
    }

    // ---- Project on the device, compare with the CPU bake ----
    const uint32_t N = 32u;
    const auto Tris = UnitCube();
    const TriangleField::Field Ref = TriangleField::Project(Tris, N, 0.1f, 1u);

    std::vector<float> TriFlat;
    for (const auto& T : Tris) for (const auto& V : T.V) for (int A = 0; A < 3; ++A) TriFlat.push_back(V[A]);

    std::vector<float> GpuField;
    double ProjectSeconds = 0.0;
    const bool ProjectRan = K.Project(TriFlat, Ref.H.Min, Ref.H.Max, N, GpuField, ProjectSeconds, Error);
    Check(ProjectRan, "GPU bake dispatch completed", Error);

    double ProjectDiff = 0.0;
    if (ProjectRan && GpuField.size() == Ref.Distance.size())
        for (size_t I = 0; I < GpuField.size(); ++I)
            ProjectDiff = std::max(ProjectDiff, std::fabs(double(GpuField[I]) - double(Ref.Distance[I])));
    char Detail[200];
    std::snprintf(Detail, sizeof(Detail), "(max abs diff %.2e over %zu nodes, submit-to-fence %.4f s)", ProjectDiff, GpuField.size(), ProjectSeconds);
    Check(ProjectRan && GpuField.size() == Ref.Distance.size() && ProjectDiff <= 1e-3, "GPU bake matches the CPU bake at every node", Detail);

    // ---- ClipMinimum on the device over a dirty box, three instances, sentinel outside the box ----
    // Instance transforms are column-major 4x4 (translation in [12..14]), as the engine stores them.
    const float Trans[3][3]  = { { 25.0f, 0.0f, 0.75f }, { 3.0f, -1.0f, 0.5f }, { -10.0f, 4.0f, 0.0f } };
    const float Scale[3][3]  = { { 2.1f, 0.95f, 0.75f }, { 2.0f, 2.0f, 2.0f }, { 4.0f, 1.0f, 1.5f } };
    const float YawRad[3]    = { 0.0f, 30.0f * 3.14159265f / 180.0f, 0.0f };

    std::vector<TriangleFieldDeviceMirror::InstanceGpu> MirrorInstances;
    std::vector<TriangleFieldVulkanExchange::InstanceGpuHost> DeviceInstances;
    for (int I = 0; I < 3; ++I)
    {
        float World[16] = {};
        const float C = std::cos(YawRad[I]), S = std::sin(YawRad[I]);
        World[0] = C * Scale[I][0];  World[1] = S * Scale[I][0];
        World[4] = -S * Scale[I][1]; World[5] = C * Scale[I][1];
        World[10] = Scale[I][2];
        World[12] = Trans[I][0]; World[13] = Trans[I][1]; World[14] = Trans[I][2]; World[15] = 1.0f;

        TriangleField::Affine Aff{};
        if (!TriangleField::MakeAffine(World, Aff)) { Check(false, "instance affine is invertible"); continue; }

        // The field data for every instance is the same bake, so offset 0 for each.
        const TriangleFieldDeviceMirror::InstanceGpu G = TriangleFieldDeviceMirror::MakeInstanceGpu(Ref, Aff, 0u);
        MirrorInstances.push_back(G);

        TriangleFieldVulkanExchange::InstanceGpuHost H{};
        for (int A = 0; A < 4; ++A)
        {
            H.InverseRow0[A] = G.InverseRow0[A];
            H.InverseRow1[A] = G.InverseRow1[A];
            H.InverseRow2[A] = G.InverseRow2[A];
            H.FieldMin[A]    = G.FieldMin[A];
            H.FieldMax[A]    = G.FieldMax[A];
        }
        H.FieldOffset = G.FieldOffset;
        DeviceInstances.push_back(H);
    }

    const float Eye[3] = { 24.0f, 0.0f, 1.0f };
    const TriangleField::ClipLevel Level = TriangleField::MakeClipLevel(Eye, 0.15f, N);
    const uint32_t Lo[3] = { 10, 12, 12 }, Hi[3] = { 20, 20, 20 };

    TriangleFieldDeviceMirror::ClipMinimumParams MP{};
    MP.Origin = TriangleFieldDeviceMirror::F3(Level.Origin[0], Level.Origin[1], Level.Origin[2]);
    MP.Cell = Level.Cell;
    MP.Dim = N;
    for (int A = 0; A < 3; ++A) { MP.DirtyLo[A] = Lo[A]; MP.DirtyHi[A] = Hi[A]; }
    MP.InstanceCount = uint32_t(MirrorInstances.size());

    TriangleFieldVulkanExchange::ClipMinimumParamsHost DP{};
    for (int A = 0; A < 3; ++A) { DP.Origin[A] = Level.Origin[A]; DP.DirtyLo[A] = Lo[A]; DP.DirtyHi[A] = Hi[A]; }
    DP.Cell = Level.Cell;
    DP.Dim = N;
    DP.InstanceCount = uint32_t(DeviceInstances.size());

    const size_t Total = size_t(N) * N * N;
    const float Sentinel = -999.0f;
    std::vector<float> ClipCpu(Total, Sentinel), ClipGpu(Total, Sentinel);
    const uint64_t MirrorWritten = TriangleFieldDeviceMirror::ClipMinimumDirty(MP, MirrorInstances, Ref.Distance, ClipCpu);

    double CompSeconds = 0.0;
    const bool CompRan = K.ClipMinimum(DP, DeviceInstances, Ref.Distance, ClipGpu, CompSeconds, Error);
    Check(CompRan, "GPU composite dispatch completed", Error);

    size_t GpuTouched = 0u, CpuTouched = 0u;
    double CompDiff = 0.0;
    for (size_t I = 0; I < Total; ++I)
    {
        if (ClipGpu[I] != Sentinel) ++GpuTouched;
        if (ClipCpu[I] != Sentinel) ++CpuTouched;
        if (CompRan) CompDiff = std::max(CompDiff, std::fabs(double(ClipGpu[I]) - double(ClipCpu[I])));
    }
    const size_t Dirty = size_t(Hi[0] - Lo[0] + 1) * (Hi[1] - Lo[1] + 1) * (Hi[2] - Lo[2] + 1);
    std::snprintf(Detail, sizeof(Detail), "(GPU touched %zu, CPU mirror wrote %llu, dirty box %zu)", GpuTouched,
                  static_cast<unsigned long long>(MirrorWritten), Dirty);
    Check(CompRan && GpuTouched == Dirty && CpuTouched == Dirty, "GPU composite writes only the dirty box", Detail);

    std::snprintf(Detail, sizeof(Detail), "(max abs diff vs CPU mirror %.2e over the whole volume, submit-to-fence %.4f s)", CompDiff, CompSeconds);
    Check(CompRan && CompDiff <= 1e-3, "GPU composite matches the CPU exact mirror", Detail);

    K.Destroy();
    TriangleFieldVulkanExchange::DestroyContext(Ctx);
    std::printf("%s - %d failure(s)\n", Failures ? "RED" : "GREEN", Failures);
    return Failures ? 1 : 0;
}
