import React from 'react';
import {Lightbulb,Flashlight,RectangleHorizontal,Minus,Cone,Thermometer,Ruler,Move3d,Contrast,Gauge,Layers,Projector,CircleDot} from 'lucide-react';
import {PhotometricPolar,BeamCone,FalloffCurve,EmitterFigure} from './light-graphics.jsx';

// The five punctual and surface emitters the engine keeps as scene records. The Sun
// stays the scene's single directional source and is authored by its own inspector.
export const lightObjects=[
 {id:'point-light',name:'Point Light',type:'Omnidirectional emitter',group:'Lighting',icon:Lightbulb,color:'#e9c67b'},
 {id:'spot-light',name:'Spot Light',type:'Cone emitter',group:'Lighting',icon:Flashlight,color:'#e8bb86'},
 {id:'area-light',name:'Area Light',type:'Rectangular emitter',group:'Lighting',icon:RectangleHorizontal,color:'#dfc08f'},
 {id:'tube-light',name:'Tube Light',type:'Tubular emitter',group:'Lighting',icon:Minus,color:'#d9c49b'},
 {id:'strip-light',name:'LED Strip',type:'Linear emitter',group:'Lighting',icon:Layers,color:'#e2cf9a'},
];
export const lightKinds=lightObjects.map(entry=>entry.id);

export const lightDefaults={
 lumens:1500,colourTemperature:3000,lightReach:12,
 innerCone:30,outerCone:55,
 emitterWidth:1.2,emitterHeight:.6,emitterLength:1.5,emitterRadius:.04,
 lumensPerMetre:900,
 lightX:0,lightY:3,lightZ:0,aimAzimuth:180,aimElevation:-55,
 shadowSoftness:28,diffuseResponse:100,specularResponse:100,
 distribution:'Uniform',
};
export const lightSwitches={
 'point-light':[['Luminous output','Emission',Lightbulb],['Shadows','Shadows',Contrast],['Specular response','Specular',Gauge]],
 'spot-light':[['Luminous output','Emission',Flashlight],['Beam shape','Beam',Cone],['Shadows','Shadows',Contrast],['Specular response','Specular',Gauge]],
 'area-light':[['Luminous output','Emission',RectangleHorizontal],['Shadows','Shadows',Contrast]],
 'tube-light':[['Luminous output','Emission',Minus],['Shadows','Shadows',Contrast]],
 'strip-light':[['Luminous output','Emission',Layers],['Shadows','Shadows',Contrast]],
};
export const lightDescriptions={
 'point-light':'Lighting / Punctual · output, reach & response',
 'spot-light':'Lighting / Punctual · output, cone & response',
 'area-light':'Lighting / Surface · output, panel & response',
 'tube-light':'Lighting / Surface · output, tube & response',
 'strip-light':'Lighting / Linear · output per metre, run & response',
};
export const lightCardColors={
 'Luminous output':'#e9c67b','Colour temperature':'#e69c79','Beam shape':'#f0bd72',
 'Emitter dimensions':'#dfc08f','Reach & falloff':'#9fb7d4','Placement':'#b5c4df',
 'Shadows & response':'#c0a8d4','Luminous distribution':'#d4b970','Renderer support':'#8e8e8e',
};

const surfaceKinds=['area-light','tube-light','strip-light'];
const temperatureChip=kelvin=>kelvin<3000?'#f0cfa0':kelvin<4500?'#efd9b4':kelvin>6500?'#c4d8f3':'#efe9dc';
const temperatureName=kelvin=>kelvin<2700?'Candle warmth':kelvin<3500?'Warm white':kelvin<5000?'Neutral white':kelvin<6500?'Cool white':'Daylight';

