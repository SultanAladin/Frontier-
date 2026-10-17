"""Portable constructed-solid audit, preserving blockers and prior proof reports."""
from pathlib import Path
import base64
import json
from ProofPng import compressed_png

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'_AgentScratch/tmp/ComplexGeometry'
GALLERY=ROOT/'Exhibits/Gallery/Editor'
results=json.loads((OUT/'results.json').read_text());audit=json.loads((OUT/'audit.json').read_text())
manifest=json.loads((ROOT/'Experimental/SolidArc/Native/Fixtures/ComplexGeometry.json').read_text())
captures=json.loads((OUT/'captures.json').read_text())
native=json.loads((GALLERY/'ComplexGeometryNativeCaptures.json').read_text());native_ui=json.loads((GALLERY/'ComplexGeometryNativeUI.json').read_text())
assert len(results['fixtures'])==24 and results['completedFinalBooleans']==78 and results['engineAccepted']==27
assert results['constructionBodies']==127 and results['constructionBlocked']==11
assert not results['timeouts'] and not results['testFailures']
assert len(native)==89 and len(native_ui)==len(captures['ui'])==4 and len(captures['captures'])==178
assert not captures['pageErrors'] and all(c['rgbaUploads']==0 for c in captures['captures'])
assert all(c.get('refusalPreserved') for f in results['fixtures'] for c in f['cases'] if not c['accepted'])
assert all(c.get('refusalPreserved') for f in results['fixtures'] for c in f['construction'] if not c.get('accepted'))
assert all(s['status']=='sampled-check-passed' for key in ['stages','sources','finals'] for s in audit[key])
assert sum(u['Apply'] for u in native_ui)==sum(u['Apply'] for u in captures['ui'])==3
images={}

def add(key,path):
    packed=compressed_png(path.read_bytes())
    if path.parent==GALLERY and len(packed)<path.stat().st_size:path.write_bytes(packed)
    images[key]='data:image/png;base64,'+base64.b64encode(packed).decode()

for capture in captures['captures']:add('gpu:'+capture['id']+':'+capture['stage'],ROOT/capture['path'])
for fixture in results['fixtures']:
    add('native:'+fixture['id']+':source',GALLERY/f'ComplexGeometry-{fixture["id"]}-source.png')
    for row in fixture['cases']:add('native:'+row['id']+':boolean',GALLERY/f'ComplexGeometry-{row["id"]}-boolean.png')
for renderer,entries in [('native',native_ui),('gpu',captures['ui'])]:
    for row in entries:
        for stage in ['ui-before-apply','ui-result']:
            path=GALLERY/f'ComplexGeometry-{row["id"]}-{stage}.png' if renderer=='native' else OUT/f'images/{row["id"]}-html-{stage}.png'
            add(renderer+':'+row['id']+':'+stage,path)

# Compact durable observations: no meshes, screenshots or absolute scratch paths.
# This records current failures, not a target that future repairs must preserve.
baseline=dict(description='Observed constructed-solid coverage baseline, not the desired acceptance target. No solver fixes claimed.',summary={k:v for k,v in results.items() if k!='fixtures'},auditCounts=audit['counts'],commutativity=audit['commutativity'],fixtures=[])
final_audits={a['id']:a for a in audit['finals']}
for fixture in results['fixtures']:
    failure=next((s for s in fixture['construction'] if not s.get('accepted')),None)
    baseline['fixtures'].append(dict(id=fixture['id'],status=fixture['status'],tags=fixture['tags'],saveReopen=fixture.get('saveReopen'),constructionBlocker=dict(index=failure['index'],command=failure['command'],reason=[x for x in failure['lines'] if '✗' in x],preserved=failure['refusalPreserved']) if failure else None,cases=[dict(id=c['id'],operation=c['operation'],accepted=c['accepted'],topology=c.get('topology'),refusalPreserved=c.get('refusalPreserved'),undoRedo=c.get('undoRedo'),reason=[x for x in c['lines'] if '✗' in x],audit={k:v for k,v in final_audits.get(c['id'],{}).items() if k not in ('examples','packet')}) for c in fixture['cases']]))
