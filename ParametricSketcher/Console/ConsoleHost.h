//============================================================================================================================================
// 📦 ParametricSketcher/Console/ConsoleHost.h — The SolidArc console: command dispatch over a SceneDocument, camera and raster
//============================================================================================================================================
// Every command prints what it did as a table row; `render <file>` writes Proofs/<file>.png through the RasterExchange.
//    The same host runs `.arc` scripts (line by line, halting on the first refusal unless --continue) and a REPL.
#pragma once

#include "CommandCodec.h"
#include "Document/SceneDocument.h"
#include "Interaction/CameraProjection.h"
#include "Interaction/ToolSession.h"
#include "Interaction/TransformGizmo.h"
#include "Presentation/SoftwareRaster.h"
#include <cstdio>
#include <functional>
#include <map>
#include <memory>

namespace Frontier
{

class ConsoleHost
{
public:
    explicit ConsoleHost(std::string ProofDirectory, uint32_t Width = 1280, uint32_t Height = 800) noexcept;

    // Returns false on refusal; the reason is printed. Multiple commands per line are allowed.
    bool Execute(std::string_view Line) noexcept;
    bool RunScript(const std::string& Path, bool ContinueOnRefusal) noexcept;
    int  RunInteractive(std::FILE* In) noexcept;

    [[nodiscard]] SceneDocument&    Document() noexcept { return Scene; }
    [[nodiscard]] CameraProjection& Camera() noexcept { return View; }
    [[nodiscard]] int               RefusalCount() const noexcept { return Refusals; }
    [[nodiscard]] const TransformGizmo& Gizmo() const noexcept { return GizmoState; }

    // Renders the current document into the raster (no file); public so verification can probe pixels.
    void Render() noexcept;
    [[nodiscard]] const RasterExchange& Raster() const noexcept { return *Surface; }

private:
    using Command = std::function<bool(const CommandLine&)>;
    void Register() noexcept;
    bool Refuse(const char* Format, ...) noexcept;
    void Row(const char* Format, ...) noexcept;
    void DescribeItem(const SceneItem& Item) noexcept;
    bool AddCurve(const CommandLine& C, const char* Stem, Deliver<NurbsCurve> Result) noexcept;
    bool AddSurface(const CommandLine& C, const char* Stem, Deliver<NurbsSurface> Result) noexcept;
    [[nodiscard]] SceneItem* Resolve(const std::string& Token) noexcept;
    [[nodiscard]] std::vector<SceneItem*> ResolveMany(const CommandLine& C, size_t FirstIndex) noexcept;
    [[nodiscard]] Workplane ActivePlane() const noexcept { return Plane; }

    void RegisterInteraction() noexcept;                                                // Phase 3 commands
    void DrawToolPreview() noexcept;
    bool Dispatch(const InputEvent& Event) noexcept;                                    // tool first, then hotkey chart
    void OnToolOutcome(const ToolOutcome& Outcome) noexcept;
    [[nodiscard]] ToolSession::Context ToolContext() const noexcept;

    std::string                          Proofs;
    ToolSession                          Tool;
    TransformGizmo                       GizmoState;
    bool                                 GizmoShown = true;                             // [-] drawn whenever a selection exists
    std::vector<std::pair<uint32_t, SceneItem>> GizmoOriginals;                         // [-] items as they were when the drag began
    void RefreshGizmoFrame() noexcept;
    void ApplyGizmoDelta(const Mat4& Delta) noexcept;
    SnapSettings                         Snap;
    HotkeyChart                          Hotkeys = HotkeyChart::Defaults();
    double                               PointerX = 0.0, PointerY = 0.0;                // [px] synthetic pointer
    std::string                          LastCommand;                                   // [-] for Shift+R
    bool                                 ToolReportedRefusal = false;
    SceneDocument                        Scene;
    CameraProjection                     View;
    Workplane                            Plane = Workplane::XY();
    std::unique_ptr<SoftwareRaster>      Surface;
    std::map<std::string, Command>       Commands;
    std::map<std::string, std::string>   Usage;
    int                                  Refusals = 0;
    int                                  LineNumber = 0;
    bool                                 ShowControlCages = false;
    bool                                 ShowIsoCurves = true;
    SurfaceShading                       Shading = SurfaceShading::Matcap;
};

} // namespace Frontier
