//============================================================================================================================================
// 📦 Engine/Shaders/VisibilityRaster.frag.slang — Visibility-buffer fragment stage: visibility id + motion vector
//============================================================================================================================================
// Attachments: 0 = R32_UINT visibility id (instance << 14 | primitive), 1 = RG16F motion (uv delta current − previous,
//    in [0,1] image space, y down), depth = D32 reverse-Z. Primitive id = cluster's first primitive + gl_PrimitiveID
//    (gl_PrimitiveID restarts at 0 for every draw). No colour, no derivatives — everything else is resolved later.
// NOTE: GLSL source lowered by glslc -fshader-stage=fragment.

#version 460
#extension GL_GOOGLE_include_directive : require
#include "Shaders/SceneRecords.slang"

layout(std430, set = 0, binding = 2) readonly buffer ClusterExtent { ClusterRecord Clusters[]; };

layout(location = 0) flat in uint  InCluster;
layout(location = 1)      in vec4  InPreviousClip;
layout(location = 2)      in vec4  InCurrentClip;

layout(location = 0) out uint OutVisibility;
layout(location = 1) out vec2 OutMotion;

void main()
{
    ClusterRecord Cluster = Clusters[InCluster];
    OutVisibility = PackVisibility(Cluster.InstanceIndex, Cluster.FirstPrimitive + uint(gl_PrimitiveID));

    vec2 CurrentUv  = InCurrentClip.xy  / InCurrentClip.w  * 0.5 + 0.5;
    vec2 PreviousUv = InPreviousClip.xy / InPreviousClip.w * 0.5 + 0.5;
    OutMotion = CurrentUv - PreviousUv;
}
