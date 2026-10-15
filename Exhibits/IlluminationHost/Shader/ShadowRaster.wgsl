//============================================================================================================================================
//                                                            SHADOWRASTER.WGSL
//============================================================================================================================================
// 🧩 Depth-only projection of every rastered occupant into one cascade of the sun's shadow depth.

//! include "SceneRecords.wgsl"

struct CascadeRecord
{
    LightViewProjection : mat4x4f,
}

@group(0) @binding(0) var<uniform> Cascade             : CascadeRecord;
@group(0) @binding(1) var<storage, read> Occupants     : array<OccupantRecord>;

@vertex
fn ShadowVertex(@location(0) Position: vec3f, @builtin(instance_index) OccupantIndex: u32) -> @builtin(position) vec4f
{
    let World = Occupants[OccupantIndex].LocalToWorld * vec4f(Position, 1.0);
    return Cascade.LightViewProjection * World;
}
