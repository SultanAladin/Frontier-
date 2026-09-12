
#extension GL_OES_standard_derivatives : enable
precision highp float;
#define PI 3.14159265
#define MAXM 4
uniform vec2 uRes; uniform float uTime; uniform float uProbe; uniform vec3 uSkyAmb; uniform float uStarCeil;
uniform float uWSpeed,uWDir,uWGust,uWTurb,uWShear,uWVeer,uWGustPhase; uniform vec2 uWInt; uniform float uWLinkCL,uWLinkLC,uWLinkVF,uWLinkFog;
uniform vec3 uCamFwd,uCamRight,uCamUp,uCamPos; uniform float uTanHalf,uCamHeight;
uniform float uPlaneOn,uPlaneSize,uPlaneCell,uPlaneY,uPlaneGrid; uniform vec3 uPlaneA,uPlaneB;
uniform vec3 uSunDir,uSunColor; uniform float uSunIntensity,uSunAng,uSunSoft,uSunVisible,uSunDiscBoost;
uniform float uRayleigh,uMie,uMieG,uOzone,uPlanetR,uAtmoH,uHr,uHm,uAtmoVisible;
uniform vec3 uSkyTint,uGroundColor; uniform float uSkyBright,uGroundBright,uSkyVisible,uHLInt,uDawnInt,uHLAuto;
uniform int uMoonCount; uniform vec3 uMoonDir[MAXM]; uniform vec3 uMoonTint[MAXM]; uniform vec4 uMoonP[MAXM]; uniform vec4 uMoonSurf[MAXM]; uniform sampler2D uMoonTex0,uMoonTex1,uMoonTex2,uMoonTex3;
uniform float uEV,uTonemap,uBloom,uVignette,uGrain,uFlareOn,uFlareInt,uGhosts,uHalo,uStreak,uChroma,uFlareType;
uniform vec2 uSunUV; uniform float uSunInFront;
uniform float uFogOn,uFogDensity,uFogHeight,uFogScatter; uniform vec3 uFogColor;
uniform float uAFOn,uAFDensity,uAFHeight,uAFStart,uAFMie,uAFG,uAFSky; uniform vec3 uAFTint;                 // atmospheric (aerial perspective) fog
uniform float uVFOn,uVFDensity,uVFNoise,uVFScale,uVFSpeed,uVFG,uVFSoft,uVFAbsorb,uVFShape,uVFSteps,uVFSelf,uVFFall; uniform vec3 uVFPos,uVFSize,uVFAlbedo;   // local volumetric fog
uniform vec3 uPLPos,uPLCol,uSLPos,uSLDir,uSLCol; uniform float uPLOn,uPLInt,uPLReach,uPLDecay,uSLOn,uSLInt,uSLCos,uSLSoft;
uniform float uCloudOn,uCloudCov,uCloudDen,uCloudAlt,uCloudScale,uCloudDetail,uCloudSpeed; uniform vec3 uCloudTint,uCloudShade;
uniform float uCLOn,uCLBase,uCLThick,uCLCov,uCLDen,uCLScale,uCLDetail,uCLAnvil,uCLWind,uCLWindDir,uCLG1,uCLG2,uCLMix,uCLAbsorb,uCLAmb,uCLPowder,uCLSteps,uCLType; uniform vec3 uCLAlbedo;
uniform float uCLTaps; uniform float uRBOn,uRBInt,uRBWidth,uRBSecondary,uRBRain,uRBSuper; uniform float uLCOn,uLCCov,uLCDen,uLCScale,uLCDetail,uLCSoft,uLCShape,uLCSteps,uLCWind,uLCType; uniform vec3 uLCPos,uLCSize;   // local cloud volume
uniform float uTerrOn,uTerrSize,uTerrHeight,uTerrFreq,uTerrSeed,uTerrRough,uTerrWire; uniform vec3 uTerrLow,uTerrHigh,uTerrPos;
uniform float uStarQuality,uStarLayers,uStarAA; uniform vec4 uPresence; /* x=shadows y=GI z=collide */
uniform float uStarsOn,uStarDensity,uStarBright,uStarSize,uStarGlow,uStarTwinkle,uStarColor,uStarLimit,uMilky,uStarRot,uMilkyTilt;

vec3 hash33(vec3 p){ p=fract(p*vec3(.1031,.1030,.0973)); p+=dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
float hash13(vec3 p){ p=fract(p*.1031); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vnoise(vec3 p){ vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5;} return s; }

vec2 rsi(vec3 ro,vec3 rd,float r){ float b=dot(ro,rd); float c=dot(ro,ro)-r*r; float d=b*b-c; if(d<0.) return vec2(-1.,-1.); d=sqrt(d); return vec2(-b-d,-b+d); }
// ---------- stars ----------
vec3 kelvin(float t){ // approx blackbody 2000..12000K
  float x=clamp((t-2000.)/10000.,0.,1.);
  vec3 c=mix(vec3(1.,.55,.25),vec3(1.,.93,.86),smoothstep(0.,.4,x)); c=mix(c,vec3(.72,.82,1.),smoothstep(.4,1.,x)); return c; }
vec3 rotY(vec3 v,float a){ float c=cos(a),s=sin(a); return vec3(c*v.x+s*v.z,v.y,-s*v.x+c*v.z); }
vec3 rotX(vec3 v,float a){ float c=cos(a),s=sin(a); return vec3(v.x,c*v.y-s*v.z,s*v.y+c*v.z); }
// octahedral mapping: direction <-> unit square (equal-ish area, single chart)
vec2 octEncode(vec3 n){ n/=abs(n.x)+abs(n.y)+abs(n.z); vec2 p=n.xz; if(n.y<0.) p=(1.-abs(p.yx))*vec2(p.x>=0.?1.:-1.,p.y>=0.?1.:-1.); return p*.5+.5; }
vec3 octDecode(vec2 f){ f=f*2.-1.; vec3 n=vec3(f.x,1.-abs(f.x)-abs(f.y),f.y); float t=max(-n.y,0.); n.x+=n.x>=0.?-t:t; n.z+=n.z>=0.?-t:t; return normalize(n); }
// returns hdr radiance of stars in direction d (before atmospheric extinction). pixAng = angular size of one pixel (rad)
vec3 starField(vec3 d,float pixAng,float am){
  vec3 sd=rotX(rotY(d,uStarRot),uMilkyTilt);
  vec3 col=vec3(0.);
  // ---- Milky Way: smooth band with 3-octave value noise (dust lanes darken the core) ----
  float band=exp(-pow(sd.y/.15,2.));
  float n=vnoise(sd*6.)*.5+vnoise(sd*13.+3.1)*.3+vnoise(sd*29.+7.3)*.2;
  float dust=smoothstep(.35,.7,vnoise(sd*9.+vec3(5.2,1.1,8.8)))*exp(-pow(sd.y/.06,2.))*.8;
  float mw=band*(.35+.65*n)*(1.-dust)*uMilky;
  col+=mix(vec3(.55,.62,.9),vec3(.95,.85,.7),dust*.6)*mw*3.2e-4;
  // ---- point stars: 3 layers on an octahedral grid, 3x3 neighbour search => no cell clipping ----
  vec2 ouv=octEncode(sd);
  for(int o=0;o<4;o++){
    if(float(o)>=uStarLayers) break;
    float freq=(o==0)?18.:(o==1)?46.:(o==2)?110.:230.;
    float density=(o==0)?.28:(o==1)?.42:(o==2)?.6:.7;
    float layerGain=(o==0)?1.:(o==1)?.4:(o==2)?.15:.06;
    vec2 gp=ouv*freq; vec2 base=floor(gp);
    for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
      vec2 cell=base+vec2(float(i),float(j)); vec3 h=hash33(vec3(cell,float(o)*17.));
      if(h.x<1.-density*uStarDensity) continue;
      vec2 suv=(cell+.5+(h.yz-.5)*.9)/freq; vec3 sdir=octDecode(clamp(suv,0.,1.));
      float ang=acos(clamp(dot(sd,sdir),-1.,1.));
      float bright=(pow(hash13(vec3(cell,3.3+float(o))),8.)*8.+.15)*layerGain;
      bright*=mix(1.,band*2.2+.35,uMilky*.6);
      float ph=hash13(vec3(cell,5.7))*6.283; float tw=1.-uStarTwinkle*(.3+.5*clamp(am/6.,0.,1.))*(.5+.5*sin(uTime*(3.+hash13(vec3(cell,2.2))*8.)+ph));
      float T=mix(2800.,11000.,pow(hash13(vec3(cell,9.1)),1.6)); vec3 sc=mix(vec3(1.),kelvin(T),uStarColor);
      float ps=max(uStarSize*(.0006+bright*.00028),pixAng*.9);          // never smaller than a pixel: every star lands squarely on at least one pixel
      float core=(1.-smoothstep(ps*.55,ps,ang))*(1.+.6*step(2.5,bright)); // flat-topped disc with a half-pixel edge => crisp, full-intensity points
      core*=3.2;                                                           // energy normalisation for the small footprint
      float halo=exp(-pow(ang/(ps*(2.+6.*uStarGlow)),1.5))*.045*uStarGlow*(bright/8.+.03);
      float spikes=0.; if(o==0&&bright>2.5){ vec3 t1=normalize(cross(sdir,vec3(0.,1.,0.)+vec3(1e-3,0.,0.))); vec3 t2=cross(sdir,t1); vec2 q=vec2(dot(sd-sdir,t1),dot(sd-sdir,t2)); float w=max(pixAng*.6,ps*.35); spikes=(exp(-abs(q.x)/w*.5)*exp(-abs(q.y)*70.)+exp(-abs(q.y)/w*.5)*exp(-abs(q.x)*70.))*.3*uStarGlow*(bright/8.); }
      col+=sc*(core+halo+spikes)*bright*tw*2.6e-3;
    }
  }
  return col*uStarBright;
}
void atmosphere(vec3 ro,vec3 rd,out vec3 sky,out vec3 trans,out float ground){
  sky=vec3(0.); trans=vec3(1.); ground=0.;
  float Ra=uPlanetR+uAtmoH; vec2 ta=rsi(ro,rd,Ra); if(ta.y<0.) return;
  float t0=max(ta.x,0.), t1=ta.y; vec2 tg=rsi(ro,rd,uPlanetR); if(tg.x>0.){ t1=tg.x; ground=1.; }
  const int N=20; const int NL=8; float len=t1-t0;
  vec3 betaR=vec3(5.8e-6,13.5e-6,33.1e-6)*uRayleigh; vec3 betaM=vec3(21e-6)*uMie; vec3 betaO=vec3(0.65e-6,1.881e-6,0.085e-6)*uOzone;
  vec3 sumR=vec3(0.),sumM=vec3(0.); float odR=0.,odM=0.; float mu=dot(rd,uSunDir); float g=uMieG;
  float pR=3./(16.*PI)*(1.+mu*mu); float pM=3./(8.*PI)*((1.-g*g)*(1.+mu*mu))/((2.+g*g)*pow(1.+g*g-2.*g*mu,1.5));
  for(int i=0;i<N;i++){
    float s0=float(i)/float(N), s1=float(i+1)/float(N); s0*=s0; s1*=s1;           // quadratic: dense near the camera
    float ta=t0+len*s0, tb=t0+len*s1; float seg=tb-ta; float tm=.5*(ta+tb);
    vec3 p=ro+rd*tm; float h=length(p)-uPlanetR; float hr=exp(-h/uHr)*seg, hm=exp(-h/uHm)*seg; odR+=hr; odM+=hm;
    vec2 tl=rsi(p,uSunDir,Ra); float lenL=tl.y; float olR=0.,olM=0.; bool ok=true;
    for(int j=0;j<NL;j++){ float q0=float(j)/float(NL), q1=float(j+1)/float(NL); q0*=q0; q1*=q1; float segL=lenL*(q1-q0); vec3 q=p+uSunDir*(lenL*.5*(q0+q1)); float hq=length(q)-uPlanetR; if(hq<0.){ok=false;break;} olR+=exp(-hq/uHr)*segL; olM+=exp(-hq/uHm)*segL; }
    if(ok){ vec3 att=exp(-(betaR*(odR+olR)+betaM*1.1*(odM+olM)+betaO*(odR+olR))); sumR+=att*hr; sumM+=att*hm; }
  }
  trans=exp(-(betaR*odR+betaM*1.1*odM+betaO*odR));
  sky=(sumR*betaR*pR+sumM*betaM*pM)*uSunIntensity*uSunColor;
}

