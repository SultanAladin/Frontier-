//============================================================================================================================================
//                                                         MATERIALSPECIFICATION.JS
//============================================================================================================================================
// 🧩 The surface reflectance schema, index-aligned with DriveCourse.h CourseMaterial and DriveSceneAuthor::AuthorMaterials.

// 📝 Families 0..15 carry the Project-Drive values verbatim (linear Rec.709, read from ControlVehicle.blend by
//    ExtractVehicle.py). Families 16..20 are the original illumination set. Families 21.. are the drift yard
//    (YardStructure.js): asphalt and paint, shipping containers in their trade colours, a corrugated warehouse with
//    strip lights, floodlight poles, concrete barriers, and the breakable props with the faces their fracture exposes.
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
    Asphalt:         21,
    Apron:           22,
    PaintWhite:      23,
    PaintYellow:     24,
    ContainerRust:   25,
    ContainerCobalt: 26,
    ContainerGreen:  27,
    ContainerOrange: 28,
    ContainerWhite:  29,
    ContainerYellow: 30,
    WarehouseWall:   31,
    WarehouseRoof:   32,
    StripLight:      33,
    PoleMetal:       34,
    Floodlight:      35,
    Barrier:         36,
    BarrierCore:     37,
    KerbRed:         38,
    KerbWhite:       39,
    CrateWood:       40,
    CrateCore:       41,
    BarrelPlastic:   42,
    BarrelCore:      43,
    GlassPane:       44,
    BlockConcrete:   45,
    BlockCore:       46,
    Gravel:          47,
    DockConcrete:    48
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

    // 📝 The yard. Asphalt is dark (≈ 0.08) and the paint on it bright; container colours are the desaturated trade
    //    liveries; the strip lights and floodlights carry emission that the surface cards capture, so at night they
    //    light the yard through the indirect term.
    Materials[CourseMaterial.Asphalt]         = Dielectric(0.095, 0.094, 0.091, 0.86);
    Materials[CourseMaterial.Apron]           = Dielectric(0.36, 0.355, 0.34, 0.82);
    Materials[CourseMaterial.PaintWhite]      = Dielectric(0.70, 0.70, 0.67, 0.62);
    Materials[CourseMaterial.PaintYellow]     = Dielectric(0.72, 0.50, 0.05, 0.62);
    Materials[CourseMaterial.ContainerRust]   = Dielectric(0.36, 0.085, 0.05, 0.62);
    Materials[CourseMaterial.ContainerCobalt] = Dielectric(0.05, 0.13, 0.36, 0.55);
    Materials[CourseMaterial.ContainerGreen]  = Dielectric(0.07, 0.24, 0.12, 0.58);
    Materials[CourseMaterial.ContainerOrange] = Dielectric(0.62, 0.23, 0.04, 0.55);
    Materials[CourseMaterial.ContainerWhite]  = Dielectric(0.58, 0.58, 0.56, 0.6);
    Materials[CourseMaterial.ContainerYellow] = Dielectric(0.62, 0.45, 0.06, 0.55);
    Materials[CourseMaterial.WarehouseWall]   = Dielectric(0.34, 0.36, 0.38, 0.6);
    Materials[CourseMaterial.WarehouseRoof]   = Dielectric(0.24, 0.24, 0.25, 0.7);
    const Strip = Dielectric(0.85, 0.85, 0.82, 0.3);
    Strip.Emission = [48.0, 43.0, 35.0];
    Materials[CourseMaterial.StripLight] = Strip;
    const Pole = Dielectric(0.42, 0.43, 0.44, 0.38);
    Pole.Metalness = 0.85;
    Materials[CourseMaterial.PoleMetal] = Pole;
    const Flood = Dielectric(0.9, 0.85, 0.75, 0.2);
    Flood.Emission = [110.0, 84.0, 52.0];
    Materials[CourseMaterial.Floodlight]      = Flood;
    Materials[CourseMaterial.Barrier]         = Dielectric(0.50, 0.49, 0.46, 0.9);
    Materials[CourseMaterial.BarrierCore]     = Dielectric(0.44, 0.43, 0.40, 0.95);
    Materials[CourseMaterial.KerbRed]         = Dielectric(0.58, 0.05, 0.04, 0.55);
    Materials[CourseMaterial.KerbWhite]       = Dielectric(0.72, 0.72, 0.70, 0.55);
    Materials[CourseMaterial.CrateWood]       = Dielectric(0.40, 0.25, 0.12, 0.8);
    Materials[CourseMaterial.CrateCore]       = Dielectric(0.62, 0.45, 0.25, 0.85);
    Materials[CourseMaterial.BarrelPlastic]   = Dielectric(0.75, 0.21, 0.035, 0.42);
    Materials[CourseMaterial.BarrelCore]      = Dielectric(0.84, 0.58, 0.45, 0.5);
    const Pane = Dielectric(0.07, 0.1, 0.1, 0.04);
    Pane.Transmission = 1.0;
    Materials[CourseMaterial.GlassPane]       = Pane;
    Materials[CourseMaterial.BlockConcrete]   = Dielectric(0.47, 0.46, 0.43, 0.9);
    Materials[CourseMaterial.BlockCore]       = Dielectric(0.41, 0.40, 0.37, 0.95);
    Materials[CourseMaterial.Gravel]          = Dielectric(0.21, 0.19, 0.16, 0.95);
    Materials[CourseMaterial.DockConcrete]    = Dielectric(0.40, 0.39, 0.37, 0.85);
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
