//=============================================================================================================================================
// SolidArcEditorHost.h
//=============================================================================================================================================
// ImGui editor shell for SolidArc. It seats the same Frontier outliner and viewport panels used by Project-Zero,
// with SolidArc-specific row mapping supplied by SolidArcOutlinerAdapter.

#pragma once

#include "SolidArcOutlinerAdapter.h"
#include "../../../../../Engine/Editor/ControlPanel.h"
#include "../../../../../Engine/Editor/InspectorPanel.h"
#include "../../../../../Engine/Editor/OutlinerPanel.h"
#include "../../../../../Engine/Editor/ViewportPanel.h"

#include <cstdint>

namespace Frontier {

class SolidArcEditorHost
{
public:
    SolidArcEditorHost() noexcept;

    void ApplyTheme() noexcept;
    void Record(ConsoleHost& Host) noexcept;

    // GPU builds supply the sampled render target; no full-frame CPU readback in Record().
    void AssignViewportTexture(ImTextureID Texture) noexcept { DeviceTexture_ = Texture; }
    [[nodiscard]] const RasterImage& QueryProofImage() const noexcept { return ViewImage_; }
    [[nodiscard]] bool QueryControlCentre(const char* Name, ImVec2& Centre) const noexcept;
    bool QueryOutlinerFigureCentre(uint32_t Id,ImVec2& P) const noexcept {for(uint32_t I=0;I<RowCount_;++I)if(Bindings_[I].RowRole==SolidArcOutlinerBinding::Role::Figure&&Bindings_[I].FigureIdentity==Id)return Outliner_.QueryRowCentre(I,P);return false;}
    [[nodiscard]] ImVec2 QueryConstructCentre() const noexcept { return Viewport_.QueryConstructCentre(); }
    [[nodiscard]] ImVec2 QueryViewOrigin() const noexcept { return Viewport_.QueryViewOrigin(); }
    [[nodiscard]] uint32_t QueryPickedFigureIdentity() const noexcept;
    [[nodiscard]] float    QueryViewWidth() const noexcept { return Viewport_.QueryViewWidth(); }
    [[nodiscard]] float    QueryViewHeight() const noexcept { return Viewport_.QueryViewHeight(); }

private:
    void ConstructLayout() noexcept;
    void RecordWorkspaceChrome(ConsoleHost& Host) noexcept;
    void RecordEmptyInspector(ConsoleHost& Host) noexcept;
    void RecordCadInspector(ConsoleHost& Host,uint32_t Identity) noexcept;
    uint32_t InspectorIdentity_=0;
    float ExtrudeDistance_=1;
    uint32_t ExtrudeMode_=0;
    int InspectorTab_=0;
    char InspectorName_[65]={};
    float Move_[3]={},Rotate_[3]={},Scale_[3]={1,1,1};
    float UniformScale_=1;
    bool ViewDimensions_=false;
    void TrackControl(const char* Name) noexcept;
    struct ControlBounds { std::string Name; ImVec2 Min, Max; };
    std::vector<ControlBounds> VisibleControls_;
    bool NewRequested_ = false, ConstructRequested_ = false;
    int ConstructSection_ = 1;
    char DocumentFile_[512] = "_AgentScratch/Documents/Untitled.arc";
    char NativeCommand_[1024] = {};
    char LoftProfiles_[128] = {};
    float SolidifyThickness_=.1f, PipeRadius_=.1f, RevolveAngle_=360.f;
    std::string FileNotice_;
    char BevelInput_[64]={};
    bool BevelPinned_=false,BevelTyping_=false,BevelReanchor_=false;
    double BevelPointerValue_=0,BevelUnitsPerPixel_=.01;
    void StartBevelEditor(ConsoleHost& Host,bool Chamfer=false,uint32_t Owner=0,uint32_t Feature=0) noexcept;
    void RecordBevelEditor(ConsoleHost& Host) noexcept;
    int SketchTool_=0;
    bool SketchPressed_=false,SketchMoved_=false;
    ImVec2 SketchPress_;
    void RecordSketchToolbar(ConsoleHost& Host) noexcept;
    void AdvanceInput(ConsoleHost& Host) noexcept;
    void RecordWorkflow(ConsoleHost& Host) noexcept;
    bool RecoveryInitialized_ = false, Welcome_ = false;
    uint64_t RecoveryFingerprint_ = 0;
    double RecoveryChangedAt_ = 0;
    bool RecoveryPending_ = false;
    std::string RecoveryError_;

    ControlPanel Controls_;
    std::vector<uint32_t> LastSelectionOrder_;
    OutlinerPanel Outliner_;
    ViewportPanel Viewport_;
    InspectorPanel Inspector_;

    bool OutlinerTabOpen_ = true;
    bool ViewportTabOpen_ = true;
    bool InspectorTabOpen_ = true;
    ImGuiID LeftColumn_   = 0u;
    ImGuiID CentreColumn_ = 0u;
    ImGuiID RightColumn_  = 0u;
    bool LayoutSeated_    = false;

    std::vector<EditorInstance> Rows_{kMaxEditorInstances};
    std::vector<SolidArcOutlinerBinding> Bindings_{kMaxEditorInstances};
    uint32_t RowCount_ = 0u;
    EditorReadout Readout_ = {};
    EditorSheet PickedSheet_ = {};
    RasterImage ViewImage_ = {};
    ImTextureID DeviceTexture_ = 0;
    uint32_t LastModelSelection_ = 0;
    bool CameraSeated_ = false;
    uint32_t OrbitRevision_ = 0;
    bool PointerCaptured_ = false;
    bool RightWasTool_ = false;
    int NavigationButton_ = -1;
};

} // namespace Frontier