// ===== Wind Field: ONE function every medium reads. base(speed,bearing) * altitude shear (Ekman-ish: faster + veering with height)
//       * gust (slow time modulation, phase from CPU so particles agree) + turbulence (curl of low-freq noise => divergence-free swirl).
vec3 gSwirl=vec3(0.);   // per-pixel turbulence displacement, filled once in main()
vec2 windBase(float y){ float km=max(0.,y)/1000.; float sp=uWSpeed*(1.+uWShear*km); float b=uWDir+uWVeer*km*PI/180.; return vec2(sin(b),cos(b))*sp; }
float windGust(){ return 1.+uWGust*(.55*sin(uWGustPhase)+.3*sin(uWGustPhase*2.31+1.7)+.15*sin(uWGustPhase*4.7+.4)); }
vec3 windTurb(vec3 p,float t){ if(uWTurb<=0.) return vec3(0.); vec3 q=p*.02+vec3(t*.05,0.,t*.03); float e=.5;
  float n1=vnoise(q+vec3(0.,e,0.))-vnoise(q-vec3(0.,e,0.)), n2=vnoise(q+vec3(0.,0.,e))-vnoise(q-vec3(0.,0.,e)), n3=vnoise(q+vec3(e,0.,0.))-vnoise(q-vec3(e,0.,0.));
  return vec3(n1-n2,n2-n3,n3-n1)*uWTurb*uWSpeed*.9; }
vec3 windAt(vec3 p,float t){ vec2 b=windBase(p.y)*windGust(); return vec3(b.x,0.,b.y)+windTurb(p,t); }
vec3 windDisp(vec3 p,float t){ vec2 b=windBase(p.y); float f=length(b)/max(1e-3,uWSpeed); return vec3(uWInt.x*f,0.,uWInt.y*f); }   // cheap: 2 trig + 1 mul, safe inside marches
vec3 windSwirl(vec3 p,float t){ return windTurb(p,t)*8.; }                                                                          // 6 noise evals — call ONCE per pixel, never per step
/* ---- moons: UV-sphere textured ---- */
vec3 moonTex(int i,vec2 uv){ if(i==0) return texture2D(uMoonTex0,uv).rgb; if(i==1) return texture2D(uMoonTex1,uv).rgb; if(i==2) return texture2D(uMoonTex2,uv).rgb; return texture2D(uMoonTex3,uv).rgb; }
vec3 moons(vec3 d,vec3 trans){
  vec3 col=vec3(0.);
  for(int i=0;i<MAXM;i++){ if(i>=uMoonCount) break;
    vec3 md=uMoonDir[i]; float ang=uMoonP[i].x, bright=uMoonP[i].y, phase=uMoonP[i].z, glowAmt=uMoonP[i].w;
    float spin=uMoonSurf[i].x, tilt=uMoonSurf[i].y, haze=uMoonSurf[i].z, gam=uMoonSurf[i].w;
    float a=acos(clamp(dot(d,md),-1.,1.));
    vec3 u=normalize(cross(md,vec3(0.,1.,0.))); vec3 v=cross(u,md);
    if(a<ang*1.06){
      vec2 lc=vec2(dot(d,u),dot(d,v))/sin(ang); float r2=dot(lc,lc); float z=sqrt(max(0.,1.-r2));
      // sphere normal in the moon's local frame (x=u right, y=v up, z=toward viewer)
      vec3 n=vec3(lc.x,lc.y,z);
      // axial tilt then spin -> UV
      float ct=cos(tilt),st=sin(tilt); vec3 nt=vec3(n.x,n.y*ct-n.z*st,n.y*st+n.z*ct);
      float lon=atan(nt.x,nt.z)+spin; float lat=asin(clamp(nt.y,-1.,1.));
      vec2 uv=vec2(fract(lon/(2.*PI)+.5),.5-lat/PI);
      vec3 alb=moonTex(i,uv); alb=pow(alb,vec3(gam))*uMoonTint[i];
      // phase lighting: light direction rotates around v in the u/z plane
      float ph=phase*2.*PI; vec3 lit=vec3(sin(ph),0.,cos(ph));
      float wrap=haze*.3; float ndl=max((dot(n,lit)+wrap)/(1.+wrap),0.);
      float edgeW=mix(.975,.88,haze); float edge=1.-smoothstep(ang*edgeW,ang*(1.+haze*.06),a);
      float limb=mix(1.,.5,pow(1.-z,2.)*max(haze,.35));
      col+=alb*bright*(pow(ndl,.8)*limb+.012)*edge;
      float rimA=smoothstep(ang*.8,ang,a)*(1.-smoothstep(ang,ang*1.06,a))*haze; col+=rimA*uMoonTint[i]*bright*.35*(.3+.7*ndl);
    }
    float lum=.4+.6*(.5+.5*cos(phase*2.*PI)); float g=glowAmt*bright*(exp(-a/(ang*1.4))*.09+exp(-a*3.5)*.005)*lum; col+=g*uMoonTint[i];
  }
  return col*trans;
}

