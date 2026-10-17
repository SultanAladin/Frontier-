// Independent intended-CSG oracle against intermediate and final native meshes.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {mesh,inside} from './GeometryMeshAudit.mjs';
import {field,combined,shapeBounds,curved,witnesses,exactCells,simpleVolume} from './GeometryReferenceOracle.mjs';
const root=process.env.SOLIDARC_COMPLEX_OUT||'_AgentScratch/tmp/ComplexGeometry',data=JSON.parse(await readFile(`${root}/results.json`,'utf8'));
const manifest=JSON.parse(await readFile('Experimental/SolidArc/Native/Fixtures/ComplexGeometry.json','utf8'));
const fixtures=Object.fromEntries(manifest.fixtures.map(f=>[f.id,f]));
const packet=async file=>JSON.parse(gunzipSync(await readFile(`${root}/packets/${file}`)));
// Oracle/BVH checks against known values before trusting a stress-test result.
const L=fixtures['concave-l-notched'].a;assert.ok(field(L,[-1,1,1])>0);assert.ok(field(L,[0,0,1])<0);assert.ok(Math.abs(simpleVolume(L)-16.88)<1e-10);
const testBox={type:'box',low:[0,0,0],high:[2,2,2]},hole={type:'box',low:[.5,.5,-1],high:[1.5,1.5,3]};
assert.equal(exactCells([testBox,hole],p=>Math.min(field(testBox,p),-field(hole,p))).volume,6);
assert.ok(field({type:'transform',child:testBox,scale:.1,angle:90,move:[5,3,2]},[4.9,3.1,2.1])>0);
let auditNumber=0;
async function audit(id,file,owner,nodes,fn,nativeVolume,kind){
 const geometry=mesh(await packet(file),owner),bounds=nodes.map(shapeBounds),low=bounds[0].low.map((x,i)=>Math.min(...bounds.map(b=>b.low[i]))),high=bounds[0].high.map((x,i)=>Math.max(...bounds.map(b=>b.high[i]))),diagonal=Math.hypot(...high.map((v,i)=>v-low[i])),isCurved=nodes.some(curved);
 const exact=exactCells(nodes,fn),referenceVolume=exact?.volume??(nodes.length===1?simpleVolume(nodes[0]):null),margin=diagonal*(isCurved?8e-4:1e-6);
 let seed=0x724b91;for(const c of id)seed=(Math.imul(seed,33)^c.charCodeAt(0))>>>0;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed+.5)/4294967296;};
 const uniform=Array.from({length:4096},()=>low.map((v,i)=>v+(high[i]-v)*random()));
 const feature=nodes.flatMap(witnesses);
 // Probe both sides of returned surface triangles too. Exact CSG fields decide
 // what should be present; these returned surfaces are not the reference truth.
 let triangles=0;const boundary=[];
 const walk=node=>{if(node.tris){for(const t of node.tris){if(triangles++%7!==0)continue;const a=[t[3]-t[0],t[4]-t[1],t[5]-t[2]],b=[t[6]-t[0],t[7]-t[1],t[8]-t[2]],n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],l=Math.hypot(...n);if(l<1e-14)continue;const mid=[0,1,2].map(k=>(t[k]+t[k+3]+t[k+6])/3),eps=diagonal*(isCurved?.003:.0001);for(const s of [-1,1])boundary.push(mid.map((v,k)=>v+s*eps*n[k]/l));if(boundary.length>=768)return;}}else{walk(node.a);if(boundary.length<768)walk(node.b);}};walk(geometry.tree);
 const points=[...uniform,...feature,...(exact?.cells||[]),...boundary];let checked=0,ambiguous=0,nearBoundary=0,mismatches=0,uniformInside=0;const examples=[],bits=[];
 for(let i=0;i<points.length;i++){const p=points[i],expectedField=fn(p);if(i<uniform.length&&expectedField>0)uniformInside++;
  if(Math.abs(expectedField)<=margin){nearBoundary++;continue;}
  const a=inside(p,[1,.371,.529],geometry,diagonal*1e-7),b=inside(p,[-.413,1,.263],geometry,diagonal*1e-7);
  if(a!==b){ambiguous++;continue;}checked++;bits.push(a?'1':'0');if(a!==(expectedField>0)){mismatches++;if(examples.length<8)examples.push({point:p,expected:expectedField>0,actual:a,oracleMargin:Math.abs(expectedField),sample:i<4096?'uniform':i<4096+feature.length?'feature':'cell-or-surface'});}
 }
 const mismatchLimit=isCurved?Math.max(2,Math.floor(checked*.005)):0;
 const volumeTolerance=referenceVolume===null?null:Math.max(5e-7,Math.abs(referenceVolume)*(isCurved?.01:1e-5));
 const volumePassed=referenceVolume===null?null:Math.abs(referenceVolume-nativeVolume)<=volumeTolerance;
 const status=ambiguous>points.length*.03?'inconclusive':mismatches>mismatchLimit||volumePassed===false?'flagged':'sampled-check-passed';
 const out={id,kind,packet:file,owner,status,curved:isCurved,uniformSamples:4096,totalProbes:points.length,featureProbes:feature.length,orthogonalCellProbes:exact?.cells.length||0,boundaryProbes:boundary.length,checked,ambiguous,nearBoundary,mismatches,mismatchLimit,referenceVolume,nativeVolume,volumeTolerance,volumePassed,absoluteVolumeError:referenceVolume===null?null:Math.abs(nativeVolume-referenceVolume),referenceMethod:exact?'exact orthogonal CSG cell decomposition':referenceVolume!==null?'analytic primitive/profile/ruled-loft volume':'signed-field sampling only',estimatedVolume:uniformInside/4096*high.reduce((v,x,i)=>v*(x-low[i]),1),examples,occupancySha256:createHash('sha256').update(bits.join('')).digest('hex')};
 if(++auditNumber%20===0||status!=='sampled-check-passed')console.log(id,status,`${mismatches}/${checked}`,out.referenceMethod);
 return out;
}
const stages=[],sources=[],finals=[];
for(const row of data.fixtures){const spec=fixtures[row.id];
 for(const step of row.construction)if(step.body&&step.accepted&&step.packet){const out=await audit(row.id+':stage-'+step.index,step.packet,step.owner,[step.oracle],p=>field(step.oracle,p),step.topology.volume,'construction-stage');stages.push(out);}
 if(row.sourceOwners)for(const name of ['A','B'])sources.push(await audit(row.id+':source-'+name,row.sourcePacket,row.sourceOwners[name],[spec[name.toLowerCase()]],p=>field(spec[name.toLowerCase()],p),row.sourceTopology[name].volume,'final-source'));
 for(const op of row.cases){if(!op.accepted)continue;const a=spec.a,b=spec.b;const out=await audit(op.id,op.packet,op.owner,[a,b],p=>combined(a,b,op.operation,p),op.topology.volume,'final-boolean');out.sourceAuditPassed=sources.filter(s=>s.id.startsWith(row.id+':source-')).every(s=>s.status==='sampled-check-passed');finals.push(out);}
}
const commutativity=[];
for(const row of data.fixtures){for(const name of ['union','intersect']){const a=row.cases.find(c=>c.operation===name),b=row.cases.find(c=>c.operation===name+'-ba');if(a&&b)commutativity.push({fixture:row.id,operation:name,acceptanceSymmetric:a.accepted===b.accepted,accepted:a.accepted&&b.accepted,volumeError:a.accepted&&b.accepted?Math.abs(a.topology.volume-b.topology.volume):null});}}
const count=list=>({total:list.length,passed:list.filter(a=>a.status==='sampled-check-passed').length,flagged:list.filter(a=>a.status==='flagged').length,inconclusive:list.filter(a=>a.status==='inconclusive').length});
const output={method:'Intended analytic/CSG signed fields, not returned source meshes; 4096 deterministic uniform points, primitive/profile witnesses, both sides of returned triangles, exact orthogonal CSG cells where applicable; independent two-ray BVH parity. Polygonal tests allow zero non-boundary mismatches; curved tests allow 0.5%. Passing remains finite sampled evidence.',stages,sources,finals,commutativity,counts:{stages:count(stages),sources:count(sources),finals:count(finals)},oracleSelfTests:true};
await writeFile(`${root}/audit.json`,JSON.stringify(output,null,2));console.log(JSON.stringify(output.counts,null,2));
