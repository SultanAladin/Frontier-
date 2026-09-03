# Project-Zero — Windowed ReSTIR GI Renderer

Real-time Cornell Box rendered on the GPU with **ReSTIR DI + ReSTIR GI** via a
Vulkan compute shader, displayed in a native GLFW window with a live **ImGui
Control Centre** overlay.

---

## Dependencies

| Library  | Version | Install (Windows via vcpkg)                                  | Install (Ubuntu/Debian)              |
|----------|---------|--------------------------------------------------------------|--------------------------------------|
| Vulkan   | 1.2+    | Vulkan SDK from https://vulkan.lunarg.com/                   | `libvulkan-dev`                      |
| GLFW     | 3.3+    | `vcpkg install glfw3:x64-windows`                            | `libglfw3-dev`                       |
| ImGui    | 1.90+   | `vcpkg install imgui[glfw-binding,vulkan-binding]:x64-windows` | clone to `ThirdParty/imgui`         |
| ThorVG   | 0.12+   | `vcpkg install thorvg:x64-windows`                           | `libthorvg-dev`                      |
| glslc    | –       | Included in Vulkan SDK (`$VULKAN_SDK/Bin/glslc.exe`)         | `glslc` or `vulkan-tools`            |

---

## Build — Windows (PowerShell 7)

```powershell
# From the repository root (Frontier/)
pwsh -NoProfile -ExecutionPolicy Bypass `
     -File Projects/Project-Zero/Build/Construct.ps1 `
     -Configuration Release

# Build + launch immediately
pwsh -NoProfile -ExecutionPolicy Bypass `
     -File Projects/Project-Zero/Build/Construct.ps1 `
     -Configuration Release -Run

# Rebuild from scratch
pwsh -NoProfile -ExecutionPolicy Bypass `
     -File Projects/Project-Zero/Build/Construct.ps1 `
     -Configuration Release -Rebuild
```

> **Requirement:** `VULKAN_SDK` and `VCPKG_ROOT` environment variables must be set.

---

## Build — Linux (Bash)

```bash
# Install dependencies (Ubuntu/Debian)
sudo apt install -y libvulkan-dev glslc libglfw3-dev libthorvg-dev pkg-config cmake

# Clone ImGui if not already present
git clone https://github.com/ocornut/imgui.git ThirdParty/imgui

# Build from the repository root
bash Projects/Project-Zero/Build/LinuxBuild.sh Release

# Build + launch
bash Projects/Project-Zero/Build/LinuxBuild.sh Release --run
```

---

## Runtime

Run from the **repository root** (`Frontier/`) so the SPIR-V path resolves:

```
Projects/Project-Zero/bin/Project-Zero       (Linux)
Projects\Project-Zero\bin\Project-Zero.exe   (Windows)
```

The shader binary is expected at:
```
Shaders/ReSTIRViewport.spv   (relative to working directory = repo root)
```

---

## Controls

| Input               | Action                        |
|---------------------|-------------------------------|
| `W / A / S / D`     | Fly forward / strafe          |
| `Q / E`             | Descend / ascend              |
| `RMB + drag`        | Look around (yaw + pitch)     |
| `Scroll wheel`      | Adjust flight speed           |
| `Left Shift`        | 3× speed boost                |
| `Escape`            | Quit                          |

---

## ImGui Control Centre

Docked to the **right edge** of the window. Live-tunable parameters:

- **Camera** — position, orientation, speed, FoV (read-only telemetry)
- **ReSTIR DI + GI** — candidates per pixel, spatial resampling passes, ACES exposure
- **Scene** — Cornell Box triangle / material count, colour-coded surface legend
- **Device** — GPU name, type, Vulkan API version
