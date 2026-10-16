//============================================================================================================================================
//                                                            CABINOVERLAY.WGSL
//============================================================================================================================================
// 🧩 What the deferred raster cannot carry: see-through glazing, the HMI's two screens and the mirrors' pictures, drawn over it.

// 📝 Drawn into the recombined radiance before the temporal antialiasing, depth-tested (read only) against the opaque
//    surface, premultiplied over what is there:
//
//    | Kind    | Geometry                                  | What it adds                                             |
//    |---------|-------------------------------------------|----------------------------------------------------------|
//    | glass   | the body's glazing facets                 | the sky's Fresnel reflection and a sun glint; lets 70 %   |
//    |         |                                           | of the cabin (or the world, from inside) through          |
//    | tablet  | the centre-stack screen, 1.5 mm proud      | the TabletPanel launcher (its canvas), with the Garage's  |
//    |         |                                           | live car composited into its preview well                |
//    | cluster | the binnacle's hexagon                     | the TabletPanel cluster (its canvas, alpha to the outline)|
//    | mirror  | each mirror's glass                        | the reflected view ForwardRaster rendered for it          |
//
//    The screens are self-lit (Luminance, in the scene's radiance units where sunlit white is about 5 — DriveCabin-
//    Layout's 3 and 3.5), so they read the same in a dark cabin and at noon; their cover glass still reflects the sky.
//    The derez mask applies here too: glass, screens and mirrors come apart with the car.

//! include "FrameDescriptor.wgsl"
//! include "SkyProjection.wgsl"
//! include "EffectRecords.wgsl"
//! include "TyreCarcass.wgsl"

struct OverlayRecord
{
    Tablet   : vec4f,   // x luminance, y brightness [0, 1], z garage preview shown (1), w unused
    Preview  : vec4f,   // xy top-left, zw bottom-right of the preview well in tablet UV
    Corner   : vec4f,   // xy the well's corner radius in UV, z cluster luminance, w unused
    Glass    : vec4f,   // x transmission at normal incidence, y mirror reflectance, z mirrors live (1), w unused
}

@group(0) @binding(1) var<storage, read> Occupants    : array<OccupantRecord>;
@group(0) @binding(2) var<uniform> Overlay            : OverlayRecord;
@group(0) @binding(3) var<uniform> Effect             : EffectRecord;
@group(0) @binding(4) var<storage, read> VehicleState : VehicleRecord;
@group(0) @binding(5) var TabletTexture               : texture_2d<f32>;
@group(0) @binding(6) var ClusterTexture              : texture_2d<f32>;
@group(0) @binding(7) var PreviewTexture              : texture_2d<f32>;
@group(0) @binding(8) var MirrorTexture               : texture_2d_array<f32>;
@group(0) @binding(9) var LinearSampler               : sampler;
@group(0) @binding(10) var SkyView                    : texture_2d<f32>;
@group(0) @binding(11) var SkySampler                 : sampler;

const KindGlass   : u32 = 0u;
const KindTablet  : u32 = 1u;
const KindCluster : u32 = 2u;
const KindMirror  : u32 = 3u;
const KindCurtain : u32 = 4u;

struct OverlayVarying
{
    @builtin(position) Position             : vec4f,
    @location(0) Normal                     : vec3f,
    @location(1) Coordinates                : vec2f,
    @location(2) WorldPosition              : vec3f,
    @location(3) BodyLocal                  : vec3f,
    @location(4) @interpolate(flat) Kind    : u32,
    @location(5) @interpolate(flat) Layer   : u32,
}

