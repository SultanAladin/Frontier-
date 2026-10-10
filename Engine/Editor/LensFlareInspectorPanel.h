#pragma once
#include "EditorInstance.h"
#include <cstdint>
struct ImTextureData;
namespace Frontier {
class ControlPanel;
void RecordLensFlareInspector(ControlPanel&,EditorInstance&,EditorSheet&) noexcept;
// Authoring-resource inspection/export. Context-owned; no project or GPU ownership crosses this API.
struct LensFlarePreviewDetails { const ImTextureData* Texture=nullptr; uint64_t Revision=0, PrecomputedRevision=0; int Width=0,Height=0; };
LensFlarePreviewDetails QueryLensFlarePreview() noexcept;
bool ExportLensFlarePreview(const char* Path) noexcept;
}
