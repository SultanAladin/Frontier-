// Native mirror entry points must show the live frame, never broken proof images.
import assert from 'node:assert/strict';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']});
const base=process.env.SOLIDARC_URL||'http://127.0.0.1:8081';
try {
 for(const path of ['/','/cpp']){
  const page=await browser.newPage(),failed=[];
  page.on('response',r=>{if(r.status()>=400)failed.push([r.status(),r.url()]);});
  await page.goto(base+path);
  await page.waitForFunction(()=>document.querySelector('#view')?.naturalWidth>0&&document.querySelector('#state').textContent.includes('Native C++ frame'));
  assert.equal(await page.locator('#view').isVisible(),true);
  for(const panel of ['views','orbit','construct','native']){
   await page.locator(`button[data-panel="${panel}"]`).click();
   await page.waitForFunction(()=>[...document.querySelectorAll('img[data-evidence]')].every(i=>i.hidden||(i.complete&&i.naturalWidth>0)));
  }
  assert.deepEqual(failed,[]);await page.close();console.log('PASS',path,'live frame and all evidence tabs, zero failed requests');
 }
 const page=await browser.newPage();let evidenceRequests=0;
 page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/evidence/'))++evidenceRequests;});
 await page.route('**/evidence-manifest',route=>route.fulfill({json:{}}));
 await page.goto(base+'/cpp');await page.locator('button[data-panel="views"]').click();
 await page.waitForFunction(()=>document.querySelectorAll('.evidence-unavailable').length===6&&[...document.querySelectorAll('img[data-evidence]')].every(i=>i.hidden&&!i.hasAttribute('src')));
 assert.equal(evidenceRequests,0);console.log('PASS missing recordings: explicit status, no broken image requests');await page.close();
} finally {await browser.close();}
