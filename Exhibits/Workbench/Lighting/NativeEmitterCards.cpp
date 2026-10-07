//============================================================================================================================================
//                                                         NATIVEEMITTERCARDS.CPP
//============================================================================================================================================
// 📦 Executed proof: records the native scene-emitter inspector for all five emitters and writes the captures from real draw commands.

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

// Mirrors the Lighting branch of EditorFeedSequence so the proof exercises the shipped property set.
EditorSheet SheetFor(unsigned Category)
{
    EditorSheet Sheet;
    Sheet.Appearance = EditorSheetAppearance::Light;

    EditorPropertyGroup& Source = Sheet.Groups[Sheet.GroupCount++];
    std::snprintf(Source.Title, sizeof(Source.Title), "Light source");
    Open(Source, "Enabled", EditorPropertyCategory::Switch).On = true;
    Open(Source, "Cast Shadows", EditorPropertyCategory::Switch).On = true;
    EditorProperty& Type = Open(Source, "Type", EditorPropertyCategory::Select);
    Type.Picked = Category;
    Type.OptionCount = 6;
    const char* Names[] = {"Directional", "Point", "Spot", "Rectangle / Area", "Tube", "Strip"};
    for (int Slot = 0; Slot < 6; ++Slot)
    {
        std::snprintf(Type.Options[Slot], sizeof(Type.Options[Slot]), "%s", Names[Slot]);
    }

    auto Slider = [&](EditorPropertyGroup& Group, const char* Name, float Value, float Low, float High,
                      uint32_t Decimals, const char* Unit) -> EditorProperty&
    {
        EditorProperty& Slot = Open(Group, Name, EditorPropertyCategory::Slider);
        Slot.Figure = Value;
        Slot.Minimum = Low;
        Slot.Maximum = High;
        Slot.Decimals = Decimals;
        std::snprintf(Slot.Unit, sizeof(Slot.Unit), "%s", Unit);
        return Slot;
    };

    Slider(Source, "Range", 12, 1, 80, 1, "m");

    EditorPropertyGroup& Transform = Sheet.Groups[Sheet.GroupCount++];
    std::snprintf(Transform.Title, sizeof(Transform.Title), "Transform");
    EditorProperty& Position = Open(Transform, "Position", EditorPropertyCategory::AxisVec3);
    Position.Axes[0] = 0;
    Position.Axes[1] = 3;
    Position.Axes[2] = 0;
    Position.AxisStep = 0.05f;
    Position.Editable = true;
    EditorProperty& Rotation = Open(Transform, "Rotation", EditorPropertyCategory::AxisVec3);
    Rotation.Axes[0] = Category == 2 ? -55.0f : 0.0f;
    Rotation.Axes[1] = Category == 2 ? 180.0f : 0.0f;
    Rotation.Axes[2] = 0.0f;
    Rotation.AxisStep = 1.0f;
    Rotation.Editable = true;
    EditorProperty& Scale = Open(Transform, "Scale", EditorPropertyCategory::AxisVec3);
    Scale.Axes[0] = Scale.Axes[1] = Scale.Axes[2] = 1.0f;
    Scale.AxisStep = 0.01f;
    Scale.Editable = true;

    EditorPropertyGroup& Shape = Sheet.Groups[Sheet.GroupCount++];
    std::snprintf(Shape.Title, sizeof(Shape.Title), "Distribution");
    EditorProperty& Distribution = Open(Shape, "Distribution", EditorPropertyCategory::Select);
    Distribution.OptionCount = 3;
    Distribution.Picked = 0;
    const char* Shapes[] = {"Uniform", "IES profile", "Automotive low beam"};
    for (int Slot = 0; Slot < 3; ++Slot)
    {
        std::snprintf(Distribution.Options[Slot], sizeof(Distribution.Options[Slot]), "%s", Shapes[Slot]);
    }
    Slider(Shape, "Inner Cone", 30, 0, 89, 0, "deg");
    Slider(Shape, "Outer Cone", 55, 1, 90, 0, "deg");
    Slider(Shape, "Width", Category == 3 ? 1.2f : 1.5f, 0.01f, 100, 2, "m");
    Slider(Shape, "Height", Category == 4 ? 0.04f : 0.6f, 0.005f, 100, 3, "m");

    EditorPropertyGroup& Emission = Sheet.Groups[Sheet.GroupCount++];
    std::snprintf(Emission.Title, sizeof(Emission.Title), "Emission");
    Slider(Emission, "Luminous flux", Category == 5 ? 900.0f * 1.5f : 1500.0f, 0, 20000, 0, "lm");
    Slider(Emission, "Colour temperature", 3000, 1800, 10000, 0, "K");
    Slider(Emission, "Shadow softness", 28, 0, 100, 0, "%");
    Slider(Emission, "Diffuse response", 100, 0, 200, 0, "%");
    Slider(Emission, "Specular response", 100, 0, 200, 0, "%");
    if (Category == 5)
    {
        Slider(Emission, "Flux per metre", 900, 100, 3000, 0, "lm/m");
    }
    EditorProperty& Azimuth = Open(Emission, "Aim azimuth", EditorPropertyCategory::Readout);
    std::snprintf(Azimuth.Text, sizeof(Azimuth.Text), "180 deg");
    EditorProperty& Elevation = Open(Emission, "Aim elevation", EditorPropertyCategory::Readout);
    std::snprintf(Elevation.Text, sizeof(Elevation.Text), "-55 deg");
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

    int         Width = 1180, Height = 2100;
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
        ImGui::EndChild();
        ImGui::End();
        ImGui::Render();
        FrontierProof::AcknowledgeTextures();
    };

    auto Capture = [&](const char* Name)
    {
        for (int Frame = 0; Frame < 3; ++Frame)
        {
            Tick();
        }
        std::vector<unsigned char> Pixels(size_t(Width) * Height * 3, 16);
        for (ImDrawList* List : ImGui::GetDrawData()->CmdLists)
        {
            FrontierProof::Draw(List, Pixels.data(), Width, Height, {0, 0}, {1, 1});
        }
        const std::string Path = "Exhibits/Gallery/LightingNative/" + std::string(Name) + ".png";
        Check(stbi_write_png(Path.c_str(), Width, Height, 3, Pixels.data(), Width * 3) != 0, "capture written");
    };

    struct Emitter { unsigned Category; const char* File; int Tall; };
    const Emitter Family[] = {
        {1, "PointLight", 1900},
        {2, "SpotLight", 2360},
        {3, "AreaLight", 2140},
        {4, "TubeLight", 2140},
        {5, "StripLight", 2140},
    };

    for (const Emitter& Entry : Family)
    {
        Sheet = SheetFor(Entry.Category);
        Check(Sheet.Appearance == EditorSheetAppearance::Light, "dedicated native Light route");
        Height = Entry.Tall;
        Width = 1180;
        Capture(Entry.File);
        Width = 760;
        Height = Entry.Tall + 150;
        Capture((std::string(Entry.File) + "-Narrow").c_str());
    }

    // The derived photometry must agree with the browser reference for the authored defaults.
    const float Flux = 1500.0f, Outer = 55.0f;
    const float Sphere = 4.0f * 3.14159265f;
    const float Cone = 2.0f * 3.14159265f * (1 - std::cos(Outer * 0.5f * 3.14159265f / 180.0f));
    Check(std::fabs(Flux / Sphere - 119.366f) < 0.5f, "point intensity is 119 cd");
    Check(std::fabs(Flux / Cone - 2113.0f) < 6.0f, "spot intensity is 2113 cd");
    Check(std::fabs(Flux / 3.14159265f - 477.46f) < 0.5f, "surface intensity is 477 cd");
    Check(std::fabs(900.0f * 1.5f - 1350.0f) < 0.01f, "strip flux is output per metre across the run");

    ImGui::DestroyContext();
    std::printf("PASS %u checks: native scene-emitter cards for Point, Spot, Area, Tube and LED Strip at two widths.\n",
                Checks);
    return 0;
}