@vertex
fn OverlayVertex(@location(0) Position: vec3f, @location(1) Kind: u32, @location(2) Normal: vec3f, @location(3) Layer: f32,
                 @location(4) Coordinates: vec2f) -> OverlayVarying
{
    let Body = Occupants[0];
    // 📝 The two screens are cockpit fixtures: they scale and shift with it (the glazing and the mirrors stay with the
    //    shell). Screens and mirrors sit 1.5 mm proud of their cover facets so they win the depth test against them.
    var Placed = select(Position, PlaceCockpit(Position), Kind == KindTablet || Kind == KindCluster);
    if (Kind == KindCurtain)
    {
        Placed = vec3f(VehicleState.ScanState.x, Position.y, Position.z);
    }
    let Lifted = Placed + Normal * select(0.0015, 0.0, Kind == KindGlass || Kind == KindCurtain);
    let World = Body.LocalToWorld * vec4f(Lifted, 1.0);
    var Varying: OverlayVarying;
    Varying.Position = Frame.ViewProjection * World;
    Varying.Normal = (Body.LocalToWorld * vec4f(Normal, 0.0)).xyz;
    Varying.Coordinates = Coordinates;
    Varying.WorldPosition = World.xyz;
    Varying.BodyLocal = Lifted;
    Varying.Kind = Kind;
    Varying.Layer = u32(Layer + 0.5);
    return Varying;
}

fn ClassifyMasked(BodyLocal: vec3f) -> bool
{
    if (Effect.MaskMode == 0u)
    {
        return false;
    }
    if (Effect.MaskMode == 3u)
    {
        return true;
    }
    let Unit = (BodyLocal - Effect.BodyMinimum.xyz) / max(Effect.BodyMaximum.xyz - Effect.BodyMinimum.xyz, vec3f(1.0e-3));
    let Elapsed = Effect.Clock - Effect.MaskStart;
    let Seed = u32(Effect.Emitters[0].Centre.w);
    if (Effect.MaskMode == 1u)
    {
        return Elapsed >= ResolveDerezRelease(Unit, Seed, Effect.Style, 1.0);
    }
    return Elapsed < ResolveRezArrival(Unit, Seed, Effect.Style, 1.0);
}

fn SampleSky(Direction: vec3f) -> vec3f
{
    return textureSampleLevel(SkyView, SkySampler, ProjectSkyCoordinates(Direction), 0.0).rgb * Frame.SkyScale + Frame.NightSkyRadiance;
}

// 📐 Rounded-rectangle coverage of the preview well in tablet UV (aspect-correct corner radii).
fn ResolveWellCoverage(Coordinates: vec2f) -> f32
{
    let Low = Overlay.Preview.xy;
    let High = Overlay.Preview.zw;
    if (any(Coordinates < Low) || any(Coordinates > High))
    {
        return 0.0;
    }
    let Radius = Overlay.Corner.xy;
    let Inner = clamp(Coordinates, Low + Radius, High - Radius);
    let Offset = (Coordinates - Inner) / max(Radius, vec2f(1.0e-5));
    return select(1.0, 0.0, dot(Offset, Offset) > 1.0);
}

