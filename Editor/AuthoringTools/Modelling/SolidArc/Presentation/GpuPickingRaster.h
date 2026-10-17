#pragma once
#include "RasterExchange.h"
#include <memory>

namespace Frontier {
// Native GLES3 ID/depth attachment. Authored NURBS and vertex streams stay CPU-owned;
// only GPU-generated IDs are read back for selection. Visible PNGs remain CPU reference.
// Opt in with SOLIDARC_GPU_PICKING_LIBRARY_DIR (ANGLE/system EGL + GLES libraries).
// An explicitly requested backend must initialize successfully: no silent CPU pick fallback.
std::unique_ptr<RasterExchange> CreateEditorRaster(uint32_t Width,uint32_t Height);
const char* NativePickingDriver() noexcept;
}
