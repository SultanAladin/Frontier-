struct Node { p: vec4f, previous: vec4f, velocity: vec4f, rest: vec4f, info: vec4f }
struct Edge { ids: vec2u, length: f32, pad: f32 }
struct Tet { ids: vec4u, b0: vec4f, b1: vec4f, b2: vec4f }
struct Params { dt: f32, angle: f32, height: f32, speed: f32,
  edgeCompliance: f32, volumeCompliance: f32, strainCompliance: f32, friction: f32,
  nodes: u32, edges: u32, tets: u32, model: u32,
  reserved: f32, obstacle: f32, batchStart: u32, batchCount: u32 }
@group(0) @binding(0) var<storage,read_write> nodes: array<Node>;
@group(0) @binding(1) var<storage,read> edges: array<Edge>;
@group(0) @binding(2) var<storage,read> tets: array<Tet>;
@group(0) @binding(3) var<storage,read> schedule: array<u32>;
@group(0) @binding(4) var<storage,read_write> lambdas: array<vec2f>;
@group(0) @binding(5) var<uniform> u: Params;
@group(0) @binding(6) var<storage,read_write> stats: array<vec4f>;
@group(0) @binding(7) var<storage,read_write> rotations: array<vec4f>;
fn quatMatrix(q:vec4f)->mat3x3f {
 let x=q.x;let y=q.y;let z=q.z;let w=q.w;
 return mat3x3f(vec3f(1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y)),
   vec3f(2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x)),vec3f(2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y)));
}
fn hub(r:vec3f)->vec3f {
 let a=-u.angle; let c=cos(a); let s=sin(a);
 return vec3f(c*r.x-s*r.y,s*r.x+c*r.y+u.height,r.z);
}
fn ground(x:f32)->f32 { return u.obstacle*exp(-pow((x-.08)/.09,2.0)); }
// Project the belt immediately after every coloured material update. This avoids
// letting later constraints see penetrating nodes and prevents one end-of-sweep pop.
fn applyPosition(i:u32, p:vec4f) {
 var n=nodes[i];n.p=p;
 if(p.w>0){let depth=max(0.0,ground(p.x)-p.y);n.p.y+=depth;n.info.x+=depth;}
 nodes[i]=n;
}
@compute @workgroup_size(64) fn predict(@builtin(global_invocation_id) gid:vec3u) {
 let i=gid.x; if(i>=u.nodes){return;}
 var n=nodes[i]; n.previous=n.p; n.info=vec4f(0);
 if(n.p.w==0){n.p=vec4f(hub(n.rest.xyz),0);n.velocity=vec4f(0);}
 else {n.velocity.y-=9.81*u.dt; n.p=vec4f(n.p.xyz+n.velocity.xyz*u.dt,n.p.w);}
 nodes[i]=n;
}
@compute @workgroup_size(64) fn clearLambda(@builtin(global_invocation_id) gid:vec3u) {
 let i=gid.x; if(i<u.edges+u.tets){lambdas[i]=vec2f(0);}
}
@compute @workgroup_size(64) fn solveEdges(@builtin(global_invocation_id) gid:vec3u) {
 if(gid.x>=u.batchCount){return;}let i=schedule[u.batchStart+gid.x];
 let e=edges[i]; let a=nodes[e.ids.x].p; let b=nodes[e.ids.y].p;
 let d=a.xyz-b.xyz; let len=length(d); let alpha=u.edgeCompliance/(u.dt*u.dt);
 let dl=(-(len-e.length)-alpha*lambdas[i].x)/max(a.w+b.w+alpha,1e-9);
 lambdas[i].x+=dl; let g=d/max(len,1e-7);
 applyPosition(e.ids.x,vec4f(a.xyz+g*dl*a.w,a.w));applyPosition(e.ids.y,vec4f(b.xyz-g*dl*b.w,b.w));
}
@compute @workgroup_size(64) fn solveTets(@builtin(global_invocation_id) gid:vec3u) {
 if(gid.x>=u.batchCount){return;}let i=schedule[u.batchStart+gid.x];
 let t=tets[i];var p0=nodes[t.ids.x].p;var p1=nodes[t.ids.y].p;var p2=nodes[t.ids.z].p;var p3=nodes[t.ids.w].p;
 let v0=t.b2.w;let li=u.edges+i;
 if(u.model==1u){
   // Corotational energy: mu/2 * ||F-R||² + K/2 * (J-1)².
   // The proper polar rotation removes rigid motion from material strain.
   // F = Ds * inverse(Dm). Not a surface shader or a spring force.
   let a=p1.xyz-p0.xyz;let b=p2.xyz-p0.xyz;let c=p3.xyz-p0.xyz;
   let f0=a*t.b0.x+b*t.b1.x+c*t.b2.x;
   let f1=a*t.b0.y+b*t.b1.y+c*t.b2.y;
   let f2=a*t.b0.z+b*t.b1.z+c*t.b2.z;
   // Persistent quaternion polar extraction (no inverse of a nearly singular F).
   var q=rotations[i];var rotation=quatMatrix(q);
   for(var k=0;k<4;k++){
     let omega=(cross(rotation[0],f0)+cross(rotation[1],f1)+cross(rotation[2],f2))/
       (abs(dot(rotation[0],f0)+dot(rotation[1],f1)+dot(rotation[2],f2))+1e-8);
     let angle=length(omega);
     if(angle>1e-6){let a=min(angle,.5);let dq=vec4f(omega/angle*sin(a*.5),cos(a*.5));
       q=normalize(vec4f(dq.w*q.xyz+q.w*dq.xyz+cross(dq.xyz,q.xyz),dq.w*q.w-dot(dq.xyz,q.xyz)));
       rotation=quatMatrix(q);
     }
   }
   rotations[i]=q;
   let e0=f0-rotation[0];let e1=f1-rotation[1];let e2=f2-rotation[2];
   let cs=max(sqrt(dot(e0,e0)+dot(e1,e1)+dot(e2,e2)),1e-8);
   let h1=(e0*t.b0.x+e1*t.b0.y+e2*t.b0.z)/cs;
   let h2=(e0*t.b1.x+e1*t.b1.y+e2*t.b1.z)/cs;
   let h3=(e0*t.b2.x+e1*t.b2.y+e2*t.b2.z)/cs;let h0=-(h1+h2+h3);
   let al=u.strainCompliance/(v0*u.dt*u.dt);
   let den=p0.w*dot(h0,h0)+p1.w*dot(h1,h1)+p2.w*dot(h2,h2)+p3.w*dot(h3,h3)+al;
   var ds=(-cs-al*lambdas[li].y)/max(den,1e-9);
   let limit=.15/max(max(length(t.b0.xyz),length(t.b1.xyz)),length(t.b2.xyz));
   let displacement=max(max(length(h0)*p0.w,length(h1)*p1.w),max(length(h2)*p2.w,length(h3)*p3.w))*abs(ds);
   ds*=min(1.0,limit/max(displacement,1e-9));lambdas[li].y+=ds;
   p0=vec4f(p0.xyz+h0*ds*p0.w,p0.w);p1=vec4f(p1.xyz+h1*ds*p1.w,p1.w);
   p2=vec4f(p2.xyz+h2*ds*p2.w,p2.w);p3=vec4f(p3.xyz+h3*ds*p3.w,p3.w);
 }
 // Re-evaluate volume after the strain projection, not from stale positions.
 let a=p1.xyz-p0.xyz;let b=p2.xyz-p0.xyz;let c=p3.xyz-p0.xyz;
 let vol=dot(a,cross(b,c))/6.0;
 let g1=cross(b,c)/(6*v0);let g2=cross(c,a)/(6*v0);let g3=cross(a,b)/(6*v0);let g0=-(g1+g2+g3);
 let av=u.volumeCompliance/(v0*u.dt*u.dt);
 let denom=p0.w*dot(g0,g0)+p1.w*dot(g1,g1)+p2.w*dot(g2,g2)+p3.w*dot(g3,g3)+av;
 let restJ=1.0;
 var dl=(-(vol/v0-restJ)-av*lambdas[li].x)/max(denom,1e-9);
 let limit=.15/max(max(length(t.b0.xyz),length(t.b1.xyz)),length(t.b2.xyz));
 let displacement=max(max(length(g0)*p0.w,length(g1)*p1.w),max(length(g2)*p2.w,length(g3)*p3.w))*abs(dl);
 dl*=min(1.0,limit/max(displacement,1e-9));lambdas[li].x+=dl;
 applyPosition(t.ids.x,vec4f(p0.xyz+g0*dl*p0.w,p0.w));applyPosition(t.ids.y,vec4f(p1.xyz+g1*dl*p1.w,p1.w));
 applyPosition(t.ids.z,vec4f(p2.xyz+g2*dl*p2.w,p2.w));applyPosition(t.ids.w,vec4f(p3.xyz+g3*dl*p3.w,p3.w));
 let err=abs(vol/v0-1.0);
 nodes[t.ids.x].info.z=max(nodes[t.ids.x].info.z,err);nodes[t.ids.y].info.z=max(nodes[t.ids.y].info.z,err);
 nodes[t.ids.z].info.z=max(nodes[t.ids.z].info.z,err);nodes[t.ids.w].info.z=max(nodes[t.ids.w].info.z,err);
 // Each colour is a matching. No two invocations write the same node.
}
@compute @workgroup_size(64) fn contact(@builtin(global_invocation_id) gid:vec3u) {
 let i=gid.x;if(i>=u.nodes){return;}var n=nodes[i];if(n.p.w==0){return;}
 let floor=ground(n.p.x); let penetration=max(0.0,floor-n.p.y);
 n.p.y+=penetration; n.info.x+=penetration;
 // Accumulated tangential displacement, projected onto a Coulomb disk.
 let travel=vec2f(n.p.x-n.previous.x+u.speed*u.dt,n.p.z-n.previous.z);
 let limit=u.friction*n.info.x;
 let old=n.info.yw;
 let raw=travel-old;
 let frictionTarget=-raw*min(1.0,limit/max(length(raw),1e-8)); let change=frictionTarget-old;
 n.p.x+=change.x;n.p.z+=change.y;
 let extraDepth=max(0.0,ground(n.p.x)-n.p.y);n.p.y+=extraDepth;n.info.x+=extraDepth;
 n.info.y=frictionTarget.x;n.info.w=frictionTarget.y;
 nodes[i]=n;
}
@compute @workgroup_size(64) fn finish(@builtin(global_invocation_id) gid:vec3u) {
 let i=gid.x;if(i>=u.nodes){return;}var n=nodes[i];
 n.velocity=vec4f((n.p.xyz-n.previous.xyz)/u.dt*.996,0);nodes[i]=n;
}
// Parallel block reduction; the final pass only visits O(block count) records.
var<workgroup> forceScratch: array<vec4f,64>;
var<workgroup> qualityScratch: array<vec4f,64>;
@compute @workgroup_size(64) fn reducePartials(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) group:vec3u) {
 let i=gid.x;var f=vec4f(0);var q=vec4f(0,1,0,0);
 if(i<u.nodes){let n=nodes[i];
  if(n.info.x>0){let scale=1.0/max(n.p.w,1e-9)/(u.dt*u.dt);f=vec4f(n.info.y,n.info.x,n.info.w,1)*vec4f(scale,scale,scale,1);}

  if(!all(abs(n.p.xyz)<vec3f(20))){q.z=1;}
 }
 if(i<u.tets){let t=tets[i];let p=nodes[t.ids.x].p.xyz;
  q.y=dot(nodes[t.ids.y].p.xyz-p,cross(nodes[t.ids.z].p.xyz-p,nodes[t.ids.w].p.xyz-p))/(6*t.b2.w);q.x=abs(q.y-1.0);
 }
 forceScratch[lid.x]=f;qualityScratch[lid.x]=q;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){
  if(lid.x<stride){forceScratch[lid.x]+=forceScratch[lid.x+stride];
   let a=qualityScratch[lid.x];let b=qualityScratch[lid.x+stride];qualityScratch[lid.x]=vec4f(max(a.x,b.x),min(a.y,b.y),a.z+b.z,0);
  }workgroupBarrier();
 }
 if(lid.x==0u){stats[2+group.x*2]=forceScratch[0];stats[3+group.x*2]=qualityScratch[0];}
}
@compute @workgroup_size(1) fn reduce() {
 var f=vec4f(0);var q=vec4f(0,1,0,0);
 let blocks=(max(u.nodes,u.tets)+63u)/64u;
 for(var i=0u;i<blocks;i++){
  f+=stats[2+i*2];let b=stats[3+i*2];q=vec4f(max(q.x,b.x),min(q.y,b.y),q.z+b.z,0);
 }
 stats[0]+=f;stats[1]=q;
}