/* ---- twilight model: bright segment, colour ramp and the pre-sunrise white line ---- */
vec3 dawnGlow(vec3 dir,float elevDeg,float facing){
  float alt=degrees(asin(clamp(dir.y,-1.,1.))); if(alt<-2.) return vec3(0.);
  float altp=max(alt,0.);
  float dAz=acos(clamp(facing*2.-1.,-1.,1.));                       // 0 at the sun's azimuth
  float az=exp(-pow(dAz/.95,2.));                                   // segment ~55 deg half width
  float azWide=exp(-pow(dAz/1.8,2.));
  float tw=smoothstep(-16.,-5.,elevDeg)*(1.-smoothstep(.5,6.,elevDeg));
  float depth=clamp(-elevDeg/10.,0.,1.);                             // 1 = deep twilight, 0 = sun at horizon
  // colour by altitude, log spaced
  vec3 c0=vec3(1.,.88,.62); vec3 c1=vec3(1.,.62,.28); vec3 c2=vec3(.95,.42,.30); vec3 c3=vec3(.62,.36,.48); vec3 c4=vec3(.25,.30,.58);
  float u=log2(1.+altp*2.);
  vec3 c=mix(c0,c1,smoothstep(0.,1.6,u)); c=mix(c,c2,smoothstep(1.6,2.9,u)); c=mix(c,c3,smoothstep(2.9,4.,u)); c=mix(c,c4,smoothstep(4.,5.2,u));
  c=mix(c,mix(c2,c4,.6),depth*.6);                                   // deep twilight: pinker, no yellow
  // low, tight envelope: glow hugs the horizon and doesn't bleach the dome
  float H=mix(1.9,3.8,depth);
  float env=exp(-altp/H)*(1.-depth*.35);
  float rim=exp(-altp/.45)*(1.-depth);                               // bright rim only when the sun is very near
  vec3 glow=(c*env*.30+c0*rim*.25)*(az*.85+azWide*.15)*tw;
  // the white line: soft hairline centred on the sun, only from ~-5.5 deg to sunrise, then handed over to the disc
  float wlWin=mix(1.,smoothstep(-5.5,-2.5,elevDeg)*(1.-smoothstep(-.6,.3,elevDeg)),uHLAuto);
  float lineAz=exp(-pow(dAz/.55,2.));
  float line=exp(-pow(alt/.11,2.))*(.7+.3*smoothstep(-.4,0.,alt));
  glow+=vec3(1.,.98,.92)*line*lineAz*wlWin*uHLInt*.45;
  // cool twilight dome fill: earth-shadow blue that dominates high up and opposite the sun
  float domeWin=smoothstep(-16.,-8.,elevDeg)*(1.-smoothstep(-2.,4.,elevDeg));
  glow+=vec3(.10,.15,.30)*.035*domeWin*(1.-exp(-altp/6.))*(1.-.5*az);
  return glow*uDawnInt;
}
float airMassOf(float e){ float z=90.-e; if(z>=96.) return 40.; return min(40.,1./(cos(radians(z))+.50572*pow(96.07995-z,-1.6364))); }
/* ---- lens flare ---- */
vec3 hue(float h){ return clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.); }
// ---- ported entities: height fog (exp² of distance, exp height falloff), cloud layer (value-noise slab), height field ----
// ===== Analytic media (Height Fog + Atmospheric Fog) share ONE kernel: the exact integral of exp(-y/H) along a straight segment
//       (Wenzel / Quilez). Each medium evaluates it with its own H and turns the result into its own optical depth; the two are then
//       composited in a single pass (front-to-back: both start at the camera, so their in-scatter is blended by the *combined* transmittance).
float expHeightK(float hh,float y0,float y1){ float ya=max(0.,min(y0,y1)), yb=max(0.,max(y0,y1)); return (yb-ya)<1e-3?exp(-ya/hh):hh*(exp(-ya/hh)-exp(-yb/hh))/(yb-ya); }
float fogT(float d,float y0,float y1){ float od=uFogDensity*d*expHeightK(max(1.,uFogHeight),y0,y1); return exp(-od*od); }
vec3 applyMedia(vec3 col,vec3 dir,float d,vec3 skyAmb,vec3 hzGlow,vec3 trans){ // both analytic fogs in one shot
  bool hf=uFogOn>.5&&uCamHeight<3000., af=uAFOn>.5&&uCamHeight<6000.; if(!hf&&!af) return col;
  float y0=uCamHeight, y1=uCamHeight+dir.y*d; float cosS=clamp(dot(dir,uSunDir),-1.,1.); vec3 sunL=trans*uSunColor*uSunIntensity*.02;
  // height fog (exp² of distance, thick near the ground)
  float Tf=1.; vec3 Lf=vec3(0.);
  if(hf){ Tf=fogT(d,y0,y1); float g=.55; float hg=(1.-g*g)/(4.*3.14159*pow(1.+g*g-2.*g*cosS,1.5)); Lf=uFogColor*(skyAmb*.9+hzGlow*.35)+uFogScatter*hg*sunL*max(uSunDir.y+.1,0.); }
  // atmospheric fog (spectral, Rayleigh/Mie)
  vec3 Ta=vec3(1.); vec3 La=vec3(0.);
  if(af){ float od=uAFDensity*max(0.,d-uAFStart)*expHeightK(max(1.,uAFHeight),y0,y1); if(od>1e-6){ vec3 beta=mix(vec3(5.8e-6,13.5e-6,33.1e-6)/13.5e-6,vec3(1.),uAFMie); Ta=exp(-beta*od);
      float g=uAFG; float hg=(1.-g*g)/(4.*3.14159*pow(1.+g*g-2.*g*cosS,1.5)); La=((skyAmb*.9+hzGlow*.25)*uAFSky+sunL*hg*4.*3.14159*max(uSunDir.y+.08,0.)*mix(1.,.35,uAFMie))*uAFTint; } }
  // combined: the surface is seen through both; each medium's in-scatter is attenuated by the other's transmittance proportionally
  vec3 T=Ta*Tf; vec3 Lin=La*(1.-Ta)*mix(1.,Tf,.5)+Lf*(1.-Tf)*mix(vec3(1.),Ta,.5);
  return col*T+Lin; }
// ===== Local volumetric fog: a finite box / ellipsoid of participating medium, ray-marched with Beer–Lambert transmittance,
//       heterogeneous density from 3-octave value noise advected by wind, HG in-scatter from the sun + the point/spot lights,
//       self-shadowing by a short secondary march toward the sun, and separable absorption (albedo) for realistic darkening.
vec3 vfHalf(){ // effective half-extents of the bounding volume per shape
  if(uVFShape<1.5) return uVFSize;                          // box / ellipsoid: full XYZ
  if(uVFShape<2.5) return vec3(uVFSize.x);                  // sphere: one radius (X drives it)
  return vec3(uVFSize.x,uVFSize.y*.5,uVFSize.x); }          // dome: radius X, height Y (centre of bounds is half-way up)
vec3 vfCenter(){ return uVFShape>2.5?uVFPos+vec3(0.,uVFSize.y*.5,0.):uVFPos; }
float vfShapeMask(vec3 q){ // q in [-1,1] normalised space; m = signed inside-distance (1 at the core, 0 on the shell)
  float m;
  if(uVFShape<.5){ vec3 a=1.-abs(q); m=min(min(a.x,a.y),a.z); }                                   // box
  else if(uVFShape<1.5){ m=1.-length(q); }                                                          // ellipsoid
  else if(uVFShape<2.5){ m=1.-length(q); }                                                          // sphere (q already normalised by one radius)
  else { vec3 e=vec3(uVFSize.x,uVFSize.y,uVFSize.x); vec3 w=q*vfHalf(); vec3 qq=vec3(w.x/e.x,max(w.y+e.y*.5,0.)/e.y*1.0,w.z/e.x);   // dome: base plane at uVFPos.y, apex at +Y
         m=min(1.-length(qq),(w.y+e.y*.5)/e.y*4.); }
  if(uVFFall>.5) return pow(smoothstep(0.,1.,clamp(m,0.,1.)),mix(.35,3.,uVFSoft));                 // density falloff: soft toward the shell over the whole radius
  return smoothstep(0.,max(.02,uVFSoft*.5),m); }                                                    // hard-ish shell with a thin soft rim
float vfDensity(vec3 p){ vec3 q=(p-vfCenter())/vfHalf(); float mask=vfShapeMask(q); if(mask<=0.) return 0.;
  vec3 w=(uWLinkVF>.5)?(windDisp(p,uTime)+gSwirl)*.35/max(.5,uVFScale):vec3(uTime*uVFSpeed*.35,uTime*uVFSpeed*.05,uTime*uVFSpeed*.2); vec3 s=p/max(.5,uVFScale)+w;
  float n=vnoise(s)*.55+vnoise(s*2.3+1.7)*.3+vnoise(s*5.1+4.2)*.15;
  float het=mix(1.,smoothstep(.28,.85,n)*1.6,uVFNoise);
  float grav=1.-.35*clamp(q.y*.5+.5,0.,1.);                                      // denser at the bottom like a real cold pool
  return uVFDensity*mask*het*grav; }
