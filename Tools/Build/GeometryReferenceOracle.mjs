// Intended-geometry signed fields. No modelling-kernel calls or returned source
// meshes are used as the oracle. Positive means inside; zero is a boundary.
export function polygonArea(points){return Math.abs(points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p[0]*q[1]-q[0]*p[1];},0))*.5;}
function polygonField(points,p){let inside=false,distance=Infinity;for(let i=0,j=points.length-1;i<points.length;j=i++){
 const a=points[j],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)):0;
 distance=Math.min(distance,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy));
 if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }return inside?distance:-distance;}
const axis=node=>{const a=node.axis||[0,0,1],l=Math.hypot(...a);return a.map(x=>x/l);};
export function field(node,p){switch(node.type){
 case 'box':return Math.min(...p.flatMap((v,i)=>[v-node.low[i],node.high[i]-v]));
 case 'sphere':return node.radius-Math.hypot(...p.map((v,i)=>v-node.center[i]));
 case 'torus':{const a=axis(node),q=p.map((v,i)=>v-node.center[i]),z=q.reduce((s,v,i)=>s+v*a[i],0),rho=Math.sqrt(Math.max(0,q.reduce((s,v)=>s+v*v,0)-z*z));return node.minor-Math.hypot(rho-node.major,z);}
 case 'cylinder':case 'cone':{const a=axis(node),q=p.map((v,i)=>v-node.foot[i]),z=q.reduce((s,v,i)=>s+v*a[i],0),rho=Math.sqrt(Math.max(0,q.reduce((s,v)=>s+v*v,0)-z*z)),r=node.type==='cylinder'?node.radius:node.r0+(node.r1-node.r0)*z/node.height;return Math.min(z,node.height-z,r-rho);}
 case 'profile':return Math.min(p[2]-node.z,node.z+node.height-p[2],polygonField(node.points,p));
 case 'ruled-profile':{const t=(p[2]-node.z)/node.height,points=node.points.map((a,i)=>a.map((x,j)=>x+(node.topPoints[i][j]-x)*t));return Math.min(p[2]-node.z,node.z+node.height-p[2],polygonField(points,p));}
 case 'union':return Math.max(field(node.a,p),field(node.b,p));
 case 'intersect':return Math.min(field(node.a,p),field(node.b,p));
 case 'subtract':return Math.min(field(node.a,p),-field(node.b,p));
 case 'transform':{const q=p.map((v,i)=>(v-node.move[i])/node.scale),a=-node.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return node.scale*field(node.child,[c*q[0]-s*q[1],s*q[0]+c*q[1],q[2]]);}
 default:throw Error(`Unimplemented reference shape ${node.type}`);
}}
export function combined(a,b,operation,p){const ia=field(a,p),ib=field(b,p);if(operation.startsWith('union'))return Math.max(ia,ib);if(operation.startsWith('intersect'))return Math.min(ia,ib);return operation==='subtract-ab'?Math.min(ia,-ib):Math.min(ib,-ia);}
export function shapeBounds(node){const type=node.type;
 if(type==='box')return{low:node.low,high:node.high};
 if(type==='sphere')return{low:node.center.map(v=>v-node.radius),high:node.center.map(v=>v+node.radius)};
 if(type==='torus'){const a=axis(node),r=a.map(v=>node.major*Math.sqrt(1-v*v)+node.minor);return{low:node.center.map((v,i)=>v-r[i]),high:node.center.map((v,i)=>v+r[i])};}
 if(type==='cylinder'||type==='cone'){const a=axis(node),r=type==='cylinder'?node.radius:Math.max(node.r0,node.r1),end=node.foot.map((v,i)=>v+a[i]*node.height);return{low:end.map((v,i)=>Math.min(v,node.foot[i])-r*Math.sqrt(1-a[i]*a[i])),high:end.map((v,i)=>Math.max(v,node.foot[i])+r*Math.sqrt(1-a[i]*a[i]))};}
 if(type==='profile'||type==='ruled-profile'){const pts=[...node.points,...(node.topPoints||[])];return{low:[Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),node.z],high:[Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1])),node.z+node.height]};}
 if(type==='transform'){const b=shapeBounds(node.child),corners=[];for(let i=0;i<8;i++){const p=b.low.map((v,j)=>(i&(1<<j)?b.high[j]:v)*node.scale),a=node.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);corners.push([c*p[0]-s*p[1]+node.move[0],s*p[0]+c*p[1]+node.move[1],p[2]+node.move[2]]);}return{low:[0,1,2].map(k=>Math.min(...corners.map(p=>p[k]))),high:[0,1,2].map(k=>Math.max(...corners.map(p=>p[k])))};}
 const a=shapeBounds(node.a),b=shapeBounds(node.b);if(type==='subtract')return a;return{low:a.low.map((v,i)=>type==='union'?Math.min(v,b.low[i]):Math.max(v,b.low[i])),high:a.high.map((v,i)=>type==='union'?Math.max(v,b.high[i]):Math.min(v,b.high[i]))};
}
export function curved(node){return ['sphere','cylinder','cone','torus','ruled-profile'].includes(node.type)||!!(node.a&&curved(node.a))||!!(node.b&&curved(node.b))||!!(node.child&&curved(node.child));}
export function witnesses(node){let points=[];const t=node.type;
 if(node.a)points.push(...witnesses(node.a),...witnesses(node.b));
 else if(t==='transform'){const a=node.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return witnesses(node.child).map(p=>[node.scale*(c*p[0]-s*p[1])+node.move[0],node.scale*(s*p[0]+c*p[1])+node.move[1],node.scale*p[2]+node.move[2]]);}
 else{const b=shapeBounds(node),mid=b.low.map((v,i)=>(v+b.high[i])*.5);points.push(mid);for(const f of [.1,.35,.65,.9])for(let k=0;k<3;k++){const p=[...mid];p[k]=b.low[k]+(b.high[k]-b.low[k])*f;points.push(p);}
  if(t==='profile'||t==='ruled-profile')for(let i=0;i<node.points.length;i++){const a=node.points[i],b=node.points[(i+1)%node.points.length];for(const z of [.2,.5,.8])points.push([(a[0]+b[0])*.5,(a[1]+b[1])*.5,node.z+node.height*z]);}
 }
 return points;
}
// Exact orthogonal cell decomposition is available only when every primitive is
// axis-aligned box or rectilinear polygon extrusion, with optional uniform scales
// and translations. Refuse this exact method for diagonal/curved/ruled geometry.
export function orthogonalBreaks(nodes){const sets=[new Set(),new Set(),new Set()];
 function collect(n,scale=1,offset=[0,0,0]){if(n.type==='transform'){if(n.angle!==0)return false;return collect(n.child,scale*n.scale,offset.map((v,i)=>v+scale*n.move[i]));}
  if(n.a)return collect(n.a,scale,offset)&&collect(n.b,scale,offset);
  const add=(k,v)=>sets[k].add(Number((scale*v+offset[k]).toPrecision(14)));
  if(n.type==='box'){for(let k=0;k<3;k++){add(k,n.low[k]);add(k,n.high[k]);}return true;}
  if(n.type==='profile'){if(n.points.some((p,i)=>{const q=n.points[(i+1)%n.points.length];return Math.abs(p[0]-q[0])>1e-12&&Math.abs(p[1]-q[1])>1e-12;}))return false;for(const p of n.points){add(0,p[0]);add(1,p[1]);}add(2,n.z);add(2,n.z+n.height);return true;}
  return false;
 }
 return nodes.every(n=>collect(n))?sets.map(s=>[...s].sort((a,b)=>a-b)):null;
}
export function exactCells(nodes,fn){const breaks=orthogonalBreaks(nodes);if(!breaks)return null;const [x,y,z]=breaks,cells=[];let volume=0,insideCells=0;for(let i=0;i<x.length-1;i++)for(let j=0;j<y.length-1;j++)for(let k=0;k<z.length-1;k++){
 const point=[(x[i]+x[i+1])*.5,(y[j]+y[j+1])*.5,(z[k]+z[k+1])*.5],inside=fn(point)>0,size=(x[i+1]-x[i])*(y[j+1]-y[j])*(z[k+1]-z[k]);if(inside){volume+=size;insideCells++;}cells.push(point);
 }return{volume,insideCells,cells,gridShape:breaks.map(b=>b.length-1)};}
export function simpleVolume(node){switch(node.type){case 'torus':return 2*Math.PI**2*node.major*node.minor**2;case 'box':return node.high.reduce((p,v,i)=>p*(v-node.low[i]),1);case 'profile':return polygonArea(node.points)*node.height;case 'cylinder':return Math.PI*node.radius**2*node.height;case 'sphere':return 4*Math.PI*node.radius**3/3;case 'cone':return Math.PI*node.height*(node.r0**2+node.r0*node.r1+node.r1**2)/3;case 'transform':{const v=simpleVolume(node.child);return v===null?null:v*node.scale**3;}case 'ruled-profile':{const mid=node.points.map((p,i)=>p.map((v,j)=>(v+node.topPoints[i][j])/2));return node.height*(polygonArea(node.points)+4*polygonArea(mid)+polygonArea(node.topPoints))/6;}default:return null;}}
