// Report verification only. Never sends modelling input to an existing session.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const base=process.env.SOLIDARC_BASE_URL||'http://127.0.0.1:8081';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'/tmp/chromium',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1550,height:1050}});page.setDefaultTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));let states=0;
try{
 assert.equal((await page.goto(`${base}/gpu/proofs/repairs.html`)).status(),200);
 const data=await page.locator('#evidence').evaluate(el=>JSON.parse(el.textContent));assert.equal(data.cases.length,8);assert.equal(Object.keys(data.images).length,39);
 for(const row of data.cases){
  await page.locator('#case').selectOption(row.id);
  for(const renderer of ['native','gpu']){
   await page.locator(`[data-renderer="${renderer}"]`).click();
   for(const view of ['source','boolean','ui-before-apply','ui-result']){
    const button=page.locator(`[data-view="${view}"]`);if(!await button.isEnabled())continue;await button.click();
    await page.waitForFunction(()=>{const i=document.querySelector('#image');return i.complete&&i.naturalWidth>0;});
    const state=await page.evaluate(()=>({alt:document.querySelector('#image').alt,caption:document.querySelector('#caption').textContent,status:document.querySelector('#status').textContent}));assert.equal(state.alt,state.caption);assert.equal(state.alt,state.status);assert.ok(state.status.includes(row.id));assert.ok(state.status.includes(view));
    if(!row.accepted)assert.match(state.status,/SAFE REFUSAL/);else if(row.fixture==='cone-box')assert.match(state.status,/REPAIRED FIXTURE/);else assert.match(state.status,/AUDIT INCONCLUSIVE/);if(!row.accepted&&view.startsWith('ui-'))assert.match(state.status,/no Apply available/);states++;
   }
  }
 }
 assert.equal(states,52);
 const promise=page.waitForEvent('download');await page.locator('#download').click();const download=await promise;const exported=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(exported.broadSummary.accepted,56);assert.equal(exported.analyticAudit.passed,4);assert.equal(exported.nativeRegression.failed,0);
 await page.locator('#case').selectOption('cone-box-intersect');await page.locator('[data-renderer="native"]').click();await page.locator('[data-view="ui-result"]').click();await page.locator('article').evaluate(e=>e.scrollIntoView());await page.screenshot({path:'_AgentScratch/tmp/GeometryRepairs/report-cone.png'});
 for(const route of ['/proofs','/gpu/proofs/complex.html']){await page.goto(base+route);await page.locator('a[href="/gpu/proofs/repairs.html"]').click();assert.match(await page.title(),/First Boolean kernel repairs/);}
 assert.deepEqual(errors,[]);const result={cases:8,images:39,imageControlStates:states,nativeInputChecks:5,htmlInputChecks:5,download:true,historicalNavigation:true,pageErrors:errors};await writeFile('_AgentScratch/tmp/GeometryRepairs/controls.json',JSON.stringify(result,null,2));console.log('PASS repair report',JSON.stringify(result));
}finally{await browser.close();}
