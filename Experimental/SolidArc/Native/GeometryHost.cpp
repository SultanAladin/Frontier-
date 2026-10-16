//============================================================================================================================================
//                                                             GEOMETRYHOST.CPP
//============================================================================================================================================
// 📦 Development transport for the same native document functions exported to WebAssembly; returns vertex commands, not pixels.

#include "Console/ConsoleHost.h"
#include <nlohmann/json.hpp>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <algorithm>
#include <string>
#include <random>

extern "C"
{
int CreateDocument();
int ActivateDocument(int);
void ReleaseDocument(int);
int ExecuteCommand(const char*);
int SketchEditDocument(int,double,double,double);
const char* SketchEditStatusDocument();
const char* DescribeDocument();
const char* RenderCommands(int, int);
void ResolveIntersection(unsigned int, unsigned int, unsigned int);
void ResolveIntersectionRuns(const char*);
int AssignCameraDocument(double, double, double, double, double, double, double);
void OrbitDocument(double, double);
void OrbitTurntableDocument(double, double);
void PanDocument(double, double, double);
void ZoomDocument(double);
void SeatDocument(int, int, double);
int AimGizmoDocument(double, double);
int BeginGizmoDocument(double, double);
int DragGizmoDocument(double, double, int);
int FinishGizmoDocument(int);
int PickDocument(double, double, int);
}

