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


## Reconstructed flight and incline checks

Run the actual production simulation recordings from the repository root:

```powershell
python Tools/Tests/CheckDriveFlight.py --compiler cl.exe --jobs 4
python Tools/Tests/CheckDriveTumble.py --compiler cl.exe --rigid-only
```

On Linux omit `--compiler cl.exe`. The complete matrix records four two-wheel
ramps, 26 signed six-second midair spins, eight spinning landings and 30
brake/friction/heading incline cases. Drive mounts are disconnected and body
damping is disabled. `--selection core` records 14 core scenarios; a case-name
substring selects focused runs. `--duration` is explicitly shortened diagnostics,
not a full matrix certificate. Failures still write traces and source/output hashes.

`CheckDriveFlightDeformation.py` differentiates recorded co-material particle
positions. `CheckDriveTumbleEnergy.py --output <folder>` preserves the separate
2500 J / 3% necessary bound. The stricter flight bound is 100 J / 0.1% and cannot
be padded with initial spawn altitude. Neither is exact coupled conservation.
`--sanitize` enables GCC/Clang ASan/UBSan; published short scopes are not the full
matrix under sanitizers. Locked dependency headers are verified/restored from
`ExternalPackages/Dependencies.lock.json` by `DependencyCodec.py`.

Publish actual recorded nodes and motion using the shared CPU raster:

```powershell
python Tools/Tests/RunDriveFlightExhibit.py --compiler cl.exe --jobs 2
```

The publisher needs Pillow, NumPy, matplotlib and imageio-ffmpeg. `--compile-only`
builds just the CPU motion renderer; `--publish-only` requires matching existing
recorded renders. `RunDriveTumbleExhibit.py` calls the same consolidated publisher.
Open `Exhibits/Gallery/ProjectDrive/flight-and-slopes.html` for GIFs, MP4s, energy
and deformation graphs, full compressed traces and preserved failed checks.
`render-references.html` contains newly regenerated shared raster, SDF and ReSTIR
CPU references, not GPU screenshots. The comparison baseline is explicitly only
a fresh half-second reconstruction-start diagnostic, not lost historical data.

Reconstruction checkpoints are committed and pushed ONLY to the fixed
`arena/561c913e-frontier` branch; no merge or push to main is performed. Each push
is verified against the remote branch commit. `flight/ReconstructedSource.patch`
is a source-only recovery archive against approved revision
`1784c866a700bfe7a5d208fadf1ac2c5dfc625dc`; dependencies and scratch builds are
regenerable and not included. Fresh evidence is backed up in a separate commit.
