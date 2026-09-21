#version 450
// Anisotropic front-depth and thickness splats. Velocity-aligned kernels close
// the temporal gaps in jets while the resolve pass reconstructs one interface.
layout(local_size_x = 64) in;
struct Particle { vec4 position; vec4 velocity; };
layout(std430, binding = 0) readonly buffer Particles { Particle particles[]; };
layout(std430, binding = 1) buffer Pixels { uint pixels[]; };
layout(std430, binding = 2) buffer Depths { uint depths[]; };
layout(std140, binding = 3) uniform Params {
    uvec4 counts; vec4 scene; vec4 colourPaused; vec4 optical; vec4 absorptionMaterial;
} p;
layout(std430, binding = 4) buffer Thickness { uint thickness[]; };
void main() {
    uint id=gl_GlobalInvocationID.x;if(id>=p.counts.x)return;
    float support=p.scene.y*2.28;
    vec3 centre=particles[id].position.xyz,velocity=particles[id].velocity.xyz;
    vec3 camera=vec3(4.4,3.0,5.2),target=vec3(0,.9,0);
    vec3 f=normalize(target-camera),right=normalize(cross(f,vec3(0,1,0))),up=normalize(cross(right,f));
    vec3 rel=centre-camera;float z=dot(rel,f);if(z<=.05)return;
    float focal=(float(p.counts.z)*.5)/tan(radians(26.0));
    vec2 screen=vec2(float(p.counts.y)*.5+dot(rel,right)*focal/z,float(p.counts.z)*.5-dot(rel,up)*focal/z);
    vec2 projectedVelocity=vec2(dot(velocity,right),-dot(velocity,up));float speed=length(projectedVelocity);
    vec2 axis=speed>.01?projectedVelocity/speed:vec2(0,1);float aspect=1.0+clamp(speed*.22,0.0,1.4);
    float major=support*aspect,minor=support/sqrt(aspect),depthRadius=minor;
    int majorPixels=clamp(int(focal*major/z),1,72),minorPixels=clamp(int(focal*minor/z),1,48);
    for(int oy=-majorPixels;oy<=majorPixels;oy++)for(int ox=-majorPixels;ox<=majorPixels;ox++){
        vec2 offset=vec2(ox,oy);float along=dot(offset,axis)/float(majorPixels),across=dot(offset,vec2(-axis.y,axis.x))/float(minorPixels);float d2=along*along+across*across;if(d2>1.0)continue;
        ivec2 pixel=ivec2(screen)+ivec2(ox,oy);if(any(lessThan(pixel,ivec2(0)))||pixel.x>=int(p.counts.y)||pixel.y>=int(p.counts.z))continue;
        float nz=sqrt(max(0.0,1.0-d2));uint index=uint(pixel.y)*p.counts.y+uint(pixel.x);
        atomicMin(depths[index],uint(clamp((z-depthRadius*nz)*1000000.0,0.0,4294967294.0)));
        atomicAdd(thickness[index],uint(2.0*depthRadius*nz*1000000.0));
    }
}
