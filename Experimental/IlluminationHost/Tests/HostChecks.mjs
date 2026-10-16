//============================================================================================================================================
//                                                           HOSTCHECKS.MJS
//============================================================================================================================================
// 🧩 Headless checks for the exhibit's CPU solvers and geometry — no browser, no WebGPU device, just Node.
//
// 📝 Usage:  node Experimental/IlluminationHost/Tests/HostChecks.mjs
//    Covers the soft-tyre carcass (patch formation, flat-tyre pinch and folds), the vehicle solver (it drives,
//    it steers), the spark projection (sparks leave along the slide, off the surface), the cabin geometry (trim
//    inside the shell, wheel rim true, the dashboard cell plan) and the interior cameras (the cockpit eye is the
//    HMI fixture's). Shader compilation is checked separately by Tests/ValidateShaders.mjs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const Here = dirname(fileURLToPath(import.meta.url));
const Root = join(Here, "..");
const Import = (Name) => import(join(Root, "Source", Name));

let Failures = 0;
function Check(Name, Condition, Detail = "")
{
    console.log(`${Condition ? "PASS" : "FAIL"}  ${Name}${Detail ? ` — ${Detail}` : ""}`);
    if (!Condition)
        ++Failures;
}
const Near = (Value, Target, Tolerance) => Math.abs(Value - Target) <= Tolerance;

//------------------------------------------------------------------------------------------------------------------------
//                                                       SOFT TYRES
//------------------------------------------------------------------------------------------------------------------------

