//============================================================================================================================================
//                                                          CABINCAMERASOLVER.JS
//============================================================================================================================================
// 🧩 Interior debug cameras: poses fixed in the cabin (body/CoM) frame, carried into the world by the body transform.

// 📝 The cockpit pose is the HMI demo's own (DriveCabinLayout's CabinDriverEyeFixture): the driver's eye a hand
//    behind the cluster, pitched down 0.21 rad inside a 70° vertical view so the cluster, the wheel dashboard and
//    the tablet all fall in frame. The others are debug vantage points — over the wheel, from the passenger seat,
//    from the rear bench, into the footwell. Dragging while one is active looks around from its eye (CabinLook).

import { TransformPoint, TransformDirection, ConstructAxisQuaternion, RotateVector } from "./TransformProjection.js";
import { CabinFixtures } from "./CabinStructure.js";

export const InteriorCameraModes = new Set(["cockpit", "wheel", "passenger", "dash", "footwell"]);
export const CameraModeOrder = ["chase", "cockpit", "wheel", "passenger", "dash", "footwell", "free"];

// 📝 Eye views look along a cabin-frame direction; target views look at a cabin-frame point (drag does not move them).
const Views = Object.freeze({
    cockpit:   { Eye: CabinFixtures.DriverEye, Pitch: CabinFixtures.DriverPitch, FieldOfView: CabinFixtures.DriverFieldOfView },
    passenger: { Eye: [-0.20, -0.42, CabinFixtures.DriverEye[2]], Pitch: 0.18, FieldOfView: 1.15 },
    wheel:     { Eye: [0.02, -0.16, 0.94], Target: [0.60, 0.42, 0.70], FieldOfView: 0.90 },
    dash:      { Eye: [-1.32, 0.00, 1.04], Target: [0.78, 0.22, 0.64], FieldOfView: 1.25 },
    footwell:  { Eye: [0.10, 0.42, 0.58], Target: [1.12, 0.44, 0.02], FieldOfView: 1.00 }
});

export function ClassifyInteriorCamera(Mode)
{
    return InteriorCameraModes.has(Mode);
}

// 📝 Look: { Yaw, Pitch } [rad] the pointer drag accumulates — yaw about the cabin's +Z, pitch about its +Y,
//    applied to an eye view's forward before the body transform carries it into the world.
export function ResolveCabinCamera(Mode, BodyTransform, Look)
{
    const View = Views[Mode] || Views.cockpit;
    const Eye = TransformPoint(BodyTransform, View.Eye);
    if (View.Target)
        return { Position: Eye, Target: TransformPoint(BodyTransform, View.Target),
                 VerticalFieldOfView: View.FieldOfView, Near: 0.03 };
    let Direction = [Math.cos(View.Pitch), 0.0, -Math.sin(View.Pitch)];
    Direction = RotateVector(ConstructAxisQuaternion([0.0, 1.0, 0.0], Look.Pitch), Direction);
    Direction = RotateVector(ConstructAxisQuaternion([0.0, 0.0, 1.0], Look.Yaw), Direction);
    const World = TransformDirection(BodyTransform, Direction);
    return { Position: Eye, Target: [Eye[0] + World[0] * 5.0, Eye[1] + World[1] * 5.0, Eye[2] + World[2] * 5.0],
             VerticalFieldOfView: View.FieldOfView, Near: 0.03 };
}
