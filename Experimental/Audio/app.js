(() => {
'use strict';
const $ = s => document.querySelector(s);
const state = {
  manifest:null, assets:[], categories:[], category:'all', selected:null, buffer:null,
  context:null, source:null, nodes:null, startedAt:0, pausedAt:0, playing:false, loop:false,
  trimStart:0, trimEnd:0, zoom:1, raf:0, history:[], future:[], compare:null,
  params:{gain:0,pitch:0,pan:0,lowpass:20000,highpass:20,threshold:-18,ratio:3,attack:.01,release:.25,reverb:0,width:100}
};
const specs = [
 {title:'Source',hint:'Level & tuning',items:[['gain','Gain',-24,12,.1,'dB'],['pitch','Pitch',-12,12,.1,'st'],['pan','Stereo pan',-100,100,1,'%']]},
 {title:'Equalizer',hint:'Tone shaping',items:[['highpass','High-pass',20,1200,1,'Hz'],['lowpass','Low-pass',800,20000,10,'Hz']]},
 {title:'Dynamics',hint:'Transient control',items:[['threshold','Threshold',-60,0,.5,'dB'],['ratio','Ratio',1,20,.1,':1'],['attack','Attack',.001,.2,.001,'s'],['release','Release',.05,1,.01,'s']]},
 {title:'Space',hint:'Environment',items:[['reverb','Reverb',0,100,1,'%'],['width','Stereo width',0,200,1,'%']]}
];
const presets = {
 natural:{gain:0,pitch:0,pan:0,lowpass:20000,highpass:20,threshold:-18,ratio:3,attack:.01,release:.25,reverb:0,width:100},
 distance:{gain:-5,pitch:-.8,pan:0,lowpass:4200,highpass:70,threshold:-24,ratio:2.4,attack:.03,release:.42,reverb:36,width:120},
 cockpit:{gain:-2,pitch:-.3,pan:0,lowpass:2400,highpass:90,threshold:-26,ratio:4.5,attack:.008,release:.3,reverb:12,width:72},
 impact:{gain:2,pitch:-1.5,pan:0,lowpass:15000,highpass:42,threshold:-14,ratio:7,attack:.002,release:.18,reverb:8,width:115},
 wide:{gain:-2,pitch:0,pan:0,lowpass:17000,highpass:35,threshold:-22,ratio:2,attack:.025,release:.5,reverb:28,width:165}
};

async function init(){
  try { state.manifest=await fetch('../../Content/Audio/manifest.json').then(r=>{if(!r.ok)throw Error(r.status);return r.json()}); }
  catch(e){ state.manifest={categories:[],assets:[]}; toast('Manifest unavailable — local import still works'); }
  state.categories=state.manifest.categories; state.assets=state.manifest.assets.map(a=>({...a,pending:!a.path}));
  renderCategories(); renderAssets(); renderParams(); bind(); resize();
  window.addEventListener('resize',resize);
}
function renderCategories(){
  const counts=id=>state.assets.filter(a=>id==='all'||a.category===id).length;
  $('#categoryList').innerHTML=[{id:'all',label:'All audio',icon:'▦'},...state.categories].map(c=>`<button class="folder ${state.category===c.id?'active':''}" data-category="${c.id}"><span class="folder-icon">${c.icon}</span><span>${c.label}</span><span class="count">${counts(c.id)}</span></button>`).join('');
}
function renderAssets(){
  const q=$('#searchInput').value.trim().toLowerCase();
  const list=state.assets.filter(a=>(state.category==='all'||a.category===state.category)&&(!q||`${a.name} ${a.kind} ${(a.tags||[]).join(' ')}`.toLowerCase().includes(q)));
  $('#assetCount').textContent=`${list.length} asset${list.length===1?'':'s'}`;
  $('#assetList').innerHTML=list.map(a=>`<button class="asset ${a.pending?'pending':''} ${state.selected?.id===a.id?'active':''}" data-id="${a.id}" title="${a.pending?'Audio master not added yet':'Open '+a.name}"><span class="asset-icon">${a.pending?'＋':'∿'}</span><span><strong>${escapeHtml(a.name)}</strong><small>${a.pending?'Awaiting master':escapeHtml(a.kind)}</small></span><span class="duration">${a.duration?format(a.duration):'—'}</span></button>`).join('')||'<div class="drop-target"><strong>No matching assets</strong><span>Try another category</span></div>';
}
function renderParams(){
  $('#parameterSections').innerHTML=specs.map((s,i)=>`<section class="param-section"><button class="section-toggle">${s.title}<small>${s.hint}</small><i class="module-dot"></i></button><div class="param-body">${s.items.map(([id,label,min,max,step,unit])=>`<label class="param"><span class="param-head"><span>${label}</span><output class="param-value" id="${id}Value">${displayParam(id,state.params[id],unit)}</output></span><input data-param="${id}" data-unit="${unit}" type="range" min="${min}" max="${max}" step="${step}" value="${state.params[id]}"><span class="param-scale"><i>${min}</i><i>${max}</i></span></label>`).join('')}</div></section>`).join('');
}
function bind(){
  $('#categoryList').addEventListener('click',e=>{const b=e.target.closest('[data-category]');if(!b)return;state.category=b.dataset.category;renderCategories();renderAssets();});
  $('#assetList').addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(!b)return;selectAsset(state.assets.find(a=>a.id===b.dataset.id));});
  $('#searchInput').addEventListener('input',renderAssets);
  $('#searchInput').addEventListener('keydown',e=>{if(e.key==='Escape'){e.currentTarget.value='';renderAssets();}});
  $('#parameterSections').addEventListener('click',e=>{const b=e.target.closest('.section-toggle');if(b)b.parentElement.classList.toggle('closed');});
  $('#parameterSections').addEventListener('input',e=>{if(!e.target.dataset.param)return; setParam(e.target.dataset.param,+e.target.value,true);});
  $('#parameterSections').addEventListener('change',e=>{if(e.target.dataset.param)pushHistory();});
  ['#addFiles','#importTop','#emptyImport'].forEach(id=>$(id).onclick=()=>$('#fileInput').click());
  $('#fileInput').onchange=e=>importFiles([...e.target.files]);
  ['dragenter','dragover'].forEach(type=>document.addEventListener(type,e=>{e.preventDefault();$('#dropTarget').classList.add('drag')}));
  ['dragleave','drop'].forEach(type=>document.addEventListener(type,e=>{e.preventDefault();$('#dropTarget').classList.remove('drag')}));
  document.addEventListener('drop',e=>importFiles([...e.dataTransfer.files].filter(f=>f.type.startsWith('audio/')||/\.(wav|mp3|ogg|flac|m4a)$/i.test(f.name))));
  $('#playButton').onclick=togglePlay; $('#stopButton').onclick=()=>stop(true); $('#toStartButton').onclick=()=>{stop(true);state.pausedAt=state.trimStart;updatePlayhead()};
  $('#loopButton').onclick=()=>{state.loop=!state.loop;$('#loopButton').classList.toggle('active',state.loop)};
  $('#monitorVolume').oninput=updateLiveNodes;
  $('#zoomSlider').oninput=e=>{state.zoom=+e.target.value;drawWave()};
  $('#resetButton').onclick=()=>applyPreset('natural',true); $('#presetSelect').onchange=e=>applyPreset(e.target.value,true);
  $('#abButton').onclick=compareAB; $('#savePresetButton').onclick=saveSidecar;
  $('#exportButton').onclick=$('#exportBottom').onclick=exportWav;
  $('#undoButton').onclick=undo; $('#redoButton').onclick=redo;
  $('#themeButton').onclick=()=>document.body.classList.toggle('high-contrast');
  $('#waveWrap').addEventListener('pointerdown',seekWave);
  document.addEventListener('keydown',e=>{if(e.target.matches('input,select'))return;if(e.code==='Space'){e.preventDefault();togglePlay()}if(e.key.toLowerCase()==='l')$('#loopButton').click();if(e.key.toLowerCase()==='r')applyPreset('natural',true);if(e.key.toLowerCase()==='e')exportWav();if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();e.shiftKey?redo():undo()}if(e.key==='/' ){e.preventDefault();$('#searchInput').focus();}});
}
async function selectAsset(asset){
  if(!asset)return; state.selected=asset; renderAssets();
  const cat=state.categories.find(c=>c.id===asset.category); $('#crumbCategory').textContent=cat?.label||'Imported';
  if(asset.pending){ toast('This production slot needs an audio master — choose a file to fill it'); $('#fileInput').dataset.target=asset.id; $('#fileInput').click(); return; }
  await loadAsset(asset);
}
async function importFiles(files){
  if(!files.length)return; const targetId=$('#fileInput').dataset.target; delete $('#fileInput').dataset.target;
  for(let i=0;i<files.length;i++){
    const f=files[i], url=URL.createObjectURL(f); let asset;
    if(i===0&&targetId){asset=state.assets.find(a=>a.id===targetId);Object.assign(asset,{path:url,file:f,pending:false,kind:asset.kind||'Imported master'});}
    else{asset={id:`local-${Date.now()}-${i}`,name:f.name.replace(/\.[^.]+$/,''),category:'imported',kind:'Local import',tags:[],path:url,file:f,pending:false};state.assets.unshift(asset);}
    if(i===0)await loadAsset(asset);
  }
  if(!state.categories.some(c=>c.id==='imported'))state.categories.unshift({id:'imported',label:'Local imports',icon:'⇩'});
  state.category='imported';renderCategories();renderAssets();toast(`${files.length} audio file${files.length>1?'s':''} imported`);
}
async function ensureContext(){ if(!state.context)state.context=new (window.AudioContext||window.webkitAudioContext)({sampleRate:48000}); if(state.context.state==='suspended')await state.context.resume(); return state.context; }
async function loadAsset(asset){
  stop(false); $('#audioState').textContent='Decoding audio…';
  try{const ctx=await ensureContext();const data=asset.file?await asset.file.arrayBuffer():await fetch(asset.path).then(r=>r.arrayBuffer());state.buffer=await ctx.decodeAudioData(data.slice(0));asset.duration=state.buffer.duration;state.trimStart=0;state.trimEnd=state.buffer.duration;state.pausedAt=0;state.history=[];state.future=[];applyPreset('natural',false);showEditor(asset);drawWave();updateTimeline();$('#audioState').textContent='Audio ready';renderAssets();}
  catch(e){console.error(e);state.buffer=null;toast('This file could not be decoded');$('#audioState').textContent='Decode failed';}
}
function showEditor(a){
  $('#emptyState').classList.add('hidden');$('#editStage').classList.remove('hidden');$('#clipTitle').textContent=a.name;$('#clipKind').textContent=`${state.categories.find(c=>c.id===a.category)?.label||'Imported'} · ${a.kind}`;$('#clipMeta').textContent=`${state.buffer.sampleRate.toLocaleString()} Hz  ·  ${state.buffer.numberOfChannels} channel${state.buffer.numberOfChannels>1?'s':''}  ·  ${format(state.buffer.duration)}`;$('#formatTag').textContent=(a.file?.name.split('.').pop()||a.path?.split('.').pop()||'audio').toUpperCase();$('#channelTag').textContent=state.buffer.numberOfChannels>1?'STEREO':'MONO';$('#exportChannels').textContent=state.buffer.numberOfChannels>1?'Stereo':'Mono';$('#footerName').textContent=a.name;$('#footerPath').textContent=a.file?'Local import':a.path;updateTimeline();
}
function setParam(id,value,live){state.params[id]=value;const spec=specs.flatMap(s=>s.items).find(x=>x[0]===id);$(`#${id}Value`).textContent=displayParam(id,value,spec[5]);if(live)updateLiveNodes();}
function displayParam(id,v,u){if(id==='gain'||id==='pitch')return`${v>0?'+':''}${(+v).toFixed(1)} ${u}`;if(id==='attack'||id==='release')return`${Math.round(v*1000)} ms`;if(id==='ratio')return`${(+v).toFixed(1)}:1`;return`${Math.round(v)} ${u}`;}
function syncControls(){Object.entries(state.params).forEach(([id,v])=>{const input=$(`[data-param="${id}"]`);if(input){input.value=v;const s=specs.flatMap(x=>x.items).find(x=>x[0]===id);$(`#${id}Value`).textContent=displayParam(id,v,s[5]);}});updateLiveNodes();}
function snapshot(){return JSON.stringify(state.params)}
function pushHistory(){const now=snapshot();if(state.history.at(-1)!==now){state.history.push(now);if(state.history.length>40)state.history.shift();}state.future=[];historyButtons();}
function applyPreset(name,record){if(record)state.history.push(snapshot());state.params={...presets[name]};state.future=[];syncControls();historyButtons();if(record)toast(`${$('#presetSelect').selectedOptions[0]?.text||'Natural'} applied`);}
function undo(){if(!state.history.length)return;state.future.push(snapshot());state.params=JSON.parse(state.history.pop());syncControls();historyButtons();}
function redo(){if(!state.future.length)return;state.history.push(snapshot());state.params=JSON.parse(state.future.pop());syncControls();historyButtons();}
function historyButtons(){$('#undoButton').disabled=!state.history.length;$('#redoButton').disabled=!state.future.length;}
function compareAB(){if(state.compare){const p={...state.params};state.params=state.compare;state.compare=p;$('#abButton').textContent=$('#abButton').textContent==='A'?'B':'A';}else{state.compare={...state.params};state.params={...presets.natural};$('#abButton').textContent='B';}syncControls();}
function createImpulse(ctx,seconds=1.8){const len=Math.floor(ctx.sampleRate*seconds),b=ctx.createBuffer(2,len,ctx.sampleRate);for(let c=0;c<2;c++){const d=b.getChannelData(c);let seed=17+c;for(let i=0;i<len;i++){seed=(seed*16807)%2147483647;d[i]=((seed/2147483647)*2-1)*Math.pow(1-i/len,2.8);}}return b;}
function buildGraph(ctx,source,destination,offline=false){
  const hp=ctx.createBiquadFilter(),lp=ctx.createBiquadFilter(),comp=ctx.createDynamicsCompressor(),pan=ctx.createStereoPanner(),gain=ctx.createGain(),dry=ctx.createGain(),wet=ctx.createGain(),conv=ctx.createConvolver();
  // Mid/side width is represented as a 2 × 2 stereo matrix:
  // L' = aL + bR, R' = bL + aR, where a=(1+w)/2 and b=(1-w)/2.
  const split=ctx.createChannelSplitter(2),merge=ctx.createChannelMerger(2),ll=ctx.createGain(),lr=ctx.createGain(),rl=ctx.createGain(),rr=ctx.createGain();
  hp.type='highpass';lp.type='lowpass';conv.buffer=createImpulse(ctx);source.connect(hp).connect(lp).connect(comp).connect(split);
  split.connect(ll,0);ll.connect(merge,0,0);split.connect(lr,0);lr.connect(merge,0,1);split.connect(rl,1);rl.connect(merge,0,0);split.connect(rr,1);rr.connect(merge,0,1);
  merge.connect(pan).connect(gain);gain.connect(dry).connect(destination);gain.connect(conv).connect(wet).connect(destination);
  const nodes={hp,lp,comp,pan,gain,dry,wet,conv,split,merge,ll,lr,rl,rr,source}; if(!offline){const analyser=ctx.createAnalyser();analyser.fftSize=256;gain.connect(analyser);nodes.analyser=analyser;} applyNodes(nodes);return nodes;
}
function applyNodes(n){if(!n)return;const p=state.params,w=p.width/100,a=(1+w)/2,b=(1-w)/2;n.hp.frequency.value=p.highpass;n.lp.frequency.value=p.lowpass;n.comp.threshold.value=p.threshold;n.comp.ratio.value=p.ratio;n.comp.attack.value=p.attack;n.comp.release.value=p.release;n.pan.pan.value=p.pan/100;n.gain.gain.value=Math.pow(10,p.gain/20);n.dry.gain.value=1-p.reverb/130;n.wet.gain.value=p.reverb/100;n.ll.gain.value=n.rr.gain.value=a;n.lr.gain.value=n.rl.gain.value=b;}
function updateLiveNodes(){applyNodes(state.nodes);if(state.nodes?.gain)state.nodes.gain.gain.value=Math.pow(10,state.params.gain/20)*(+$('#monitorVolume').value);const db=20*Math.log10(Math.max(.001,+$('#monitorVolume').value));$('#monitorVolumeValue').textContent=`${db.toFixed(1)} dB`;}
async function play(){if(!state.buffer)return toast('Select an audio master first');const ctx=await ensureContext();stop(false);const src=ctx.createBufferSource();src.buffer=state.buffer;src.playbackRate.value=Math.pow(2,state.params.pitch/12);src.loop=state.loop;if(state.loop){src.loopStart=state.trimStart;src.loopEnd=state.trimEnd;}state.nodes=buildGraph(ctx,src,ctx.destination);updateLiveNodes();state.source=src;state.startedAt=ctx.currentTime-state.pausedAt/src.playbackRate.value;state.playing=true;src.start(0,state.pausedAt,state.loop?undefined:Math.max(.01,state.trimEnd-state.pausedAt));src.onended=()=>{if(state.source!==src)return;if(state.loop)return;stop(true)};$('#playButton').textContent='Ⅱ';$('#cpuState').textContent='Web Audio · playing';tick();}
function togglePlay(){state.playing?pause():play();}
function pause(){if(!state.playing)return;const rate=Math.pow(2,state.params.pitch/12);state.pausedAt=Math.min(state.trimEnd,state.trimStart+(state.context.currentTime-state.startedAt)*rate-state.trimStart);stop(false);updatePlayhead();}
function stop(reset){if(state.source){state.source.onended=null;try{state.source.stop()}catch(e){}state.source.disconnect();}state.source=null;state.nodes=null;state.playing=false;cancelAnimationFrame(state.raf);$('#playButton').textContent='▶';$('#cpuState').textContent='Web Audio · idle';$('#meterL').style.width=$('#meterR').style.width='0';if(reset){state.pausedAt=state.trimStart;updatePlayhead();}}
function tick(){if(!state.playing)return;const rate=Math.pow(2,state.params.pitch/12);let t=(state.context.currentTime-state.startedAt)*rate;if(state.loop&&t>=state.trimEnd)t=state.trimStart+(t-state.trimStart)%(state.trimEnd-state.trimStart);state.pausedAt=t;updatePlayhead();if(state.nodes?.analyser){const d=new Uint8Array(state.nodes.analyser.frequencyBinCount);state.nodes.analyser.getByteFrequencyData(d);const avg=d.reduce((a,b)=>a+b,0)/d.length/255*100;$('#meterL').style.width=`${Math.min(100,avg*1.8)}%`;$('#meterR').style.width=`${Math.min(100,avg*1.65)}%`;}state.raf=requestAnimationFrame(tick);}
function format(sec){if(!isFinite(sec))return'00:00.000';const m=Math.floor(sec/60),s=Math.floor(sec%60),ms=Math.floor((sec%1)*1000);return`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;}
function updateTimeline(){if(!state.buffer)return;$('#durationTime').textContent=format(state.buffer.duration);$('#selectionLabel').textContent=`Selection ${format(state.trimStart)} — ${format(state.trimEnd)}`;$('#inTime').textContent=format(state.trimStart);$('#outTime').textContent=format(state.trimEnd);const ruler=$('#waveRuler');ruler.innerHTML=Array.from({length:9},(_,i)=>`<span style="left:${i*12.5}%">${format(state.buffer.duration*i/8).slice(0,5)}</span>`).join('');updatePlayhead();}
function updatePlayhead(){if(!state.buffer)return;$('#currentTime').textContent=format(state.pausedAt);$('#playhead').style.left=`${state.pausedAt/state.buffer.duration*100}%`;$('#selection').style.left=`${state.trimStart/state.buffer.duration*100}%`;$('#selection').style.right=`${100-state.trimEnd/state.buffer.duration*100}%`;}
function seekWave(e){if(!state.buffer)return;const r=e.currentTarget.getBoundingClientRect(),t=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*state.buffer.duration;state.pausedAt=Math.max(state.trimStart,Math.min(state.trimEnd,t));if(state.playing)play();else updatePlayhead();}
function resize(){const c=$('#waveCanvas');if(!c)return;const r=c.getBoundingClientRect(),d=devicePixelRatio||1;c.width=Math.max(1,r.width*d);c.height=Math.max(1,r.height*d);drawWave();}
function drawWave(){if(!state.buffer)return;const c=$('#waveCanvas'),x=c.getContext('2d'),w=c.width,h=c.height,dpr=devicePixelRatio||1;x.clearRect(0,0,w,h);const data=state.buffer.getChannelData(0),steps=Math.floor(w/dpr),stride=Math.max(1,Math.floor(data.length/steps/state.zoom)),visible=Math.min(data.length,steps*stride),offset=Math.floor((data.length-visible)/2);x.strokeStyle=getComputedStyle(document.body).getPropertyValue('--wave').trim();x.lineWidth=dpr;x.globalAlpha=.86;x.beginPath();for(let px=0;px<steps;px++){let lo=1,hi=-1,start=offset+px*stride;for(let j=0;j<stride&&start+j<data.length;j++){const v=data[start+j];if(v<lo)lo=v;if(v>hi)hi=v;}const xx=(px+.5)*dpr;x.moveTo(xx,(1-hi)*h/2);x.lineTo(xx,(1-lo)*h/2);}x.stroke();}
async function renderOffline(){const start=state.trimStart,end=state.trimEnd,rate=Math.pow(2,state.params.pitch/12),duration=(end-start)/rate,channels=Math.min(2,state.buffer.numberOfChannels),ctx=new OfflineAudioContext(channels,Math.ceil(duration*48000),48000),src=ctx.createBufferSource();src.buffer=state.buffer;src.playbackRate.value=rate;buildGraph(ctx,src,ctx.destination,true);src.start(0,start,end-start);return ctx.startRendering();}
async function exportWav(){if(!state.buffer)return toast('Select an audio master first');stop(false);$('#audioState').textContent='Rendering master…';try{const rendered=await renderOffline(),blob=encodeWav(rendered),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${slug(state.selected.name)}_edited.wav`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);toast('Game-ready WAV exported');}catch(e){console.error(e);toast('Export failed in this browser');}finally{$('#audioState').textContent='Audio ready';}}
function encodeWav(buffer){const ch=buffer.numberOfChannels,len=buffer.length,bytes=44+len*ch*2,ab=new ArrayBuffer(bytes),v=new DataView(ab),write=(o,s)=>[...s].forEach((c,i)=>v.setUint8(o+i,c.charCodeAt(0)));write(0,'RIFF');v.setUint32(4,bytes-8,true);write(8,'WAVE');write(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,ch,true);v.setUint32(24,buffer.sampleRate,true);v.setUint32(28,buffer.sampleRate*ch*2,true);v.setUint16(32,ch*2,true);v.setUint16(34,16,true);write(36,'data');v.setUint32(40,len*ch*2,true);let peak=0;for(let c=0;c<ch;c++){const d=buffer.getChannelData(c);for(let i=0;i<len;i++)peak=Math.max(peak,Math.abs(d[i]));}const scale=Math.pow(10,-1/20)/Math.max(peak,.0001);let o=44;for(let i=0;i<len;i++)for(let c=0;c<ch;c++){const s=Math.max(-1,Math.min(1,buffer.getChannelData(c)[i]*scale));v.setInt16(o,s<0?s*32768:s*32767,true);o+=2;}return new Blob([ab],{type:'audio/wav'});}
function saveSidecar(){if(!state.selected)return toast('Select an asset first');const payload={version:1,asset:state.selected.name,source:state.selected.file?.name||state.selected.path,trim:{start:state.trimStart,end:state.trimEnd},parameters:state.params,delivery:{format:'wav',pcmBits:16,sampleRate:48000,normalizePeakDb:-1}},blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${slug(state.selected.name)}.frontier-audio.json`;a.click();toast('Parameter sidecar saved');}
function slug(s){return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
let toastTimer;function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2400)}
init();
})();
