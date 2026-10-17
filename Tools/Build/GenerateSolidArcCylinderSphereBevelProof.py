"""Portable, interactive report from the actual cylinder/sphere native and HTML tests.

Run the named test harnesses first. Missing or failed evidence aborts generation;
never substitute screenshots from an unrelated fixture.
"""
from pathlib import Path
import base64
import html
import json
import struct
import zlib

ROOT = Path(__file__).resolve().parents[2]
SCRATCH = ROOT / '_AgentScratch/tmp'
GALLERY = ROOT / 'Exhibits/Gallery/Editor'
native_ui = json.loads((GALLERY / 'SolidArcCylinderSphereNativeUI.json').read_text())
native_pointer = json.loads((SCRATCH / 'CylinderSphereNativeProof.json').read_text())
browser = json.loads((SCRATCH / 'CylinderSphereBevelBrowser/results.json').read_text())
regression = (SCRATCH / 'cylinder-bevel-regression.log').read_text()
old_probe = json.loads((SCRATCH / 'OcctBlendProbe.json').read_text())
assert len(native_ui) == len(native_pointer) == len(browser['cases']) == 8
assert not browser['errors'] and browser['graphics']['rgbaUploads'] == 0
assert 'Ran 70 tests' in regression and regression.rstrip().endswith('OK')
assert len(old_probe['cases']) == 6 and all(c['accepted'] and c['undoRedo'] for c in old_probe['cases'])
expected = {(order, edge, mode) for order in (0, 1) for edge in (1, 2) for mode in ('fillet', 'chamfer')}
for results in (native_ui, native_pointer, browser['cases']):
    assert {(r['order'], r['edge'], r['mode']) for r in results} == expected


def compressed_png(data):
    # The native counterpart writes uncompressed PNG IDAT streams. Recompress
    # those bytes losslessly, without decoding, resizing or editing any pixel.
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    chunks, compressed, offset = [], [], 8
    while offset < len(data):
        length = struct.unpack('>I', data[offset:offset+4])[0]
        kind = data[offset+4:offset+8]
        payload = data[offset+8:offset+8+length]
        if kind == b'IDAT': compressed.append(payload)
        else: chunks.append((kind, payload))
        offset += length + 12
    original = zlib.decompress(b''.join(compressed))
    packed = zlib.compress(original, 9)
    assert zlib.decompress(packed) == original
    result = bytearray(data[:8])
    for kind, payload in chunks:
        if kind == b'IEND':
            result.extend(struct.pack('>I', len(packed)) + b'IDAT' + packed + struct.pack('>I', zlib.crc32(b'IDAT' + packed)))
        result.extend(struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload)))
    return bytes(result)


def image(path):
    return 'data:image/png;base64,' + base64.b64encode(compressed_png(path.read_bytes())).decode()


images = {}
for order, edge, mode in sorted(expected):
    key = f'{order}-{mode}-e{edge}'
    images[key] = {
        'native': {stage: image(GALLERY / f'SolidArcCylinderSphere-{key}-{stage}.png')
                   for stage in ('before', 'preview', 'applied')},
        'html': {stage: image(SCRATCH / f'CylinderSphereBevelBrowser/{key}-{stage}.png')
                 for stage in ('preview', 'applied')},
    }
button_path = SCRATCH / 'CylinderSphereProofButtons/results.json'
buttons = json.loads(button_path.read_text()) if button_path.is_file() else None
if buttons:
    assert buttons['imageStates'] == 40 and buttons['nativeMirrorPanels'] == 5
    assert buttons['nativeProofButton'] and buttons['htmlProofButton'] and buttons['htmlProofCloseButton']
    assert buttons['nativeMirrorConstructInput'] and buttons['proofBrowsingPreservedDocument'] and not buttons['pageErrors']
results = dict(proofButtons=buttons, nativeImGui=native_ui, nativeGlesPointer=native_pointer, html=browser,
               sphereBoxProbe=old_probe, regression='70 tests, OK')
