//============================================================================================================================================
//                                                            SURFACERASTER.WGSL
//============================================================================================================================================
// 🧩 Primary visibility: every rastered occupant projected into depth, shading normal, material family and screen motion.

//! include "FrameDescriptor.wgsl"
//! include "PackingCodec.wgsl"
//! include "EffectRecords.wgsl"
//! include "TyreCarcass.wgsl"

@group(0) @binding(1) var<storage, read> Occupants : array<OccupantRecord>;
@group(0) @binding(2) var TyreMarks                 : texture_2d<f32>;   // r deposit [0, 1], g lateral coordinate (0: untouched)
@group(0) @binding(3) var TyreMarkSampler           : sampler;
@group(0) @binding(4) var<uniform> Effect           : EffectRecord;
@group(0) @binding(5) var<storage, read> VehicleState : VehicleRecord;

const VehicleOccupantCount : u32 = 5u;   // the body and four wheels lead the occupant list

struct SurfaceVarying
{
    @builtin(position) Position             : vec4f,
    @location(0) Normal                     : vec3f,
    @location(1) @interpolate(flat) Family  : u32,
    @location(2) CurrentClip                : vec4f,
    @location(3) PreviousClip               : vec4f,
    @location(4) WorldPosition              : vec3f,
    @location(5) @interpolate(flat) Vehicle : u32,
    @location(6) BodyLocal                  : vec3f,   // car-body frame, for the derez mask
}

struct SurfaceTargets
{
    @location(0) Attributes : vec4f,   // xy octahedral shading normal, z material family, w 1 + glow (× albedo, as emission)
    @location(1) Motion     : vec2f,   // [px] current minus previous screen position
}

// 📝 The vehicle's own motion in the vertex stage: the wheels' tyres take their carcass deformation, the cabin's
//    steering wheel turns about its column and the cockpit takes its scale and offset (TyreCarcass.wgsl), before the
//    occupant transform.
fn DeformVehicleVertex(Index: u32, Family: u32, Position: vec3f, Normal: vec3f) -> DeformedVertex
{
    var Moved: DeformedVertex;
    Moved.Position = Position;
    Moved.Normal = Normal;
    if (Index >= 1u && Index < VehicleOccupantCount)
    {
        return DeformTyre(Index - 1u, Position, Normal);
    }
    if (Index == 0u)
    {
        return DeformBodyVertex(Family, Position, Normal);
    }
    return Moved;
}

// 📝 OccupantOffset is zero for every facet but a composite set's: a fractured prop's fragments share one facet set
//    and one draw, each vertex naming its own fragment occupant relative to the draw's first instance.
@vertex
fn SurfaceVertex(@location(0) Position: vec3f, @location(1) Family: u32, @location(2) Normal: vec3f,
                 @location(3) OccupantOffset: u32, @builtin(instance_index) OccupantIndex: u32) -> SurfaceVarying
{
    let Index    = OccupantIndex + OccupantOffset;
    let Occupant = Occupants[Index];
    let Moved    = DeformVehicleVertex(Index, Family, Position, Normal);
    let World    = Occupant.LocalToWorld * vec4f(Moved.Position, 1.0);
    let Previous = Occupant.PreviousLocalToWorld * vec4f(Moved.Position, 1.0);
    var Varying: SurfaceVarying;
    Varying.Position      = Frame.ViewProjection * World;
    Varying.CurrentClip   = Frame.UnjitteredViewProjection * World;
    Varying.PreviousClip  = Frame.PreviousUnjitteredViewProjection * Previous;
    Varying.Normal        = (Occupant.LocalToWorld * vec4f(Moved.Normal, 0.0)).xyz;
    Varying.Family        = select(Family, Occupant.MaterialOverride, Occupant.MaterialOverride != NoMaterialOverride);
    Varying.WorldPosition = World.xyz;
    Varying.Vehicle       = select(0u, 1u, Index < VehicleOccupantCount);
    Varying.BodyLocal     = (Occupants[0].WorldToLocal * World).xyz;
    return Varying;
}

