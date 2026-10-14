//============================================================================================================================================
//                                                             DISPLAYSEQUENCE.H
//============================================================================================================================================
// 📦 Host-owned project displays: binds each project sheet to the emissive channel of the material it names, keeps
//    the texture slot resident, and forwards the pointer. Versioned C copying, no retained project pointers.
//
//    Construct runs after texture decode and before the scene upload, so the first sheet rides the normal upload;
//    Advance polls each display every tick (the project decides its own raster rate — the host only copies when
//    Revision moves) and queues a same-shape refresh. A resized sheet re-seats the slot and triggers a full
//    texture re-upload, the one deliberate hitch — the no-squash rule costs a reallocation, never a stretch.

#pragma once

#include "../ContentInterchange/TextureIndex.h"
#include "../DeviceExchange/SwapchainExchange.h"
#include "../GeometricRaster/SceneStructure.h"
#include "../ProjectInterchange/CodeInterchange.h"

#include <cmath>
#include <cstring>
#include <string>
#include <vector>

namespace Frontier::HostRuntime
{

class DisplaySequence
{
public:
    struct Display
    {
        std::string SubjectName;          // material name
        uint32_t    Material = 0xFFFFFFFFu;
        uint32_t    Slot = 0xFFFFFFFFu;   // TextureIndex slot
        uint32_t    Width = 0u, Height = 0u;
        uint64_t    Revision = 0u;
        bool        ContactHit = false;
        bool        TextWanted = false;
        float       ContactAcross = 0.0f, ContactDown = 0.0f;
    };

    [[nodiscard]] bool Active() const noexcept { return !Displays.empty(); }
    [[nodiscard]] const std::vector<Display>& QueryDisplays() const noexcept { return Displays; }
    [[nodiscard]] bool PointerCaptured() const noexcept { for (const Display& D : Displays) if (D.ContactHit) return true; return false; }
    /// 📦 True while a display has a focused text field — the host then routes typing to the display, not to game keys.
    [[nodiscard]] bool TextWanted() const noexcept { for (const Display& D : Displays) if (D.TextWanted) return true; return false; }

    /// 📦 Enumerates the project's displays and binds each sheet to its named material (emission channel).
    /// out   Refusal [-] names the display whose material is missing; such a display is skipped, not fatal
    uint32_t Construct(SceneStructure& Scene, TextureIndex& Textures, const CodeInterchange& Project, std::string& Refusal)
    {
        Displays.clear();
        Refusal.clear();
        if (!Project.DisplayAvailable()) return 0u;
        for (uint32_t Ordinal = 0u; Ordinal < 16u; ++Ordinal)
        {
            FrontierProjectDisplayReading Reading{};
            Reading.StructureSize = sizeof(Reading); Reading.InterchangeNumber = 2u; Reading.Ordinal = Ordinal;
            const uint32_t Status = Project.ProjectDisplay(Reading);
            if (Status == 0u) break;
            if (Status != 1u || !Reading.SubjectName || Reading.Width == 0u || Reading.Height == 0u) { Refusal = "project display record refused"; continue; }
            Display D;
            D.SubjectName = Reading.SubjectName;
            const std::vector<MaterialDescriptor>& Materials = Scene.QueryMaterials().QueryDescriptors();
            for (uint32_t M = 0u; M < Materials.size(); ++M) if (Materials[M].Name == D.SubjectName) { D.Material = M; break; }
            if (D.Material == 0xFFFFFFFFu) { Refusal = "no material named " + D.SubjectName + " for a project display"; continue; }
            D.Width = Reading.Width; D.Height = Reading.Height;
            Scratch.assign(static_cast<size_t>(D.Width) * D.Height * 4u, 0u);
            Reading.Capacity = static_cast<uint32_t>(Scratch.size()); Reading.Texels = Scratch.data();
            if (Project.ProjectDisplay(Reading) != 1u) { Refusal = "project display " + D.SubjectName + " refused its first sheet"; continue; }
            D.Revision = Reading.Revision;
            D.Slot = Textures.RegisterTexels("Display:" + D.SubjectName, Scratch.data(), D.Width, D.Height, /*Linear=*/false);
            Bind(Scene, D, Reading.Luminance);
            Displays.push_back(D);
        }
        return static_cast<uint32_t>(Displays.size());
    }

