// Selection/Inspector/Loft proof against real C++ geometry and actual browser mouse input.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
const folder='Exhibits/Gallery/Editor/';
const description=()=>page.evaluate(()=>structuredClone(solidArc.Description));
const project=P=>page.evaluate(P=>{
 const m=solidArc.Flow.Base.frame.view.ViewClip,r=document.querySelector('#cad-canvas').getBoundingClientRect();
 const q=[0,1,2,3].map(i=>m[i]*P[0]+m[i+4]*P[1]+m[i+8]*P[2]+m[i+12]);
 return [r.x+(q[0]/q[3]+1)*r.width/2,r.y+(q[1]/q[3]+1)*r.height/2];
},P);
const result={scope:'Actual browser bottom-toolbar and viewport mouse clicks; exact native C++ sketch edits. WebGL2 / software SwiftShader.'};
const tool=Key=>page.locator(`[data-sketch-tool="${Key}"]`);
try {
 await page.goto(process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/');await ready();
 assert.equal(await tool('cut').isDisabled(),true);assert.equal(await tool('trim').isDisabled(),true);result.emptyToolsDisabled=true;
 await page.evaluate(()=>solidArc.Command(['draw line (-3,0,0) (3,0,0)','gizmo off','dim hide all','view top','view fit']));await ready();
 const before=(await description()).figures;
 assert.equal(await tool('cut').isEnabled(),true);assert.equal(await tool('trim').isDisabled(),true);result.noCrossingsTrimDisabled=true;
 await tool('cut').click();assert.equal(await tool('cut').getAttribute('aria-pressed'),'true');assert.deepEqual((await description()).figures,before);
 await page.screenshot({path:folder+'SolidArcCutTool.png'});
 // A drag must never perform an unintended cut.
 const centre=await project([0,0,0]);await page.mouse.move(...centre);await page.mouse.down();await page.mouse.move(centre[0]+30,centre[1],{steps:4});await page.mouse.up();await ready();assert.deepEqual((await description()).figures,before);result.dragDoesNotEdit=true;
 // Alt-drag keeps upright navigation available while the editing tool is armed.
 const yaw=(await description()).camera.yaw;
 await page.keyboard.down('Alt');await page.mouse.move(...centre);await page.mouse.down();await page.mouse.move(centre[0]+50,centre[1]+25,{steps:5});await page.mouse.up();await page.keyboard.up('Alt');await ready();
 assert.deepEqual((await description()).figures,before);assert.ok(Math.abs((await description()).camera.yaw-yaw)>.01);result.navigationWhileArmed=true;
 await page.evaluate(()=>solidArc.Command(['view top','view fit'],false));await ready();
 await page.mouse.click(...await project([0,0,0]));await ready();let d=await description();assert.equal(d.figures.length,2);assert.ok(d.figures.every(F=>F.selected));assert.ok(Math.abs(d.figures[0].high[0])<.02);assert.ok(Math.abs(d.figures[1].low[0])<.02);
 result.cut={exactPieces:d.figures.length,selectedPieces:d.figures.filter(F=>F.selected).length};
 await page.screenshot({path:folder+'SolidArcCutResult.png'});
 await page.evaluate(()=>solidArc.Command('undo'));await ready();assert.deepEqual((await description()).figures,before);
 await page.evaluate(()=>solidArc.Command('redo'));await ready();assert.equal((await description()).figures.length,2);result.cutUndoRedo=true;
 await page.keyboard.press('Escape');assert.equal(await tool('select').getAttribute('aria-pressed'),'true');
 const count=(await description()).figures.length;await page.mouse.click(...await project([1.5,0,0]));await ready();assert.equal((await description()).figures.length,count);result.EscapeExits=true;
 await page.evaluate(()=>solidArc.Command(['reset','draw line (-3,0,0) (3,0,0)','draw line (-1,-2,0) (-1,2,0)','draw line (1,-2,0) (1,2,0)','gizmo off','dim hide all','view top','view fit']));await ready();
 const original=(await description()).figures;
 assert.equal(await tool('trim').isEnabled(),true);await tool('trim').click();assert.deepEqual((await description()).figures,original);
 await page.screenshot({path:folder+'SolidArcTrimTool.png'});
 await page.mouse.click(...await project([0,0,0]));await ready();d=await description();assert.equal(d.figures.length,4);
 const pieces=d.figures.filter(F=>F.selected);assert.equal(pieces.length,2);assert.ok(Math.abs(pieces[0].high[0]+1)<1e-6);assert.ok(Math.abs(pieces[1].low[0]-1)<1e-6);assert.deepEqual(d.figures.slice(1,3),original.slice(1,3));
 result.trim={survivingPieces:2,boundariesPreserved:true};await page.screenshot({path:folder+'SolidArcTrimResult.png'});
 await page.evaluate(()=>solidArc.Command('undo'));await ready();assert.deepEqual((await description()).figures,original);
 await page.evaluate(()=>solidArc.Command('redo'));await ready();assert.equal((await description()).figures.length,4);result.trimUndoRedo=true;
 await tool('select').click();assert.equal(await tool('select').getAttribute('aria-pressed'),'true');result.selectExits=true;
 await page.evaluate(()=>solidArc.Command(['reset','circle (0,0,0) 2','gizmo off','dim hide all','view top','view fit']));await ready();await tool('cut').click();await page.mouse.click(...await project([0,2,0]));await ready();d=await description();assert.equal(d.figures.length,2);assert.ok(d.figures.every(F=>F.kind==='arc'));result.circleRemainsExactArcs=true;
 await tool('select').click();await page.evaluate(()=>solidArc.Flow.Start('line'));
 assert.equal(await tool('cut').isDisabled(),true);assert.equal(await tool('trim').isDisabled(),true);
 await page.keyboard.press('Escape');assert.equal(await tool('cut').isEnabled(),true);result.drawingModeProtected=true;
 result.graphics=await page.evaluate(()=>solidArcGraphics);assert.equal(result.graphics.rgbaUploads,0);assert.equal(result.graphics.cpuFragments,0);assert.deepEqual(errors,[]);result.errors=errors;
 await writeFile(folder+'SolidArcSketchToolsProof.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(E){console.error('STATE',await page.evaluate(()=>({Ready:solidArc.Ready,Busy:solidArc.Busy,Motion:solidArc.Motion,Detail:solidArc.ResolveDetail,Drag:solidArc.ViewDrag,Tool:solidArc.SketchTool,Pending:[...solidArc.Pending.keys()],Queue:solidArc.NavigationQueue,Log:solidArc.Log.slice(-8)})),errors);throw E;}finally{await browser.close();}
