// Reproduce the user's actual journal in an isolated browser session on the live server.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];let session;
page.on('request',r=>{session=r.headers()['x-solidarc-session']||session;});
page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail&&!solidArc.Bevel?.PumpPromise);
const folder='Exhibits/Gallery/Editor/';
const desc=()=>page.evaluate(()=>structuredClone(solidArc.Description));
const command=async C=>{await page.evaluate(C=>solidArc.Command(C),C);await ready();};
const project=P=>page.evaluate(P=>{const m=solidArc.Flow.Base.frame.view.ViewClip,r=document.querySelector('#cad-canvas').getBoundingClientRect();const q=[0,1,2,3].map(i=>m[i]*P[0]+m[i+4]*P[1]+m[i+8]*P[2]+m[i+12]);return[r.x+(q[0]/q[3]+1)*r.width/2,r.y+(q[1]/q[3]+1)*r.height/2];},P);
const value=async V=>{await page.locator('#bevel-size').fill(V);await ready();};
const screenshot=async Name=>page.screenshot({path:folder+Name});
const detail=async Name=>{
 const camera=(await desc()).camera;
 await page.evaluate(C=>solidArc.Request('render',{camera:C}),{...camera,pivot:[-4.01,2.04,6.82],distance:1.35});await ready();await screenshot(Name);
 await page.evaluate(camera=>solidArc.Request('render',{camera}),camera);await ready();
};
const result={scope:'Isolated copy of exact user journal; actual mouse arc/line picks, B, numeric units, Apply/history. Live server 8081 / native shared C++ 8083. WebGL2 SwiftShader software, not a physical GPU.',fixture:process.env.SOLIDARC_CORNER_FIXTURE||'Experimental/SolidArc/Native/Fixtures/MixedCapCorner.arc'};
try{
 await page.goto(process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/');await ready();
 const text=await readFile(result.fixture,'utf8');const opened=await page.evaluate(text=>solidArc.Request('open',{text}),text);assert.equal(opened.success,true);await ready();
 let d=await desc();const id=d.figures.findLast(f=>f.kind==='body').id;assert.equal(d.figures.find(f=>f.id===id).bevelFeatures.length,2);
 await command([`isolate ${id}`,'gizmo off','dim hide all','view iso','view fit','selectmode edge','select none']);
 const X=-4.055601217,Y=1.873156718,Z=6.965422166246238,R=.2582021677;
 await page.mouse.click(...await project([X,Y+R*(1-Math.SQRT1_2),Z-R*(1-Math.SQRT1_2)]));await ready();
 assert.deepEqual((await desc()).figures.find(f=>f.id===id).pickedEdges,[14]);result.arcMousePick=true;
 await page.keyboard.down('Shift');await page.mouse.click(...await project([X,(4.463490499+Y+R)/2,Z]));await page.keyboard.up('Shift');await ready();
 assert.deepEqual((await desc()).figures.find(f=>f.id===id).pickedEdges,[14,15]);result.shiftLineMousePick=true;
 const before=await desc();await screenshot('SolidArcCornerSelected.png');await page.keyboard.press('b');await ready();assert.equal((await desc()).bevel.valid,true);result.BStartsMixedPreview=true;
 await value('20.2791507347mm');d=await desc();assert.equal(d.bevel.valid,true);assert.ok(Math.abs(d.bevel.size-.0202791507347)<1e-12);assert.deepEqual(d.figures,before.figures);assert.deepEqual(d.history,before.history);result.unitsAndNonDestructivePreview=true;await screenshot('SolidArcCornerRoundPreview.png');
 await page.locator('#bevel-apply').click();await ready();d=await desc();let f=d.figures.find(f=>f.id===id);assert.deepEqual([f.faces,f.edges,f.vertices],[11,25,16]);assert.equal(f.bevelFeatures.length,3);assert.equal(f.bevelFeatures[2].mode,'fillet');assert.equal(d.history.length,before.history.length+1);result.mouseApplyThirdRoundFeature=true;await screenshot('SolidArcCornerRound.png');await detail('SolidArcCornerRoundDetail.png');
 const round=structuredClone(d.figures),saved=await page.evaluate(async()=>{const r=await solidArc.Request('save');return r.file;});
 await command(['undo']);assert.deepEqual((await desc()).figures,before.figures);await command(['redo']);assert.deepEqual((await desc()).figures,round);result.oneStepUndoRedo=true;
 await page.locator('#history-strip [data-bevel-feature="3"]').click();await ready();assert.equal((await desc()).bevel.feature,3);await value('-20.2791507347mm');assert.equal((await desc()).bevel.valid,true);await screenshot('SolidArcCornerFlatPreview.png');await page.keyboard.press('Enter');await ready();
 d=await desc();f=d.figures.find(f=>f.id===id);assert.equal(f.bevelFeatures.length,3);assert.equal(f.bevelFeatures[2].mode,'chamfer');result.sameHistoryFeatureFlatChamfer=true;await screenshot('SolidArcCornerFlat.png');await detail('SolidArcCornerFlatDetail.png');
 const flat=structuredClone(d.figures);await page.locator('#inspector-body [data-bevel-feature="3"]').click();await ready();await value('-200mm');assert.equal((await desc()).bevel.valid,false);assert.equal(await page.locator('#bevel-apply').isDisabled(),true);await screenshot('SolidArcCornerRefused.png');await page.keyboard.press('Escape');await ready();assert.deepEqual((await desc()).figures,flat);result.oversizeDisabledAndCancelAtomic=true;
 await page.locator('#inspector-body [data-bevel-feature="2"]').click();await ready();await value('180mm');assert.equal((await desc()).bevel.valid,true);await page.keyboard.press('Enter');await ready();f=(await desc()).figures.find(f=>f.id===id);assert.deepEqual(f.bevelFeatures.map(b=>b.size),[.2582021677,.18,.0202791507347]);result.earlierFeatureReplaysMixedRim=true;
 await command(['reset']);const reopened=await page.evaluate(text=>solidArc.Request('open',{text}),saved);await ready();assert.equal(reopened.success,true);assert.deepEqual((await desc()).figures,round);result.saveReopenThirdFeature=true;
 result.graphics=await page.evaluate(()=>solidArcGraphics);assert.equal(result.graphics.rgbaUploads,0);assert.equal(result.graphics.cpuFragments,0);assert.deepEqual(errors,[]);result.errors=errors;result.pass=true;
 await writeFile(folder+'SolidArcBrowserCornerProof.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(E){await screenshot('SolidArcCornerFailure.png');console.error('State',await desc());throw E;}finally{await browser.close();if(session)await fetch((process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/').replace(/\/gpu\/?$/,'/native'),{method:'DELETE',headers:{'X-SolidArc-Session':session}});}
