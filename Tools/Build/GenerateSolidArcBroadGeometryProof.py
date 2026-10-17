"""Generate the complete broad matrix, including failures and timeout evidence."""
from pathlib import Path
import base64
import json
from ProofPng import compressed_png

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'_AgentScratch/tmp/BroadGeometry'
GALLERY=ROOT/'Exhibits/Gallery/Editor'
results=json.loads((OUT/'results.json').read_text())
manifest=json.loads((ROOT/'Experimental/SolidArc/Native/Fixtures/BroadGeometry.json').read_text())
captures=json.loads((OUT/'captures.json').read_text())
native=json.loads((GALLERY/'BroadGeometryNativeCaptures.json').read_text())
native_ui=json.loads((GALLERY/'BroadGeometryNativeUI.json').read_text())
assert results['fixtureCount']==16 and len(results['cases'])==64
assert len(native)==64 and len(native_ui)==len(captures['ui'])==8
assert len(captures['captures'])==116 and not captures['pageErrors']
assert all(c['rgbaUploads']==0 for c in captures['captures'])
assert sum(c['booleanAccepted'] for c in native)==results['booleanAccepted']==50
assert all(r.get('refusalPreserved') for r in results['cases'] if r['status']=='boolean-refused')
assert all(b.get('refusalPreserved') for r in results['cases'] for b in r['blends'] if not b['accepted'])
assert all(b.get('undoRedo') for r in results['cases'] for b in r['blends'] if b['accepted'])
assert all(i['passed'] for i in results['volumeIdentities'])

spatial=json.loads((OUT/'spatial.json').read_text())
assert spatial['passed']==49 and spatial['flagged']==1 and spatial['inconclusive']==0
by_spatial={row['id']:row for row in spatial['audits']}
for row in results['cases']:row['spatial']=by_spatial.get(row['id'])
results['spatialAudit']=spatial
images={}

def image(key,path):
    data=compressed_png(path.read_bytes())
    # Native captures are originally uncompressed. Save the exact same pixels
    # in compressed PNG form too, keeping generated evidence comfortably small.
    if path.parent==GALLERY and len(data)<path.stat().st_size:path.write_bytes(data)
    images[key]='data:image/png;base64,'+base64.b64encode(data).decode()
    return key

for capture in captures['captures']:
    image('gpu:'+capture['id']+':'+capture['stage'],ROOT/capture['path'])
for row in results['cases']:
    for stage,id in [('source',row['fixture']),('boolean',row['id'])]:
        key='native:'+id+':'+stage
        if key not in images:image(key,GALLERY/f'BroadGeometry-{id}-{stage}.png')
for renderer,entries in [('native',native_ui),('gpu',captures['ui'])]:
    for row in entries:
        for stage in ('ui-preview','ui-applied'):
            path=GALLERY/f'BroadGeometry-{row["id"]}-{stage}.png' if renderer=='native' else OUT/f'images/{row["id"]}-html-{stage}.png'
            image(renderer+':'+row['id']+':'+stage,path)

