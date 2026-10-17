// Regression for the user's real Z-gizmo / coplanar-side boolean refusal.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1800,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
const command=async commands=>{const r=await page.evaluate(c=>solidArc.Command(c,false),commands);await ready();assert.ok(r.success);return r;};
const folder='Exhibits/Gallery/Editor/';
const report={scope:'HTML actual Outliner selection / Apply; native C++ analytic B-rep solver. Includes actual mouse Z-gizmo drag and recorded user matrices.',cases:[]};
try{
 await page.goto('http://127.0.0.1:8081/gpu/?example=booleans3d');await page.waitForFunction(()=>window.solidArc?.Description.figures.length===2);await ready();
 for(const source of ['gizmo',0.88750930276237883,1.2890083800837226]){
  for(const operation of ['union','subtract','intersect']){
   await command(['reset','box (0,0,0) (4,3,2) --name=FirstBody','box (2,0,0) (6,3,2) --name=SecondBody','view iso','view fit','dim off','show cages off','selectmode whole']);
   await page.locator('[data-figure="2"]').click();await ready();
   if(source==='gizmo'){
    await page.locator('#gizmo-mode').selectOption('translate');await ready();
    const point=await page.evaluate(()=>{const g=solidArc.Description.gizmo.grips.find(g=>g.id===3),r=document.querySelector('#cad-canvas').getBoundingClientRect();if(!g)throw Error('Z grip absent');return[r.x+g.u*r.width,r.y+g.v*r.height];});
    await page.mouse.move(...point);await page.mouse.down();await page.mouse.move(point[0],point[1]-55,{steps:8});await page.mouse.up();await ready();
   }else await command(`transform selected 1 0 0 0 0 1 0 0 0 0 1 0 0 0 ${source} 1`);
   const before=await page.evaluate(()=>structuredClone(solidArc.Description.figures));
   const dz=before.find(f=>f.id===2).low[2];assert.ok(dz>0&&dz<2,`Z drag: ${dz}`);
   await page.locator('[data-figure="1"]').click({modifiers:['Shift']});await ready();
   assert.deepEqual(await page.evaluate(()=>solidArc.Description.selectionOrder),[2,1]);
   for(const key of ['union','subtract','intersect'])assert.equal(await page.locator(`.ordered-selection [data-tool="${key}"]`).isDisabled(),false,`${key} unavailable after ${source} Z move`);
   if(source==='gizmo'&&operation==='union')await page.screenshot({path:folder+'EditorProof_SolidArc_ZDraggedEnabled.png'});
   await page.locator(`.ordered-selection [data-tool="${operation}"]`).click();await page.locator('#apply-tool').click();await page.waitForFunction(()=>!document.querySelector('#tool-dialog').open);await ready();
   const figures=await page.evaluate(()=>solidArc.Description.figures);assert.equal(figures.length,1);
   let r=await command(`topology #${figures[0].id} --summary`),line=r.lines.find(l=>l.includes('closed yes manifold yes oriented yes'));
   assert.ok(line);assert.ok(line.includes('hulls 1'));const volume=Number(line.match(/volume\s+([\d.eE+-]+)/)[1]);const common=6*(2-dz),expected=operation==='union'?48-common:operation==='subtract'?24-common:common;assert.ok(Math.abs(volume-expected)<.00001,`${volume} != ${expected}`);
   if(source==='gizmo')await page.screenshot({path:folder+`EditorProof_SolidArc_ZDragged${operation}.png`});
   await command('undo');assert.deepEqual(await page.evaluate(()=>solidArc.Description.figures),before.map(f=>({...f,selected:1,selectionOrder:f.id===2?1:2})));
   await command('redo');assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),1);
   // The geometry suite separately verifies persisted journal reopen for all exact-matrix cases.
   report.cases.push({source,dz,operation,volume,expected,allThreeEnabled:true,mouseApply:true,undoRedo:true});
  }
 }
 assert.deepEqual(errors,[]);report.errors=errors;report.graphics=await page.evaluate(()=>solidArcGraphics);assert.equal(report.graphics.rgbaUploads,0);
 await writeFile(folder+'SolidArcZDraggedBooleansProof.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await page.evaluate(()=>solidArc?.Worker?.terminate()).catch(()=>{});await browser.close();}
