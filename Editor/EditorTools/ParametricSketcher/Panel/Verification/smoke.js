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
const mod={};new Function('module',js+';\nmodule.exports={doc,build,measure,runCmd,byId,draw,view,resize,pick,startOp,toolClick,finishTool,health,renderOutliner,renderInspector,xform,createWorkplane,active_,planeHit,setView,sketchProfile,gz,drawGizmo,gzHit,gzBegin,gzUpdate,gzEnd,modalStart,modalApply,modalConfirm,modalCancel,rotMat,eulerFromMat,project,gzTarget,setGzMode,gzPivot,gzSetValue,drawLiveDims,shapeFrom,loopOf,curveLines};')(mod);const M=mod.exports;
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
M.startOp('polygon');M.toolClick(300,300);M.toolClick(330,300);
M.startOp('polyline');M.toolClick(200,200);M.toolClick(260,200);M.toolClick(260,260);M.finishTool();
M.startOp('line');M.toolClick(100,100);M.toolClick(150,120);
M.startOp('arc');M.toolClick(600,500);M.toolClick(640,500);M.toolClick(600,540);
M.startOp('ellipse');M.toolClick(700,300);M.toolClick(760,300);M.toolClick(700,330);
M.startOp('slot');M.toolClick(100,500);M.toolClick(200,500);
M.startOp('spoint');M.toolClick(50,50);
sk=M.byId(sk.id);ok(sk.children.length===9,'9 curves in sketch, got '+sk.children.length);
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
M.setView('top');M.resize();['circle','rect','line','arc','ellipse','polygon','slot'].forEach(id=>{M.startOp(id);M.toolClick(400,300);M.toolClick(460,300);M.draw();ok(true,'live dims '+id);M.finishTool();});
// 8. curves move individually (not the whole sketch); pick selects the curve; fill loops; resolution multiplier
M.setView('top');M.resize();M.doc.figures.filter(f=>f.kind==='curve'||f.kind==='body').forEach(f=>f.visible=false);M.active_.plane=M.doc.figures.find(f=>f.kind==='plane'&&f.axis==='XY').id;M.active_.sketch=null;M.startOp('circle');M.toolClick(300,300);M.toolClick(340,300);M.startOp('circle');M.toolClick(520,430);M.toolClick(540,430);
const cs=M.doc.figures.filter(f=>f.kind==='curve'&&f.ctype==='circle'&&f.visible);ok(cs.length===2,'two fresh circles, got '+cs.length);const [cA,cB]=cs;
M.doc.sel.clear();M.pick(300,300,false);ok(M.doc.sel.has(cA.id)&&M.doc.sel.size===1,'clicking inside a filled circle selects that curve, not the sketch');
M.finishTool();M.doc.sel=new Set([cA.id]);M.setGzMode('rotate');ok(M.gz.handles.filter(h=>h.type==='rotate').length===2&&M.gz.handles.every(h=>h.axis==='z'||h.axis==='view'),'curve rotate: normal + view rings only, got '+M.gz.handles.map(h=>h.axis));M.setGzMode('translate');ok(M.gzTarget()===cA,'gizmo targets the curve');const hcx=M.gz.handles.find(h=>h.type==='translate'&&h.axis==='x');ok(!!hcx&&!M.gz.handles.some(h=>h.axis==='z'&&h.type==='translate'),'curve gizmo: in-plane cones only');
const pa0=[...cA.pos],pb0=[...cB.pos];M.gzBegin(hcx,hcx.sx,hcx.sy);M.gzUpdate(hcx.sx+40,hcx.sy,false);M.gzEnd();
ok(Math.abs(cA.pos[0]-pa0[0])>1&&Math.abs(cA.pos[1]-pa0[1])<1e-9,'curve moved along its plane u axis');ok(cB.pos[0]===pb0[0]&&cB.pos[1]===pb0[1],'sibling curve did not move');
const wc=M.xform(cA,[cA.params.cx,cA.params.cy,0]);ok(Math.abs(wc[0]-(cA.params.cx+cA.pos[0]))<1e-6,'xform applies curve-local offset');
const n1=M.curveLines(cA).lines.length;M.doc.curveRes=2;const n2=M.curveLines(cA).lines.length;M.doc.curveRes=1;ok(n2===2*n1,'curve resolution multiplier doubles segments');
cA.segs=128;ok(M.curveLines(cA).lines.length===128,'per-curve segments override');delete cA.segs;
M.startOp('arc');M.toolClick(600,500);M.toolClick(640,500);M.toolClick(600,540);const arc=M.doc.figures.filter(f=>f.ctype==='arc').pop();ok(M.loopOf(arc)===null,'open arc has no loop');arc.params.closed=true;ok(M.loopOf(arc)&&M.loopOf(arc).length>8,'closed arc becomes a fillable loop');
M.renderOutliner();M.renderInspector();M.draw();
console.log(`smoke: ${n} checks OK · ${M.doc.figures.length} figures`);
