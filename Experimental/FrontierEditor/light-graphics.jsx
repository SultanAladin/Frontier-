import React, {useId, useRef} from 'react';

// Luminous-intensity distribution drawn in the plane containing the emitter axis.
// Point radiates uniformly; a spot holds full intensity across the inner cone and
// falls to darkness at the outer cone; surface emitters follow a Lambertian cosine
// lobe about their normal. The axis points down, matching the beam diagram below it.
export function PhotometricPolar({type,inner=32,outer=58}) {
 const id=useId().replace(/:/g,''),cx=150,cy=102,radius=90;
 const surface=['area-light','tube-light','strip-light'].includes(type);
 const intensity=angle=>{
  const degrees=Math.abs(angle*180/Math.PI);
  if(type==='point-light')return 1;
  if(surface)return Math.max(0,Math.cos(angle));
  const half=outer/2,core=Math.min(inner,outer)/2;
  if(degrees<=core)return 1;
  if(degrees>=half)return 0;
  return .5+.5*Math.cos((degrees-core)/Math.max(.001,half-core)*Math.PI);
 };
 const lobe=Array.from({length:181},(_,i)=>{
  const angle=(-180+i*2)*Math.PI/180,r=radius*intensity(angle);
  return `${i?'L':'M'}${(cx+r*Math.sin(angle)).toFixed(2)},${(cy+r*Math.cos(angle)).toFixed(2)}`;
 }).join(' ')+'Z';
 return <svg className="photometric-polar" viewBox="0 0 300 220" role="img"
  aria-label={`Luminous intensity distribution for a ${type.replace('-',' ')}`}>
 <defs><radialGradient id={id} cx=".5" cy=".34"><stop stopColor="#e9c67b" stopOpacity=".26"/><stop offset="1" stopColor="#e9c67b" stopOpacity=".02"/></radialGradient></defs>
 {[.25,.5,.75,1].map(step=><circle key={step} cx={cx} cy={cy} r={radius*step} fill="none" stroke="#ffffff0c" strokeDasharray="2 5"/>)}
 {[0,30,60,90,120,150].map(angle=><path key={angle} d={`M${cx-radius*Math.cos(angle*Math.PI/180)} ${cy-radius*Math.sin(angle*Math.PI/180)} L${cx+radius*Math.cos(angle*Math.PI/180)} ${cy+radius*Math.sin(angle*Math.PI/180)}`} stroke="#ffffff08"/>)}
 <path d={lobe} fill={`url(#${id})`} stroke="#e0bb79" strokeWidth="1.5" strokeLinejoin="round"/>
 <path d={`M${cx} ${cy} V${cy+radius+6}`} stroke="#8a8372" strokeDasharray="3 4" strokeWidth=".8"/>
 <circle cx={cx} cy={cy} r="3.6" fill="#f2e3c0"/>
 <g fill="#7d7d7d" fontSize="9" textAnchor="middle"><text x={cx} y={cy+radius+20}>0°</text><text x={cx+radius+14} y={cy+4}>90°</text><text x={cx-radius-14} y={cy+4}>90°</text></g>
 </svg>;
}

