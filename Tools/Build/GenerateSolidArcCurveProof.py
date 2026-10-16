"""Embed actual browser/native mouse evidence in one portable HTML document."""
from pathlib import Path
import base64
import html
import json
import struct
import zlib

Root = Path(__file__).resolve().parents[2]
Folder = Root / 'Exhibits/Gallery/Editor'
Evidence = json.loads((Folder / 'SolidArcCurveDrawingProof.json').read_text())
Native = json.loads((Folder / 'SolidArcMouseProof.json').read_text())


def image(name, caption):
    raw=(Folder/name).read_bytes();at=8;records=[]
    while at<len(raw):
        n=struct.unpack_from('>I',raw,at)[0]
        records.append((raw[at+4:at+8],raw[at+8:at+8+n]));at+=12+n
    def chunk(k,b):
        return struct.pack('>I',len(b))+k+b+struct.pack('>I',zlib.crc32(k+b)&0xffffffff)
    header=next(b for k,b in records if k==b'IHDR')
    compressed=zlib.compress(zlib.decompress(b''.join(b for k,b in records if k==b'IDAT')),9)
    packed=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',header)+chunk(b'IDAT',compressed)+chunk(b'IEND',b'')
    data=base64.b64encode(packed).decode()
    return f'<figure><img src="data:image/png;base64,{data}" alt="{html.escape(caption)}"><figcaption>{html.escape(caption)}</figcaption></figure>'


Content = '''<!doctype html><html lang="en"><meta charset="utf-8"><title>SolidArc — scroll and curve drawing proof</title>
<style>body{background:#111;color:#ddd;font:16px system-ui;margin:32px auto;max-width:1400px;padding:0 24px}h1,h2{color:white}figure{margin:24px 0}img{width:100%;border:1px solid #444;border-radius:10px}figcaption{padding:10px;color:#bbb}pre{overflow:auto;background:#191919;padding:20px;border-radius:10px}li{margin:8px 0}</style>
<h1>Sketch Draw: scrolling and four explicit curve tools</h1>
<p>Actual mouse input, not sample insertions. Browser geometry commits through the native C++ ToolSession; previews use WebGL2 segment draws.</p>
<ul><li>Hermite: start, end, start tangent handle, incoming end tangent handle. Cubic Hermite derivatives are handle displacements.</li>
<li>Bézier: click control points; Enter/right-click finishes.</li><li>B-spline: click control points; choose degree 1–7; Enter/right-click finishes. Clamped uniform knots; effective degree is limited by point count.</li>
<li>NURBS: the same workflow with positive comma-separated weights, one per point. Blank weights mean all ones. The proof uses degree 2 and weights 1,3,1.</li>
<li>31 catalogue entries; both browser and native Sketch Draw catalogues scroll.</li></ul>
<p>Validation: 19 native geometry tests; 21 native mouse-selected tools, 1,392 pointer moves; browser mouse drawing of all four curves, real wheel scrolling and undo/redo. Browser adapter: SwiftShader (software WebGL2), zero CPU fragments and zero RGBA image uploads. Native screenshots: C++ CPU reference renderer, not hardware GPU claims.</p>'''
Content += image('SolidArcCurveMenu.png', 'Wheel-scrolled Sketch Draw catalogue: Hermite, Bézier, B-spline and NURBS are reachable.')
Content += image('SolidArcCurvesDrawn.png', 'Four mouse-authored native curves: Hermite (upper left), Bézier (upper right), B-spline (lower left), weighted NURBS (lower right).')
for tool in ['hermite', 'bezier', 'bspline', 'nurbs']:
    Content += image(f'SolidArcCurvePreview_{tool}.png', f'{tool}: live browser preview before final commit, with tangent/control guides.')
    Content += image(f'EditorProof_SolidArc_Mouse_{tool}.png', f'{tool}: own-mouse native ImGui selection and C++ drawing, CPU reference raster.')
Content += '<h2>Browser evidence</h2><pre>' + html.escape(json.dumps(Evidence, indent=2)) + '</pre>'
Content += '<h2>Native own-mouse evidence</h2><pre>' + html.escape(json.dumps(Native, indent=2)) + '</pre></html>'
Target = Folder / 'SolidArcCurveProof.html'
Target.write_text(Content)
print(Target)
