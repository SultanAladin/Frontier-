"""Embed real native C++ screenshots and own-input checks into a portable proof page."""
from pathlib import Path
import base64
import html
import json
import struct
import zlib

ROOT=Path(__file__).resolve().parents[2]
FOLDER=ROOT/'Exhibits/Gallery/Editor'

def image(name,caption):
    raw=(FOLDER/name).read_bytes();at=8;parts=[]
    while at<len(raw):
        n=struct.unpack_from('>I',raw,at)[0];parts.append((raw[at+4:at+8],raw[at+8:at+8+n]));at+=12+n
    def chunk(k,b):return struct.pack('>I',len(b))+k+b+struct.pack('>I',zlib.crc32(k+b)&0xffffffff)
    header=next(b for k,b in parts if k==b'IHDR')
    pixels=zlib.decompress(b''.join(b for k,b in parts if k==b'IDAT'))
    packed=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',header)+chunk(b'IDAT',zlib.compress(pixels,9))+chunk(b'IEND',b'')
    return '<figure><img src="data:image/png;base64,'+base64.b64encode(packed).decode()+'" alt="'+html.escape(caption)+'"><figcaption>'+html.escape(caption)+'</figcaption></figure>'

record=json.loads((FOLDER/'SolidArcNativeOperationsProof.json').read_text())
assert len(record['cases'])==3
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SolidArc · Native Solidify / Pipe / Revolve proofs</title><style>body{margin:32px auto;padding:0 24px;max-width:1280px;background:#101113;color:#eee;font:16px system-ui}p,li{line-height:1.6;color:#ccc}a{color:#8fcaff}section{padding:20px;border:1px solid #383b40;border-radius:16px;margin:24px 0}img{width:100%;height:auto;border-radius:10px}figure{margin:20px 0}figcaption{padding:10px 0;color:#bbb}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #444;padding:12px}pre{white-space:pre-wrap;font-size:13px;color:#bbb}</style><h1>Native C++ · Solidify / Pipe / Revolve</h1><p><strong>Actual C++ ImGui and CPU-reference renders.</strong> Not HTML overlays, not physical GPU/Vulkan evidence. Fixture sources are prepared through native commands; operation buttons, wheel scrolling, numeric input and Apply use the native application's own ImGui mouse/key events. The proof does not execute Solidify/Pipe/Revolve command strings itself: Apply dispatches them through the real native Inspector.</p><p>Each operation checks disabled Apply for zero, selected result, positive volume, closed/manifold/oriented topology and single-step undo/redo. Thin wireframe; control-marker clutter stays off.</p><nav><a href="#Solidify">Solidify</a> · <a href="#Pipe">Pipe</a> · <a href="#Revolve">Revolve</a> · <a href="/cpp">Live native editor</a> · <a href="/gpu/?example=operations">HTML demo tabs</a></nav><table><tr><th>Native operation</th><th>V / E / F</th><th>Volume (m³)</th><th>Checks</th></tr>'''
for case in record['cases']:
    for flag in ['mouseApply','invalidValueDisabled','undoRedo','closed','manifold','oriented']:assert case[flag]
    page+=f'<tr><td>{case["operation"]}</td><td>{case["vertices"]} / {case["edges"]} / {case["faces"]}</td><td>{case["volume"]}</td><td>PASS</td></tr>'
page+='</table>'
notes={'Solidify':'0.45 m total thickness: two translated caps joined by four exact sidewalls. 6 sewn faces, volume 5.4 m³. Directional thickening along the centre normal, not a general curved-surface normal-offset solver.', 'Pipe':'0.22 m radius along a spatial Bézier. Capped circular solid sweep; radius remains editable through native Dimensions.', 'Revolve':'360° about world Z through the origin. Closed XZ profile creates an 8-face collar with through-bore (genus 1). Angle remains editable through native Dimensions.'}
for key,note in notes.items():
    page+=f'<section id="{key}"><h2>{key}</h2><p>{html.escape(note)}</p>'
    page+=image(f'EditorProof_SolidArc_Native{key}Result.png',f'{key}: native mouse Apply result, validated and restored by undo/redo.')
    page+='<details><summary>Native numeric parameter popup</summary>'+image(f'EditorProof_SolidArc_Native{key}Parameters.png',f'{key}: native parameter input before Apply. Zero was tested disabled; this is the valid value.')+'</details></section>'
page+='<h2>Reproduce</h2><pre>python3 Tools/Build/RunSolidArcEditorProof.py --build-only\n.cache/solidarc-editor/SolidArcEditorProof --operations-only\npython3 Tools/Build/GenerateSolidArcNativeOperationsProof.py</pre><details><summary>Machine-readable results</summary><pre>'+html.escape(json.dumps(record,indent=2))+'</pre></details></html>'
output=FOLDER/'SolidArcNativeOperationsProof.html';output.write_text(page);print(output,output.stat().st_size,'bytes')
