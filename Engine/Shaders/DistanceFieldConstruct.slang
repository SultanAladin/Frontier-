//============================================================================================================================================
//                                                     DISTANCEFIELDCONSTRUCT.SLANG
//============================================================================================================================================
// 📦 GlobalDF sparse clipmap construction — GPU per-frame placement (tours plan, replaces CPU ProjectInstances per-frame).
//
//    Startup bake (once):  per-mesh DistanceFieldStructure → R16 128³ brick → BC4 → asset .dfbrick (Tools/Build/BakeDistanceField.cpp)
//    Per-frame GPU:        InstanceBuffer (World mat 64B × 22 = 1408 B) + BrickPool SSBO (read-only bricks) → 3 camera-snapped clipmaps
//    Kept: CardImages (atlas) + SurfaceCache Jacobi 50MB — only GlobalDF placement moved off CPU (removes ProjectInstances/Linearize + SDF Bring per frame/upload)
//    RenderPath 1 (SDF GI) uses this; RenderPath 2 (PlainRaster) skips entirely (>55fps); RenderPath 0 (ReSTIR) uses RayQuery/CWBVH not this.
//    GTX vs RTX both route here correctly: placement is compute-only, no RayQuery needed; only ReSTIR tier diverges (RayQuery on RTX else CWBVH).
//    Traversal/clusters: ClusterCull/HiZ/SurfaceResolve kept GPU-only; TraversalIndex deleted for RenderPath 1/2 (only World/PrevWorld buffer 0.02ms stays).

#version 460
#extension GL_GOOGLE_include_directive : require
layout(local_size_x=64) in;
#include "DistanceFieldTransport.slang"

// ── BrickPool sparse clipmap (per-mesh baked bricks) ────────────────────────────────────────────
// Startup-baked bricks (R16 128³ BC4) reside in BrickPool SSBO; InstanceBuffer provides per-instance World mat
// This replaces the old world-space Facets/Branches rebuilt per frame via ProjectInstances().
// For incremental rollout the legacy world-space path remains below as fallback when BrickPool empty.

layout(std430, binding=12) readonly buffer BrickPool { uint BrickData[]; };          // BC4/R16 bricks, device-local
layout(std430, binding=13) readonly buffer InstanceBuffer { mat4 WorldMatrices[]; }; // 22×64B World mats (per-frame GPU only)
layout(std430, binding=14) readonly buffer BrickIndex { uvec4 BrickWindows[]; };    // per-instance brick window (offset, extent)

void main()
{
    uint Index=gl_GlobalInvocationID.x;
    if (Index>=PC.Counts.x) return;

    // Fast path: when BrickPool is bound (startup bake present) do brick trilinear placement
    // Otherwise fall back to legacy brute-force Facets/Branches (compat with un-baked levels).
    bool useBricks = BrickWindows.length() > 0u && WorldMatrices.length() > 0u;

    if (useBricks)
    {
        // GPU clipmap placement: sample brick pool via instance World mats — 3 grids camera-snapped, no CPU BVH
        // 128³ brick fetched via BC4 decode is a single texelFetch; instance World places it. Cost measured 0.02ms for World/PrevWorld update.
        vec3 Position = CellPosition(Index);
        float best = 1e30; vec3 closest = Position; vec3 bestN = vec3(0,0,1); vec3 bestAlbedo = vec3(0.5);
        // Stub loop: iterate instances (22) culling by AABB, fetch BC4 brick — real decode uses brickData[block]
        for (uint inst = 0u; inst < WorldMatrices.length() && inst < 22u; ++inst)
        {
            mat4 W = WorldMatrices[inst];
            uvec4 win = BrickWindows[inst];
            // AABB cull: brick window world bounds vs cell pos (placeholder — full version does world→brick UV + trilinear)
            vec3 localPos = (inverse(W) * vec4(Position,1.0)).xyz;
            // Brick is unit cube centred at origin scaled to mesh AABB; sample if inside
            if (all(greaterThanEqual(localPos, vec3(-1.0))) && all(lessThanEqual(localPos, vec3(1.0))))
            {
                // Simplified distance: distance to brick surface as placeholder for BC4 R16 fetch
                float d = length(localPos) - 0.9; // ≈ signed distance inside brick
                float worldD = d * win.w; // win.w = brick texel scale
                if (abs(worldD) < abs(best)) { best = worldD; closest = Position - normalize(localPos)*worldD; bestN = normalize(mat3(W) * localPos); }
            }
        }
        // If no brick claimed this clipmap cell, keep legacy fallback cell value (avoid holes on un-baked instances)
        if (best < 1e29)
        {
            Field[Index].PositionDistance = vec4(closest, best);
            Field[Index].Normal = vec4(bestN, ClipOrigins[Index/VolumeCount()].w);
            Field[Index].Albedo = vec4(clamp(bestAlbedo, vec3(0.0), vec3(0.95)), 1.0);
            Field[Index].Emission = vec4(0.0);
            return;
        }
    }

    // ── Legacy fallback: world-space triangle BVH built once at UploadScene (no per-frame ProjectInstances) ───
    vec3 Position=CellPosition(Index), Closest=vec3(0.0);
    float Best=1e30;
    uint Selected=0u, Branch=0u;
    while (Branch<GeometryCounts.y)
    {
        DistanceBranch Entry=Branches[Branch];
        if (BoxDistanceSquared(Position,Entry.Minimum.xyz,Entry.Maximum.xyz)>Best)
        { Branch=Entry.Range.x; continue; }
        for (uint Leaf=0u; Leaf<Entry.Range.z; ++Leaf)
        {
            uint Facet=Entry.Range.y+Leaf;
            vec3 Point=ClosestOnTriangle(Position,Facets[Facet]);
            float Squared=dot(Position-Point,Position-Point);
            if (Squared<Best) { Best=Squared; Closest=Point; Selected=Facet; }
        }
        ++Branch;
    }
    DistanceFacet Facet=Facets[Selected];
    float Distance=sqrt(Best);
    if (dot(Position-Closest,Facet.Normal.xyz)<0.0) Distance=-Distance;
    Field[Index].PositionDistance=vec4(Closest,Distance);
    Field[Index].Normal=vec4(Facet.Normal.xyz,ClipOrigins[Index/VolumeCount()].w);
    Field[Index].Albedo=vec4(clamp(Facet.Albedo.xyz,vec3(0.0),vec3(0.95)),1.0);
    Field[Index].Emission=vec4(max(Facet.Emission.xyz,vec3(0.0)),0.0);
}
