// All named views: shader grid axes, mouse ray placement, native plane and bounds.
import Assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),folder=root+'Exhibits/Gallery/Editor/ViewGrid/';
await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage',...JSON.parse(process.env.BROWSER_ARGS||'[]')]});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],cases=[];
page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
const run=async c=>{await page.evaluate(c=>solidArc.Command(c,false),c);await ready()};
const capture=async name=>{await page.screenshot({path:folder+name+'.png'})};
const near=(a,b,t=.025)=>Assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const pixel=uv=>page.evaluate(uv=>{
 const plane=solidArc.Description.workplane,m=solidArc.Flow.Base.frame.view.ViewClip,r=document.querySelector('#cad-canvas').getBoundingClientRect();
 const p=plane.origin.map((v,i)=>v+plane.x[i]*uv[0]+plane.y[i]*uv[1]);
 const q=[0,1,2,3].map(i=>m[i]*p[0]+m[i+4]*p[1]+m[i+8]*p[2]+m[i+12]);
 return [r.x+(q[0]/q[3]+1)*r.width/2,r.y+(q[1]/q[3]+1)*r.height/2];
},uv);
try{
 await page.goto(process.env.SOLIDARC_URL||'http://127.0.0.1:8082/gpu/');await ready();
 for(const [view,normal,axes] of [['top',2,['red','green']],['bottom',2,['red','green']],['front',1,['red','blue']],['back',1,['red','blue']],['right',0,['green','blue']],['left',0,['green','blue']],['iso',0,['green','blue']]]){
  await run('reset');
  // Isometric retains the last explicit plane, rather than silently forcing XY.
  if(view==='iso')await run('workplane yz');
  await page.locator('#camera-view').selectOption(view);await ready();
  await capture(view+'-grid');
  const grid=await page.evaluate(()=>{
   const g=solidArc.Device.Gl,c=solidArc.Device.Canvas,p=new Uint8Array(c.width*c.height*4),counts={red:0,green:0,blue:0};
   g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,p);
   for(let i=0;i<p.length;i+=4){const r=p[i],b=p[i+2],v=p[i+1];if(r>60&&r>v*1.5&&r>b*1.5)counts.red++;if(v>60&&v>r*1.4&&v>b*1.2)counts.green++;if(b>70&&b>r*1.4&&b>v*1.2)counts.blue++;}
   return {counts,plane:solidArc.Description.workplane,uniforms:{origin:solidArc.Flow.Base.frame.view.LatticeOrigin,u:solidArc.Flow.Base.frame.view.LatticeAxisU,v:solidArc.Flow.Base.frame.view.LatticeAxisV}};
  });
  for(const axis of axes)Assert.ok(grid.counts[axis]>15,`${view}: missing ${axis} grid axis: ${JSON.stringify(grid)}`);
  Assert.deepEqual(grid.uniforms.origin.slice(0,3),grid.plane.origin);
  await page.locator('#construct-button').click();await page.locator('[data-section="Sketch Draw"]').click();await page.locator('[data-construct="3"]').click();
  await page.mouse.click(...await pixel([.5,.6]));await ready();
  const first=await page.evaluate(()=>solidArc.Flow.Drawing.points[0]);near(first[0],.5);near(first[1],.6);
  const target=await pixel([2.3,1.7]);await page.mouse.move(...target,{steps:12});
  await page.waitForFunction(()=>document.querySelectorAll('#drawing-labels span').length===2);
  Assert.equal(await page.evaluate(()=>solidArc.Description.figures.length),0);
  await capture(view+'-drawing');
  await page.mouse.click(...target);await ready();await page.waitForFunction(()=>solidArc.Description.figures.length===1);
  const figure=await page.evaluate(()=>solidArc.Description.figures[0]);near(figure.high[normal],0);near(figure.low[normal],0);
  const world=([u,v])=>grid.plane.origin.map((o,i)=>o+grid.plane.x[i]*u+grid.plane.y[i]*v);
  const a=world([.5,.6]),b=world([2.3,1.7]);for(let i=0;i<3;i++){near(figure.low[i],Math.min(a[i],b[i]));near(figure.high[i],Math.max(a[i],b[i]));}
  await capture(view+'-completed');
  cases.push({view,normal,axes,grid,first,low:figure.low,high:figure.high});console.log('PASS',view,'grid/axes, pointer preview, native rectangle plane/bounds');
 }
 // Offset/custom plane and camera gestures must preserve the same grid/hit plane.
 await run('reset');await page.locator('#camera-view').selectOption('right');await ready();await run('workplane yz --origin=(2,0,0)');
 const offset=await page.evaluate(()=>({plane:solidArc.Description.workplane,grid:solidArc.Flow.Base.frame.view.LatticeOrigin}));near(offset.grid[0],2);
 await page.locator('#construct-button').click();await page.locator('[data-section="Sketch Draw"]').click();await page.locator('[data-construct="3"]').click();
 await page.mouse.click(...await pixel([.5,.6]));await page.mouse.click(...await pixel([2.3,1.7]));await ready();
 const f=await page.evaluate(()=>solidArc.Description.figures[0]);near(f.low[0],2);near(f.high[0],2);console.log('PASS offset YZ: grid and native drawing x=2');
 Assert.deepEqual(errors,[]);
 await writeFile(folder+'Results.json',JSON.stringify({cases,offset,errors,renderer:await page.evaluate(()=>solidArcGraphics)},null,2));
}finally{await browser.close()}
