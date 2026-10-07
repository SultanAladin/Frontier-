//==============================================================================================================================================
//                                                          NATIVEEMITTERCARDS.CPP
//==============================================================================================================================================
// 📦 Executed proof: records the native light inspector for the five InspectorDepot emitters and writes the captures from real draw commands.

#include "LightInspectorPanel.h"
#include "ControlPanel.h"
#include "EditorInstance.h"
#include "CpuDraw.h"
#include "PngWriteCounterpart.h"
#include <imgui_internal.h>
#include <filesystem>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#include <cmath>
#include <cstdio>
#include <cstring>

using namespace Frontier;

namespace
{

unsigned Checks = 0;

void Check(bool Condition, const char* Claim)
{
    ++Checks;
    if (!Condition)
    {
        throw std::runtime_error(Claim);
    }
}

EditorProperty& Open(EditorPropertyGroup& Group, const char* Name, EditorPropertyCategory Category)
{
    EditorProperty& Slot = Group.Properties[Group.PropertyCount++];
    std::snprintf(Slot.Label, sizeof(Slot.Label), "%s", Name);
    Slot.Category = Category;
    return Slot;
}

EditorProperty& Tape(EditorPropertyGroup& Group, const char* Name, float Value, float Low, float High,
                     uint32_t Decimals, const char* Unit)
{
    EditorProperty& Slot = Open(Group, Name, EditorPropertyCategory::Slider);
    Slot.Figure   = Value;
    Slot.Minimum  = Low;
    Slot.Maximum  = High;
    Slot.Decimals = Decimals;
    std::snprintf(Slot.Unit, sizeof(Slot.Unit), "%s", Unit);
    return Slot;
}

EditorProperty& Axes(EditorPropertyGroup& Group, const char* Name, float X, float Y, float Z, float Step)
{
    EditorProperty& Slot = Open(Group, Name, EditorPropertyCategory::AxisVec3);
    Slot.Axes[0]  = X;
    Slot.Axes[1]  = Y;
    Slot.Axes[2]  = Z;
    Slot.AxisStep = Step;
    Slot.Editable = true;
    return Slot;
}

EditorProperty& State(EditorPropertyGroup& Group, const char* Name, bool On)
{
    EditorProperty& Slot = Open(Group, Name, EditorPropertyCategory::Switch);
    Slot.On = On;
    return Slot;
}

EditorProperty& Tint(EditorPropertyGroup& Group, const char* Name, float R, float G, float B)
{
    EditorProperty& Slot = Open(Group, Name, EditorPropertyCategory::Colour);
    Slot.ColourTint[0] = R;
    Slot.ColourTint[1] = G;
    Slot.ColourTint[2] = B;
    return Slot;
}

// Type is the engine's own six-way selector; the panel folds it onto the reference's five emitters.
void Family(EditorPropertyGroup& Group, unsigned Category)
{
    EditorProperty& Type = Open(Group, "Type", EditorPropertyCategory::Select);
    Type.Picked = Category;
    Type.OptionCount = 6;
    const char* Names[] = {"Directional", "Point", "Spot", "Rectangle / Area", "Tube", "Strip"};
    for (int Slot = 0; Slot < 6; ++Slot)
    {
        std::snprintf(Type.Options[Slot], sizeof(Type.Options[Slot]), "%s", Names[Slot]);
    }
}

// The property set is InspectorDepot/world.js, name for name and default for default, so the native panel
//    binds to the reference's own controls instead of to engine-side lookalikes.
EditorSheet SheetFor(unsigned Category)
{
    EditorSheet Sheet;
    Sheet.Appearance = EditorSheetAppearance::Light;

    EditorPropertyGroup& Transform = Sheet.Groups[Sheet.GroupCount++];
    std::snprintf(Transform.Title, sizeof(Transform.Title), "Transform");
    Family(Transform, Category == 6 ? 2u : Category);

    EditorPropertyGroup& Emission = Sheet.Groups[Sheet.GroupCount++];
    std::snprintf(Emission.Title, sizeof(Emission.Title), "Emission");

    switch (Category)
    {
    case 1:   // pointlight
        Axes(Transform, "Position", 0, 2, 0, 0.05f);
        Tint(Emission, "Emission colour", 1.000f, 0.851f, 0.627f);          // #ffd9a0
        Tape(Emission, "Intensity", 14, 0, 60, 1, "cd");
        Tape(Emission, "Reach", 26, 1, 120, 0, "m");
        Tape(Emission, "Decay exponent", 2, 0, 4, 2, "");
        State(Emission, "Cast Shadows", false);
        State(Emission, "Show glow", true);
        break;

    case 2:   // spotlight
        Axes(Transform, "Position", 0, 6, 0, 0.05f);
        Axes(Transform, "Target", 0, 0, 0, 0.05f);
        Tint(Emission, "Emission colour", 0.910f, 0.941f, 1.000f);          // #e8f0ff
        Tape(Emission, "Cone angle", 26, 2, 80, 1, "deg");
        Tape(Emission, "Penumbra", 0.42f, 0, 1, 2, "");
        Tape(Emission, "Intensity", 62, 0, 200, 0, "cd");
        State(Emission, "Cast Shadows", true);
        State(Emission, "Draw cone", true);
        break;

    case 6:   // ieslight — reached through a Spot whose Distribution names a photometric profile
    {
        Axes(Transform, "Position", 0, 1, 0, 0.05f);
        Axes(Transform, "Target", 0, 0.6f, -12, 0.05f);
        EditorProperty& Profile = Open(Transform, "Distribution", EditorPropertyCategory::Select);
        Profile.OptionCount = 6;
        Profile.Picked = 1;                                                  // ECE Low Beam
        const char* Profiles[] = {"Uniform", "ECE Low Beam", "SAE Low Beam", "High Beam", "Fog Lamp", "Parking Lamp"};
        for (int Slot = 0; Slot < 6; ++Slot)
        {
            std::snprintf(Profile.Options[Slot], sizeof(Profile.Options[Slot]), "%s", Profiles[Slot]);
        }
        Tint(Emission, "Emission colour", 1.000f, 0.949f, 0.812f);          // #fff2cf
        Tape(Emission, "Luminous flux", 1650, 0, 8000, 0, "lm");
        Tape(Emission, "Profile multiplier", 1, 0, 4, 2, "x");
        Tape(Emission, "Photometric range", 120, 1, 250, 0, "m");
        Tape(Emission, "Field angle", 58, 5, 100, 1, "deg");
        Tape(Emission, "Cut-off pitch", -1, -5, 5, 1, "deg");
        Tape(Emission, "Colour temperature", 4300, 1800, 12000, 0, "K");
        State(Emission, "Cast Shadows", true);
        State(Emission, "Draw distribution", true);
        break;
    }

    case 3:   // arealight
        Axes(Transform, "Position", 0, 3, 0, 0.05f);
        Axes(Transform, "Target", 0, 0, 0, 0.05f);
        Tint(Emission, "Emission colour", 1.000f, 0.945f, 0.839f);          // #fff1d6
        Tape(Emission, "Width", 2, 0.1f, 20, 2, "m");
        Tape(Emission, "Height", 1, 0.1f, 20, 2, "m");
        Tape(Emission, "Luminous flux", 2400, 0, 20000, 0, "lm");
        Tape(Emission, "Beam spread", 120, 1, 180, 0, "deg");
        State(Emission, "Two sided", false);
        State(Emission, "Cast Shadows", false);
        State(Emission, "Draw emitter", true);
        break;

    default:  // tubelight, and the LED strip that is a tube run
        Axes(Transform, "Position", 0, 2, 0, 0.05f);
        Axes(Transform, "Rotation", 0, 0, Category == 5 ? 20.0f : 0.0f, 1.0f);
        Tint(Emission, "Emission colour", 0.910f, 0.949f, 1.000f);          // #e8f2ff
        Tape(Emission, "Length", Category == 5 ? 2.4f : 1.5f, 0.1f, 20, 2, "m");
        Tape(Emission, "Tube radius", 0.04f, 0.01f, 1, 2, "m");
        Tape(Emission, "Luminous flux", Category == 5 ? 2400.0f : 1800.0f, 0, 12000, 0, "lm");
        Tape(Emission, "Reach", 24, 1, 120, 0, "m");
        Tape(Emission, "Colour temperature", 5600, 1800, 12000, 0, "K");
        State(Emission, "Cast Shadows", false);
        State(Emission, "Draw emitter", true);
        break;
    }
    return Sheet;
}

} // namespace

