//============================================================================================================================================
//                                                            SHADOWRASTER.WGSL
//============================================================================================================================================
// 🧩 Depth-only projection of every rastered occupant into one cascade of the sun's shadow depth.

//! include "SceneRecords.wgsl"
//! include "TyreCarcass.wgsl"

struct CascadeRecord
{
    LightViewProjection : mat4x4f,
}

@group(0) @binding(0) var<uniform> Cascade             : CascadeRecord;
@group(0) @binding(1) var<storage, read> Occupants     : array<OccupantRecord>;
@group(0) @binding(2) var<storage, read> Carcasses     : array<TyreCarcass, 4>;

// 📝 instance_index plus the vertex's occupant offset, exactly as SurfaceRaster.wgsl resolves it; a flat tyre casts
//    a flat tyre's shadow.
@vertex
fn ShadowVertex(@location(0) Position: vec3f, @location(3) OccupantOffset: u32, @builtin(instance_index) OccupantIndex: u32) -> @builtin(position) vec4f
{
    let Identity = OccupantIndex + OccupantOffset;
    var Local = Position;
    let Wheel = Identity - WheelOccupantFirst;
    if (Wheel < 4u)
    {
        Local = DeformTyre(Wheel, Position, vec3f(0.0, 0.0, 1.0)).Position;
    }
    let World = Occupants[Identity].LocalToWorld * vec4f(Local, 1.0);
    return Cascade.LightViewProjection * World;
}
