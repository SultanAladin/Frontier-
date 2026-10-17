// Verify the portable report controls and both live proof entry points.
// Browser storage/context is isolated; no existing user document is opened/reset.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const base=process.env.SOLIDARC_BASE_URL||'http://127.0.0.1:8081';
const folder='_AgentScratch/tmp/CylinderSphereProofButtons';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'/tmp/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(120000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let imageStates=0;
try{
 const response=await page.goto(`${base}/proofs/cylinder-sphere-bevel`);assert.equal(response.status(),200);
 const cases=await page.locator('[data-case]').evaluateAll(bs=>bs.map(b=>b.dataset.case));assert.equal(cases.length,8);
 for(const key of cases){
  await page.locator(`[data-case="${key}"]`).click();assert.equal(await page.locator(`[data-case="${key}"]`).getAttribute('aria-pressed'),'true');
  for(const renderer of ['native','html']){
   await page.locator(`#renderer-${renderer}`).click();assert.equal(await page.locator(`#stage-before`).isDisabled(),renderer==='html');
   for(const stage of renderer==='native'?['before','preview','applied']:['preview','applied']){
    await page.locator(`#stage-${stage}`).click();
    await page.waitForFunction(()=>{const image=document.querySelector('#proof-image');return image.complete&&image.naturalWidth>0;});
    const state=await page.evaluate(()=>({alt:document.querySelector('#proof-image').alt,status:document.querySelector('#proof-status').textContent,src:document.querySelector('#proof-image').getAttribute('src'),expected:JSON.parse(document.querySelector('#recorded-images').textContent)[document.querySelector('[data-case][aria-pressed=true]').dataset.case][document.querySelector('[data-renderer][aria-pressed=true]').dataset.renderer][document.querySelector('[data-stage][aria-pressed=true]').dataset.stage]}));
    assert.equal(state.src,state.expected);assert.equal(state.alt,state.status);assert.ok(state.status.includes(stage));imageStates++;
   }
  }
 }
 assert.equal(imageStates,40);
 await page.goto(`${base}/cpp`);await page.waitForFunction(()=>document.querySelector('#state').textContent.startsWith('Native C++ frame'));
 for(const panel of ['views','orbit','construct','bevel','native']){
  await page.locator(`[data-panel="${panel}"]`).click();assert.equal(await page.locator(`#${panel}`).isVisible(),true);assert.equal(await page.locator(`[data-panel="${panel}"]`).getAttribute('aria-pressed'),'true');
 }
 await page.locator('[data-panel="bevel"]').click();await page.frameLocator('#bevel iframe').locator('h1').waitFor();
 assert.match(await page.frameLocator('#bevel iframe').locator('h1').textContent(),/Cylinder.*sphere/);
 await page.screenshot({path:`${folder}/native-proof-button.png`});
 await page.locator('[data-panel="native"]').click();
 const view=page.locator('#view'),rect=await view.boundingBox(),before=await view.getAttribute('src');
 await page.mouse.click(rect.x+310*rect.width/1280,rect.y+51*rect.height/720);
 await page.waitForFunction(old=>document.querySelector('#view').src!==old,before);
 await page.waitForFunction(()=>!busy&&queue.length===0);
 assert.equal(await page.locator('#retry-connection').isHidden(),true);
 await page.screenshot({path:`${folder}/native-mirror-construct.png`});
 await page.keyboard.press('Escape');
 await page.goto(`${base}/gpu/`);
 await page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
 const documentBefore=await page.evaluate(()=>JSON.stringify(solidArc.Description.figures));
 await page.locator('#bevel-proofs-button').click();assert.equal(await page.locator('#booleans2d-proofs-dialog').isVisible(),true);
 await page.frameLocator('#booleans2d-proofs-frame').locator('h1').waitFor();
 assert.match(await page.frameLocator('#booleans2d-proofs-frame').locator('h1').textContent(),/Cylinder.*sphere/);
 await page.screenshot({path:`${folder}/html-proof-button.png`});
 await page.locator('#booleans2d-proofs-dialog form button').click();assert.equal(await page.locator('#booleans2d-proofs-dialog').isVisible(),false);
 assert.equal(await page.evaluate(()=>JSON.stringify(solidArc.Description.figures)),documentBefore);
 assert.deepEqual(errors,[]);
 const results={imageStates,nativeMirrorPanels:5,nativeProofButton:true,htmlProofButton:true,htmlProofCloseButton:true,nativeMirrorConstructInput:true,proofBrowsingPreservedDocument:true,pageErrors:errors};
 await writeFile(`${folder}/results.json`,JSON.stringify(results,null,2));console.log('PASS proof controls',JSON.stringify(results));
}finally{await page.evaluate(()=>solidArc?.Worker?.terminate()).catch(()=>{});await browser.close();}