// Side elevation of the emitted cone against a floor plane. The inner cone is the
// fully lit core, the outer cone the edge of any light at all, and the ellipse is
// the pool the cone cuts on the floor at the stated reach.
export function BeamCone({inner,outer,reach,onChange}) {
 const id=useId().replace(/:/g,''),drag=useRef(null),apexX=150,apexY=28,floorY=168;
 const span=floorY-apexY,spread=half=>span*Math.tan(Math.min(84,half)*Math.PI/180);
 const outerSpread=Math.min(136,spread(outer/2)),innerSpread=Math.min(outerSpread,spread(inner/2));
 const move=event=>{
  if(!drag.current||!onChange)return;
  const start=drag.current,delta=(event.clientX-start.x)*.45;
  onChange(Math.round(Math.max(2,Math.min(170,start.outer+delta))));
 };
 return <div className="gizmo beam-cone-gizmo" title="Drag horizontally to widen or narrow the outer cone. Sliders offer precise control."
  onPointerDown={event=>{if(!onChange)return;event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,outer}}}
  onPointerMove={move} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null}>
 <svg viewBox="0 0 300 196" role="img" aria-label={`Beam cone: inner ${inner} degrees, outer ${outer} degrees, reach ${reach} metres`}>
 <defs><linearGradient id={id} x2="0" y2="1"><stop stopColor="#edc87d" stopOpacity=".3"/><stop offset="1" stopColor="#edc87d" stopOpacity=".03"/></linearGradient></defs>
 <path d={`M${apexX} ${apexY} L${apexX-outerSpread} ${floorY} L${apexX+outerSpread} ${floorY}Z`} fill={`url(#${id})`}/>
 <path d={`M${apexX} ${apexY} L${apexX-innerSpread} ${floorY} L${apexX+innerSpread} ${floorY}Z`} fill="#f0cd84" fillOpacity=".16"/>
 <path d={`M${apexX-outerSpread} ${floorY} L${apexX} ${apexY} L${apexX+outerSpread} ${floorY}`} fill="none" stroke="#dcb978" strokeWidth="1.5" strokeLinejoin="round"/>
 <path d={`M${apexX-innerSpread} ${floorY} L${apexX} ${apexY} L${apexX+innerSpread} ${floorY}`} fill="none" stroke="#f3d79a" strokeWidth=".9" strokeDasharray="4 3" strokeOpacity=".75"/>
 <ellipse cx={apexX} cy={floorY} rx={outerSpread} ry={Math.max(4,outerSpread*.17)} fill="#e9c67b" fillOpacity=".11" stroke="#c8a96e" strokeOpacity=".5" strokeWidth=".9"/>
 <path d={`M24 ${floorY} H276`} stroke="#5c5c5c" strokeWidth="1"/>
 {Array.from({length:13},(_,i)=><path key={i} d={`M${26+i*20} ${floorY} l-6 7`} stroke="#3c3c3c" strokeWidth="1"/>)}
 <path d={`M${apexX} ${apexY} V${floorY}`} stroke="#8a8372" strokeDasharray="3 4" strokeWidth=".8"/>
 <rect x={apexX-13} y={apexY-11} width="26" height="11" rx="3" fill="#2b2b2b" stroke="#5a5a5a"/>
 <circle cx={apexX} cy={apexY} r="4" fill="#f6e6bd"/>
 <g fill="#8a8a8a" fontSize="9"><text x="26" y={floorY+20}>floor plane</text><text x="276" y={floorY+20} textAnchor="end">{reach} m reach</text></g>
 </svg></div>;
}

// Inverse-square attenuation along the beam axis, with the authored reach marked.
// Illuminance is normalised to the value one metre from the emitter.
export function FalloffCurve({reach}) {
 const id=useId().replace(/:/g,''),left=18,right=282,top=18,base=104;
 const far=Math.max(1,reach),attenuation=distance=>1/Math.max(1,distance*distance);
 const plot=Array.from({length:121},(_,i)=>{
  const distance=.6+far*i/120,x=left+(right-left)*i/120;
  return `${i?'L':'M'}${x.toFixed(2)},${(base-(base-top)*attenuation(distance)).toFixed(2)}`;
 }).join(' ');
 const halfDistance=Math.SQRT2,marked=halfDistance<=far,markedX=left+(right-left)*((halfDistance-.6)/far);
 return <svg className="falloff-curve" viewBox="0 0 300 126" role="img" aria-label={`Inverse-square falloff across ${reach} metres`}>
 <defs><linearGradient id={id} x2="0" y2="1"><stop stopColor="#9fb7d4" stopOpacity=".2"/><stop offset="1" stopColor="#9fb7d4" stopOpacity="0"/></linearGradient></defs>
 {[top,42,66,base].map(y=><path key={y} d={`M${left} ${y} H${right}`} stroke="#ffffff0b" strokeDasharray="2 5"/>)}
 <path d={`${plot} L${right} ${base} H${left}Z`} fill={`url(#${id})`}/>
 <path d={plot} fill="none" stroke="#a6bedb" strokeWidth="1.6" strokeLinecap="round"/>
 {marked&&<><path d={`M${markedX} ${top} V${base}`} stroke="#c7b183" strokeOpacity=".45" strokeDasharray="2 4"/><text x={markedX+5} y={30} fill="#9a9a9a" fontSize="9">50 % at 1.41 m</text></>}
 <g fill="#7d7d7d" fontSize="9"><text x={left} y={120}>0 m</text><text x={right} y={120} textAnchor="end">{reach} m</text></g>
 </svg>;
}

