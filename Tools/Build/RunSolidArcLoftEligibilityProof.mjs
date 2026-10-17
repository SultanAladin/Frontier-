// Selection/Inspector/Loft proof against real C++ geometry and actual browser mouse input.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
const folder='Exhibits/Gallery/Editor/';
const description=()=>page.evaluate(()=>structuredClone(solidArc.Description));
const project=P=>page.evaluate(P=>{
 const m=solidArc.Flow.Base.frame.view.ViewClip,r=document.querySelector('#cad-canvas').getBoundingClientRect();
 const q=[0,1,2,3].map(i=>m[i]*P[0]+m[i+4]*P[1]+m[i+8]*P[2]+m[i+12]);
 return [r.x+(q[0]/q[3]+1)*r.width/2,r.y+(q[1]/q[3]+1)*r.height/2];
},P);
const result={scope:'Native C++ loft eligibility; actual browser disabled-button click and re-enabling. WebGL2 / software SwiftShader.'};
try {
 await page.goto(process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/');await ready();
 await page.evaluate(()=>solidArc.Command(['reset','circle (0,0,0) 2 --name=Outer','circle (0,0,0) 1 --name=Inner','gizmo off','dim hide all','view iso','view fit']));await ready();
 let d=await description(),ids=d.figures.map(F=>F.id);
 await page.click(`[data-figure="${ids[0]}"]`);await ready();
 await page.click(`[data-figure="${ids[1]}"]`,{modifiers:['Shift']});await ready();
 d=await description();const before=structuredClone(d.figures);
 const button=page.locator('.ordered-selection [data-tool="loft"]');
 assert.equal(await button.isDisabled(),true);assert.ok((await button.getAttribute('title')).includes('same plane'));
 result.coplanar=d.selectionOperations.find(O=>O.key==='loft');assert.equal(result.coplanar.enabled,false);
 const box=await button.boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
 assert.equal(await page.locator('#tool-dialog[open]').count(),0);assert.deepEqual((await description()).figures,before);
 await page.evaluate(()=>solidArc.OpenTool('loft'));assert.equal(await page.locator('#tool-dialog[open]').count(),0);
 result.disabledClickAndProgrammaticGuard=true;
 await page.screenshot({path:folder+'SolidArcLoftDisabled.png'});
 await page.evaluate(()=>solidArc.Command('move #2 (0,0,2)'));await ready();
 assert.equal(await button.isEnabled(),true);result.separated=(await description()).selectionOperations.find(O=>O.key==='loft');
 await page.screenshot({path:folder+'SolidArcLoftReenabled.png'});
 await button.click();await page.waitForSelector('#tool-dialog[open]');await page.click('#apply-tool');await ready();
 d=await description();assert.equal(d.figures.length,3);assert.equal(d.figures[2].classification,2);result.enabledLoftCreatesBody=true;
 assert.deepEqual(errors,[]);result.errors=errors;
 await writeFile(folder+'SolidArcLoftEligibilityProof.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
