// Actual browser face selection, E shortcut and Inspector extrusion against C++.
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
const result={scope:'Actual browser mouse face selection, E and Inspector; C++ B-rep geometry. WebGL2 / SwiftShader software adapter.'};
try {
 await page.goto(process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/');await ready();
 await page.evaluate(()=>solidArc.Command(['reset','box (0,0,0) 2 2 2 --name=FaceExtrude','gizmo off','dim hide all','view iso','view fit','selectmode face']));await ready();
 await page.mouse.click(...await project([1,1,2]));await ready();
 let d=await description();assert.equal(d.faceExtrusion.count,1);assert.ok(d.faceExtrusion.available&&d.faceExtrusion.normal);
 const before=structuredClone(d.figures[0]);result.singleFaceSelected=true;
 await page.screenshot({path:folder+'SolidArcExtrudeFaceSelection.png'});
 await page.keyboard.press('e');await page.waitForSelector('#tool-dialog[open]');assert.equal(await page.locator('[name="mode"]').inputValue(),'normal');
 await page.fill('[name="distance"]','.5');await page.screenshot({path:folder+'SolidArcExtrudeNormalOptions.png'});
 await page.keyboard.press('Escape');assert.deepEqual((await description()).figures[0],before);result.cancelDoesNotChangeGeometry=true;
 await page.keyboard.press('e');await page.waitForSelector('#tool-dialog[open]');await page.fill('[name="distance"]','.5');
 await page.click('#apply-tool');await ready();d=await description();assert.equal(d.figures.length,1);assert.equal(d.figures[0].id,before.id);assert.equal(d.figures[0].high[2],2.5);assert.equal(d.figures[0].faces,10);
 result.normal={EOpensDialog:true,capAndWalls:true,result:d.figures[0]};
 await page.screenshot({path:folder+'SolidArcExtrudeNormalResult.png'});
 await page.evaluate(()=>solidArc.Command('undo'));await ready();assert.deepEqual((await description()).figures[0],before);
 await page.evaluate(()=>solidArc.Command('redo'));await ready();assert.equal((await description()).figures[0].high[2],2.5);
 await page.evaluate(()=>solidArc.Command('undo'));await ready();
 // Input fields must retain ordinary E typing, not open modelling dialogs.
 await page.focus('#scene-search');await page.keyboard.press('e');assert.equal(await page.locator('#tool-dialog[open]').count(),0);await page.fill('#scene-search','');result.typingEIsSafe=true;
 await page.keyboard.down('Shift');await page.mouse.click(...await project([1,0,1]));await page.keyboard.up('Shift');await ready();
 d=await description();assert.equal(d.faceExtrusion.count,2);assert.ok(d.faceExtrusion.available);assert.equal(d.faceExtrusion.normal,false);
 await page.screenshot({path:folder+'SolidArcExtrudeMultiSelection.png'});
 await page.click('.face-extrusion [data-tool="extrudefaces"]');
 assert.equal(await page.locator('[name="mode"]').inputValue(),'individual');assert.equal(await page.locator('[name="mode"] option[value="normal"]').evaluate(E=>E.disabled),true);
 await page.fill('[name="distance"]','.25');await page.screenshot({path:folder+'SolidArcExtrudeIndividualOptions.png'});
 await page.click('#apply-tool');await ready();d=await description();assert.deepEqual(d.figures[0].high,[2,2,2.25]);assert.deepEqual(d.figures[0].low,[0,-.25,0]);assert.equal(d.figures[0].faces,14);
 result.individual={inspectorButton:true,sharedNormalDisabledWhenIncompatible:true,result:d.figures[0]};
 await page.screenshot({path:folder+'SolidArcExtrudeIndividualResult.png'});
 await page.evaluate(()=>solidArc.Command('undo'));await ready();assert.deepEqual((await description()).figures[0].high,[2,2,2]);
 await page.evaluate(()=>solidArc.Command('redo'));await ready();assert.deepEqual((await description()).figures[0].high,[2,2,2.25]);result.singleStepUndoRedo=true;
 // E also retains existing sketch-profile extrusion and now exposes direction/sheet controls.
 await page.evaluate(()=>solidArc.Command(['reset','circle (0,0) 1 --name=Profile','select Profile']));await ready();
 await page.focus('#cad-canvas');await page.keyboard.press('e');await page.waitForSelector('#tool-dialog[open]');
 assert.equal(await page.locator('#tool-title').innerText(),'Extrude');assert.equal(await page.locator('[name="direction"]').count(),1);assert.equal(await page.locator('[name="result"]').count(),1);await page.keyboard.press('Escape');result.profileShortcutAndOptions=true;
 result.graphics=await page.evaluate(()=>solidArcGraphics);assert.equal(result.graphics.rgbaUploads,0);assert.deepEqual(errors,[]);result.errors=errors;
 await writeFile(folder+'SolidArcExtrudeProof.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
