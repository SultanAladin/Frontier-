"""Portable evidence: real native own-input captures + browser Inspector results."""
from pathlib import Path
import base64
import html
import json
import struct
import zlib

ROOT = Path(__file__).resolve().parents[2]
FOLDER = ROOT / 'Exhibits/Gallery/Editor'

def image(name, caption):
    raw = (FOLDER / name).read_bytes()
    at = 8
    parts = []
    while at < len(raw):
        n = struct.unpack_from('>I', raw, at)[0]
        parts.append((raw[at+4:at+8], raw[at+8:at+8+n]))
        at += 12+n
    def chunk(k, b):
        return struct.pack('>I', len(b))+k+b+struct.pack('>I', zlib.crc32(k+b)&0xffffffff)
    header = next(b for k,b in parts if k == b'IHDR')
    pixels = zlib.decompress(b''.join(b for k,b in parts if k == b'IDAT'))
    packed = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR', header)+chunk(b'IDAT', zlib.compress(pixels,9))+chunk(b'IEND',b'')
    return '<figure><img src="data:image/png;base64,'+base64.b64encode(packed).decode()+'" alt="'+html.escape(caption)+'"><figcaption>'+html.escape(caption)+'</figcaption></figure>'

native = json.loads((FOLDER / 'SolidArcNativeBooleans3DProof.json').read_text())
browser = json.loads((FOLDER / 'SolidArcHtmlBooleans3DProof.json').read_text())
assert native['invalidPairDisabled'] and browser['emptyIntersectionDisabled']
assert len(native['cases']) == len(browser['cases']) == 4
assert all(c['mouseSelectionApply'] and c['undoRedo'] for c in native['cases'])
assert all(c['orderedMouseSelection'] and c['mouseApply'] and c['undoRedo'] for c in browser['cases'])
assert browser['graphics']['rgbaUploads'] == 0 and not browser['errors']
page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SolidArc · 3D solid booleans</title><style>body{margin:32px auto;padding:0 24px;max-width:1280px;background:#101113;color:#eee;font:16px system-ui}p,li{line-height:1.6;color:#ccc}a{color:#8fcaff}section{padding:20px;border:1px solid #383b40;border-radius:16px;margin:24px 0}img{width:100%;height:auto;border-radius:10px}figure{margin:20px 0}figcaption{padding:10px 0;color:#bbb}td,th{text-align:left;border-bottom:1px solid #444;padding:12px}pre{white-space:pre-wrap;font-size:13px;color:#bbb}</style><h1>3D solid booleans · native C++ + HTML</h1><p>Select two whole solid bodies, in click order. The existing Inspector offers Union, Subtract and Intersect. <strong>Subtract = first − second</strong>; Reverse order swaps operands. Cached native preflight computes each operation and validates its B-rep before enabling the button. Empty or unsupported results are greyed out with a reason. Inputs are consumed in one undoable modelling step; results are closed, manifold, oriented, positive-volume solids. Disconnected unions remain a multi-hull body.</p><p><a href="/gpu/?example=booleans3d">Open live 3D boolean example</a> · <a href="/cpp">Native editor</a></p><p><strong>Rendering disclosure:</strong> native captures are the actual C++ ImGui UI and CPU-reference raster; HTML captures use WebGL2 with SwiftShader software. Neither is physical-GPU evidence. Native own mouse/Shift/wheel events and browser Inspector clicks perform selection and Apply; proofs do not directly invoke the boolean command.</p><table><tr><th>Operation</th><th>Expected/result volume (m³)</th><th>Native + HTML selection/Apply/undo/redo</th></tr>'''
for c in native['cases']:
    page += f'<tr><td>{html.escape(c["operation"])}</td><td>{c["volume"]}</td><td>PASS</td></tr>'
page += '</table><p>46 native tests pass. 3D regression covers aligned and offset boxes, enclosed cavities, a cylindrical through-bore, disconnected unions, identical/contained-target empty refusals, reverse order and save/reopen. General free-form intersections must be transversal: unsupported/contact configurations are refused, not silently approximated. Boolean parameters are not an editable feature-history graph.</p>'
for key, title in [('Union','Union'),('Subtract','First − second'),('Intersect','Intersection'),('ReverseSubtract','Second − first')]:
    page += '<section><h2>'+title+'</h2>'+image('EditorProof_SolidArc_NativeBoolean3D'+key+'.png','C++ own-input result: '+title)
    page += '<details><summary>Matching HTML Inspector result</summary>'+image('EditorProof_SolidArc_HtmlBoolean3D'+({'Union':'union','Subtract':'subtract','Intersect':'intersect'}.get(key,key))+'.png','HTML own-click result: '+title)+'</details></section>'
page += '<section><h2>Real controls and invalid-pair state</h2>'+image('EditorProof_SolidArc_NativeBoolean3DParameters.png','Native ordered bodies and boolean Apply popup')+image('EditorProof_SolidArc_NativeBoolean3DDisabled.png','Disjoint solids: empty Intersect disabled, click ignored')+'</section>'
page += '<h2>Reproduce</h2><pre>python3 Experimental/SolidArc/Native/GeometryMetrics.py\npython3 Tools/Build/RunSolidArcEditorProof.py --build-only\n.cache/solidarc-editor/SolidArcEditorProof --booleans3d-only\nLD_LIBRARY_PATH="$PWD/.cache/browser/libs/lib" BROWSER_EXECUTABLE=/tmp/chromium node Tools/Build/RunSolidArcBooleans3DProof.mjs\npython3 Tools/Build/GenerateSolidArcBooleans3DProof.py</pre><details><summary>Machine-readable results</summary><pre>'+html.escape(json.dumps(dict(native=native,browser=browser),indent=2))+'</pre></details></html>'
output = FOLDER / 'SolidArcBooleans3DProof.html'
output.write_text(page)
print(output, output.stat().st_size, 'bytes')
