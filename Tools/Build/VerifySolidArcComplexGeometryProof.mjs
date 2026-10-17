// Gallery/control regression only: never sends modelling input to a live session.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const base=process.env.SOLIDARC_BASE_URL||'http://127.0.0.1:8081';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'/tmp/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(120000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));let imageStates=0;
async function image(){await page.waitForFunction(()=>{const i=document.querySelector('#proof-image');return i.complete&&i.naturalWidth>0;});const state=await page.evaluate(()=>({alt:document.querySelector('#proof-image').alt,caption:document.querySelector('#caption').textContent,status:document.querySelector('#view-status').textContent}));assert.equal(state.alt,state.caption);assert.equal(state.alt,state.status);imageStates++;return state;}
try{
 assert.equal((await page.goto(`${base}/gpu/proofs/complex.html`)).status(),200);
 const evidence=await page.locator('#evidence').evaluate(el=>JSON.parse(el.textContent));
 assert.equal(evidence.results.fixtures.length,24);assert.equal(Object.keys(evidence.images).length,296);
 assert.equal(await page.locator('[data-case]').count(),144);
 for(const fixture of evidence.results.fixtures){
  for(const operation of evidence.operations){
   const id=fixture.id+'-'+operation;await page.locator(`[data-case="${id}"]`).click();
   for(const renderer of ['native','gpu']){
    await page.locator(`[data-renderer="${renderer}"]`).click();
    for(const view of ['source','boolean']){
     await page.locator(`[data-view="${view}"]`).click();const state=await image();assert.ok(state.status.includes(id));assert.ok(state.status.includes(view));
     if(view==='boolean'&&fixture.status==='construction-refused')assert.match(state.status,/NOT RUN: source construction blocked; partial build shown/);
     else if(view==='boolean'&&!fixture.cases.find(c=>c.operation===operation).accepted)assert.match(state.status,/REFUSED: unchanged source pair shown/);
    }
   }
  }
  // All 127 body stages, not only final source meshes.
  await page.locator('[data-renderer="gpu"]').click();
  const stages=await page.locator('#construction-stage option').evaluateAll(nodes=>nodes.map(n=>n.value));
  for(const stage of stages){await page.locator('#construction-stage').selectOption(stage);const state=await image();assert.match(state.status,/stage.*Isolated accepted intermediate/);}
  for(const view of ['A','B'])if(await page.locator(`[data-view="${view}"]`).isEnabled()){await page.locator(`[data-view="${view}"]`).click();await image();}
 }
 for(const entry of evidence.nativeUI){
  await page.locator(`[data-case="${entry.id}"]`).click();
  for(const renderer of ['native','gpu']){
   await page.locator(`[data-renderer="${renderer}"]`).click();for(const view of ['ui-before-apply','ui-result']){await page.locator(`[data-view="${view}"]`).click();const state=await image();assert.match(state.status,/actual native C\+\+|actual HTML mouse/);if(entry.disabledBeforePopup)assert.match(state.status,/No Apply action was available/);}
  }
 }
 const filters={};for(const value of ['blocked','accepted','all-refused','asymmetric','all']){await page.locator('#filter').selectOption(value);filters[value]=await page.locator('#matrix tbody tr:not([hidden])').count();assert.equal(await page.locator('[data-case]:not(:disabled)').count(),filters[value]*6);}
 assert.deepEqual(filters,{blocked:11,accepted:5,'all-refused':8,asymmetric:1,all:24});
 const downloadPromise=page.waitForEvent('download');await page.locator('#download-results').click();const download=await downloadPromise;const exported=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(exported.results.completedFinalBooleans,78);assert.equal(exported.audit.stages.length,127);
 await page.locator('[data-case="thin-u-comb-intersect"]').click();await page.locator('[data-renderer="gpu"]').click();await page.locator('[data-view="boolean"]').click();await image();await page.locator('#case-title').scrollIntoViewIfNeeded();await page.screenshot({path:'_AgentScratch/tmp/ComplexGeometry/report-comb.png'});
 await page.goto(`${base}/proofs`);assert.equal(await page.locator('[data-case]').count(),64);await page.locator('a[href="/gpu/proofs/complex.html"]').click();await page.locator('h1').waitFor();assert.match(await page.title(),/Constructed and concave/);
 assert.deepEqual(errors,[]);const summary={pairings:24,plannedFinals:144,embeddedImages:296,intermediateBodies:127,imageControlStates:imageStates,filters,download:true,priorReportPreserved:true,pageErrors:errors};await writeFile('_AgentScratch/tmp/ComplexGeometry/controls.json',JSON.stringify(summary,null,2));console.log('PASS complex gallery',JSON.stringify(summary));
}finally{await browser.close();}
