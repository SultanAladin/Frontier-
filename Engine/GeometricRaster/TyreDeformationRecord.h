//============================================================================================================================================
//                                                        TYREDEFORMATIONRECORD.H
//============================================================================================================================================
// 📦 The per-wheel contact record the GPU bends a tyre mesh with: std430 mirror of Shaders/TyreDeformation.slang.
//
// 📐 One 128-byte record per deformed wheel, published by the vehicle project every frame and uploaded as a
//    storage buffer the raster vertex stages and the surface resolve read. The instance that draws the wheel
//    carries InstanceFlagTyreDeform plus the record slot in its Flags; the buffer holds the current and the
//    previous frame's record side by side so motion vectors deform with the same arithmetic.

#pragma once

#include <cstdint>
#include <cstring>

namespace Frontier {

struct alignas(16) TyreDeformationRecord
{
    float Hub[4]{};           // xyz hub centre (world, m)                   w TreadRadius R (m)
    float Axle[4]{};          // xyz unit axle direction (world, hub +Y)    w RimRadius (m): rigid inside
    float Ground[4]{};        // xyz contact patch centre (world, m)        w Deflection δ (m, 0 = no contact)
    float Normal[4]{0.0f, 0.0f, 1.0f, 0.0f}; // xyz unit contact normal     w HalfWidth (m)
    float Lateral[4]{};       // xyz carcass lateral deflection (world, m)  w TreadSpeed ω·R (m/s)
    float Longitudinal[4]{};  // xyz tread fore/aft lead (world, m)         w PressureRatio p / p_nominal
    float Tuning[4]{0.35f, 0.35f, 4.0e-6f, 0.0f}; // BulgeGain, PatchSoftness, GrowthGain, Active
    float Reserved[4]{};
};
static_assert(sizeof(TyreDeformationRecord) == 128u, "TyreDeformationRecord must be 128 bytes (std430 mirror)");

// Instance flag and slot packing shared with the shader (TYRE_DEFORM_FLAG / TYRE_DEFORM_SLOT).
inline constexpr uint32_t kInstanceFlagTyreDeform = 1u << 2;
inline constexpr uint32_t kTyreDeformationSlots   = 64u;      // [cnt] wheels the resident buffer can carry
[[nodiscard]] inline uint32_t TyreDeformationSlotOf(uint32_t Flags) noexcept { return (Flags >> 16u) & 255u; }
[[nodiscard]] inline uint32_t WithTyreDeformationSlot(uint32_t Flags, uint32_t Slot) noexcept
{ return (Flags & ~(255u << 16u)) | kInstanceFlagTyreDeform | ((Slot & 255u) << 16u); }
[[nodiscard]] inline uint32_t WithoutTyreDeformation(uint32_t Flags) noexcept
{ return Flags & ~((255u << 16u) | kInstanceFlagTyreDeform); }

} // namespace Frontier
