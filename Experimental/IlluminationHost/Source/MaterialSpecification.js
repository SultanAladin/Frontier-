//============================================================================================================================================
//                                                         MATERIALSPECIFICATION.JS
//============================================================================================================================================
// 🧩 The surface reflectance schema, index-aligned with DriveCourse.h CourseMaterial and DriveSceneAuthor::AuthorMaterials.

// 📝 Families 0..15 carry the Project-Drive values verbatim (linear Rec.709, read from ControlVehicle.blend by
//    ExtractVehicle.py). Families 16.. are the exhibit's illumination set: walls and a tunnel whose only purpose is to
//    give the indirect term large coloured surfaces to carry, beside a course that is otherwise one horizontal plane.
export const CourseMaterial = Object.freeze({
    CheckerLight:    0,
    CheckerDark:     1,
    Surround:        2,
    Ramp:            3,
    Bump:            4,
    Cone:            5,
    BodyCoat:        6,
    VehicleGlass:    7,
    VehiclePlastic:  8,
    Tyre:            9,
    Hub:             10,
    Brake:           11,
    VehicleTrim:     12,
    Headlight:       13,
    Taillight:       14,
    VehicleDefault:  15,
    WallCrimson:     16,
    WallViridian:    17,
    WallChalk:       18,
    WallCobalt:      19,
    TunnelConcrete:  20,
    StressAmber:     21,
    StressTeal:      22,
    StressViolet:    23,
    StressIvory:     24,
    StressLamp:      25,
    // 📝 The proving grounds. The road families 26–31 are contiguous: the surface raster lays tyre rubber on exactly
    //    that range (MarkedFamilyFirst … MarkedFamilyLast), and TyreRubber is the family a marked pixel becomes.
    Asphalt:         26,
    AsphaltPatch:    27,
    ApronConcrete:   28,
    PaintWhite:      29,
    PaintYellow:     30,
    KerbRed:         31,
    TyreRubber:      32,
    Grass:           33,
    Gravel:          34,
    Cladding:        35,
    ContainerOrange: 36,
    ContainerBlue:   37,
    ContainerGreen:  38,
    ContainerWhite:  39,
    ContainerRed:    40,
    SteelDark:       41,
    LampWarm:        42,
    LampCool:        43,
    BarrierConcrete: 44,
    SeatBlue:        45,
    // 📝 Fracture: each breakable material has its outer skin and the interior a crack exposes.
    Wood:            46,
    WoodInterior:    47,
    Glass:           48,
    GlassEdge:       49,
    Concrete:        50,
    ConcreteInterior:51,
    Stone:           52,
    StoneInterior:   53,
    Plastic:         54,
    PlasticInterior: 55,
    Tempered:        56,
    TemperedEdge:    57,
    // 📝 The training arena. PaintGreen and PaintBlue are road paint too: they form the second marked range
    //    (MarkedFamilyExtraFirst … MarkedFamilyExtraLast) so rubber lands on them like on the white and yellow.
    PaintGreen:      58,
    PaintBlue:       59,
    ConeOrange:      60,
    ConeBand:        61,
    ConeBase:        62,
    // 📝 The derez / rez effect: the glowing cells of a vehicle coming apart or assembling, and the stutter of a glitch.
    DerezGlow:       63,
    DerezHot:        64,
    DerezGlitch:     65,
    GateLamp:        66,
    GateLampRed:     67,
    SignBoard:       68,
    SignLetter:      69,
    // 📝 The cabin (CabinStructure.js): trim, leather and brushed metal; the steering wheel is a family of its own so
    //    the vertex stage can turn it about the column, and the screens and mirrors are dark cover glass the cabin
    //    overlay draws their pictures onto.
    CabinLeather:    70,
    CabinTrim:       71,
    CabinAccent:     72,
    SteeringWheel:   73,
    DisplayGlass:    74,
    MirrorGlass:     75,
    SeatFabric:      76,
    CabinCarpet:     77,
    MirrorTrim:      78,    // the rear-view mirror's housing and stem: CabinTrim's finish, fixed to the shell, not the cockpit
    WheelRim:         79,   // the alloy wheel rim (spokes, dish, barrel) configurable from the HMI Garage
    PreviousBodyCoat: 80,   // pre-ripple BodyCoat during the 3D spherical material wave transition
    PreviousWheelRim: 81,   // pre-ripple WheelRim during the 3D spherical material wave transition
    PreviousHub:      82    // pre-ripple Hub during the 3D spherical material wave transition
});

