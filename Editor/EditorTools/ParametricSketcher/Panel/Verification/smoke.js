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
const mod={};new Function('module',js+';\nmodule.exports={doc,build,measure,runCmd,byId,draw,view,resize,pick,startOp,toolClick,finishTool,health,renderOutliner,renderInspector,xform,createWorkplane,active_,planeHit,setView,sketchProfile};')(mod);const M=mod.exports;
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
M.renderOutliner();M.renderInspector();M.draw();
console.log(`smoke: ${n} checks OK · ${M.doc.figures.length} figures`);
