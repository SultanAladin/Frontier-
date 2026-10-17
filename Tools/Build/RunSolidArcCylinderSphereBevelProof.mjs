// Actual HTML mouse selection, B popup, signed input and Apply on native C++.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const folder='_AgentScratch/tmp/CylinderSphereBevelBrowser';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'/tmp/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(120000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail,null,{timeout:120000});
const command=async commands=>{await ready();const r=await page.evaluate(c=>solidArc.Command(c,false),commands);await ready();assert.ok(r.success,r.lines?.join('\n'));return r;};
const cases=[];
try{
 await page.goto(process.env.SOLIDARC_URL||'http://127.0.0.1:8081/gpu/');await ready();
 for(const order of [0,1])for(const mode of ['fillet','chamfer'])for(const edge of [1,2]){
  await command(['reset','sphere (0,0,0) 1','cylinder (0,0,0) .6 2',`boolean subtract ${order?'#2 -- #1':'#1 -- #2'} --select-result`,'view iso','view fit','gizmo off','dim off','show cages off','selectmode edge','select none']);
  await page.evaluate(async({order,edge})=>{const c=structuredClone(solidArc.Description.camera);c.pitch=order&&edge===2?-.7:.8;c.distance*=.6;await solidArc.Request('render',{camera:c});},{order,edge});await ready();
  const fixture=await page.evaluate(()=>structuredClone(solidArc.Description.figures));
  assert.equal(fixture.at(-1).faces,3);assert.equal(fixture.at(-1).edges,order?3:4);
  let selected=false;
  for(const fraction of [.5,.35,.65,.2,.8,.1,.9]){
   const pos=await page.evaluate(({edge,fraction})=>{const f=solidArc.Device.LastFrame,d=f.draws.find(d=>d.kind==='line'&&(d.pick&16383)===3&&(d.pick>>>16)===edge+1),p=d.positions,m=f.view.ViewClip;const i=Math.min(p.length/3-2,Math.floor((p.length/3-1)*fraction))*3;const xyz=[0,1,2].map(j=>(p[i+j]+p[i+3+j])*.5),c=[0,1,2,3].map(r=>xyz.reduce((v,x,k)=>v+m[r+4*k]*x,m[r+12]));const rect=document.querySelector('#cad-canvas').getBoundingClientRect();return {x:rect.x+(c[0]/c[3]+1)*rect.width/2,y:rect.y+(c[1]/c[3]+1)*rect.height/2};},{edge,fraction});
   for(const [dx,dy] of [[0,0],[-1,0],[1,0],[0,1],[0,-1]]){
    await page.mouse.click(pos.x+dx,pos.y+dy);await ready();selected=await page.evaluate(e=>solidArc.Description.figures.find(f=>f.id===3).pickedEdges.includes(e),edge);if(selected)break;
   }
   if(selected)break;
  }
  assert.ok(selected,`mouse edge ${edge}`);
  const source=await page.evaluate(()=>structuredClone(solidArc.Description.figures));
  await page.keyboard.press('b');await page.waitForFunction(()=>solidArc.Description.bevel.active);await ready();
  await page.locator('#bevel-size').fill(mode==='fillet'?'.0375':'-.0375');
  await page.waitForFunction(mode=>solidArc.Description.bevel.valid&&solidArc.Description.bevel.size===.0375&&solidArc.Description.bevel.chamfer===(mode==='chamfer')&&!document.querySelector('#bevel-apply').disabled,mode);await ready();
  assert.deepEqual(await page.evaluate(()=>solidArc.Description.figures),source);
  await page.screenshot({path:`${folder}/${order}-${mode}-e${edge}-preview.png`});
  await page.locator('#bevel-apply').click();await ready();await page.waitForFunction(()=>!solidArc.Description.bevel.active);
  const figure=await page.evaluate(()=>structuredClone(solidArc.Description.figures.find(f=>f.id===3)));
  assert.equal(figure.bevelFeatures.length,1);assert.equal(figure.bevelFeatures[0].mode,mode);
  const topology=await command('topology #3 --summary');assert.ok(topology.lines.some(l=>l.includes('closed yes manifold yes oriented yes')));
  await page.screenshot({path:`${folder}/${order}-${mode}-e${edge}-applied.png`});
  await page.locator('#history-strip [data-bevel-feature="1"]').click();await page.waitForFunction(()=>solidArc.Description.bevel.active&&solidArc.Description.bevel.feature===1);await ready();
  await page.locator('#bevel-size').fill('100m');await page.waitForFunction(()=>!solidArc.Description.bevel.valid&&document.querySelector('#bevel-apply').disabled);await ready();
  assert.deepEqual(await page.evaluate(()=>solidArc.Description.figures.find(f=>f.id===3)),figure);
  await page.locator('#bevel-cancel').click();await page.waitForFunction(()=>!solidArc.Description.bevel.active);await ready();
  const after=await page.evaluate(()=>structuredClone(solidArc.Description.figures));
  assert.deepEqual((await command('undo')).description.figures,source);assert.deepEqual((await command('redo')).description.figures,after);

  cases.push({order,edge,mode,historyButton:true,cancelButton:true,invalidApplyDisabled:true,undoRedo:true,size:.0375,mouse:true,shortcutB:true,signedInput:true,apply:true,closedManifoldOriented:true});
  console.log('PASS HTML',order,mode,edge);
 }
 assert.deepEqual(errors,[]);await writeFile(`${folder}/results.json`,JSON.stringify({cases,errors,graphics:await page.evaluate(()=>solidArcGraphics)},null,2));
}finally{await page.evaluate(()=>solidArc?.Worker?.terminate()).catch(()=>{});await browser.close();}
