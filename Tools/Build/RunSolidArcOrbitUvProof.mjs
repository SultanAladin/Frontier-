import Assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const folder='Exhibits/Gallery/Editor/';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',E=>errors.push(E.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
const run=async C=>{await page.evaluate(C=>solidArc.Command(C),C);await ready();};
const camera=()=>page.evaluate(()=>structuredClone(solidArc.Description.camera));
const evidence={renderer:'WebGL2 / SwiftShader',cases:[]};
try{
 await page.goto(process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/');await ready();
 await run('box (-1,-1,-1) (1,1,1) --name=OrbitWitness');await run('gizmo off');
 for(const view of ['top','bottom','iso']){
  await page.selectOption('#camera-view',view);await ready();const A=await camera();
  const bounds=await page.locator('#cad-canvas').boundingBox();
  await page.screenshot({path:folder+`SolidArcOrbitUv_${view}_before.png`});
  const X=bounds.x+bounds.width*.63,Y=bounds.y+bounds.height*.4;
  await page.mouse.move(X,Y);await page.keyboard.down('Alt');await page.mouse.down();await page.mouse.move(X+96,Y,{steps:24});await page.mouse.up();await page.keyboard.up('Alt');await ready();
  const B=await camera();Assert.deepEqual(B.pivot,A.pivot);Assert.equal(B.distance,A.distance);
  Assert.ok(Math.abs(B.roll||0)<1e-10,'every viewport rotation must remain upright');
  Assert.ok(Math.abs(await page.evaluate(()=>solidArc.Flow.Base.frame.view.ViewWorld[2]))<1e-9,'world Z must not lean sideways');
  await page.screenshot({path:folder+`SolidArcOrbitUv_${view}_after.png`});
  const labels=await page.locator('.cube-face-label').evaluateAll(Es=>Es.map(E=>({text:E.textContent,matrix:getComputedStyle(E).transform})));
  Assert.ok(labels.length>=1);Assert.ok(labels.every(E=>E.matrix.startsWith('matrix(')));
  Assert.ok(labels.some(E=>{const M=E.matrix.slice(7,-1).split(',').map(Number);return Math.abs(M[1])>.05||Math.abs(M[2])>.05;}),'face labels must rotate/shear rather than billboard');
  evidence.cases.push({view,before:A,after:B,labels,fixedPivot:true,fixedRadius:true});
 }
 await page.selectOption('#camera-view','iso');await ready();
 await page.screenshot({path:folder+'SolidArcCubeFaceUV.png'});
 const box=await page.locator('#cad-canvas').boundingBox();
 for(let I=1;I<=12;I++){
  if(I===1){await page.mouse.move(box.x+box.width*.6,box.y+box.height*.4);await page.keyboard.down('Alt');await page.mouse.down();}
  await page.mouse.move(box.x+box.width*.6+I*7,box.y+box.height*.4+I*2);
  await page.screenshot({path:folder+`SolidArcOrbitUv_motion_${String(I).padStart(2,'0')}.png`});
 }
 await page.mouse.up();await page.keyboard.up('Alt');await ready();
 evidence.graphics=await page.evaluate(()=>solidArcGraphics);Assert.equal(evidence.graphics.rgbaUploads,0);Assert.deepEqual(errors,[]);evidence.errors=errors;
 await writeFile(folder+'SolidArcOrbitUvProof.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{await browser.close();}
