// Actual browser Inspector clicks; isolated documents, native C++ geometry.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1800,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
const command=async text=>{const r=await page.evaluate(t=>solidArc.Command(t.split('\n'),false),text);await ready();assert.ok(r.success,text);return r;};
const report={renderer:'HTML WebGL2 / SwiftShader software; native C++ geometry',cases:[]};
const selectPair=async()=>{await page.locator('[data-figure="1"]').click();await ready();await page.locator('[data-figure="2"]').click({modifiers:['Shift']});await ready();assert.deepEqual(await page.evaluate(()=>solidArc.Description.selectionOrder),[1,2]);};
try{
 await page.goto((process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/')+'?example=booleans2d');await page.waitForFunction(()=>window.solidArc?.Description.figures.length===2&&!solidArc.Busy);await ready();
 const keys=['union','subtract','intersect','subtract'];
 for(const [index,key] of keys.entries()){
  if(index)await command('reset\nworkplane xy\ndraw rect (0,0) (4,3) --name=First\ndraw rect (2,1) (6,4) --name=Second\nview top\nview fit\nshow cages off\ngizmo off\ndim off');
  await selectPair();
  if(index===3){await page.locator('#reverse-selection').click();await ready();assert.deepEqual(await page.evaluate(()=>solidArc.Description.selectionOrder),[2,1]);}
  const button=page.locator(`.ordered-selection [data-tool="${key}"]`);assert.equal(await button.isDisabled(),false);await button.click();
  const preview=await page.locator('#command-preview').innerText();assert.ok(preview.includes(index===3?'2 -- 1':'1 -- 2'),preview);
  if(index===0)await page.screenshot({path:'Exhibits/Gallery/Editor/EditorProof_SolidArc_HtmlBooleanParameters.png'});
  await page.locator('#apply-tool').click();await page.waitForFunction(()=>!document.querySelector('#tool-dialog').open);await ready();
  const figures=await page.evaluate(()=>solidArc.Description.figures);assert.equal(figures.length,1);assert.ok(figures[0].selected);
  const measured=await command('profile '+figures[0].id),line=measured.lines.find(l=>l.includes('profile of '));const area=Number(line.split('area ')[1].split(' ')[0]);assert.equal(area,[20,8,4,8][index]);
  await command('undo');assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),2);await command('redo');assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),1);
  await page.screenshot({path:`Exhibits/Gallery/Editor/EditorProof_SolidArc_HtmlBoolean${index===3?'ReverseSubtract':key}.png`});report.cases.push({operation:index===3?'reverse subtract':key,area,orderedMouseSelection:true,mouseApply:true,undoRedo:true});
 }
 await command('reset\ndraw line (0,0) (4,0)\ncircle (2,2,0) 1\nview fit');await selectPair();
 for(const key of ['union','subtract','intersect'])assert.equal(await page.locator(`.ordered-selection [data-tool="${key}"]`).isDisabled(),true);
 report.invalidOpenProfileDisabled=true;
 await command('reset\ncircle (0,0,0) 1\ncircle (0,0,2) 1\nselect all');
 for(const key of ['union','subtract','intersect'])assert.equal(await page.locator(`.ordered-selection [data-tool="${key}"]`).isDisabled(),true);
 report.differentPlaneDisabled=true;report.graphics=await page.evaluate(()=>solidArcGraphics);assert.equal(report.graphics.rgbaUploads,0);assert.deepEqual(errors,[]);report.errors=errors;
 await writeFile('Exhibits/Gallery/Editor/SolidArcHtmlBooleans2DProof.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await page.evaluate(()=>solidArc?.Worker?.terminate()).catch(()=>{});await browser.close();}
