// Browser input evidence for the existing WebGL2 renderer, NOT native Vulkan proof.
// Requires: npm ci in Experimental/SolidArc and the preview's /gpu/ + /native routes.
import Assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const folder=root+'Exhibits/Gallery/Editor/GpuDrawingFrames/';
await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true,
 ...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),
 args:['--no-sandbox','--disable-dev-shm-usage',...JSON.parse(process.env.BROWSER_ARGS||'[]')]});
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.setDefaultTimeout(60000);
const errors=[],frames=[],actions=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 window.drawingWitness={drawCalls:0,cpuImages:0};
 for(const name of ['drawArrays','drawElements','drawArraysInstanced']){
  const fn=WebGL2RenderingContext.prototype[name];
  WebGL2RenderingContext.prototype[name]=function(...args){drawingWitness.drawCalls++;return fn.apply(this,args)};
 }
 const fn=CanvasRenderingContext2D.prototype.putImageData;
 CanvasRenderingContext2D.prototype.putImageData=function(...args){drawingWitness.cpuImages++;return fn.apply(this,args)};
});
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
const capture=async(stage,duration=180)=>{
 await ready();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const file=`${String(frames.length).padStart(2,'0')}.png`;
 await page.screenshot({path:folder+file});frames.push({file,stage,duration});
};
const point=async(p)=>page.evaluate(p=>{
 const m=solidArc.Flow.Base.frame.view.ViewClip,r=document.querySelector('#cad-canvas').getBoundingClientRect();
 const v=[0,1,2,3].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*(p[2]||0)+m[i+12]);
 return [r.x+(v[0]/v[3]+1)*r.width/2,r.y+(1-v[1]/v[3])*r.height/2];
},p);
const move=async(p)=>{await page.mouse.move(...await point(p),{steps:4});};
const click=async(p)=>{await page.mouse.click(...await point(p));await ready();};
try {
 await page.goto(process.env.SOLIDARC_URL||'http://127.0.0.1:8082/gpu/');await ready();
 Assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),0);
 // Camera setup only; all tool selection and shape points below are browser input.
 await page.locator('#camera-view').selectOption('top');await ready();
 await capture('Empty GPU editor',650);
 await page.locator('#construct-button').click();
 await page.locator('[data-section="Sketch Draw"]').click();
 await capture('Construct menu — Sketch Draw',1400);
 await page.locator('[data-construct="3"]').click();actions.push('Construct → Sketch Draw → Rectangle');
 await click([-2,-1]);actions.push('Rectangle first corner: mouse click');
 for(let i=1;i<=9;i++){await move([-2+2*i/9,-1+2*i/9]);await capture('Rectangle mouse preview');Assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),0);}
 await capture('Live rectangle dimensions',800);
 await click([0,1]);actions.push('Rectangle second corner: mouse click');
 await page.waitForFunction(()=>solidArc.Description.figures.length===1);
 await capture('Native rectangle committed, GPU raster',900);
 await page.locator('#construct-button').click();await page.locator('[data-section="Sketch Draw"]').click();
 await capture('Construct menu — choose Circle',900);
 await page.locator('[data-construct="6"]').click();actions.push('Construct → Sketch Draw → Circle');
 await click([2,0]);actions.push('Circle centre: mouse click');
 for(let i=1;i<=8;i++){await move([2+i/8,0]);await capture('Circle radius mouse preview');Assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),1);}
 await click([3,0]);actions.push('Circle radius: mouse click');
 await page.waitForFunction(()=>solidArc.Description.figures.length===2);
 await capture('Rectangle + circle committed by C++',1200);
 const proof=await page.evaluate(()=>({graphics:solidArcGraphics,witness:drawingWitness,figures:solidArc.Description.figures.map(f=>({id:f.id,name:f.name,classification:f.classification})),glError:solidArc.Device.Gl.getError(),nativeSession:!!solidArc.NativeSession}));
 Assert.equal(proof.graphics.backend,'WebGL2');Assert.equal(proof.graphics.rgbaUploads,0);Assert.equal(proof.witness.cpuImages,0);Assert.ok(proof.witness.drawCalls>0);Assert.equal(proof.glError,0);Assert.equal(proof.nativeSession,true);Assert.deepEqual(errors,[]);
 proof.scope='Browser WebGL2 drawing from native C++ command packets; NOT native Vulkan. Software adapter, if reported, is not physical GPU execution.';
 proof.actions=actions;proof.frames=frames;proof.errors=errors;
 await writeFile(root+'Exhibits/Gallery/Editor/SolidArcGpuDrawing.json',JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof,null,2));
} finally {await browser.close();}
