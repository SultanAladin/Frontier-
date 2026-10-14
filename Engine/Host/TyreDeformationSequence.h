//============================================================================================================================================
//                                                        TYREDEFORMATIONSEQUENCE.H
//============================================================================================================================================
// 📦 Host-owned per-frame tyre-deformation records: queried from the project, stamped onto the wheel instances, uploaded.
//
// 📐 The project says which scene placement each record deforms; this sequence resolves the name to instance rows
//    once, writes InstanceFlagTyreDeform + slot into those rows' Flags, keeps last frame's record beside this
//    frame's (motion vectors), and hands the pair array to VisibilityExchange. No project pointer survives the call.

#pragma once
#include "../ProjectInterchange/CodeInterchange.h"
#include "../GeometricRaster/SceneStructure.h"
#include "../GeometricRaster/TyreDeformationRecord.h"
#include <array>
#include <cstring>
#include <string>
#include <vector>

namespace Frontier::HostRuntime
{

class TyreDeformationSequence
{
public:
    // Both halves of the resident buffer: [slot * 2] current, [slot * 2 + 1] previous.
    [[nodiscard]] const std::vector<TyreDeformationRecord>& QueryRecords() const noexcept { return Pairs; }
    [[nodiscard]] bool Active() const noexcept { return !Subjects.empty(); }
    [[nodiscard]] uint64_t QueryRevision() const noexcept { return Revision; }

    // Call when playback starts: flags are stamped onto Rows for every placement the project names.
    void Construct(const SceneStructure& Scene, std::vector<InstanceRecord>& Rows, const CodeInterchange& Project)
    {
        Reclaim(Rows);
        if (!Project.TyreDeformationAvailable()) return;
        FrontierProjectTyreDeformationReading Probe{sizeof(Probe), 1u, 0u, 0u, nullptr, nullptr, 0u};
        if (Project.ProjectTyreDeformation(Probe) != 1u || Probe.Count == 0u) return;
        Capacity = Probe.Count < kTyreDeformationSlots ? Probe.Count : kTyreDeformationSlots;
        Names.assign(Capacity, nullptr);
        Scratch.assign(Capacity, {});
        Pairs.assign(static_cast<size_t>(Capacity) * 2u, {});
        Subjects.assign(Capacity, {});
        // Names arrive with the first live reading; rows are resolved lazily in Advance.
        PlacementsResolved = false;
        (void)Scene; (void)Rows;
    }

    // Per frame during playback. Returns false only on a malformed project answer.
    bool Advance(const SceneStructure& Scene, std::vector<InstanceRecord>& Rows, const CodeInterchange& Project,
                 bool& Changed, std::string& Refusal)
    {
        Changed = false;
        if (Capacity == 0u) return true;
        FrontierProjectTyreDeformationReading Reading{sizeof(Reading), 1u, Capacity, 0u, Names.data(),
                                                      reinterpret_cast<FrontierTyreDeformationRecord*>(Scratch.data()), 0u};
        const uint32_t Status = Project.ProjectTyreDeformation(Reading);
        if (Status == 2u) { Refusal = "project tyre deformation refused a well-formed reading"; return false; }
        if (Status != 1u || Reading.Count == 0u || Reading.Revision == Revision) return true;
        if (Reading.Count > Capacity) { Refusal = "project tyre deformation overran its negotiated capacity"; return false; }
        if (!PlacementsResolved)
        {
            for (uint32_t Slot = 0u; Slot < Reading.Count; ++Slot)
            {
                Subjects[Slot].Name = Names[Slot] ? Names[Slot] : "";
                Subjects[Slot].Rows.clear();
                for (const auto& Placement : Scene.QueryPlacements())
                {
                    if (Placement.Name != Subjects[Slot].Name) continue;
                    for (uint32_t Offset = 0u; Offset < Placement.InstanceCount; ++Offset)
                    {
                        const uint32_t Row = Placement.FirstInstance + Offset;
                        if (Row < Rows.size()) { Subjects[Slot].Rows.push_back(Row); Rows[Row].Flags = WithTyreDeformationSlot(Rows[Row].Flags, Slot); }
                    }
                }
            }
            PlacementsResolved = true;
            // The first live record is also the previous one: no motion-vector smear on the opening frame.
            for (uint32_t Slot = 0u; Slot < Reading.Count; ++Slot) Pairs[Slot * 2u] = Scratch[Slot];
        }
        for (uint32_t Slot = 0u; Slot < Reading.Count; ++Slot)
        {
            Pairs[Slot * 2u + 1u] = Pairs[Slot * 2u];
            Pairs[Slot * 2u]      = Scratch[Slot];
        }
        Revision = Reading.Revision;
        Changed = true;
        return true;
    }

    // Playback stopped: clear the flags so the authored rest wheels draw rigid again.
    void Reclaim(std::vector<InstanceRecord>& Rows)
    {
        for (const auto& Subject : Subjects)
            for (uint32_t Row : Subject.Rows)
                if (Row < Rows.size()) Rows[Row].Flags = WithoutTyreDeformation(Rows[Row].Flags);
        Subjects.clear(); Names.clear(); Scratch.clear(); Pairs.clear();
        Capacity = 0u; Revision = 0u; PlacementsResolved = false;
    }

private:
    struct Subject { std::string Name; std::vector<uint32_t> Rows; };
    std::vector<Subject>               Subjects;
    std::vector<const char*>           Names;
    std::vector<TyreDeformationRecord> Scratch;
    std::vector<TyreDeformationRecord> Pairs;
    uint32_t Capacity = 0u;
    uint64_t Revision = 0u;
    bool     PlacementsResolved = false;
};

} // namespace Frontier::HostRuntime
