//============================================================================================================================================
//                                                  DRIVETYREDEFORMATIONPROOF.CPP
//============================================================================================================================================
// 📦 Option-B tyre deformation evidence on the actual Drive car. The real VehicleSolver (trace-fan contact, Pacejka,
//    thermal) drives the real ControlVehicle through three short clips; every sampled frame composes the SAME per-wheel
//    TyreDeformationRecord the Project-Drive DLL publishes (TyreDeformationPublisher.h) and bends the SAME wheel meshes
//    DriveSceneAuthor exports with the CPU port of Shaders/TyreDeformation.slang — one arithmetic, GPU and CPU.
//
//    Each frame is one PNG in three panels: RIGID (what the raster drew before), DEFORMED (what the vertex stage draws
//    now), and |DIFFERENCE| of the two (black = identical pixel) — same camera, same pose, same solver state. The car
//    wears a flat diagnostic palette (light-grey rubber, matte paint) so the silhouette change reads; it is the actual
//    ControlVehicle and the actual DriveSceneAuthor wheels, not a stand-in. A CSV per clip records load, deflection, patch length and
//    the measured lowest tread point so the pictures can be checked against numbers.
//
//    CPU flat raster (VisibilityRaster), no GI, no GPU. Not an appearance-parity claim; a geometry proof.

#include "../../../Engine/ContentInterchange/PngWriteCounterpart.h"
#include "../../../Engine/ContentInterchange/UnifiedMaterialEvaluation.h"
#include "../../../Engine/DisplayPresentation/ShadingTableCodec.h"
#include "../../../Engine/GeometricRaster/SceneStructure.h"
#include "../../../Engine/GeometricRaster/TyreDeformation.h"
#include "../../../Engine/GeometricRaster/VisibilityRaster.h"
#include "../../../Engine/PhysicalDynamics/Vehicle/TyreDeformationPublisher.h"
#include "../../../Projects/Project-Drive/Source/DriveSceneAuthor.h"
#include "DriveDynamicsFixture.h"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <string>
#include <vector>

