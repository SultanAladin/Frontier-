//============================================================================================================================================
//                                                             EMBERRASTER.WGSL
//============================================================================================================================================
// 🧩 Embers and sparks drawn as motion-stretched glowing streaks, additively, depth-tested against the primary surfaces.

// 📝 Six vertices per particle form a quad from the particle back along its screen-space motion over StreakSeconds,
//    at least as wide as it is long — a spark at speed is a line, an ember drifting is a dot. The fragment is a soft
//    falloff across the streak in the particle's blackbody colour. A dead particle collapses its quad off screen.

//! include "FrameDescriptor.wgsl"
//! include "PlumeRecords.wgsl"

struct EmberParticle
{
    PositionLife        : vec4f,
    VelocityTemperature : vec4f,
    Parameters          : vec4f,
}

struct EmberShading
{
    Intensity : vec4f,   // x radiance scale [-], y streak duration [s], z minimum size [px], w unused
}

@group(0) @binding(1) var<storage, read> Particles : array<EmberParticle>;
@group(0) @binding(2) var<uniform> Shading         : EmberShading;

struct EmberVarying
{
    @builtin(position) Position         : vec4f,
    @location(0) Across                 : f32,
    @location(1) @interpolate(flat) Glow : vec3f,
}

@vertex
fn EmberVertex(@builtin(vertex_index) Corner: u32, @builtin(instance_index) Index: u32) -> EmberVarying
{
    var Varying: EmberVarying;
    let Particle = Particles[Index];
    if (Particle.PositionLife.w <= 0.0)
    {
        Varying.Position = vec4f(2.0, 2.0, 0.0, 1.0);
        Varying.Across = 0.0;
        Varying.Glow = vec3f(0.0);
        return Varying;
    }
    let Head = Frame.ViewProjection * vec4f(Particle.PositionLife.xyz, 1.0);
    let Tail = Frame.ViewProjection * vec4f(Particle.PositionLife.xyz - Particle.VelocityTemperature.xyz * Shading.Intensity.y, 1.0);
    if (Head.w < 0.05 || Tail.w < 0.05)
    {
        Varying.Position = vec4f(2.0, 2.0, 0.0, 1.0);
        Varying.Across = 0.0;
        Varying.Glow = vec3f(0.0);
        return Varying;
    }
    let HeadScreen = Head.xy / max(Head.w, 1.0e-4) * 0.5 * Frame.ScreenExtent;
    let TailScreen = Tail.xy / max(Tail.w, 1.0e-4) * 0.5 * Frame.ScreenExtent;
    var Along = HeadScreen - TailScreen;
    let Length = length(Along);
    Along = select(vec2f(1.0, 0.0), Along / Length, Length > 1.0e-3);
    let Side = vec2f(-Along.y, Along.x);
    let Width = max(Shading.Intensity.z, Particle.Parameters.w * Frame.ScreenExtent.y / max(Head.w, 1.0e-3));
    // 📝 Corners 0–5: two triangles over (tail − w·along, head + w·along) × (−w, +w) across.
    var Lengthwise = array<f32, 6>(0.0, 1.0, 1.0, 0.0, 1.0, 0.0);
    var Crosswise  = array<f32, 6>(-1.0, -1.0, 1.0, -1.0, 1.0, 1.0);
    let Start = TailScreen - Along * Width;
    let End = HeadScreen + Along * Width;
    let Screen = mix(Start, End, Lengthwise[Corner]) + Side * (Width * Crosswise[Corner]);
    let ClipDepth = mix(Tail.z / max(Tail.w, 1.0e-4), Head.z / max(Head.w, 1.0e-4), Lengthwise[Corner]);
    Varying.Position = vec4f(Screen / (0.5 * Frame.ScreenExtent), ClipDepth, 1.0);
    Varying.Across = Crosswise[Corner];
    // 📝 A streak spreads its energy over its length; the glow is divided by it so a fast spark is not brighter.
    let Temperature = Particle.VelocityTemperature.w;
    let Spread = Width / max(Length + 2.0 * Width, 1.0);
    Varying.Glow = ResolveBlackbodyRadiance(Temperature) * (Shading.Intensity.x * Spread * min(Particle.PositionLife.w * 4.0, 1.0));
    return Varying;
}

@fragment
fn EmberFragment(Varying: EmberVarying) -> @location(0) vec4f
{
    let Falloff = 1.0 - Varying.Across * Varying.Across;
    return vec4f(Varying.Glow * Falloff * Falloff, 0.0);
}