export default function LightInspector({kind,card,v,set,slider,num,featureOn,active}) {
 if(!lightKinds.includes(kind))return null;
 const range=(low,high)=><div className="range-labels"><span>{low}</span><span>{high}</span></div>;
 const strip=kind==='strip-light',spot=kind==='spot-light',surface=surfaceKinds.includes(kind);
 const number=(key,label,unit,minimum,step='any')=><label key={key}><span>{label}</span><div><input aria-label={label} type="number" step={step} min={minimum} value={v(key)} onChange={event=>{const entered=event.target.valueAsNumber;if(Number.isFinite(entered))set(key,minimum===undefined?entered:Math.max(minimum,entered))}}/><small>{unit}</small></div></label>;

 // Photometry. Flux is authored; intensity and illuminance are derived from it so the
 // readouts stay consistent with the slider instead of being independent decoration.
 const length=v('emitterLength'),flux=strip?v('lumensPerMetre')*length:v('lumens');
 const outer=Math.max(v('innerCone'),v('outerCone'));
 const solidAngle=spot?2*Math.PI*(1-Math.cos(outer/2*Math.PI/180)):4*Math.PI;
 const candela=surface?flux/Math.PI:flux/Math.max(.0001,solidAngle);
 const reach=v('lightReach'),illuminance=candela/Math.max(.0001,reach*reach);
 const poolDiameter=2*reach*Math.tan(Math.min(84,outer/2)*Math.PI/180);
 const emitterArea=kind==='area-light'?v('emitterWidth')*v('emitterHeight'):kind==='tube-light'?2*Math.PI*v('emitterRadius')*length:0;

 return <>
 {card('Luminous output',strip?Layers:spot?Flashlight:Lightbulb,<>
  <div className="scattering-top">
   <div className="metric">{Math.round(flux).toLocaleString('en-US')}<small>lm</small></div>
   <span className="small-pill">{Math.round(candela).toLocaleString('en-US')} cd</span>
  </div>
  <p className="muted">{strip?'Total flux is the authored output per metre across the run.':surface?'Flux emitted from the panel into the forward hemisphere.':spot?'Flux concentrated into the outer cone.':'Flux radiated uniformly in every direction.'}</p>
  <PhotometricPolar type={kind} inner={v('innerCone')} outer={outer}/>
  {strip?<>{slider('lumensPerMetre',100,3000,10)}{range('100 lm/m','3,000 lm/m')}</>:<>{slider('lumens',0,20000,50)}{range('0 lm','20,000 lm')}</>}
  <div className="light-derived">
   <div><span>Intensity</span><strong>{Math.round(candela).toLocaleString('en-US')}<small> cd</small></strong></div>
   <div><span>At {reach} m</span><strong>{illuminance<10?illuminance.toFixed(2):Math.round(illuminance).toLocaleString('en-US')}<small> lx</small></strong></div>
   {emitterArea>0&&<div><span>Luminance</span><strong>{Math.round(flux/(Math.PI*Math.max(.0001,emitterArea))).toLocaleString('en-US')}<small> nit</small></strong></div>}
  </div>
 </>,'wide-card light-output-card')}

 {card('Colour temperature',Thermometer,<>
  <div className="metric">{num('colourTemperature','K')}</div>
  <div className="temperature-track">{slider('colourTemperature',1800,10000,50)}</div>
  {range('Warm','Cool')}
  <div className="temperature-footer"><span className="color-chip" style={{background:temperatureChip(v('colourTemperature'))}}/><span>{temperatureName(v('colourTemperature'))}</span></div>
 </>,'temperature-card')}

 {card('Reach & falloff',Gauge,<>
  <div className="scattering-top"><div className="metric">{num('lightReach','m',1)}</div><span className="small-pill">Inverse square</span></div>
  <p className="muted">Distance at which the emitter stops being evaluated</p>
  <FalloffCurve reach={reach}/>
  {slider('lightReach',1,80,.5)}
  {range('1 m','80 m')}
 </>,'falloff-card')}

 {spot&&card('Beam shape',Cone,<>
  <div className="scattering-top">
   <div className="metric">{num('outerCone','°')}</div>
   <span className="small-pill">{v('innerCone')}° hot core</span>
  </div>
  <BeamCone inner={v('innerCone')} outer={outer} reach={reach} onChange={value=>{set('outerCone',value);if(v('innerCone')>value)set('innerCone',value)}}/>
  <div className="light-cone-controls">
   <label><span>Inner cone <strong>{v('innerCone')}°</strong></span><input aria-label="Inner cone" type="range" min="1" max={outer} step="1" value={Math.min(v('innerCone'),outer)} onChange={event=>set('innerCone',+event.target.value)} style={{'--progress':`${Math.min(v('innerCone'),outer)/Math.max(1,outer)*100}%`}}/><em>Fully lit core</em></label>
   <label><span>Outer cone <strong>{outer}°</strong></span><input aria-label="Outer cone" type="range" min="2" max="170" step="1" value={outer} onChange={event=>{const value=+event.target.value;set('outerCone',value);if(v('innerCone')>value)set('innerCone',value)}} style={{'--progress':`${(outer-2)/168*100}%`}}/><em>Edge of any light</em></label>
  </div>
  <div className="water-detail">Pool at {reach} m <strong>{poolDiameter.toFixed(1)} m across</strong></div>
 </>,'wide-card beam-card')}

 {surface&&card('Emitter dimensions',Ruler,<>
  <EmitterFigure type={kind} width={v('emitterWidth')} height={v('emitterHeight')} length={length} radius={v('emitterRadius')}/>
  <div className="volume-subheading">DIMENSIONS <span>Metres · emitting surface</span></div>
  <div className="volume-fields">
   {kind==='area-light'&&<>{number('emitterWidth','Width','m',.01)}{number('emitterHeight','Height','m',.01)}</>}
   {kind==='tube-light'&&<>{number('emitterLength','Length','m',.01)}{number('emitterRadius','Radius','m',.005,'.005')}</>}
   {strip&&<>{number('emitterLength','Run length','m',.01)}{number('lumensPerMetre','Output','lm/m',10,'10')}</>}
  </div>
  <p className="muted">{strip?'Total flux is the output per metre multiplied by the run length.':`Emitting area ${emitterArea.toFixed(3)} m².`}</p>
 </>,'wide-card emitter-card')}

 {card('Placement',Move3d,<>
  <div className="volume-subheading">POSITION <span>World-space centre · metres</span></div>
  <div className="volume-fields">{number('lightX','Centre X','m')}{number('lightY','Centre Y','m')}{number('lightZ','Centre Z','m')}</div>
  {spot&&<>
   <div className="volume-subheading">AIM <span>Beam axis · degrees</span></div>
   <div className="light-cone-controls">
    <label><span>Azimuth <strong>{v('aimAzimuth')}°</strong></span>{slider('aimAzimuth',0,360)}<em>Clockwise from north</em></label>
    <label><span>Elevation <strong>{v('aimElevation')>0?'+':''}{v('aimElevation')}°</strong></span>{slider('aimElevation',-90,90)}<em>Negative aims at the floor</em></label>
   </div>
  </>}
 </>,'wide-card placement-card')}

 {card('Shadows & response',Contrast,<>
  <div className="scattering-top"><div className="metric">{num('shadowSoftness','%')}</div><span className="small-pill">Penumbra width</span></div>
  <p className="muted">Softness of the shadow edge cast by this emitter</p>
  {slider('shadowSoftness',0,100)}
  {range('Hard edge','Soft gradient')}
  <div className="light-cone-controls">
   <label><span>Diffuse <strong>{v('diffuseResponse')}%</strong></span>{slider('diffuseResponse',0,200)}<em>Matte surface contribution</em></label>
   <label><span>Specular <strong>{v('specularResponse')}%</strong></span>{slider('specularResponse',0,200)}<em>Highlight contribution</em></label>
  </div>
 </>,'wide-card response-card')}

 {!surface&&card('Luminous distribution',Projector,<>
  <p className="muted">How intensity is shaped across the emitted solid angle</p>
  <label className="volume-shape-label"><span>Distribution</span>
   <select aria-label="Luminous distribution" value={v('distribution')} onChange={event=>set('distribution',event.target.value)}>
    {['Uniform','IES profile','Automotive low beam'].map(entry=><option key={entry} value={entry}>{entry}</option>)}
   </select>
  </label>
  <div className="water-detail">{v('distribution')==='Uniform'?'Even intensity across the cone.':v('distribution')==='IES profile'?'Measured photometric web — requires an imported IES file.':'Asymmetric cut-off shaped for road lighting.'}</div>
  {v('distribution')!=='Uniform'&&<p className="muted">No measured profile is loaded in the browser prototype; the polar plot above continues to show the authored cone.</p>}
 </>,'distribution-card')}

 {card('Renderer support',CircleDot,<>
  <div className="light-support">
   <div className="light-support-row"><span className="status-chip is-on"/><span>Scene record · position, output, colour and reach persist</span></div>
   <div className="light-support-row"><span className={`status-chip ${surface?'is-off':'is-on'}`}/><span>{surface?'Extended emitter — not consumed by the raster lighting kernel':'Punctual source — consumed by the lighting kernel'}</span></div>
   <div className="light-support-row"><span className="status-chip is-off"/><span>No lightmap bake path exists; baked contribution is unavailable</span></div>
  </div>
  <p className="muted">Reported from the authored record. Unsupported states are labelled rather than drawn as if they worked.</p>
 </>,`${surface?'wide-card ':''}support-card`)}
 </>;
}
