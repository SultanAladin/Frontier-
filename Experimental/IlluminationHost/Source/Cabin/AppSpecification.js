//============================================================================================================================================
//                                                          APPSPECIFICATION.JS
//============================================================================================================================================
// 📦 Launcher applications, design identities and fixed device-screen coordinates.

export const ScreenWidth = 1200;
export const ScreenHeight = 750;

export const Applications = [
    { Identifier: "vehicle", Name: "Vehicle", Caption: "Make it your own", Category: "Vehicle", Colour: "#a4e5be" },
    { Identifier: "drive-room", Name: "Drive Room", Caption: "Your people. Your race.", Category: "Connect", Colour: "#ffcf87", Badge: "3" },
    { Identifier: "messages", Name: "Messages", Caption: "Keep the conversation going", Category: "Connect", Colour: "#94caff", Badge: "2" },
    { Identifier: "contacts", Name: "Contacts", Caption: "People worth driving with", Category: "Connect", Colour: "#f4b19b" },
    { Identifier: "navigation", Name: "Navigation", Caption: "Find your next road", Category: "Vehicle", Colour: "#8fe0d0" },
    { Identifier: "media", Name: "Media", Caption: "Set the pace", Category: "Personal", Colour: "#efa5d7" },
    { Identifier: "tyres", Name: "Tyres", Caption: "Every corner counts", Category: "Vehicle", Colour: "#aad9e9" },
    { Identifier: "telemetry", Name: "Telemetry", Caption: "Know your machine", Category: "Vehicle", Colour: "#cbb2ef" },
    { Identifier: "climate", Name: "Climate", Caption: "Your comfort zone", Category: "Personal", Colour: "#a2dbe7" },
    { Identifier: "garage", Name: "Garage", Caption: "A place for your car", Category: "Personal", Colour: "#e5bf95" },
    { Identifier: "account", Name: "Account", Caption: "Always your space", Category: "Connect", Colour: "#b9b4f6" },
    { Identifier: "settings", Name: "Settings", Caption: "The little things", Category: "Personal", Colour: "#c5cfd2" }
];

export const LauncherDesigns = [
    { Identifier: "launchpad", Name: "Launchpad", Caption: "The familiar icon canvas", Number: "01" },
    { Identifier: "dashboard", Name: "Dashboard", Caption: "Big moments. Small cards.", Number: "02" },
    { Identifier: "collections", Name: "Collections", Caption: "A place for everything", Number: "03" },
    { Identifier: "focus", Name: "Focus", Caption: "One app takes the stage", Number: "04" },
    { Identifier: "console", Name: "Console", Caption: "A calm rail. A clear choice.", Number: "05" }
];

// 📝 Exterior paint finishes and forged wheel sets from Experimental/interactive-vehicle-hmi-configurator, plus the
//    authored Frontier Lime coat and Cobalt Alloy rim so the configurator starts in the exhibit's authored finish.
export const VehiclePaintOptions = Object.freeze([
    { Identifier: "lime",   Name: "Frontier Lime",  Hex: "#a8c900", Metallic: true,  Authored: true },
    { Identifier: "silver", Name: "Nebula Silver",  Hex: "#c2c8d0", Metallic: true  },
    { Identifier: "black",  Name: "Obsidian Black", Hex: "#17191d", Metallic: true  },
    { Identifier: "red",    Name: "Command Red",    Hex: "#8a1a1d", Metallic: true  },
    { Identifier: "blue",   Name: "Tactical Blue",  Hex: "#1c3f73", Metallic: true  },
    { Identifier: "sand",   Name: "Moab Sand",      Hex: "#b2946a", Metallic: false },
    { Identifier: "green",  Name: "Recon Green",    Hex: "#33442f", Metallic: false },
    { Identifier: "white",  Name: "Arctic White",   Hex: "#e7ebef", Metallic: true  },
    { Identifier: "copper", Name: "Copper Bronze",  Hex: "#8c5a2e", Metallic: true  }
]);

export const VehicleFinishOptions = Object.freeze(["gloss", "matte"]);

export const VehicleWheelOptions = Object.freeze([
    { Identifier: "cobalt",   Name: "Cobalt Alloy",   Size: '20"', Spokes: 5,  Rim: "#1c4fd9", Machined: true, Authored: true },
    { Identifier: "trail",    Name: "Trail Beadlock", Size: '22"', Spokes: 6,  Rim: "#2b2e33", Machined: false },
    { Identifier: "sport",    Name: "Machined Sport", Size: '24"', Spokes: 5,  Rim: "#c9ced4", Machined: true  },
    { Identifier: "blackout", Name: "Blackout Mesh",  Size: '22"', Spokes: 10, Rim: "#0e0f11", Machined: false },
    { Identifier: "bronze",   Name: "Bronze Forged",  Size: '24"', Spokes: 7,  Rim: "#9a6a2f", Machined: true  }
]);

export const VehicleGhostModes = Object.freeze([
    ["Solid", 0],
    ["X-Ray Sweep", 1],
    ["Ghost + Wire", 2],
    ["Wireframe", 3]
]);

export function ResolveVehiclePaint(Identifier)
{
    return VehiclePaintOptions.find((Option) => Option.Identifier === Identifier) || VehiclePaintOptions[0];
}