//============================================================================================================================================
//                                                    VEHICLE CONFIGURATOR CATALOGUE
//============================================================================================================================================

export function HexToLinearRgb(Hex)
{
    const Clean = String(Hex || "#ffffff").replace(/^#/, "");
    const Value = parseInt(Clean, 16);
    const Srgb = [((Value >> 16) & 255) / 255.0, ((Value >> 8) & 255) / 255.0, (Value & 255) / 255.0];
    return Srgb.map((Channel) => Channel <= 0.04045 ? Channel / 12.92 : Math.pow((Channel + 0.055) / 1.055, 2.4));
}

export const VehiclePaintCatalogue = Object.freeze([
    { id: "lime",   name: "Frontier Lime",  hex: "#adc600", metallic: true,  authored: true },
    { id: "silver", name: "Nebula Silver",  hex: "#c2c8d0", metallic: true  },
    { id: "black",  name: "Obsidian Black", hex: "#17191d", metallic: true  },
    { id: "red",    name: "Command Red",    hex: "#8a1a1d", metallic: true  },
    { id: "blue",   name: "Tactical Blue",  hex: "#1c3f73", metallic: true  },
    { id: "sand",   name: "Moab Sand",      hex: "#b2946a", metallic: false },
    { id: "green",  name: "Recon Green",    hex: "#33442f", metallic: false },
    { id: "white",  name: "Arctic White",   hex: "#e7ebef", metallic: true  },
    { id: "copper", name: "Copper Bronze",  hex: "#8c5a2e", metallic: true  }
]);

export const VehicleFinishModes = Object.freeze([
    { id: "gloss", name: "Gloss", clearcoat: 1.0,  clearcoatRoughness: 0.03 },
    { id: "matte", name: "Matte", clearcoat: 0.06, clearcoatRoughness: 0.62 }
]);

export const VehicleWheelCatalogue = Object.freeze([
    { id: "trail",    name: "Trail Beadlock", size: '22"', rangeDelta: -18, spokes: 6,  rim: "#2b2e33", hub: "#2868c7", machined: false },
    { id: "sport",    name: "Machined Sport", size: '24"', rangeDelta: -12, spokes: 5,  rim: "#c9ced4", hub: "#1d4ed8", machined: true  },
    { id: "blackout", name: "Blackout Mesh",  size: '22"', rangeDelta: 0,   spokes: 10, rim: "#0e0f11", hub: "#38bdf8", machined: false },
    { id: "bronze",   name: "Bronze Forged",  size: '24"', rangeDelta: -8,  spokes: 7,  rim: "#9a6a2f", hub: "#d97706", machined: true  }
]);

export function CloneMaterialRecord(Record)
{
    return {
        Albedo: Record.Albedo.slice(),
        Roughness: Record.Roughness,
        Metalness: Record.Metalness,
        Emission: Record.Emission.slice(),
        CoatWeight: Record.CoatWeight,
        CoatRoughness: Record.CoatRoughness,
        SpecularLevel: Record.SpecularLevel,
        Transmission: Record.Transmission
    };
}

export function ResolvePaintMaterial(PaintId, FinishId = "gloss")
{
    const Paint = VehiclePaintCatalogue.find((Item) => Item.id === PaintId) || VehiclePaintCatalogue[0];
    const Finish = VehicleFinishModes.find((Item) => Item.id === FinishId) || VehicleFinishModes[0];
    const Matte = Finish.id === "matte";
    if (Paint.authored && !Matte)
    {
        return {
            Albedo: [0.680005 * 0.78, 0.800458 * 0.78, 0.0],
            Roughness: 0.0775,
            Metalness: 0.0,
            Emission: [0.0, 0.0, 0.0],
            CoatWeight: 1.0,
            CoatRoughness: 0.03,
            SpecularLevel: 0.04,
            Transmission: 0.0
        };
    }
    const Albedo = Paint.authored ? [0.680005 * 0.78, 0.800458 * 0.78, 0.0] : HexToLinearRgb(Paint.hex);
    const Roughness = Matte ? 0.62 : (Paint.metallic ? 0.09 : 0.24);
    const Metalness = Matte ? (Paint.metallic ? 0.35 : 0.10) : (Paint.metallic ? 0.55 : 0.08);
    return {
        Albedo,
        Roughness,
        Metalness,
        Emission: [0.0, 0.0, 0.0],
        CoatWeight: Finish.clearcoat,
        CoatRoughness: Finish.clearcoatRoughness,
        SpecularLevel: 0.05,
        Transmission: 0.0
    };
}

export function ResolveWheelMaterials(WheelId)
{
    const Wheel = VehicleWheelCatalogue.find((Item) => Item.id === WheelId) || VehicleWheelCatalogue[0];
    const RimRgb = HexToLinearRgb(Wheel.rim);
    const HubRgb = HexToLinearRgb(Wheel.hub);
    return {
        Rim: {
            Albedo: RimRgb,
            Roughness: Wheel.machined ? 0.16 : 0.38,
            Metalness: Wheel.machined ? 0.88 : 0.55,
            Emission: [0.0, 0.0, 0.0],
            CoatWeight: Wheel.machined ? 0.65 : 0.25,
            CoatRoughness: 0.12,
            SpecularLevel: 0.05,
            Transmission: 0.0
        },
        Hub: {
            Albedo: HubRgb,
            Roughness: 0.22,
            Metalness: 0.45,
            Emission: [0.0, 0.0, 0.0],
            CoatWeight: 0.45,
            CoatRoughness: 0.10,
            SpecularLevel: 0.05,
            Transmission: 0.0
        }
    };
}

export const MarkedFamilyFirst = CourseMaterial.Asphalt;   // [-]
export const MarkedFamilyLast  = CourseMaterial.KerbRed;   // [-]
export const MarkedFamilyExtraFirst = CourseMaterial.PaintGreen;   // [-]
export const MarkedFamilyExtraLast  = CourseMaterial.PaintBlue;    // [-]

// 📝 The default derez palette (the Particle Editor's "Derez cube": #35d6ff glow, #ffffff hot core; "Glitch
//    dissolve": #ff2d6f), as linear emission. The VFX inspector rewrites these three records when edited.
export const DerezPalette = Object.freeze({
    Glow:   [0.035, 0.67, 1.0],
    Hot:    [1.0, 1.0, 1.0],
    Glitch: [1.0, 0.026, 0.159]
});

// 📝 The flake headroom and sweep follow DriveSceneAuthor: MetalicCoat (0.680005, 0.800458, 0) × 0.78, coat roughness
//    0.03 as authored, flake-layer specular roughness 0.055 + 0.045·0.5 from AuthorAutomotiveShowcase profile 4.
const BodyCoatHeadroom = 0.78;   // [-] - DriveSceneAuthor's flake headroom

function Dielectric(Red, Green, Blue, Roughness)
{
    return { Albedo: [Red, Green, Blue], Roughness, Metalness: 0.0, Emission: [0.0, 0.0, 0.0],
             CoatWeight: 0.0, CoatRoughness: 0.0, SpecularLevel: 0.04, Transmission: 0.0 };
}

export function ConstructMaterialSpecification()
{
    const Materials = [];
    Materials[CourseMaterial.CheckerLight] = Dielectric(0.82, 0.82, 0.84, 0.35);
    Materials[CourseMaterial.CheckerDark]  = Dielectric(0.05, 0.05, 0.06, 0.35);
    Materials[CourseMaterial.Surround]     = Dielectric(0.35, 0.36, 0.38, 0.55);
    Materials[CourseMaterial.Ramp]         = Dielectric(0.42, 0.43, 0.45, 0.40);
    Materials[CourseMaterial.Bump]         = Dielectric(0.90, 0.72, 0.08, 0.45);
    Materials[CourseMaterial.Cone]         = Dielectric(0.95, 0.35, 0.05, 0.40);

    const Coat = Dielectric(0.680005 * BodyCoatHeadroom, 0.800458 * BodyCoatHeadroom, 0.0, 0.0775);
    Coat.CoatWeight    = 1.0;
    Coat.CoatRoughness = 0.03;
    Materials[CourseMaterial.BodyCoat] = Coat;

    // 📝 Smoked glazing: 26–30 % transmission over a dark cabin, carried as a near-black gloss with its transmission
    //    recorded so the display stage can lift it slightly toward the cabin colour.
    const Glass = Dielectric(0.026, 0.028, 0.030, 0.02);
    Glass.Transmission = 1.0;
    Materials[CourseMaterial.VehicleGlass] = Glass;

    Materials[CourseMaterial.VehiclePlastic] = Dielectric(0.012, 0.014, 0.018, 0.50);
    Materials[CourseMaterial.Tyre]           = Dielectric(0.03741, 0.03741, 0.03741, 0.76087);

    const Hub = Dielectric(0.06, 0.22, 0.62, 0.22);
    Hub.Metalness = 1.0;
    Hub.Emission  = [0.0 * 0.12, 0.277313 * 0.12, 1.0 * 0.12];
    Materials[CourseMaterial.Hub] = Hub;

    const Brake = Dielectric(0.30, 0.075, 0.025, 0.29);
    Brake.Metalness = 0.82;
    Materials[CourseMaterial.Brake] = Brake;

    Materials[CourseMaterial.VehicleTrim] = Dielectric(0.8, 0.8, 0.8, 0.50);

    const Headlight = Dielectric(0.8, 0.8, 0.8, 0.10);
    Headlight.Emission = [48.699997, 48.699997, 48.699997];
    Materials[CourseMaterial.Headlight] = Headlight;

    const Taillight = Dielectric(0.8, 0.8, 0.8, 0.10);
    Taillight.Emission = [6.5 * 1.0, 6.5 * 0.0, 6.5 * 0.016442];
    Materials[CourseMaterial.Taillight] = Taillight;

    Materials[CourseMaterial.VehicleDefault] = Dielectric(0.8, 0.8, 0.8, 0.50);

    Materials[CourseMaterial.WallCrimson]    = Dielectric(0.72, 0.05, 0.04, 0.65);
    Materials[CourseMaterial.WallViridian]   = Dielectric(0.05, 0.52, 0.16, 0.65);
    Materials[CourseMaterial.WallChalk]      = Dielectric(0.80, 0.80, 0.78, 0.75);
    Materials[CourseMaterial.WallCobalt]     = Dielectric(0.07, 0.20, 0.72, 0.65);
    Materials[CourseMaterial.TunnelConcrete] = Dielectric(0.56, 0.55, 0.52, 0.85);

    // 📝 The stress-test palette: saturated diffuse colours so the added objects carry visible colour bleeding, and
    //    one warm emitter (one slot in eleven) so a night scene full of objects is lit by the objects themselves.
    Materials[CourseMaterial.StressAmber]  = Dielectric(0.86, 0.46, 0.07, 0.55);
    Materials[CourseMaterial.StressTeal]   = Dielectric(0.05, 0.50, 0.50, 0.50);
    Materials[CourseMaterial.StressViolet] = Dielectric(0.38, 0.12, 0.62, 0.55);
    Materials[CourseMaterial.StressIvory]  = Dielectric(0.80, 0.78, 0.72, 0.60);
    const Lamp = Dielectric(0.90, 0.85, 0.75, 0.40);
    Lamp.Emission = [6.0, 4.1, 1.9];
    Materials[CourseMaterial.StressLamp] = Lamp;

    // 📝 Proving grounds. Asphalt ≈ 0.05–0.08 albedo, weathered concrete ≈ 0.4, road paint ≈ 0.75: measured orders
    //    of magnitude, so the indirect term sees a dark road between bright aprons, as it would outdoors.
    Materials[CourseMaterial.Asphalt]         = Dielectric(0.055, 0.056, 0.060, 0.82);
    Materials[CourseMaterial.AsphaltPatch]    = Dielectric(0.078, 0.076, 0.074, 0.78);
    Materials[CourseMaterial.ApronConcrete]   = Dielectric(0.42, 0.41, 0.39, 0.88);
    Materials[CourseMaterial.PaintWhite]      = Dielectric(0.78, 0.78, 0.76, 0.55);
    Materials[CourseMaterial.PaintYellow]     = Dielectric(0.80, 0.56, 0.05, 0.55);
    Materials[CourseMaterial.KerbRed]         = Dielectric(0.62, 0.05, 0.04, 0.60);
    Materials[CourseMaterial.TyreRubber]      = Dielectric(0.016, 0.016, 0.017, 0.55);
    Materials[CourseMaterial.Grass]           = Dielectric(0.09, 0.19, 0.05, 0.95);
    Materials[CourseMaterial.Gravel]          = Dielectric(0.33, 0.30, 0.26, 0.95);
    const Cladding = Dielectric(0.52, 0.55, 0.58, 0.42);
    Cladding.Metalness = 0.65;
    Materials[CourseMaterial.Cladding]        = Cladding;
    Materials[CourseMaterial.ContainerOrange] = Dielectric(0.76, 0.24, 0.04, 0.55);
    Materials[CourseMaterial.ContainerBlue]   = Dielectric(0.04, 0.15, 0.44, 0.55);
    Materials[CourseMaterial.ContainerGreen]  = Dielectric(0.06, 0.33, 0.13, 0.55);
    Materials[CourseMaterial.ContainerWhite]  = Dielectric(0.74, 0.74, 0.71, 0.55);
    Materials[CourseMaterial.ContainerRed]    = Dielectric(0.56, 0.06, 0.05, 0.55);
    const Steel = Dielectric(0.10, 0.10, 0.11, 0.38);
    Steel.Metalness = 1.0;
    Materials[CourseMaterial.SteelDark]       = Steel;
    const Warm = Dielectric(0.95, 0.90, 0.80, 0.30);
    Warm.Emission = [14.0, 10.2, 6.0];
    Materials[CourseMaterial.LampWarm]        = Warm;
    const Cool = Dielectric(0.90, 0.92, 0.95, 0.30);
    Cool.Emission = [7.0, 8.4, 10.0];
    Materials[CourseMaterial.LampCool]        = Cool;
    Materials[CourseMaterial.BarrierConcrete] = Dielectric(0.60, 0.60, 0.57, 0.85);
    Materials[CourseMaterial.SeatBlue]        = Dielectric(0.05, 0.20, 0.55, 0.50);

    // 📝 Fracture skins and interiors (FractureEditor materials.ts colours, linearised).
    Materials[CourseMaterial.Wood]             = Dielectric(0.46, 0.24, 0.07, 0.75);
    Materials[CourseMaterial.WoodInterior]     = Dielectric(0.69, 0.47, 0.21, 0.82);
    const Pane = Dielectric(0.10, 0.15, 0.17, 0.04);
    Pane.SpecularLevel = 0.06;
    Materials[CourseMaterial.Glass]            = Pane;
    Materials[CourseMaterial.GlassEdge]        = Dielectric(0.45, 0.66, 0.70, 0.20);
    Materials[CourseMaterial.Concrete]         = Dielectric(0.34, 0.34, 0.31, 0.95);
    Materials[CourseMaterial.ConcreteInterior] = Dielectric(0.27, 0.26, 0.23, 0.97);
    Materials[CourseMaterial.Stone]            = Dielectric(0.20, 0.20, 0.19, 0.92);
    Materials[CourseMaterial.StoneInterior]    = Dielectric(0.29, 0.25, 0.21, 0.95);
    Materials[CourseMaterial.Plastic]          = Dielectric(0.69, 0.09, 0.03, 0.42);
    Materials[CourseMaterial.PlasticInterior]  = Dielectric(0.87, 0.48, 0.37, 0.50);
    const Tempered = Dielectric(0.12, 0.18, 0.20, 0.06);
    Tempered.SpecularLevel = 0.06;
    Materials[CourseMaterial.Tempered]         = Tempered;
    Materials[CourseMaterial.TemperedEdge]     = Dielectric(0.58, 0.76, 0.80, 0.25);

    // 📝 Training arena paint and the slalom cone: fluorescent orange PVC (a little self-luminous under daylight, as
    //    fluorescent pigment is), retroreflective collars and a black recycled-rubber base.
    Materials[CourseMaterial.PaintGreen] = Dielectric(0.08, 0.48, 0.16, 0.55);
    Materials[CourseMaterial.PaintBlue]  = Dielectric(0.05, 0.22, 0.62, 0.55);
    const ConeOrange = Dielectric(0.92, 0.22, 0.02, 0.36);
    ConeOrange.Emission = [0.09, 0.022, 0.0];
    ConeOrange.CoatWeight = 0.35;
    ConeOrange.CoatRoughness = 0.18;
    Materials[CourseMaterial.ConeOrange] = ConeOrange;
    const ConeBand = Dielectric(0.86, 0.87, 0.88, 0.22);
    ConeBand.Emission = [0.05, 0.05, 0.052];
    ConeBand.SpecularLevel = 0.08;
    Materials[CourseMaterial.ConeBand] = ConeBand;
    Materials[CourseMaterial.ConeBase] = Dielectric(0.025, 0.025, 0.027, 0.85);
    const Glow = Dielectric(0.05, 0.10, 0.12, 0.30);
    Glow.Emission = DerezPalette.Glow.map((Channel) => Channel * 5.0);
    Materials[CourseMaterial.DerezGlow] = Glow;
    const Hot = Dielectric(0.20, 0.20, 0.20, 0.30);
    Hot.Emission = DerezPalette.Hot.map((Channel) => Channel * 10.0);
    Materials[CourseMaterial.DerezHot] = Hot;
    const Glitch = Dielectric(0.10, 0.03, 0.05, 0.30);
    Glitch.Emission = DerezPalette.Glitch.map((Channel) => Channel * 5.0);
    Materials[CourseMaterial.DerezGlitch] = Glitch;
    const GateLamp = Dielectric(0.30, 0.90, 0.40, 0.30);
    GateLamp.Emission = [1.2, 9.0, 2.4];
    Materials[CourseMaterial.GateLamp] = GateLamp;
    const GateLampRed = Dielectric(0.90, 0.20, 0.15, 0.30);
    GateLampRed.Emission = [9.0, 1.0, 0.6];
    Materials[CourseMaterial.GateLampRed] = GateLampRed;
    Materials[CourseMaterial.SignBoard] = Dielectric(0.035, 0.037, 0.042, 0.60);
    const Letter = Dielectric(0.82, 0.82, 0.80, 0.45);
    Letter.Emission = [1.6, 1.6, 1.55];
    Materials[CourseMaterial.SignLetter] = Letter;
    // 📝 Cabin: charcoal leather and soft-touch trim (≈ 4–6 % albedo, as automotive interiors measure), satin
    //    aluminium accents, near-black cover glass for the displays and a silvered mirror base.
    Materials[CourseMaterial.CabinLeather] = Dielectric(0.045, 0.040, 0.038, 0.55);
    Materials[CourseMaterial.CabinTrim]    = Dielectric(0.030, 0.031, 0.034, 0.72);
    const Accent = Dielectric(0.62, 0.63, 0.65, 0.32);
    Accent.Metalness = 1.0;
    Materials[CourseMaterial.CabinAccent]  = Accent;
    Materials[CourseMaterial.SteeringWheel] = Dielectric(0.040, 0.036, 0.034, 0.50);
    const Cover = Dielectric(0.008, 0.009, 0.010, 0.06);
    Cover.SpecularLevel = 0.05;
    Materials[CourseMaterial.DisplayGlass] = Cover;
    const Silver = Dielectric(0.10, 0.10, 0.11, 0.05);
    Silver.Metalness = 1.0;
    Materials[CourseMaterial.MirrorGlass]  = Silver;
    Materials[CourseMaterial.SeatFabric]   = Dielectric(0.055, 0.060, 0.075, 0.85);
    Materials[CourseMaterial.CabinCarpet]  = Dielectric(0.028, 0.028, 0.030, 0.95);
    Materials[CourseMaterial.MirrorTrim]   = Materials[CourseMaterial.CabinTrim];
    const DefaultWheel = ResolveWheelMaterials("trail");
    Materials[CourseMaterial.WheelRim]         = DefaultWheel.Rim;
    Materials[CourseMaterial.PreviousBodyCoat] = CloneMaterialRecord(Materials[CourseMaterial.BodyCoat]);
    Materials[CourseMaterial.PreviousWheelRim] = CloneMaterialRecord(Materials[CourseMaterial.WheelRim]);
    Materials[CourseMaterial.PreviousHub]      = CloneMaterialRecord(Materials[CourseMaterial.Hub]);
    return Materials;
}

// 📝 48-byte records matching MaterialRecord in SceneRecords.wgsl.
export function EncodeMaterialRecords(Materials)
{
    const Scalars = new Float32Array(Materials.length * 12);
    Materials.forEach((Material, Index) =>
    {
        const Offset = Index * 12;
        Scalars.set([...Material.Albedo, Material.Roughness, ...Material.Emission, Material.Metalness,
                     Material.CoatWeight, Material.CoatRoughness, Material.SpecularLevel, Material.Transmission], Offset);
    });
    return Scalars;
}
