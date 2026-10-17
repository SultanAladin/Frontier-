// Independent triangle-ray occupancy/AABB audit of recorded native output.
// Does not call the kernel's point-inside classifier. Approximate sampled mesh
// check, not an exact analytic Boolean oracle or a replacement implementation.
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
const root=process.env.SOLIDARC_BROAD_OUT||'_AgentScratch/tmp/BroadGeometry',data=JSON.parse(await readFile(`${root}/results.json`,'utf8'));
const packet=async name=>JSON.parse(gunzipSync(await readFile(`${root}/packets/${name}`)));
const bounds=triangles=>{const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];for(const t of triangles)for(let i=0;i<9;i++){low[i%3]=Math.min(low[i%3],t[i]);high[i%3]=Math.max(high[i%3],t[i]);}return{low,high};};
function mesh(p,owner){const triangles=[];for(const d of p.frame.draws){if(d.kind!=='surface'||(d.pick&16383)!==owner)continue;const v=d.positions,m=d.local;for(let i=0;i<d.indices.length;i+=3){const tri=[];for(let j=0;j<3;j++){const k=d.indices[i+j]*3,x=v[k],y=v[k+1],z=v[k+2];for(let c=0;c<3;c++)tri.push(m[c]*x+m[c+4]*y+m[c+8]*z+m[c+12]);}triangles.push(tri);}}if(!triangles.length)throw Error(`No surface mesh for owner ${owner}`);return{...bounds(triangles),tree:tree(triangles)};}
function tree(tris){const box=bounds(tris);if(tris.length<=16)return{...box,tris};const sizes=box.high.map((v,i)=>v-box.low[i]),axis=sizes.indexOf(Math.max(...sizes));tris.sort((a,b)=>(a[axis]+a[axis+3]+a[axis+6])-(b[axis]+b[axis+3]+b[axis+6]));const mid=tris.length>>1;return{...box,a:tree(tris.slice(0,mid)),b:tree(tris.slice(mid))};}
function raybox(o,d,node){let min=0,max=Infinity;for(let i=0;i<3;i++){let a=(node.low[i]-o[i])/d[i],b=(node.high[i]-o[i])/d[i];if(a>b)[a,b]=[b,a];min=Math.max(min,a);max=Math.min(max,b);if(max<min)return false;}return true;}
function hit(o,d,t){const e1=[t[3]-t[0],t[4]-t[1],t[5]-t[2]],e2=[t[6]-t[0],t[7]-t[1],t[8]-t[2]];const p=[d[1]*e2[2]-d[2]*e2[1],d[2]*e2[0]-d[0]*e2[2],d[0]*e2[1]-d[1]*e2[0]],det=e1[0]*p[0]+e1[1]*p[1]+e1[2]*p[2];if(Math.abs(det)<1e-14)return null;const s=[o[0]-t[0],o[1]-t[1],o[2]-t[2]],u=(s[0]*p[0]+s[1]*p[1]+s[2]*p[2])/det;if(u<0||u>1)return null;const q=[s[1]*e1[2]-s[2]*e1[1],s[2]*e1[0]-s[0]*e1[2],s[0]*e1[1]-s[1]*e1[0]],v=(d[0]*q[0]+d[1]*q[1]+d[2]*q[2])/det;if(v<0||u+v>1)return null;const distance=(e2[0]*q[0]+e2[1]*q[1]+e2[2]*q[2])/det;return distance>1e-9?distance:null;}
function inside(o,d,geometry,tolerance){const hits=[];const visit=node=>{if(!raybox(o,d,node))return;if(node.tris){for(const tri of node.tris){const t=hit(o,d,tri);if(t!==null)hits.push(t);}}else{visit(node.a);visit(node.b);}};visit(geometry.tree);hits.sort((a,b)=>a-b);let count=0,last=-Infinity;for(const t of hits)if(t-last>tolerance){count++;last=t;}return !!(count%2);}
let seed=0x917204;const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return(seed+.5)/4294967296;};
const audits=[];
for(const row of data.cases){if(!row.stages.boolean)continue;
 const source=await packet(row.stages.source),result=await packet(row.stages.boolean);
 const a=mesh(source,source.description.figures.find(f=>f.name==='A').id),b=mesh(source,source.description.figures.find(f=>f.name==='B').id),r=mesh(result,row.owner);
 const low=a.low.map((x,i)=>Math.min(x,b.low[i])),high=a.high.map((x,i)=>Math.max(x,b.high[i])),diagonal=Math.hypot(...high.map((x,i)=>x-low[i])),tol=diagonal*.01;
 const contains=(outer,inner)=>inner.low.every((x,i)=>x>=outer.low[i]-tol)&&inner.high.every((x,i)=>x<=outer.high[i]+tol);
 const boundsPassed=row.operation==='union'?contains(r,a)&&contains(r,b):row.operation==='intersect'?contains(a,r)&&contains(b,r):contains(row.operation==='subtract-ab'?a:b,r);
 let checked=0,mismatches=0,ambiguous=0;const examples=[];
 for(let i=0;i<512;i++){const point=low.map((x,k)=>x+(high[k]-x)*random());const truth=[];
  for(const direction of [[1,.371,.529],[-.413,1,.263]]){const ia=inside(point,direction,a,diagonal*1e-7),ib=inside(point,direction,b,diagonal*1e-7),ir=inside(point,direction,r,diagonal*1e-7),expected=row.operation==='union'?ia||ib:row.operation==='intersect'?ia&&ib:row.operation==='subtract-ab'?ia&&!ib:ib&&!ia;truth.push({expected,actual:ir});}
  if(truth[0].expected!==truth[1].expected||truth[0].actual!==truth[1].actual){ambiguous++;continue;}
  checked++;if(truth[0].expected!==truth[0].actual){mismatches++;if(examples.length<6)examples.push({point,...truth[0]});}
 }
 const mismatchLimit=Math.max(2,Math.floor(checked*.01));
 const status=ambiguous>512*.03?'inconclusive':!boundsPassed||mismatches>mismatchLimit?'flagged':'sampled-check-passed';
 audits.push({id:row.id,status,boundsPassed,sourceBounds:{A:{low:a.low,high:a.high},B:{low:b.low,high:b.high}},resultBounds:{low:r.low,high:r.high},boundsTolerance:tol,samples:512,checked,ambiguous,mismatches,mismatchLimit,examples});
 console.log(row.id,status,`${mismatches}/${checked} occupancy mismatches`,boundsPassed?'bounds OK':'BOUNDS FAILED');
}
const summary={method:'Independent BVH triangle-ray parity, two non-axis-aligned rays, 512 deterministic points per accepted output; 1% mesh-bound tolerance and >1% occupancy mismatch threshold. Approximate sampled audit, not exact CAD certification.',audits,passed:audits.filter(a=>a.status==='sampled-check-passed').length,flagged:audits.filter(a=>a.status==='flagged').length,inconclusive:audits.filter(a=>a.status==='inconclusive').length};
await writeFile(`${root}/spatial.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify({passed:summary.passed,flagged:summary.flagged,inconclusive:summary.inconclusive}));
