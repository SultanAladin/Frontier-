import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

const CURVE_TYPES = [
  { id:'line', label:'Line', icon:'╱', keys:'Shift+A → L' },
  { id:'polyline', label:'Polyline', icon:'〰', keys:'Shift+A → P' },
  { id:'arc', label:'Arc (3-pt)', icon:'◠', keys:'Ctrl+Shift+A' },
  { id:'circle', label:'Circle', icon:'○', keys:'Ctrl+Shift+C' },
  { id:'ellipse', label:'Ellipse', icon:'⬭', keys:'Ctrl+Shift+E' },
  { id:'rect', label:'Rectangle', icon:'▭', keys:'Ctrl+Shift+R' },
  { id:'polygon', label:'Polygon', icon:'⬡', keys:'Ctrl+Shift+P' },
  { id:'slot', label:'Slot', icon:'⌔', keys:'Ctrl+Shift+L' },
  { id:'bezier', label:'Bézier', icon:'〰', keys:'Ctrl+Shift+S → B' },
  { id:'bspline', label:'B-Spline', icon:'∿', keys:'Ctrl+Shift+S' },
  { id:'nurbs', label:'NURBS Interp', icon:'≋', keys:'I' },
]

const LOFT_TYPES = [
  { id:'ruled', label:'Ruled', note:'Straight degree-1' },
  { id:'normal', label:'Normal', note:'Normal to guide' },
  { id:'developable', label:'Developable', note:'Unrollable fairing' },
  { id:'smooth', label:'Smooth G2', note:'Class-A G1/G2 per section' },
]

const OUTLINER = [
  { id:'body-fender', name:'Fender_L', kind:'Body', icon:'◰', children:[
    { id:'crv-belt', name:'Belt line', kind:'Curve · G2', icon:'∿' },
    { id:'crv-arch', name:'Wheel arch', kind:'Curve · G1', icon:'◠' },
    { id:'crv-hood', name:'Hood seam', kind:'Curve · G2', icon:'╱' },
    { id:'srf-fender', name:'Fender sheet', kind:'Loft · Smooth', icon:'⬓' },
  ]},
  { id:'body-door', name:'Door_L', kind:'Body', icon:'◰', children:[
    { id:'crv-door-belt', name:'Door belt', kind:'NURBS', icon:'≋' },
    { id:'crv-handle', name:'Handle recess', kind:'Slot', icon:'⌔' },
    { id:'srf-door', name:'Door outer', kind:'Loft · Normal', icon:'⬓' },
  ]},
  { id:'body-roof', name:'Roof', kind:'Body', icon:'◰', children:[
    { id:'crv-roof-rail', name:'Roof rail', kind:'B-Spline · G2', icon:'∿' },
    { id:'srf-roof', name:'Roof skin', kind:'Sweep', icon:'⬓' },
  ]},
  { id:'sketch-chassis', name:'Chassis sketch', kind:'Sketch', icon:'✎', children:[
    { id:'crv-centre', name:'Centre line', kind:'Line · G0', icon:'╱' },
  ]},
]

function useHotkeys(onVerb){
  useEffect(()=>{
    const map = {
      'g':'tool move · X/Y/Z lock axis · Shift+X/Y/Z plane · digits distance',
      'r':'tool rotate · digits degrees',
      's':'tool scale · digits factor',
      'e':'tool extrude',
      'q':'boolean union (Plasticity Q)',
      'shift+q':'boolean subtract',
      'ctrl+q':'boolean intersect',
      'l':'loft selected in order',
      'shift+p':'sweep (profile+path)',
      'shift+l':'fillpatch Coons',
      'b':'fillet selected 0.25',
      'shift+b':'chamfer selected 0.25',
      'o':'offset selected 0.25',
      'c':'tool cut',
      't':'tool trim',
      'j':'join selected',
      'a':'select all',
      'x':'delete selected',
      'f':'menu search (Plasticity F)',
      'space':'fit selection',
      'shift+a':'tool line (Plasticity)',
    }
    function key(e){
      const chord = `${e.ctrlKey?'ctrl+':''}${e.shiftKey?'shift+':''}${e.altKey?'alt+':''}${e.key.toLowerCase()}`
      // exact
      if(map[chord]) { e.preventDefault(); onVerb(map[chord], chord); return }
      // single
      if(map[e.key.toLowerCase()] && !e.ctrlKey && !e.altKey) { onVerb(map[e.key.toLowerCase()], e.key.toLowerCase()) }
    }
    window.addEventListener('keydown', key)
    return ()=> window.removeEventListener('keydown', key)
  },[onVerb])
}