vec2 vfBox(vec3 ro,vec3 rd){ vec3 c=vfCenter(), sz=vfHalf(); vec3 m=1./(rd+1e-6*sign(rd)+1e-9); vec3 n=m*(ro-c); vec3 k=abs(m)*sz; vec3 t1=-n-k,t2=-n+k; float tn=max(max(t1.x,t1.y),t1.z),tf=min(min(t2.x,t2.y),t2.z); return (tn>tf||tf<0.)?vec2(-1.):vec2(max(tn,0.),tf); }
float tfield(vec2 q){ float f=uTerrFreq, s=uTerrSeed; return clamp(.5+.23*sin((q.x*5.3+s*.013)*f)+.16*sin((q.y*7.1-s*.019)*f)+.09*sin((q.x+q.y)*15.7*f),0.,1.); }
float terrH(vec2 xz){ vec2 q=(xz-uTerrPos.xz)/uTerrSize+.5; return uTerrPos.y+tfield(q)*uTerrHeight; }
bool terrHit(vec3 ro,vec3 rd,out float tHit,out vec3 n){ tHit=-1.; if(uTerrOn<.5) return false; float half_=uTerrSize*.5; float t=0., dt=max(.5,uTerrSize/160.); float prevD=0.; bool hit=false;
  for(int i=0;i<160;i++){ vec3 p=ro+rd*t; vec2 l=abs(p.xz-uTerrPos.xz); if(l.x>half_||l.y>half_){ if(t>0.&&p.y>uTerrPos.y+uTerrHeight&&rd.y>=0.) break; } else { float d=p.y-terrH(p.xz); if(d<0.){ t-=dt*d/(d-prevD+1e-5); hit=true; break; } prevD=d; }
    t+=dt; dt*=1.03; if(t>uTerrSize*4.) break; }
  if(!hit) return false; vec3 p=ro+rd*t; float e=uTerrSize/256.; n=normalize(vec3(terrH(p.xz-vec2(e,0.))-terrH(p.xz+vec2(e,0.)),2.*e,terrH(p.xz-vec2(0.,e))-terrH(p.xz+vec2(0.,e)))); tHit=t; return true; }
float cnoise2(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); float a=hash13(vec3(i,7.)),b=hash13(vec3(i+vec2(1,0),7.)),c=hash13(vec3(i+vec2(0,1),7.)),d=hash13(vec3(i+vec2(1,1),7.)); return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
// ===== Volumetric clouds: a slab [uCLBase, uCLBase+uCLThick] ray-marched with Beer–Lambert, per-type vertical density profile
//       (Schneider/Hillaire "Nubis"), Perlin-Worley-ish shape + eroding detail, dual-lobe HG (forward silver lining + back lobe),
//       Beer-powder darkening in the crevices, and a 5-tap light march toward the sun with the multi-scatter octave trick (Wrenninge).
float clHeightProfile(float hn){ // hn 0..1 within the slab; type: 0 stratus 1 stratocumulus 2 cumulus 3 cumulonimbus 4 altostratus 5 cirrus
  float t=uCLType;
  if(t<.5)  return smoothstep(0.,.08,hn)*(1.-smoothstep(.75,1.,hn));                       // stratus: flat sheet filling the slab
  if(t<1.5) return smoothstep(0.,.12,hn)*(1.-smoothstep(.5,.95,hn));                        // stratocumulus: flat base, lumpy top
  if(t<2.5) return smoothstep(0.,.07,hn)*(1.-smoothstep(.35,1.,hn))*1.15;                    // cumulus: flat base, tall bulging tops
  if(t<3.5) return smoothstep(0.,.05,hn)*(1.-smoothstep(.85,1.,hn))*mix(1.,1.6,smoothstep(.7,1.,hn)*uCLAnvil); // cumulonimbus: full column + anvil spread
  if(t<4.5) return smoothstep(0.,.3,hn)*(1.-smoothstep(.6,1.,hn))*.7;                         // altostratus: thin translucent mid layer
  return smoothstep(0.,.4,hn)*(1.-smoothstep(.5,1.,hn))*.35; }                                // cirrus: wispy, low density
float clAlt(vec3 p){ return length(p+vec3(0.,uPlanetR,0.))-uPlanetR; }   // altitude above the sphere (local frame: origin = camera nadir at sea level)
float clDensity(vec3 p,float lod){
  float hn=clamp((clAlt(p)-uCLBase)/max(1.,uCLThick),0.,1.); float prof=clHeightProfile(hn); if(prof<=0.) return 0.;
  vec2 wd=(uWLinkCL>.5)?windDisp(vec3(p.x,uCLBase+hn*uCLThick,p.z),uTime).xz*.8:vec2(sin(uCLWindDir),cos(uCLWindDir))*uCLWind*uTime*.8; vec3 q=p; q.xz+=wd; q.xz+=hn*uCLThick*.35*wd/max(1e-3,length(wd)+1e-3)*(uCLType>2.5?uCLAnvil:0.2); // wind shear leans the column
  float sc=1./(uCLScale*900.); vec3 s=q*sc;
  float shape=vnoise(s)*.5+vnoise(s*2.02+vec3(3.1,1.7,9.2))*.25+vnoise(s*4.1+vec3(7.7,2.2,1.1))*.125+vnoise(s*8.3+vec3(1.3,8.8,4.4))*.0625; shape/=.9375;
  float cirrusStreak=(uCLType>4.5)?vnoise(vec3(s.x*.25,s.y*4.,s.z*6.)):0.; shape=mix(shape,shape*.6+cirrusStreak*.5,step(4.5,uCLType));
  float cov=uCLCov; float base=clamp((shape-(1.-cov))/max(1e-3,cov),0.,1.)*prof;
  if(base<=0.||lod>.5) return base*uCLDen;
  float det=vnoise(q*sc*9.+vec3(uTime*.02))*.6+vnoise(q*sc*19.+vec3(5.))*.4; float erode=mix(det,1.-det,clamp(hn*3.,0.,1.))*uCLDetail*.45;
  return clamp(base-erode*(1.-base),0.,1.)*uCLDen; }
float clHG(float c,float g){ return (1.-g*g)/(4.*3.14159*pow(1.+g*g-2.*g*c,1.5)); }
float clLight(vec3 p){ // optical depth toward the sun: growing-spaced taps; count from the quality tier, far taps coarse
  float od=0.; float st=uCLThick*.12; for(int i=1;i<=5;i++){ if(float(i)>uCLTaps) break; float d=st*float(i)*float(i)*.35; od+=clDensity(p+uSunDir*d,float(i)>2.?1.:0.)*d*.8; } return od; }
vec4 cloudMarch(vec3 ro,vec3 rd,vec3 sky,vec3 trans,float tmax){ if(uCLOn<.5||uCLCov<=.001||uCLDen<=.001) return vec4(0.);
  vec3 po=ro+vec3(0.,uPlanetR,0.); float R0=uPlanetR+uCLBase, R1=R0+uCLThick; float h=length(po)-uPlanetR;
  vec2 i0=rsi(po,rd,R0), i1=rsi(po,rd,R1); vec2 ig=rsi(po,rd,uPlanetR); float t0,t1;
  if(h<uCLBase){ if(i1.y<0.) return vec4(0.); t0=max(i0.y,0.); t1=i1.y; }                                    // below: enter at inner shell, leave at outer
  else if(h>uCLBase+uCLThick){ if(i1.x<0.) return vec4(0.); t0=i1.x; t1=(i0.x>0.)?i0.x:i1.y; if(ig.x>0.&&ig.x<t0) return vec4(0.); }  // above (space): outer shell in, inner shell (or outer again at the limb) out
  else { t0=0.; t1=(i0.x>0.)?i0.x:i1.y; }                                                                     // inside the layer
  if(ig.x>0.) t1=min(t1,ig.x);                                                                                // planet blocks
  t1=min(t1,tmax); float far=(h>uCLBase+uCLThick)?max(60000.,uCLThick*40.):uCLThick*14.; t1=min(t1,t0+far); if(t1<=t0) return vec4(0.);
  float N=uCLSteps; float dt=(t1-t0)/N; float t=t0+dt*hash13(vec3(gl_FragCoord.xy,fract(uTime*3.)));
  float lodFar=smoothstep(20000.,200000.,t0);                                                                 // from orbit: coarse density, no erosion, cheaper light
  float cosS=dot(rd,uSunDir); float ph=mix(clHG(cosS,uCLG1),clHG(cosS,-uCLG2),uCLMix)*4.*3.14159; // dual lobe
  float sunUp=clamp(uSunDir.y*4.+.15,0.,1.); vec3 sunL=trans*uSunColor*uSunIntensity*.02*sunUp; vec3 amb=sky*uCLAmb;
  vec3 acc=vec3(0.); float T=1.; float sigA=uCLAbsorb;
  for(int i=0;i<64;i++){ if(float(i)>=N||T<.015) break; vec3 p=ro+rd*t; float rho=clDensity(p,lodFar);
    if(rho>1e-3){ float od=mix(clLight(p),rho*uCLThick*.3,lodFar); float hn=clamp((clAlt(p)-uCLBase)/max(1.,uCLThick),0.,1.);
      // multi-scatter approximation: sum of 3 octaves with attenuated extinction / boosted contribution
      float ms=0.; float a=1.,b=1.; for(int o=0;o<3;o++){ ms+=b*exp(-od*a*(1.+sigA)); a*=.5; b*=.55; }
      float powder=1.-uCLPowder*exp(-rho*dt*2.*(1.+sigA))*(1.-.5*clamp(cosS,0.,1.));
      vec3 Li=sunL*ph*ms*powder+amb*mix(.35,1.,hn);
      float sigT=rho*(1.+sigA)*.06; float Ts=exp(-sigT*dt); vec3 Sc=Li*uCLAlbedo*rho*.06;
      acc+=T*(Sc-Sc*Ts)/max(sigT,1e-6); T*=Ts; }
    t+=dt; }
  float above=step(uCLBase+uCLThick,h); float aer=(1.-exp(-t0*3e-5))*(1.-above); acc=mix(acc,sky*(1.-T)*.9,aer*.6);   // aerial perspective only when looking through air below the layer
  return vec4(acc,1.-T); }
