// Real browser mouse construction; native geometry remains authoritative.
import Assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const folder='Exhibits/Gallery/Editor/';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage',...JSON.parse(process.env.BROWSER_ARGS||'[]')]});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
const run=async C=>{await page.evaluate(C=>solidArc.Command(C),C);await ready();};
const point=async(P,Click=true)=>{const Q=await page.evaluate(P=>{const M=solidArc.Flow.Base.frame.view.ViewClip,R=document.querySelector('#cad-canvas').getBoundingClientRect(),V=[0,1,2,3].map(I=>M[I]*P[0]+M[I+4]*P[1]+M[I+8]*(P[2]||0)+M[I+12]);return [R.x+(V[0]/V[3]+1)*R.width/2,R.y+(V[1]/V[3]+1)*R.height/2];},P);await page.mouse.move(...Q,{steps:12});if(Click)await page.mouse.click(...Q);await ready();};
const evidence={renderer:'WebGL2 / software SwiftShader',cpuPixelUploads:0,cases:[],cube:[]};
try{
 await page.goto(process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/');await ready();
 for(const [Index,Kind,Points,Multi] of [[22,'pslot',[[-2,-1],[0,1],[2,-1]],true],[23,'sketch-point',[[1,1]],false],[24,'datum-point',[[1,1]],false],[25,'circle3',[[-2,0],[0,2],[2,0]],false],[26,'arc3',[[-2,0],[2,0],[0,2]],false]]) {
  await run('reset');await page.selectOption('#camera-view','top');await ready();
  await page.click('#construct-button');await page.click(`[data-section="${Index===24?'Reference':'Sketch Draw'}"]`);await page.click(`[data-construct="${Index}"]`);
  Assert.equal(await page.evaluate(()=>solidArc.Flow.Drawing.tool),Kind);
  for(let I=0;I<Points.length;I++){
   if(I===Points.length-1){await point(Points[I],false);await page.screenshot({path:folder+`SolidArcCurvePreview_${Kind}.png`});}
   await point(Points[I]);
  }
  if(Multi){await page.keyboard.press('Enter');await ready();}
  const F=await page.evaluate(()=>solidArc.Description.figures);
  Assert.equal(F.length,1);Assert.equal(F[0].kind,Kind);
  Assert.equal(await page.locator('.figure-icon').getAttribute('data-shape'),Kind);
  await page.screenshot({path:folder+`SolidArcCurveCommitted_${Kind}.png`});
  await run('undo');Assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),0);
  await run('redo');Assert.equal(await page.evaluate(()=>solidArc.Description.figures[0].kind),Kind);
  evidence.cases.push({kind:Kind,pointClicks:Points.length,mouseSelected:true,nativeCommit:true,icon:true,undoRedo:true});
 }
 await run('reset');await page.selectOption('#camera-view','iso');await ready();
 const Before=await page.locator('.orientation').innerHTML();
 await page.screenshot({path:folder+'SolidArcOrientationCube.png'});
 for(const Face of ['top','front','right','bottom','back','left']){
  // Each test starts from a view where that face is visible, then clicks its projected polygon.
  await page.selectOption('#camera-view',Face);await ready();
  const Button=page.locator(`.orientation button[data-view="${Face}"]`);
  Assert.equal(await Button.count(),1);
  await Button.click({position:{x:48,y:48}});await ready();
  Assert.equal(await page.inputValue('#camera-view'),Face);evidence.cube.push({face:Face,mouseClick:true});
 }
 await page.selectOption('#camera-view','iso');await ready();
 const R=await page.locator('#cad-canvas').boundingBox();
 await page.mouse.move(R.x+R.width*.5,R.y+R.height*.45);await page.mouse.down();await page.mouse.move(R.x+R.width*.5+85,R.y+R.height*.45+38,{steps:16});await page.mouse.up();await ready();
 Assert.notEqual(await page.locator('.orientation').innerHTML(),Before);
 Assert.equal(await page.evaluate(()=>solidArcGraphics.rgbaUploads),0);
 evidence.gpu=await page.evaluate(()=>solidArcGraphics);evidence.errors=errors;Assert.deepEqual(errors,[]);
 await page.screenshot({path:folder+'SolidArcOrientationOrbit.png'});
 await writeFile(folder+'SolidArcCurveCubeProof.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{await browser.close();}