// 📝 Road marks on a marked road pixel, from the two-channel deposit: the deposit is filtered bilinearly, the lateral
//    coordinate among touched texels only (G = 1..127 for 5-rib rubber tread, G = 128..255 for twin-flange bare-rim
//    scrape marks when a tyre is shredded). Returns vec2f(Deposit, IsRimMark).
fn SampleRoadMark(World: vec2f, PixelFootprint: f32) -> vec2f
{
    let Extent = vec2f(TyreMarkExtentX, TyreMarkExtentY);
    let Texels = vec2f(textureDimensions(TyreMarks));
    let Coordinates = (World - vec2f(TyreMarkOriginX, TyreMarkOriginY)) / Extent;
    if (any(Coordinates <= vec2f(0.0)) || any(Coordinates >= vec2f(1.0)))
    {
        return vec2f(0.0, 0.0);
    }
    let Position = Coordinates * Texels - 0.5;
    let Corner = vec2i(floor(Position));
    let Fraction = Position - floor(Position);
    var Deposit = 0.0;
    var Lateral = 0.0;
    var LateralWeight = 0.0;
    var RimWeight = 0.0;
    for (var Tap = 0u; Tap < 4u; Tap++)
    {
        let Offset = vec2i(i32(Tap & 1u), i32(Tap >> 1u));
        let Texel = clamp(Corner + Offset, vec2i(0), vec2i(Texels) - vec2i(1));
        let Weight = select(1.0 - Fraction.x, Fraction.x, Offset.x == 1) * select(1.0 - Fraction.y, Fraction.y, Offset.y == 1);
        let Value = textureLoad(TyreMarks, Texel, 0).xy;
        Deposit += Value.x * Weight;
        if (Value.y > 0.5 / 255.0)
        {
            let IsRim = Value.y >= 127.5 / 255.0;
            let Norm = select((Value.y * 255.0 - 1.0) / 126.0, (Value.y * 255.0 - 128.0) / 127.0, IsRim);
            Lateral += (Norm * 1.5 - 0.25) * Weight;
            LateralWeight += Weight;
            RimWeight += select(0.0, Weight, IsRim);
        }
    }
    if (LateralWeight <= 1.0e-4 || Deposit <= 0.0)
    {
        return vec2f(0.0, 0.0);
    }
    Lateral /= LateralWeight;
    // 📝 Edges: a pixel's footprint in lateral units, so the edge is one pixel wide at any distance.
    let Soft = max(PixelFootprint / (TyreMarkPatchWidth), 0.02);
    let Inside = smoothstep(-Soft, Soft, Lateral) * smoothstep(-Soft, Soft, 1.0 - Lateral);
    let Normalised = clamp(Deposit / max(LateralWeight, 0.25), 0.0, 1.0);
    if (RimWeight >= 0.5 * LateralWeight)
    {
        // 📝 Bare alloy rim scrape: twin sharp outer flange rails at 0.14 and 0.86 plus a scored inner barrel path.
        let RailWidth = max(0.075, Soft * 1.1);
        let LeftRail = exp(-pow((Lateral - 0.14) / RailWidth, 2.0));
        let RightRail = exp(-pow((Lateral - 0.86) / RailWidth, 2.0));
        let InnerScore = 0.42 * smoothstep(0.10, 0.18, Lateral) * smoothstep(0.10, 0.18, 1.0 - Lateral);
        return vec2f(Normalised * Inside * max(max(LeftRail, RightRail), InnerScore), 1.0);
    }
    var Grooves = 0.0;
    for (var Groove = 0u; Groove < 4u; Groove++)
    {
        let Centre = 0.2 + 0.2 * f32(Groove);
        Grooves = max(Grooves, 1.0 - smoothstep(0.022, 0.022 + Soft, abs(Lateral - Centre)));
    }
    return vec2f(Normalised * Inside * (1.0 - 0.55 * Grooves), 0.0);
}

fn ProjectScreenPixel(Clip: vec4f) -> vec2f
{
    let Ndc = Clip.xy / Clip.w;
    return vec2f(Ndc.x * 0.5 + 0.5, 0.5 - Ndc.y * 0.5) * Frame.ScreenExtent;
}

