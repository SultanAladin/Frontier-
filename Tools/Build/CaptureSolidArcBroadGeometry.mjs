// Replay native C++ draw packets through the real WebGL renderer (not UI proof),
// then independently exercise a clearly marked known-success HTML mouse subset.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
const folder='_AgentScratch/tmp/BroadGeometry',matrix=JSON.parse(await readFile(`${folder}/results.json`,'utf8'));
await mkdir(`${folder}/images`,{recursive:true});
const base=process.env.SOLIDARC_BASE_URL||'http://127.0.0.1:8081';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'/tmp/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[],captures=[],ui=[];
const watch=page=>{page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));};
const ready=page=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
try{
 const page=await browser.newPage({viewport:{width:1100,height:820}});watch(page);
 await page.goto(`${base}/gpu/`);await ready(page);
 // Isolated playback: stop this fresh native session before feeding recorded frames.
 await page.evaluate(()=>{solidArc.Worker.terminate();solidArc.Ready=false;const canvas=document.querySelector('#cad-canvas');Object.assign(canvas.style,{position:'fixed',left:'0',top:'0',width:'1000px',height:'760px',zIndex:'99999'});});
 const sources=new Set();
 for(const row of matrix.cases){
  for(const [stage,name] of Object.entries(row.stages)){
   if(!['source','boolean','fillet','chamfer'].includes(stage))continue;
   if(stage==='source'&&sources.has(row.fixture))continue;
   if(stage==='source')sources.add(row.fixture);
   const bytes=gunzipSync(await readFile(`${folder}/packets/${name}`)),packet=JSON.parse(bytes);
   const graphics=await page.evaluate(packet=>{solidArc.Present(packet);return solidArcGraphics;},packet);
   assert.equal(graphics.rgbaUploads,0);assert.equal(packet.frame.cpuFragments,0);
   const id=stage==='source'?row.fixture:row.id;
   const path=`${folder}/images/${id}-${stage}.png`;
   await page.locator('#cad-canvas').screenshot({path});
   captures.push({id,stage,path,packet:name,packetSha256:createHash('sha256').update(bytes).digest('hex'),renderer:'Real WebGL2 renderer replaying recorded native C++ draw commands; not mouse-input evidence',softwareDriver:graphics.softwareDriver,rgbaUploads:graphics.rgbaUploads});
  }
 }
 await page.close();
 const app=await browser.newPage({viewport:{width:1600,height:1000}});watch(app);
 await app.goto(`${base}/gpu/`);await ready(app);
 const command=async commands=>{await ready(app);const r=await app.evaluate(c=>solidArc.Command(c,false),commands);await ready(app);assert.ok(r.success,r.lines?.join('\n'));return r;};
 const families=['offset-boxes','rotated-boxes','sphere-box','sphere-sphere','cone-sphere','torus-box','extruded-hexagon','translated-sphere-cylinder'];
 for(const fixture of families){
  const row=matrix.cases.find(r=>r.fixture===fixture&&r.blends.some(b=>b.accepted&&!b.multiple));
  assert.ok(row,fixture);const blend=row.blends.find(b=>b.accepted&&!b.multiple),edge=Number(blend.targets);
  const result=await command(['reset',...row.commands,row.booleanCommand,'gizmo off','dim off','show cages off','view iso','view fit','selectmode edge','select none']);
  const owner=result.description.figures.find(f=>f.name==='Result').id;
  let selected=false;
  outer:for(const pitch of [.65,-.65,1.1,-1.1])for(const yaw of [-Math.PI/4,Math.PI/4,3*Math.PI/4,-3*Math.PI/4]){
   await app.evaluate(async({pitch,yaw})=>{const camera=structuredClone(solidArc.Description.camera);camera.pitch=pitch;camera.yaw=yaw;await solidArc.Request('render',{camera});},{pitch,yaw});await ready(app);
   for(const fraction of [.5,.25,.75,.125,.875,.375,.625]){
    const pos=await app.evaluate(({owner,edge,fraction})=>{const frame=solidArc.Device.LastFrame,draw=frame.draws.find(d=>d.kind==='line'&&(d.pick&16383)===owner&&(d.pick>>>16)===edge+1);if(!draw)return null;const p=draw.positions,m=frame.view.ViewClip,i=Math.min(p.length/3-2,Math.floor((p.length/3-1)*fraction))*3;const xyz=[0,1,2].map(j=>(p[i+j]+p[i+3+j])*.5),clip=[0,1,2,3].map(r=>xyz.reduce((v,x,k)=>v+m[r+4*k]*x,m[r+12])),rect=document.querySelector('#cad-canvas').getBoundingClientRect();return{x:rect.x+(clip[0]/clip[3]+1)*rect.width/2,y:rect.y+(clip[1]/clip[3]+1)*rect.height/2};},{owner,edge,fraction});
    if(!pos)continue;
    for(const [dx,dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){
     await app.mouse.click(pos.x+dx,pos.y+dy);await ready(app);
     selected=await app.evaluate(({owner,edge})=>solidArc.Description.figures.find(f=>f.id===owner).pickedEdges.includes(edge),{owner,edge});if(selected)break outer;
    }
   }
  }
  assert.ok(selected,`Actual HTML mouse edge: ${row.id} e${edge}`);
  const before=await app.evaluate(()=>structuredClone(solidArc.Description.figures));
  await app.keyboard.press('b');await app.waitForFunction(()=>solidArc.Description.bevel.active);await ready(app);
  await app.locator('#bevel-size').fill(String(blend.mode==='chamfer'?-blend.size:blend.size));
  await app.waitForFunction(({size,mode})=>solidArc.Description.bevel.valid&&Math.abs(solidArc.Description.bevel.size-size)<1e-12&&solidArc.Description.bevel.chamfer===(mode==='chamfer')&&!document.querySelector('#bevel-apply').disabled,blend);await ready(app);
  assert.deepEqual(await app.evaluate(()=>solidArc.Description.figures),before);
  await app.screenshot({path:`${folder}/images/${row.id}-html-ui-preview.png`});
  await app.locator('#bevel-apply').click();await app.waitForFunction(()=>!solidArc.Description.bevel.active);await ready(app);
  const after=await app.evaluate(()=>structuredClone(solidArc.Description.figures));assert.equal(after.find(f=>f.id===owner).bevelFeatures.length,1);
  await app.screenshot({path:`${folder}/images/${row.id}-html-ui-applied.png`});
  assert.deepEqual((await command('undo')).description.figures,before);assert.deepEqual((await command('redo')).description.figures,after);
  await app.locator('#history-strip [data-bevel-feature="1"]').click();await app.waitForFunction(()=>solidArc.Description.bevel.active&&solidArc.Description.bevel.feature===1);await ready(app);
  await app.locator('#bevel-cancel').click();await app.waitForFunction(()=>!solidArc.Description.bevel.active);await ready(app);
  ui.push({id:row.id,fixture,edge,mode:blend.mode,size:blend.size,mouse:true,B:true,signedInput:true,Apply:true,historyButton:true,cancel:true,undoRedo:true,previewAtomic:true});
  await writeFile(`${folder}/html-ui.json`,JSON.stringify(ui,null,2));console.log('PASS broad HTML UI',row.id);
 }
 assert.equal(ui.length,8);assert.deepEqual(errors,[]);
 await writeFile(`${folder}/captures.json`,JSON.stringify({captures,ui,pageErrors:errors},null,2));
 console.log('PASS native-packet GPU captures',captures.length,'HTML mouse cases',ui.length);
}finally{await browser.close();}
