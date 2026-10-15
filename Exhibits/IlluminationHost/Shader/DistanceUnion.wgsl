//============================================================================================================================================
//                                                            DISTANCEUNION.WGSL
//============================================================================================================================================
// 🧩 Rewrites the scene distance field brick by brick: min over the culled occupant volumes and the analytic course plane.

// 📝 This is the ONLY place that walks occupants, and it does so per invalidated 8³ brick, never per ray. A brick is
//    invalidated when the cascade window scrolls over it or when a moving occupant's old or new bounds, grown by the
//    cascade band, overlap it. Everything downstream traverses the assembled field alone.

//! include "SceneRecords.wgsl"
//! include "DistanceRecords.wgsl"

@group(0) @binding(0) var<uniform> Distance          : DistanceRecord;
@group(0) @binding(1) var<storage, read> Bricks      : array<vec4i>;
@group(0) @binding(2) var<storage, read> Occupants   : array<OccupantRecord>;
@group(0) @binding(3) var VolumeSpace                : texture_3d<f32>;
@group(0) @binding(4) var VolumeSampler              : sampler;
@group(0) @binding(5) var TargetClip0                : texture_storage_3d<rgba16float, write>;
@group(0) @binding(6) var TargetClip1                : texture_storage_3d<rgba16float, write>;
@group(0) @binding(7) var TargetClip2                : texture_storage_3d<rgba16float, write>;
@group(0) @binding(8) var TargetClip3                : texture_storage_3d<rgba16float, write>;
@group(0) @binding(9) var<storage, read_write> BrickEpochs : array<u32>;

const UnionCapacity : u32 = 48u;   // [-] - occupants a single brick can union; the course never approaches it

var<workgroup> CulledCount     : atomic<u32>;
var<workgroup> CulledOccupants : array<u32, 48>;

fn WriteClipTexel(Level: u32, Texel: vec3i, Texel4: vec4f)
{
    switch (Level)
    {
        case 0u:      { textureStore(TargetClip0, Texel, Texel4); }
        case 1u:      { textureStore(TargetClip1, Texel, Texel4); }
        case 2u:      { textureStore(TargetClip2, Texel, Texel4); }
        default:      { textureStore(TargetClip3, Texel, Texel4); }
    }
}

// 📐 Inside its volume an occupant answers with its transferred distance; outside, with the distance to the volume
//    plus the distance stored at the nearest volume point — the extension the union needs for its band.
fn SampleOccupantDistance(Occupant: OccupantRecord, Position: vec3f) -> f32
{
    let Local   = (Occupant.WorldToLocal * vec4f(Position, 1.0)).xyz;
    let Lowest  = Occupant.VolumeMinimum + vec3f(0.5 * Occupant.VoxelExtent);
    let Highest = Occupant.VolumeMinimum + (Occupant.VolumeTexelExtent - vec3f(0.5)) * Occupant.VoxelExtent;
    let Clamped = clamp(Local, Lowest, Highest);
    let Outside = length(Local - Clamped);
    let Texel   = Occupant.VolumeTexelOrigin + (Clamped - Occupant.VolumeMinimum) / Occupant.VoxelExtent;
    let Uvw     = Texel / vec3f(textureDimensions(VolumeSpace));
    return textureSampleLevel(VolumeSpace, VolumeSampler, Uvw, 0.0).x + Outside;
}

@compute @workgroup_size(64)
fn UniteDistance(@builtin(workgroup_id) Group: vec3u, @builtin(local_invocation_index) Lane: u32)
{
    let BrickIndex = Group.x + Group.y * 65535u;
    if (BrickIndex >= Distance.BrickCount)
    {
        return;
    }
    if (Lane == 0u)
    {
        atomicStore(&CulledCount, 0u);
    }
    workgroupBarrier();

    let Brick = Bricks[BrickIndex];
    let Level = u32(Brick.w) & 0xFFu;
    let OccupantCaused = ((u32(Brick.w) >> 8u) & 2u) != 0u;
    let Clip  = Distance.Clips[Level];
    let BrickMinimum = vec3f(Brick.xyz * i32(BrickEdge)) * Clip.VoxelExtent;
    let BrickMaximum = BrickMinimum + vec3f(f32(BrickEdge) * Clip.VoxelExtent);

    // ① cull: an occupant can influence this brick only if its bounds, grown by the band, overlap it
    for (var Index = Lane; Index < Distance.DistanceOccupantCount; Index += 64u)
    {
        let Occupant = Occupants[Index];
        if (all(Occupant.WorldMaximum + vec3f(Clip.Band) >= BrickMinimum) && all(Occupant.WorldMinimum - vec3f(Clip.Band) <= BrickMaximum))
        {
            let Slot = atomicAdd(&CulledCount, 1u);
            if (Slot < UnionCapacity)
            {
                CulledOccupants[Slot] = Index;
            }
        }
    }
    workgroupBarrier();
    let Count = min(atomicLoad(&CulledCount), UnionCapacity);

    // ② union: each lane writes a 2×2×2 sub-cube of the brick
    let LaneVoxel = vec3u(Lane & 3u, (Lane >> 2u) & 3u, Lane >> 4u) * 2u;
    let Resolution = i32(Clip.Resolution);
    for (var Sub = 0u; Sub < 8u; Sub++)
    {
        let Voxel      = LaneVoxel + vec3u(Sub & 1u, (Sub >> 1u) & 1u, Sub >> 2u);
        let WorldVoxel = Brick.xyz * i32(BrickEdge) + vec3i(Voxel);
        let Position   = (vec3f(WorldVoxel) + 0.5) * Clip.VoxelExtent;
        var Nearest    = Position.z - Distance.GroundHeight;
        var Identity   = GroundIdentity;
        for (var Slot = 0u; Slot < Count; Slot++)
        {
            let OccupantIndex = CulledOccupants[Slot];
            let Sampled = SampleOccupantDistance(Occupants[OccupantIndex], Position);
            if (Sampled < Nearest)
            {
                Nearest  = Sampled;
                Identity = OccupantIndex;
            }
        }
        let Texel = ((WorldVoxel % vec3i(Resolution)) + vec3i(Resolution)) % vec3i(Resolution);
        WriteClipTexel(Level, Texel, vec4f(clamp(Nearest, -Clip.Band, Clip.Band), f32(Identity), 0.0, 1.0));
    }
    if (Lane == 0u)
    {
        BrickEpochs[ResolveBrickSlot(Level, Brick.xyz, Distance.BricksPerAxis)] = ConstructBrickEpoch(Distance.FrameIndex, OccupantCaused);
    }
}