export function ResolveVehicleWheel(Identifier)
{
    return VehicleWheelOptions.find((Option) => Option.Identifier === Identifier) || VehicleWheelOptions[0];
}

function SrgbHexToLinear(Hex)
{
    const Clean = String(Hex || "#ffffff").replace("#", "");
    const Value = parseInt(Clean, 16);
    const Channels = [(Value >> 16) & 255, (Value >> 8) & 255, Value & 255].map((Byte) => Byte / 255.0);
    return Channels.map((Channel) => (Channel <= 0.04045 ? Channel / 12.92 : Math.pow((Channel + 0.055) / 1.055, 2.4)));
}

// 📝 Translates a configurator paint swatch + finish ("gloss" | "matte") into a physical MaterialRecord for BodyCoat.
export function ResolvePaintMaterialRecord(PaintId, Finish = "gloss")
{
    const Paint = ResolveVehiclePaint(PaintId);
    const Matte = Finish === "matte";
    if (Paint.Authored && !Matte)
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
    const Linear = Paint.Authored ? [0.680005 * 0.78, 0.800458 * 0.78, 0.0] : SrgbHexToLinear(Paint.Hex);
    const Headroom = Paint.Authored ? 1.0 : 0.88;
    return {
        Albedo: Linear.map((Channel) => Channel * Headroom),
        Roughness: Matte ? 0.68 : Paint.Metallic ? 0.14 : 0.30,
        Metalness: Matte ? (Paint.Metallic ? 0.32 : 0.06) : (Paint.Metallic ? 0.55 : 0.08),
        Emission: [0.0, 0.0, 0.0],
        CoatWeight: Matte ? 0.08 : 1.0,
        CoatRoughness: Matte ? 0.62 : 0.03,
        SpecularLevel: 0.04,
        Transmission: 0.0
    };
}

// 📝 Translates a configurator wheel set into a physical MaterialRecord for Hub (wheel rim).
export function ResolveWheelMaterialRecord(WheelId)
{
    const Wheel = ResolveVehicleWheel(WheelId);
    if (Wheel.Authored)
    {
        return {
            Albedo: [0.06, 0.22, 0.62],
            Roughness: 0.22,
            Metalness: 1.0,
            Emission: [0.0, 0.277313 * 0.12, 1.0 * 0.12],
            CoatWeight: 0.0,
            CoatRoughness: 0.0,
            SpecularLevel: 0.04,
            Transmission: 0.0
        };
    }
    const Linear = SrgbHexToLinear(Wheel.Rim);
    return {
        Albedo: Linear,
        Roughness: Wheel.Machined ? 0.18 : 0.42,
        Metalness: Wheel.Machined ? 0.95 : 0.72,
        Emission: [0.0, 0.0, 0.0],
        CoatWeight: Wheel.Machined ? 0.35 : 0.0,
        CoatRoughness: 0.08,
        SpecularLevel: 0.04,
        Transmission: 0.0
    };
}

export function ResolveApplication(Identifier)
{
    return Applications.find(Application => Application.Identifier === Identifier);
}

export function ResolveDesign(Identifier)
{
    return LauncherDesigns.find(Design => Design.Identifier === Identifier);
}

export function ConstructDesignGlyph(Identifier)
{
    const Start = '<svg class="DesignGlyph" viewBox="0 0 48 34" aria-hidden="true"><rect x="1" y="1" width="46" height="32" rx="5" fill="#dee7d8"/>';
    const Square = (Left, Top, Width = 7, Height = 6, Colour = "#8da48a") => `<rect x="${Left}" y="${Top}" width="${Width}" height="${Height}" rx="1.8" fill="${Colour}"/>`;
    let Content = "";
    if (Identifier === "launchpad")
    {
        for (let Row = 0; Row < 2; ++Row)
            for (let Column = 0; Column < 4; ++Column) Content += Square(6 + Column * 9, 8 + Row * 10);
    }
    else if (Identifier === "dashboard")
    {
        Content += Square(5, 6, 17, 22, "#68896e");
        Content += Square(25, 6, 17, 9);
        Content += Square(25, 18, 7, 10);
        Content += Square(35, 18, 7, 10);
    }
    else if (Identifier === "collections")
    {
        for (let Column = 0; Column < 3; ++Column)
        {
            Content += Square(5 + Column * 13, 6, 11, 22, "#b8c8ad");
            Content += Square(7 + Column * 13, 10, 7, 3, "#759076");
            Content += Square(7 + Column * 13, 17, 7, 3, "#759076");
            Content += Square(7 + Column * 13, 24, 7, 2, "#759076");
        }
    }
    else if (Identifier === "focus")
    {
        Content += Square(2, 10, 7, 15, "#bdcbb5");
        Content += Square(12, 6, 23, 22, "#759076");
        Content += Square(38, 10, 8, 15, "#bdcbb5");
    }
    else
    {
        Content += Square(4, 5, 9, 24, "#7e987b");
        for (let Row = 0; Row < 3; ++Row)
            for (let Column = 0; Column < 2; ++Column) Content += Square(17 + Column * 13, 7 + Row * 7, 10, 5);
    }
    return Start + Content + "</svg>";
}