@fragment
fn OverlayFragment(Varying: OverlayVarying) -> @location(0) vec4f
{
    if (ClassifyMasked(Varying.BodyLocal))
    {
        discard;
    }
    let View = normalize(Frame.CameraPosition - Varying.WorldPosition);
    var Normal = normalize(Varying.Normal);
    if (dot(Normal, View) < 0.0)
    {
        Normal = -Normal;
    }
    let NdotV = clamp(dot(Normal, View), 0.0, 1.0);
    let Fresnel = 0.04 + 0.96 * pow(1.0 - NdotV, 5.0);
    let Reflected = reflect(-View, Normal);
    var Reflection = SampleSky(Reflected) * Fresnel;
    // 📝 A sun glint on the glass: a narrow lobe of the sun's illuminance.
    let Glint = pow(max(dot(Reflected, Frame.SunDirection), 0.0), 900.0) * 60.0;
    Reflection += Frame.SunIlluminance * (Glint * Fresnel);

    if (Varying.Kind == KindGlass)
    {
        if (VehicleState.Cabin.y < 0.5 || ResolveScanVisibility(Varying.BodyLocal) > 0.25)
        {
            discard;
        }
        let Transmission = Overlay.Glass.x * (1.0 - Fresnel);
        return vec4f(Reflection, 1.0 - Transmission);
    }
    if (Varying.Kind == KindCurtain)
    {
        let Holo = VehicleState.ScanState.y;
        if (Holo <= 0.01 || VehicleState.ScanState.z < 0.5 || VehicleState.ScanState.z > 1.5)
        {
            discard;
        }
        let Edge = 1.0 - max(abs(Varying.Coordinates.x - 0.5) * 2.0, abs(Varying.Coordinates.y - 0.5) * 2.0);
        let Border = smoothstep(0.0, 0.08, Edge) * (1.0 - smoothstep(0.06, 0.22, Edge));
        let Grid = smoothstep(0.92, 1.0, max(sin(Varying.Coordinates.x * 94.0) * 0.5 + 0.5, sin(Varying.Coordinates.y * 62.0) * 0.5 + 0.5));
        let CurtainAlpha = clamp((0.06 + Border * 0.42 + Grid * 0.14) * Holo, 0.0, 0.65);
        let CurtainRadiance = mix(vec3f(0.22, 0.72, 0.96), vec3f(0.55, 0.88, 1.0), Border + Grid * 0.5) * Frame.EmissionScale * 0.85;
        return vec4f(CurtainRadiance * CurtainAlpha, CurtainAlpha);
    }
    if (Varying.Kind == KindTablet)
    {
        let TabletTexel = textureSampleLevel(TabletTexture, LinearSampler, Varying.Coordinates, 0.0);
        var Picture = TabletTexel.rgb;
        if (Overlay.Tablet.z > 0.5)
        {
            let Well = ResolveWellCoverage(Varying.Coordinates);
            if (Well > 0.0)
            {
                let Inside = (Varying.Coordinates - Overlay.Preview.xy) / max(Overlay.Preview.zw - Overlay.Preview.xy, vec2f(1.0e-5));
                let PreviewColour = textureSampleLevel(PreviewTexture, LinearSampler, Inside, 0.0).rgb;
                Picture = mix(Picture, mix(PreviewColour, TabletTexel.rgb, TabletTexel.a), Well);
            }
        }
        let Emitted = Picture * Overlay.Tablet.x * Overlay.Tablet.y * Frame.EmissionScale;
        return vec4f(Emitted * (1.0 - Fresnel) + Reflection, 1.0);
    }
    if (Varying.Kind == KindCluster)
    {
        let Texel = textureSampleLevel(ClusterTexture, LinearSampler, Varying.Coordinates, 0.0);
        let Emitted = Texel.rgb * Texel.a * Overlay.Corner.z * Overlay.Tablet.y * Frame.EmissionScale;
        return vec4f(Emitted * (1.0 - Fresnel) + Reflection, 1.0);
    }
    // 📝 Mirror: the reflected view, or the sky alone until a mirror has been rendered.
    var Mirrored = SampleSky(Reflected);
    if (Overlay.Glass.z > 0.5)
    {
        Mirrored = textureSampleLevel(MirrorTexture, LinearSampler, Varying.Coordinates, Varying.Layer, 0.0).rgb;
    }
    return vec4f(Mirrored * Overlay.Glass.y, 1.0);
}

//------------------------------------------------------------------------------------------------------------------------
//                                      VEHICLE HOLOGRAM GHOST + WIREFRAME OVERLAY
//------------------------------------------------------------------------------------------------------------------------

struct GhostVarying
{
    @builtin(position) Position            : vec4f,
    @location(0) Normal                    : vec3f,
    @location(1) @interpolate(flat) Family : u32,
    @location(2) WorldPosition             : vec3f,
    @location(3) BodyLocal                 : vec3f,
    @location(4) Barycentric               : vec3f,
}

