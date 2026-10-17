// Actual HTML Inspector input for curved solids, including the user's Union + corner sphere.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1800,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
const command=async commands=>{const r=await page.evaluate(c=>solidArc.Command(c,false),commands);await ready();assert.ok(r.success);return r;};
const SV=4*Math.PI*.75**3/3,base=48-6*(2-1.4994483840546615),folder='Exhibits/Gallery/Editor/';
const fixtures=[
 {name:'pole corner',commands:['box (0,0,0) (4,3,2)','sphere (0,0,0) .75'],ids:[1,2],volumes:[24,SV],common:SV/8},
 {name:'user derived Union + sphere',commands:['box (0,0,0) (4,3,2)','box (2,0,1.4994483840546615) (6,3,3.4994483840546615)','boolean union #1 -- #2 --select-result','sphere (0,0,0) .75'],ids:[4,3],volumes:[SV,base],common:SV/8},
 {name:'sphere pair',commands:['sphere (0,0,0) 1','sphere (1,0,0) 1'],ids:[1,2],volumes:[4*Math.PI/3,4*Math.PI/3],common:5*Math.PI/12},
];
const report={scope:'Browser actual Outliner Shift/reverse and Inspector Apply on native C++ curved-solid booleans. Volumes are tessellated quadrature; compare to analytic values with max(0.003,0.2%) tolerance.',cases:[]};
try{
 await page.goto('http://127.0.0.1:8081/gpu/?example=booleans3d');await page.waitForFunction(()=>window.solidArc?.Description.figures.length===2);await ready();
 for(const [index,f] of fixtures.entries())for(const operation of ['union','subtract','intersect','reverse subtract']){
  await command(['reset',...f.commands,'view iso','view fit','gizmo off','dim off','show cages off','selectmode whole','select none']);
  await page.locator(`[data-figure="${f.ids[0]}"]`).click();await ready();await page.locator(`[data-figure="${f.ids[1]}"]`).click({modifiers:['Shift']});await ready();
  assert.deepEqual(await page.evaluate(()=>solidArc.Description.selectionOrder),f.ids);
  for(const key of ['union','subtract','intersect'])assert.equal(await page.locator(`.ordered-selection [data-tool="${key}"]`).isDisabled(),false,`${f.name} ${key}`);
  if(index===1&&operation==='union')await page.screenshot({path:folder+'EditorProof_SolidArc_HtmlCurvedEnabled.png'});
  const reverse=operation==='reverse subtract',key=reverse?'subtract':operation;
  if(reverse){await page.locator('#reverse-selection').click();await ready();}
  const before=await page.evaluate(()=>structuredClone(solidArc.Description.figures));
  await page.locator(`.ordered-selection [data-tool="${key}"]`).click();await page.locator('#apply-tool').click();await page.waitForFunction(()=>!document.querySelector('#tool-dialog').open);await ready();
  const figures=await page.evaluate(()=>solidArc.Description.figures);assert.equal(figures.length,1);
  const r=await command(`topology #${figures[0].id} --summary`),line=r.lines.find(l=>l.includes('closed yes manifold yes oriented yes'));assert.ok(line);assert.ok(line.includes('hulls 1'));
  const volume=Number(line.match(/volume\s+([\d.eE+-]+)/)[1]),[va,vb]=f.volumes;
  const expected=key==='union'?va+vb-f.common:key==='intersect'?f.common:(reverse?vb:va)-f.common;
  assert.ok(Math.abs(volume-expected)<Math.max(.003,.002*expected),`${f.name} ${operation}: ${volume} vs ${expected}`);
  if(index===1&&!reverse)await page.screenshot({path:folder+`EditorProof_SolidArc_HtmlCurved${key}.png`});
  await command('undo');assert.deepEqual(await page.evaluate(()=>solidArc.Description.figures),before);await command('redo');assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),1);
  report.cases.push({fixture:f.name,operation,volume,expected,allThreeEnabled:true,mouseSelectionApply:true,closed:true,manifold:true,oneHull:true,undoRedo:true});
 }
 assert.deepEqual(errors,[]);report.errors=errors;report.graphics=await page.evaluate(()=>solidArcGraphics);assert.equal(report.graphics.rgbaUploads,0);
 await writeFile(folder+'SolidArcHtmlCurvedBooleansProof.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await page.evaluate(()=>solidArc?.Worker?.terminate()).catch(()=>{});await browser.close();}
