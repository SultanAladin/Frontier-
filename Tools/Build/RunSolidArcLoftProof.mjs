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
const result={scope:'Actual browser mouse selection and Inspector loft. Native C++ commands; WebGL2 / SwiftShader software raster.'};
try {
 await page.goto(process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/');await ready();
 await page.evaluate(()=>solidArc.Command(['reset','circle (0,0,0) 1 --name=Bottom','circle (0,0,3) .6 --name=Top','gizmo off','dim hide all','view iso','view fit']));await ready();
 const ids=(await description()).figures.map(F=>F.id);
 // Select against creation order. This must not be sorted back into document order.
 await page.click(`[data-figure="${ids[1]}"]`);await ready();
 await page.click(`[data-figure="${ids[0]}"]`,{modifiers:['Shift']});await ready();
 let d=await description();assert.deepEqual(d.selectionOrder,ids.slice().reverse());assert.equal(d.activeSelection,ids[0]);
 assert.deepEqual(d.selectionOperations.map(O=>O.key),['loft','sweep','ruled']);
 assert.equal(await page.locator('.ordered-selection [data-tool="loft"]').count(),1);
 assert.equal(await page.locator('.ordered-selection [data-tool="fillet"]').count(),0);
 assert.equal(await page.locator('.ordered-selection .active-operand').innerText().then(T=>T.includes('Bottom')),true);
 result.outlinerSelection={order:d.selectionOrder,active:d.activeSelection,operations:d.selectionOperations};
 await page.screenshot({path:folder+'SolidArcLoftSelection.png'});
 await page.click('#reverse-selection');await ready();d=await description();assert.deepEqual(d.selectionOrder,ids);assert.equal(d.activeSelection,ids[1]);
 // Verify viewport mouse selection independently, including Shift additive selection.
 await page.evaluate(()=>solidArc.Command('select none',false));await ready();
 await page.mouse.click(...await project([.6,0,3]));await ready();
 await page.keyboard.down('Shift');await page.mouse.click(...await project([1,0,0]));await page.keyboard.up('Shift');await ready();
 d=await description();assert.deepEqual(d.selectionOrder,ids.slice().reverse());assert.equal(d.activeSelection,ids[0]);result.viewportSelection=true;
 const draws=await page.evaluate(()=>solidArc.Flow.Base.frame.draws.filter(D=>D.kind==='line'&&!D.overlay));
 for(const [id,tint] of [[ids[0],[.2,1,.45]],[ids[1],[.25,.6,1]]]){
  const draw=draws.find(D=>D.pick===id);assert.ok(draw);tint.forEach((v,i)=>assert.ok(Math.abs(draw.tint[i]-v)<1e-5));assert.equal(draw.selection[0],0);
 }
 result.colours={active:'green',otherSelected:'blue',verifiedNativeDrawPackets:true};
 await page.click('.ordered-selection [data-tool="loft"]');
 await page.fill('[name="degree"]','2');await page.selectOption('[name="result"]','auto');
 assert.equal(await page.locator('#command-preview').innerText(),`loft ${ids[1]} ${ids[0]} --degree=2`);
 await page.screenshot({path:folder+'SolidArcLoftParameters.png'});
 await page.click('#apply-tool');await ready();await page.waitForFunction(()=>solidArc.Description.figures.length===3);
 d=await description();const loft=d.figures.at(-1);assert.equal(loft.classification,2);assert.ok(loft.faces>0);assert.equal(d.activeSelection,loft.id);
 result.result={figure:loft,autoSelected:true};
 await page.screenshot({path:folder+'SolidArcLoftResult.png'});
 await page.evaluate(()=>solidArc.Command('undo'));await ready();assert.equal((await description()).figures.length,2);
 assert.deepEqual((await description()).selectionOrder,ids.slice().reverse());
 await page.evaluate(()=>solidArc.Command('redo'));await ready();assert.equal((await description()).figures.length,3);result.singleStepUndoRedo=true;
 // Open curves add Bridge, connected endpoints add Join, mixed selections do not advertise curve operations.
 await page.evaluate(()=>solidArc.Command(['reset','draw line (0,0) (1,0)','draw line (1,0) (2,1)','select all']));await ready();
 d=await description();assert.ok(d.selectionOperations.some(O=>O.key==='join'));assert.ok(d.selectionOperations.some(O=>O.key==='bridge'));result.openAndConnectedEligibility=true;
 result.graphics=await page.evaluate(()=>solidArcGraphics);assert.equal(result.graphics.rgbaUploads,0);assert.deepEqual(errors,[]);result.errors=errors;
 await writeFile(folder+'SolidArcLoftProof.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
