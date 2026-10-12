//============================================================================================================================================
//                                                        RESERVOIRINTEGRATOR.H
//============================================================================================================================================
// 📦 Headless CPU ReSTIR DI reference over engine geometry: temporal/spatial reservoir reuse and OpenPBR shader evaluation.
//    A correctness exhibit, not a replacement for Vulkan, GPU scheduling, denoising or the GPU GI reservoir pipeline.
#pragma once

#include "../ContentInterchange/MaterialIndex.h"
#include "../DeviceExchange/OrientationClassifier.h"
#include <span>
#include <vector>

namespace Frontier
{
struct TriangleIndex;
struct ReservoirSpecification
{
    uint32_t Width       = 512u;
    uint32_t Height      = 512u;
    uint32_t Frames      = 16u;
    uint32_t Candidates  = 8u;
    uint32_t Threads     = 8u;
    Vector3  Eye          = {-7.41f, 8.96f, 3.2f};
    Vector3  Target       = {0.0f, 0.0f, 0.94f};
    Vector3  SunDirection = {-0.61f, -0.73f, 0.31f};
    float    SunIntensity = 2.5f;
    float    FieldOfView  = 48.0f;
};

struct ReservoirMetrics
{
    uint64_t TemporalReuses = 0u;
    uint64_t SpatialReuses  = 0u;
    uint64_t InvalidSamples = 0u;
    double   MeanRadiance   = 0.0;
};

class ReservoirIntegrator
{
public:
    // Geometry/material ownership remains with the caller; no project dependency, window, input or scene author here.
    [[nodiscard]] static ReservoirMetrics Render(
        std::span<const TriangleIndex>        Triangles,
        std::span<const Vector3>              CornerNormals,
        std::span<const MaterialDescriptor>   Materials,
        const ReservoirSpecification&        Settings,
        std::vector<unsigned char>&           Rgb);
};
}
