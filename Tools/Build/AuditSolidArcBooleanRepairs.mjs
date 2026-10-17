// Analytic intended-geometry audit for repaired cone and periodic torus cases.
// Does not use returned source meshes as ground truth or native Encloses().
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {mesh,inside} from './GeometryMeshAudit.mjs';
import {field,combined,shapeBounds,simpleVolume} from './GeometryReferenceOracle.mjs';
const root='_AgentScratch/tmp/GeometryRepairs/Broad',data=JSON.parse(await readFile(`${root}/results.json`,'utf8'));
const shapes={
 'cone-box':[{type:'cone',foot:[0,0,-1],r0:1.2,r1:.45,height:2.2},{type:'box',low:[0,-.8,-.6],high:[1.5,.9,1.6]}],
 'torus-box':[{type:'torus',center:[0,0,0],axis:[0,0,1],major:1.2,minor:.4},{type:'box',low:[0,-1.6,-.7],high:[1.8,1.6,.7]}]
};
assert.equal(field(shapes['torus-box'][0],[1.2,0,0]),.4);assert.ok(field(shapes['torus-box'][0],[0,0,0])<0);assert.equal(simpleVolume(shapes['torus-box'][0]),2*Math.PI**2*1.2*.4**2);
// Independent numerical integration of analytic disk/rectangle sections.
// For this fixture x ranges from 0 beyond the whole cone radius, so only y clips.
const section=z=>{const r=1.2+(.45-1.2)*(z+1)/2.2;
 const primitive=y=>{y=Math.max(-r,Math.min(r,y));return .5*(y*Math.sqrt(Math.max(0,r*r-y*y))+r*r*Math.asin(y/r));};return primitive(.9)-primitive(-.8);};
let coneIntersection=section(-.6)+section(1.2);const n=32768,dz=1.8/n;for(let i=1;i<n;i++)coneIntersection+=(i%2?4:2)*section(-.6+i*dz);coneIntersection*=dz/3;
const audits=[];
for(const row of data.cases.filter(r=>r.accepted&&shapes[r.fixture])){
 const nodes=shapes[row.fixture],boxes=nodes.map(shapeBounds),low=boxes[0].low.map((v,i)=>Math.min(v,boxes[1].low[i])),high=boxes[0].high.map((v,i)=>Math.max(v,boxes[1].high[i])),diagonal=Math.hypot(...high.map((v,i)=>v-low[i])),margin=.001*diagonal;
 const packet=JSON.parse(gunzipSync(await readFile(`${root}/packets/${row.stages.boolean}`))),geometry=mesh(packet,row.owner);
 let seed=0x1741397,checked=0,mismatches=0,ambiguous=0,nearBoundary=0;const examples=[];
 for(let i=0;i<16384;i++){
  const p=low.map((v,k)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return v+(high[k]-v)*(seed+.5)/4294967296;}),truth=combined(...nodes,row.operation,p);if(Math.abs(truth)<margin){nearBoundary++;continue;}
  const a=inside(p,[1,.371,.529],geometry,diagonal*1e-7),b=inside(p,[-.413,1,.263],geometry,diagonal*1e-7);if(a!==b){ambiguous++;continue;}checked++;
  if(a!==(truth>0)){mismatches++;if(examples.length<8)examples.push({point:p,expected:truth>0,actual:a});}
 }
 // Torus is exactly bisected by x=0; its half-volume is independently analytic.
 const referenceVolume=row.fixture==='torus-box'?(row.operation==='subtract-ba'?simpleVolume(nodes[1])-simpleVolume(nodes[0])/2:simpleVolume(nodes[0])/2):row.operation==='union'?simpleVolume(nodes[0])+simpleVolume(nodes[1])-coneIntersection:row.operation==='intersect'?coneIntersection:row.operation==='subtract-ab'?simpleVolume(nodes[0])-coneIntersection:simpleVolume(nodes[1])-coneIntersection;
 const volumeError=referenceVolume===null?null:Math.abs(referenceVolume-row.topology.volume),volumeTolerance=referenceVolume===null?null:.01*referenceVolume;
 const status=ambiguous>16384*.03?'inconclusive':mismatches>Math.floor(checked*.005)||(volumeError!==null&&volumeError>volumeTolerance)?'flagged':'sampled-check-passed';
 const audit={id:row.id,status,samples:16384,checked,nearBoundary,ambiguous,mismatches,mismatchLimit:Math.floor(checked*.005),margin,referenceVolume,volumeError,volumeTolerance,examples};audits.push(audit);console.log(JSON.stringify(audit));
}
assert.equal(audits.filter(r=>r.id.startsWith('cone-box')).length,4,'All four cone/box operations must now accept');
assert.equal(audits.filter(r=>r.id.startsWith('torus-box')).length,3);
assert.ok(data.cases.find(r=>r.id==='torus-box-union').refusalPreserved,'Known torus union loss must refuse atomically until fully repaired');
const report={method:'Intended analytic cone/torus/box fields vs independent two-ray BVH of native result triangles. 16384 samples/result; 0.1% diagonal near-boundary exclusion; 0.5% occupancy allowance; 1% curved volume allowance. Finite, not exact CAD certification.',audits,passed:audits.filter(r=>r.status==='sampled-check-passed').length};
await writeFile('_AgentScratch/tmp/GeometryRepairs/analytic.json',JSON.stringify(report,null,2));assert.equal(audits.filter(a=>a.id.startsWith('cone-box')&&a.status==='sampled-check-passed').length,4,'Analytic repaired-cone check failed');
assert.equal(audits.filter(a=>a.status==='flagged').length,0,'Confirmed spatial mismatch must be investigated');
console.log('Cone repair: 4 analytic passes. Periodic observations:',JSON.stringify(audits.filter(a=>a.id.startsWith('torus-box')).map(a=>({id:a.id,status:a.status,ambiguous:a.ambiguous}))));