namespace
{
using Json = nlohmann::json;
struct PointerSequence
{
    bool Active = false;
    bool Gizmo = false;
    bool Pan = false;
    bool Orbit = false;
    bool Extend = false;
    bool Moved = false;
    int Button = 0;
    double X = 0, Y = 0, OriginX = 0, OriginY = 0;
};
PointerSequence Gesture;

void PersistSelection()
{
    const Json Selection = Json::parse(DescribeDocument());
    ExecuteCommand("select none");
    auto Figures=Selection.at("figures").get<std::vector<Json>>();
    std::stable_sort(Figures.begin(),Figures.end(),[](const Json& A,const Json& B){return A.value("selectionOrder",uint64_t(0))<B.value("selectionOrder",uint64_t(0));});
    for (const auto& Figure : Figures)
    {
        const auto Identity = std::to_string(Figure.at("id").get<int>());
        if (Figure.at("selected").get<int>()) ExecuteCommand(("select " + Identity + " --add").c_str());
        for (const auto& Pair : {std::pair{"pickedFaces", "faces"}, {"pickedEdges", "edges"}, {"pickedPoles", "poles"}})
        {
            if (Figure.at(Pair.first).empty()) continue;
            std::string Command = "select " + std::string(Pair.second) + " " + Identity;
            for (const auto& Index : Figure.at(Pair.first)) Command += " " + std::to_string(Index.get<int>());
            ExecuteCommand((Command + " --add").c_str());
        }
    }
    for (const auto& Area : Selection.at("areas"))
        if (Area.at("selected").get<int>()) ExecuteCommand(("select a" + std::to_string(Area.at("id").get<int>()) + " --add").c_str());
}

void MovePointer(const Json& Request, int Width, int Height)
{
    if (!Gesture.Active) return;
    const double X = Request.value("cx", 0.0), Y = Request.value("cy", 0.0);
    if (Gesture.Gizmo)
    {
        DragGizmoDocument(Request.value("u", 0.0) * Width, Request.value("v", 0.0) * Height, Request.value("snap", false));
        return;
    }
    if (std::hypot(X - Gesture.OriginX, Y - Gesture.OriginY) > 4) Gesture.Moved = true;
    if (!Gesture.Moved) return;
    if (Gesture.Pan) PanDocument(X - Gesture.X, Gesture.Y - Y, Request.value("cssHeight", double(Height)));
    else if(Gesture.Button==2) OrbitTurntableDocument(-(X-Gesture.X)*.006,(Y-Gesture.Y)*.006);
    else OrbitDocument(-(X - Gesture.X) * 0.006, (Y - Gesture.Y) * 0.006);
    Gesture.X = X;
    Gesture.Y = Y;
}

extern "C" int BevelDocument(int,double,bool,uint32_t,uint32_t);

// Separate browser sessions are separate processes. Fixed import/export paths
// let an autosave or concurrent open overwrite another session's journal.
std::string ExchangeFile(const char* Name)
{
    static const std::filesystem::path Directory=[] {
        std::random_device Random;
        for(;;){
            auto Path=std::filesystem::path("_AgentScratch/tmp")/("NativeExchange-"+std::to_string(Random())+"-"+std::to_string(Random()));
            if(std::filesystem::create_directory(Path))return Path;
        }
    }();
    return (Directory/Name).string();
}

Json Respond(const Json& Request)
{
    const std::string Action = Request.value("action", "render");
    const int Width = std::clamp(Request.value("width", 800), 64, 4096);
    const int Height = std::clamp(Request.value("height", 600), 64, 4096);
    if (Request.value("identity", 0) && !ActivateDocument(Request.at("identity")))
        throw std::runtime_error("Unknown native document identity");
    if (Action == "create") CreateDocument();
    if (Request.contains("camera"))
    {
        const auto& Camera = Request.at("camera");
        const auto& Pivot = Camera.at("pivot");
        if (!AssignCameraDocument(Camera.at("yaw"), Camera.at("pitch"), Camera.at("distance"), Pivot.at(0), Pivot.at(1), Pivot.at(2), Camera.value("roll",0.0)))
            throw std::runtime_error("Invalid camera state");
    }
    if (Action == "snapshot")
    {
        // Autosave is not a viewport operation: no seating, tessellation, draw packet or GPU refresh.
        const std::string Path = ExchangeFile("Recovery.arc");
        const bool Saved = ExecuteCommand(("save " + Path).c_str());
        std::ifstream Stream(Path);
        const std::string Text(std::istreambuf_iterator<char>(Stream), {});
        std::filesystem::remove(Path);
        return {{"success", Saved}, {"file", Saved ? Json(Text) : Json(nullptr)}};
    }
    SeatDocument(Width, Height, Request.value("scale", 1.0));
    const double PickX = Request.contains("u") ? Request.at("u").get<double>() * Width : Request.value("x", -1.0);
    const double PickY = Request.contains("v") ? Request.at("v").get<double>() * Height : Request.value("y", -1.0);
    ResolveIntersection(Request.value("intersection", 0u), uint32_t(std::max(PickX, 0.0)), uint32_t(std::max(PickY, 0.0)));
    if (Request.contains("intersectionRuns")) ResolveIntersectionRuns(Request.at("intersectionRuns").get<std::string>().c_str());
    bool Success = true, Dirty = false;
    Json File = nullptr;
    if (Action == "pointerStart")
    {
        Gesture = {};
        Gesture.Active = true;
        Gesture.Button = Request.value("button", 0);
        Gesture.Orbit = Request.value("orbit", false);
        Gesture.Pan = Gesture.Button == 1 || Request.value("pan", false) || (Gesture.Button==2 && Request.value("extend",false));
        Gesture.Extend = Request.value("extend", false);
        Gesture.X = Gesture.OriginX = Request.value("cx", 0.0);
        Gesture.Y = Gesture.OriginY = Request.value("cy", 0.0);
        Gesture.Gizmo = Gesture.Button == 0 && !Gesture.Orbit && BeginGizmoDocument(Request.value("u", 0.0) * Width, Request.value("v", 0.0) * Height);
    }
    else if (Action == "pointerMove") MovePointer(Request, Width, Height);
    else if (Action == "pointerEnd" && Gesture.Active)
    {
        const bool Cancel = Request.value("cancel", false);
        if (!Cancel) MovePointer(Request, Width, Height);
        if (Gesture.Gizmo)
        {
            Success = FinishGizmoDocument(Cancel);
            Dirty = !Cancel;
            ExecuteCommand("dim auto");
        }
        else if (!Cancel && !Gesture.Moved && Gesture.Button == 0 && !Gesture.Orbit)
        {
            PickDocument(Request.value("u", 0.0) * Width, Request.value("v", 0.0) * Height, Gesture.Extend);
            PersistSelection();
        }
        Gesture = {};
    }
    else if (Action == "hover" && !Gesture.Active) AimGizmoDocument(Request.value("u", 0.0) * Width, Request.value("v", 0.0) * Height);
    else if (Action == "turntable") OrbitTurntableDocument(Request.value("x",0.0),Request.value("y",0.0));
    else if (Action == "orbit") OrbitDocument(Request.value("x", 0.0), Request.value("y", 0.0));
    else if (Action == "pan") PanDocument(Request.value("x", 0.0), Request.value("y", 0.0), Height);
    else if (Action == "zoom" && !Gesture.Gizmo) ZoomDocument(Request.value("steps", 0.0));
    else if (Action == "pick")
    {
        PickDocument(Request.value("x", 0.0), Request.value("y", 0.0), Request.value("extend", false));
        PersistSelection();
    }
    else if(Action=="bevel") {
        const int Operation=Request.value("operation",0);
        Success=BevelDocument(Operation,Request.value("size",.1),Request.value("chamfer",false),Request.value("owner",0u),Request.value("feature",0u));
        Dirty=Success&&Operation==2;
        if(Dirty)ExecuteCommand("dim auto");
    }
    else if(Action=="sketchEdit") {
        const std::string Tool=Request.value("tool","");
        Success=(Tool=="cut"||Tool=="trim") && SketchEditDocument(Tool=="trim",Request.value("u",-1.),Request.value("v",-1.),10*Request.value("scale",1.));
        Dirty=Success;
    }
    else if (Action == "command")
    {
        for (const auto& Command : Request.at("commands"))
            if (!ExecuteCommand(Command.get<std::string>().c_str())) { Success = false; break; }
    }
    else if (Action == "open")
    {
        const auto Path = ExchangeFile("Import.arc");
        { std::ofstream Stream(Path); Stream << Request.at("text").get<std::string>(); }
        Success = ExecuteCommand((std::string("open ") + Path).c_str());
        std::filesystem::remove(Path);
    }
    else if (Action == "save" || Action == "export")
    {
        const std::string Path = ExchangeFile(Action == "save" ? "Export.arc" : "Export.obj");
        Success = ExecuteCommand(((Action == "save" ? "save " : "export ") + Path).c_str());
        std::ifstream Stream(Path);
        File = std::string(std::istreambuf_iterator<char>(Stream), {});
        std::filesystem::remove(Path);
    }
    if (Action == "command" || Action == "open" || Action == "sketchEdit") ExecuteCommand("dim auto");
    if (Action == "close")
    {
        ReleaseDocument(Request.at("closeIdentity"));
        if (Request.value("identity", 0)) ActivateDocument(Request.at("identity"));
    }
    const Json Frame = Json::parse(RenderCommands(Width, Height));
    return {{"token", Request.value("token", 0)}, {"success", Success}, {"dirty", Dirty},
        {"notice",Action=="sketchEdit"?SketchEditStatusDocument():""},
        {"interaction", Gesture.Gizmo ? "gizmo" : Gesture.Pan ? "pan" : Gesture.Active ? "orbit" : ""},
        {"description", Json::parse(DescribeDocument())}, {"width", Width}, {"height", Height},
        {"frame", Frame}, {"file", File}, {"lines", Json::array()}, {"transport", "native-cpp-command-stream"}};
}
}

int main()
{
    std::filesystem::create_directories("_AgentScratch/tmp");
    std::string Line;
    while (std::getline(std::cin, Line))
    {
        Json Response;
        try { Response = Respond(Json::parse(Line)); }
        catch (const std::exception& Error) { Response = {{"error", Error.what()}}; }
        std::cout << "SOLIDARC_PACKET " << Response.dump() << std::endl;
    }
}