@vertex
fn GhostVertex(@location(0) Position: vec3f, @location(1) Family: u32, @location(2) Normal: vec3f,
               @location(3) OccupantOffset: u32, @builtin(instance_index) OccupantIndex: u32,
               @builtin(vertex_index) VertexIndex: u32) -> GhostVarying
{
    let Index = OccupantIndex + OccupantOffset;
    let Occupant = Occupants[Index];
    var Moved: DeformedVertex;
    Moved.Position = Position;
    Moved.Normal = Normal;
    if (Index >= 1u && Index < 5u)
    {
        Moved = DeformTyre(Index - 1u, Position, Normal);
    }
    else if (Index == 0u)
    {
        Moved = DeformBodyVertex(Family, Position, Normal);
    }
    let World = Occupant.LocalToWorld * vec4f(Moved.Position, 1.0);
    let ViewRay = normalize(Frame.CameraPosition - World.xyz);
    let Corner = VertexIndex % 3u;
    var Varying: GhostVarying;
    // 📝 Bias 1.5 mm toward the camera so the wireframe and hologram shell sit cleanly on top of any surviving opaque facets.
    Varying.Position = Frame.ViewProjection * vec4f(World.xyz + ViewRay * 0.0015, 1.0);
    Varying.Normal = (Occupant.LocalToWorld * vec4f(Moved.Normal, 0.0)).xyz;
    Varying.Family = select(Family, Occupant.MaterialOverride, Occupant.MaterialOverride != NoMaterialOverride);
    Varying.WorldPosition = World.xyz;
    Varying.BodyLocal = (Occupants[0].WorldToLocal * World).xyz;
    Varying.Barycentric = vec3f(select(0.0, 1.0, Corner == 0u), select(0.0, 1.0, Corner == 1u), select(0.0, 1.0, Corner == 2u));
    return Varying;
}

@fragment
fn GhostFragment(Varying: GhostVarying) -> @location(0) vec4f
{
    if (IsCockpitFamily(Varying.Family) || Varying.Family == MirrorGlassFamily)
    {
        discard;
    }
    if (ClassifyMasked(Varying.BodyLocal))
    {
        discard;
    }
    let ScanVis = ResolveScanVisibility(Varying.BodyLocal);
    if (ScanVis <= 0.004)
    {
        discard;
    }
    var Normal = normalize(Varying.Normal);
    let ViewDirection = normalize(Frame.CameraPosition - Varying.WorldPosition);
    if (dot(Normal, ViewDirection) < 0.0)
    {
        Normal = -Normal;
    }
    let Derivative = max(fwidth(Varying.Barycentric), vec3f(1.0e-4));
    let EdgeDist = Varying.Barycentric / Derivative;
    let MinEdge = min(EdgeDist.x, min(EdgeDist.y, EdgeDist.z));
    let WireFactor = 1.0 - smoothstep(0.42, 1.28, MinEdge);

    let Fres = pow(1.0 - abs(dot(Normal, ViewDirection)), 2.3);
    let Lines = smoothstep(0.72, 1.0, sin(Varying.BodyLocal.z * 85.0) * 0.5 + 0.5);
    let WaveEdge = ResolveScanWaveEdge(Varying.BodyLocal);

    let HoloBase = vec3f(0.42, 0.80, 0.94);
    let HoloAccent = vec3f(0.10, 0.58, 0.98);
    let WireColour = vec3f(0.36, 0.82, 0.98);

    let WireOnly = VehicleState.ScanState.z > 2.5;
    let ShellAlpha = select(clamp((0.06 + Fres * 0.44 + Lines * 0.05 + WaveEdge * 0.34) * ScanVis, 0.0, 0.72), 0.0, WireOnly);
    let WireAlpha = WireFactor * clamp(0.58 * ScanVis + WaveEdge * 0.32, 0.0, 0.92);
    let Alpha = max(ShellAlpha, WireAlpha);
    if (Alpha <= 0.004)
    {
        discard;
    }
    let ShellColour = mix(HoloBase, HoloAccent, clamp(WaveEdge * 1.35 + Fres * 0.25, 0.0, 1.0)) * (1.0 + WaveEdge * 0.85);
    let Combined = (ShellColour * ShellAlpha + WireColour * WireAlpha * 1.35) * Frame.EmissionScale * 0.78;
    return vec4f(Combined, Alpha * 0.65);
}