namespace
{

using namespace DriveProof;
using V = Frontier::Vehicle::Vec3;
constexpr float    π          = 3.14159265359f;
constexpr uint32_t HalfWidth  = 448u;    // one half of the side-by-side frame
constexpr uint32_t FrameRows  = 448u;
constexpr uint32_t SampleHz   = 20u;
constexpr uint32_t WheelCount = 4u;

bool ReadFlat(const V& Point, V& Surface, V& Normal)
{
    Surface = {Point.x, Point.y, 0.0f};
    Normal  = {0.0f, 0.0f, 1.0f};
    return true;
}

// Four 35 mm sine² speed humps 1.2 m long from x = 4 m — the kind of bump a tyre swallows while the body barely moves.
float BumpHeight(float X)
{
    if (X < 4.0f || X > 8.8f) return 0.0f;
    const float Phase = std::sin(π * (X - 4.0f) / 1.2f);
    return 0.035f * Phase * Phase;
}
bool ReadBumps(const V& Point, V& Surface, V& Normal)
{
    const float Step = 0.005f;
    const float Slope = (BumpHeight(Point.x + Step) - BumpHeight(Point.x - Step)) / (2.0f * Step);
    Surface = {Point.x, Point.y, BumpHeight(Point.x)};
    Normal  = V{-Slope, 0.0f, 1.0f}.Normalized();
    return true;
}

struct Soup
{
    std::vector<Frontier::VertexRecord> Vertices;   // object-local, one span × one material
    std::vector<uint32_t>               Indices;
    uint32_t                            Material = 0u;
};

struct SpanSoups { std::vector<Soup> Parts; };

// Split the author's triangle soup into (span × material) parts exactly like DriveRenderProof::ConstructScene.
std::vector<SpanSoups> Partition(const Frontier::Drive::DriveSceneAuthor& Author)
{
    std::vector<SpanSoups> Spans;
    for (const auto& Span : Author.QuerySpans())
    {
        SpanSoups Soups;
        for (uint32_t Material = 0u; Material < Author.QueryMaterials().size(); ++Material)
        {
            Soup Part; Part.Material = Material;
            for (uint32_t Index = Span.FirstTriangle; Index < Span.FirstTriangle + Span.TriangleCount; ++Index)
            {
                const auto& Triangle = Author.QueryTriangles()[Index];
                uint32_t Slot; std::memcpy(&Slot, &Triangle.MaterialSlot, sizeof(Slot));
                if (Slot != Material) continue;
                const float* Points[3] = {&Triangle.VertexAlphaX, &Triangle.VertexBetaX, &Triangle.VertexGammaX};
                const float TextureU[3] = {Triangle.TextureAlphaU, Triangle.TextureBetaU, Triangle.TextureGammaU};
                const float TextureV[3] = {Triangle.TextureAlphaV, Triangle.TextureBetaV, Triangle.TextureGammaV};
                for (uint32_t Corner = 0u; Corner < 3u; ++Corner)
                {
                    Frontier::VertexRecord Vertex{};
                    Vertex.SpatialLocation    = {Points[Corner][0], Points[Corner][1], Points[Corner][2]};
                    Vertex.NormalDirection    = Author.QueryCornerNormals()[Index * 3u + Corner];
                    Vertex.TextureCoordinateU = TextureU[Corner];
                    Vertex.TextureCoordinateV = TextureV[Corner];
                    Vertex.TangentDirection   = {1.0f, 0.0f, 0.0f, 1.0f};
                    Part.Vertices.push_back(Vertex);
                    Part.Indices.push_back(static_cast<uint32_t>(Part.Indices.size()));
                }
            }
            if (!Part.Vertices.empty()) Soups.Parts.push_back(std::move(Part));
        }
        Spans.push_back(std::move(Soups));
    }
    return Spans;
}

// column-major T·R, the same layout VehicleInstanceSequence::ComposeTRS writes into InstanceRecord.World
void ComposeTRS(const V& T, const Frontier::Vehicle::Quat& R, float Out[16])
{
    const V X = R.Rotate({1.0f, 0.0f, 0.0f}), Y = R.Rotate({0.0f, 1.0f, 0.0f}), Z = R.Rotate({0.0f, 0.0f, 1.0f});
    const float M[16] = {X.x, X.y, X.z, 0.0f, Y.x, Y.y, Y.z, 0.0f, Z.x, Z.y, Z.z, 0.0f, T.x, T.y, T.z, 1.0f};
    std::memcpy(Out, M, sizeof(M));
}

V Apply(const float M[16], const V& P)
{
    return {M[0] * P.x + M[4] * P.y + M[8] * P.z + M[12],
            M[1] * P.x + M[5] * P.y + M[9] * P.z + M[13],
            M[2] * P.x + M[6] * P.y + M[10] * P.z + M[14]};
}

// Builds the scene for one frame: body + four wheels at their solver poses (world-baked vertices), optionally bent
//    with the frame's records, and the flat ground. Returns the lowest tread point per wheel for the CSV.
// Diagnostic palette: the authored materials with every slab flattened to a matte mid tone (rubber light grey, the
//    rest a little darker), so this is a shape proof rather than a dark-on-dark appearance shot.
std::vector<Frontier::MaterialDescriptor> DiagnosticPalette(const Frontier::Drive::DriveSceneAuthor& Author)
{
    std::vector<Frontier::MaterialDescriptor> Palette = Author.QueryMaterials();
    for (auto& Material : Palette)
    {
        const bool Rubber = Material.Name.find("Rubber") != std::string::npos || Material.Name.find("tyre") != std::string::npos;
        for (auto& Slab : Material.Slabs)
        {
            const float Tone = Rubber ? 0.62f : 0.30f;
            Slab.BaseColor[0] = Tone; Slab.BaseColor[1] = Tone * (Rubber ? 0.98f : 0.85f); Slab.BaseColor[2] = Tone * (Rubber ? 0.92f : 0.75f);
            Slab.BaseMetalness = 0.0f;
            Slab.SpecularRoughness = 0.8f;
        }
    }
    return Palette;
}

using GroundFunction = bool (*)(const V&, V&, V&);

void ConstructFrame(Frontier::SceneStructure& Scene, const std::vector<Frontier::MaterialDescriptor>& Palette,
                    const std::vector<SpanSoups>& Spans, const float Worlds[5][16],
                    const Frontier::TyreDeformationRecord* Records, float LowestTread[WheelCount], GroundFunction Ground3D)
{
    for (const auto& Material : Palette) Scene.RegisterMaterial(Material);
    Frontier::Matrix4x4 Identity{};
    for (uint32_t Axis = 0u; Axis < 4u; ++Axis) Identity.Columns[Axis][Axis] = 1.0f;
    for (uint32_t Wheel = 0u; Wheel < WheelCount; ++Wheel) LowestTread[Wheel] = 1.0e9f;
    for (uint32_t Span = 0u; Span < 5u && Span < Spans.size(); ++Span)
        for (const auto& Part : Spans[Span].Parts)
        {
            std::vector<Frontier::VertexRecord> Vertices = Part.Vertices;
            for (auto& Vertex : Vertices)
            {
                const V World = Apply(Worlds[Span], {Vertex.SpatialLocation.x, Vertex.SpatialLocation.y, Vertex.SpatialLocation.z});
                float Out[3] = {World.x, World.y, World.z};
                if (Span >= 1u && Records != nullptr)
                {
                    const float In[3] = {World.x, World.y, World.z};
                    Frontier::DeformTyreWorldPoint(Records[Span - 1u], In, Out);
                }
                if (Span >= 1u)
                {   // clearance above the traced road under this very vertex, so bumps are measured honestly
                    V Surface, Normal; Ground3D({Out[0], Out[1], Out[2]}, Surface, Normal);
                    LowestTread[Span - 1u] = std::min(LowestTread[Span - 1u], Frontier::Vehicle::Dot(V{Out[0], Out[1], Out[2]} - Surface, Normal));
                }
                Vertex.SpatialLocation = {Out[0], Out[1], Out[2]};
            }
            Frontier::GeometryStructure Geometry;
            Geometry.AppendVertices(Vertices.data(), Vertices.size());
            Geometry.AppendIndices(Part.Indices.data(), Part.Indices.size());
            Scene.RegisterInstance(Geometry, Identity, Part.Material, Frontier::InstanceFlagDoubleSided);
        }
    // the ground the solver traced, meshed from the same height function so the picture and the physics agree
    {
        Frontier::GeometryStructure Ground;
        const float X0 = -8.0f, X1 = 24.0f, Y0 = -8.0f, Y1 = 8.0f, Cell = 0.1f;
        const uint32_t Columns = static_cast<uint32_t>((X1 - X0) / Cell) + 1u, Rows = static_cast<uint32_t>((Y1 - Y0) / Cell) + 1u;
        std::vector<Frontier::VertexRecord> Vertices(Columns * Rows);
        for (uint32_t Row = 0u; Row < Rows; ++Row)
            for (uint32_t Column = 0u; Column < Columns; ++Column)
            {
                V Surface, Normal;
                Ground3D({X0 + Column * Cell, Y0 + Row * Cell, 0.0f}, Surface, Normal);
                auto& Vertex = Vertices[Row * Columns + Column];
                Vertex.SpatialLocation    = {Surface.x, Surface.y, Surface.z};
                Vertex.NormalDirection    = {Normal.x, Normal.y, Normal.z};
                Vertex.TextureCoordinateU = Surface.x; Vertex.TextureCoordinateV = Surface.y;
                Vertex.TangentDirection   = {1.0f, 0.0f, 0.0f, 1.0f};
            }
        std::vector<uint32_t> Indices;
        for (uint32_t Row = 0u; Row + 1u < Rows; ++Row)
            for (uint32_t Column = 0u; Column + 1u < Columns; ++Column)
            {
                const uint32_t A = Row * Columns + Column, B = A + 1u, C = A + Columns, D = C + 1u;
                Indices.insert(Indices.end(), {A, B, D, A, D, C});
            }
        Ground.AppendVertices(Vertices.data(), Vertices.size());
        Ground.AppendIndices(Indices.data(), Indices.size());
        Scene.RegisterInstance(Ground, Identity, 0u, Frontier::InstanceFlagDoubleSided);   // material 0 = course asphalt
    }
    Scene.Finalise();
}

struct Camera { V Eye, Target; };

void RenderHalf(Frontier::SceneStructure& Scene, const Camera& View, float FovDegrees, unsigned char* Frame, uint32_t Column)
{
    const V Forward = (View.Target - View.Eye).Normalized();
    const V Right   = Frontier::Vehicle::Cross(Forward, {0.0f, 0.0f, 1.0f}).Normalized();
    const V Up      = Frontier::Vehicle::Cross(Right, Forward).Normalized();
    const V Sun     = (Forward * -1.0f + Right * 0.6f + V{0.0f, 0.0f, 0.9f}).Normalized();   // over the camera's shoulder
    const float E[3] = {View.Eye.x, View.Eye.y, View.Eye.z}, F[3] = {Forward.x, Forward.y, Forward.z};
    const float R[3] = {Right.x, Right.y, Right.z}, U[3] = {Up.x, Up.y, Up.z};
    Frontier::VisibilityRaster Raster;
    Raster.AssignFlatColouring(true);   // the quick flat diagnostic view: albedo × facing, no sky, no shadows — shape only
    Frontier::VisibilityRaster::CelestialSettings Sky;
    Sky.Enabled = true;
    Sky.Light.Direction[0] = Sun.x; Sky.Light.Direction[1] = Sun.y; Sky.Light.Direction[2] = Sun.z;
    Sky.Light.Intensity = 22.0f;
    Raster.AssignCelestial(Sky);
    std::vector<unsigned char> Pixels(HalfWidth * FrameRows * 4u);
    double Luminance = 0.0;
    const bool Rendered = Raster.Render(Scene, E, F, R, U, FovDegrees * π / 180.0f, HalfWidth, FrameRows, Pixels.data(), Luminance);
    assert(Rendered); (void)Rendered;
    for (uint32_t Row = 0u; Row < FrameRows; ++Row)
        std::memcpy(Frame + (Row * HalfWidth * 3u + Column) * 4u, Pixels.data() + Row * HalfWidth * 4u, HalfWidth * 4u);
}

enum class ClipMode { Compare, PressureSweep };   // rigid | deformed | difference, or three cars at three pressures

struct Clip
{
    const char* Name;
    const char* Title;
    float       Seconds;
    V           StartVelocity;
    DriverInput (*Drive)(float Time);
    Camera      (*Frame)(const V& Hub, const V& Forward, const V& Left);
    GroundFunction Ground = ReadFlat;
    ClipMode    Mode = ClipMode::Compare;
};
// ⑤ pressure sweep: identical cars at half, nominal and double cold inflation — the air carries the radial stiffness
constexpr float PressureRatios[3] = {0.5f, 1.0f, 2.0f};

// ① Static load: the car is dropped from 2 cm, settles, and sits — four flat patches, bulged sidewalls, nothing else.
DriverInput HoldInput(float) { return {}; }
// ② Hard brake from 25 m/s: load shifts forward, fronts squash harder and the tread leads rearwards under Fx.
DriverInput BrakeInput(float Time) { DriverInput In; In.Brake = Time > 0.4f ? 1.0f : 0.0f; return In; }
// ③ Constant left turn at 18 m/s: outside tyres load up and the carcass walks sideways under Fy.
DriverInput CornerInput(float Time) { DriverInput In; In.Throttle = 0.25f; In.Steer = std::min(1.0f, Time * 1.2f) * 0.55f; return In; }
// ④ Speed humps at 8 m/s: the patch tilts with the road normal and the deflection pulses through each hump.
DriverInput CruiseInput(float) { DriverInput In; In.Throttle = 0.12f; return In; }

Camera LowFront(const V& Hub, const V& Forward, const V& Left)
{   // low three-quarter view of the front-left wheel, patch in frame
    return {Hub + Forward * 1.35f + Left * 1.6f - V{0.0f, 0.0f, Hub.z * 0.45f}, Hub - V{0.0f, 0.0f, Hub.z * 0.5f}};
}
Camera LowSide(const V& Hub, const V& Forward, const V& Left)
{   // straight-on side view of the front-left wheel — the flat patch and the fore/aft lead read best here
    return {Hub + Left * 2.1f + Forward * 0.2f - V{0.0f, 0.0f, Hub.z * 0.45f}, Hub - V{0.0f, 0.0f, Hub.z * 0.45f}};
}
Camera LowRear(const V& Hub, const V& Forward, const V& Left)
{   // from behind the outside front wheel in the turn, looking along the car: sideways carcass walk
    return {Hub - Forward * 1.9f + Left * 1.0f - V{0.0f, 0.0f, Hub.z * 0.5f}, Hub - V{0.0f, 0.0f, Hub.z * 0.45f}};
}

const Clip Clips[] =
{
    {"static-load",  "Static load: four flat patches",            4.0f, {0.0f, 0.0f, 0.0f},  HoldInput,   LowFront},
    {"hard-brake",   "Hard brake from 25 m/s: forward load shift", 4.0f, {25.0f, 0.0f, 0.0f}, BrakeInput,  LowSide},
    {"left-corner",  "Left corner at 18 m/s: carcass lean",       4.0f, {18.0f, 0.0f, 0.0f}, CornerInput, LowRear},
    {"road-bumps",   "Speed humps at 8 m/s: patch follows the road", 2.5f, {8.0f, 0.0f, 0.0f}, CruiseInput, LowSide, ReadBumps},
    {"pressure",     "Half, nominal and double inflation",        3.0f, {0.0f, 0.0f, 0.0f},  HoldInput,   LowSide, ReadFlat, ClipMode::PressureSweep},
};

} // namespace

