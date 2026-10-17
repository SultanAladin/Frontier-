// Native/HTML camera parity, including pole crossings and nonzero roll.
import Assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {CopyCamera,MoveCamera,CameraView} from '../../Experimental/SolidArc/src/CameraSequence.js';
const native=spawn('_AgentScratch/build/SolidArcNative/GeometryHost',[],{stdio:['pipe','pipe','inherit']});
const lines=createInterface({input:native.stdout})[Symbol.asyncIterator]();
async function request(action,values={}){
 native.stdin.write(JSON.stringify({action,identity,width:800,height:600,...values})+'\n');
 while(true){const {value,done}=await lines.next();if(done)throw Error('Native host exited');if(value.startsWith('SOLIDARC_PACKET ')){const R=JSON.parse(value.slice(16));Assert.ok(!R.error,R.error);return R;}}
}
let identity=0,count=0;
const near=(A,B,eps=3e-5)=>Assert.ok(Math.abs(A-B)<eps,`${A} != ${B}`);
try{
 identity=(await request('create')).description.identity;
 for(const view of ['top','bottom','front','back','right','left','iso']){
  const Start=await request('command',{commands:['view '+view]}),C=CopyCamera(Start.description.camera);
  for(const [X,Y] of [[-.57,0],[.13,.19],[0,-.4],[.8,-.7]]){
   const Before=CopyCamera(C);MoveCamera(C,'orbit',X,Y);
   const R=await request('orbit',{x:X,y:Y}),Seen=R.description.camera;
   near(Seen.distance,Before.distance,1e-10);Seen.pivot.forEach((V,I)=>near(V,Before.pivot[I],1e-10));
   const Predicted=CameraView(C,800,600,Start.frame.view);
   for(const field of ['ViewClip','ViewWorld','ClipView'])R.frame.view[field].forEach((V,I)=>near(V,Predicted[field][I]));
   near(Seen.roll,0,1e-10);near(R.frame.view.ViewWorld[2],0,1e-10);
   Assert.ok(R.frame.view.ViewWorld[6]>=0,'world Z must remain screen-up');
   if(Y===0)near(Seen.pitch,Before.pitch,1e-10);
   ++count;
  }
 }
 for(const view of ['front','back','right','left','iso']){
  const Start=await request('command',{commands:['view '+view]}),C=CopyCamera(Start.description.camera);
  for(const [X,Y] of [[-.576,0],[0,.288]]){
   const Before=CopyCamera(C);MoveCamera(C,'turntable',X,Y);
   const R=await request('turntable',{x:X,y:Y}),Seen=R.description.camera;
   near(Seen.yaw,Before.yaw+X,1e-8);near(Seen.pitch,Before.pitch+Y,1e-8);near(Seen.roll,0,1e-10);
   Assert.deepEqual(Seen.pivot,Before.pivot);near(Seen.distance,Before.distance,1e-10);
   const Predicted=CameraView(C,800,600,Start.frame.view);
   R.frame.view.ViewWorld.forEach((V,I)=>near(V,Predicted.ViewWorld[I]));
  }
 }
 const Old=(await request('command',{commands:['view iso']})).description.camera;
 const Migrated=await request('render',{camera:{...Old,roll:1.1}});
 near(Migrated.description.camera.roll,0,1e-10);near(Migrated.frame.view.ViewWorld[2],0,1e-10);
 console.log('PASS: legacy rolled camera state restores upright');
 console.log('PASS: 10 RMB axis-isolation cases: horizontal world-Z only; vertical elevation only; zero roll; native/HTML parity');
 console.log(`PASS: ${count} native/HTML upright orbit steps; fixed pivot/radius, zero roll and world-Z-up matrix parity`);
}finally{native.stdin.end();}
