// Actual browser mouse/key interaction over shared native C++ bevel features.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail&&!solidArc.Bevel?.PumpPromise);
const folder='Exhibits/Gallery/Editor/';
const description=()=>page.evaluate(()=>structuredClone(solidArc.Description));
const project=P=>page.evaluate(P=>{const m=solidArc.Flow.Base.frame.view.ViewClip,r=document.querySelector('#cad-canvas').getBoundingClientRect();const q=[0,1,2,3].map(i=>m[i]*P[0]+m[i+4]*P[1]+m[i+8]*P[2]+m[i+12]);return [r.x+(q[0]/q[3]+1)*r.width/2,r.y+(q[1]/q[3]+1)*r.height/2];},P);
const fixture=async Commands=>{await page.evaluate(C=>solidArc.Command(C),Commands);await ready();};
const value=async Text=>{await page.locator('#bevel-size').fill(Text);await ready();};
const result={scope:'Actual browser mouse selection, B, signed pointer preview, numeric/units, editable native features. WebGL2 software SwiftShader; no physical GPU claim.'};
try{
 await page.goto(process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/');await ready();
 await page.keyboard.press('b');await ready();assert.equal((await description()).bevel.active,false);result.emptyRefuses=true;
 await fixture(['reset','box (0,0,0) (4,4,4) --name=BeveledBody','gizmo off','dim hide all','view iso','view fit','selectmode edge']);
 await page.mouse.click(...await project([2,0,4]));await ready();
 let d=await description();assert.equal(d.figures[0].pickedEdges.length,1);result.mouseBodyEdge=true;
 const before=structuredClone(d);await page.keyboard.press('b');await ready();d=await description();assert.equal(d.bevel.active,true);assert.equal(d.bevel.valid,true);assert.deepEqual(d.figures,before.figures);assert.deepEqual(d.history,before.history);result.BStartsNonDestructivePreview=true;
 await page.screenshot({path:folder+'SolidArcBevel3DPreview.png'});
 const pointer=await page.evaluate(()=>{const r=document.querySelector('#cad-canvas').getBoundingClientRect();return {x:solidArc.Bevel.OriginX,y:r.y+80};});
 await page.mouse.move(pointer.x+25,pointer.y);await ready();assert.equal((await description()).bevel.chamfer,false);
 await page.mouse.move(pointer.x-25,pointer.y);await ready();assert.equal((await description()).bevel.chamfer,true);result.signedPointerSwitchesMode=true;
 await page.keyboard.type('250mm');await ready();result.typeWithoutFieldClick=true;d=await description();assert.equal(d.bevel.size,.25);assert.equal(d.bevel.chamfer,false);assert.equal(d.bevel.valid,true);result.numericUnits=true;
 await page.locator('#bevel-apply').click();await ready();d=await description();assert.equal(d.figures[0].id,before.figures[0].id);assert.equal(d.figures[0].bevelFeatures.length,1);assert.equal(d.figures[0].bevelFeatures[0].mode,'fillet');assert.equal(d.history.length,before.history.length+1);result.commitOneUndoStep=true;
 await page.screenshot({path:folder+'SolidArcBevel3DResult.png'});
 await page.locator('#history-strip [data-bevel-feature="1"]').click();await ready();assert.equal((await description()).bevel.feature,1);result.historyStripOpensFeature=true;
 await value('-350mm');assert.equal((await description()).bevel.chamfer,true);await page.screenshot({path:folder+'SolidArcBevelHistoryEdit.png'});
 await page.keyboard.press('Enter');await ready();d=await description();assert.equal(d.bevel.active,false);assert.equal(d.figures[0].bevelFeatures.length,1);assert.equal(d.figures[0].bevelFeatures[0].size,.35);assert.equal(d.figures[0].bevelFeatures[0].mode,'chamfer');result.editExistingFeature=true;
 await fixture(['undo']);assert.equal((await description()).figures[0].bevelFeatures[0].mode,'fillet');await fixture(['redo']);assert.equal((await description()).figures[0].bevelFeatures[0].mode,'chamfer');result.undoRedoFeatureEdit=true;
 await page.locator('#inspector-body [data-bevel-feature="1"]').click();await ready();await value('-100m');assert.equal((await description()).bevel.valid,false);assert.equal(await page.locator('#bevel-apply').isDisabled(),true);await page.screenshot({path:folder+'SolidArcBevelRefusal.png'});await page.keyboard.press('Escape');await ready();assert.equal((await description()).figures[0].bevelFeatures[0].size,.35);result.invalidDisabledAndEscapeExact=true;
 await fixture(['reset','rect (0,0,0) (4,4,0) --name=Sketch','select Sketch','gizmo off','dim hide all','view top','view fit','selectmode control']);
 await page.mouse.click(...await project([0,0,0]));await ready();d=await description();assert.ok(d.figures[0].pickedPoles.length>0);result.mouseSketchCorner=true;
 await page.keyboard.press('b');await ready();assert.equal((await description()).bevel.active,true);await value('-200mm');assert.equal((await description()).bevel.valid,true);await page.screenshot({path:folder+'SolidArcBevel2DPreview.png'});
 await page.keyboard.press('Enter');await ready();d=await description();assert.equal(d.figures[0].bevelFeatures[0].count,1);result.onlyPickedCorner=true;await page.screenshot({path:folder+'SolidArcBevel2DResult.png'});
 // Independent second bevel; modifying the first must replay the second.
 const id=d.figures[0].id;await fixture([`beveladd .25 --mode=chamfer --targets=${id}:c3`]);
 await page.locator('#inspector-body [data-bevel-feature="1"]').click();await ready();await value('-300mm');assert.equal((await description()).bevel.valid,true);await page.keyboard.press('Enter');await ready();d=await description();assert.deepEqual(d.figures[0].bevelFeatures.map(B=>B.size),[.3,.25]);result.multipleFeaturesReplay=true;await page.screenshot({path:folder+'SolidArcBevelMultipleHistory.png'});
 const Saved=await page.evaluate(async()=>{const R=await solidArc.Request('save');return R.file;});assert.match(Saved,/beveledit/);await fixture(['reset']);await page.evaluate(Text=>solidArc.Request('open',{text:Text}),Saved);await ready();assert.deepEqual((await description()).figures[0].bevelFeatures.map(B=>B.size),[.3,.25]);result.saveReopenEditable=true;
 result.graphics=await page.evaluate(()=>solidArcGraphics);assert.equal(result.graphics.rgbaUploads,0);assert.equal(result.graphics.cpuFragments,0);assert.deepEqual(errors,[]);result.errors=errors;
 await writeFile(folder+'SolidArcBevelProof.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(E){await page.screenshot({path:folder+'SolidArcBevelFailure.png'});console.error('State',await description());throw E;}finally{await browser.close();}