const { TyreCarcassSolver, CarcassSpecification } = await Import("TyreCarcassSolver.js");
{
    const Radius = 0.50855;
    const Solver = new TyreCarcassSolver(Radius, 0.34460, 0.198);
    const Contact = (Pressure, HubDistance) => ({ InContact: true, HubDistance, DownAngle: -Math.PI / 2,
                                                  Pressure, LateralForce: 0.0, Shredded: false });
    // an inflated tyre under a corner's static load: the belt flattens by roughly the hub's drop
    Solver.Advance([0, 1, 2, 3].map(() => Contact(220000, Radius - 0.016)), 0.75);
    const Inflated = Solver.Wheels[0];
    Check("carcass forms a contact patch", Inflated.PatchNodes >= 4 && Near(Inflated.Peak, 0.016, 0.006),
          `peak ${Inflated.Peak.toFixed(4)} m over ${Inflated.PatchNodes} nodes`);
    Check("inflated tyre throws no folds", Inflated.Wrinkle === 0.0 && Near(Inflated.Bulge, 0.55, 0.01),
          `bulge ${Inflated.Bulge.toFixed(2)}`);

    // the same corner with the air gone: the ring pinches at the rim and the sidewalls fold
    const Flat = new TyreCarcassSolver(Radius, 0.34460, 0.198);
    Flat.Advance([0, 1, 2, 3].map(() => Contact(0, Radius - 0.150)), 0.75);
    Check("flat tyre pinches at the rim", Flat.Wheels[0].Pinched === true,
          `peak ${Flat.Wheels[0].Peak.toFixed(4)} m of ${(0.50855 - 0.34460 - CarcassSpecification.PinchClearance).toFixed(4)} m available`);
    Check("flat tyre folds and bulges", Flat.Wheels[0].Wrinkle > 0.010 && Flat.Wheels[0].Bulge > 1.2,
          `wrinkle ${(Flat.Wheels[0].Wrinkle * 1000).toFixed(1)} mm, bulge ${Flat.Wheels[0].Bulge.toFixed(2)}`);

    // airborne, the ring rings back to round
    Solver.Advance([0, 1, 2, 3].map(() => ({ InContact: false, HubDistance: Infinity, DownAngle: 0.0,
                                              Pressure: 220000, LateralForce: 0.0, Shredded: false })), 1.5);
    Check("airborne carcass relaxes round", Solver.Wheels[0].Peak < 0.002, `peak ${(Solver.Wheels[0].Peak * 1000).toFixed(2)} mm`);

    const Records = new Float32Array(Solver.EncodeRecords());
    Check("carcass records encode", Near(Records[0], Radius, 1.0e-6) && Records.length === 4 * (12 + 96),
          `${Records.length} floats for four wheels`);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      VEHICLE SOLVER
//------------------------------------------------------------------------------------------------------------------------

const { VehicleSolver } = await Import("VehicleSolver.js");
{
    const Vehicle = new VehicleSolver([]);
    const Drive = { Throttle: 1.0, Brake: 0.0, Steer: 0.0, Handbrake: false };
    // Advance caps each call at its substep budget, exactly as the host feeds it per frame — so step at 60 Hz
    for (let Frame = 0; Frame < 360; ++Frame)
        Vehicle.Advance(Drive, 1.0 / 60.0);
    const Telemetry = Vehicle.QueryTelemetry();
    Check("vehicle drives under throttle", Telemetry.Speed > 8.0, `${(Telemetry.Speed * 3.6).toFixed(0)} km/h after 6 s`);
    Check("tyres stay on the road", Telemetry.Contacts >= 3, `${Telemetry.Contacts}/4 contacts`);
    for (let Frame = 0; Frame < 60; ++Frame)
        Vehicle.Advance({ ...Drive, Throttle: 0.0, Steer: 1.0 }, 1.0 / 60.0);
    Check("steering lock builds", Vehicle.QueryTelemetry().SteerAngle > 0.05,
          `${(Vehicle.QueryTelemetry().SteerAngle * 57.29578).toFixed(0)}°`);
    Check("telemetry carries pressures", Vehicle.QueryTelemetry().Pressures.every((Kpa) => Kpa > 150.0),
          Vehicle.QueryTelemetry().Pressures.map((Kpa) => Kpa.toFixed(0)).join(" · ") + " kPa");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         SPARKS
//------------------------------------------------------------------------------------------------------------------------

const { ProjectSparkEmitter } = await Import("EmberIntegrator.js");
{
    // a rim sliding backward along the road: sparks stream along the slide, tipped up, tightly coned
    const Rim = ProjectSparkEmitter({ Point: [1, 2, 0.05], Velocity: [-9, 1, 0], Normal: [0, 0, 1],
                                      Strength: 1.0, Kind: "rim" });
    const Speed = Math.hypot(...Rim.Velocity);
    const AlongSlide = (Rim.Velocity[0] * -9 + Rim.Velocity[1] * 1) / (Speed * Math.hypot(-9, 1));
    Check("rim sparks follow the slide", AlongSlide > 0.85, `cos ${(AlongSlide).toFixed(2)}`);
    Check("rim sparks leave the surface", Rim.Velocity[2] > 0.4, `up ${Rim.Velocity[2].toFixed(2)} m/s`);
    Check("spark cone is tight", Rim.Spread < 0.9, `spread ${Rim.Spread.toFixed(2)} m/s`);

    // a sill scraping a wall on its left: sparks sheet along the wall, never through it
    const Sill = ProjectSparkEmitter({ Point: [0, 1, 0.3], Velocity: [12, -0.5, 0], Normal: [0, 1, 0],
                                       Strength: 1.0, Kind: "chassis" });
    Check("chassis sparks sheet along the wall", Sill.Velocity[1] > 0.0 && Sill.Velocity[0] > 4.0,
          `(${Sill.Velocity.map((Scalar) => Scalar.toFixed(1)).join(", ")})`);
    Check("chassis sparks run cooler than rim sparks", Sill.Temperature < Rim.Temperature,
          `${Sill.Temperature.toFixed(0)} K vs ${Rim.Temperature.toFixed(0)} K`);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          CABIN
//------------------------------------------------------------------------------------------------------------------------

const Cabin = await Import("CabinStructure.js");
const { DecodeFacetStream } = await Import("FacetCodec.js");
{
    const Trim = Cabin.EmitCabinTrimFacets();
    const Points = Trim.flatMap((Facet) => Facet.Corners);
    const Bounds = [0, 1, 2].map((Axis) => [Math.min(...Points.map((P) => P[Axis])), Math.max(...Points.map((P) => P[Axis]))]);
    Check("cabin trim is authored", Trim.length > 60, `${Trim.length} facets`);
    Check("trim stays inside the shell", Bounds[0][0] > -1.7 && Bounds[0][1] < 1.4
          && Math.abs(Bounds[1][0]) <= 1.06 && Math.abs(Bounds[1][1]) <= 1.06 && Bounds[2][0] >= 0.0 && Bounds[2][1] < 1.24,
          `x ${Bounds[0].map((V) => V.toFixed(2))} · y ${Bounds[1].map((V) => V.toFixed(2))} · z ${Bounds[2].map((V) => V.toFixed(2))}`);

    const Wheel = Cabin.EmitSteeringWheelFacets();
    const RimExtent = Math.max(...Wheel.flatMap((Facet) => Facet.Corners).map((P) => Math.hypot(P[1], P[2])));
    Check("steering rim is true", Near(RimExtent, Cabin.CabinFixtures.WheelRadius + 0.016, 0.002),
          `outer ${(RimExtent * 1000).toFixed(0)} mm`);

    const Plan = Cabin.ConstructCabinCellPlan();
    Check("dashboard cell plan", Plan.WheelCells.length === 12 && Plan.WheelTyreCells.length === 4
          && Plan.ClusterCells.length === 10 && Plan.TabletTiles.length === 8,
          "12 wheel RPM · 4 tyre · 10 cluster · 8 tiles");

    // the authored body splits into shell and glazing with nothing lost
    const Stream = DecodeFacetStream(readFileSync(join(Root, "Archive", "ControlVehicleBody.facet")).buffer);
    const Glass = Stream.Families.filter((Family) => Family === 7).length;
    Check("body stream carries glazing to split out", Glass > 40 && Glass < Stream.FacetCount,
          `${Glass} of ${Stream.FacetCount} facets are VehicleGlass`);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      INTERIOR CAMERAS
//------------------------------------------------------------------------------------------------------------------------

const { ResolveCabinCamera, ClassifyInteriorCamera } = await Import("CabinCameraSolver.js");
const { ConstructIdentityTransform } = await Import("TransformProjection.js");
{
    const Cockpit = ResolveCabinCamera("cockpit", ConstructIdentityTransform(), { Yaw: 0.0, Pitch: 0.0 });
    Check("cockpit eye is the HMI fixture", Cockpit.Position.every((Value, Axis) =>
          Near(Value, Cabin.CabinFixtures.DriverEye[Axis], 1.0e-6)), Cockpit.Position.map((V) => V.toFixed(2)).join(", "));
    Check("cockpit looks forward and down", Cockpit.Target[0] > Cockpit.Position[0] && Cockpit.Target[2] < Cockpit.Position[2]);
    Check("interior modes classify", ClassifyInteriorCamera("wheel") && !ClassifyInteriorCamera("chase"));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       SCENE ASSEMBLY
//------------------------------------------------------------------------------------------------------------------------

{
    // ConstructScene retrieves the facet archives by URL; answer from disk instead.
    const RealFetch = globalThis.fetch;
    globalThis.fetch = async (Location) =>
    {
        const Bytes = readFileSync(join(Root, Location));
        return { ok: true, arrayBuffer: async () => Bytes.buffer.slice(Bytes.byteOffset, Bytes.byteOffset + Bytes.byteLength) };
    };
    const { SceneStructure } = await Import("FacetStructure.js");
    const Scene = new SceneStructure();
    await Scene.ConstructScene("Archive");
    globalThis.fetch = RealFetch;

    const Cabin = Scene.CabinOccupants;
    const Fixtures = (await Import("CabinStructure.js")).CabinFixtures;
    Check("cabin occupants registered", !!Cabin && Scene.CabinCount === 39, `${Scene.CabinCount} occupants`);
    Check("cabin sits outside the distance span", Scene.CabinFirst >= Scene.DistanceCount,
          `cabin from ${Scene.CabinFirst}, distance span ${Scene.DistanceCount}`);
    const BodyFacets = Scene.FacetSets[Scene.Occupants[Scene.VehicleOccupants.Body].FacetSet].Facets.length;
    const GlassFacets = Scene.FacetSets[Scene.Occupants[Cabin.Glass].FacetSet].Facets.length;
    Check("shell and glazing partition the authored body", BodyFacets + GlassFacets === 2924 && GlassFacets === 74,
          `${BodyFacets} shell + ${GlassFacets} glass`);
    Check("glass casts no shadow", Scene.Occupants[Cabin.Glass].NoShadow === true
          && !Scene.ShadowRuns.some((Run) => Cabin.Glass >= Run.First && Cabin.Glass < Run.First + Run.Count));
    Check("cabin rasters", Scene.RasterRuns.some((Run) => Cabin.Wheel >= Run.First && Cabin.Wheel < Run.First + Run.Count));
    const Records = Scene.EncodeOccupantRecords(null);
    Check("occupant records encode", Records.length === Scene.Occupants.length * 84,
          `${Scene.Occupants.length} occupants`);
    const Mount = Scene.CabinWheelMount;
    Check("wheel mount sits at the fixture", Near(Mount[12], Fixtures.WheelCentre[0], 1.0e-6)
          && Near(Mount[14], Fixtures.WheelCentre[2], 1.0e-6)
          && Scene.CabinRig.every((Entry) => (Entry.Parent === "body" || Entry.Parent === "wheel")
          && Entry.Local.length === 16 && Entry.Local.every(Number.isFinite)),
          `${Scene.CabinRig.length} rig entries`);
}

console.log(Failures === 0 ? "\nall host checks pass" : `\n${Failures} host check(s) failed`);
process.exit(Failures === 0 ? 0 : 1);
