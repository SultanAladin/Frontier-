//============================================================================================================================================
//                                                          FIREILLUMINATION.WGSL
//============================================================================================================================================
// 🧩 A burning tyre as a point light on the scene: inverse-square, windowed to its reach, shadowed through the scene distance field.

// 📝 Read by the direct pass (screen) and the card direct pass (the surface cache), so a tyre fire lights the course
//    and the car directly and, through the cards the final gather reads, bounces into the indirect term as well.
//    The shadow ray stops short of the light: the light sits inside the burning wheel, which must not shadow itself.

//! include "FrameDescriptor.wgsl"
//! include "DistanceTraversal.wgsl"

struct FireArrival
{
    Direction   : vec3f,   // [-]  toward the emitter
    Illuminance : vec3f,   // [-]  arriving at normal incidence, shadowed and windowed
}

fn ResolvePointArrival(LightPosition: vec3f, LightIntensity: f32, LightColour: vec3f, Reach: f32, SelfRadius: f32,
                       Position: vec3f, Normal: vec3f) -> FireArrival
{
    var Arrival: FireArrival;
    Arrival.Direction = vec3f(0.0, 0.0, 1.0);
    Arrival.Illuminance = vec3f(0.0);
    if (LightIntensity <= 0.0 || Reach <= 0.0)
    {
        return Arrival;
    }
    let Toward = LightPosition - Position;
    let Squared = dot(Toward, Toward);
    if (Squared >= Reach * Reach)
    {
        return Arrival;
    }
    let Range = sqrt(Squared);
    Arrival.Direction = Toward / max(Range, 1.0e-4);
    if (dot(Normal, Arrival.Direction) <= 0.0)
    {
        return Arrival;
    }
    let Ratio = Squared / (Reach * Reach);
    let Window = (1.0 - Ratio * Ratio) * (1.0 - Ratio * Ratio);
    var Visibility = 1.0;
    if (FeatureEnabled(Frame, FeatureDirectShadow) && Range > SelfRadius + 0.1)
    {
        let Bias = ResolveSurfaceBias(Position);
        Visibility = TraverseSceneShadow(Position + Normal * Bias, Arrival.Direction, 0.5 * Bias, max(Range - SelfRadius, 0.0), 4.0);
    }
    Arrival.Illuminance = LightColour * LightIntensity * Window * Visibility / max(Squared, 0.18);
    return Arrival;
}

fn ResolveFireArrival(Position: vec3f, Normal: vec3f) -> FireArrival
{
    return ResolvePointArrival(Frame.FireLightPosition, Frame.FireLightIntensity, Frame.FireLightColour, Frame.FireLightReach, 0.6, Position, Normal);
}

fn ResolveSparkArrival(Position: vec3f, Normal: vec3f) -> FireArrival
{
    return ResolvePointArrival(Frame.SparkLightPosition, Frame.SparkLightIntensity, Frame.SparkLightColour, Frame.SparkLightReach, 0.35, Position, Normal);
}

fn ResolveDebrisArrival(Position: vec3f, Normal: vec3f) -> FireArrival
{
    return ResolvePointArrival(Frame.DebrisLightPosition, Frame.DebrisLightIntensity, Frame.DebrisLightColour, Frame.DebrisLightReach, 0.75, Position, Normal);
}
