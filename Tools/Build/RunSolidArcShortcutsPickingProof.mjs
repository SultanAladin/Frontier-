import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1800,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
const command=async commands=>{const r=await page.evaluate(c=>solidArc.Command(c,false),commands);await ready();assert.ok(r.success);return r;};
const project=P=>page.evaluate(P=>{const m=solidArc.Flow.Base.frame.view.ViewClip,r=document.querySelector('#cad-canvas').getBoundingClientRect();const q=[0,1,2,3].map(i=>m[i]*P[0]+m[i+4]*P[1]+m[i+8]*P[2]+m[i+12]);return[r.x+(q[0]/q[3]+1)*r.width/2,r.y+(q[1]/q[3]+1)*r.height/2];},P);
const order=()=>page.evaluate(()=>solidArc.Description.selectionOrder);
const record={renderer:'HTML WebGL2 ID/depth picking + native C++ geometry; SwiftShader software driver'};
try{
 await page.goto('http://127.0.0.1:8081/gpu/?example=booleans3d');await ready();
 await page.keyboard.press('Control+a');assert.equal(await page.locator('#construct-menu').evaluate(e=>e.matches(':popover-open')),true);await page.keyboard.press('Escape');
 await page.locator('#scene-search').fill('First');await page.keyboard.press('Control+a');assert.equal(await page.locator('#construct-menu').evaluate(e=>e.matches(':popover-open')),false);assert.equal(await page.locator('#scene-search').evaluate(e=>e.selectionEnd-e.selectionStart),5);await page.locator('#scene-search').fill('');await page.locator('#cad-canvas').focus();
 const download=page.waitForEvent('download');await page.keyboard.press('Control+s');const saved=await download;assert.ok(saved.suggestedFilename().endsWith('.arc'));await ready();record.ctrlSSave=true;record.ctrlAConstructAndTextSelection=true;
 await command(['reset','box (-4,-1,0) (-2,1,1)','box (-1,-1,0) (1,1,1)','box (2,-1,0) (4,1,1)','gizmo off','dim off','view top','view fit','select none']);
 await page.locator('[data-figure="1"]').click();await ready();await page.locator('[data-figure="3"]').click({modifiers:['Shift']});await ready();assert.deepEqual(await order(),[1,3]);await page.locator('[data-figure="2"]').click({modifiers:['Control']});await ready();assert.deepEqual(await order(),[1,3,2]);await page.locator('[data-figure="2"]').click({modifiers:['Control']});await ready();assert.deepEqual(await order(),[1,3]);record.ctrlShiftOutliner=true;
 await command('select none');await page.mouse.click(...await project([-3,0,1]));await ready();await page.keyboard.down('Control');await page.mouse.click(...await project([3,0,1]));await page.keyboard.up('Control');await ready();assert.deepEqual(await order(),[1,3]);await page.keyboard.down('Control');await page.mouse.click(...await project([3,0,1]));await page.keyboard.up('Control');await ready();assert.deepEqual(await order(),[1]);record.ctrlViewportGpuPicking=true;await page.keyboard.down('Shift');await page.mouse.click(...await project([3,0,1]));await page.keyboard.up('Shift');await ready();assert.deepEqual(await order(),[1,3]);record.shiftViewportGpuPicking=true;
 await command(['reset','box (-2,-2,0) (2,2,2)','box (-1,-1,2) (1,1,4)','select #1 #2','view iso','view fit']);
 await page.locator('.ordered-selection [data-tool="union"]').click();await page.locator('#apply-tool').click();await page.waitForFunction(()=>!document.querySelector('#tool-dialog').open);await ready();
 let r=await command('topology '+await page.evaluate(()=>solidArc.Description.figures[0].id)+' --summary');const line=r.lines.find(l=>l.includes('closed yes manifold yes oriented yes'));assert.ok(line.includes('hulls 1'));assert.ok(line.includes('volume 40.000000'));assert.ok(line.includes('area 80.000000'));record.partialFaceStackUnion=line;
 await page.screenshot({path:'Exhibits/Gallery/Editor/EditorProof_SolidArc_HtmlStackedUnion.png'});
 await command('undo');assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),2);
 await page.locator('.ordered-selection [data-tool="subtract"]').click();await page.locator('#apply-tool').click();await page.waitForFunction(()=>!document.querySelector('#tool-dialog').open);await ready();r=await command('topology '+await page.evaluate(()=>solidArc.Description.figures[0].id)+' --summary');assert.ok(r.lines.some(l=>l.includes('volume 32.000000')));record.faceContactSubtractUnchanged=true;
 record.graphics=await page.evaluate(()=>solidArcGraphics);assert.equal(record.graphics.rgbaUploads,0);assert.deepEqual(errors,[]);record.errors=errors;
 await writeFile('Exhibits/Gallery/Editor/SolidArcHtmlShortcutsPickingProof.json',JSON.stringify(record,null,2));console.log(JSON.stringify(record,null,2));
}finally{await page.evaluate(()=>solidArc?.Worker?.terminate()).catch(()=>{});await browser.close();}
