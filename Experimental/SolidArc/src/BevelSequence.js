// One native bevel transaction. Pointer/numeric previews never enter the undo journal.
const $ = S => document.querySelector(S);
const escape = S => String(S).replace(/[&<>"']/g, C => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[C]));
export function BevelDistance(Text) {
  const M=String(Text).trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(mm|cm|m|in|ft)?$/i);
  if(!M)return NaN;
  return Number(M[1])*({mm:.001,cm:.01,m:1,in:.0254,ft:.3048}[M[2]?.toLowerCase()||'m']);
}
export class BevelSequence {
  constructor(Host) {
    this.Host=Host;this.LastX=0;this.Serial=0;
    const Panel=document.createElement('section');Panel.id='bevel-panel';Panel.hidden=true;
    Panel.setAttribute('aria-label','Interactive Bevel / Chamfer');
    Panel.innerHTML=`<div class="section-heading"><h3 id="bevel-title">Bevel / Chamfer · B</h3><small>NATIVE PREVIEW</small></div>
      <label>Mode<select id="bevel-mode"><option value="fillet">Rounded · Fillet</option><option value="chamfer">Flat · Chamfer</option></select></label>
      <label>Signed size<input id="bevel-size" type="text" inputmode="decimal" aria-label="Bevel size" autocomplete="off" spellcheck="false"/><small>m · also mm, cm, in, ft</small></label>
      <p>Move in the viewport: right = round, left = flat. Shift = fine. Type to pin a value.</p>
      <button class="button" id="bevel-pointer">Mouse adjust</button><p id="bevel-status" role="status"></p><div class="inspector-actions"><button class="button" id="bevel-apply">Apply ↵</button><button class="button" id="bevel-cancel">Cancel Esc</button></div>
      <small>Positive = fillet radius · negative = chamfer setback<br/>Constant radius / equal setback only. Unsupported sets refuse atomically.</small>`;
    document.body.append(Panel);this.Panel=Panel;
    this.Input=$('#bevel-size');
    this.Input.addEventListener('input',()=>{this.Pinned=true;this.QueueText();});
    this.Input.addEventListener('focus',()=>this.Pinned=true);
    $('#bevel-mode').onchange=()=>{
      const Value=Math.abs(BevelDistance(this.Input.value));
      this.Input.value=String((Number.isFinite(Value)&&Value>0?Value:this.State.size||.1)*($('#bevel-mode').value==='chamfer'?-1:1));
      this.Pinned=true;this.QueueText();
    };
    $('#bevel-pointer').onclick=()=>{this.Input.blur();this.Pinned=false;this.Reanchor=true;this.PointerValue=this.State.size*(this.State.chamfer?-1:1);$('#cad-canvas').focus({preventScroll:true});};
    $('#bevel-apply').onclick=()=>this.Safe(()=>this.Apply());
    $('#bevel-cancel').onclick=()=>this.Safe(()=>this.Cancel());
    const Canvas=$('#cad-canvas');
    Canvas.addEventListener('pointermove',E=>{
      this.LastX=E.clientX;
      if(!this.Active||this.Cancelling)return;
      if(E.altKey||E.buttons&4||Host.ViewDrag){this.PointerX=E.clientX;return;}
      E.stopImmediatePropagation();
      if(this.Pinned||this.Confirming)return;
      if(this.Reanchor){this.PointerX=E.clientX;this.Reanchor=false;return;}
      let Signed=this.PointerValue+(E.clientX-this.PointerX)*this.UnitsPerPixel*(E.shiftKey?.1:1);
      this.PointerX=E.clientX;this.PointerValue=Signed;
      if(Math.abs(Signed)<1e-8)Signed=0;
      this.Input.value=Number(Signed.toPrecision(7)).toString();this.QueueText();
    },true);
    Canvas.addEventListener('pointerdown',E=>{
      if(!this.Active||E.altKey||E.button===1)return;
      E.preventDefault();E.stopImmediatePropagation();
      if(E.button===2)this.Safe(()=>this.Cancel());
      if(E.button===0){this.Pinned=true;this.Safe(()=>this.Apply());}
    },true);
    document.addEventListener('pointerdown',E=>{
      if(!this.Active||Panel.contains(E.target)||Canvas===E.target)return;
      E.preventDefault();E.stopImmediatePropagation();Host.Notify('Apply or cancel the bevel first.');
    },true);
    document.addEventListener('click',E=>{
      const B=E.target.closest('[data-bevel-feature]');if(!B)return;
      E.preventDefault();this.Safe(()=>this.Start(false,Number(B.dataset.bevelOwner),Number(B.dataset.bevelFeature)));
    });
    document.addEventListener('keydown',E=>{
      if(this.Active){
        if(E.key==='Escape'){E.preventDefault();E.stopImmediatePropagation();this.Safe(()=>this.Cancel());return;}
        if(E.key==='Enter'){E.preventDefault();E.stopImmediatePropagation();this.Safe(()=>this.Apply());return;}
        if(Panel.contains(E.target))return;
        if(/^[0-9.\-+]$/.test(E.key)&&!E.ctrlKey&&!E.metaKey&&!E.altKey){
          E.preventDefault();E.stopImmediatePropagation();this.Pinned=true;this.Input.focus();this.Input.value=E.key;this.QueueText();return;
        }
        if(!['Alt','Shift','Control','Meta'].includes(E.key)){E.preventDefault();E.stopImmediatePropagation();}
        return;
      }
      if(E.key.toLowerCase()==='b'&&!E.ctrlKey&&!E.metaKey&&!E.altKey&&!E.repeat&&!E.target.closest('input,textarea,select')&&!$('dialog[open]')){
        E.preventDefault();E.stopImmediatePropagation();this.Safe(()=>this.Start(E.shiftKey));
      }
    },true);
    window.addEventListener('blur',()=>{if(this.Active)this.Pinned=true;});
  }
  get State(){return this.Host.Description.bevel||{};}
  get Active(){return !!this.State.active||this.Starting;}
  async Safe(F){try{return await F();}catch(E){this.Host.Notify(E.message);}}
  async Start(Chamfer=false,Owner=0,Feature=0) {
    const H=this.Host;if(this.Active||!H.Ready)return;
    if(H.Flow?.Drawing)return H.Notify('Finish or cancel the current drawing first.');
    if(!H.NativeSession)return H.Notify('Interactive bevel requires the native C++ transport.');
    if(!(await H.AwaitNavigation()))return;
    if(!Owner&&!this.State.available)return H.Notify(this.State.reason||'Select solid edges or planar sketch corners, then B.');
    H.CancelSketchTool();this.Starting=true;this.Pinned=!!Owner;this.Reanchor=false;this.Confirming=false;this.Cancelling=false;
    try {
      const R=await H.Request('bevel',{operation:0,chamfer:Chamfer,owner:Owner,feature:Feature});
      if(!R.success)return H.Notify(this.State.status||'Cannot begin this bevel.');
      this.Input.value=String(this.State.size*(this.State.chamfer?-1:1));
      const Rect=$('#cad-canvas').getBoundingClientRect();
      this.UnitsPerPixel=(H.Description.camera?.distance||10)*2*Math.tan(Math.PI/8)/Rect.height;
      const X=this.LastX||Rect.x+Rect.width/2;
      this.PointerX=X;this.PointerValue=BevelDistance(this.Input.value);
      this.OriginX=X-this.PointerValue/this.UnitsPerPixel;
      this.LatestSerial=this.AppliedSerial=++this.Serial;this.Refresh();
      $('#cad-canvas').focus({preventScroll:true});
    }finally{this.Starting=false;this.Refresh();}
  }
  QueueText(){
    const Signed=BevelDistance(this.Input.value);
    this.Pending={size:Number.isFinite(Signed)?Math.abs(Signed):0,chamfer:Signed<0,serial:++this.Serial};
    this.LatestSerial=this.Serial;
    if(Number.isFinite(Signed)&&Signed!==0)$('#bevel-mode').value=Signed<0?'chamfer':'fillet';
    $('#bevel-apply').disabled=true;
    this.Pump();
  }
  Pump(){
    if(this.PumpPromise)return this.PumpPromise;
    this.PumpPromise=(async()=>{
      while(this.Pending&&this.State.active&&!this.Cancelling){
        while(this.Host.Busy)await this.Host.CurrentRequest;
        if(this.Cancelling)break;
        const Draft=this.Pending;this.Pending=null;
        await this.Host.Request('bevel',{operation:1,size:Draft.size,chamfer:Draft.chamfer});
        this.AppliedSerial=Draft.serial;this.Refresh();
      }
    })().catch(E=>this.Host.Notify(E.message)).finally(()=>{
      this.PumpPromise=null;this.Refresh();
      if(this.Pending&&this.State.active&&!this.Cancelling)this.Pump();
    });
    return this.PumpPromise;
  }
  async Apply(){
    if(!this.State.active||this.Confirming||this.Cancelling)return;
    this.Confirming=true;this.Pinned=true;
    try{
      while(this.PumpPromise)await this.PumpPromise;
      while(this.Host.Busy)await this.Host.CurrentRequest;
      if(!this.State.valid||this.AppliedSerial!==this.LatestSerial){this.Input.focus();return;}
      const R=await this.Host.Request('bevel',{operation:2});
      if(R.success){this.Host.Document.dirty=true;this.Host.RefreshTabs();this.Host.Flow?.ScheduleSave();this.Host.Notify('Native bevel feature applied · edit it in Bevel history.');}
      else this.Host.Notify(this.State.status||'Bevel refused; no geometry changed.');
    }finally{this.Confirming=false;this.Refresh();}
  }
  async Cancel(){
    if(this.Cancelling||!this.Active)return;
    this.Cancelling=true;this.Pending=null;
    try{if(this.Starting&&this.Host.CurrentRequest)await this.Host.CurrentRequest;if(!this.State.active)return;if(this.PumpPromise)await this.PumpPromise;while(this.Host.Busy)await this.Host.CurrentRequest;await this.Host.Request('bevel',{operation:3});}
    finally{this.Cancelling=false;this.Refresh();$('#cad-canvas').focus({preventScroll:true});}
  }
  FeatureCard(F){
    const Features=F?.bevelFeatures||[];
    return `<section class="inspector-card"><div class="section-heading"><h3>Bevel history</h3><small>EDITABLE FEATURES</small></div>${Features.length?Features.map(B=>`<button class="bevel-feature" data-bevel-owner="${F.id}" data-bevel-feature="${B.id}" ${B.editable?'':'disabled'} title="${escape(B.reason||'Edit size / mode; replay downstream bevels atomically')}"><span>${String(B.id).padStart(2,'0')} · ${B.mode==='chamfer'?'Chamfer':'Fillet'}</span><strong>${Number(B.size.toPrecision(7))} m</strong><small>${B.count} ${F.classification===0?(B.count===1?'corner':'corners'):(B.count===1?'edge':'edges')}${B.editable?' · Edit':' · Read-only'}</small></button>`).join(''):'<p>No bevels yet. Select sketch corners or solid edges, then B.</p>'}<button class="button" data-tool="fillet" ${this.State.available?'':'disabled'} title="${escape(this.State.reason||'Interactive native bevel')}">Bevel / Chamfer · B</button></section>`;
  }
  Refresh(){
    const S=this.State;this.Panel.hidden=!S.active;
    if(S.active){
      const Rect=$('#cad-canvas').getBoundingClientRect();
      this.Panel.style.left=`${Rect.x+Rect.width/2}px`;this.Panel.style.top=`${Math.max(Rect.y+8,Rect.bottom-400)}px`;
      $('#bevel-title').textContent=S.owner?`Edit ${S.chamfer?'Chamfer':'Fillet'} #${S.feature}`:'Bevel / Chamfer · B';
      $('#bevel-mode').value=S.chamfer?'chamfer':'fillet';
      $('#bevel-status').textContent=this.AppliedSerial!==this.LatestSerial?'Computing native preview…':S.status;
      $('#bevel-status').classList.toggle('invalid',!S.valid);this.Input.setAttribute('aria-invalid',String(!S.valid));
      $('#bevel-apply').disabled=!S.valid||this.AppliedSerial!==this.LatestSerial||this.Confirming||this.Cancelling;
      $('#cad-canvas').style.cursor='ew-resize';
    }
    const Strip=$('#history-strip');Strip?.querySelectorAll('.bevel-history').forEach(E=>E.remove());
    let Count=0;
    for(const F of this.Host.Description.figures)for(const B of F.bevelFeatures||[]){
      ++Count;const Button=document.createElement('button');Button.className='history-step bevel-history';Button.dataset.bevelOwner=F.id;Button.dataset.bevelFeature=B.id;Button.disabled=!B.editable;
      Button.textContent=`${F.name} · ${B.mode} ${Number(B.size.toPrecision(5))} m`;Button.title=B.reason||'Edit native feature';Strip?.append(Button);
    }
    if(Count)$('#history-count').textContent=`${this.Host.Description.history.length} steps · ${Count} bevel features`;
  }
}