payload=dict(results=results,fixtures=manifest['fixtures'],operations=manifest['operations'],nativeUI=native_ui,htmlUI=captures['ui'],images=images)
page=r'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SolidArc · Broad geometry coverage — successes and gaps</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#101215;color:#e4e8ee;font:15px/1.55 system-ui}main{max-width:1420px;margin:32px auto;padding:0 22px}h1{font-size:34px;line-height:1.15;margin:12px 0}h2{font-size:23px;margin:28px 0 12px}p{max-width:1150px}a{color:#accfff}.eyebrow{color:#b6bec9;text-transform:uppercase;letter-spacing:.14em;font-size:12px}.warning{padding:14px 18px;background:#30231e;border-left:4px solid #efaa6b;border-radius:5px}.counts{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0}.counts div{padding:12px 16px;border:1px solid #414751;border-radius:8px;background:#1a1e24}.counts strong{display:block;font-size:25px}.counts small{color:#bcc5d0}.toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0}select,button{font:inherit;color:inherit;border:1px solid #4a5360;background:#232933;border-radius:6px;padding:8px 11px}button{cursor:pointer}button:hover{border-color:#b3c9e4}button[aria-pressed=true],button.selected{background:#dce6f1;color:#111}button:disabled{opacity:.35;cursor:not-allowed}button:focus-visible,select:focus-visible{outline:3px solid #8abafa}.table-scroll{overflow:auto;border:1px solid #3b424c;border-radius:8px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:8px;border:1px solid #333b46;text-align:left}th{background:#212730}td:first-child{min-width:230px}td button{width:100%;min-width:145px;text-align:left;font-size:13px}td button span{display:block;font-size:11px}.ok{color:#9ddbb0}.bad{color:#f1ac9c}.partial{color:#e9cb8f}.dim{opacity:.3}.proof{padding:16px;border:1px solid #3c4551;border-radius:10px;margin-top:24px;background:#191d23}.proof h2{margin:0 0 8px}.proof img{display:block;max-width:100%;width:100%;border:1px solid #3d4653;background:#080808;border-radius:6px}figcaption{padding:10px 0;color:#c2cbd6}figure{margin:12px 0}#view-status{display:block;margin:10px 0;padding:10px;background:#252c36;border-radius:5px}pre{overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#181d24;border:1px solid #3a434f;padding:14px;border-radius:6px}summary{cursor:pointer;padding:6px 0}#attempts td{vertical-align:top}#attempts td:last-child{max-width:670px;overflow-wrap:anywhere}footer{margin:28px 0;color:#b3bdca}code{background:#272e38;padding:2px 5px}
</style></head><body><main>
<div class="eyebrow">Native C++ coverage audit · all results retained</div>
<h1>More shapes. More Booleans. <span class="partial">Not general geometry yet.</span></h1>
<p><a href="/gpu/proofs/repairs.html"><strong>New: first C++ Boolean repairs — cone/box fixed; remaining periodic gaps</strong></a>. Historical results below remain unchanged.</p>
<p><a href="/gpu/proofs/complex.html"><strong>New: constructed &amp; concave stress tests — 24 engineered pairings</strong></a> · Includes multi-stage source failures and the deferred repair backlog.</p>
<p class="warning"><strong>The wider test does not support an “any geometry” claim.</strong> Boxes, rotated solids, spheres, cylinders, tilted cylinders, truncated cones, tori, extrusions and lofts were tested across union, intersection and subtraction in both directions. Inspect every success and refusal below. A refusal is not counted as a successful modelling operation. Refusals mix unsupported geometry, unsuitable edge sets and size restrictions; they are not all proven solver defects.</p>
<div class="counts"><div><strong>50 / 64</strong><small>Boolean cases accepted by engine / topology checks</small></div><div><strong>49 / 50</strong><small>accepted outputs pass independent sampled spatial checks</small></div><div><strong>135 / 388</strong><small>completed sampled bevel attempts engine-accepted</small></div><div><strong>14 + 253</strong><small>Boolean + bevel refusals; original geometry retained</small></div><div><strong>1 timeout</strong><small>additional loft-derived bevel request, 100 seconds</small></div><div><strong>8 + 8</strong><small>native ImGui + HTML engine-accepted mouse subset</small></div></div>
<p><a href="/cpp">Live native C++ mirror</a> · <a href="/gpu/">HTML GPU editor</a> · <a href="/proofs/cylinder-sphere-bevel">Earlier cylinder/sphere proof</a>. Browsing this report never executes modelling commands or changes your drawing.</p>
<h2>64-case Boolean matrix</h2>
<p>Each cell reports the Boolean outcome and <em>sampled</em> bevel acceptance. Edge coverage is not exhaustive: first/last candidate edges with two distinct face owners (not independently pre-certified sharp), two sizes on the first edge, and an adjacent pair where available; both modes. Sizes are 0.025 / 0.01 times the fixture scale. Click a cell to inspect its geometry, commands and individual failures.</p>
<div class="toolbar"><label>Show <select id="filter"><option value="all">All cases</option><option value="boolean-refused">Boolean refused</option><option value="spatial-flagged">Engine accepted but spatial check failed</option><option value="none">No completed bevel accepted</option><option value="partial">Partial bevel support</option><option value="all-blends">All completed sampled bevels accepted</option><option value="timeout">Timed-out request</option></select></label><button id="download-results">Download full results JSON</button></div>
<div class="table-scroll"><table id="matrix"><thead><tr><th>Shape pairing</th><th>Union</th><th>Intersection</th><th>A − B</th><th>B − A</th></tr></thead><tbody></tbody></table></div>
<section class="proof"><h2 id="case-title"></h2><p id="case-summary"></p>
<div class="toolbar"><button id="renderer-native" data-renderer="native">Native C++ / CPU color</button><button id="renderer-gpu" data-renderer="gpu">WebGL2 / native C++ geometry</button></div>
<div class="toolbar" id="stage-buttons"><button data-stage="source">Original operands</button><button data-stage="boolean">Boolean result / refusal</button><button data-stage="fillet">Sampled fillet</button><button data-stage="chamfer">Sampled chamfer</button><button data-stage="ui-preview">Real mouse UI · preview</button><button data-stage="ui-applied">Real mouse UI · applied</button></div>
<output id="view-status" role="status" aria-live="polite"></output>
<figure><img id="proof-image" alt="Selected recorded geometry proof"><figcaption id="caption"></figcaption></figure>
<details open><summary>Exact reproduction commands</summary><pre id="commands"></pre></details>
<details open><summary id="attempt-summary">Individual sampled bevel attempts</summary><div class="table-scroll"><table id="attempts"><thead><tr><th>Target edge(s)</th><th>Mode / size</th><th>Outcome</th><th>Native diagnostic</th></tr></thead><tbody></tbody></table></div></details>
<details><summary>Boolean diagnostic / topology</summary><pre id="boolean-detail"></pre></details>
</section>
<h2>What these results establish—and what they do not</h2>
<p class="warning"><strong>Confirmed false positive: torus / box union.</strong> The engine accepted a closed box while omitting the torus portion outside it. Independent draw-mesh bounds fail union containment, and 66 of 512 deterministic occupancy samples disagree with the source Boolean truth. This is a geometry defect, not a safe refusal, and is prominently marked in the matrix.</p>
<ul>
<li><strong>Native command sweep:</strong> 16 deterministic pairings × 4 operations. Positive closed/manifold/oriented results, approximate volume inclusion bounds, Boolean undo/redo/save-reopen, and blend undo/redo were checked. All 14 Boolean refusals and 253 completed bevel refusals preserved their original figure state and draw geometry. Boolean save journals were compared ignoring repeated display-only <code>dim auto</code> entries.</li>
<li><strong>Independent sampled spatial audit:</strong> recorded source and result triangles are checked with a separate BVH/ray-parity implementation—not the modelling kernel’s classifier. Two non-axis-aligned rays and 512 deterministic points per accepted output test Boolean occupancy; mesh bounds test union/intersection/difference inclusion. 49 outputs pass these samples; one is flagged. A 1% bounds tolerance and >1% occupancy mismatch threshold allow tessellation error, so passing is not exact geometry certification.</li>
<li><strong>Independent algebra check:</strong> all 11 families with all four completed Boolean operations satisfy union/intersection/difference volume identities within 1% of combined native source volume. Volume is tessellated/approximate, not an independent exact geometric oracle.</li>
<li><strong>Full visual coverage:</strong> all 64 Boolean cases are captured in the actual native C++ ImGui CPU-reference raster. The real browser WebGL2 renderer also displays 116 recorded native draw packets covering original operands, accepted Booleans and accepted sampled blend examples. Recorded packet replay is labelled as replay, not mouse-input evidence.</li>
<li><strong>Actual input subset:</strong> eight distinct engine-accepted cases—offset boxes, rotated boxes, sphere/box, sphere/sphere, cone/sphere, torus/box, extruded hexagon/box and translated/scaled sphere/cylinder—also pass native ImGui and HTML mouse selection → B → signed numeric entry → Apply → undo/redo → history reopening. The torus/box union is subsequently flagged as geometrically incorrect despite accepting UI input. This deliberately chosen engine-accepted UI subset is not the denominator for geometry acceptance.</li>
<li><strong>Remaining gaps:</strong> refusal diagnostics are retained rather than assuming every tested selection and radius should succeed.  tilted-cylinder/box and several cone/torus Booleans refuse; many derived curved edges and non-planar bevels are unsupported; connected corner resolution and trim conversion remain limited. The loft-derived A−B case has an accepted, spatially sampled Boolean result but its e17 fillet at 0.025 did not return within 100 seconds. That process was terminated; rollback is not asserted for the timed-out request.</li>
<li><strong>Graphics honesty:</strong> native color captures are CPU-reference raster. Browser WebGL2 uses software ANGLE/SwiftShader here, with zero CPU RGBA frame uploads—not physical-GPU proof. Neither the native topology check nor this finite sample certifies arbitrary NURBS curvature or every geometry/radius.</li>
</ul>
<details><summary>Reproduce the full audit</summary><pre>python3 Tools/Build/ProbeSolidArcBroadGeometry.py --workers 4
# Nonzero exit is expected while the recorded timeout/validation failures remain.
python3 Tools/Build/RunSolidArcEditorProof.py --build-only
SOLIDARC_OCCT_BLEND_HOST="$PWD/.cache/solidarc-occt/BlendHost" .cache/solidarc-editor/SolidArcEditorProof --broad-geometry-proof _AgentScratch/tmp/BroadGeometry/results.json
node Tools/Build/AuditSolidArcBroadGeometrySpatial.mjs
node Tools/Build/CaptureSolidArcBroadGeometry.mjs
python3 Tools/Build/GenerateSolidArcBroadGeometryProof.py
node Tools/Build/VerifySolidArcBroadGeometryProof.mjs</pre></details>
<footer>All captures and machine results are generated from the actual native implementation. No alternate geometry implementation or fabricated successful fallback is used.</footer>
<script type="application/json" id="evidence">PAYLOAD</script>
<script>
const data=JSON.parse(document.querySelector('#evidence').textContent),rows=data.results.cases,byId=Object.fromEntries(rows.map(r=>[r.id,r]));
let selected='offset-boxes-subtract-ab',renderer='native',stage='boolean';
const count=r=>r.blends.filter(b=>b.accepted).length;
const matches=r=>{const f=document.querySelector('#filter').value,n=count(r),total=r.blends.length;return f==='all'||f==='spatial-flagged'&&r.spatial?.status==='flagged'||f==='boolean-refused'&&r.status==='boolean-refused'||f==='none'&&!!r.stages.boolean&&n===0||f==='partial'&&n>0&&n<total||f==='all-blends'&&total>0&&n===total&&r.status!=='timeout'||f==='timeout'&&r.status==='timeout';};
for(const fixture of data.fixtures){const tr=document.createElement('tr');tr.dataset.fixture=fixture.id;const label=document.createElement('td');label.textContent=fixture.label;tr.append(label);
 for(const op of data.operations){const row=byId[fixture.id+'-'+op],td=document.createElement('td'),b=document.createElement('button');b.dataset.case=row.id;const accepted=!!row.stages.boolean;const flagged=row.spatial?.status==='flagged';b.className=flagged||!accepted?'bad':'ok';b.append(document.createTextNode(flagged?'⚠ Engine accepted · spatial FAIL':accepted?'✓ Accepted · sampled check':'✗ Boolean refused'));const text=document.createElement('span');text.textContent=row.status==='timeout'?`${count(row)}/${row.blends.length} completed bevels · + timeout`:`${count(row)}/${row.blends.length} sampled bevels accepted`;b.append(text);b.onclick=()=>{selected=row.id;render();};td.append(b);tr.append(td);}document.querySelector('#matrix tbody').append(tr);}