// ===== Local cloud: the same cloud material confined to a movable box/ellipsoid (a single cumulus you can place)
float lcMask(vec3 q){ float m; if(uLCShape<.5){ vec3 a=1.-abs(q); m=min(min(a.x,a.y),a.z); } else { m=1.-length(q); } return smoothstep(0.,max(.05,uLCSoft),m); }
float lcDensity(vec3 p,float lod){ vec3 q=(p-uLCPos)/uLCSize; float mask=lcMask(q); if(mask<=0.) return 0.;
  float hn=clamp(q.y*.5+.5,0.,1.); float prof=(uLCType<.5)?smoothstep(0.,.1,hn)*(1.-smoothstep(.75,1.,hn)):(uLCType<1.5)?smoothstep(0.,.08,hn)*(1.-smoothstep(.4,1.,hn))*1.15:smoothstep(0.,.3,hn)*(1.-smoothstep(.6,1.,hn))*.6; // 0 stratiform 1 cumuliform 2 wispy
  vec3 s=(p+((uWLinkLC>.5)?windDisp(p,uTime)*.6+gSwirl*.6:vec3(uTime*uLCWind*.6,0.,uTime*uLCWind*.2)))/max(1.,uLCScale);
  float shape=vnoise(s)*.5+vnoise(s*2.02+vec3(3.1,1.7,9.2))*.25+vnoise(s*4.1+vec3(7.7,2.2,1.1))*.125+vnoise(s*8.3+vec3(1.3,8.8,4.4))*.0625; shape/=.9375;
  float cov=uLCCov; float base=clamp((shape-(1.-cov))/max(1e-3,cov),0.,1.)*prof*mask;
  if(base<=0.||lod>.5) return base*uLCDen;
  float det=vnoise(s*9.)*.6+vnoise(s*19.+vec3(5.))*.4; float erode=mix(det,1.-det,clamp(hn*3.,0.,1.))*uLCDetail*.45;
  return clamp(base-erode*(1.-base),0.,1.)*uLCDen; }
vec2 lcBox(vec3 ro,vec3 rd){ vec3 m=1./(rd+1e-6*sign(rd)+1e-9); vec3 n=m*(ro-uLCPos); vec3 k=abs(m)*uLCSize; vec3 t1=-n-k,t2=-n+k; float tn=max(max(t1.x,t1.y),t1.z),tf=min(min(t2.x,t2.y),t2.z); return (tn>tf||tf<0.)?vec2(-1.):vec2(max(tn,0.),tf); }
// ===== Unified local volumetrics: ONE march over the union of the local volumes' bounding intervals.
//       Each medium contributes its own density/albedo; extinction, the sun-shadow march and the light loop are shared,
//       so fog shadows cloud (and vice versa) for free and the per-pixel cost is one loop instead of one per volume.
float uniShadow(vec3 p,float st){ float od=0.; for(int i=1;i<=4;i++){ vec3 q=p+uSunDir*st*float(i)*.5; od+=(vfDensity(q)*(1.+uVFAbsorb)*uVFOn+lcDensity(q,1.)*(1.+uCLAbsorb)*.06*uLCOn)*st*.5; } return exp(-od); }
vec4 marchLocal(vec3 ro,vec3 rd,float tmax,vec3 sky,vec3 hzGlow,vec3 trans){
  vec2 bf=(uVFOn>.5)?vfBox(ro,rd):vec2(-1.), bc=(uLCOn>.5)?lcBox(ro,rd):vec2(-1.);
  if(bc.x>=0.){ vec3 po=ro+vec3(0.,uPlanetR,0.); vec2 ig=rsi(po,rd,uPlanetR); if(ig.x>0.&&ig.x<bc.x) bc=vec2(-1.); }
  bool hf=bf.x>=0.&&min(bf.y,tmax)>bf.x, hc=bc.x>=0.&&min(bc.y,tmax)>bc.x; if(!hf&&!hc) return vec4(0.,0.,0.,1.);   // rgb = in-scatter, a = transmittance
  float t0=1e9,t1=0.; if(hf){ t0=min(t0,bf.x); t1=max(t1,bf.y); } if(hc){ t0=min(t0,bc.x); t1=max(t1,bc.y); } t1=min(t1,tmax);
  float N=max(hf?uVFSteps:0.,hc?uLCSteps:0.); float dt=(t1-t0)/N; float t=t0+dt*hash13(vec3(gl_FragCoord.xy,fract(uTime*7.)));
  float cosS=clamp(dot(rd,uSunDir),-1.,1.);
  float gF=uVFG; float phF=(1.-gF*gF)/(4.*3.14159*pow(1.+gF*gF-2.*gF*cosS,1.5))*4.*3.14159;
  float phC=mix(clHG(cosS,uCLG1),clHG(cosS,-uCLG2),uCLMix)*4.*3.14159;
  float sunUpF=max(uSunDir.y+.05,0.), sunUpC=clamp(uSunDir.y*4.+.15,0.,1.); vec3 sunBase=trans*uSunColor*uSunIntensity*.02;
  vec3 ambF=(sky*.75+hzGlow*.15), ambC=sky*uCLAmb;
  vec3 hfSz=vfHalf(); float stF=max(hfSz.x,max(hfSz.y,hfSz.z))*.5; float stC=max(uLCSize.x,max(uLCSize.y,uLCSize.z))*.25; float st=(hf&&hc)?min(stF,stC):(hf?stF:stC);
  vec3 acc=vec3(0.); float T=1.;
  for(int i=0;i<64;i++){ if(float(i)>=N||T<.01) break; vec3 p=ro+rd*t;
    // sample only the volumes whose interval contains t
    float rf=(hf&&t>=bf.x&&t<=bf.y)?vfDensity(p):0.; float rc=(hc&&t>=bc.x&&t<=bc.y)?lcDensity(p,0.):0.;
    float sigF=rf*(1.+uVFAbsorb), sigC=rc*(1.+uCLAbsorb)*.06; float sigT=sigF+sigC;
    if(sigT>1e-5){ float sh=(uVFSelf>.5||rc>0.)?uniShadow(p,st):1.;
      vec3 S=vec3(0.);
      if(rf>0.){ vec3 Li=ambF+sunBase*sunUpF*phF*sh;
        { vec3 L=uPLPos-p; float d=length(L); L/=max(d,1e-3); float ph=(1.-gF*gF)/(4.*3.14159*pow(1.+gF*gF-2.*gF*dot(rd,L),1.5)); Li+=uPLOn*uPLCol*uPLInt/pow(max(d,1.),uPLDecay)*(1.-smoothstep(uPLReach*.7,uPLReach,d))*ph*4.*3.14159*.02; }
        { vec3 L=uSLPos-p; float d=length(L); L/=max(d,1e-3); float ct=dot(-L,uSLDir); float cone=smoothstep(uSLCos,mix(uSLCos,1.,uSLSoft*.9)+1e-4,ct); float ph=(1.-gF*gF)/(4.*3.14159*pow(1.+gF*gF-2.*gF*dot(rd,L),1.5)); Li+=uSLOn*uSLCol*(uSLInt/max(d*d,1.))*cone*ph*4.*3.14159*.02; }
        S+=Li*uVFAlbedo*rf; }
      if(rc>0.){ float hn=clamp((p.y-uLCPos.y)/max(1.,uLCSize.y)*.5+.5,0.,1.); float powder=1.-uCLPowder*exp(-rc*dt*2.*(1.+uCLAbsorb))*(1.-.5*clamp(cosS,0.,1.));
        float ms=sh+.55*pow(sh,.5)+.3*pow(sh,.25); vec3 Li=sunBase*sunUpC*phC*ms*powder+ambC*mix(.35,1.,hn); S+=Li*uCLAlbedo*rc*.06; }
      float Ts=exp(-sigT*dt); acc+=T*(S-S*Ts)/max(sigT,1e-6); T*=Ts; }
    t+=dt; }
  return vec4(acc,T); }
