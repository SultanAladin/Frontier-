// tyre-lab-release: tyre-gpu-20261016-r4
// One shared surface for compute collision AND render geometry. Units: metres.
// The cleat is attached to the moving belt (3 m repeat), not a static floor tint.
fn wrapSigned(x:f32, period:f32)->f32 { return x-period*floor(x/period+.5); }
fn edgeMask(x:f32, inner:f32, outer:f32)->vec2f {
 let a=abs(x);if(a<=inner){return vec2f(1,0);}if(a>=outer){return vec2f(0);}
 let q=(a-inner)/(outer-inner);
 return vec2f(1-q*q*(3-2*q),-sign(x)*6*q*(1-q)/(outer-inner));
}
// result = (surface height, dh/dx, dh/dz). Outside the belt: workshop floor.
fn roadProfile(p:vec2f, cleatHeight:f32, beltPhase:f32)->vec3f {
 let mx=edgeMask(p.x,1.46,1.5);let mz=edgeMask(p.y,.275,.315);
 let mask=mx.x*mz.x;if(mask==0){return vec3f(-.035,0,0);}
 var h=0.0;var dx=0.0;
 if(cleatHeight>0){
  let d=wrapSigned(p.x+beltPhase-.08,3.0);let q=d/.09;
  h=cleatHeight*exp(-q*q);dx=h*(-2*d/(.09*.09));
 }
 return vec3f(-.035+mask*(.035+h),mx.y*mz.x*(.035+h)+mask*dx,mx.x*mz.y*(.035+h));
}
fn roadNormal(profile:vec3f)->vec3f {return normalize(vec3f(-profile.y,1,-profile.z));}
