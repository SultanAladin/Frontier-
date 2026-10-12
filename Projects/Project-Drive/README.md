# Project-Drive

Project-Drive is opened by `Frontier.exe`, never by a project-owned windowed executable. Its project specification is
`ProjectDrive.frontier` and its optional code image is `Source/ProjectDriveInterchange.cpp`.

## Ownership

| Capability | Owner |
|---|---|
| Window, Vulkan device, renderer, editor, global camera, input, celestial environment | `Frontier.exe` |
| Raster, RT-off persistent local SDF GI, and ReSTIR RT | shared `Engine/` facilities |
| Drive course, vehicle simulation, driver interpretation, chase-camera requests, vehicle panels | `ProjectDrive.dll` |

The code image reaches host facilities through the versioned `CodeInterchange` C ABI. C++ standard-library records,
exceptions, allocator ownership, Vulkan references, and ImGui records do not cross it.

## Project content

`Source/DriveCourse.h` describes the proving ground shared by the vehicle and its content authoring. The project vehicle
sources keep course and ControlVehicle semantics project-owned. CPU proofs in `Exhibits/Workbench/Automotive`
exercise the actual project solver and authored geometry; they do not claim Vulkan execution.

## Build and opening

Use the authoritative host route:

```powershell
powershell -File Tools\Build\ToolchainSequence.ps1
```

This compiles shared source once into `Frontier.exe`, then links `ProjectDrive.dll` independently. Open the project with:

```text
Frontier.exe Projects/Project-Drive/ProjectDrive.frontier
```

Do not add `DriveExecution.cpp`, a second project `main`, a window owner, or an include into Project-Zero source.

## Play controls and CPU proofs

- W/S: throttle/brake. A/D: steering. Space: handbrake. R: respawn when possessed.
- F8: eject into the host free-flight camera; simulation keeps running and driving input is cut immediately.
- F8 again: repossess the same vehicle and its chase camera. Stop restores the pre-Play editor camera.
- Held F8 never repeats, and text/modal keyboard capture consumes the press without changing possession.

Run `python Tools/Tests/CheckDriveDynamics.py` from the repository root for deterministic force/energy traces.
Add `--sanitize` for GCC/Clang ASan+UBSan. Run `python Tools/Tests/RunDriveExhibit.py` for fresh labelled CPU images/GIFs.
The SDF image is a transport reference, not a Vulkan card-capture or pixel-parity validation.
