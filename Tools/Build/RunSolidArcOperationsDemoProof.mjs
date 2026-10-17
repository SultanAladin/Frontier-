// Live native-backed Solidify / Pipe / Revolve demos; no resets of user documents.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1800,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
const result={renderer:'WebGL2 / SwiftShader software driver; native C++ geometry',cases:[]};
const command=async text=>{const r=await page.evaluate(t=>solidArc.Command(t,false),text);await ready();assert.ok(r.success,text);return r;};
try {
 await page.goto((process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/')+'?example=operations');
 await page.waitForFunction(()=>window.solidArc?.Documents.length===3&&!solidArc.Busy&&solidArc.Document.name.startsWith('Solidify'));
 const docs=await page.evaluate(()=>solidArc.Documents.map(d=>({id:d.id,name:d.name})));
 for(const [index,doc]of docs.entries()){
  await page.evaluate(id=>solidArc.ActivateDocument(id),doc.id);await ready();
  const body=await page.evaluate(()=>solidArc.Description.figures.find(f=>f.classification===2));assert.ok(body);assert.ok(body.faces>=3);
  const response=await command('topology '+body.id),report=response.lines.find(l=>l.includes('closed yes manifold yes oriented yes'));assert.ok(report,JSON.stringify(response.lines));
  assert.equal(await page.evaluate(()=>solidArc.Flow.Base.frame.draws.filter(d=>d.kind==='point'||d.dashed).length),0);
  if(index===0){assert.equal(body.high[2]-body.low[2],.45);assert.equal(await page.evaluate(()=>solidArc.Description.figures.filter(f=>f.classification===1).length),1);}
  const edit=index===1?['radius',.3,.22]:index===2?['angle',270,360]:null;
  if(edit){
   const dim=await page.evaluate(label=>solidArc.Description.dimensions.find(d=>d.slot>=0&&d.label.endsWith(label)),edit[0]);assert.ok(dim);
   await command(`dim edit ${dim.id} ${edit[1]}`);
   assert.equal(await page.evaluate(label=>solidArc.Description.dimensions.find(d=>d.slot>=0&&d.label.endsWith(label)).number,edit[0]),edit[1]);
   const changed=await command('topology '+body.id);assert.ok(changed.lines.some(l=>l.includes('closed yes manifold yes oriented yes')));
   await command('undo');assert.equal(await page.evaluate(label=>solidArc.Description.dimensions.find(d=>d.slot>=0&&d.label.endsWith(label)).number,edit[0]),edit[2]);
  }
  await page.screenshot({path:'Exhibits/Gallery/Editor/EditorProof_SolidArc_Html'+['Solidify','Pipe','Revolve'][index]+'.png'});
  result.cases.push({name:doc.name,body,topology:report,liveParameterEditAndUndo:!!edit});
 }
 // Three demos fit alongside an existing user's fourth document, without replacing it.
 const keeper=await page.evaluate(async()=>{await solidArc.CreateDocument();await solidArc.Command('box (0,0,0) 1 1 1 --name=KeepBox');return solidArc.Active;});await ready();
 assert.equal(await page.evaluate(()=>solidArc.Documents.length),4);
 await page.evaluate(id=>solidArc.ActivateDocument(id),docs[0].id);await ready();
 await page.evaluate(id=>solidArc.ActivateDocument(id),keeper);await ready();
 assert.equal(await page.evaluate(()=>solidArc.Description.figures[0].name),'KeepBox');
 for(const doc of docs){await page.evaluate(id=>solidArc.CloseDocument(id),doc.id);await ready();}
 assert.equal(await page.evaluate(()=>solidArc.Documents.length),1);
 await page.evaluate(()=>solidArc.CreateDocument('operations'));await ready();
 assert.equal(await page.evaluate(()=>solidArc.Documents.length),4);
 await page.evaluate(id=>solidArc.ActivateDocument(id),keeper);await ready();
 assert.equal(await page.evaluate(()=>solidArc.Description.figures[0].name),'KeepBox');
 result.existingDrawingPreservedWhenOpeningBundle=true;
 result.separateDocuments=true;result.graphics=await page.evaluate(()=>solidArcGraphics);assert.equal(result.graphics.rgbaUploads,0);assert.deepEqual(errors,[]);result.errors=errors;
 await writeFile('Exhibits/Gallery/Editor/SolidArcOperationsDemoProof.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {await page.evaluate(()=>solidArc?.Worker?.terminate()).catch(()=>{});await browser.close();}
