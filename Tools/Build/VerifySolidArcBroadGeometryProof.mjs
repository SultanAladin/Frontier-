// Test every report case/available stage, failure filters, download and live launchers.
// No live modelling input is sent; the HTML launcher check uses a fresh session.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const base=process.env.SOLIDARC_BASE_URL||'http://127.0.0.1:8081',folder='_AgentScratch/tmp/BroadGeometry';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'/tmp/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(120000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));let states=0;
try{
 const response=await page.goto(`${base}/proofs`);assert.equal(response.status(),200);
 const ids=await page.locator('[data-case]').evaluateAll(bs=>bs.map(b=>b.dataset.case));assert.equal(ids.length,64);
 for(const id of ids){
  await page.locator(`[data-case="${id}"]`).click();
  for(const renderer of ['native','gpu']){
   await page.locator(`[data-renderer="${renderer}"]`).click();
   const stages=await page.locator('[data-stage]:not(:disabled)').evaluateAll(bs=>bs.map(b=>b.dataset.stage));
   for(const stage of stages){
    await page.locator(`[data-stage="${stage}"]`).click();
    await page.waitForFunction(()=>{const i=document.querySelector('#proof-image');return i.complete&&i.naturalWidth>0;});
    const state=await page.evaluate(()=>({alt:document.querySelector('#proof-image').alt,caption:document.querySelector('#caption').textContent,status:document.querySelector('#view-status').textContent}));
    assert.equal(state.alt,state.caption);assert.equal(state.caption,state.status);assert.ok(state.status.includes(id));assert.ok(state.status.includes(stage));states++;
   }
  }
 }
 assert.equal(states,388);
 const counts={};for(const value of ['spatial-flagged','boolean-refused','none','partial','all-blends','timeout','all']){
  await page.locator('#filter').selectOption(value);counts[value]=await page.locator('[data-case]:not(:disabled)').count();assert.ok(counts[value]>0);
 }
 assert.equal(counts['spatial-flagged'],1);assert.equal(counts['boolean-refused'],14);assert.equal(counts.timeout,1);assert.equal(counts.all,64);
 const pending=page.waitForEvent('download');await page.locator('#download-results').click();const download=await pending;
 const downloaded=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(downloaded.cases.length,64);assert.equal(downloaded.blendAccepted,135);assert.equal(downloaded.spatialAudit.flagged,1);
 await page.locator('[data-case="torus-box-union"]').click();assert.match(await page.locator('#case-summary').textContent(),/GEOMETRY DEFECT/);
 await page.locator('[data-case="torus-box-intersect"]').click();await page.locator('[data-stage="boolean"]').click();assert.match(await page.locator('#view-status').textContent(),/refused.*not a successful Boolean/i);
 await page.locator('#case-title').scrollIntoViewIfNeeded();await page.screenshot({path:`${folder}/report-refused.png`});
 await page.locator('[data-case="box-cylinder-intersect"]').click();await page.locator('#renderer-gpu').click();await page.locator('[data-stage="fillet"]').click();assert.match(await page.locator('#view-status').textContent(),/NO SAMPLED FILLET ACCEPTED/);
 await page.locator('#case-title').scrollIntoViewIfNeeded();await page.screenshot({path:`${folder}/report-bevel-gap.png`});
 await page.goto(`${base}/cpp`);await page.locator('#broad-geometry-proofs-button').click();await page.frameLocator('#broad-geometry-frame').locator('h1').waitFor();assert.equal(await page.locator('#broad').isVisible(),true);
 await page.locator('[data-panel="native"]').click();assert.equal(await page.locator('#native').isVisible(),true);
 await page.goto(`${base}/gpu/`);await page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
 const before=await page.evaluate(()=>JSON.stringify(solidArc.Description.figures));
 await page.locator('#broad-geometry-proofs-button').click();await page.frameLocator('#booleans2d-proofs-frame').locator('h1').waitFor();
 await page.locator('#booleans2d-proofs-dialog form button').click();assert.equal(await page.locator('#booleans2d-proofs-dialog').isVisible(),false);
 assert.equal(await page.evaluate(()=>JSON.stringify(solidArc.Description.figures)),before);assert.deepEqual(errors,[]);
 const results={cases:64,imageControlStates:states,filters:counts,download:true,nativeLauncher:true,htmlLauncher:true,close:true,documentPreserved:true,pageErrors:errors};
 await writeFile(`${folder}/controls.json`,JSON.stringify(results,null,2));console.log('PASS broad gallery controls',JSON.stringify(results));
}finally{await browser.close();}