page = '''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SolidArc · Cylinder / sphere bevel proof</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{max-width:1360px;margin:32px auto;padding:0 22px;background:#101112;color:#e6e7e8;font:15px/1.6 system-ui}h1{font-size:32px;line-height:1.2;margin:8px 0 18px}h2{font-size:22px;margin-top:30px}.eyebrow{color:#b7bdc2;letter-spacing:.12em;font-size:12px;text-transform:uppercase}.passes{display:flex;gap:8px;flex-wrap:wrap}.passes span{background:#14271e;color:#a5e5ba;border:1px solid #315540;padding:7px 12px;border-radius:7px}.controls{padding:16px;background:#191b1e;border:1px solid #3a3d42;border-radius:10px;margin-top:24px}.controls p{margin:0 0 8px;color:#afb4bb}.row{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px}button,a{font:inherit}button{cursor:pointer;border:1px solid #4b5057;border-radius:6px;padding:8px 12px;background:#24272c;color:#e6e7e8}button[aria-pressed=true]{background:#e2e5e8;color:#111;border-color:#e2e5e8}button:disabled{opacity:.35;cursor:not-allowed}button:focus-visible{outline:3px solid #8cc5ff}figure{margin:16px 0}figure img{width:100%;display:block;border:1px solid #41454b;border-radius:8px;background:#080808}figcaption{padding:10px 0;color:#c0c6cc}.limit{border-left:3px solid #d1a25c;padding:12px 16px;background:#262119;color:#e9d5b3}pre{overflow:auto;background:#191b1e;padding:16px;border:1px solid #34383e;border-radius:8px}summary{cursor:pointer}a{color:#b5d4fa}li{margin:6px 0}code{background:#26292e;padding:2px 5px}
</style></head><body>
<div class="eyebrow">Actual C++ geometry · real input · recorded evidence</div>
<h1>Cylinder / sphere subtraction → fillet &amp; chamfer</h1>
<p>The sphere-minus-cylinder recess reproduces <strong>3 faces · 4 edges · 4 vertices</strong>. Both subtraction orders and both real circular rims are tested independently at <strong>0.0375 m</strong>, in both modes. The other edges are periodic chart seams, not sharp corners; native selection now disables bevel for those seams with an explicit reason.</p>
<div class="passes"><span>8/8 native ImGui mouse + B + Apply</span><span>8/8 native GLES own-pointer + save/reopen</span><span>8/8 HTML mouse + B + Apply</span><span>70/70 regression tests</span><span>6/6 earlier sphere/box probes</span></div>
<div class="controls" aria-label="Recorded proof controls">
<p>Choose the recorded case. These controls switch actual test images; they do not modify your drawing.</p>
<div class="row" id="cases"></div>
<div class="row"><button id="renderer-native" data-renderer="native">Native C++ / ImGui</button><button id="renderer-html" data-renderer="html">HTML / C++ geometry</button></div>
<div class="row"><button id="stage-before" data-stage="before">Before</button><button id="stage-preview" data-stage="preview">Preview</button><button id="stage-applied" data-stage="applied">Applied</button></div>
<output id="proof-status" role="status" aria-live="polite"></output>
</div>
<figure><img id="proof-image" alt="Recorded cylinder sphere bevel proof"><figcaption id="proof-caption"></figcaption></figure>
BUTTON_STATUS
<h2>What was actually exercised</h2>
<ul>
<li><strong>Native ImGui:</strong> primitive setup via C++ commands; then native mouse rim selection, B, signed numeric entry, mouse Apply, solid validation, undo/redo, mouse history reopening, oversized-value disabled Apply and atomic cancellation.</li>
<li><strong>Native GLES ID picking:</strong> actual pointerStart / pointerEnd inputs, not injected pick IDs; preview isolation, commit, undo/redo, save/reopen, feature re-edit, invalid-input rollback and recovery. Three periodic seams also tested for disabled availability and transactional refusal.</li>
<li><strong>HTML:</strong> canvas mouse selection, B, positive fillet / negative chamfer size, Apply, closed/manifold/oriented topology check, history-button reopening, invalid Apply disabled, Cancel, undo/redo, no page errors and zero CPU RGBA frame uploads.</li>
<li><strong>Repair:</strong> recover analytic cylinder supports; repair periodic UV seams and imported face wires; clamp and extend rational support domains without changing their geometry; split closed supports and retry if rational conversion creates intersecting UV wires; sample closed circular trimming loops more densely. Native endpoint, trim, solid, volume and tagged tangent-normal validation remain enforced.</li>
</ul>
<p><strong>Graphics labels:</strong> native ImGui screenshots are C++ CPU-reference color raster, not physical-GPU footage. Native GLES picking and browser WebGL2 run on software ANGLE/SwiftShader in this sandbox. Browser geometry/grid are GPU drawn; no CPU scene image is uploaded.</p>
<p class="limit"><strong>Bounded proof, not arbitrary-radius certification.</strong> A separate exploratory cylinder-minus-sphere chamfer at 0.03 m still refuses on native/worker volume disagreement. The tests retain that refusal and verify unchanged geometry, then recover by switching the same feature to the validated fillet mode. No validity tolerance was relaxed to manufacture success.</p>
<h2>Reproduce in an isolated document</h2>
<pre>sphere (0,0,0) 1
cylinder (0,0,0) .6 2
boolean subtract #1 -- #2 --select-result
# Pick either circular rim in edge mode (2), press B.
# Use 37.5mm for fillet or -37.5mm for chamfer, then Apply.
# Reverse the subtraction operands to exercise the other order.</pre>
<details><summary>Repeatable test commands</summary><pre>python3 Tools/Build/BuildSolidArcOcctBlend.py
python3 Experimental/SolidArc/Native/CompileSequence.py --native
python3 Tools/Build/PrepareSolidArcNativeGpuPicking.py
python3 Experimental/SolidArc/Native/CylinderSphereBevelMetrics.py
python3 Tools/Build/RunSolidArcEditorProof.py --build-only
SOLIDARC_OCCT_BLEND_HOST="$PWD/.cache/solidarc-occt/BlendHost" .cache/solidarc-editor/SolidArcEditorProof --cylinder-sphere-bevel-only
node Tools/Build/RunSolidArcCylinderSphereBevelProof.mjs
python3 Tools/Build/GenerateSolidArcCylinderSphereBevelProof.py
node Tools/Build/VerifySolidArcCylinderSphereProofButtons.mjs</pre></details>
<details><summary>Machine-readable test results</summary><pre>RESULTS</pre></details>
<script id="recorded-images" type="application/json">IMAGES</script>
<script>
const images=JSON.parse(document.querySelector('#recorded-images').textContent);
const keys=Object.keys(images);let selected='0-fillet-e1',renderer='native',stage='applied';
for(const key of keys){const [order,mode,edge]=key.split('-');const b=document.createElement('button');b.dataset.case=key;b.textContent=`${order==='0'?'Sphere − cylinder':'Cylinder − sphere'} · ${edge} · ${mode}`;b.onclick=()=>{selected=key;refresh();};document.querySelector('#cases').append(b);}
for(const b of document.querySelectorAll('[data-renderer]'))b.onclick=()=>{renderer=b.dataset.renderer;if(!images[selected][renderer][stage])stage='preview';refresh();};
for(const b of document.querySelectorAll('[data-stage]'))b.onclick=()=>{stage=b.dataset.stage;refresh();};
function refresh(){
 for(const b of document.querySelectorAll('[data-case]'))b.setAttribute('aria-pressed',String(b.dataset.case===selected));
 for(const b of document.querySelectorAll('[data-renderer]'))b.setAttribute('aria-pressed',String(b.dataset.renderer===renderer));
 for(const b of document.querySelectorAll('[data-stage]')){b.setAttribute('aria-pressed',String(b.dataset.stage===stage));b.disabled=!images[selected][renderer][b.dataset.stage];}
 const [order,mode,edge]=selected.split('-');const text=`${order==='0'?'Sphere minus cylinder':'Cylinder minus sphere'} · ${edge} · ${mode} 0.0375 m · ${stage} · ${renderer==='native'?'native ImGui / C++ CPU-reference color':'HTML / WebGL2 software GPU / native C++ geometry'}`;
 const img=document.querySelector('#proof-image');img.src=images[selected][renderer][stage];img.alt=text;
 document.querySelector('#proof-caption').textContent=text;document.querySelector('#proof-status').textContent=text;
}
refresh();
</script></body></html>'''
button_section = ''
if buttons:
    button_section = '<h2>Live proof buttons verified</h2><p>40/40 recorded image states; all five native mirror panels; native and HTML proof launchers; Close; live native Construct mouse input. Browsing proof panels preserved the isolated HTML document. No page errors.</p>'
    for name, title in [('native-mirror-construct', 'Live C++ mirror · mouse opens actual native Construct'), ('html-proof-button', 'HTML C++ bevel proof button · report opens without changing the drawing')]:
        button_section += f'<details><summary>{title}</summary><figure><img alt="{title}" src="{image(SCRATCH / f"CylinderSphereProofButtons/{name}.png")}"></figure></details>'
page = page.replace('BUTTON_STATUS', button_section)
page = page.replace('RESULTS', html.escape(json.dumps(results, indent=2)))
page = page.replace('IMAGES', json.dumps(images))
target = GALLERY / 'SolidArcCylinderSphereBevelProof.html'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(page)
print(f'{target} ({target.stat().st_size:,} bytes)')