    /// 📦 Polls every display; copies a moved revision into its slot and queues the GPU refresh.
    /// in    Ray     [m,-] pointer ray in world (null = no pointer); Pressed primary button
    /// in    TypedText UTF-8 typed this frame (null = none); delivered only to displays that asked for text last tick
    /// out   Reupload true when a sheet changed size and the caller must Finalise + UploadScene again
    bool Advance(SceneStructure& Scene, TextureIndex& Textures, SwapchainExchange& Surface, const CodeInterchange& Project,
                 const float* RayOrigin, const float* RayDirection, bool Pressed, bool& Reupload, const char* TypedText = nullptr)
    {
        Reupload = false;
        for (uint32_t Ordinal = 0u; Ordinal < Displays.size(); ++Ordinal)
        {
            Display& D = Displays[Ordinal];
            FrontierProjectDisplayReading Reading{};
            Reading.StructureSize = sizeof(Reading); Reading.InterchangeNumber = 2u; Reading.Ordinal = Ordinal;
            if (RayOrigin && RayDirection)
            {
                std::memcpy(Reading.RayOrigin, RayOrigin, sizeof(Reading.RayOrigin));
                std::memcpy(Reading.RayDirection, RayDirection, sizeof(Reading.RayDirection));
            }
            Reading.Pressed = Pressed ? 1u : 0u;
            Reading.TypedText = D.TextWanted ? TypedText : nullptr;
            if (Project.ProjectDisplay(Reading) != 1u) continue;
            D.ContactHit = Reading.ContactHit != 0u; D.ContactAcross = Reading.ContactAcross; D.ContactDown = Reading.ContactDown;
            D.TextWanted = Reading.TextWanted != 0u;
            if (Reading.Width == 0u || Reading.Height == 0u) continue;
            const bool Resized = Reading.Width != D.Width || Reading.Height != D.Height;
            if (!Resized && Reading.Revision == D.Revision) continue;
            Scratch.resize(static_cast<size_t>(Reading.Width) * Reading.Height * 4u);
            Reading.Capacity = static_cast<uint32_t>(Scratch.size()); Reading.Texels = Scratch.data();
            if (Project.ProjectDisplay(Reading) != 1u) continue;
            D.Revision = Reading.Revision;
            D.Width = Reading.Width; D.Height = Reading.Height;
            // Same shape: overwrite level 0 in place and let the device blit the mip chain (the CPU chain plus a
            //    full re-register cost 15-20 ms per sheet — at a 30 Hz cluster that was the throttle-time stutter).
            if (!Resized && D.Slot < Textures.QueryCount() && Textures.RefreshTexels(D.Slot, Scratch.data(), D.Width, D.Height))
            {
                if (!Surface.QueueTextureRefresh(D.Slot, Textures.QueryTextures()[D.Slot], /*LevelZeroOnly=*/true)) Reupload = true;   // device shape mismatch: full path
                continue;
            }
            D.Slot = Textures.RegisterTexels("Display:" + D.SubjectName, Scratch.data(), D.Width, D.Height, false);
            if (Resized || D.Slot >= Textures.QueryCount()) { Bind(Scene, D, Reading.Luminance); Reupload = true; continue; }
            if (!Surface.QueueTextureRefresh(D.Slot, Textures.QueryTextures()[D.Slot])) Reupload = true;   // shape mismatch on the device: fall back to the full path
        }
        return true;
    }

private:
    void Bind(SceneStructure& Scene, const Display& D, float Luminance) noexcept
    {
        MaterialDescriptor* M = Scene.AccessMaterials().AccessDescriptor(D.Material);
        if (!M || D.Slot == 0xFFFFFFFFu) return;
        if (M->Slabs.empty()) M->Slabs.emplace_back();
        MaterialSlabDescriptor& S = M->Slabs.front();
        S.Texture(MaterialTextureChannel::Emission).Texture = D.Slot;
        S.Texture(MaterialTextureChannel::Emission).Channel = TextureChannelSelection::Rgb;
        if (Luminance > 0.0f) S.EmissionLuminance = Luminance;
        S.EmissionColor[0] = S.EmissionColor[1] = S.EmissionColor[2] = 1.0f;
        if (S.EmissionLuminance > 0.0f) M->Flags |= MaterialFlagEmissive;
        // The header radiance (light sampling, luminaire power) is the sheet's MEAN emission, measured from the texels
        //    actually bound: a launcher that is 90 % dark glass must not light the cabin as a white panel. Re-measured
        //    whenever the material is rebound (first sheet, resize); between those the per-hit texture carries the detail.
        const size_t Count = static_cast<size_t>(D.Width) * D.Height;
        if (Count > 0u && Scratch.size() >= Count * 4u)
        {
            double Sum[3] = { 0.0, 0.0, 0.0 };
            for (size_t Texel = 0u; Texel < Count; ++Texel)
                for (int C = 0; C < 3; ++C)
                {
                    const float Encoded = Scratch[Texel * 4u + C] / 255.0f;
                    Sum[C] += Encoded <= 0.04045f ? Encoded / 12.92f : std::pow((Encoded + 0.055f) / 1.055f, 2.4f);
                }
            for (int C = 0; C < 3; ++C) M->EmissionTextureMean[C] = static_cast<float>(Sum[C] / static_cast<double>(Count));
        }
    }

    std::vector<Display> Displays;
    std::vector<uint8_t> Scratch;
};

} // namespace Frontier::HostRuntime
