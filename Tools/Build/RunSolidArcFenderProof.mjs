// Isolated native-backed browser study; never resets a user's live document.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1800,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
const result={renderer:'WebGL2 / SwiftShader software driver; C++ owns geometry'};
try {
 await page.goto((process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/')+'?example=fender');
 await page.waitForFunction(()=>window.solidArc?.Description?.figures.length===6&&!solidArc.Busy);
 assert.equal(await page.evaluate(()=>solidArc.Flow.Base.frame.draws.filter(d=>d.kind==='point').length),0,'viewing a selected surface must not show control markers');
 assert.equal(await page.evaluate(()=>solidArc.Flow.Base.frame.draws.filter(d=>d.dashed).length),0,'fender view must not contain dotted cages');
 result.figures=await page.evaluate(()=>solidArc.Description.figures.map(f=>({name:f.name,kind:f.kind,classification:f.classification,poles:f.poles})));
 assert.equal(result.figures.at(-1).classification,1);assert.equal(result.figures.at(-1).kind,'surface');
 await page.screenshot({path:'Exhibits/Gallery/Editor/EditorProof_SolidArc_HtmlFender.png'});
 const original=await page.evaluate(async()=>{await solidArc.CreateDocument();await solidArc.Command('box (0,0,0) 1 2 3 --name=KeepBox');solidArc.Document.name='Keep this work';const id=solidArc.Active;await solidArc.CreateDocument('fender');return id;});await ready();
 assert.equal(await page.evaluate(()=>solidArc.Documents.length),3);
 assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),6);
 assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('solidarc.native.previous.v1')).text.includes('KeepBox')));
 const fender=await page.evaluate(()=>solidArc.Active);
 await page.evaluate(id=>solidArc.ActivateDocument(id),original);await ready();
 assert.equal(await page.evaluate(()=>solidArc.Description.figures[0].name),'KeepBox');
 await page.evaluate(id=>solidArc.ActivateDocument(id),fender);await ready();
 await page.evaluate(async()=>{await solidArc.Command('select WheelArch EngineRail');await solidArc.OpenTool('loft');});await ready();
 await page.locator('[name="profiles"]').fill('3,4,5');
 assert.ok(await page.locator('[name="degree"]').isDisabled());assert.ok(await page.locator('[name="result"]').isDisabled());
 await page.click('#apply-tool');await ready();await page.waitForFunction(()=>solidArc.Description.figures.length===7);
 assert.equal(await page.evaluate(()=>solidArc.Description.figures.at(-1).classification),1);
 result.separateDocument=true;result.originalNativeDocumentAndRecoveryPreserved=true;result.inspectorProfileLoft=true;
 result.graphics=await page.evaluate(()=>solidArcGraphics);assert.equal(result.graphics.rgbaUploads,0);assert.deepEqual(errors,[]);result.errors=errors;
 await writeFile('Exhibits/Gallery/Editor/SolidArcFenderProof.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {await page.evaluate(()=>solidArc?.Worker?.terminate()).catch(()=>{});await browser.close();}