(ROOT/'Experimental/SolidArc/Native/Fixtures/ComplexGeometryBaseline.json').write_text(json.dumps(baseline,indent=2)+'\n')
payload=dict(results=results,audit=audit,specs=manifest['fixtures'],operations=manifest['operations'],nativeUI=native_ui,htmlUI=captures['ui'],images=images)
page=r'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SolidArc · Constructed and concave geometry stress tests</title>
<style>:root{color-scheme:dark}*{box-sizing:border-box}body{background:#101216;color:#e3e8ef;font:15px/1.55 system-ui;margin:0}main{max-width:1460px;margin:34px auto;padding:0 22px}h1{font-size:33px;line-height:1.2}h2{font-size:23px}.eyebrow{font-size:12px;letter-spacing:.15em;color:#b4c1d0;text-transform:uppercase}.notice{background:#29241c;border-left:4px solid #dcb16c;padding:14px 18px}.cards{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0}.cards div{border:1px solid #3d4857;background:#1b2028;padding:12px 16px;border-radius:8px}.cards strong{display:block;font-size:26px}.cards small{color:#bbc7d6}a{color:#a9ceff}button,select{font:inherit;color:inherit;padding:8px 11px;border:1px solid #4b5c70;background:#222b37;border-radius:6px}button{cursor:pointer}button:hover{border-color:#bbd6f6}button[aria-pressed=true]{background:#d9e7f7;color:#101216}button:disabled{opacity:.35;cursor:not-allowed}.toolbar{display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin:12px 0}.scroll{overflow:auto;border:1px solid #3b4756;border-radius:8px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #323f50;padding:8px;text-align:left;vertical-align:top}th{background:#1d2632}td:first-child{min-width:210px}td button{min-width:120px;width:100%;text-align:left;font-size:12px}.ok{color:#a0dfb1}.bad{color:#f1afa0}.blocked{color:#e9c68f}.card{margin-top:24px;padding:18px;border:1px solid #445269;border-radius:10px;background:#1a202a}.card h2{margin-top:0}.card img{width:100%;display:block;background:#080808;border:1px solid #435066;border-radius:6px}figure{margin:14px 0}figcaption{padding:9px 0;color:#c4cfdd}#view-status{display:block;padding:12px;background:#242f3d;border-radius:6px}pre{padding:14px;background:#151b24;border:1px solid #3a495e;border-radius:6px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer;padding:6px 0}code{background:#2a3545;padding:2px 5px}li{margin:8px 0}footer{margin-top:30px;color:#b8c4d3}</style></head><body><main>
<div class="eyebrow">Native C++ · constructed solids · independent intended-geometry reference</div><h1>Concave, holed and multi-stage Boolean stress tests</h1>
<p><a href="/gpu/proofs/repairs.html"><strong>New: first C++ Boolean repairs — cone/box fixed; remaining periodic gaps</strong></a>. Historical results below remain unchanged.</p>
<p class="notice"><strong>This is a testing expansion, not a geometry repair.</strong> Remaining defects are kept in <code>Experimental/SolidArc/Native/GEOMETRY_GAPS.md</code> for later work. All 24 pairings involve constructed solids—not just primitive pairs. Failures, blocked construction chains and numerical limits are retained.</p>
<div class="cards"><div><strong>24</strong><small>engineered shape pairings</small></div><div><strong>196</strong><small>construction commands attempted</small></div><div><strong>127</strong><small>accepted intermediate bodies audited</small></div><div><strong>78 / 144</strong><small>planned final Booleans actually executed</small></div><div><strong>27 / 78</strong><small>engine-accepted final results</small></div><div><strong>11</strong><small>source constructions blocked; 66 final tests not run</small></div></div>
<p><a href="/proofs">Earlier 64-case primitive/mixed audit</a> · <a href="/cpp">Native C++ mirror</a> · <a href="/gpu/">HTML GPU editor</a>. Browsing these captures never changes a live drawing.</p>
<p>Shapes include L/U/C sections, stars, seven-tooth combs, terraces, multiple through-bores, blind pockets with islands, ribbed brackets, hollow crossing pipes, slotted annular flanges, concave ruled lofts, 0.06-thick walls, 0.004/0.002 near-coincident offsets, disconnected parts and disconnected intended intersections. Sources reach 56 native faces. Both operands are constructed in most cases.</p>
<h2>24 × 6 planned operation matrix</h2><p>Six operations test both orders of union/intersection and both subtraction directions. <strong>Blocked</strong> means the source could not be constructed and the final operation was <strong>not attempted</strong>. It is not counted as a final Boolean refusal.</p>
<div class="toolbar"><label>Filter <select id="filter"><option value="all">All engineered pairings</option><option value="blocked">Construction blocked</option><option value="accepted">At least one final accepted</option><option value="all-refused">Sources built; all finals refused</option><option value="asymmetric">Order-dependent acceptance</option></select></label><button id="download-results">Download observations JSON</button></div>
<div class="scroll"><table id="matrix"><thead><tr><th>Constructed pairing</th><th>A ∪ B</th><th>B ∪ A</th><th>A ∩ B</th><th>B ∩ A</th><th>A − B</th><th>B − A</th></tr></thead><tbody></tbody></table></div>
<section class="card"><h2 id="case-title"></h2><p id="case-summary"></p><p id="tags"></p>
<div class="toolbar"><button data-renderer="native">Native C++ / CPU color</button><button data-renderer="gpu">Native geometry / real WebGL2</button></div>
<div class="toolbar"><button data-view="source">Constructed sources / partial build</button><button data-view="A">Source A isolated</button><button data-view="B">Source B isolated</button><button data-view="boolean">Final result / refusal</button><button data-view="stage">Intermediate construction body</button><button data-view="ui-before-apply">Actual mouse UI · before</button><button data-view="ui-result">Actual mouse UI · result / guard</button></div>
<div class="toolbar"><label>Accepted intermediate body <select id="construction-stage"></select></label></div>
<output id="view-status" role="status" aria-live="polite"></output><figure><img id="proof-image" alt="Recorded constructed-solid proof"><figcaption id="caption"></figcaption></figure>
<details open><summary>Exact intended recipe and operation</summary><pre id="commands"></pre></details>
<details open><summary>Construction stages: no silent omission of failed preparation</summary><div class="scroll"><table id="stages"><thead><tr><th>Step</th><th>Command</th><th>Outcome / independent audit</th></tr></thead><tbody></tbody></table></div></details>
<details open><summary>Selected result, reference checks and diagnostics</summary><pre id="diagnostic"></pre></details></section>
<h2>Rigor and limits</h2><ul>
<li><strong>Reference truth is the intended model:</strong> exact polygon-extrusion membership, analytic sphere/cylinder/cone fields, ruled cross-sections, transforms and CSG expressions. The kernel’s returned source meshes are <em>not</em> used as the truth for final operations. Every accepted construction body is checked separately so a bad source cannot be silently inherited.</li>
<li><strong>180 independent mesh/reference audits:</strong> 127 intermediate bodies, 26 completed source bodies, 27 accepted finals. Each uses 4,096 deterministic uniform probes plus profile/primitive witnesses, exact orthogonal CSG cell centers where applicable, and probes on both sides of returned triangles. Total: <strong>770,233 probes</strong>. Separate BVH/two-ray parity checks the native triangles, not the kernel’s classifier.</li>
<li><strong>27/27 accepted finals pass configured spatial checks.</strong> Twelve have exact orthogonal-cell reference volumes. Polygonal tests permit zero non-boundary membership mismatches; curved/non-planar tests permit 0.5% and use a larger boundary exclusion. Exact polygonal/reference volume comparisons use max(5e−7, 1e−5 × reference volume); curved/non-planar native quadrature uses 1%. Passing remains finite numerical evidence—not arbitrary CAD certification.</li>
<li><strong>Loft numerical qualification:</strong> ruled/skewed concave lofts are non-planar, not flat polyhedra. Their native volume estimates differ from the analytic ruled-section integral by approximately 0.084% (L) and 0.402% (U). These residuals are retained; they are within the declared non-planar quadrature allowance, not declared repaired or evidence of an exact volume match.</li>
<li><strong>Transactions:</strong> all 51 final refusals and all 11 construction refusals preserve figure state and draw geometry. All 27 accepted final operations pass undo/redo and source restoration; all 13 completed source pairs pass save/reopen. No timeouts or transaction assertion failures occurred in this sweep.</li>
<li><strong>Metamorphic evidence:</strong> reversed union/intersection are tested. The translated/scaled concave pair has two order-dependent acceptance discrepancies—one union order and one intersection order refuse while their reverse accepts. This is a deferred robustness gap, not hidden by sampling only the passing order.</li>
<li><strong>Visual/input provenance:</strong> all 24 source/partial-source states and all 78 executed final operations have actual native C++ ImGui CPU-reference captures. There are 178 native draw-packet replays through the real WebGL2 renderer, including all 127 intermediate bodies. Separately, both native and HTML exercise three actual Outliner/Shift/operation/Apply transactions and one unsupported-operation disabled-button guard. A blocked action has <em>no Apply popup</em> and is not counted as an Apply success.</li>
<li><strong>Scope:</strong> this expansion targets complex Booleans and construction chains. It does not claim new bevel coverage or fix the earlier bevel gaps. Many refusals are explicitly unsupported/tangent/coincident/non-generic cases; they are capability limitations, not automatically proof of an incorrect accepted result. Native color is CPU reference; browser uses software ANGLE/SwiftShader with zero CPU RGBA frame uploads.</li></ul>
<details><summary>Reproduce</summary><pre>python3 Tools/Build/BuildSolidArcComplexFixtures.py
python3 Tools/Build/ProbeSolidArcComplexGeometry.py --workers 4 --timeout 45
node Tools/Build/AuditSolidArcComplexGeometry.mjs
python3 Tools/Build/PrepareSolidArcComplexCaptures.py
python3 Tools/Build/RunSolidArcEditorProof.py --build-only
SOLIDARC_OCCT_BLEND_HOST="$PWD/.cache/solidarc-occt/BlendHost" .cache/solidarc-editor/SolidArcEditorProof --complex-geometry-captures _AgentScratch/tmp/ComplexGeometry/capture-plan.json
node Tools/Build/CaptureSolidArcComplexGeometry.mjs
python3 Tools/Build/GenerateSolidArcComplexGeometryProof.py
node Tools/Build/VerifySolidArcComplexGeometryProof.mjs</pre></details>
<footer>Durable documents: <code>GEOMETRY_GAPS.md</code>, <code>COMPLEX_GEOMETRY_COVERAGE.md</code>, <code>Fixtures/ComplexGeometry.json</code> and <code>Fixtures/ComplexGeometryBaseline.json</code>. Bulk images/packets remain generated evidence outside Git.</footer>
<script id="evidence" type="application/json">PAYLOAD</script><script>
const data=JSON.parse(document.querySelector('#evidence').textContent),rows=data.results.fixtures,byId=Object.fromEntries(rows.map(r=>[r.id,r])),specs=Object.fromEntries(data.specs.map(r=>[r.id,r])),stageAudits=Object.fromEntries(data.audit.stages.map(r=>[r.id,r])),finalAudits=Object.fromEntries(data.audit.finals.map(r=>[r.id,r]));
let selected='concave-l-notched',operation='union',renderer='native',view='boolean',stageIndex=1;
const opId=()=>selected+'-'+operation;
function matches(row){const f=document.querySelector('#filter').value;return f==='all'||f==='blocked'&&row.status==='construction-refused'||f==='accepted'&&row.cases.some(c=>c.accepted)||f==='all-refused'&&row.status==='completed'&&!row.cases.some(c=>c.accepted)||f==='asymmetric'&&data.audit.commutativity.some(c=>c.fixture===row.id&&!c.acceptanceSymmetric);}
for(const row of rows){const tr=document.createElement('tr');tr.dataset.fixture=row.id;const name=document.createElement('td');name.textContent=row.label;tr.append(name);for(const op of data.operations){const td=document.createElement('td'),button=document.createElement('button'),entry=row.cases.find(c=>c.operation===op);button.dataset.case=row.id+'-'+op;button.dataset.fixture=row.id;button.dataset.operation=op;button.textContent=!entry?'Blocked · not run':entry.accepted?'Accepted · audited':'Refused · preserved';button.className=!entry?'blocked':entry.accepted?'ok':'bad';button.onclick=()=>{selected=row.id;operation=op;view='boolean';stageIndex=byId[selected].construction.find(s=>s.body&&s.accepted)?.index;render();document.querySelector('.card').scrollIntoView({block:'start'});};td.append(button);tr.append(td);}document.querySelector('#matrix tbody').append(tr);}
function stageFor(row,name){return row.construction.filter(s=>s.body&&s.accepted&&s.target===name).at(-1);}
function keyFor(row,kind){if(kind==='source')return `${renderer}:${row.id}:source`;if(kind==='boolean'){const entry=row.cases.find(c=>c.operation===operation);if(renderer==='native'&&entry)return `native:${entry.id}:boolean`;if(entry?.accepted)return `gpu:${entry.id}:boolean`;return `${renderer}:${row.id}:source`;}
 if(kind==='stage'||kind==='A'||kind==='B'){const index=kind==='stage'?stageIndex:stageFor(row,kind)?.index;return `gpu:${row.id}:stage-${index}`;}
 return `${renderer}:${opId()}:${kind}`;}
function available(row,kind){if(['stage','A','B'].includes(kind)&&renderer!=='gpu')return false;if(kind==='stage')return row.construction.some(s=>s.body&&s.accepted);return !!data.images[keyFor(row,kind)];}
function render(){const row=byId[selected],entry=row.cases.find(c=>c.operation===operation);if(!available(row,view))view='source';
 for(const tr of document.querySelectorAll('#matrix tbody tr'))tr.hidden=!matches(byId[tr.dataset.fixture]);for(const b of document.querySelectorAll('[data-case]')){b.disabled=!matches(byId[b.dataset.fixture]);b.setAttribute('aria-pressed',String(b.dataset.case===opId()));}
 for(const b of document.querySelectorAll('[data-renderer]'))b.setAttribute('aria-pressed',String(b.dataset.renderer===renderer));for(const b of document.querySelectorAll('[data-view]')){b.disabled=!available(row,b.dataset.view);b.setAttribute('aria-pressed',String(b.dataset.view===view));}
 const selector=document.querySelector('#construction-stage');selector.replaceChildren();for(const s of row.construction.filter(s=>s.body&&s.accepted)){const option=document.createElement('option');option.value=s.index;option.textContent=`${s.index}: ${s.command}`;selector.append(option);}selector.value=stageIndex;selector.disabled=!selector.options.length;
 document.querySelector('#case-title').textContent=row.label+' · '+operation;document.querySelector('#tags').textContent='Coverage: '+row.tags.join(' · ');
 const blocker=row.construction.find(s=>!s.accepted);document.querySelector('#case-summary').textContent=row.status==='construction-refused'?`SOURCE CONSTRUCTION BLOCKED at step ${row.blockedAt}. No final ${operation} was run.`:entry.accepted?'Final Boolean engine-accepted; intended-geometry spatial checks passed.':'Final Boolean refused; constructed source pair retained.';
 let detail=view==='source'?(blocker?'PARTIAL BUILD shown—not completed A/B operands.':'Completed constructed source pair.'):view==='boolean'?!entry?'NOT RUN: source construction blocked; partial build shown.':entry.accepted?'Accepted final result; finite independent reference checks passed.':'REFUSED: unchanged source pair shown, not a successful Boolean.':['A','B','stage'].includes(view)?'Isolated accepted intermediate native body; reference audit available below.':'Actual mouse input check, not packet replay.';
 const ui=(renderer==='native'?data.nativeUI:data.htmlUI).find(u=>u.id===opId());if(view.startsWith('ui-')&&ui?.disabledBeforePopup)detail='Unsupported operation disabled BEFORE popup; source preserved. No Apply action was available.';
 const caption=`${opId()} · ${view} · ${renderer==='native'?'actual native C++ ImGui / CPU-reference color':view.startsWith('ui-')?'actual HTML mouse UI / software WebGL2':'native C++ packet replay / real software WebGL2'}. ${detail}`;const image=document.querySelector('#proof-image');image.src=data.images[keyFor(row,view)];image.alt=caption;document.querySelector('#caption').textContent=caption;document.querySelector('#view-status').textContent=caption;
 document.querySelector('#commands').textContent=['# Fresh isolated native document','reset',...row.commands.map((c,i)=>(blocker&&i>row.blockedAt?'# NOT REACHED: ':'')+c),entry?.command||'# Final operation NOT RUN: source construction blocked'].join('\n');
 const tbody=document.querySelector('#stages tbody');tbody.replaceChildren();for(const s of row.construction){const tr=document.createElement('tr'),a=stageAudits[row.id+':stage-'+s.index];for(const text of [s.index,s.command,!s.accepted?'REFUSED; original state preserved':s.body?`Accepted body; ${s.topology.faces} faces; ${a?.status||'audit unavailable'}`:'Accepted sketch/display command']){const td=document.createElement('td');td.textContent=text;tr.append(td);}tr.className=s.accepted?'ok':'bad';tbody.append(tr);}
 const activeStage=view==='stage'?row.construction.find(s=>s.index==stageIndex):['A','B'].includes(view)?stageFor(row,view):null;
 document.querySelector('#diagnostic').textContent=JSON.stringify(activeStage?{construction:activeStage,reference:stageAudits[row.id+':stage-'+activeStage.index]}:{status:row.status,constructionBlocker:blocker,operation:entry,reference:entry?finalAudits[entry.id]:null,commutativity:data.audit.commutativity.filter(c=>c.fixture===row.id)},null,2);
}
for(const b of document.querySelectorAll('[data-renderer]'))b.onclick=()=>{renderer=b.dataset.renderer;render();};for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>{view=b.dataset.view;render();};
document.querySelector('#construction-stage').onchange=e=>{stageIndex=Number(e.target.value);renderer='gpu';view='stage';render();};document.querySelector('#filter').onchange=()=>{if(!matches(byId[selected]))selected=rows.find(matches)?.id||selected;stageIndex=byId[selected].construction.find(s=>s.body&&s.accepted)?.index;render();};
document.querySelector('#download-results').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({results:data.results,audit:data.audit},null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='SolidArcConstructedGeometryResults.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};render();
</script></main></body></html>'''
page=page.replace('PAYLOAD',json.dumps(payload,separators=(',',':')))
target=GALLERY/'SolidArcComplexGeometryProof.html';target.write_text(page)
# Existing running mirror already serves /gpu/* from dist. No server restart or
# native-session replacement is needed to publish this new report.
public=ROOT/'Experimental/SolidArc/dist/proofs/complex.html';public.parent.mkdir(parents=True,exist_ok=True);public.write_text(page)
print(f'{target}: {target.stat().st_size:,} bytes, {len(images)} recorded images')
