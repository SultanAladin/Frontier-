struct Node { p:vec4f, previous:vec4f, velocity:vec4f, rest:vec4f, info:vec4f }
struct Camera { vp:mat4x4f, eye:vec4f, options:vec4f, settings:vec4f }
@group(0) @binding(0) var<storage,read> nodes:array<Node>;
@group(0) @binding(1) var<uniform> cam:Camera;
struct Out { @builtin(position) clip:vec4f, @location(0) world:vec3f, @location(1) data:vec4f, @location(2) local:vec3f }
@vertex fn tyre(@builtin(vertex_index) i:u32)->Out {
 let n=nodes[i];var o:Out;o.world=n.p.xyz;o.clip=cam.vp*vec4f(o.world,1);o.data=vec4f(n.info.x,n.info.z,0,0);o.local=n.rest.xyz;return o;
}
@vertex fn ghost(@builtin(vertex_index) i:u32)->Out {
 let r=nodes[i].rest.xyz;let a=cam.settings.x;let c=cos(a);let s=sin(a);
 var o:Out;o.world=vec3f(c*r.x-s*r.y,s*r.x+c*r.y+cam.options.z,r.z);o.clip=cam.vp*vec4f(o.world,1);o.data=vec4f(0);o.local=r;return o;
}
@vertex fn environment(@location(0) p:vec4f)->Out {
 var o:Out;var v=p.xyz;if(p.w>1.5){v.y+=cam.options.z;}else{v.y+=cam.options.w*exp(-pow((v.x-.08)/.09,2.0));}
 o.world=v;o.clip=cam.vp*vec4f(v,1);o.data=vec4f(0,0,p.w,0);o.local=p.xyz;return o;
}
fn palette(t:f32)->vec3f {return mix(vec3f(.22,.59,.53),vec3f(1,.39,.16),clamp(t,0,1));}
@fragment fn surface(v:Out,@builtin(front_facing) front:bool)->@location(0) vec4f {
 var normal=normalize(cross(dpdx(v.world),dpdy(v.world)));if(!front){normal=-normal;}
 let light=max(0.0,dot(normal,normalize(vec3f(-.5,1,1))));
 let gridDerivative=fwidth(v.world.xz*5);
 var base=vec3f(.12,.155,.17);
 if(v.data.z<.5){
  let a=atan2(v.local.y,v.local.x);let radius=length(v.local.xy);
  let tread=step(.16,fract(a*30.56+abs(v.local.z)*18));
  base=mix(vec3f(.047,.067,.077),vec3f(.16,.19,.20),tread);
  if(radius<.42){base=vec3f(.085,.11,.125);}
  if(abs(v.local.z)>.148 && radius>.35 && radius<.36){base=vec3f(.42,.47,.42);}
  if(cam.options.x>0.5 && cam.options.x<1.5){base=palette(v.data.y*4);}
  if(cam.options.x>1.5){base=mix(vec3f(.10,.19,.22),vec3f(1,.48,.18),clamp(v.data.x*2000,0,1));}
 }else if(v.data.z<1.5){
  let grid=abs(fract(v.world.xz*5+.5)-.5)/max(gridDerivative,vec2f(.001));
  let line=1-min(min(grid.x,grid.y),1.0);base=mix(vec3f(.057,.083,.102),vec3f(.13,.18,.21),line*.8);
  let belt=1-smoothstep(.21,.215,abs(v.world.z));base+=vec3f(.015)*belt;
 }else{
  base=vec3f(.37,.43,.46);let a=atan2(v.local.y,v.local.x);
  if(length(v.local.xy)<.23){base=mix(vec3f(.05,.075,.09),vec3f(.34,.40,.42),step(.72,abs(cos(a*5))));}
  if(length(v.local.xy)<.072){base=vec3f(.55,.61,.56);}
 }
 let hemi=.28+.72*light;let view=normalize(cam.eye.xyz-v.world);
 let spec=pow(max(0.0,dot(reflect(-normalize(vec3f(-.5,1,1)),normal),view)),40.0);
 var color=base*hemi+vec3f(spec*.19);
 // Soft visual grounding only; contact is solved by compute, not this shading.
 if(v.data.z>.5 && v.data.z<1.5){color*=1.0-.45*exp(-dot(v.world.xz*vec2f(2,3),v.world.xz*vec2f(2,3)));}
 color=mix(color,vec3f(.055,.083,.105),1-exp(-length(cam.eye.xyz-v.world)*.025));
 return vec4f(pow(color,vec3f(1/2.2)),1);
}
@fragment fn wire(v:Out)->@location(0) vec4f { return vec4f(.58,.86,.65,.30); }
@fragment fn envelope(v:Out)->@location(0) vec4f { return vec4f(.57,.67,.75,.13); }
