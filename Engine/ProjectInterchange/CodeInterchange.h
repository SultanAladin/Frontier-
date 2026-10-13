//============================================================================================================================================
//                                                      CODEINTERCHANGE.H
//============================================================================================================================================
// 📦 Loads one verified project code image and confines its C ABI lifetime to FrontierHost.

#pragma once

#include "ProjectInterchange.h"
#include "GeometryInterchange.h"
#include "SmokeTransportInterchange.h"
#include "DisplayInterchange.h"
#include "ProjectSpecification.h"

// Optional per-frame conclusion hook (exported by the project as "ProjectFrameConcludedInterchange"). Not part
//    of the fingerprinted FrontierProjectInterchange structure: older projects simply do not export it.
typedef void (FRONTIER_CODE_IMAGE_CALL* FrontierProjectFrameConcluded)(void* ProjectRecord);

#include <string>

namespace Frontier
{

/// 📦 Dynamic project code-image lifetime; the image remains resident until project records are retired.
class CodeInterchange
{
public:
    CodeInterchange() = default;
    ~CodeInterchange();

    CodeInterchange(const CodeInterchange&) = delete;
    CodeInterchange& operator=(const CodeInterchange&) = delete;

    /// 📦 Opens and verifies an optional code image named by the resolved specification.
    [[nodiscard]] bool Construct(
        const ProjectSpecification& ResolvedSpecification,
        std::string& Refusal);

    /// 📦 Delivers project-opening readings to verified project code after the host owns its shared facilities.
    [[nodiscard]] bool ConstructProject(
        const ProjectSpecification& ResolvedSpecification,
        const FrontierProjectHostInterchange& HostInterchange,
        std::string& Refusal);

    /// 📦 Advances project simulation once while the shared renderer retains window and device ownership.
    [[nodiscard]] bool AdvanceProject(
        float ElapsedSeconds,
        float CycleSeconds,
        const FrontierProjectInputReading* InputReading,
        std::string& Refusal) const;

    /// 📦 Retires project-owned records before closing their code image.
    void Retire() noexcept;

    [[nodiscard]] bool HasGeometry() const noexcept { return GeometryEntry != nullptr; }
    uint32_t ProjectGeometry(FrontierProjectGeometryReading& Reading) const
    { return GeometryEntry ? GeometryEntry(ProjectRecord, &Reading) : 0u; }

    [[nodiscard]] bool SmokeAvailable() const noexcept { return SmokeEntry != nullptr; }
    uint32_t ProjectSmoke(FrontierProjectSmokeReading& Reading) const
    { return SmokeEntry ? SmokeEntry(ProjectRecord, &Reading) : 0u; }

    [[nodiscard]] bool DisplayAvailable() const noexcept { return DisplayEntry != nullptr; }
    uint32_t ProjectDisplay(FrontierProjectDisplayReading& Reading) const
    { return DisplayEntry ? DisplayEntry(ProjectRecord, &Reading) : 0u; }

    // Optional: the host has finished every per-frame query (geometry, smoke, display) and is about to render.
    //    A project that steps physics on a worker launches the next frame's job here, so the work overlaps the
    //    host's GPU wait instead of sitting inside AdvanceProject on the render thread.
    [[nodiscard]] bool FrameConclusionAvailable() const noexcept { return FrameConcludedEntry != nullptr; }
    void ConcludeFrame() const noexcept
    { if (FrameConcludedEntry && ProjectRecord) FrameConcludedEntry(ProjectRecord); }

    bool TransportAvailable() const noexcept { return TransportEntry != nullptr; }
    uint32_t ProjectTransport(FrontierSmokeTransportReading& Reading) const
    { return TransportEntry ? TransportEntry(ProjectRecord, &Reading) : 0u; }

    [[nodiscard]] bool CodeImageOpen() const noexcept;

private:
    FrontierProjectSmokeTransport TransportEntry = nullptr;
    FrontierProjectFrameConcluded FrameConcludedEntry = nullptr;
    FrontierProjectSmoke      SmokeEntry = nullptr;
    FrontierProjectGeometry   GeometryEntry = nullptr;
    FrontierProjectDisplay    DisplayEntry = nullptr;
    void*                     CodeImage = nullptr;
    FrontierProjectInterchange ActiveInterchange{};
    void*                     ProjectRecord = nullptr;
};

} // namespace Frontier