// Dimensioned schematic of the emitting surface. Only the figure for the selected
// emitter is drawn; the annotations restate the authored metres rather than guessing.
export function EmitterFigure({type,width,height,length,radius}) {
 const common={viewBox:'0 0 300 150',role:'img',className:'emitter-figure'};
 const label=(x,y,text)=><text x={x} y={y} fill="#8d8d8d" fontSize="9" textAnchor="middle">{text}</text>;
 if(type==='area-light'){
  const ratio=Math.max(.25,Math.min(4,(width||1)/(height||1))),panelWidth=Math.min(188,86*ratio+60),panelHeight=panelWidth/ratio;
  const x=150-panelWidth/2,y=72-Math.min(54,panelHeight)/2,drawnHeight=Math.min(54,panelHeight);
  return <svg {...common} aria-label={`Rectangular emitter ${width} by ${height} metres`}>
  <path d={`M${x} ${y} h${panelWidth} l22 14 h-${panelWidth} Z`} fill="#e9c67b" fillOpacity=".17" stroke="#d3b276" strokeWidth="1.2"/>
  <path d={`M${x} ${y} v${drawnHeight} l22 14 V${y+14}`} fill="#ffffff07" stroke="#9c9183" strokeWidth=".9"/>
  <path d={`M${x} ${y+drawnHeight} h${panelWidth} l22 14`} fill="none" stroke="#9c9183" strokeWidth=".9"/>
  <path d={`M${x+panelWidth} ${y} v${drawnHeight}`} stroke="#9c9183" strokeWidth=".9"/>
  <path d={`M${x} ${y+drawnHeight+26} H${x+panelWidth}`} stroke="#6f6f6f" strokeWidth=".8" markerStart="" markerEnd=""/>
  {label(150,y+drawnHeight+40,`${width} m wide`)}
  {label(x-26,y+drawnHeight/2,`${height} m`)}
  </svg>;
 }
 if(type==='tube-light'){
  const drawn=Math.min(196,60+(length||1)*26),capRadius=Math.max(7,Math.min(26,(radius||.05)*120));
  return <svg {...common} aria-label={`Tubular emitter ${length} metres long, ${radius} metre radius`}>
  <path d={`M${150-drawn/2} ${72-capRadius} h${drawn} a${capRadius} ${capRadius} 0 0 1 0 ${capRadius*2} h-${drawn} a${capRadius} ${capRadius} 0 0 1 0 -${capRadius*2}Z`} fill="#e9c67b" fillOpacity=".17" stroke="#d3b276" strokeWidth="1.2"/>
  <ellipse cx={150-drawn/2} cy="72" rx={capRadius*.42} ry={capRadius} fill="#1d1d1d" stroke="#9c9183" strokeWidth=".9"/>
  <path d={`M${150-drawn/2} ${72+capRadius+22} H${150+drawn/2}`} stroke="#6f6f6f" strokeWidth=".8"/>
  {label(150,72+capRadius+36,`${length} m long`)}
  {label(150+drawn/2+30,76,`r ${radius} m`)}
  </svg>;
 }
 const drawn=Math.min(214,52+(length||1)*17),emitters=Math.max(4,Math.min(26,Math.round((length||1)*4)));
 return <svg {...common} viewBox="0 46 300 86" aria-label={`Strip emitter ${length} metres long`}>
 <rect x={150-drawn/2} y="62" width={drawn} height="20" rx="5" fill="#242424" stroke="#5f5f5f" strokeWidth="1"/>
 <rect x={150-drawn/2+3} y="65" width={drawn-6} height="14" rx="3" fill="#e9c67b" fillOpacity=".14"/>
 {Array.from({length:emitters},(_,i)=><rect key={i} x={150-drawn/2+7+i*((drawn-14)/emitters)} y="68" width={Math.max(3,(drawn-14)/emitters-4)} height="8" rx="1.6" fill="#f0d79c" fillOpacity=".8"/>)}
 <path d={`M${150-drawn/2} 104 H${150+drawn/2}`} stroke="#6f6f6f" strokeWidth=".8"/>
 {label(150,118,`${length} m · ${emitters} drawn segments`)}
 </svg>;
}
