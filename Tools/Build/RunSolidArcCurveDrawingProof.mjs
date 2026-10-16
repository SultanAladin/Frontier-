// Real browser mouse construction. C++ owns committed curves; WebGL2 draws previews.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1800,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
const point=p=>page.evaluate(p=>{
 const m=solidArc.Flow.Base.frame.view.ViewClip,r=document.querySelector('#cad-canvas').getBoundingClientRect();
 const v=[0,1,2,3].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+12]);
 return [r.x+(v[0]/v[3]+1)*r.width/2,r.y+(1+v[1]/v[3])*r.height/2];
},p);
const folder='Exhibits/Gallery/Editor/';
const cases=[['hermite',27,[[-3,1],[-1,1],[-3,4],[-1,4],[1,1],[1,-2]],true],['bezier',28,[[1,1],[1,3],[3,3],[3,1]],true],['bspline',29,[[-3,-1.5],[-2,0],[-1,-2],[0,-1]],true],['nurbs',30,[[1,-1.5],[2,0],[3,-1.5]],true]];
const result={scope:'Browser WebGL2 / SwiftShader software adapter; native C++ curve commits',cases:[]};
try {
 await page.goto(process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/');await ready();
 await page.evaluate(()=>solidArc.Command(['reset','gizmo off']));await ready();
 await page.selectOption('#camera-view','top');await ready();
 for(const [tool,index,points,multi] of cases){
  await page.click('#construct-button');await page.click('[data-section="Sketch Draw"]');
  const metrics=await page.locator('#construct-tiles').evaluate(e=>({height:e.clientHeight,content:e.scrollHeight}));
  assert.ok(metrics.content>metrics.height,'catalogue must overflow and scroll');
  await page.locator('#construct-tiles').hover();await page.mouse.wheel(0,1200);
  await page.waitForFunction(()=>document.querySelector('#construct-tiles').scrollTop>0);
  if(tool==='hermite'){
   result.scroll={...metrics,scrollTop:await page.locator('#construct-tiles').evaluate(e=>e.scrollTop)};
   await page.screenshot({path:folder+'SolidArcCurveMenu.png'});
  }
  await page.click(`[data-construct="${index}"]`);
  assert.equal(await page.evaluate(()=>solidArc.Flow.Drawing.tool),tool);
  if(tool==='bspline'||tool==='nurbs')await page.fill('#draw-degree','2');
  if(tool==='nurbs')await page.fill('#draw-weights','1,3,1');
  for(let i=0;i<points.length;i++){
   await page.mouse.move(...await point(points[i]),{steps:12});
   await page.evaluate(()=>new Promise(requestAnimationFrame));
   if(i===points.length-1){
    assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),result.cases.length,'preview must not commit');
    await page.screenshot({path:folder+`SolidArcCurvePreview_${tool}.png`});
   }
   await page.mouse.click(...await point(points[i]));await ready();
   if(multi||i<points.length-1)assert.equal(await page.evaluate(()=>solidArc.Flow.Drawing.points.length),i+1,"each click must hit the canvas, not the controls");
  }
  if(multi)await page.keyboard.press('Enter');await ready();
  await page.waitForFunction(n=>solidArc.Description.figures.length===n,result.cases.length+1);
  assert.equal(await page.evaluate(()=>solidArc.Description.figures.at(-1).poles),tool==="hermite"?7:points.length);
  result.cases.push({tool,mouseClicks:points.length,livePreview:true,figure:await page.evaluate(()=>solidArc.Description.figures.at(-1))});
 }
 await page.screenshot({path:folder+'SolidArcCurvesDrawn.png'});
 const before=await page.evaluate(()=>solidArc.Description.figures.length);
 await page.evaluate(()=>solidArc.Command('undo'));await ready();assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),before-1);
 await page.evaluate(()=>solidArc.Command('redo'));await ready();assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),before);
 result.undoRedo=true;result.graphics=await page.evaluate(()=>solidArcGraphics);assert.equal(result.graphics.rgbaUploads,0);assert.deepEqual(errors,[]);result.errors=errors;
 await writeFile(folder+'SolidArcCurveDrawingProof.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