vec4 cloudLayer(vec3 dir,vec3 sky,vec3 trans){ // rgb premultiplied, a coverage — a thin slab at uCloudAlt above the camera
  if(uCloudOn<.5||dir.y<.015) return vec4(0.); float dz=uCloudAlt-uCamHeight; if(dz<=1.) return vec4(0.);
  float t=dz/dir.y; vec2 uv=(vec2(uCamPos.x,uCamPos.z)+dir.xz*t)*.0009*uCloudScale+vec2(uTime*.0025*uCloudSpeed,0.);
  float n=cnoise2(uv)*.55+cnoise2(uv*2.4+9.)*.3+cnoise2(uv*5.7-3.)*(.07+uCloudDetail*.08); n/=(.92+uCloudDetail*.08);
  float th=1.-uCloudCov*.78; float body=clamp((n-th)/max(1e-3,1.-th),0.,1.); if(body<=0.) return vec4(0.);
  float a=(.16+body*.72)*uCloudDen; a*=smoothstep(.015,.08,dir.y);
  float sunUp=clamp(uSunDir.y*3.+.2,0.,1.); vec3 lit=mix(uCloudShade,uCloudTint,body*.55+.2)*(trans*uSunColor*sunUp*.9+sky*.9)*uSkyBright*.6;
  float silver=pow(max(dot(dir,uSunDir),0.),24.)*.5; lit+=silver*trans*uSunColor*uSunIntensity*.02*(1.-body);
  return vec4(lit*a,a); }
// ===== Rainbow: primary bow at ~42° (red outside 42.3°, violet inside 40.6°), secondary at ~51° reversed, Alexander's dark band between.
//       Spectral ordering via wavelength -> deviation angle (Descartes minimum deviation, n(λ) from Cauchy water dispersion).
vec3 wl2rgb(float w){ // 380..700 nm -> linear-ish RGB
  vec3 c=vec3(0.); if(w<440.){ c=vec3(-(w-440.)/60.,0.,1.); } else if(w<490.){ c=vec3(0.,(w-440.)/50.,1.); } else if(w<510.){ c=vec3(0.,1.,-(w-510.)/20.); } else if(w<580.){ c=vec3((w-510.)/70.,1.,0.); } else if(w<645.){ c=vec3(1.,-(w-645.)/65.,0.); } else c=vec3(1.,0.,0.);
  float f=(w<420.)?.3+.7*(w-380.)/40.:(w>680.)?.3+.7*(700.-w)/20.:1.; return c*f; }
float bowAngle(float w,float order){ float n=1.3245+3000./(w*w); // Cauchy: n≈1.331 @700nm, 1.343 @400nm
  float k=order; float cosI=sqrt((n*n-1.)/(k*k+2.*k)); float i=acos(cosI); float r=asin(sin(i)/n); float dev=2.*i-2.*(k+1.)*r+k*3.14159265; // total deviation
  return (order<1.5)?(3.14159265-dev):(dev-3.14159265); }                                                                                   // angle from the antisolar point
vec3 rainbow(vec3 dir,float rainVis,float skyL){ if(uRBOn<.5) return vec3(0.);
  float sunUp=smoothstep(-2.,3.,degrees(asin(uSunDir.y))); if(sunUp<=0.) return vec3(0.);
  vec3 anti=-uSunDir; float ang=acos(clamp(dot(dir,anti),-1.,1.)); if(ang>1.0||ang<.6) return vec3(0.);    // 34°..57° window
  float w=uRBWidth; vec3 col=vec3(0.); float sum=0.;
  for(int i=0;i<14;i++){ float wl=380.+float(i)/13.*320.; vec3 c=wl2rgb(wl); float a1=bowAngle(wl,1.); float d1=(ang-a1)/(.0035*w); col+=c*exp(-d1*d1)*1.0; float a2=bowAngle(wl,2.); float d2=(ang-a2)/(.006*w); col+=c*exp(-d2*d2)*.42*uRBSecondary; sum+=1.; }
  col/=sum*.42;
  // Alexander's band: sky slightly darker between the bows, brighter inside the primary (light scattered forward from all drops)
  float inner=1.-smoothstep(bowAngle(560.,1.)-.02,bowAngle(560.,1.),ang); float alex=smoothstep(bowAngle(400.,1.),bowAngle(400.,1.)+.02,ang)*(1.-smoothstep(bowAngle(700.,2.)-.02,bowAngle(700.,2.),ang));
  vec3 skyGlow=vec3(.012)*inner*uRBInt; col=col*uRBInt+skyGlow; col*=(1.-alex*.18);
  // supernumeraries just inside the primary (interference), faint
  float sn=uRBSuper*exp(-pow((bowAngle(560.,1.)-ang)/.02,2.))*(.5+.5*cos((bowAngle(560.,1.)-ang)*900.))*(ang<bowAngle(560.,1.)?1.:0.); col+=vec3(.5,.6,1.)*sn*.25*uRBInt;
  // only where there is sunlit rain in front, low on the sky; fade toward the zenith like a real bow
  float belowH=smoothstep(.8,.3,dir.y); return col*sunUp*rainVis*belowH*max(skyL*2.2,.02)*1.6; }   // a real bow adds ~10–40% of the sky radiance behind it
