// Actual RMB events, not the left/Alt orbit path.
import Assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
const camera=()=>page.evaluate(()=>structuredClone(solidArc.Description.camera));
const near=(A,B)=>Assert.ok(Math.abs(A-B)<1e-7,`${A} != ${B}`);
const folder='Exhibits/Gallery/Editor/',evidence={input:'actual Playwright right-button drag',cases:[]};
try{
 await page.goto(process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/');await ready();
 await page.evaluate(()=>solidArc.Command(['box (-1,-1,-1) (1,1,1) --name=RightDragWitness','gizmo off']));await ready();
 for(const view of ['iso','front','right']){
  await page.selectOption('#camera-view',view);await ready();const A=await camera(),R=await page.locator('#cad-canvas').boundingBox();
  const X=R.x+R.width*.63,Y=R.y+R.height*.4;
  await page.mouse.move(X,Y);await page.mouse.down({button:'right'});await page.mouse.move(X+96,Y,{steps:24});await page.mouse.up({button:'right'});await ready();
  const H=await camera();near(H.yaw,A.yaw-.576);near(H.pitch,A.pitch);near(H.roll,0);near(H.distance,A.distance);Assert.deepEqual(H.pivot,A.pivot);
  await page.screenshot({path:folder+`SolidArcRightDrag_${view}_horizontal.png`});
  await page.mouse.down({button:'right'});await page.mouse.move(X+96,Y+48,{steps:12});await page.mouse.up({button:'right'});await ready();
  const V=await camera();near(V.yaw,H.yaw);near(V.pitch,H.pitch+.288);near(V.roll,0);near(V.distance,A.distance);Assert.deepEqual(V.pivot,A.pivot);
  await page.screenshot({path:folder+`SolidArcRightDrag_${view}_vertical.png`});
  evidence.cases.push({view,horizontalWorldZOnly:true,verticalElevationOnly:true,noRoll:true,noPan:true,fixedRadius:true});
 }
 const A=await camera(),R=await page.locator('#cad-canvas').boundingBox();
 await page.mouse.move(R.x+R.width*.6,R.y+R.height*.4);await page.keyboard.down('Shift');await page.mouse.down({button:'right'});await page.mouse.move(R.x+R.width*.6+30,R.y+R.height*.4+10,{steps:6});await page.mouse.up({button:'right'});await page.keyboard.up('Shift');await ready();
 const B=await camera();Assert.notDeepEqual(B.pivot,A.pivot);near(B.yaw,A.yaw);near(B.pitch,A.pitch);evidence.shiftRightPan=true;
 evidence.graphics=await page.evaluate(()=>solidArcGraphics);Assert.equal(evidence.graphics.rgbaUploads,0);Assert.deepEqual(errors,[]);evidence.errors=errors;
 await writeFile(folder+'SolidArcRightDragProof.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{await browser.close();}
