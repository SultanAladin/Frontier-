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
 await page.goto((process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/')+'?example=booleans3d');await page.waitForFunction(()=>window.solidArc?.Description.figures.length===2&&!solidArc.Busy);await ready();
 const keys=['union','subtract','intersect','subtract'];
 for(const [index,key] of keys.entries()){
  await command('reset\nworkplane xy\nbox (0,0,0) (4,3,2) --name=First\nbox (2,1,.5) (6,4,2.5) --name=Second\nview iso\nview fit\nshow cages off\ngizmo off\ndim off');
  await selectPair();
  if(index===3){await page.locator('#reverse-selection').click();await ready();assert.deepEqual(await page.evaluate(()=>solidArc.Description.selectionOrder),[2,1]);}
  const button=page.locator(`.ordered-selection [data-tool="${key}"]`);assert.equal(await button.isDisabled(),false);await button.click();
  const preview=await page.locator('#command-preview').innerText();assert.ok(preview.includes(index===3?'2 -- 1':'1 -- 2'),preview);
  if(index===0)await page.screenshot({path:'Exhibits/Gallery/Editor/EditorProof_SolidArc_HtmlBoolean3DParameters.png'});
  await page.locator('#apply-tool').click();await page.waitForFunction(()=>!document.querySelector('#tool-dialog').open);await ready();
  const figures=await page.evaluate(()=>solidArc.Description.figures);assert.equal(figures.length,1);assert.ok(figures[0].selected);
  const measured=await command('topology '+figures[0].id+' --summary'),line=measured.lines.find(l=>l.includes('closed yes manifold yes oriented yes'));assert.ok(line);const volume=Number(line.match(/volume\s+([\d.eE+-]+)/)[1]);assert.equal(volume,[42,18,6,18][index]);
  await command('undo');assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),2);await command('redo');assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),1);
  await page.screenshot({path:`Exhibits/Gallery/Editor/EditorProof_SolidArc_HtmlBoolean3D${index===3?'ReverseSubtract':key}.png`});report.cases.push({operation:index===3?'reverse subtract':key,volume,orderedMouseSelection:true,mouseApply:true,undoRedo:true});
 }
 await command('reset\nbox (0,0,0) (2,2,2)\nbox (4,0,0) (6,2,2)\nview fit');await selectPair();
 assert.equal(await page.locator('.ordered-selection [data-tool="intersect"]').isDisabled(),true);
 assert.equal(await page.locator('.ordered-selection [data-tool="union"]').isDisabled(),false);
 report.emptyIntersectionDisabled=true;
 await page.screenshot({path:'Exhibits/Gallery/Editor/EditorProof_SolidArc_HtmlBoolean3DDisabled.png'});
 report.graphics=await page.evaluate(()=>solidArcGraphics);assert.equal(report.graphics.rgbaUploads,0);assert.deepEqual(errors,[]);report.errors=errors;
 await writeFile('Exhibits/Gallery/Editor/SolidArcHtmlBooleans3DProof.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await page.evaluate(()=>solidArc?.Worker?.terminate()).catch(()=>{});await browser.close();}
