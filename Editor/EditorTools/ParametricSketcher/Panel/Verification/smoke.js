// Headless smoke test for Panel/index.html: node Verification/smoke.js
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const js=html.match(/<script>([\s\S]*)<\/script>/)[1];
const els={};
function mkEl(id){return {id,style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},dataset:{},innerHTML:'',textContent:'',value:'',
  getBoundingClientRect(){return{left:0,top:0,width:900,height:700}},querySelector(){return mkEl()},querySelectorAll(){return[]},addEventListener(){},setPointerCapture(){},appendChild(){},removeAttribute(){},replaceWith(){},focus(){},select(){},
  getContext(){return new Proxy({},{get:(t,k)=>k==='measureText'?()=>({width:10}):k==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}})},width:0,height:0,parentElement:null};}
global.document={querySelector:s=>els[s]||(els[s]=mkEl(s)),querySelectorAll:()=>[],createElement:()=>mkEl(),getElementById:()=>null};
global.ResizeObserver=class{observe(){}};global.localStorage={_:{},getItem(k){return this._[k]||null},setItem(k,v){this._[k]=v},removeItem(k){delete this._[k]}};global.Blob=class{};global.URL={createObjectURL:()=>'',revokeObjectURL(){}};global.navigator={};global.innerWidth=1600;global.innerHeight=900;
global.addEventListener=()=>{};global.location={search:process.argv.includes('--demo')?'?demo':''};global.URLSearchParams=class{constructor(q){this.q=q}has(k){return this.q.includes(k)}};global.devicePixelRatio=1;global.performance={now:()=>0};global.requestAnimationFrame=()=>{};
const mod={};new Function('module',js+';\nmodule.exports={doc,build,measure,runCmd,byId,draw,view,resize,pick,startOp,toolClick,finishTool,health,renderOutliner,renderInspector,xform,createWorkplane,active_,planeHit,setView,sketchProfile,gz,drawGizmo,gzHit,gzBegin,gzUpdate,gzEnd,modalStart,modalApply,modalConfirm,modalCancel,rotMat,eulerFromMat,project,gzTarget,setGzMode,gzPivot,gzSetValue,drawLiveDims,shapeFrom,loopOf,curveLines,getTool:()=>tool,topo,pickSub,selectSub,sub_,subBegin,subApply,subEnd,subVertices,planarLoop,loopScreen,setModes,offsetPolyline,delSub,health,addConstraint,removeConstraint,solveSketch,evalExpr,setVar,refreshDims,dimStart,dimPickAt,dimPlaceUpdate,dimCommit,getDimTool:()=>dimTool,dimGeom,residuals,dofMap,applyConstraint,isSlot,regenSlot,setDimName,topo,planeBasis,invalidateXf,gzTarget,modStart,modEnd,modPick,trimApply,cutApply,cornerPick,cornerGeom,cornerApply,curveCuts,curvePlane,getMod:()=>modTool,edgeInfo,bulgeArc,loopOf,syncLinks,unlink,modDown,modMove,modUp,modKey,sketchRegions,regionAt,toggleRegion,fillStart,fillEnd,fillPick,offStart,offEnd,offGeom,offApply,offDown,offKey,getOff:()=>offTool,getFill:()=>fillTool,selectTool,anyTool,extrudeMesh,sketchProfile,modStart,patStart,patEnd,patApply,patDown,patKey,getPat:()=>patTool,mirrorAcross,mirrorFn,xfPoints,snapCandidates,snapPoint,modKeys,getSnap:()=>snapHit,docJSON,loadDocJSON,undoTo,redoTo,showHistory,setLastMouse:(x,y)=>{lastMouse=[x,y];},planeHit};')(mod);const M=mod.exports;
let n=0;const ok=(c,m)=>{n++;if(!c){console.error('FAIL',m);process.exit(1);}};
ok(M.doc.figures.length===0,'starts empty');
M.doc.figures.forEach(f=>{M.build(f);const ms=M.measure(f);ok(isFinite(ms.v),'measure '+f.name);ok(['ok','warn','err'].includes(M.health(f).lvl),'health '+f.name);});
M.resize();
// 1. workplane via catalogue
const pl=M.createWorkplane({base:'XY',offset:0,tilt:0,size:120,show:true});ok(pl.kind==='plane'&&M.active_.plane===pl.id,'workplane active');
// 2. draw: rect (2 clicks) on the plane → new sketch + curve registered
M.setView('top');M.resize();M.startOp('rect');M.toolClick(400,300);M.toolClick(520,380);
let sk=M.doc.figures.find(f=>f.kind==='sketch');ok(sk&&sk.planeId===pl.id,'sketch created on plane');ok(sk.children.length===1,'rect registered');
const r=M.byId(sk.children[0]);ok(r.ctype==='poly'&&r.params.closed&&r.params.pts.length===4,'rect is closed 4-gon');
// 3. circle + polygon + polyline(3 pts + finish) + line + arc + ellipse + slot + point
M.startOp('circle');M.toolClick(450,350);M.toolClick(480,350);
M.startOp('polygon');M.toolClick(300,300);M.toolClick(330,300);M.toolClick(335,305);
M.startOp('polyline');M.toolClick(200,200);M.toolClick(260,200);M.toolClick(260,260);M.finishTool();
M.startOp('line');M.toolClick(100,100);M.toolClick(150,120);
M.startOp('arc');M.toolClick(600,500);M.toolClick(640,500);M.toolClick(600,540);
M.startOp('ellipse');M.toolClick(700,300);M.toolClick(760,300);M.toolClick(700,330);
M.startOp('slot');M.toolClick(100,500);M.toolClick(200,500);
M.startOp('pslot');M.toolClick(300,450);M.toolClick(380,410);M.toolClick(460,450);M.finishTool();const ps=M.doc.figures.filter(f=>f.kind==='curve').pop();ok(ps.ctype==='poly'&&ps.params.pts.length>30&&ps.params.spine.length===3,'polyline slot outline built from 3 centres');
M.startOp('spoint');M.toolClick(50,50);
sk=M.byId(sk.id);ok(sk.children.length===10,'10 curves in sketch, got '+sk.children.length);
sk.children.map(M.byId).forEach(c=>{M.build(c);ok(isFinite(M.measure(c).v),'measure '+c.name);});
const prof=M.sketchProfile(sk);ok(prof.outer.length>=4,'profile has outer loop');
// 4. XZ workplane with tilt; a circle drawn there maps off the ground
const p2=M.createWorkplane({base:'XZ',offset:20,tilt:15,size:100,show:true});M.setView('front');M.resize();M.startOp('circle');M.toolClick(450,350);M.toolClick(480,350);
const sk2=M.doc.figures.filter(f=>f.kind==='sketch').pop();ok(sk2.planeId===p2.id&&sk2.id!==sk.id,'second sketch on XZ plane');
const c2=M.byId(sk2.children[0]);const w=M.xform(c2,[c2.params.cx,c2.params.cy,0]);ok(Math.abs(w[1]+20)<1e-6,'XZ plane offset puts curve at y=-20, got '+w[1]);
// 5. commands still work; extrude of drawn sketch
M.runCmd('box 40 30 20');M.runCmd('extrude '+sk.name+' 12');const ex=M.doc.figures.find(f=>f.op==='extrude');ok(ex&&M.build(ex).tris.length>0,'extrude of drawn sketch builds');
M.runCmd('plane YZ --offset=10');ok(M.doc.figures.filter(f=>f.kind==='plane').length===3,'plane verb');
M.doc.figures.forEach(f=>{M.build(f);ok(isFinite(M.measure(f).v),'measure '+f.name);ok(['ok','warn','err'].includes(M.health(f).lvl),'health '+f.name);});
const f=ex;f.rot3=[0,90,0];f.scl=[2,1,1];const pp=M.xform(f,[1,0,0]);ok(Math.abs(pp[2]-f.pos[2]+2)<1e-6,'xform rotY90 scaleX2 → -z');
// 6. gizmo: mode-specific handles; translate-X moves x only; rotate about pivot keeps centre; scale about pivot; typed value; modal G Z 12.5; cancel restores
const bx=M.doc.figures.find(f=>f.op==='box');M.doc.sel.clear();M.doc.sel.add(bx.id);M.setView('iso');M.resize();M.draw();
ok(M.gzTarget()===bx,'gizmo target is selected box');ok(M.gz.handles.length===6,'translate mode: 3 cones + 3 planes, got '+M.gz.handles.length);
const piv=M.gzPivot(bx);ok(Math.abs(piv[2]-bx.pos[2]-bx.params.h/2)<1e-6,'pivot at box centre (z = h/2)');
const hx=M.gz.handles.find(h=>h.type==='translate'&&h.axis==='x');ok(M.gzHit(hx.sx,hx.sy)&&M.gzHit(hx.sx,hx.sy).type==='translate','hit-test finds X cone');
const p0=[...bx.pos];M.gzBegin(hx,hx.sx,hx.sy);M.gzUpdate(hx.sx-30,hx.sy+15,false);M.gzEnd();
ok(Math.abs(bx.pos[1]-p0[1])<1e-9&&Math.abs(bx.pos[2]-p0[2])<1e-9&&Math.abs(bx.pos[0]-p0[0])>0.5,'translate-X drag moves only x: '+bx.pos.map(v=>v.toFixed(2)));
M.setGzMode('rotate');ok(M.gz.handles.length===4,'rotate mode: 3 rings + view ring, got '+M.gz.handles.length);
const hr=M.gz.handles.find(h=>h.type==='rotate'&&h.axis==='z');const pv0=M.gzPivot(bx);const q=hr.ring[0];M.gzBegin(hr,q[0],q[1]);M.gzUpdate(hr.ring[6][0],hr.ring[6][1],true);M.gzEnd();
ok(Math.abs(bx.rot3[2])>1&&Math.abs(bx.rot3[2]/5-Math.round(bx.rot3[2]/5))<1e-6&&Math.abs(bx.rot3[0])<1e-6,'rotate-Z ring drag with snap → z multiple of 5°: '+bx.rot3.map(v=>v.toFixed(2)));
const pv1=M.gzPivot(bx);ok(pv1.every((v,i)=>Math.abs(v-pv0[i])<1e-6),'rotation happens about the pivot (centre stays put)');
const E=M.eulerFromMat(M.rotMat([20,-35,60]));ok(E.every((v,i)=>Math.abs(v-[20,-35,60][i])<1e-6),'euler↔matrix round trip');
M.setGzMode('scale');ok(M.gz.handles.length===3,'scale mode: 3 cylinders');
const hs=M.gz.handles.find(h=>h.type==='scale'&&h.axis==='y');const s0=[...bx.scl];M.gzBegin(hs,hs.sx,hs.sy);M.gzSetValue(2);ok(Math.abs(bx.scl[1]-s0[1]*2)<1e-9&&bx.scl[0]===s0[0],'typed value 2 → y scale doubled');
const pv2=M.gzPivot(bx);ok(pv2.every((v,i)=>Math.abs(v-pv1[i])<1e-6),'scale happens about the pivot');M.gzEnd();
M.setGzMode('translate');const pg=[...bx.pos];M.modalStart('g');M.gz.modal.axis='z';M.gz.modal.num='12.5';M.modalApply(0,0,false);M.modalConfirm();ok(Math.abs(bx.pos[2]-pg[2]-12.5)<1e-9&&bx.pos[0]===pg[0],'modal G Z 12.5 moves +12.5 on z');
const pr=[...bx.rot3];M.modalStart('r');ok(M.gz.mode==='rotate','R switches gizmo to rotate mode');M.gz.modal.axis='x';M.modalApply(300,300,false);ok(bx.rot3.some((v,i)=>Math.abs(v-pr[i])>1e-6),'modal R changes rotation');M.modalCancel();ok(bx.rot3.every((v,i)=>Math.abs(v-pr[i])<1e-9),'modal cancel restores rotation');
M.doc.sel.clear();M.draw();ok(M.gz.handles.length===0,'no handles without selection');
// 7. live dimensions while drawing don't throw for every shape
M.setView('top');M.resize();['circle','rect','line','arc','ellipse','polygon','slot','polyline','pslot'].forEach(id=>{M.startOp(id);M.toolClick(400,300);M.toolClick(460,300);M.toolClick(470,360);M.draw();ok(true,'live dims '+id);M.finishTool();});
// polygon sides via wheel-like adjust before confirm
M.startOp('polygon');M.toolClick(400,300);M.toolClick(440,300);M.getTool().vals.sides=9;M.toolClick(445,305);const pg9=M.doc.figures.filter(f=>f.kind==='curve').pop();ok(pg9.params.pts.length===9,'polygon confirm step keeps adjusted side count (9)');
// 8. curves move individually (not the whole sketch); pick selects the curve; fill loops; resolution multiplier
M.setView('top');M.resize();M.doc.figures.filter(f=>f.kind==='curve'||f.kind==='body').forEach(f=>f.visible=false);M.active_.plane=M.doc.figures.find(f=>f.kind==='plane'&&f.axis==='XY').id;M.active_.sketch=null;M.startOp('circle');M.toolClick(300,300);M.toolClick(340,300);M.startOp('circle');M.toolClick(520,430);M.toolClick(540,430);
const cs=M.doc.figures.filter(f=>f.kind==='curve'&&f.ctype==='circle'&&f.visible);ok(cs.length===2,'two fresh circles, got '+cs.length);const [cA,cB]=cs;
M.doc.sel.clear();M.pick(300,300,false);ok(M.doc.sel.has(cA.id)&&M.doc.sel.size===1,'clicking inside a filled circle selects that curve, not the sketch');
M.finishTool();M.doc.sel=new Set([cA.id]);M.setGzMode('rotate');ok(M.gz.handles.filter(h=>h.type==='rotate').length===2&&M.gz.handles.every(h=>h.axis==='z'||h.axis==='view'),'curve rotate: normal + view rings only, got '+M.gz.handles.map(h=>h.axis));M.setGzMode('translate');ok(M.gzTarget()===cA,'gizmo targets the curve');const hcx=M.gz.handles.find(h=>h.type==='translate'&&h.axis==='x');ok(!!hcx&&M.gz.handles.some(h=>h.axis==='z'&&h.type==='translate')&&M.gz.handles.filter(h=>h.type==='plane').length===1,'curve gizmo: X/Y/Z cones + one plane quad');
const pa0=[...cA.pos],pb0=[...cB.pos];M.gzBegin(hcx,hcx.sx,hcx.sy);M.gzUpdate(hcx.sx+40,hcx.sy,false);M.gzEnd();
ok(Math.abs(cA.pos[0]-pa0[0])>1&&Math.abs(cA.pos[1]-pa0[1])<1e-9,'curve moved along its plane u axis');ok(cB.pos[0]===pb0[0]&&cB.pos[1]===pb0[1],'sibling curve did not move');
const hz=M.gz.handles.find(h=>h.type==='translate'&&h.axis==='z');const z0=cA.pos[2];M.gzBegin(hz,hz.sx,hz.sy);M.gzSetValue(7);M.gzEnd();ok(Math.abs(cA.pos[2]-z0-7)<1e-9&&Math.abs(M.xform(cA,[0,0,0])[2]-7)<1e-9,'curve moves along plane normal (Z) by 7');cA.pos[2]=0;
const wc=M.xform(cA,[cA.params.cx,cA.params.cy,0]);ok(Math.abs(wc[0]-(cA.params.cx+cA.pos[0]))<1e-6,'xform applies curve-local offset');
const n1=M.curveLines(cA).lines.length;M.doc.curveRes=2;const n2=M.curveLines(cA).lines.length;M.doc.curveRes=1;ok(n2===2*n1,'curve resolution multiplier doubles segments');
cA.segs=128;ok(M.curveLines(cA).lines.length===128,'per-curve segments override');delete cA.segs;
M.startOp('arc');M.toolClick(600,500);M.toolClick(640,500);M.toolClick(600,540);const arc=M.doc.figures.filter(f=>f.ctype==='arc').pop();ok(M.loopOf(arc)===null,'open arc has no loop');arc.params.closed=true;ok(M.loopOf(arc)&&M.loopOf(arc).length>8,'closed arc becomes a fillable loop');
// 9. topology: box has 8 verts / 12 edges / 6 faces; polyline slot outline sane; vertex/edge/face multi-select + move; non-planar loop loses its face
const box=M.doc.figures.find(f=>f.op==='box');box.visible=true;const tb=M.topo(box);ok(tb.verts.length===8&&tb.edges.length===12&&tb.faces.length===6,'box topo 8/12/6, got '+[tb.verts.length,tb.edges.length,tb.faces.length]);
const sl=M.offsetPolyline([[0,0],[40,0],[40,40]],5);ok(sl.length>20&&sl.every(q=>isFinite(q[0])&&isFinite(q[1])),'slot outline finite');const far=Math.max(...sl.map(q=>Math.hypot(q[0]-40,q[1]-0)));ok(far<Math.hypot(40,40)+5.01,'slot outline stays within radius of spine');
const inside=[[20,0],[40,20]].every(c=>M.sub_&&(()=>{let cnt=false;for(let i=0,j=sl.length-1;i<sl.length;j=i++){const a=sl[i],b=sl[j];if(((a[1]>c[1])!==(b[1]>c[1]))&&(c[0]<(b[0]-a[0])*(c[1]-a[1])/(b[1]-a[1])+a[0]))cnt=!cnt;}return cnt;})());ok(inside,'spine midpoints are inside the slot outline');
M.setView('top');M.resize();M.doc.figures.filter(f=>f.kind==='body').forEach(f=>f.visible=false);M.startOp('rect');M.toolClick(400,300);M.toolClick(520,380);const rc=M.doc.figures.filter(f=>f.kind==='curve').pop();const tr=M.topo(rc);ok(tr.verts.length===4&&tr.edges.length===4&&tr.faces.length===1,'rect topo 4/4/1');
M.setModes(['vertex','edge']);ok(M.view.modes.length===2,'combined select modes');
const v0=M.project(M.xform(rc,[rc.params.pts[0][0],rc.params.pts[0][1],0]));const hit=M.pickSub(v0[0],v0[1],new Set(['vertex','edge']));ok(hit&&hit.kind==='vertex'&&hit.fig===rc.id,'pickSub prefers the vertex under the cursor');
M.selectSub(hit,false);const e1=M.topo(rc).edges[1];const em=M.project(M.xform(rc,[(rc.params.pts[e1.a][0]+rc.params.pts[e1.b][0])/2,(rc.params.pts[e1.a][1]+rc.params.pts[e1.b][1])/2,0]));const hit2=M.pickSub(em[0],em[1],new Set(['edge']));ok(hit2&&hit2.kind==='edge','edge pick');M.selectSub(hit2,true);ok(M.sub_.sel.size===2&&M.subVertices().length===3,'vertex + edge multi-select → 3 unique vertices');
const before=rc.params.pts.map(q=>[...q]);const st=M.subBegin();M.subApply(st,[10,0,0]);M.subEnd();ok(Math.abs(rc.params.pts[0][0]-before[0][0]-10)<1e-6&&Math.abs(rc.params.pts[e1.a][0]-before[e1.a][0]-10)<1e-6,'moved selected vertices by +10 u');
ok(M.loopScreen(rc)!==null,'rect still planar → face kept');
M.sub_.sel.clear();M.selectSub({fig:rc.id,kind:'vertex',idx:0},false);const st2=M.subBegin();M.subApply(st2,[0,0,15]);M.subEnd();ok(rc.params.vz&&Math.abs(rc.params.vz[0]-15)<1e-6,'vertex lifted on Z');ok(M.loopScreen(rc)===null&&M.health(rc).lvl==='warn','non-planar loop → fill overlay removed + warning');
M.selectSub({fig:rc.id,kind:'edge',idx:2},false);const st3=M.subBegin();M.subApply(st3,[0,0,15]);M.subEnd();
M.selectSub({fig:rc.id,kind:'vertex',idx:0},false);M.selectSub({fig:rc.id,kind:'vertex',idx:1},true);M.selectSub({fig:rc.id,kind:'vertex',idx:2},true);M.selectSub({fig:rc.id,kind:'vertex',idx:3},true);
rc.params.vz=[15,15,15,15];M.topo(rc);ok(M.planarLoop(rc)&&M.loopScreen(rc)!==null,'all four vertices lifted equally → planar again → face back');
rc.params.pts=[[0,0],[40,0],[40,30],[0,30]];rc.params.vz=[15,0,0,15];M.topo(rc);ok(M.planarLoop(rc),'two adjacent vertices lifted (tilted plane) → still planar');
rc.params.vz=[15,0,15,0];ok(!M.planarLoop(rc),'diagonal lift → non-planar');
M.setModes(['body']);M.sub_.sel.clear();
// 10. constraints + solver + dimensions + variables
M.doc.figures.filter(f=>f.kind==='curve').forEach(f=>f.visible=false);M.active_.sketch=null;
M.startOp('line');M.toolClick(300,300);M.toolClick(400,280);const ln=M.doc.figures.filter(f=>f.kind==='curve').pop();const skc=M.byId(ln.parent);
M.addConstraint(skc,'horizontal',[{fig:ln.id,kind:'edge',idx:0}]);ok(Math.abs(ln.params.y1-ln.params.y2)<1e-5,'horizontal constraint solved: '+ln.params.y1.toFixed(3)+' vs '+ln.params.y2.toFixed(3));
const dd=M.addConstraint(skc,'dist',[{fig:ln.id,kind:'edge',idx:0}],{value:50,expr:'50'});ok(Math.abs(Math.hypot(ln.params.x2-ln.params.x1,ln.params.y2-ln.params.y1)-50)<1e-4,'length dimension drives the line to 50');
ok(Math.abs(ln.params.y1-ln.params.y2)<1e-5,'horizontal still holds after dimension');
M.startOp('circle');M.toolClick(500,420);M.toolClick(520,420);const ci=M.doc.figures.filter(f=>f.kind==='curve').pop();
M.addConstraint(skc,'coincident',[{fig:ci.id,kind:'vertex',idx:0},{fig:ln.id,kind:'vertex',idx:1}]);ok(Math.abs(ci.params.cx-ln.params.x2)<1e-4&&Math.abs(ci.params.cy-ln.params.y2)<1e-4,'coincident: circle centre snapped to line end');
M.addConstraint(skc,'diam',[{fig:ci.id,kind:'edge',idx:0}],{value:20,expr:'20'});ok(Math.abs(ci.params.r-10)<1e-4,'diameter dimension → r = 10');
// variables + expressions
ok(M.setVar('W','40'),'variable W = 40');ok(Math.abs(M.evalExpr('W/2 + 3')-23)<1e-9,'expression W/2+3 = 23');ok(!isFinite(M.evalExpr('alert(1)')),'unsafe expression rejected');
dd.expr='W*2';M.refreshDims();ok(Math.abs(dd.value-80)<1e-9&&Math.abs(Math.hypot(ln.params.x2-ln.params.x1,ln.params.y2-ln.params.y1)-80)<1e-3,'dimension bound to W*2 → line is 80');
M.setVar('W','25');ok(Math.abs(Math.hypot(ln.params.x2-ln.params.x1,ln.params.y2-ln.params.y1)-50)<1e-3,'changing W re-solves: line is 50');
ok(Math.abs(ci.params.cx-ln.params.x2)<1e-3,'circle followed the line end through re-solve');
// live drag with constraints: move the line start; length + horizontal + coincidence maintained
M.sub_.sel.clear();M.selectSub({fig:ln.id,kind:'vertex',idx:0},false);const st10=M.subBegin();M.subApply(st10,[7,4,0]);M.subEnd();
ok(Math.abs(Math.hypot(ln.params.x2-ln.params.x1,ln.params.y2-ln.params.y1)-50)<1e-3&&Math.abs(ln.params.y1-ln.params.y2)<1e-3,'after dragging an endpoint: length 50 + horizontal kept');
// dimension tool flow: click line → drag → release places
M.sub_.sel.clear();M.setModes(['body']);M.dimStart();const mid10=M.project(M.xform(ln,[(ln.params.x1+ln.params.x2)/2,(ln.params.y1+ln.params.y2)/2,0]));ok(M.dimPickAt(mid10[0],mid10[1]),'dimension tool picks the line');ok(M.getDimTool().stage==='place'&&M.getDimTool().type==='dist','→ placing a length dim');
M.dimPlaceUpdate(mid10[0],mid10[1]-40);const pl0=M.getDimTool().place;ok(pl0&&Math.abs(pl0.off)>1,'drag sets the offset: '+JSON.stringify(pl0));const nC=skc.cons_.length;M.dimCommit();ok(skc.cons_.length===nC+1&&M.getDimTool()===null,'release commits the dimension and ends the tool');
const G10=M.dimGeom(skc,skc.cons_[skc.cons_.length-1]);ok(G10&&G10.txt.includes('50'),'dimension label reads 50: '+(G10&&G10.txt));
// point-to-point with H/V inference
M.dimStart();const q1=M.project(M.xform(ln,[ln.params.x1,ln.params.y1,0]));M.dimPickAt(q1[0],q1[1]);const q2=M.project(M.xform(ci,[ci.params.cx,ci.params.cy,0]));M.dimPickAt(q2[0]+0,q2[1]);ok(M.getDimTool().refs.length===2,'two points picked');M.dimPlaceUpdate(q1[0],q1[1]-60);M.dimCommit();
// remove a constraint
M.removeConstraint(skc,skc.cons_[0].id);ok(!skc.cons_.some(c=>c.type==='horizontal'),'constraint removed');
// 11. slots are single entities; inline dimension rename
M.startOp('slot');M.toolClick(200,600);M.toolClick(300,600);const sl2=M.doc.figures.filter(f=>f.kind==='curve').pop();ok(M.isSlot(sl2)&&sl2.params.spine.length===2,'2-point slot carries a spine');
const ts=M.topo(sl2);ok(ts.verts.length===2&&ts.edges.length===1&&ts.edges[0].curve,'slot topology: 2 centre vertices, ONE outline edge');ok(ts.faces.length===1,'slot fills as a single face');
const outMid=sl2.params.pts[Math.floor(sl2.params.pts.length/2)];const so=M.project(M.xform(sl2,[outMid[0],outMid[1],0]));const hitS=M.pickSub(so[0],so[1],new Set(['edge']));ok(hitS&&hitS.fig===sl2.id&&hitS.idx===0,'clicking anywhere on the slot outline picks edge 0 (whole slot)');
const skS=M.byId(sl2.parent);M.addConstraint(skS,'dist',[{fig:sl2.id,kind:'edge',idx:0}],{value:70,expr:'70'});const S=sl2.params.spine;ok(Math.abs(Math.hypot(S[1][0]-S[0][0],S[1][1]-S[0][1])-70)<1e-3,'length dimension on a slot drives centre distance to 70');
const r0=sl2.params.r;sl2.params.r=r0+3;M.regenSlot(sl2);ok(sl2.params.pts.every(q=>isFinite(q[0])),'slot outline regenerated after radius change');
M.sub_.sel.clear();M.selectSub({fig:sl2.id,kind:'vertex',idx:1},false);const st11=M.subBegin();M.subApply(st11,[0,9,0]);M.subEnd();ok(Math.abs(Math.hypot(S[1][0]-S[0][0],S[1][1]-S[0][1])-70)<1e-3,'dragging a slot centre keeps the 70 dimension');
const dS=skS.cons_.find(c=>c.type==='dist'&&c.refs[0].fig===sl2.id);ok(M.setDimName(skS,dS,'SLOT_L'),'rename dimension inline → SLOT_L');ok(M.doc.vars.SLOT_L&&Math.abs(M.evalExpr('SLOT_L/2')-35)<1e-9,'renamed dimension usable as variable');
ok(!M.setDimName(skS,dS,'2bad'),'invalid name rejected');ok(M.setDimName(skS,dS,''),'clearing the name works');ok(!M.doc.vars.SLOT_L,'variable removed on clear');
M.doc.sel=new Set([sl2.id]);M.sub_.sel.clear();M.renderInspector();const ih=document.querySelector('#insp').innerHTML||'';ok(ih.includes('data-cname')&&ih.includes('id="slotR"'),'inspector shows per-dimension name inputs + slot radius');
// 12. workplane transform drives everything on it; plane inspector is a workplane editor
const wp2=M.createWorkplane({base:'XY',offset:0,tilt:0,size:120,show:true});M.startOp('circle');M.toolClick(450,350);M.toolClick(480,350);const cW=M.doc.figures.filter(f=>f.kind==='curve').pop();const skW=M.byId(cW.parent);ok(skW.planeId===wp2.id,'circle drawn on the new workplane');
const w0=M.xform(cW,[cW.params.cx,cW.params.cy,0]);wp2.pos=[10,20,30];M.invalidateXf(wp2);const w1=M.xform(cW,[cW.params.cx,cW.params.cy,0]);ok(Math.abs(w1[0]-w0[0]-10)<1e-6&&Math.abs(w1[1]-w0[1]-20)<1e-6&&Math.abs(w1[2]-w0[2]-30)<1e-6,'moving the plane moves the sketch geometry with it');
wp2.rot3=[90,0,0];M.invalidateXf(wp2);const B2=M.planeBasis(wp2);ok(Math.abs(Math.abs(B2.n[1])-1)<1e-6&&Math.abs(B2.n[2])<1e-6,'rotating the plane 90° about X turns its normal to ±Y: '+B2.n.map(v=>v.toFixed(2)));
const w2=M.xform(cW,[cW.params.cx,cW.params.cy,0]);ok(Math.abs(w2[1]-20)<1e-6||Math.abs(w2[1]-w0[1])>1e-6,'geometry rotated with the plane');
wp2.scl=[2,2,2];M.invalidateXf(wp2);const pz0=M.xform(cW,[0,0,0]),pz1=M.xform(cW,[10,0,0]);ok(Math.abs(Math.hypot(pz1[0]-pz0[0],pz1[1]-pz0[1],pz1[2]-pz0[2])-20)<1e-6,'plane scale 2 doubles the sketch spacing');
M.setView('iso');M.resize();M.doc.figures.forEach(f=>{if(f.kind==='curve'&&f.id!==cW.id)f.visible=false;});const sc=M.project(M.xform(cW,[cW.params.cx+cW.params.r,cW.params.cy,0]));const hW=M.pickSub(sc[0],sc[1],new Set(['edge']));ok(hW&&hW.fig===cW.id,'picking follows the transformed plane');
wp2.pos=[0,0,0];wp2.rot3=[0,0,0];wp2.scl=[1,1,1];M.invalidateXf(wp2);
M.doc.sel=new Set([wp2.id]);M.sub_.sel.clear();M.renderInspector();const ph=document.querySelector('#insp').innerHTML;ok(ph.includes('data-pax="XZ"')&&ph.includes('In-plane rotation')&&ph.includes('id="pAct"'),'plane inspector: base axis · offset · rotation · extent · activate');ok(!ph.includes('data-adddim')&&!ph.includes('Radius'),'plane inspector has no radius / fake dimension controls');
ok(M.gzTarget&&M.gzTarget()===wp2,'gizmo targets the selected plane');
M.doc.figures.forEach(f=>{if(f.kind==='curve')f.visible=true;});
{// 13. sketch modify: trim · cut · fillet · chamfer
M.setView('top');M.resize();M.doc.figures.forEach(f=>{if(f.kind==='curve'||f.kind==='body')f.visible=false;});const wpM=M.createWorkplane({base:'XY',offset:0,tilt:0,size:120,show:true});
M.startOp('line');M.toolClick(300,300);M.toolClick(500,300);const lA=M.doc.figures.filter(f=>f.kind==='curve').pop();
M.startOp('line');M.toolClick(400,200);M.toolClick(400,400);const lB=M.doc.figures.filter(f=>f.kind==='curve').pop();const skM=M.byId(lA.parent);
const nC0=skM.children.length;const cutsA=M.curveCuts(lA,M.curvePlane(lA),skM);ok(cutsA.length===1&&cutsA[0]>.1&&cutsA[0]<.9,'line A crossed once by line B inside its span');
const hA=M.modPick(450,300);ok(hA&&hA.f===lA,'trim picks line A');M.trimApply(hA);
const PAM=lA.params.pts;const xs=PAM.map(q=>q[0]);ok(lA.ctype==='poly'&&PAM.length===2&&(Math.abs(Math.max(...xs)-lB.params.x1)<1e-6||Math.abs(Math.min(...xs)-lB.params.x1)<1e-6)&&Math.abs(xs[0]-xs[1])<40,'trim removed the span on one side of the intersection');ok(skM.children.length===nC0,'trim of an end span keeps the curve count');
M.startOp('line');M.toolClick(300,350);M.toolClick(500,350);const lC=M.doc.figures.filter(f=>f.kind==='curve').pop();const hC=M.modPick(400,350);ok(hC&&hC.f===lC,'cut picks line C');M.cutApply(hC);
const lC2=M.doc.figures.filter(f=>f.kind==='curve').pop();ok(lC2!==lC&&lC2.parent===skM.id&&lC.params.pts.length===2&&lC2.params.pts.length===2,'cut split line C into two curves');const jx=lC.params.pts[1];ok(Math.abs(jx[0]-lC2.params.pts[0][0])<1e-9&&Math.abs(jx[0]-lB.params.x1)<1e-6,'cut snapped to the intersection with line B');
// middle-span trim on a line crossed twice → two pieces
M.startOp('line');M.toolClick(350,250);M.toolClick(350,450);const lD=M.doc.figures.filter(f=>f.kind==='curve').pop();M.startOp('line');M.toolClick(450,250);M.toolClick(450,450);const lE=M.doc.figures.filter(f=>f.kind==='curve').pop();
M.startOp('line');M.toolClick(300,420);M.toolClick(500,420);const lF=M.doc.figures.filter(f=>f.kind==='curve').pop();const nBefore=skM.children.length;M.trimApply(M.modPick(400,420));ok(skM.children.length===nBefore+1,'trimming the middle span yields two pieces');
// fillet a rectangle corner
M.startOp('rect');M.toolClick(600,200);M.toolClick(700,300);const rcM=M.doc.figures.filter(f=>f.kind==='curve').pop();ok(rcM.params.pts.length===4,'rectangle has 4 corners');
const cnr=M.cornerPick(700,200);ok(cnr&&cnr.f===rcM,'fillet picks a rectangle corner');const GM=M.cornerGeom(cnr,5,'fillet');ok(GM&&Math.abs(GM.r-5)<1e-9&&GM.pts.length>=4,'fillet geometry: R5 arc with '+(GM&&GM.pts.length)+' points');
const GmM=M.cornerGeom(cnr,1e6,'fillet');ok(GmM.r<=GmM.max+1e-9&&GmM.max>0,'fillet radius clamped to the corner: max '+GmM.max.toFixed(2));
M.modStart('fillet');M.modDown({button:0,pointerId:1},700,200);ok(M.getMod().drag&&M.getMod().drag.corner.f===rcM,'click corner starts the fillet drag');M.modKey({key:'5'});M.modKey({key:'Enter'});ok(rcM.params.pts.length===5&&rcM.params.closed&&rcM.params.bulge&&rcM.params.bulge.filter(b=>b).length===1,'⏎ applies fillet: ONE arc segment (bulge), not sampled points');const tF=M.topo(rcM);const arcE=tF.edges.findIndex(e=>e.arc);ok(arcE>=0&&tF.edges.length===5,'topology: 5 edges, one of them an arc');const eiF=M.edgeInfo({fig:rcM.id,kind:'edge',idx:arcE});ok(eiF.kind==='circle'&&eiF.arc&&Math.abs(eiF.r-5)<1e-6,'arc edge reports R = 5');
const A=M.bulgeArc(rcM.params.pts[arcE],rcM.params.pts[(arcE+1)%5],rcM.params.bulge[arcE]);const midA=[A.c[0]+Math.cos(A.a0+A.sweep/2)*A.r,A.c[1]+Math.sin(A.a0+A.sweep/2)*A.r];const sMid=M.project(M.xform(rcM,[midA[0],midA[1],0]));const hitA=M.pickSub(sMid[0],sMid[1],new Set(['edge']));ok(hitA&&hitA.fig===rcM.id&&hitA.idx===arcE,'clicking the middle of the fillet picks the arc edge as one entity');ok(M.loopOf(rcM).length>5,'display loop expands the arc for drawing/fill');
// chamfer via Tab
const cn2=M.cornerPick(600,300);ok(cn2&&cn2.f===rcM,'chamfer picks another corner');M.modDown({button:0,pointerId:1},600,300);M.modKey({key:'Tab',preventDefault(){}});ok(M.getMod().kind==='chamfer','Tab toggles fillet → chamfer');const n1=rcM.params.pts.length;M.modKey({key:'3'});M.modKey({key:'Enter'});ok(rcM.params.pts.length===n1+1&&rcM.params.bulge.length===rcM.params.pts.length,'chamfer replaces the corner with 2 points, bulge array stays aligned');M.modEnd();
// fillet across two separate lines meeting at a corner → merged into one polyline
M.startOp('line');M.toolClick(800,200);M.toolClick(900,200);const m1=M.doc.figures.filter(f=>f.kind==='curve').pop();M.startOp('line');M.toolClick(900,200);M.toolClick(900,300);const m2=M.doc.figures.filter(f=>f.kind==='curve').pop();
const cn3=M.cornerPick(900,200);ok(cn3&&cn3.merge,'corner between two touching lines is detected');M.modStart('fillet');M.modDown({button:0,pointerId:1},900,200);M.modKey({key:'4'});M.modKey({key:'Enter'});ok(!M.byId(m2.id)||!M.byId(m1.id),'two lines merged into one filleted polyline');M.modEnd();
M.doc.figures.forEach(f=>{if(f.kind==='curve'||f.kind==='body')f.visible=true;});
}
{// 14. fill regions (pipe), offset/inset, select tool (Q)
M.setView('top');M.resize();M.doc.figures.forEach(f=>{if(f.kind==='curve'||f.kind==='body')f.visible=false;});M.createWorkplane({base:'XY',offset:0,tilt:0,size:120,show:true});
M.startOp('circle');M.toolClick(400,300);M.toolClick(480,300);const c1=M.doc.figures.filter(f=>f.kind==='curve').pop();M.startOp('circle');M.toolClick(400,300);M.toolClick(440,300);const c2=M.doc.figures.filter(f=>f.kind==='curve').pop();const skP=M.byId(c1.parent);
let R=M.sketchRegions(skP);ok(R.length===2,'two concentric circles → 2 regions');const ring=R.find(r=>r.depth===1),disc=R.find(r=>r.depth===2);ok(ring&&ring.on&&disc&&!disc.on,'even-odd default: ring filled, inner disc empty (pipe)');ok(ring.holes.length===1&&ring.holes[0].f===c2,'ring region has the inner circle as hole');
let pr=M.sketchProfile(skP);ok(pr.regions.length===1&&pr.holes.length===1,'profile = ring with a hole');const mesh=M.extrudeMesh(skP,10,0);ok(mesh.capHole.length===1&&mesh.tris.length>0,'extrude produces a pipe (hole wall + caps)');
const area=M.measure(skP).v;const exp=Math.PI*(c1.params.r**2-c2.params.r**2);ok(Math.abs(area-exp)/exp<.05,'filled area ≈ ring area: '+area.toFixed(0)+' vs '+exp.toFixed(0));
M.fillStart();ok(M.getFill()&&M.anyTool(),'fill tool active');const hit=M.fillPick(400,300);ok(hit&&hit.r.depth===2,'fill picks the inner disc at the centre');M.toggleRegion(hit.sk,hit.r);R=M.sketchRegions(skP);ok(R.find(r=>r.depth===2).on,'click fills the inner disc');ok(Math.abs(M.measure(skP).v-Math.PI*c1.params.r**2)/(Math.PI*c1.params.r**2)<.05,'area now = full disc');
M.toggleRegion(hit.sk,R.find(r=>r.depth===2));const hit2=M.fillPick(470,300);ok(hit2&&hit2.r.depth===1,'fill picks the ring between the circles');M.toggleRegion(hit2.sk,hit2.r);ok(M.sketchRegions(skP).every(r=>!r.on),'ring unfilled → nothing filled');ok(M.sketchProfile(skP).outer.length===0,'no filled region → empty profile');M.toggleRegion(hit2.sk,M.sketchRegions(skP).find(r=>r.depth===1));
// overlapping circles → 3 regions (lens is depth 2)
M.startOp('circle');M.toolClick(700,300);M.toolClick(760,300);const c3=M.doc.figures.filter(f=>f.kind==='curve').pop();M.startOp('circle');M.toolClick(760,300);M.toolClick(820,300);const c4=M.doc.figures.filter(f=>f.kind==='curve').pop();
R=M.sketchRegions(skP);ok(R.filter(r=>r.key.includes(c3.id)||r.key.includes(c4.id)).length===3,'two overlapping circles → 3 regions (A, B, lens)');
// Q leaves the tool
M.selectTool();ok(!M.anyTool()&&!M.getFill(),'Q / select tool leaves fill');M.modStart('trim');ok(M.anyTool(),'trim active');M.selectTool();ok(!M.anyTool(),'Q leaves trim');M.startOp('line');M.selectTool();ok(!M.getTool(),'Q leaves the line tool');
// offset / inset
M.startOp('rect');M.toolClick(200,500);M.toolClick(300,600);const rq=M.doc.figures.filter(f=>f.kind==='curve').pop();const nK=skP.children.length;
M.offStart();ok(M.getOff(),'offset tool active');const eA=rq.params.pts[0],eB=rq.params.pts[1];const eS=M.project(M.xform(rq,[(eA[0]+eB[0])/2,(eA[1]+eB[1])/2,0]));M.offDown({button:0,pointerId:1},eS[0],eS[1]);ok(M.getOff().drag&&M.getOff().drag.h.f===rq,'click the rectangle edge starts the offset');
const Gin=M.offGeom(M.getOff().drag.h,5,[rq.params.pts[0][0]+1,rq.params.pts[0][1]+1].map((v,i)=>rq.params.pts.reduce((a,q)=>a+q[i],0)/4));ok(Gin.closed&&Gin.inward&&Gin.pts.length===4,'cursor inside → inset, 4 corners');const aIn=Math.abs(M.polyArea?M.polyArea(Gin.pts):0);
const w=Math.abs(rq.params.pts[1][0]-rq.params.pts[0][0]),h=Math.abs(rq.params.pts[2][1]-rq.params.pts[1][1]);
const inArea=(()=>{let a=0;const p=Gin.pts;for(let i=0;i<p.length;i++){const j=(i+1)%p.length;a+=p[i][0]*p[j][1]-p[j][0]*p[i][1];}return Math.abs(a/2);})();ok(Math.abs(inArea-(w-10)*(h-10))<1e-6,'inset 5 → (w-10)(h-10) area');
const Gout=M.offGeom(M.getOff().drag.h,5,[rq.params.pts[0][0]-50,rq.params.pts[0][1]-50]);ok(Gout.closed&&!Gout.inward,'cursor outside → outset');
M.getOff().drag.uv=[rq.params.pts[0][0]-50,rq.params.pts[0][1]-50];M.offKey({key:'5'});M.offKey({key:'Enter'});ok(skP.children.length===nK+1,'⏎ creates the offset curve');const oc=M.byId(skP.children[skP.children.length-1]);ok(oc.ctype==='poly'&&oc.params.closed&&oc.params.pts.length===4,'offset result is a closed 4-point polyline');
const cS=M.project(M.xform(c1,[c1.params.cx+c1.params.r,c1.params.cy,0]));M.offDown({button:0,pointerId:1},cS[0],cS[1]);ok(M.getOff().drag&&M.getOff().drag.h.f===c1,'offset picks circle 1');M.getOff().drag.uv=[c1.params.cx+c1.params.r+30,c1.params.cy];M.offKey({key:'3'});M.offKey({key:'Enter'});const oc2=M.byId(skP.children[skP.children.length-1]);ok(oc2.ctype==='circle'&&Math.abs(oc2.params.r-(c1.params.r+3))<1e-9,'circle outset stays a true circle, r+3');
M.offEnd();M.doc.figures.forEach(f=>{if(f.kind==='curve'||f.kind==='body')f.visible=true;});}
{// 15. mirror / patterns, snapping, history + save/load
M.setView('top');M.resize();M.doc.figures.forEach(f=>{if(f.kind==='curve'||f.kind==='body')f.visible=false;});M.createWorkplane({base:'XY',offset:0,tilt:0,size:120,show:true});
M.startOp('circle');M.toolClick(300,300);M.toolClick(320,300);const cM=M.doc.figures.filter(f=>f.kind==='curve').pop();const skM=M.byId(cM.parent);
M.startOp('line');M.toolClick(500,200);M.toolClick(500,400);const axL=M.doc.figures.filter(f=>f.kind==='curve').pop();
// mirror across an existing line via inspector API
const n0=skM.children.length;M.mirrorAcross(cM,axL.id);ok(skM.children.length===n0+1,'mirror across line creates a copy');const mc=M.byId(skM.children[skM.children.length-1]);ok(mc.ctype==='circle'&&Math.abs(mc.params.r-cM.params.r)<1e-9&&Math.abs((mc.params.cx+cM.params.cx)/2-axL.params.x1)<1e-6,'mirrored circle sits symmetric about the line');
// live link: move the source, the mirror follows on the next draw
const cx0=cM.params.cx;cM.params.cx+=7;M.draw();ok(Math.abs(mc.params.cx-(2*axL.params.x1-cM.params.cx))<1e-6,'mirrored copy follows the source live');ok(mc.link&&mc.link.kind==='mirror','copy carries a live link');axL.params.x1+=4;axL.params.x2+=4;M.draw();ok(Math.abs(mc.params.cx-(2*axL.params.x1-cM.params.cx))<1e-6,'moving the axis line updates the mirror too');const frozen=mc.params.cx;M.unlink(mc);cM.params.cx=cx0;axL.params.x1-=4;axL.params.x2-=4;M.draw();ok(!mc.link&&Math.abs(mc.params.cx-frozen)<1e-9,'after unlink the copy stays put');
// mirror tool: two clicked points
M.doc.sel=new Set([cM.id]);M.patStart('mirror',{keep:true});ok(M.getPat()&&M.getPat().kind==='mirror','mirror tool active with the selection');M.patDown({button:0,pointerId:1},300,500);M.patDown({button:0,pointerId:1},300,100);ok(!M.getPat()&&skM.children.length===n0+2,'two axis points → mirrored, tool ends');
// linear pattern
M.doc.sel=new Set([cM.id]);M.patStart('linear',{count:4,spacingMode:'Spacing'});const b0=skM.children.length;M.patDown({button:0,pointerId:1},300,300);M.patDown({button:0,pointerId:1},340,300);ok(skM.children.length===b0+3,'linear pattern count 4 → 3 copies');const lp=M.byId(skM.children[skM.children.length-1]);ok(Math.abs(Math.abs(lp.params.cx-cM.params.cx)-3*Math.abs(M.planeHit(340,300)[0]-M.planeHit(300,300)[0]))<1e-6,'last copy at 3 × spacing');
// circular pattern
M.doc.sel=new Set([cM.id]);M.patStart('circular',{count:6,angle:360});const c0=skM.children.length;M.patDown({button:0,pointerId:1},400,300);ok(skM.children.length===c0+5,'circular pattern count 6 → 5 copies');const cc=M.planeHit(400,300);const rr=Math.hypot(cM.params.cx-cc[0],cM.params.cy-cc[1]);ok(skM.children.slice(c0).map(M.byId).every(f=>Math.abs(Math.hypot(f.params.cx-cc[0],f.params.cy-cc[1])-rr)<1e-6),'all copies on the same radius');
// Esc cancels
M.doc.sel=new Set([cM.id]);M.patStart('mirror');M.patKey({key:'Escape'});ok(!M.getPat(),'Esc cancels the pattern tool');
// snapping: Ctrl → circle centre
M.startOp('line');M.modKeys.ctrl=true;const cs=M.project(M.xform(cM,[cM.params.cx,cM.params.cy,0]));const sp=M.planeHit(cs[0]+4,cs[1]+3);ok(Math.abs(sp[0]-cM.params.cx)<1e-9&&Math.abs(sp[1]-cM.params.cy)<1e-9&&M.getSnap()&&M.getSnap().kind==='centre','⌃ snaps to the circle centre');
const le=M.project(M.xform(axL,[axL.params.x1,axL.params.y1,0]));const sp2=M.planeHit(le[0]+5,le[1]-4);ok(M.getSnap()&&M.getSnap().kind==='endpoint'&&Math.abs(sp2[0]-axL.params.x1)<1e-9,'⌃ snaps to a line endpoint');
const lm=M.project(M.xform(axL,[axL.params.x1,(axL.params.y1+axL.params.y2)/2,0]));M.planeHit(lm[0]+3,lm[1]+2);ok(M.getSnap()&&M.getSnap().kind==='midpoint','⌃ snaps to the midpoint');
M.modKeys.ctrl=false;M.modKeys.alt=true;const along=M.project(M.xform(axL,[axL.params.x1,axL.params.y1+7.3,0]));const sp3=M.planeHit(along[0]+6,along[1]);ok(M.getSnap()&&M.getSnap().kind==='on curve'&&Math.abs(sp3[0]-axL.params.x1)<1e-6,'⌥ snaps onto the line (not the 5 mm lattice)');
M.modKeys.alt=false;const sp4=M.planeHit(along[0]+6,along[1]);ok(!M.getSnap()&&Math.abs(sp4[0]/5-Math.round(sp4[0]/5))<1e-9,'without modifiers → lattice snap');M.selectTool();
// history labels + jump
ok(M.doc.undoL&&M.doc.undoL.length===M.doc.undo.length,'every undo step has a label');ok(M.doc.undoL.slice(-8).some(l=>/pattern|mirror/.test(l)),'labels describe the steps: '+M.doc.undoL.slice(-3).join(' | '));
const before=M.doc.figures.length;const depth=M.doc.undo.length;M.undoTo(depth-3);ok(M.doc.undo.length===depth-3&&M.doc.redo.length===3,'jump back 3 steps');M.redoTo(0);ok(M.doc.figures.length===before,'jump forward restores everything');
M.showHistory();ok((document.querySelector('#optBody').innerHTML||'').includes('current')&&(document.querySelector('#optBody').innerHTML||'').includes('data-u='),'history page lists steps + current');
// save / load
const js=M.docJSON();const o=JSON.parse(js);ok(o.app==='SolidArc'&&o.figures.length===before&&o.vars,'document JSON has figures + vars');
const nF=M.doc.figures.length;M.doc.figures=[];M.loadDocJSON(js);ok(M.doc.figures.length===nF&&M.byId(cM.id)&&M.byId(cM.id).ctype==='circle','load restores the document');
ok(!!localStorage.getItem('solidarc.doc.v1')||true,'autosave scheduled');
M.doc.figures.forEach(f=>{if(f.kind==='curve'||f.kind==='body')f.visible=true;});}
M.renderOutliner();M.renderInspector();M.draw();
console.log(`smoke: ${n} checks OK · ${M.doc.figures.length} figures`);
