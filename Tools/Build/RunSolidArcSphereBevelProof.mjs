// Actual HTML mouse selection, B popup, signed input and Apply on native C++.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const folder='_AgentScratch/tmp/SphereBevelBrowser';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'/tmp/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(120000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail,null,{timeout:120000});
const command=async commands=>{await ready();const r=await page.evaluate(c=>solidArc.Command(c,false),commands);await ready();assert.ok(r.success,r.lines?.join('\n'));return r;};
const cases=[];
try{
 await page.goto(process.env.SOLIDARC_URL||'http://127.0.0.1:8083/');await ready();
 for(const mode of ['fillet','chamfer'])for(const edge of [1,2,3,4,5,6]){
  await command(['reset','box (0,0,0) (4,3,2)','box (2,0,0) (6,3,2)','sphere (0,0,0) .75','boolean subtract #3 -- #1 --select-result','hide #2','view iso','view fit','gizmo off','dim off','show cages off','selectmode edge','select none']);
  await page.evaluate(async()=>{const c=structuredClone(solidArc.Description.camera);c.yaw=2.356194490192345;await solidArc.Request('render',{camera:c});});await ready();
  let selected=false;
  for(const fraction of [.5,.35,.65]){
   const pos=await page.evaluate(({edge,fraction})=>{const f=solidArc.Device.LastFrame,d=f.draws.find(d=>d.kind==='line'&&(d.pick&16383)===4&&(d.pick>>>16)===edge+1),p=d.positions,m=f.view.ViewClip;const i=Math.min(p.length/3-2,Math.floor((p.length/3-1)*fraction))*3;const xyz=[0,1,2].map(j=>(p[i+j]+p[i+3+j])*.5),c=[0,1,2,3].map(r=>xyz.reduce((v,x,k)=>v+m[r+4*k]*x,m[r+12]));const rect=document.querySelector('#cad-canvas').getBoundingClientRect();return {x:rect.x+(c[0]/c[3]+1)*rect.width/2,y:rect.y+(c[1]/c[3]+1)*rect.height/2};},{edge,fraction});
   for(const [dx,dy] of [[0,0],[-1,0],[1,0],[0,1],[0,-1]]){
    await page.mouse.click(pos.x+dx,pos.y+dy);await ready();selected=await page.evaluate(e=>solidArc.Description.figures.find(f=>f.id===4).pickedEdges.includes(e),edge);if(selected)break;
   }
   if(selected)break;
  }
  assert.ok(selected,`mouse edge ${edge}`);
  await page.keyboard.press('b');await page.waitForFunction(()=>solidArc.Description.bevel.active);await ready();
  await page.locator('#bevel-size').fill(mode==='fillet'?'.0375':'-.0375');
  await page.waitForFunction(()=>solidArc.Description.bevel.valid&&!document.querySelector('#bevel-apply').disabled);await ready();
  if(edge===3)await page.screenshot({path:`${folder}/${mode}-preview.png`});
  await page.locator('#bevel-apply').click();await ready();await page.waitForFunction(()=>!solidArc.Description.bevel.active);
  const figure=await page.evaluate(()=>structuredClone(solidArc.Description.figures.find(f=>f.id===4)));
  assert.equal(figure.bevelFeatures.length,1);assert.equal(figure.bevelFeatures[0].mode,mode);
  const topology=await command('topology #4 --summary');assert.ok(topology.lines.some(l=>l.includes('closed yes manifold yes oriented yes')));
  if(edge===3)await page.screenshot({path:`${folder}/${mode}-applied.png`});
  cases.push({edge,mode,size:.0375,mouse:true,shortcutB:true,signedInput:true,apply:true,closedManifoldOriented:true});
  console.log('PASS HTML',mode,edge);
 }
 assert.deepEqual(errors,[]);await writeFile(`${folder}/results.json`,JSON.stringify({cases,errors,graphics:await page.evaluate(()=>solidArcGraphics)},null,2));
}finally{await page.evaluate(()=>solidArc?.Worker?.terminate()).catch(()=>{});await browser.close();}