function CarSilhouette({ loft, fillet, chamfer, continuity }){
  const ref = useRef(null)
  useEffect(()=>{
    const c = ref.current
    if(!c) return
    const dpr = window.devicePixelRatio||1
    const r = c.getBoundingClientRect()
    c.width = r.width*dpr; c.height=r.height*dpr
    const ctx = c.getContext('2d')
    ctx.scale(dpr,dpr)
    const W=r.width, H=r.height
    ctx.clearRect(0,0,W,H)
    // ground
    ctx.fillStyle='#0a0a0a'
    ctx.fillRect(0,0,W,H)
    // grid
    ctx.strokeStyle='rgba(255,255,255,.04)'
    ctx.lineWidth=1
    for(let x=0;x<W;x+=40){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke() }
    for(let y=0;y<H;y+=40){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke() }
    // car side silhouette defined by 4 curves (belt, arch, hood, roof) — sampled as NURBS-like
    // we draw a single fender+door+roof poly-bezier and apply Loft visualisation (sections)
    const pts = [
      {x:W*0.08, y:H*0.62}, // front bumper
      {x:W*0.18, y:H*0.58}, // hood start
      {x:W*0.28, y:H*0.52}, // hood bulge (loft normal)
      {x:W*0.38, y:H*0.42}, // windscreen base — G1/G2 point
      {x:W*0.52, y:H*0.36}, // roof
      {x:W*0.66, y:H*0.37}, // roof rear
      {x:W*0.78, y:H*0.52}, // rear window G1
      {x:W*0.88, y:H*0.62}, // rear bumper
    ]
    // curvature comb for G2 visualisation
    const combs = continuity==='G2'
    // loft sections (draw faint cross lines)
    if(loft!=='ruled'){
      ctx.strokeStyle='rgba(186,203,191,.10)'
      for(let i=0;i<pts.length;i++){
        const p=pts[i]
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, H*0.72); ctx.stroke()
      }
    }
    // main outline — use quadratic segments to hint continuity
    ctx.strokeStyle='#bacbbf'
    ctx.lineWidth=1.6
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1], mx=(a.x+b.x)/2, my=(a.y+b.y)/2
      const curv = (i===2||i===3) ? (continuity==='G2'? 18 : continuity==='G1'? 8 : 0) : 0
      // fake curvature by offsetting control point perpendicular
      const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy)||1, nx=-dy/len, ny=dx/len
      ctx.quadraticCurveTo(mx+nx*curv, my+ny*curv, b.x, b.y)
    }
    ctx.stroke()
    // fill sheet (fender) with faint
    ctx.fillStyle='rgba(52,58,52,.35)'
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for(let i=0;i<pts.length-1;i++){ const a=pts[i], b=pts[i+1], mx=(a.x+b.x)/2, my=(a.y+b.y)/2; const curv=(i===2||i===3)?(continuity==='G2'?18:continuity==='G1'?8:0):0; const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy)||1, nx=-dy/len, ny=dx/len; ctx.quadraticCurveTo(mx+nx*curv, my+ny*curv, b.x,b.y) }
    ctx.lineTo(W*0.88, H*0.72); ctx.lineTo(W*0.08, H*0.72); ctx.closePath(); ctx.fill()
    // wheel arches — circles trimmed
    function arch(cx, r){
      ctx.strokeStyle='#d3d9d5'
      ctx.lineWidth=1.2
      ctx.beginPath(); ctx.arc(cx, H*0.68, r, Math.PI, 0); ctx.stroke()
      // fillet / chamfer visualisation on arch lip
      if(fillet>0){
        ctx.strokeStyle='#eab308'
        ctx.setLineDash([4,4]); ctx.beginPath(); ctx.arc(cx, H*0.68, r+fillet*10, Math.PI, 0); ctx.stroke(); ctx.setLineDash([])
      }
      if(chamfer>0){
        ctx.strokeStyle='#22c55e'; ctx.beginPath(); ctx.moveTo(cx-r, H*0.68); ctx.lineTo(cx-r+chamfer*12, H*0.68- chamfer*12); ctx.moveTo(cx+r, H*0.68); ctx.lineTo(cx+r- chamfer*12, H*0.68- chamfer*12); ctx.stroke()
      }
    }
    arch(W*0.28, 56); arch(W*0.70, 56)
    // points + G handles
    pts.forEach((p,i)=>{
      const isHandle = i===3 || i===5
      ctx.fillStyle= isHandle ? (continuity==='G2'?'#bacbbf': continuity==='G1'?'#eab308':'#555') : '#222'
      ctx.strokeStyle='rgba(255,255,255,.08)'
      ctx.beginPath(); ctx.arc(p.x,p.y, isHandle?5:3,0,Math.PI*2); ctx.fill(); ctx.stroke()
      if(isHandle && combs){
        // curvature comb
        ctx.strokeStyle='rgba(186,203,191,.7)'; ctx.lineWidth=1
        for(let k=-3;k<=3;k++){ const off=k*8; ctx.beginPath(); ctx.moveTo(p.x+off, p.y); ctx.lineTo(p.x+off, p.y- 10 - Math.abs(k)*4); ctx.stroke() }
      }
      if(isHandle){
        ctx.fillStyle='#636363'; ctx.font='8px DM Sans'; ctx.fillText(continuity, p.x+8, p.y-8)
      }
    })
    // loft type label
    ctx.fillStyle='rgba(255,255,255,.35)'; ctx.font='9px DM Sans'; ctx.letterSpacing='1px'
    ctx.fillText(`LOFT · ${loft.toUpperCase()}  ·  ${continuity}  ·  fillet ${fillet.toFixed(2)}  chamfer ${chamfer.toFixed(2)}`, 18, 20)

  }, [loft, fillet, chamfer, continuity])
  return <canvas ref={ref} style={{position:'absolute', inset:0, width:'100%', height:'100%'}} />
}

