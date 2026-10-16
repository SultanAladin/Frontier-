//============================================================================================================================================
//                                                           EMBERADVECTION.WGSL
//============================================================================================================================================
// 🧩 Ember and spark particles carried by the smoke-and-fire velocity lattice: drag, buoyancy, gravity, cooling and the ground bounce.

// 📝 Each particle relaxes toward the air velocity at its position — the plume's own coarse lattice while the plume is
//    resident, the ambient wind otherwise — at a drag rate that separates the two populations: light embers ride the
//    hot column up (high drag, buoyant while hot), heavy sparks fly ballistic and skip off the road (low drag, full
//    gravity, restitution 0.35). Temperature relaxes toward 600 K, where an ember stops glowing; life counts down.

//! include "PlumeRecords.wgsl"

struct EmberRecord
{
    Step     : vec4f,   // x duration [s], y gravity [m/s²], z elapsed [s], w 1 while the plume lattice is resident
    Wind     : vec4f,   // xyz ambient flow [m/s], w cooling rate [1/s]
    Capacity : vec4u,   // x particle capacity
}

struct EmberParticle
{
    PositionLife        : vec4f,   // xyz [m], w remaining life [s]
    VelocityTemperature : vec4f,   // xyz [m/s], w temperature [K]
    Parameters          : vec4f,   // x gravity share [-], y buoyant lift [m/s²], z drag rate [1/s], w size [m]
}

@group(0) @binding(0) var<uniform> Ember                    : EmberRecord;
@group(0) @binding(1) var<storage, read_write> Particles     : array<EmberParticle>;
@group(0) @binding(2) var<uniform> Plume                    : PlumeRecord;
@group(0) @binding(3) var VelocityState                     : texture_3d<f32>;
@group(0) @binding(4) var LatticeSampler                    : sampler;

fn ResolveAirVelocity(Position: vec3f) -> vec3f
{
    if (Ember.Step.w > 0.5 && ClassifyWindowInterior(Position, Plume.VelocityOrigin.xyz, Plume.VelocityExtent.xyz, Plume.Lattice.y, Plume.Lattice.z))
    {
        let Sampled = textureSampleLevel(VelocityState, LatticeSampler, ProjectVelocityCoordinates(Plume, Position), 0.0);
        if (Sampled.w < 0.5)
        {
            return Sampled.xyz;
        }
    }
    return Ember.Wind.xyz;
}

@compute @workgroup_size(64)
fn AdvectEmbers(@builtin(global_invocation_id) Invocation: vec3u)
{
    let Index = Invocation.x;
    if (Index >= Ember.Capacity.x)
    {
        return;
    }
    var Particle = Particles[Index];
    if (Particle.PositionLife.w <= 0.0)
    {
        return;
    }
    let Seconds = Ember.Step.x;
    var Position = Particle.PositionLife.xyz;
    var Velocity = Particle.VelocityTemperature.xyz;
    var Temperature = Particle.VelocityTemperature.w;
    let Air = ResolveAirVelocity(Position);
    let Drag = 1.0 - exp(-Particle.Parameters.z * Seconds);
    Velocity = mix(Velocity, Air, Drag);
    Velocity.z += (Particle.Parameters.y * clamp((Temperature - 600.0) / 900.0, 0.0, 1.0) - Ember.Step.y * Particle.Parameters.x) * Seconds;
    Position += Velocity * Seconds;
    if (Position.z < 0.01)
    {
        Position.z = 0.01;
        if (Velocity.z < 0.0)
        {
            Velocity = vec3f(Velocity.xy * 0.7, -Velocity.z * 0.35);
            Temperature -= 120.0;
        }
    }
    Temperature = 600.0 + (Temperature - 600.0) * exp(-Ember.Wind.w * Seconds);
    let Life = select(Particle.PositionLife.w - Seconds, 0.0, Temperature < 680.0);
    Particles[Index].PositionLife = vec4f(Position, Life);
    Particles[Index].VelocityTemperature = vec4f(Velocity, Temperature);
}
