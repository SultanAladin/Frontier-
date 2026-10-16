// tyre-lab-release: tyre-gpu-20261016-r3
struct Node { p: vec4f, previous: vec4f, velocity: vec4f, rest: vec4f, info: vec4f }
struct Edge { ids: vec2u, length: f32, pad: f32 }
struct Tet { ids: vec4u, b0: vec4f, b1: vec4f, b2: vec4f }
struct Params { dt: f32, angle: f32, height: f32, speed: f32,
  edgeCompliance: f32, volumeCompliance: f32, strainCompliance: f32, friction: f32,
  nodes: u32, edges: u32, tets: u32, model: u32,
  substepIndex: u32, obstacle: f32, batchStart: u32, batchCount: u32 }
@group(0) @binding(0) var<storage,read_write> nodes: array<Node>;
@group(0) @binding(1) var<storage,read> edges: array<Edge>;
@group(0) @binding(2) var<storage,read> tets: array<Tet>;
@group(0) @binding(3) var<storage,read> schedule: array<u32>;
@group(0) @binding(4) var<storage,read_write> lambdas: array<vec2f>;
@group(0) @binding(5) var<uniform> u: Params;
@group(0) @binding(6) var<storage,read_write> stats: array<vec4f>;
@group(0) @binding(7) var<storage,read_write> rotationBits: array<vec4u>;
@group(0) @binding(8) var<storage,read_write> tickContacts: array<vec4f>;
fn quatMatrix(q:vec4f)->mat3x3f {
 let x=q.x;let y=q.y;let z=q.z;let w=q.w;
 return mat3x3f(vec3f(1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y)),
   vec3f(2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x)),vec3f(2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y)));
}
// tickContacts layout: [N tick-force records][N contact ledgers][3 rig records].
// rig records: accepted, trial, start-of-tick; (angle, hub height, cleat height, belt phase).
fn trialRig()->vec4f {return tickContacts[2*u.nodes+1];}
fn trialRoad(p:vec3f)->vec3f {let r=trialRig();return roadProfile(p.xz,r.z,r.w);}
fn hub(r:vec3f)->vec3f {
 let rig=trialRig();let a=-rig.x;let c=cos(a);let s=sin(a);
 return vec3f(c*r.x-s*r.y,s*r.x+c*r.y+rig.y,r.z);
}
@compute @workgroup_size(1) fn beginStep(){
 let r=tickContacts[2*u.nodes];
 if(u.substepIndex==0u){tickContacts[2*u.nodes+2]=r;}
 // Integrate from ACCEPTED GPU state, never from a CPU clock that runs ahead
 // while the guard is limiting. This prevents accumulated phase/pose wind-up.
 tickContacts[2*u.nodes+1]=vec4f(r.x+u.speed*u.dt/.48,
  r.y+clamp(u.height-r.y,-.06*u.dt,.06*u.dt),
  r.z+clamp(u.obstacle-r.z,-.048*u.dt,.048*u.dt),r.w+u.speed*u.dt);
}
fn applyPosition(i:u32,p:vec4f){
 if(p.w==0){return;}var v=p;let r=trialRig();
 // All belt heights are <= cleat height. Most nodes need no terrain evaluation.
 if(v.y<r.z){
  for(var k=0;k<3;k++){
   let profile=roadProfile(v.xz,r.z,r.w);let gap=profile.x-v.y;
   if(gap<=1e-7){break;}
   let grad=vec3f(-profile.y,1,-profile.z);let correction=grad*(gap/dot(grad,grad));
   v=vec4f(v.xyz+correction,v.w);
   nodes[i].info.x+=length(correction);
   tickContacts[u.nodes+i]+=vec4f(correction,0);
  }
 }
 nodes[i].p=v;
}
@compute @workgroup_size(64) fn predict(@builtin(global_invocation_id) gid:vec3u) {
 let i=gid.x;
 // Clearing multipliers is independent of the node prediction; fuse the dispatch.
 if((u.model & 1u)==1u){if(i<u.tets){lambdas[u.edges+i]=vec2f(0);}}
 else {if(i<u.edges+u.tets){lambdas[i]=vec2f(0);}}
 if(i>=u.nodes){return;}
 var n=nodes[i]; n.previous=n.p; n.info=vec4f(0);
 tickContacts[u.nodes+i]=vec4f(0);
 if(n.p.w==0){n.p=vec4f(hub(n.rest.xyz),0);n.velocity=vec4f(0);}
 else {n.velocity.y-=9.81*u.dt; n.p=vec4f(n.p.xyz+n.velocity.xyz*u.dt,n.p.w);}
 nodes[i]=n;
}
@compute @workgroup_size(64) fn solveEdges(@builtin(global_invocation_id) gid:vec3u) {
 if(gid.x>=u.batchCount){return;}let i=schedule[u.batchStart+gid.x];
 let e=edges[i]; let a=nodes[e.ids.x].p; let b=nodes[e.ids.y].p;
 if(a.w+b.w==0){return;}
 let d=a.xyz-b.xyz; let len=length(d); let alpha=u.edgeCompliance/(u.dt*u.dt);
 let dl=(-(len-e.length)-alpha*lambdas[i].x)/max(a.w+b.w+alpha,1e-9);
 lambdas[i].x+=dl; let g=d/max(len,1e-7);
 applyPosition(e.ids.x,vec4f(a.xyz+g*dl*a.w,a.w));applyPosition(e.ids.y,vec4f(b.xyz-g*dl*b.w,b.w));
}
@compute @workgroup_size(64) fn solveTets(@builtin(global_invocation_id) gid:vec3u) {
 if(gid.x>=u.batchCount){return;}let i=schedule[u.batchStart+gid.x];
 let t=tets[i];var p0=nodes[t.ids.x].p;var p1=nodes[t.ids.y].p;var p2=nodes[t.ids.z].p;var p3=nodes[t.ids.w].p;
 let v0=t.b2.w;let li=u.edges+i;
 if((u.model & 1u)==1u){
   // Corotational energy: mu/2 * ||F-R||² + K/2 * (J-1)².
   // The proper polar rotation removes rigid motion from material strain.
   // F = Ds * inverse(Dm). Not a surface shader or a spring force.
   let a=p1.xyz-p0.xyz;let b=p2.xyz-p0.xyz;let c=p3.xyz-p0.xyz;
   let f0=a*t.b0.x+b*t.b1.x+c*t.b2.x;
   let f1=a*t.b0.y+b*t.b1.y+c*t.b2.y;
   let f2=a*t.b0.z+b*t.b1.z+c*t.b2.z;
   // Persistent quaternion polar extraction (no inverse of a nearly singular F).
   var q=bitcast<vec4f>(rotationBits[i]);var rotation=quatMatrix(q);
   for(var k=0;k<4;k++){
     let omega=(cross(rotation[0],f0)+cross(rotation[1],f1)+cross(rotation[2],f2))/
       (abs(dot(rotation[0],f0)+dot(rotation[1],f1)+dot(rotation[2],f2))+1e-8);
     let angle=length(omega);
     if(angle<=1e-6){break;}
     if(angle>1e-6){let a=min(angle,.5);let dq=vec4f(omega/angle*sin(a*.5),cos(a*.5));
       q=normalize(vec4f(dq.w*q.xyz+q.w*dq.xyz+cross(dq.xyz,q.xyz),dq.w*q.w-dot(dq.xyz,q.xyz)));
       rotation=quatMatrix(q);
     }
   }
   rotationBits[i]=bitcast<vec4u>(q);
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
 if((u.model & 2u)!=0u){
 let err=abs(vol/v0-1.0);
 nodes[t.ids.x].info.z=max(nodes[t.ids.x].info.z,err);nodes[t.ids.y].info.z=max(nodes[t.ids.y].info.z,err);
 nodes[t.ids.z].info.z=max(nodes[t.ids.z].info.z,err);nodes[t.ids.w].info.z=max(nodes[t.ids.w].info.z,err);
 }
 // Each colour is a matching. No two invocations write the same node.
}
@compute @workgroup_size(64) fn contact(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=u.nodes){return;}if(nodes[i].p.w==0){return;}
 applyPosition(i,nodes[i].p);
 var n=nodes[i];if(n.info.x<=0){return;}
 var ledger=tickContacts[u.nodes+i];let normal=roadNormal(trialRoad(n.p.xyz));
 let old=vec3f(n.info.y,ledger.w,n.info.w);
 let relative=n.p.xyz-n.previous.xyz+vec3f(u.speed*u.dt,0,0)-old;
 let tangent=relative-normal*dot(relative,normal);
 let frictionTarget=-tangent*min(1.0,u.friction*n.info.x/max(length(tangent),1e-8));
 n.p=vec4f(n.p.xyz+frictionTarget-old,n.p.w);
 n.info.y=frictionTarget.x;n.info.w=frictionTarget.z;ledger.w=frictionTarget.y;
 nodes[i]=n;tickContacts[u.nodes+i]=ledger;
 applyPosition(i,n.p);
}
// Global admissibility filter. Constraints first propose a substep; acceptance is
// measured against the LAST ACCEPTED mesh, not just the tet being solved.
// For A=old Ds and B=delta Ds, ||alpha A^-1 B||_F <= eta < 1 keeps
// det(I+alpha A^-1 B)>0 along the entire interpolation. The eta choice also
// bounds J >= 0.1 in exact arithmetic. This is a safety limiter, not a physical
// collision/energy solver. Limited reactions must not drive a chassis.
var<workgroup> safeScratch: array<f32,64>;
var<workgroup> jacobianScratch: array<f32,64>;
@compute @workgroup_size(64) fn guardPartials(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) group:vec3u) {
 var safe=1.0;var candidateJ=1.0;
 if(gid.x<u.tets){
  let t=tets[gid.x];let o0=nodes[t.ids.x].previous.xyz;
  let a=nodes[t.ids.y].previous.xyz-o0;let b=nodes[t.ids.z].previous.xyz-o0;let c=nodes[t.ids.w].previous.xyz-o0;
  let det=dot(a,cross(b,c));let j=det/(6*t.b2.w);
  let p=nodes[t.ids.x].p.xyz;
  candidateJ=dot(nodes[t.ids.y].p.xyz-p,cross(nodes[t.ids.z].p.xyz-p,nodes[t.ids.w].p.xyz-p))/(6*t.b2.w);
  let d0=nodes[t.ids.x].p.xyz-o0;
  let da=nodes[t.ids.y].p.xyz-nodes[t.ids.y].previous.xyz-d0;
  let db=nodes[t.ids.z].p.xyz-nodes[t.ids.z].previous.xyz-d0;
  let dc=nodes[t.ids.w].p.xyz-nodes[t.ids.w].previous.xyz-d0;
  if(!(j>.099) || !all(abs(nodes[t.ids.x].p.xyz)<vec3f(20)) || !all(abs(nodes[t.ids.y].p.xyz)<vec3f(20)) || !all(abs(nodes[t.ids.z].p.xyz)<vec3f(20)) || !all(abs(nodes[t.ids.w].p.xyz)<vec3f(20)) || !all(abs(da)<vec3f(10)) || !all(abs(db)<vec3f(10)) || !all(abs(dc)<vec3f(10))){safe=0;}
  else {
   let r0=cross(b,c)/det;let r1=cross(c,a)/det;let r2=cross(a,b)/det;
   let e0=vec3f(dot(r0,da),dot(r1,da),dot(r2,da));
   let e1=vec3f(dot(r0,db),dot(r1,db),dot(r2,db));
   let e2=vec3f(dot(r0,dc),dot(r1,dc),dot(r2,dc));
   let norm=sqrt(dot(e0,e0)+dot(e1,e1)+dot(e2,e2));
   let eta=min(.5,.8*max(0.0,1.0-pow(.1/max(j,.1),1.0/3.0)));
   safe=min(1.0,eta/max(norm,1e-9));if(safe<1){safe*=.95;}
  }
 }
 safeScratch[lid.x]=safe;jacobianScratch[lid.x]=candidateJ;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(lid.x<stride){safeScratch[lid.x]=min(safeScratch[lid.x],safeScratch[lid.x+stride]);jacobianScratch[lid.x]=min(jacobianScratch[lid.x],jacobianScratch[lid.x+stride]);}workgroupBarrier();}
 if(lid.x==0u){stats[4+group.x*2]=vec4f(safeScratch[0],jacobianScratch[0],0,0);}
}
@compute @workgroup_size(1) fn guardReduce(){
 var safe=1.0;var minJ=1.0;let blocks=(u.tets+63u)/64u;
 for(var i=0u;i<blocks;i++){safe=min(safe,stats[4+i*2].x);minJ=min(minJ,stats[4+i*2].y);}
 stats[2].x=safe;stats[2].y=minJ;
 if(minJ<.3){stats[3].w=1;}
}
// Alternate bind group redirects binding 7 to GPU indirect arguments here.
// During solveBarrier it is restored to the quaternion buffer, so the indirect
// buffer is NOT simultaneously bound as writable storage and indirect input.
@compute @workgroup_size(64) fn prepareRepair(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=arrayLength(&rotationBits)){return;}
 let colours=arrayLength(&rotationBits)-3u;var groups=1u;
 if(i<colours){groups=schedule[u.edges+u.tets+i];}
 else if(i==colours){groups=(u.nodes+63u)/64u;}
 else if(i==colours+1u){groups=(u.tets+63u)/64u;}
 groups=select(0u,groups,stats[2].y<.3);
 rotationBits[i]=vec4u(groups,1,1,0);
}
// Local unilateral volume barrier: remove a bad proposal BEFORE falling back to
// whole-mesh interpolation. The global guard remains the final admissibility check.
@compute @workgroup_size(64) fn solveBarrier(@builtin(global_invocation_id) gid:vec3u){
 if(gid.x>=u.batchCount || stats[2].y>=.3){return;}
 let i=schedule[u.batchStart+gid.x];let t=tets[i];
 let p0=nodes[t.ids.x].p;let p1=nodes[t.ids.y].p;let p2=nodes[t.ids.z].p;let p3=nodes[t.ids.w].p;
 let a=p1.xyz-p0.xyz;let b=p2.xyz-p0.xyz;let c=p3.xyz-p0.xyz;let v=t.b2.w;
 let j=dot(a,cross(b,c))/(6*v);if(j>=.35){return;}
 let g1=cross(b,c)/(6*v);let g2=cross(c,a)/(6*v);let g3=cross(a,b)/(6*v);let g0=-(g1+g2+g3);
 let den=p0.w*dot(g0,g0)+p1.w*dot(g1,g1)+p2.w*dot(g2,g2)+p3.w*dot(g3,g3);
 var dl=(.35-j)/max(den,1e-9);
 let limit=.15/max(max(length(t.b0.xyz),length(t.b1.xyz)),length(t.b2.xyz));
 let displacement=max(max(length(g0)*p0.w,length(g1)*p1.w),max(length(g2)*p2.w,length(g3)*p3.w))*abs(dl);
 dl*=min(1.0,limit/max(displacement,1e-9));
 applyPosition(t.ids.x,vec4f(p0.xyz+g0*dl*p0.w,p0.w));applyPosition(t.ids.y,vec4f(p1.xyz+g1*dl*p1.w,p1.w));
 applyPosition(t.ids.z,vec4f(p2.xyz+g2*dl*p2.w,p2.w));applyPosition(t.ids.w,vec4f(p3.xyz+g3*dl*p3.w,p3.w));
}
@compute @workgroup_size(1) fn commitRig(){
 let safe=stats[2].x;stats[1].w=min(stats[1].w,safe);
 let old=tickContacts[2*u.nodes];let trial=tickContacts[2*u.nodes+1];
 var accepted=old;if(safe>0){accepted=old+safe*(trial-old);}
 accepted.x=wrapSigned(accepted.x,6.28318530718);accepted.w=wrapSigned(accepted.w,3.0);
 tickContacts[2*u.nodes]=accepted;
}
@compute @workgroup_size(64) fn finish(@builtin(global_invocation_id) gid:vec3u) {
 let i=gid.x;if(i>=u.nodes){return;}var n=nodes[i];let safe=stats[2].x;
 // Branch, not mix: zero * NaN would still poison a rejected state.
 if(safe<=0){n.p=vec4f(n.previous.xyz,n.p.w);n.info=vec4f(0);}else if(safe<1){n.p=vec4f(n.previous.xyz+safe*(n.p.xyz-n.previous.xyz),n.p.w);}
 n.velocity=vec4f((n.p.xyz-n.previous.xyz)/u.dt*pow(.996,u.dt*240),0);nodes[i]=n;
 var f=vec4f(0);
 if(n.info.x>0 && n.p.w>0){let scale=1.0/n.p.w/(u.dt*u.dt);
  let ledger=tickContacts[u.nodes+i];let correction=ledger.xyz+vec3f(n.info.y,ledger.w,n.info.w);
  f=vec4f(correction*scale,1);
 }
 // Weighted average over a 1/60s tick; works for 4, 8 or 16 substeps.
 let contribution=f*(60*u.dt);
 if(u.substepIndex==0u){tickContacts[i]=contribution;}else{tickContacts[i]+=contribution;}
}
// Parallel block reduction; the final pass only visits O(block count) records.
var<workgroup> forceScratch: array<vec4f,64>;
var<workgroup> qualityScratch: array<vec4f,64>;
@compute @workgroup_size(64) fn reducePartials(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) group:vec3u) {
 let i=gid.x;var f=vec4f(0);var q=vec4f(0,1,0,0);
 if(i<u.nodes){let n=nodes[i];f=tickContacts[i];
  if(!all(abs(n.p.xyz)<vec3f(20))){q.z=1;}
  let rig=tickContacts[2*u.nodes];q.w=max(0.0,roadProfile(n.p.xz,rig.z,rig.w).x-n.p.y);
 }
 if(i<u.tets){let t=tets[i];let p=nodes[t.ids.x].p.xyz;
  q.y=dot(nodes[t.ids.y].p.xyz-p,cross(nodes[t.ids.z].p.xyz-p,nodes[t.ids.w].p.xyz-p))/(6*t.b2.w);q.x=abs(q.y-1.0);
 }
 forceScratch[lid.x]=f;qualityScratch[lid.x]=q;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){
  if(lid.x<stride){forceScratch[lid.x]+=forceScratch[lid.x+stride];
   let a=qualityScratch[lid.x];let b=qualityScratch[lid.x+stride];qualityScratch[lid.x]=vec4f(max(a.x,b.x),min(a.y,b.y),a.z+b.z,max(a.w,b.w));
  }workgroupBarrier();
 }
 if(lid.x==0u){stats[4+group.x*2]=forceScratch[0];stats[5+group.x*2]=qualityScratch[0];}
}
@compute @workgroup_size(1) fn reduce() {
 var f=vec4f(0);var q=vec4f(0,1,0,0);
 let blocks=(max(u.nodes,u.tets)+63u)/64u;
 for(var i=0u;i<blocks;i++){
  f+=stats[4+i*2];let b=stats[5+i*2];q=vec4f(max(q.x,b.x),min(q.y,b.y),q.z+b.z,max(q.w,b.w));
 }
 stats[0]=f;stats[3].x=q.w;stats[1]=vec4f(q.xyz,stats[1].w);
 let rig=tickContacts[2*u.nodes];let start=tickContacts[2*u.nodes+2];
 stats[2].y=wrapSigned(rig.w-start.w,3.0)*60;
 stats[2].z=(.48-rig.y)*1000;stats[2].w=rig.z;
 stats[3].y=wrapSigned(rig.x-start.x,6.28318530718)*60;
 stats[3].z=rig.w;
}