int main(int Count, char** Arguments)
{
    assert(Count >= 2);
    const std::filesystem::path Folder = Arguments[1];
    const uint32_t FrameStride = Count > 2 ? std::max(1, std::atoi(Arguments[2])) : 1u;   // >1 = quick preview, every Nth sample
    std::filesystem::create_directories(Folder);
    Frontier::ShadingTableSet Tables = Frontier::ShadingTableCodec::Bake(1024u);
    Frontier::UnifiedMaterial::BindTables(Tables);

    Frontier::Drive::DriveSceneAuthor Author;
    Author.Construct(false);   // wheels at their span origins: the solver poses place them, as in the runtime
    const auto Spans = Partition(Author);
    assert(Spans.size() >= 5u);
    const auto Palette = DiagnosticPalette(Author);

    std::vector<unsigned char> Frame(HalfWidth * 3u * FrameRows * 4u);
    uint32_t TotalFrames = 0u;
    for (const Clip& Scenario : Clips)
    {
        const bool Sweep = Scenario.Mode == ClipMode::PressureSweep;
        const uint32_t Cars = Sweep ? 3u : 1u;
        DriveFixture Fixtures[3];
        for (uint32_t Car = 0u; Car < Cars; ++Car)
        {   // rest hub height: wheel radius; settle from a hair above so the first frame already carries load
            DriveFixture& Fixture = Fixtures[Car];
            Fixture.Construct({0.0f, 0.0f, Fixture.Geometry.CoMHeight + 0.02f}, Scenario.StartVelocity, {}, Scenario.Ground);
            if (Sweep)
            {
                Fixture.Configuration.Tyre.InflationPressure *= PressureRatios[Car];
                Fixture.Rebuild();
            }
        }
        const auto& Specification = Fixtures[0].Configuration.Tyre;
        std::FILE* Csv = std::fopen((Folder / (std::string(Scenario.Name) + ".csv")).string().c_str(), "w");
        assert(Csv);
        std::fprintf(Csv, "time_s,speed_mps,changed_pixels");
        const char* Names[WheelCount] = {"fl", "fr", "rl", "rr"};
        if (Sweep)
            for (float Ratio : PressureRatios)
                std::fprintf(Csv, ",p%03.0f_fl_load_n,p%03.0f_fl_deflection_m,p%03.0f_fl_deformed_low_m,p%03.0f_fl_gauge_kpa",
                             Ratio * 100.0f, Ratio * 100.0f, Ratio * 100.0f, Ratio * 100.0f);
        else
            for (const char* Name : Names)
                std::fprintf(Csv, ",%s_load_n,%s_deflection_m,%s_patch_half_m,%s_fx_n,%s_fy_n,%s_rigid_low_m,%s_deformed_low_m",
                             Name, Name, Name, Name, Name, Name, Name);
        std::fprintf(Csv, "\n");

        const uint32_t Steps = static_cast<uint32_t>(std::lround(Scenario.Seconds / StepSeconds));
        const uint32_t StepsPerFrame = static_cast<uint32_t>(std::lround(1.0f / (StepSeconds * SampleHz))) * FrameStride;
        uint32_t FrameIndex = 0u;
        for (uint32_t Step = 1u; Step <= Steps; ++Step)
        {
            const float Time = Step * StepSeconds;
            for (uint32_t Car = 0u; Car < Cars; ++Car) Fixtures[Car].Advance(Scenario.Drive(Time));
            if (Step % StepsPerFrame != 0u) continue;

            uint64_t Changed = 0u;
            std::string Row;
            char Cell[256];
            std::snprintf(Cell, sizeof(Cell), "%.3f,%.3f", Time, Fixtures[0].Body.LinearVelocity.Length());
            Row += Cell;
            for (uint32_t Car = 0u; Car < Cars; ++Car)
            {
                DriveFixture& Fixture = Fixtures[Car];
                // the exact records the project DLL hands the host
                const auto& Tyres = Fixture.Solver.Tyres();
                const auto& Wheels = Fixture.Solver.Telemetry().Wheels;
                assert(Tyres.size() == WheelCount && Wheels.size() >= WheelCount);   // telemetry is a fixed 8-slot array
                Frontier::TyreDeformationRecord Records[WheelCount];
                float Worlds[5][16];
                ComposeTRS(Fixture.Body.Position, Fixture.Body.Orientation, Worlds[0]);
                for (uint32_t Wheel = 0u; Wheel < WheelCount; ++Wheel)
                {
                    Records[Wheel] = Frontier::Vehicle::ComposeTyreDeformation(Tyres[Wheel], Wheels[Wheel], Fixture.Configuration.Tyre);
                    ComposeTRS(Tyres[Wheel].HubPosition(), Tyres[Wheel].MaterialFrame(), Worlds[Wheel + 1u]);
                }
                const V Forward = Fixture.Body.Orientation.Rotate({1.0f, 0.0f, 0.0f});
                const V Left    = Fixture.Body.Orientation.Rotate({0.0f, 1.0f, 0.0f});
                const Camera View = Scenario.Frame(Tyres[0].HubPosition(), Forward, Left);

                float RigidLow[WheelCount], DeformedLow[WheelCount];
                Frontier::SceneStructure Deformed;
                ConstructFrame(Deformed, Palette, Spans, Worlds, Records, DeformedLow, Scenario.Ground);
                if (Sweep)
                {
                    RenderHalf(Deformed, View, 42.0f, Frame.data(), Car * HalfWidth);
                    const auto& Reading = Wheels[0];
                    std::snprintf(Cell, sizeof(Cell), ",%.1f,%.4f,%.4f,%.1f", Reading.VerticalLoad, Records[0].Ground[3], DeformedLow[0],
                                  Reading.Thermal.Valid ? Reading.Thermal.GaugePressure * 0.001 : Fixture.Configuration.Tyre.InflationPressure * 0.001);
                    Row += Cell;
                    for (uint32_t Wheel = 0u; Wheel < WheelCount; ++Wheel) assert(DeformedLow[Wheel] > -0.004f);
                    continue;
                }
                Frontier::SceneStructure Rigid;
                ConstructFrame(Rigid, Palette, Spans, Worlds, nullptr, RigidLow, Scenario.Ground);
                RenderHalf(Rigid,    View, 42.0f, Frame.data(), 0u);
                RenderHalf(Deformed, View, 42.0f, Frame.data(), HalfWidth);
                for (uint32_t PixelRow = 0u; PixelRow < FrameRows; ++PixelRow)
                    for (uint32_t Column = 0u; Column < HalfWidth; ++Column)
                    {   // third panel: amplified absolute difference, so the patch, bulge and lead regions light up
                        const unsigned char* A = Frame.data() + (PixelRow * HalfWidth * 3u + Column) * 4u;
                        const unsigned char* B = A + HalfWidth * 4u;
                        unsigned char* D = Frame.data() + (PixelRow * HalfWidth * 3u + 2u * HalfWidth + Column) * 4u;
                        const int Difference = std::abs(int(A[0]) - int(B[0])) + std::abs(int(A[1]) - int(B[1])) + std::abs(int(A[2]) - int(B[2]));
                        const int Amplified = std::min(255, Difference * 3);
                        D[0] = static_cast<unsigned char>(Amplified); D[1] = static_cast<unsigned char>(Amplified * 0.55f);
                        D[2] = static_cast<unsigned char>(Amplified * 0.15f); D[3] = 255u;
                        if (Difference > 24) ++Changed;
                    }
                for (uint32_t Wheel = 0u; Wheel < WheelCount; ++Wheel)
                {
                    const auto& Reading = Wheels[Wheel];
                    const float Delta = Records[Wheel].Ground[3];
                    const float PatchHalf = Delta > 0.0f ? std::sqrt(std::max(0.0f, 2.0f * Specification.Radius * Delta)) : 0.0f;
                    std::snprintf(Cell, sizeof(Cell), ",%.1f,%.4f,%.4f,%.1f,%.1f,%.4f,%.4f", Reading.VerticalLoad, Delta, PatchHalf,
                                  Reading.LongitudinalForce, Reading.LateralForce, RigidLow[Wheel], DeformedLow[Wheel]);
                    Row += Cell;
                    // the bent tread never dips below the road, and a loaded tyre's rigid shell always did
                    assert(DeformedLow[Wheel] > -0.004f);
                    if (Delta > 0.004f) assert(RigidLow[Wheel] < DeformedLow[Wheel] - 0.5f * Delta);
                }
            }
            if (Sweep)
            {   // softer tyre, deeper squash — the pressure-dependent stiffness must order the three cars
                const float Soft = Fixtures[0].Solver.Telemetry().Wheels[0].TyreDeflection;
                const float Nominal = Fixtures[1].Solver.Telemetry().Wheels[0].TyreDeflection;
                const float Hard = Fixtures[2].Solver.Telemetry().Wheels[0].TyreDeflection;
                if (Time > 1.5f) assert(Soft > Nominal * 1.3f && Nominal > Hard * 1.3f);
            }
            // the changed-pixel count sits after time and speed
            Row.insert(Row.find(',', Row.find(',') + 1u), "," + std::to_string(Changed));
            std::fprintf(Csv, "%s\n", Row.c_str());
            char Name[64];
            std::snprintf(Name, sizeof(Name), "%s-%03u.png", Scenario.Name, FrameIndex);
            const bool Written = PngWriteCounterpart::WritePng((Folder / Name).string().c_str(), HalfWidth * 3u, FrameRows, 4, Frame.data(), HalfWidth * 12u);
            assert(Written); (void)Written;
            ++FrameIndex;
        }
        std::fclose(Csv);
        std::printf("PASS %s: %u frames, %s.\n", Scenario.Name, FrameIndex, Scenario.Title);
        TotalFrames += FrameIndex;
    }
    std::printf("PASS %u frames written to %s. CPU port of Shaders/TyreDeformation.slang on the actual ControlVehicle wheels.\n",
                TotalFrames, Folder.string().c_str());
}