vec3 lensFlare(vec2 uv,vec2 s,float vis){
  vec3 f=vec3(0.); vec2 m=uv-s; float type=uFlareType;
  float wGhost=(type==0.||type==2.)?1.:0.; float wHalo=(type==0.||type==3.)?1.:(type==2.?.5:0.);
  float wStreak=(type==1.)?2.2:(type==0.?1.:.35); float wBurst=(type==2.)?1.:(type==0.?.35:0.);
  for(int i=0;i<8;i++){ if(float(i)>=uGhosts) break; float fi=float(i);
    float k=-1.35+fi*.42; vec2 p=s*k; float r=.035+.07*fract(fi*.618+.31); float dd=length(uv-p);
    float g=smoothstep(r,r*.35,dd)*.9+smoothstep(r*1.6,r,dd)*.25; g*=(.06+.06*fract(fi*.37));
    f+=g*mix(vec3(1.),hue(fract(fi*.23+.5)),uChroma)*wGhost; }
  float hr=length(uv-s*.25); float ringd=abs(hr-uHalo); float halo=smoothstep(.045,0.,ringd)*.09;
  float ang=atan(uv.y-s.y*.25,uv.x-s.x*.25); f+=halo*mix(vec3(1.),hue(fract(ang/6.283+ringd*8.)),uChroma*.8)*wHalo;
  float streak=exp(-abs(m.y)*95.)*exp(-abs(m.x)*2.2)*.55; f+=streak*uStreak*mix(vec3(1.),vec3(.45,.65,1.),uChroma)*wStreak;
  float a=atan(m.y,m.x); float burst=pow(abs(sin(a*4.+.3)),24.)*exp(-length(m)*3.5)*.35+pow(abs(sin(a*7.)),40.)*exp(-length(m)*6.)*.25;
  f+=burst*vec3(1.,.95,.85)*wBurst; f+=exp(-length(m)*1.6)*.04*vec3(1.,.9,.8);
  return f*vis*uFlareInt;
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
vec3 uc2(vec3 x){ float A=.15,B=.5,C=.1,D=.2,E=.02,F=.3; return ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F; }
vec3 filmic(vec3 c){ return uc2(c*2.)/uc2(vec3(11.2)); }
vec3 agxish(vec3 c){ c=max(c,0.); vec3 x=log2(c+1e-5); x=clamp((x+12.47)/16.5,0.,1.); return x*x*(3.-2.*x); }

void main(){
  if(uProbe>.5){ // ---- probe pass: 3 hemisphere sky samples (zenith, sun-side horizon, anti-sun horizon) packed into a 4x1 target
    vec3 ro=vec3(0.,uPlanetR+uCamHeight,0.); int px=int(gl_FragCoord.x); vec3 hd=normalize(vec3(uSunDir.x,0.,uSunDir.z)+vec3(1e-4,0.,0.));
    vec3 d=(px==0)?vec3(0.,1.,0.):(px==1)?normalize(hd+vec3(0.,.08,0.)):normalize(-hd+vec3(0.,.08,0.));
    vec3 s,t; float g; atmosphere(ro,d,s,t,g); s*=uSkyTint*uSkyBright*uSkyVisible*uAtmoVisible;
    gl_FragColor=vec4(s,1.); return; }                        // linear HDR (float target); values are small (<~1e2)
  vec2 uv=(gl_FragCoord.xy*2.-uRes)/uRes.y;
  vec3 dir=normalize(uCamFwd+uCamRight*uv.x*uTanHalf+uCamUp*uv.y*uTanHalf);
  vec3 ro=vec3(0.,uPlanetR+uCamHeight,0.);
  vec3 sky,trans; float ground; atmosphere(ro,dir,sky,trans,ground);
  sky*=uSkyTint*uSkyBright*uSkyVisible*uAtmoVisible; if(uAtmoVisible<.5) trans=vec3(1.);
  float elevDeg=degrees(asin(clamp(uSunDir.y,-1.,1.))); float sunUp=smoothstep(-6.,4.,elevDeg);
  if(uWTurb>0.&&(uWLinkVF>.5||uWLinkLC>.5)) gSwirl=windSwirl(uCamPos+dir*30.,uTime);   // one evaluation per pixel (6 noise), only when turbulence is on
  vec3 skyAmb=uSkyAmb;   // hemispherical sky irradiance from the per-frame probe pass (identical atmosphere code, computed once instead of 3x per pixel)
  float skyLum=dot(sky,vec3(.2126,.7152,.0722)); float nightFade=clamp(1.-skyLum*14.,0.,1.);
  vec2 hxz=normalize(dir.xz+1e-5); vec2 sxz=normalize(uSunDir.xz+1e-5); float facing=.5+.5*dot(hxz,sxz);
  float hdrScale=uSunIntensity/22.*uSkyBright*uSkyVisible;
  // the analytic dawn band is a ground-observer model (horizon at dir.y=0). Above a few km the true horizon dips and the
  // ray-marched sphere already gives the correct limb glow, so fade the flat model out with altitude.
  float groundObs=1.-smoothstep(1500.,12000.,uCamHeight);
  vec3 glow=dawnGlow(dir,elevDeg,facing)*hdrScale*groundObs;                                    // this direction
  vec3 hzGlow=dawnGlow(normalize(vec3(dir.x,0.,dir.z)+1e-5),elevDeg,facing)*hdrScale*groundObs;  // at the horizon (for fog)
  float hzDip=-acos(clamp(uPlanetR/(uPlanetR+uCamHeight),0.,1.));                              // true horizon elevation (rad, negative)
  vec3 col=vec3(0.);
  // ---- checker plane (local flat world, intersect before atmosphere ground) ----
  float planeHit=0.; vec3 planeCol=vec3(0.); float planeT=1e9;
  { float tt; vec3 tn; if(uCamHeight<5000.&&terrHit(uCamPos,dir,tt,tn)){ vec3 hp=uCamPos+dir*tt; float hn=clamp((hp.y-uTerrPos.y)/max(.01,uTerrHeight),0.,1.);
      vec3 alb=mix(uTerrLow,uTerrHigh,hn); float ndl=max(dot(tn,uSunDir),0.); float sh=1.-uPresence.x*(1.-smoothstep(-1.,3.,elevDeg))*.35*ndl;
      vec3 spec=vec3(0.); { vec3 hv=normalize(uSunDir-dir); spec=trans*uSunColor*uSunIntensity*.02*pow(max(dot(tn,hv),0.),mix(64.,4.,uTerrRough))*(1.-uTerrRough); }
      vec3 amb=(sky*.42+hzGlow*.08)*(.5+.5*tn.y); planeCol=alb*(trans*uSunColor*uSunIntensity*.11*ndl*sh+amb)+spec;
      if(uTerrWire>.5){ vec2 q=(hp.xz-uTerrPos.xz)/uTerrSize*32.; vec2 gw=abs(fract(q-.5)-.5)/(fwidth(q)+1e-4); float ln=1.-min(min(gw.x,gw.y),1.); planeCol=mix(planeCol,vec3(.9),ln*.6); }
      float fog=1.-exp(-tt*7e-5); fog=pow(clamp(fog,0.,1.),1.6); planeCol=mix(planeCol,sky*.8+hzGlow*.6,fog); planeHit=1.; planeT=tt; } }
  if(uPlaneOn>.5 && dir.y<-1e-4 && uCamHeight<2000.){
    float t=(uPlaneY-uCamPos.y)/dir.y; vec3 hp=uCamPos+dir*t;
    if(t>0.&&t<planeT){
      planeHit=1.; planeT=t; float inChk=step(max(abs(hp.x),abs(hp.z)),uPlaneSize);
      // anti-aliased checker (filtered via fwidth)
      vec2 q=hp.xz/uPlaneCell; vec2 w=fwidth(q)*1.5+1e-4;
      vec2 i=2.*(abs(fract((q-.5*w)*.5)-.5)-abs(fract((q+.5*w)*.5)-.5))/w;
      float chk=.5-.5*i.x*i.y;
      vec3 alb=mix(uPlaneA,mix(uPlaneA,uPlaneB,chk),inChk);
      // grid lines every cell + bold every 10
      vec2 g1=abs(fract(q-.5)-.5)/(fwidth(q)+1e-4); float line=1.-min(min(g1.x,g1.y),1.);
      vec2 g10=abs(fract(q/10.-.5)-.5)/(fwidth(q/10.)+1e-4); float line10=1.-min(min(g10.x,g10.y),1.);
      alb=mix(alb,alb*.55,line*uPlaneGrid*.6*inChk); alb=mix(alb,vec3(.35,.4,.5),line10*uPlaneGrid*.8*inChk);
      // axis lines
      float ax=1.-min(abs(hp.z)/(fwidth(hp.z)*1.5+1e-4),1.); float az=1.-min(abs(hp.x)/(fwidth(hp.x)*1.5+1e-4),1.);
      alb=mix(alb,vec3(.95,.25,.3),ax*uPlaneGrid); alb=mix(alb,vec3(.25,.55,.95),az*uPlaneGrid);
      // lighting: sun + sky ambient, soft shadow-less lambert, distance fog into sky colour
      float ndl=max(uSunDir.y,0.); vec3 sunL=trans*uSunColor*uSunIntensity*.11*ndl; ndl=max(ndl,0.);
      // hemispherical ambient: mostly zenith sky, a little horizon glow, tiny floor so it never goes fully black
      vec3 amb=(sky*.42+hzGlow*.08+vec3(.0015,.002,.004)*uSkyBright)*mix(.55,1.,uPresence.y);   // GI off => flat, darker ambient
      amb+=uPresence.y*uPlaneA*.5*sunL*.35;                                                       // GI on => bounced sun light from the plane
      { float sh=1.-uPresence.x*(1.-smoothstep(-1.,3.,elevDeg))*.35*ndl; sunL*=sh; }                // shadows on => long low-sun self-shadowing of the surface micro-relief
      // moon light contribution
      for(int k=0;k<MAXM;k++){ if(k>=uMoonCount) break; amb+=uMoonTint[k]*uMoonP[k].y*max(uMoonDir[k].y,0.)*.0025*(.5+.5*cos(uMoonP[k].z*6.2832)); }
      planeCol=alb*(sunL+amb);
      { // local lights (photometric: cd / d^decay, soft reach window; spot = cone with penumbra)
        vec3 L=uPLPos-hp; float d=length(L); L/=max(d,1e-3); float fall=uPLInt/pow(max(d,1.),uPLDecay)*(1.-smoothstep(uPLReach*.7,uPLReach,d)); planeCol+=uPLOn*alb*uPLCol*fall*max(L.y,0.)*.02;
        vec3 L2=uSLPos-hp; float d2=length(L2); L2/=max(d2,1e-3); float ct=dot(-L2,uSLDir); float cone=smoothstep(uSLCos,mix(uSLCos,1.,uSLSoft*.9)+1e-4,ct); planeCol+=uSLOn*alb*uSLCol*(uSLInt/max(d2*d2,1.))*cone*max(L2.y,0.)*.02; }
      float fog=1.-exp(-t*7e-5); fog=pow(clamp(fog,0.,1.),1.6); planeCol=mix(planeCol,sky*.8+hzGlow*.6,fog);
    }
  }
  if(planeHit>.999){ col=applyMedia(planeCol,dir,planeT,skyAmb,hzGlow,trans); { vec4 lv=marchLocal(uCamPos,dir,planeT,skyAmb,hzGlow,trans); col=col*lv.a+lv.rgb; } }
  else if(ground>.5){
    float ndl=max(uSunDir.y,0.); vec3 sunL=trans*uSunColor*uSunIntensity*.09*ndl; vec3 amb=sky*.35+vec3(.002,.003,.006)*uSkyBright;
    { // the real surface: the same checker ground, wrapped on the planet sphere (no fake earth texture)
      vec2 tg=rsi(ro,dir,uPlanetR); vec3 hp=ro+dir*tg.x; vec3 n=normalize(hp); float nd=max(dot(n,uSunDir),0.);
      // geodesic local coords around the camera's nadir (east/north arc lengths in metres) -> consistent with the flat plane near the ground
      vec3 E=vec3(1.,0.,0.), Nn=vec3(0.,0.,-1.);
      float east=uPlanetR*atan(dot(n,E),n.y)+uCamPos.x, north=uPlanetR*atan(dot(n,Nn),n.y)-uCamPos.z;
      vec2 q=vec2(east,north)/uPlaneCell; vec2 w=fwidth(q)*1.5+1e-4;
      vec2 i2=2.*(abs(fract((q-.5*w)*.5)-.5)-abs(fract((q+.5*w)*.5)-.5))/w; float chk=.5-.5*i2.x*i2.y;
      float inChk=uPlaneOn>.5?step(max(abs(east),abs(north)),uPlaneSize):0.;
      vec3 alb=mix(uGroundColor,mix(uPlaneA,uPlaneB,chk),inChk);
      // coarse 1 km graticule so scale reads from orbit
      vec2 gk=abs(fract(vec2(east,north)/1000.-.5)-.5)/(fwidth(vec2(east,north)/1000.)+1e-4); float km=1.-min(min(gk.x,gk.y),1.);
      alb=mix(alb,alb*.6,km*uPlaneGrid*.5*smoothstep(3000.,20000.,uCamHeight));
      vec3 sunP=trans*uSunColor*uSunIntensity*.09*nd;
      col=alb*uGroundBright*(sunP+amb)+sky; }
    col=mix(col,planeCol,planeHit);
  }else{
    col=sky+glow;
    float ext=smoothstep(hzDip-.01,hzDip+.12*groundObs+.002,dir.y); // horizon extinction, follows the true (dipped) horizon
    if(uStarsOn>.5 && uStarCeil > max(skyLum,1e-7)*uStarLimit*.6){   // atmosphere-gated: skip the whole star pass when even the brightest star cannot beat this pixel's sky (thin/absent atmosphere or altitude => stars in daylight)
      float am=airMassOf(degrees(asin(clamp(dir.y,-1.,1.))));
      float pixAng=2.*uTanHalf/uRes.y; vec3 st;
      float aaNeed=step(max(skyLum,1e-7)*uStarLimit*8.,uStarCeil);   // supersample only when the sky is dark enough for faint stars to matter
      if(uStarAA>1.5&&aaNeed>.5){ // 2x2 supersample (rotated grid) => sub-pixel stars resolve cleanly without blur
        vec3 s0=vec3(0.); for(int q=0;q<4;q++){ vec2 o=(q==0)?vec2(-.375,-.125):(q==1)?vec2(.125,-.375):(q==2)?vec2(.375,.125):vec2(-.125,.375);
          vec3 d2=normalize(dir+(uCamRight*o.x+uCamUp*o.y)*pixAng); s0+=starField(d2,pixAng*.7,am); } st=s0*.25*trans; }
      else st=starField(dir,pixAng,am)*trans;                 // atmospheric extinction: stars redden and dim near the horizon
      // contrast-limited visibility: a star is seen only if its radiance beats the sky radiance around it (Weber/Blackwell-ish)
      float skyL=max(skyLum,1e-7); float thresh=skyL*uStarLimit;
      float l=dot(st,vec3(.2126,.7152,.0722));
      float vis=smoothstep(thresh*.6,thresh*2.5,l+1e-9);
      // thin / dim atmosphere => sky darker => more stars in daytime automatically
      col+=st*vis*ext;
    }
    col+=moons(dir,trans);
    { vec4 cl=cloudLayer(dir,sky,trans); col=col*(1.-cl.a)+cl.rgb; }
    { vec4 cm=cloudMarch(uCamPos,dir,skyAmb,trans,1e6); col=col*(1.-cm.a)+cm.rgb; }
    { vec4 lv=marchLocal(uCamPos,dir,1e6,skyAmb,hzGlow,trans); col=col*lv.a+lv.rgb; }
    if(uSunVisible>.5){
      float ang=acos(clamp(dot(dir,uSunDir),-1.,1.)); float disc=1.-smoothstep(uSunAng*(1.-uSunSoft*.9),uSunAng,ang);
      float soft=mix(1.,2.2,1.-smoothstep(0.,4.,elevDeg)); disc=1.-smoothstep(uSunAng*(1.-uSunSoft*.9*soft),uSunAng,ang);
      float limb=mix(1.,.55,smoothstep(0.,uSunAng,ang));
      vec3 ext=exp(-(vec3(5.8e-6,13.5e-6,33.1e-6)*uRayleigh*uHr+vec3(21e-6)*1.1*uMie*uHm)*airMassOf(elevDeg));
      vec3 sunCol=uSunColor*max(ext,trans*trans);                                           // deep orange at the horizon, white overhead
      col+=disc*limb*sunCol*uSunIntensity*uSunDiscBoost*mix(.35,1.,smoothstep(-1.,8.,elevDeg));
      float sg=exp(-ang*40.)*.35+exp(-ang*9.)*.03+exp(-ang*2.5)*.004; col+=sg*uBloom*sunCol*uSunIntensity*.6;
    }
    { float hRef=max(uFogHeight*4.,uAFHeight*5.); float dS=(dir.y>.002)?min(60000.,hRef/dir.y):60000.; col=applyMedia(col,dir,dS,skyAmb,hzGlow,trans); }   // sky rays: one shared path length through both media

  }
  { // light source glyphs: a small emissive glow where the point / spot lights sit
    vec3 v=uPLPos-uCamPos; float dl=length(v); float c=dot(normalize(v),dir); float ang=acos(clamp(c,-1.,1.)); float rr=.02/max(1.,dl*.05)*(1.+uPLInt*.02);
    float bl=exp(-ang*ang/(rr*rr*.25))*.9+exp(-ang/rr*.6)*.05; float occl=(planeHit>.5&&planeT<dl)?0.:1.; col+=uPLOn*occl*uPLCol*bl*uPLInt*.02;
    vec3 v2=uSLPos-uCamPos; float dl2=length(v2); float c2=dot(normalize(v2),dir); float ang2=acos(clamp(c2,-1.,1.)); float rr2=.02/max(1.,dl2*.05)*(1.+uSLInt*.005);
    float bl2=exp(-ang2*ang2/(rr2*rr2*.25))*.9+exp(-ang2/rr2*.6)*.05; float occl2=(planeHit>.5&&planeT<dl2)?0.:1.; col+=uSLOn*occl2*uSLCol*bl2*uSLInt*.008; }
  { float rv=uRBRain; float hzL=dot(skyAmb,vec3(.2126,.7152,.0722)); float skyMask=(planeHit>.5)?smoothstep(1500.,6000.,planeT)*.35:(ground>.5?0.:1.); skyMask*=smoothstep(-.005,.02,dir.y); col+=rainbow(dir,rv,hzL)*uSunColor*trans*skyMask; }   // the bow lives in the rain column against the sky; the ground occludes it
  if(uFlareOn>.5 && uSunVisible>.5){
    float inFrame=1.-smoothstep(1.25,2.2,length(uSunUV*vec2(uRes.y/uRes.x,1.)));
    float vis=uSunInFront*sunUp*inFrame*step(0.,elevDeg+.5); col+=lensFlare(uv,uSunUV,vis)*uSunIntensity*.09*uSunColor; }
  float autoEV=-.35*smoothstep(-8.,-1.,elevDeg)-1.0*smoothstep(-1.,6.,elevDeg)-.6*smoothstep(6.,30.,elevDeg);   // tame the blow-out after sunrise
  col*=exp2(uEV+autoEV);
  if(uTonemap==1.) col=aces(col); else if(uTonemap==2.) col=col/(1.+col); else if(uTonemap==3.) col=filmic(col); else if(uTonemap==4.) col=agxish(col); else col=clamp(col,0.,1.);
  float vig=1.-uVignette*pow(length(uv*vec2(uRes.y/uRes.x,1.)*.9),2.2); col*=clamp(vig,0.,1.);
  col=pow(max(col,0.),vec3(1./2.2)); col+=(hash13(vec3(gl_FragCoord.xy,fract(uTime)*100.))-.5)*uGrain*.12;
  gl_FragColor=vec4(col,1.);
}