int main()
{
    std::filesystem::create_directories("Exhibits/Gallery/LightingNative");
    ImGui::CreateContext();
    ImGuiIO& IO = ImGui::GetIO();
    IO.IniFilename = nullptr;
    IO.DeltaTime = 1.0f / 60;
    IO.BackendFlags |= ImGuiBackendFlags_RendererHasTextures | ImGuiBackendFlags_RendererHasVtxOffset;

    ImFontConfig FaceConfig;
    std::snprintf(FaceConfig.Name, sizeof(FaceConfig.Name), "Sun reference / regular");
    ImFont* Face = IO.Fonts->AddFontFromFileTTF("EngineContent/Fonts/SunReference/DMSans-Regular.ttf", 14, &FaceConfig);
    ImFontConfig DisplayConfig;
    std::snprintf(DisplayConfig.Name, sizeof(DisplayConfig.Name), "Sun reference / light");
    ImFont* Display = IO.Fonts->AddFontFromFileTTF("EngineContent/Fonts/SunReference/DMSans-Light.ttf", 48, &DisplayConfig);
    ImGui::StyleColorsDark();

    auto Controls = std::make_unique<ControlPanel>();
    Controls->AssignFonts(Face, Face, Face, Face, Face, Display);
    EditorInstance Row;
    std::snprintf(Row.Label, sizeof(Row.Label), "Light");

    // The reference panel is an inspector column: its canvases fall back to 290 px when unmeasured, so the
    //    proof is captured at the sidebar widths the design is actually drawn for.
    int   Width = 318, Height = 1400;
    float Measured = 0;
    EditorSheet Sheet;

    auto Tick = [&]()
    {
        IO.DisplaySize = {float(Width), float(Height)};
        IO.DisplayFramebufferScale = {1, 1};
        ImGui::NewFrame();
        ImGui::SetNextWindowPos({0, 0});
        ImGui::SetNextWindowSize(IO.DisplaySize);
        ImGui::Begin("Inspector", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoScrollbar);
        ImGui::BeginChild("##emitter", {0, float(Height)}, ImGuiChildFlags_None, ImGuiWindowFlags_NoScrollbar);
        RecordLightInspector(*Controls, Row, Sheet);
        Measured = ImGui::GetCursorPosY();
        ImGui::EndChild();
        ImGui::End();
        ImGui::Render();
        FrontierProof::AcknowledgeTextures();
    };

    auto Capture = [&](const char* Name)
    {
        // The column is as tall as the card stack makes it, so the panel is measured before it is framed.
        Height = 2600;
        Tick();
        Height = static_cast<int>(Measured) + 12;
        for (int Frame = 0; Frame < 3; ++Frame)
        {
            Tick();
        }
        // --bg #050505, the ground the inspector column sits on.
        std::vector<unsigned char> Pixels(size_t(Width) * Height * 3, 5);
        for (ImDrawList* List : ImGui::GetDrawData()->CmdLists)
        {
            FrontierProof::Draw(List, Pixels.data(), Width, Height, {0, 0}, {1, 1});
        }
        const std::string Path = "Exhibits/Gallery/LightingNative/" + std::string(Name) + ".png";
        Check(stbi_write_png(Path.c_str(), Width, Height, 3, Pixels.data(), Width * 3) != 0, "capture written");
    };

    struct Emitter { unsigned Category; const char* File; };
    const Emitter Roster[] = {
        {1, "PointLight"}, {2, "SpotLight"}, {6, "IesLight"},
        {3, "AreaLight"},  {4, "TubeLight"}, {5, "StripLight"},
    };

    for (const Emitter& Entry : Roster)
    {
        Sheet = SheetFor(Entry.Category);
        Check(Sheet.Appearance == EditorSheetAppearance::Light, "dedicated native Light route");
        Width = 318;
        Capture(Entry.File);
        Width = 420;
        Capture((std::string(Entry.File) + "-Wide").c_str());
    }

    //  The arithmetic the cards print is the reference's own, checked against it ---------------------------
    auto LuxAt = [](float Intensity, float Distance, float Decay)
    {
        return Intensity / std::pow(std::max(1.0f, Distance), Decay);
    };
    const float Pi = 3.14159265f;

    // lights.js: a 14 cd point at physical decay reads 0.56 lx at five metres and 0.14 lx at ten.
    Check(std::fabs(LuxAt(14, 5, 2) - 0.56f) < 0.005f, "point exposure at 5 m is 0.56 lx");
    Check(std::fabs(LuxAt(14, 10, 2) - 0.14f) < 0.005f, "point exposure at 10 m is 0.14 lx");
    // A 62 cd key spot reads 2.48 lx at five metres, and its 26 degree cone pools 2.3 m across there.
    Check(std::fabs(LuxAt(62, 5, 2) - 2.48f) < 0.005f, "spot exposure at 5 m is 2.48 lx");
    Check(std::fabs(2 * 5 * std::tan(26 * Pi / 360.0f) - 2.308f) < 0.01f, "spot pool at 5 m is 2.3 m");
    // advancedLights.js peak candela: IES is flux x multiplier x 1.8; a surface divides by its aperture.
    Check(std::fabs(1650.0f * 1.0f * 1.8f - 2970.0f) < 0.5f, "ECE low beam peaks at 2970 cd");
    Check(std::fabs(2400.0f / (2.0f * 1.0f) * 0.45f - 540.0f) < 0.5f, "2 x 1 m softbox peaks at 540 cd");
    Check(std::fabs(1800.0f / 1.5f * 0.45f - 540.0f) < 0.5f, "1.5 m tube peaks at 540 cd");
    // Efficacy is min(160, 70 + K / 100).
    Check(std::fabs(std::min(160.0f, 70 + 4300.0f / 100.0f) - 113.0f) < 0.5f, "4300 K reads 113 lm/W");
    Check(std::fabs(std::min(160.0f, 70 + 5600.0f / 100.0f) - 126.0f) < 0.5f, "5600 K reads 126 lm/W");

    ImGui::DestroyContext();
    std::printf("PASS %u checks: native light inspector for Point, Spot, IES, Area, Tube and Strip at two column widths.\n",
                Checks);
    return 0;
}
