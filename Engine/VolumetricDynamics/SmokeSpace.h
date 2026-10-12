//============================================================================================================================================
//                                                                SMOKESPACE.H
//============================================================================================================================================
// 📦 Integer-cell world-space relocation preserves overlapping smoke, heat and velocity without following carrier rotation.

#pragma once

#include "CoarseGasField.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace Frontier
{

struct SmokeRelocationMetrics
{
    uint32_t RetainedVoxels = 0u;    // [-] - overlapping cell count
    uint32_t ExposedVoxels  = 0u;    // [-] - newly exposed empty cells
    double   DroppedSmoke   = 0.0;   // [-] - density sum leaving the finite extent
};

/// 📦 Translates an axis-aligned smoke lattice by integer cells without moving retained material in the world.
/// in    Shift   [cells] origin displacement; new cell i reads old cell i + Shift
/// out   Field   [-] density/heat/world velocity retained bit-identically; transient pressure/obstruction cleared
/// out   Reading [-] retained/exposed cells and density leaving the finite extent
/// err   false for unconstructed/nonfinite fields; no scalar or placement changes occur
/// note  uses already-resident scratch storage; no lattice allocation or resampling during ordinary scrolling
inline bool RelocateSmoke(CoarseGasField& Field, const int32_t Shift[3], SmokeRelocationMetrics& Reading) noexcept
{
    if (!Shift || !std::isfinite(Field.Span) || Field.Span <= 0.0f) return false;
    std::vector<float>* Channels[] = {&Field.VelocityX, &Field.VelocityY, &Field.VelocityZ, &Field.Smoke, &Field.Temperature,
        &Field.Occupancy, &Field.ScratchX, &Field.ScratchY, &Field.ScratchZ, &Field.Pressure, &Field.PressureNext, &Field.Divergence};
    for (const auto* Channel : Channels) if (Channel->size() != CoarseVoxelCount) return false;
    const float Size = VoxelSize(Field);
    float Origin[3];
    for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
    {
        Origin[Axis] = Field.Origin[Axis] + Shift[Axis] * Size;
        if (!std::isfinite(Origin[Axis]) || !std::isfinite(Field.Origin[Axis])) return false;
    }
    SmokeRelocationMetrics Candidate;
    if (Shift[0] == 0 && Shift[1] == 0 && Shift[2] == 0)
    {
        Candidate.RetainedVoxels = CoarseVoxelCount;
        Reading = Candidate;
        return true;
    }
    for (uint32_t Z = 0u; Z < CoarseExtent; ++Z)
    for (uint32_t Y = 0u; Y < CoarseExtent; ++Y)
    for (uint32_t X = 0u; X < CoarseExtent; ++X)
    {
        const int64_t New[3] = {int64_t(X) - Shift[0], int64_t(Y) - Shift[1], int64_t(Z) - Shift[2]};
        if (New[0] < 0 || New[1] < 0 || New[2] < 0 || New[0] >= CoarseExtent || New[1] >= CoarseExtent || New[2] >= CoarseExtent)
            Candidate.DroppedSmoke += Field.Smoke[VoxelIndex(X, Y, Z)];
        else ++Candidate.RetainedVoxels;
    }
    Candidate.ExposedVoxels = CoarseVoxelCount - Candidate.RetainedVoxels;
    std::vector<float>* Advected[] = {&Field.VelocityX, &Field.VelocityY, &Field.VelocityZ, &Field.Smoke, &Field.Temperature};
    for (auto* Channel : Advected)
    {
        std::fill(Field.ScratchX.begin(), Field.ScratchX.end(), 0.0f);
        for (uint32_t Z = 0u; Z < CoarseExtent; ++Z)
        for (uint32_t Y = 0u; Y < CoarseExtent; ++Y)
        for (uint32_t X = 0u; X < CoarseExtent; ++X)
        {
            const int64_t Previous[3] = {int64_t(X) + Shift[0], int64_t(Y) + Shift[1], int64_t(Z) + Shift[2]};
            if (Previous[0] < 0 || Previous[1] < 0 || Previous[2] < 0 ||
                Previous[0] >= CoarseExtent || Previous[1] >= CoarseExtent || Previous[2] >= CoarseExtent) continue;
            Field.ScratchX[VoxelIndex(X, Y, Z)] = (*Channel)[VoxelIndex(
                static_cast<uint32_t>(Previous[0]), static_cast<uint32_t>(Previous[1]), static_cast<uint32_t>(Previous[2]))];
        }
        Channel->swap(Field.ScratchX);
    }
    for (auto* Channel : {&Field.Occupancy, &Field.ScratchX, &Field.ScratchY, &Field.ScratchZ,
                         &Field.Pressure, &Field.PressureNext, &Field.Divergence})
        std::fill(Channel->begin(), Channel->end(), 0.0f);
    std::copy_n(Origin, 3u, Field.Origin);
    Reading = Candidate;
    return true;
}

/// 📦 Resolves whole-cell origin movement only when the requested carrier leaves a protected interior band.
/// in    Placement [m] current world position; no carrier rotation is consumed
/// in    GuardCells[cells] protected interior band on all axes
/// out   Shift     [cells] zero while the source remains inside the band
/// err   false for invalid placement or guard specification; no output modification
inline bool ResolveSmokeShift(
    const CoarseGasField& Field,
    const float          Placement[3],
    uint32_t             GuardCells,
    int32_t              Shift[3]) noexcept
{
    if (!Placement || !Shift || GuardCells >= CoarseExtent / 2u || !std::isfinite(Field.Span) || Field.Span <= 0.0f) return false;
    const float Size = VoxelSize(Field);
    int32_t Candidate[3]{};
    for (uint32_t Axis = 0u; Axis < 3u; ++Axis)
    {
        if (!std::isfinite(Placement[Axis]) || !std::isfinite(Field.Origin[Axis])) return false;
        const double Coordinate = (double(Placement[Axis]) - Field.Origin[Axis]) / Size;
        if (Coordinate >= GuardCells && Coordinate <= CoarseExtent - GuardCells) continue;
        const double Move = std::floor(Coordinate - 0.5 * CoarseExtent);
        if (!std::isfinite(Move) || Move < INT32_MIN || Move > INT32_MAX) return false;
        Candidate[Axis] = static_cast<int32_t>(Move);
    }
    std::copy_n(Candidate, 3u, Shift);
    return true;
}

} // namespace Frontier
