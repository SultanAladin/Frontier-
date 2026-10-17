// Real WebGL replay of native intermediate/final bodies, plus four actual HTML
// Boolean mouse/Shift/Inspector/Apply transactions (including a safe refusal).
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {chromium} from '../../Experimental/SolidArc/node_modules/playwright/index.mjs';
import {CameraView} from '../../Experimental/SolidArc/src/CameraSequence.js';
const root=process.env.SOLIDARC_COMPLEX_OUT||'_AgentScratch/tmp/ComplexGeometry',data=JSON.parse(await readFile(`${root}/results.json`,'utf8')),plan=JSON.parse(await readFile(`${root}/capture-plan.json`,'utf8'));
await mkdir(`${root}/images`,{recursive:true});
const base=process.env.SOLIDARC_BASE_URL||'http://127.0.0.1:8081';
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'/tmp/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[],captures=[],ui=[];
const watch=page=>{page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.message));};
const ready=page=>page.waitForFunction(()=>window.solidArc?.Ready&&!solidArc.Busy&&!solidArc.Motion&&!solidArc.ResolveDetail);
function fit(packet){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const d of packet.frame.draws){if(!['surface','line'].includes(d.kind)||!(d.pick&16383))continue;for(let i=0;i<d.positions.length;i+=3){const p=d.positions.slice(i,i+3),m=d.local;for(let k=0;k<3;k++){const v=m[k]*p[0]+m[k+4]*p[1]+m[k+8]*p[2]+m[k+12];lo[k]=Math.min(lo[k],v);hi[k]=Math.max(hi[k],v);}}}if(!lo.every(Number.isFinite))return packet;const span=Math.max(...hi.map((x,k)=>x-lo[k])),camera={...packet.description.camera,pivot:lo.map((x,k)=>(x+hi[k])/2),distance:Math.max(.01,span*2.1),reach:Math.max(.01,span*1.3),yaw:-Math.PI/4,pitch:.72,roll:0};return{...packet,frame:{...packet.frame,view:CameraView(camera,packet.frame.width,packet.frame.height,packet.frame.view)}};}
try{
 const page=await browser.newPage({viewport:{width:1100,height:820}});watch(page);await page.goto(`${base}/gpu/`);await ready(page);
 await page.evaluate(()=>{solidArc.Worker.terminate();solidArc.Ready=false;Object.assign(document.querySelector('#cad-canvas').style,{position:'fixed',left:'0',top:'0',width:'1000px',height:'760px',zIndex:'99999'});});
 async function capture(id,stage,file){const bytes=gunzipSync(await readFile(`${root}/packets/${file}`)),p=fit(JSON.parse(bytes));const metrics=await page.evaluate(p=>{solidArc.Present(p);return solidArcGraphics;},p);assert.equal(metrics.rgbaUploads,0);const path=`${root}/images/${id}-${stage}.png`;await page.locator('#cad-canvas').screenshot({path});captures.push({id,stage,path,packet:file,packetSha256:createHash('sha256').update(bytes).digest('hex'),rgbaUploads:metrics.rgbaUploads,softwareDriver:metrics.softwareDriver,renderer:'Native C++ draw-packet replay; actual WebGL2 renderer; camera fit only in JS, no geometry substitution'});}
 for(const fixture of data.fixtures){if(fixture.sourcePacket)await capture(fixture.id,'source',fixture.sourcePacket);for(const stage of fixture.construction)if(stage.body&&stage.accepted&&stage.packet)await capture(fixture.id,`stage-${stage.index}`,stage.packet);for(const row of fixture.cases)if(row.accepted)await capture(row.id,'boolean',row.packet);}
 await page.close();
 const app=await browser.newPage({viewport:{width:1700,height:1050}});watch(app);await app.goto(`${base}/gpu/`);await ready(app);
 const command=async commands=>{await ready(app);const r=await app.evaluate(c=>solidArc.Command(c,false),commands);await ready(app);assert.ok(r.success,r.lines?.join('\n'));return r;};
 for(const row of plan.cases.filter(r=>r.ui)){
  const source=await command(['reset',...row.commands,'gizmo off','dim off','show cages off','view iso','view fit','selectmode whole','select none']);const a=source.description.figures.find(f=>f.name==='A').id,b=source.description.figures.find(f=>f.name==='B').id;
  await app.locator(`[data-figure="${a}"]`).click();await ready(app);await app.locator(`[data-figure="${b}"]`).click({modifiers:['Shift']});await ready(app);
  assert.deepEqual(await app.evaluate(()=>solidArc.Description.selectionOrder),[a,b]);
  if(row.operation.endsWith('-ba')){await app.locator('#reverse-selection').click();await ready(app);}
  const before=await app.evaluate(()=>structuredClone(solidArc.Description.figures));
  const op=row.operation.startsWith('union')?'union':row.operation.startsWith('intersect')?'intersect':'subtract';
  if(!row.accepted){
   const button=app.locator(`.ordered-selection [data-tool="${op}"]`);assert.equal(await button.isDisabled(),true);
   await button.click({force:true});assert.equal(await app.locator('#tool-dialog').evaluate(d=>d.open),false);assert.deepEqual(await app.evaluate(()=>solidArc.Description.figures),before);
   await app.screenshot({path:`${root}/images/${row.id}-html-ui-before-apply.png`});await app.screenshot({path:`${root}/images/${row.id}-html-ui-result.png`});
   ui.push({id:row.id,accepted:false,mouseOutliner:true,shiftSelection:true,operationButton:true,Apply:false,disabledBeforePopup:true,reason:await button.getAttribute('title'),transactionChecked:true});console.log('PASS complex HTML disabled-operation guard',row.id);continue;
  }
  await app.locator(`.ordered-selection [data-tool="${op}"]`).click();await app.screenshot({path:`${root}/images/${row.id}-html-ui-before-apply.png`});
  await app.locator('#apply-tool').click();await ready(app);
  if(row.accepted){await app.waitForFunction(()=>!document.querySelector('#tool-dialog').open);const after=await app.evaluate(()=>structuredClone(solidArc.Description.figures));const bodies=after.filter(f=>f.classification===2);assert.equal(bodies.length,1);const topology=await command(`topology #${bodies[0].id} --summary`);const line=topology.lines.find(l=>l.includes('closed yes manifold yes oriented yes'));assert.ok(line);const volume=Number(line.match(/volume ([\d.eE+-]+)/)[1]);assert.ok(Math.abs(volume-row.topology.volume)<1e-5*Math.max(1,volume));await app.screenshot({path:`${root}/images/${row.id}-html-ui-result.png`});assert.deepEqual((await command('undo')).description.figures,before);assert.deepEqual((await command('redo')).description.figures,after);}
  else{await app.waitForFunction(()=>document.querySelector('#tool-error').textContent.trim().length>0&&!solidArc.Busy);assert.deepEqual(await app.evaluate(()=>solidArc.Description.figures),before);await app.screenshot({path:`${root}/images/${row.id}-html-ui-result.png`});await app.keyboard.press('Escape');}
  ui.push({id:row.id,accepted:row.accepted,mouseOutliner:true,shiftSelection:true,operationButton:true,Apply:true,transactionChecked:true});console.log('PASS complex HTML Boolean UI',row.id,row.accepted);
 }
 assert.equal(ui.length,plan.expectedUI||4);assert.deepEqual(errors,[]);await writeFile(`${root}/captures.json`,JSON.stringify({captures,ui,pageErrors:errors},null,2));console.log('CAPTURES',captures.length,'UI',ui.length);
}finally{await browser.close();}
