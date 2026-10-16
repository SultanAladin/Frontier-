//============================================================================================================================================
// 📦 Native headless verification of the browser command device: the real document, scene/gizmo streams and GPU identity boundary.
//============================================================================================================================================
#include "Console/ConsoleHost.h"
#include "Presentation/CommandExchange.h"
#include "VerificationPanel.h"
#include <memory>

using namespace Frontier;

int main()
{
    VerificationPanel Panel("SolidArc · GPU command stream · native headless counterpart");
    auto Backend = std::make_unique<CommandExchange>();
    auto* Device = Backend.get();
    ConsoleHost Host("/tmp/SolidArcCommandProof", std::move(Backend));
    Panel.Expect("Actual native geometry commands execute", Host.Execute("box (0,0,0) 2 3 4 --name=Block ; select Block ; gizmo on"));
    Host.SeatSurface(800, 600, 1);
    Host.Render();
    auto Contains = [&](const char* Text) { return Device->Packet.find(Text) != std::string::npos; };
    Panel.Expect("Native scene emits surfaces", Contains("\"kind\":\"surface\""));
    Panel.Expect("Native edges and gizmo emit line streams", Contains("\"kind\":\"line\""));
    Panel.Expect("Lattice is a GPU shader draw, not pixel data", Contains("\"kind\":\"lattice\""));
    Panel.Expect("Original gizmo retains its overlay boundary", Contains("\"overlay\":true"));
    Panel.Expect("CPU fragment work is zero", Contains("\"cpuFragments\":0"));
    Panel.Expect("No RGBA display image is uploaded", Contains("\"rgbaUploads\":0") && !Contains("\"pixels\""));
    Panel.Expect("Readback never invents a CPU raster image", Device->Readback().Pixels.empty());
    Panel.Expect("Real native tessellation produces triangles", Device->QueryTally().Triangles > 0u);

    Panel.Section("GPU identity routing is coordinate-specific");
    Device->Intersection = 0xfedcba98u;
    Device->IntersectionX = 12u;
    Device->IntersectionY = 34u;
    Panel.Expect("All 32 GPU identity bits survive", Device->Pick(12u, 34u) == 0xfedcba98u);
    Panel.Expect("One GPU pixel is not repeated across the viewport", Device->Pick(11u, 34u) == 0u && Device->Pick(12u, 35u) == 0u);
    Device->IntersectionWidth = 800u;
    Device->Intersections = {{8010u, 5u, 7u}, {16100u, 3u, 11u}};
    Panel.Expect("Box selection resolves distinct GPU identity runs", Device->Pick(10u, 10u) == 7u && Device->Pick(100u, 20u) == 11u);
    Panel.Expect("Background between runs stays unpickable", Device->Pick(15u, 10u) == 0u && Device->Pick(99u, 20u) == 0u);
    Device->IntersectionWidth = 0u;
    Device->Intersections.clear();

    Panel.Section("Control points and resource-independent native resize");
    Panel.Expect("Native control-pole commands execute", Host.Execute("reset ; cpcurve (0,0) (1,2) (3,-1) (5,1) --name=Profile ; select Profile ; selectmode control ; show cages on"));
    Host.Render();
    Panel.Expect("Control poles emit actual GPU point streams", Contains("\"kind\":\"point\"") && Device->QueryTally().Points > 0u);
    Host.SeatSurface(1234, 789, 1);
    Host.Render();
    Panel.Expect("Viewport extent reaches the command packet", Contains("\"width\":1234") && Contains("\"height\":789"));
    Panel.Expect("Updated view projection is recorded", Contains("\"ViewClip\":[") && Contains("\"Viewport\":[1234,789,"));
    return Panel.Conclude();
}
