// Exercise EVERY viewport rotation path, not just RMB; reproduce legacy roll too.
import Assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',E=>errors.push(E.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
const sample=()=>page.evaluate(()=>({camera:structuredClone(solidArc.Description.camera),view:structuredClone(solidArc.Flow.Base.frame.view)}));
const upright=S=>{
 Assert.ok(Math.abs(S.camera.roll||0)<1e-10,'camera must not roll');
 Assert.ok(Math.abs(S.view.ViewWorld[2])<1e-9,'world Z must never acquire a screen-right component');
 Assert.ok(S.view.ViewWorld[6]>=0,'world Z must remain screen-up');
};
const result={renderer:'WebGL2 / SwiftShader',cases:[]};
try{
 await page.goto(process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/');await ready();
 await page.evaluate(()=>solidArc.Command(['box (-1,-1,-1) (1,1,1) --name=UprightWitness','gizmo off']));await ready();
 for(const view of ['iso','front','top','bottom'])for(const mode of ['right','left','alt-left']){
  await page.selectOption('#camera-view',view);await ready();const A=await sample();
  const R=await page.locator('#cad-canvas').boundingBox(),X=R.x+R.width*.65,Y=R.y+R.height*.42;
  await page.mouse.move(X,Y);if(mode==='alt-left')await page.keyboard.down('Alt');
  await page.mouse.down({button:mode==='right'?'right':'left'});
  for(let I=1;I<=12;I++){
   await page.mouse.move(X+I*6,Y+I*2);await page.evaluate(()=>new Promise(requestAnimationFrame));upright(await sample());
  }
  await page.mouse.up({button:mode==='right'?'right':'left'});if(mode==='alt-left')await page.keyboard.up('Alt');await ready();
  const B=await sample();upright(B);Assert.deepEqual(B.camera.pivot,A.camera.pivot);Assert.equal(B.camera.distance,A.camera.distance);
  result.cases.push({view,mode,checkedMoves:12,zeroRoll:true,worldZScreenUp:true,fixedPivot:true,fixedDistance:true});
  if(view==='iso' || view==='front')await page.screenshot({path:`Exhibits/Gallery/Editor/SolidArcUpright_${view}_${mode}.png`});
 }
 await page.selectOption('#camera-view','iso');await ready();
 await page.evaluate(()=>solidArc.Request('render',{camera:{...solidArc.Description.camera,roll:1.1}}));await ready();upright(await sample());result.legacyRollCleared=true;
 result.graphics=await page.evaluate(()=>solidArcGraphics);Assert.equal(result.graphics.rgbaUploads,0);Assert.deepEqual(errors,[]);result.errors=errors;
 await page.screenshot({path:'Exhibits/Gallery/Editor/SolidArcUpright_LegacyRestored.png'});
 await writeFile('Exhibits/Gallery/Editor/SolidArcUprightProof.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
