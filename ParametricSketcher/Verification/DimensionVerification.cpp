//============================================================================================================================================
// 📦 ParametricSketcher/Verification/DimensionVerification.cpp — Phase 13: auto-emit linear dims on primitives, bbox dims on bodies, angle dims on polylines
//============================================================================================================================================
// Every primitive auto-emits at least one dimension. `dim <figure> --along=X|Y|Z` adds a user linear dim along
//    an axis. `dim <figure> <p1> <p2>` adds a free-form linear dim between two world points. `angle <polyline>`
//    measures an interior angle. `dim list` enumerates, `dim edit <id> <value>` overrides a value, `dim hide|show|delete <id|all>`
//    mutates the dim tree. The label re-formats on every render so an edit shows up immediately.
#include "Console/ConsoleHost.h"
#include "Kernel/VectorSpecification.h"
#include "VerificationPanel.h"
#include <cmath>
#include <string>

using namespace Frontier;

int main()
{
    VerificationPanel Panel("SolidArc · Phase 13 · Dimension Verification — auto-emit dims on every primitive, bbox dims on bodies, angle dims on polylines, dim edit/hide/delete");

    auto Figure = [](ConsoleHost& Host, const char* Name) -> const SceneFigure* { return Host.Document().Find(std::string(Name)); };
    auto DimById = [](const ConsoleHost& Host, uint32_t Id) -> const ConsoleHost::DimensionEntry*
    {
        for (const auto& D : Host.AllDimensions()) if (D.Id == Id) return &D;
        return nullptr;
    };
    auto DimCount = [](const ConsoleHost& Host) -> size_t { return Host.AllDimensions().size(); };

    Panel.Section("Auto-emit: a body (box) gets three bbox dims, one per axis");
    {
        ConsoleHost Host("/tmp/SolidArcVerificationP13A", 1280, 800);
        Host.Execute("box (0,0,0) (2,3,4) --name=B");
        Panel.Expect("box builds", bool(Figure(Host, "B")));
        // The box should have auto-emitted at least 3 bbox dims.
        size_t BboxCount = 0; for (const auto& D : Host.AllDimensions()) if (D.Form == ConsoleHost::DimensionForm::Bbox && D.Anchor == 1) ++BboxCount;
        Panel.Expect("at least 3 auto bbox dims emitted for the box", BboxCount >= 3);
        // Each dim's value must match the corresponding box extent.
        for (const auto& D : Host.AllDimensions())
        {
            if (D.Form != ConsoleHost::DimensionForm::Bbox) continue;
            if (D.AnchorName == "B X") Panel.Within("|B X dim - 2| ≤ 1e-9", std::fabs(D.Value - 2.0), 1e-9);
            else if (D.AnchorName == "B Y") Panel.Within("|B Y dim - 3| ≤ 1e-9", std::fabs(D.Value - 3.0), 1e-9);
            else if (D.AnchorName == "B Z") Panel.Within("|B Z dim - 4| ≤ 1e-9", std::fabs(D.Value - 4.0), 1e-9);
        }
    }

    Panel.Section("Auto-emit: a curve gets an arc-length dim; a circle also gets a radius dim");
    {
        ConsoleHost Host("/tmp/SolidArcVerificationP13B", 1280, 800);
        Host.Execute("line (0,0,0) (3,4,0) --name=L");
        bool HasLength = false;
        for (const auto& D : Host.AllDimensions()) if (D.Form == ConsoleHost::DimensionForm::ArcLength && D.Anchor == 1) { HasLength = true; Panel.Within("|L length dim - 5| ≤ 1e-3 (3-4-5 triangle)", std::fabs(D.Value - 5.0), 1e-3); break; }
        Panel.Expect("line has an arc-length dim", HasLength);

        ConsoleHost Host2("/tmp/SolidArcVerificationP13C", 1280, 800);
        Host2.Execute("circle (0,0,0) 2 --name=C");
        bool HasRadius = false; bool CircLength = false;
        for (const auto& D : Host2.AllDimensions())
        {
            if (D.Form == ConsoleHost::DimensionForm::Radius && D.Anchor == 1) { HasRadius = true; Panel.Within("|C radius dim - 2| ≤ 1e-9", std::fabs(D.Value - 2.0), 1e-9); }
            if (D.Form == ConsoleHost::DimensionForm::ArcLength && D.Anchor == 1) { CircLength = true; Panel.Within("|C circumference - 4π| ≤ 1e-3", std::fabs(D.Value - 4.0 * 3.14159265358979323846), 1e-3); }
        }
        Panel.Expect("circle has a radius dim", HasRadius);
        Panel.Expect("circle has a circumference dim", CircLength);
    }

    Panel.Section("dim <figure> --along=X|Y|Z adds a user linear dim along an axis");
    {
        ConsoleHost Host("/tmp/SolidArcVerificationP13D", 1280, 800);
        Host.Execute("box (0,0,0) (2,3,4) --name=B");
        size_t Before = DimCount(Host);
        Panel.Expect("dim B --along=X succeeds", Host.Execute("dim B --along=X"));
        Panel.Expect("dim B --along=Y succeeds", Host.Execute("dim B --along=Y"));
        Panel.Expect("dim B --along=Z succeeds", Host.Execute("dim B --along=Z"));
        Panel.Expect("three user dims added", DimCount(Host) == Before + 3);
        // Last three dims must be the user-added linear ones with the right values.
        const ConsoleHost::DimensionEntry* UX = nullptr, *UY = nullptr, *UZ = nullptr;
        for (const auto& D : Host.AllDimensions())
        {
            if (!D.Auto && D.AnchorName == "B X") UX = &D;
            if (!D.Auto && D.AnchorName == "B Y") UY = &D;
            if (!D.Auto && D.AnchorName == "B Z") UZ = &D;
        }
        Panel.Expect("user X dim found", UX != nullptr);
        Panel.Expect("user Y dim found", UY != nullptr);
        Panel.Expect("user Z dim found", UZ != nullptr);
        if (UX) Panel.Within("|user X value - 2| ≤ 1e-9", std::fabs(UX->Value - 2.0), 1e-9);
        if (UY) Panel.Within("|user Y value - 3| ≤ 1e-9", std::fabs(UY->Value - 3.0), 1e-9);
        if (UZ) Panel.Within("|user Z value - 4| ≤ 1e-9", std::fabs(UZ->Value - 4.0), 1e-9);
        // Bad axis refused
        Panel.Expect("dim --along=Q refused", !Host.Execute("dim B --along=Q"));
    }

    Panel.Section("dim <figure> <p1> <p2> adds a free-form linear dim between two world points");
    {
        ConsoleHost Host("/tmp/SolidArcVerificationP13E", 1280, 800);
        Host.Execute("box (0,0,0) (1,1,1) --name=B");
        size_t Before = DimCount(Host);
        Panel.Expect("dim B (0,0,0) (3,4,0) succeeds", Host.Execute("dim B (0,0,0) (3,4,0)"));
        Panel.Expect("one user free dim added", DimCount(Host) == Before + 1);
        // Last dim is the user free one.
        const ConsoleHost::DimensionEntry* UF = nullptr;
        for (const auto& D : Host.AllDimensions()) if (!D.Auto && D.AnchorName == "B free") UF = &D;
        Panel.Expect("user free dim found", UF != nullptr);
        if (UF) Panel.Within("|user free dim - 5| ≤ 1e-9", std::fabs(UF->Value - 5.0), 1e-9);
        // Bad points refused
        Panel.Expect("dim B with one point refused", !Host.Execute("dim B (0,0,0)"));
        Panel.Expect("dim B with non-numeric point refused", !Host.Execute("dim B (abc) (1,2,3)"));
    }

    Panel.Section("angle <polyline> measures an interior angle (3-4-5 right triangle → 90°)");
    {
        ConsoleHost Host("/tmp/SolidArcVerificationP13F", 1280, 800);
        Host.Execute("polyline (0,0) (4,0) (4,3) --name=Tri");
        Panel.Expect("angle Tri --at=1 succeeds", Host.Execute("angle Tri --at=1"));
        const ConsoleHost::DimensionEntry* UA = nullptr;
        for (const auto& D : Host.AllDimensions()) if (!D.Auto && D.Form == ConsoleHost::DimensionForm::Angle) UA = &D;
        Panel.Expect("user angle dim found", UA != nullptr);
        if (UA) Panel.Within("|Tri angle - π/2| ≤ 1e-3 (4-3 right triangle)", std::fabs(UA->Value - 3.14159265358979323846 / 2.0), 1e-3);
        // --at=0 and --at=2 are end-vertices, refused (no adjacent segment on both sides)
        Panel.Expect("angle --at=0 refused (end vertex)", !Host.Execute("angle Tri --at=0"));
        Panel.Expect("angle --at=2 refused (end vertex)", !Host.Execute("angle Tri --at=2"));
        // On a non-curve figure
        Host.Execute("box (0,0,0) (1,1,1) --name=B2");
        Panel.Expect("angle on a body is refused", !Host.Execute("angle B2"));
    }

    Panel.Section("dim edit / hide / show / delete mutate the dim tree");
    {
        ConsoleHost Host("/tmp/SolidArcVerificationP13G", 1280, 800);
        Host.Execute("box (0,0,0) (2,2,2) --name=B");
        // The three bbox dims are auto-emitted; find one and edit it.
        uint32_t TargetId = 0;
        for (const auto& D : Host.AllDimensions()) if (D.AnchorName == "B X") { TargetId = D.Id; break; }
        Panel.Expect("an X bbox dim exists to edit", TargetId != 0);
        Panel.Expect("dim edit <id> <new-value> succeeds", Host.Execute("dim edit " + std::to_string(TargetId) + " 5.5"));
        const ConsoleHost::DimensionEntry* E = DimById(Host, TargetId);
        Panel.Expect("edited dim is the X one", E != nullptr && E->AnchorName == "B X");
        if (E) Panel.Within("|edited value - 5.5| ≤ 1e-9", std::fabs(E->Value - 5.5), 1e-9);
        // Hide the dim
        Panel.Expect("dim hide <id> succeeds", Host.Execute("dim hide " + std::to_string(TargetId)));
        E = DimById(Host, TargetId);
        Panel.Expect("dim is hidden after hide", E != nullptr && E->Hidden);
        Panel.Expect("dim show <id> succeeds", Host.Execute("dim show " + std::to_string(TargetId)));
        E = DimById(Host, TargetId);
        Panel.Expect("dim is shown after show", E != nullptr && !E->Hidden);
        // Delete a dim
        size_t Before = DimCount(Host);
        Panel.Expect("dim delete <id> succeeds", Host.Execute("dim delete " + std::to_string(TargetId)));
        Panel.Expect("dim count decreases by 1 after delete", DimCount(Host) == Before - 1);
        Panel.Expect("deleted dim is gone", DimById(Host, TargetId) == nullptr);
        // delete all
        Panel.Expect("dim delete all succeeds", Host.Execute("dim delete all"));
        Panel.Expect("no dims after delete all", DimCount(Host) == 0);
    }

    Panel.Section("Refusal cases for the dim verb");
    {
        ConsoleHost Host("/tmp/SolidArcVerificationP13H", 1280, 800);
        Panel.Expect("dim with no arguments refused", !Host.Execute("dim"));
        Panel.Expect("dim with unknown subcommand refused", !Host.Execute("dim whatnow"));
        Panel.Expect("dim edit with bad id refused", !Host.Execute("dim edit 999 1.0"));
        Panel.Expect("dim edit with no value refused", !Host.Execute("dim edit 1"));
        Panel.Expect("dim hide with no id refused", !Host.Execute("dim hide"));
        Panel.Expect("dim delete with no id refused", !Host.Execute("dim delete"));
    }

    Panel.Section("--no-dim switch on a primitive suppresses auto-emit");
    {
        ConsoleHost Host("/tmp/SolidArcVerificationP13I", 1280, 800);
        size_t Before = DimCount(Host);
        Host.Execute("box (0,0,0) (1,1,1) --name=NoDim --no-dim");
        Panel.Expect("--no-dim adds the box without auto dims", DimCount(Host) == Before);
    }

    return Panel.Conclude();
}