@fragment
fn SurfaceFragment(Varying: SurfaceVarying) -> SurfaceTargets
{
    // 📝 Derivatives first, in uniform control flow: the pixel's footprint on the ground for the road-mark edges.
    let Footprint = length(fwidth(Varying.WorldPosition.xy));
    var Normal = normalize(Varying.Normal);
    let View = normalize(Frame.CameraPosition - Varying.WorldPosition);
    // 📝 Every surface shades two-sided: an open facet seen from behind turns its normal toward the viewer.
    if (dot(Normal, View) < 0.0)
    {
        Normal = -Normal;
    }
    // 📝 Road marks: a road pixel becomes TyreRubber (intact tyre) or RimScrape (shredded tyre on bare rim) with
    //    probability equal to the deposit under it.
    var Family = Varying.Family;
    var Glow = 0.0;
    let Pixel = Varying.Position.xy + vec2f(5.588238 * f32(Frame.FrameIndex % 32u));
    let Threshold = fract(52.9829189 * fract(dot(Pixel, vec2f(0.06711056, 0.00583715))));
    // 📝 See-through glazing: the car's glass leaves the opaque raster (the cabin overlay draws it over what lies
    //    behind, tinted and reflecting the sky).
    if (Varying.Vehicle == 1u && Family == VehicleGlassFamily && VehicleState.Cabin.y > 0.5)
    {
        discard;
    }
    if (Varying.Vehicle == 1u)
    {
        if (Family == BodyCoatFamily && VehicleState.PaintRipple.w > 0.0)
        {
            let Rip = ResolvePaintRippleFactor(Varying.BodyLocal);
            if (Rip.x < Threshold)
            {
                Family = BodyCoatPreviousFamily;
            }
            Glow = max(Glow, Rip.y * 1.8);
        }
        else if (Family == HubFamily && VehicleState.WheelRipple.w > 0.0)
        {
            let Rip = ResolveWheelRippleFactor(Varying.BodyLocal);
            if (Rip.x < Threshold)
            {
                Family = HubPreviousFamily;
            }
            Glow = max(Glow, Rip.y * 1.8);
        }
        let ScanVis = ResolveScanVisibility(Varying.BodyLocal);
        if (ScanVis > 0.01 && !IsCockpitFamily(Family) && Family != HeadlightFamily && Family != TaillightFamily)
        {
            if (VehicleState.ScanState.z > 2.5 || ScanVis * 0.965 > Threshold)
            {
                discard;
            }
            Glow = max(Glow, ResolveScanWaveEdge(Varying.BodyLocal) * 2.2);
        }
    }
    let Marked = (Family >= MarkedFamilyFirst && Family <= MarkedFamilyLast) || (Family >= MarkedFamilyExtraFirst && Family <= MarkedFamilyExtraLast);
    if (Marked)
    {
        let RoadMark = SampleRoadMark(Varying.WorldPosition.xy, Footprint);
        if (RoadMark.x > Threshold)
        {
            Family = select(TyreMarkFamily, RimMarkFamily, RoadMark.y > 0.5);
        }
    }
    // 📝 The derez mask: a car pixel whose cell has been released is gone (its cubes have left, EffectRaster), and the
    //    cells about to go glow — white-hot at the edge, cyan behind it. Rez is the same clock run backwards.
    if (Varying.Vehicle == 1u && Effect.MaskMode != 0u)
    {
        if (Effect.MaskMode == 3u)
        {
            discard;
        }
        let Unit = (Varying.BodyLocal - Effect.BodyMinimum.xyz) / max(Effect.BodyMaximum.xyz - Effect.BodyMinimum.xyz, vec3f(1.0e-3));
        let Elapsed = Effect.Clock - Effect.MaskStart;
        let Seed = u32(Effect.Emitters[0].Centre.w);
        // 📝 With face colours the glowing cells keep their own family and glow in its colour; otherwise the
        //    palette's families stand in.
        let Faces = Effect.Colour.x > 0.5;
        if (Effect.MaskMode == 1u)
        {
            let Release = ResolveDerezRelease(Unit, Seed, Effect.Style, 1.0);
            if (Elapsed >= Release)
            {
                discard;
            }
            if (Elapsed > Release - EffectHotSeconds)
            {
                Family = select(DerezHotFamily, Family, Faces);
                Glow = select(0.0, 3.0 * Effect.Colour.y, Faces);
            }
            else if (Elapsed > Release - EffectGlowSeconds)
            {
                Family = select(select(DerezGlowFamily, DerezGlitchFamily, Effect.Style == 1u), Family, Faces);
                Glow = select(0.0, Effect.Colour.y, Faces);
            }
        }
        else
        {
            let Arrival = ResolveRezArrival(Unit, Seed, Effect.Style, 1.0);
            if (Elapsed < Arrival)
            {
                discard;
            }
            if (Elapsed < Arrival + EffectHotSeconds)
            {
                Family = select(DerezHotFamily, Family, Faces);
                Glow = select(0.0, 3.0 * Effect.Colour.y, Faces);
            }
            else if (Elapsed < Arrival + EffectGlowSeconds)
            {
                Family = select(select(DerezGlowFamily, DerezGlitchFamily, Effect.Style == 1u), Family, Faces);
                Glow = select(0.0, Effect.Colour.y, Faces);
            }
        }
    }
    var Targets: SurfaceTargets;
    Targets.Attributes = vec4f(EncodeOctahedral(Normal), f32(Family), 1.0 + Glow);
    Targets.Motion     = ProjectScreenPixel(Varying.CurrentClip) - ProjectScreenPixel(Varying.PreviousClip);
    return Targets;
}
