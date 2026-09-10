// Headless smoke test for Panel/index.html: node Verification/smoke.js
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const js=html.match(/<script>([\s\S]*)<\/script>/)[1];
const els={};
function mkEl(id){return {id,style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},dataset:{},innerHTML:'',textContent:'',value:'',
  getBoundingClientRect(){return{left:0,top:0,width:900,height:700}},querySelector(){return mkEl()},querySelectorAll(){return[]},addEventListener(){},setPointerCapture(){},appendChild(){},removeAttribute(){},replaceWith(){},focus(){},select(){},
  getContext(){return new Proxy({},{get:(t,k)=>k==='measureText'?()=>({width:10}):k==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}})},width:0,height:0,parentElement:null};}
global.document={querySelector:s=>els[s]||(els[s]=mkEl(s)),querySelectorAll:()=>[],createElement:()=>mkEl(),getElementById:()=>null};
global.ResizeObserver=class{observe(){}};global.localStorage={getItem:()=>null,setItem(){},removeItem(){}};global.innerWidth=1600;global.innerHeight=900;
global.addEventListener=()=>{};global.location={search:process.argv.includes('--demo')?'?demo':''};global.URLSearchParams=class{constructor(q){this.q=q}has(k){return this.q.includes(k)}};global.devicePixelRatio=1;global.performance={now:()=>0};global.requestAnimationFrame=()=>{};
const mod={};new Function('module',js+';\nmodule.exports={doc,build,measure,runCmd,byId,draw,view,resize,pick,startOp,toolClick,finishTool,health,renderOutliner,renderInspector,xform,createWorkplane,active_,planeHit,setView,sketchProfile,gz,drawGizmo,gzHit,gzBegin,gzUpdate,gzEnd,modalStart,modalApply,modalConfirm,modalCancel,rotMat,eulerFromMat,project,gzTarget,setGzMode,gzPivot,gzSetValue,drawLiveDims,shapeFrom,loopOf,curveLines,getTool:()=>tool,topo,pickSub,selectSub,sub_,subBegin,subApply,subEnd,subVertices,planarLoop,loopScreen,setModes,offsetPolyline,delSub,health,addConstraint,removeConstraint,solveSketch,evalExpr,setVar,refreshDims,dimStart,dimPickAt,dimPlaceUpdate,dimCommit,getDimTool:()=>dimTool,dimGeom,residuals,dofMap,applyConstraint,isSlot,regenSlot,setDimName,topo,planeBasis,invalidateXf,gzTarget};')(mod);const M=mod.exports;
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
M.renderOutliner();M.renderInspector();M.draw();
console.log(`smoke: ${n} checks OK · ${M.doc.figures.length} figures`);
