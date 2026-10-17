"""Portable native + HTML evidence, curved-solid boolean regression."""
from pathlib import Path
import base64
import html
import json
import struct
import zlib

root=Path(__file__).resolve().parents[2]
folder=root/'Exhibits/Gallery/Editor'
native=json.loads((folder/'SolidArcNativeCurvedBooleansProof.json').read_text())
browser=json.loads((folder/'SolidArcHtmlCurvedBooleansProof.json').read_text())
assert len(native['cases'])==len(browser['cases'])==12 and not browser['errors']
assert all(c['mouseSelectionApply'] and c['undoRedo'] and c['closed'] and c['manifold'] for c in native['cases']+browser['cases'])

def image(name,caption):
    raw=(folder/name).read_bytes()
    at,parts=8,[]
    while at<len(raw):
        n=struct.unpack_from('>I',raw,at)[0]
        parts.append((raw[at+4:at+8],raw[at+8:at+8+n]));at+=12+n
    def chunk(k,b):
        return struct.pack('>I',len(b))+k+b+struct.pack('>I',zlib.crc32(k+b)&0xffffffff)
    packed=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',next(b for k,b in parts if k==b'IHDR'))+chunk(b'IDAT',zlib.compress(zlib.decompress(b''.join(b for k,b in parts if k==b'IDAT')),9))+chunk(b'IEND',b'')
    return '<figure><img src="data:image/png;base64,'+base64.b64encode(packed).decode()+'" alt="'+html.escape(caption)+'"><figcaption>'+html.escape(caption)+'</figcaption></figure>'

content='''<!doctype html><meta charset="utf-8"><title>SolidArc · Curved-solid booleans</title>
<style>body{background:#202124;color:#ddd;font:16px system-ui;max-width:1400px;margin:40px auto;padding:0 22px}h1,h2{color:white}p,li{line-height:1.6}figure{margin:30px 0}img{width:100%;border:1px solid #555}figcaption{padding:12px;background:#292a2d}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#292a2d}</style>
<h1>Sphere & curved-solid booleans · regression repaired</h1>
<p>The affected live scene was not two primitive boxes. It contained an already-unioned stepped body and a sphere at its corner. All three operations were refused with <b>“intersection runs into a surface singularity or seam corner”</b>. Earlier box-specific checks did not cover this.</p>
<h2>What changed in C++</h2>
<p>A sphere's collapsed UV poles and periodic seam are coordinate artifacts. On failure, a validated full sphere can now use another exact rational parameterization, retrying the same surface-intersection / trimmed-face classification / B-rep construction pipeline. The sphere is not moved, approximated by a box or converted into a mesh boolean. Trimmed spherical faces are not blindly reparameterized because their trimming coordinates would need remapping. Invalid outcomes remain refused.</p>
<p>Curved trimmed faces also receive conservative full-surface pole-hull bounds: boundary edges alone can omit most of a remaining spherical surface and cause bad fitting/culling. Such bounds are conservative, not exact physical extents.</p>
<h2>Checks</h2>
<ul><li><b>50 C++ geometry tests pass.</b> New cases cover a sphere cut through its poles at a box corner, the user's already-unioned body plus sphere, and overlapping spheres, with all three operations and both selection orders, journal reopen and Undo/Redo. Existing cylinder/box and stacked-box regressions remain passing.</li><li><b>12 native own-mouse cases pass:</b> actual ImGui Outliner Shift-click/reverse selection and Inspector Apply, closed/manifold/oriented one-hull topology, volume and Undo/Redo.</li><li><b>12 HTML cases pass:</b> actual Outliner Shift-click/reverse and Inspector Apply on the C++ kernel. No JS errors or CPU pixel uploads.</li></ul>
<p>Reported volumes use tessellated quadrature, checked against analytic values within max(0.003, 0.2%). The underlying sphere surface remains rational NURBS; measurement accuracy is not an assertion of exact analytic integration. Native proof color is CPU reference; sandbox GLES picking/browser WebGL2 use software ANGLE/SwiftShader, not physical GPU evidence.</p>
<p><b>Subtraction order:</b> first selected minus second. Select the body first, sphere second for a spherical cut-out; Reverse order swaps them.</p>'''
for name,caption in [
 ('EditorProof_SolidArc_HtmlCurvedEnabled.png','HTML: user geometry with sphere → Union selection; all three operations enabled.'),
 ('EditorProof_SolidArc_HtmlCurvedunion.png','HTML actual Apply: sphere united with the already-unioned stepped body.'),
 ('EditorProof_SolidArc_HtmlCurvedsubtract.png','HTML actual Apply: sphere minus stepped body (the user’s original selection order).'),
 ('EditorProof_SolidArc_NativeCurvedSubtract.png','Native C++ own mouse Apply: stepped body minus sphere, producing a spherical corner cut-out.'),
 ('EditorProof_SolidArc_HtmlCurvedintersect.png','HTML actual Apply: common spherical corner volume.'),
]:content+=image(name,caption)
for title,data in [('Native measurements',native),('HTML measurements',browser)]:content+='<h2>'+title+'</h2><pre>'+html.escape(json.dumps(data,indent=2))+'</pre>'
output=folder/'SolidArcCurvedBooleansProof.html';output.write_text(content);print(output,output.stat().st_size)