function App(){
  const [selected, setSelected] = useState('crv-belt')
  const [continuity, setContinuity] = useState('G2')
  const [handleMode, setHandleMode] = useState('Smooth')
  const [loft, setLoft] = useState('smooth')
  const [fillet, setFillet] = useState(0.25)
  const [chamfer, setChamfer] = useState(0.0)
  const [bevel, setBevel] = useState(0.0)
  const [curveType, setCurveType] = useState('nurbs')
  const [toast, setToast] = useState(null)
  const show = (m)=>{ setToast(m); setTimeout(()=>setToast(null), 2200) }

  useHotkeys((verb, chord)=> show(`${chord} → ${verb}`))

  const selectedName = useMemo(()=> {
    for(let n of OUTLINER){ if(n.id===selected) return n.name; for(let c of n.children||[]) if(c.id===selected) return c.name }
    return selected
  },[selected])

  return <div className="app">
    <div className="titlebar">
      <span style={{opacity:.9}}>◈ Frontier</span><div className="div" />
      <b>Car Lab</b>
      <small>Plasticity · strict</small>
      <div className="spacer" />
      <small>curves · G1/G2 · loft · bevel/fillet/chamfer</small>
    </div>
    <div className="workspace-bar">
      <div className="tab"><b>Fender</b><span style={{color:'#777',fontSize:11}}>↗</span></div>
      <div className="bread">Body / Fender_L / Surface</div>
      <div className="spacer" />
      <button className="btn" onClick={()=>show('Export STEP…')}>Export STEP…</button>
      <button className="btn primary" onClick={()=>show('Bake surface')}>Bake</button>
    </div>

    <div className="workspace">
      {/* LEFT — Outliner */}
      <div className="pane">
        <div className="pane-heading"><b>Outliner</b><span>Car bodies</span></div>
        <div className="pane-body">
          <input className="search" placeholder="Filter · F" onKeyDown={e=> e.key==='Enter' && show(`Filter: ${e.currentTarget.value}`)} />
          <div className="filter">
            {['Bodies','Curves','Surfaces','Sketches'].map(k=> <button key={k} className={k==='Bodies'?'active':''} onClick={()=>show(`Filter ${k}`)}>{k}</button>)}
          </div>
          <div className="tree">
            {OUTLINER.map(n=> <React.Fragment key={n.id}>
              <div className={`row ${selected===n.id?'selected':''}`} onClick={()=>setSelected(n.id)}>
                <span className="icon">{n.icon}</span><span className="name">{n.name}</span><span className="kind">{n.kind}</span>
              </div>
              {(n.children||[]).map(c=> <div key={c.id} className={`row ${selected===c.id?'selected':''}`} style={{marginLeft:12}} onClick={()=>setSelected(c.id)}>
                <span className="icon">{c.icon}</span><span className="name">{c.name}</span><span className="kind">{c.kind}</span>
              </div>)}
            </React.Fragment>)}
          </div>
          <div className="hint"> <span className="kbd">F2</span> rename · <span className="kbd">H</span> hide · <span className="kbd">Shift+A</span> add curve · <span className="kbd">Tab</span> mode 1/2/3/4</div>
        </div>
      </div>

      {/* CENTRE — Viewport */}
      <div className="viewport-pane">
        <div className="viewport-toolbar">
          <button aria-pressed="true">Solid</button><button>Wire</button><button>XRay <span className="kbd">Alt+Z</span></button>
          <div className="spacer" />
          <button onClick={()=>show('Front')}>Front <span className="kbd">Numpad1</span></button>
          <button onClick={()=>show('Iso')}>Iso <span className="kbd">Numpad0</span></button>
          <button className="btn" onClick={()=>show('Fit (Space)')}>Fit</button>
        </div>
        <div className="viewport">
          <CarSilhouette loft={loft} fillet={fillet} chamfer={chamfer} continuity={continuity} />
          <div className="viewport-overlay">
            <div style={{fontSize:9, letterSpacing:1.2, textTransform:'uppercase', color:'#606760'}}>DYNAMIC · NURBS SHEET</div>
            <h2>{selectedName}</h2>
            <p>Class-A · {continuity} across belt — drag handles · <span className="kbd">G</span> move · <span className="kbd">X</span> <span className="kbd">Y</span> <span className="kbd">Z</span> lock</p>
          </div>
          <div className="viewport-help">Drag to orbit · Scroll to zoom · <span className="kbd">F</span> search · <span className="kbd">B</span> fillet · <span className="kbd">L</span> loft</div>
        </div>
        <div className="preview-controls">
          <div style={{fontSize:10, color:'#aaa'}}>Edge exposure <span style={{color:'#636363', fontSize:8}}>inspection</span></div>
          <div className="slider"><i style={{width:`${22+fillet*40}%`}} /></div>
          <button className="btn primary" onClick={()=>show(`Loft ${loft} → bake`)}>Loft surface</button>
        </div>
        <div className="metrics">
          <div><b>4</b><span>Sections</span></div>
          <div><b>{continuity}</b><span>Continuity</span></div>
          <div><b>{fillet.toFixed(2)}</b><span>Fillet R</span></div>
          <div><b>Closed</b><span>Topology</span></div>
        </div>
      </div>

      {/* RIGHT — Inspector */}
      <div className="pane">
        <div className="pane-heading"><b>Inspector</b><span>Car surface</span></div>
        <div className="pane-body">

          <div className="card">
            <h2>Curve <span>01</span></h2>
            <div className="cap">All types · Polyline stays editable, not baked</div>
            <div className="pill-row">
              {CURVE_TYPES.map(c=> <button key={c.id} className="pill" aria-pressed={curveType===c.id} onClick={()=>setCurveType(c.id)} title={c.keys}><i />{c.label}</button>)}
            </div>
            <div className="row2">
              <div className="field"><label>Degree</label><div className="input"><input defaultValue="3" /> <span>cubic</span></div></div>
              <div className="field"><label>Closed</label><div className="input"><input defaultValue="open" /> <span>periodic</span></div></div>
            </div>
            <div className="hint">NURBS single representation — lines degree 1, conics rational quad, splines cubic. Classification is a hint for snapping.</div>
          </div>

          <div className="card">
            <h2>Continuity <span>02</span></h2>
            <div className="cap">Per-vertex G0/G1/G2 · curvature comb</div>
            <div className="pill-row">
              {['G0','G1','G2'].map(k=> <button key={k} className="pill" aria-pressed={continuity===k} onClick={()=>setContinuity(k)}>{k}</button>)}
            </div>
            <div className="pill-row">
              {['Auto','Sharp','Smooth','Symmetric'].map(k=> <button key={k} className="pill" aria-pressed={handleMode===k} onClick={()=>setHandleMode(k)}>{k}</button>)}
            </div>
            <div className="comb">
              <svg viewBox="0 0 300 120" preserveAspectRatio="none">
                <path d="M10 80 C 60 80, 70 20, 110 20 S 170 80, 220 80 S 270 20, 290 20" fill="none" stroke={continuity==='G2'?'#bacbbf':continuity==='G1'?'#eab308':'#555'} strokeWidth="1.6"/>
                {continuity!=='G0' && [30,80,150,200,250].map(x=> <g key={x}><line x1={x} y1="80" x2={x} y2={continuity==='G2'?20:40} stroke="rgba(186,203,191,.6)" strokeWidth="1"/><circle cx={x} cy={continuity==='G2'?20:40} r="2" fill="#bacbbf"/></g>)}
              </svg>
            </div>
            <div className="row2">
              <div className="field"><label>Tension</label><div className="input"><input defaultValue="0.00" /> <span>G1 mag</span></div></div>
              <div className="field"><label>Curvature</label><div className="input"><input defaultValue={continuity==='G2'?'0.42':'—'} /> <span>1/m</span></div></div>
            </div>
            <div className="hint">Join stays C0 until you raise it — G1 aligns tangents, G2 matches curvature (comb visible). Stored per-join on the blueprint; ConstraintGraph adds Tangent/Curvature rows.</div>
          </div>

          <div className="card">
            <h2>Loft <span>03</span></h2>
            <div className="cap">All loft types · Plasticity parity</div>
            <div className="pill-row">
              {LOFT_TYPES.map(t=> <button key={t.id} className="pill" aria-pressed={loft===t.id} onClick={()=>setLoft(t.id)} title={t.note}>{t.label}</button>)}
            </div>
            <div className="field"><label>Sections (in order)</label><div className="input"><input defaultValue="Belt line → Door belt → Roof rail" /> <span>reorder</span></div></div>
            <div className="row2">
              <div className="field"><label>Guide rail</label><div className="input"><input placeholder="pick curve" /> <span>Normal</span></div></div>
              <div className="field"><label>Continuity per section</label><div className="input"><input defaultValue={continuity} /> <span>G0/G1/G2</span></div></div>
            </div>
            <div className="hint">Ruled = degree 1 V · Normal = profiles stay normal to guide · Developable = unrollable fairing · Smooth = full G2 skin. Kernel `NurbsSurface::Loft / Ruled / Sweep / Patch`.</div>
          </div>

          <div className="card">
            <h2>Surfaces <span>04</span></h2>
            <div className="cap">Extrude · Revolve · Sweep · Coons Patch · Offset · Mirror</div>
            <div className="pill-row">
              {['Extrusion','Revolution','Ruled','Sweep','Coons','Offset','Mirror'].map(k=> <button key={k} className="pill" onClick={()=>show(k)}>{k}</button>)}
            </div>
            <div className="row2">
              <div className="field"><label>Thickness</label><div className="input"><input defaultValue="0.8" /> <span>mm</span></div></div>
              <div className="field"><label>Mirror</label><div className="input"><input defaultValue="YZ plane" /> <span>car centre</span></div></div>
            </div>
          </div>

          <div className="card">
            <h2>Bevel / Fillet / Chamfer <span>05</span></h2>
            <div className="cap">Edge chain · variable radius · G1 vs G2 roll-ball</div>
            <div className="field"><label>Fillet radius (roll-ball G2)</label><div className="input"><input type="range" min="0" max="1" step="0.01" value={fillet} onChange={e=>setFillet(parseFloat(e.target.value))} style={{flex:1}} /> <span>{fillet.toFixed(2)} m</span></div></div>
            <div className="field"><label>Chamfer distance + angle</label><div className="input"><input type="range" min="0" max="1" step="0.01" value={chamfer} onChange={e=>setChamfer(parseFloat(e.target.value))} style={{flex:1}} /> <span>{chamfer.toFixed(2)} m</span></div></div>
            <div className="field"><label>Bevel profile (swept)</label><div className="input"><input placeholder="draw profile curve" /> <span>sweep</span></div></div>
            <div className="hint">History: edge chain + radius + continuity. Kernel `BlendSolver / FaceEditSolver`. <span className="kbd">B</span> fillet · <span className="kbd">Shift+B</span> chamfer · bevel via profile sweep.</div>
          </div>

        </div>
      </div>
    </div>

    <div className="statusbar">
      <span>Ready</span><span style={{flex:1}} />
      <span><b>{selectedName}</b> · {continuity} · {loft} · strict Plasticity</span>
      <span style={{opacity:.6}}>HTML ONLY · NATIVE PORT PENDING</span>
    </div>
    {toast && <div style={{position:'fixed', left:'50%', bottom:36, transform:'translateX(-50%)', background:'#1c1c1c', border:'1px solid rgba(255,255,255,.08)', borderRadius:999, padding:'8px 14px', fontSize:11, color:'#d3d9d5', pointerEvents:'none'}}>{toast}</div>}
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
