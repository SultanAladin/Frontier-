#version 450
// Front surface depth + additive optical thickness. SurfaceResolve.slang turns
// these particle samples into one continuous liquid interface.
layout(local_size_x = 64) in;
layout(std430, binding = 0) readonly buffer Particles { vec4 particles[]; };
layout(std430, binding = 1) buffer Pixels { uint pixels[]; };
layout(std430, binding = 2) buffer Depths { uint depths[]; };
layout(std140, binding = 3) uniform Params {
    uvec4 counts; vec4 scene; vec4 colourPaused; vec4 optical; vec4 absorptionMaterial;
} p;
layout(std430, binding = 4) buffer Thickness { uint thickness[]; };
void main() {
    uint id=gl_GlobalInvocationID.x; if(id>=p.counts.x)return;
    float radius=p.scene.y*2.28; // overlapping reconstruction support, not physics radius
    vec3 centre=particles[id].xyz;
    vec3 camera=vec3(4.4,3.0,5.2),target=vec3(0,.9,0);
    vec3 f=normalize(target-camera),right=normalize(cross(f,vec3(0,1,0))),up=normalize(cross(right,f));
    vec3 rel=centre-camera;float z=dot(rel,f);if(z<=.05)return;
    float focal=(float(p.counts.z)*.5)/tan(radians(26.0));
    vec2 screen=vec2(float(p.counts.y)*.5+dot(rel,right)*focal/z,float(p.counts.z)*.5-dot(rel,up)*focal/z);
    int r=clamp(int(focal*radius/z),1,64);
    for(int oy=-r;oy<=r;oy++)for(int ox=-r;ox<=r;ox++){
        vec2 n=vec2(ox,-oy)/float(r);float d2=dot(n,n);if(d2>1.0)continue;
        ivec2 pixel=ivec2(screen)+ivec2(ox,oy);
        if(any(lessThan(pixel,ivec2(0)))||pixel.x>=int(p.counts.y)||pixel.y>=int(p.counts.z))continue;
        float nz=sqrt(max(0.0,1.0-d2));uint index=uint(pixel.y)*p.counts.y+uint(pixel.x);
        atomicMin(depths[index],uint(clamp((z-radius*nz)*1000000.0,0.0,4294967294.0)));
        atomicAdd(thickness[index],uint(2.0*radius*nz*1000000.0));
    }
}