function imageFor(row,render,view){if(view==='source')return data.images[render+':'+row.fixture+':source'];if(view==='boolean')return data.images[render+':'+row.id+':boolean']||data.images[render+':'+row.fixture+':source'];return data.images[render+':'+row.id+':'+view];}
function available(row,render,view){return !!imageFor(row,render,view)||render==='gpu'&&['fillet','chamfer'].includes(view)&&!!row.stages.boolean;}
function render(){const row=byId[selected];if(!available(row,renderer,stage))stage='boolean';
 for(const b of document.querySelectorAll('[data-case]')){const active=b.dataset.case===selected;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));b.disabled=!matches(byId[b.dataset.case]);b.classList.toggle('dim',b.disabled);}
 for(const tr of document.querySelectorAll('#matrix tbody tr'))tr.hidden=!rows.some(r=>r.fixture===tr.dataset.fixture&&matches(r));
 for(const b of document.querySelectorAll('[data-renderer]'))b.setAttribute('aria-pressed',String(b.dataset.renderer===renderer));
 for(const b of document.querySelectorAll('[data-stage]')){b.disabled=!available(row,renderer,b.dataset.stage);b.setAttribute('aria-pressed',String(b.dataset.stage===stage));}
 document.querySelector('#case-title').textContent=row.label+' · '+row.operation;
 document.querySelector('#case-summary').textContent=(row.spatial?.status==='flagged'?'GEOMETRY DEFECT: engine accepted this result, but independent spatial checks fail. ':'')+(row.stages.boolean?'Boolean accepted; ':'Boolean refused; original operands retained. ')+`${count(row)}/${row.blends.length} completed sampled bevels accepted.`+(row.status==='timeout'?' One additional request timed out.':'');
 let src=imageFor(row,renderer,stage),detail='';
 if(stage==='source')detail='Original operands; no Boolean result is implied.';
 else if(stage==='boolean')detail=row.stages.boolean?'Accepted native Boolean result.':'Boolean refused: original operands shown, not a successful Boolean.';
 else if(['fillet','chamfer'].includes(stage)){const sample=row.blends.find(b=>b.visual&&b.mode===stage);if(sample)detail=`Recorded accepted ${stage}: e${sample.targets}, size ${sample.size}. Other sampled attempts may still refuse.`;else{src=imageFor(row,renderer,'boolean');detail=`NO SAMPLED ${stage.toUpperCase()} ACCEPTED. Unmodified Boolean result shown—not a blend.`;}}
 else{const ui=(renderer==='native'?data.nativeUI:data.htmlUI).find(u=>u.id===selected);detail=`Actual own-mouse UI ${stage.endsWith('preview')?'preview':'Apply'}: ${ui.mode}, e${ui.edge}, size ${ui.size}.`;}
 if(row.spatial?.status==='flagged')detail='WARNING: BOOLEAN SPATIAL AUDIT FAILED. '+detail;
 const caption=`${row.id} · ${stage} · ${renderer==='native'?'actual C++ ImGui / CPU-reference color':stage.startsWith('ui-')?'actual HTML mouse UI / WebGL2 software GPU':'native C++ draw-packet replay / real WebGL2 software GPU'}. ${detail}`;
 const img=document.querySelector('#proof-image');img.src=src;img.alt=caption;document.querySelector('#view-status').textContent=caption;document.querySelector('#caption').textContent=caption;
 document.querySelector('#commands').textContent=['# Fresh isolated document','reset',...row.commands,row.booleanCommand,...row.blends.map(b=>`# ${b.accepted?'ACCEPTED':'REFUSED'}: beveladd ${b.size} --mode=${b.mode} --targets=${row.owner}:e${b.targets}`)].join('\n');
 const tbody=document.querySelector('#attempts tbody');tbody.replaceChildren();for(const blend of row.blends){const tr=document.createElement('tr');for(const text of [`e${blend.targets}`,`${blend.mode} / ${blend.size}`,blend.accepted?'Engine accepted + topology + undo/redo':'Refused; original geometry retained',blend.lines.filter(x=>x.includes('✗')).join('\n')||'Validated modelling result']){const td=document.createElement('td');td.textContent=text;tr.append(td);}tr.className=blend.accepted?'ok':'bad';tbody.append(tr);}
 document.querySelector('#attempt-summary').textContent=`Individual sampled bevel attempts: ${count(row)} accepted / ${row.blends.length} completed${row.status==='timeout'?' + one timeout':''}`;
 document.querySelector('#boolean-detail').textContent=JSON.stringify({status:row.status,spatialAudit:row.spatial,topology:row.topology,sourceTopology:row.sourceTopology,refusalPreserved:row.refusalPreserved,diagnostic:row.booleanLines,timeout:row.status==='timeout'?row.reason:undefined},null,2);
}
for(const b of document.querySelectorAll('[data-renderer]'))b.onclick=()=>{renderer=b.dataset.renderer;render();};
for(const b of document.querySelectorAll('[data-stage]'))b.onclick=()=>{stage=b.dataset.stage;render();};
document.querySelector('#filter').onchange=()=>{if(!matches(byId[selected]))selected=rows.find(matches)?.id||selected;render();};
document.querySelector('#download-results').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data.results,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='SolidArcBroadGeometryResults.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
render();
</script></main></body></html>'''
page=page.replace('PAYLOAD',json.dumps(payload,separators=(',',':')))
target=GALLERY/'SolidArcBroadGeometryProof.html';target.write_text(page)
index=GALLERY/'SolidArcProofs.html'
# Preserve any existing hand-authored/generated index. In this workspace no index
# existed; the already-running mirror's /proofs endpoint can serve this safely
# without restarting its native child or touching a live drawing.
if not index.exists():index.symlink_to(target.name)
print(f'{target} ({target.stat().st_size:,} bytes); {len(images)} recorded image states')
