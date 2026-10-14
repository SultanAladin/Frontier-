# SurfaceDisplay proofs

CPU sheets, no GPU: `python Tools/Tests/CheckSurfaceDisplay.py` (uses `ExternalPackages/`; `--packages` to point elsewhere).

| Sheet | What it shows |
|---|---|
| `Tablet_Launchpad.png`, `Tablet_<app>.png` | The ported tablet: launcher and each app (climate, drive-room, garage, settings, telemetry, tyres, vehicle), Inter typeface, same layout as the HTML prototype. |
| `Tablet_Design_*.png` | The Settings launcher picker: five launcher designs on the same sheet. |
| `Tablet_Narrow.png` | A narrower per-car tablet specification — the launcher reflows; images keep their aspect (no-stretch assertion). |
| `Cluster_Arc/Hexagon/Pill/Trapezoid.png` | The instrument cluster in four irregular outlines; the shape is a mask, the content is never squashed. |
| `Cabin_DriverEye.png` | Diagnostic flat projection of the real ControlVehicle from the driver's seat: tablet (mint) on the centre dash, cluster (amber) ahead of the wheel, headliner lamp overhead. |
| `Cabin_Cutaway.png`, `Cabin_Plan.png` | Exterior three-quarter and plan views with roof and glazing removed, showing where the fixtures sit relative to the body. |

Placement is an estimate (`DriveCabinLayout.h`) because the ControlVehicle mesh has no HMI or steering sockets; the proof also
checks that a ray from the driver's eye to the tablet centre lands on the middle pixel through the same `DisplayTouchProjection`
pose the DLL uses. In-engine, the screens are emissive materials (`Display:CabinTablet`, `Display:DriverCluster`) whose sheets are
refreshed each cycle through `Host/DisplaySequence.h`, so they are luminaires in the GI pass like the lamps.
