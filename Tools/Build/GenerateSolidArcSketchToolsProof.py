"""Portable embedded evidence from actual bottom-toolbar Cut and Trim workflows."""
from pathlib import Path
import base64
import html
import json
import struct
import zlib

Root = Path(__file__).resolve().parents[2]
Folder = Root / 'Exhibits/Gallery/Editor'


def image(name, caption):
    raw = (Folder / name).read_bytes()
    at, records = 8, []
    while at < len(raw):
        n = struct.unpack_from('>I', raw, at)[0]
        records.append((raw[at + 4:at + 8], raw[at + 8:at + 8 + n]))
        at += 12 + n
    def chunk(k, b):
        return struct.pack('>I', len(b)) + k + b + struct.pack('>I', zlib.crc32(k + b) & 0xffffffff)
    header = next(b for k, b in records if k == b'IHDR')
    compressed = zlib.compress(zlib.decompress(b''.join(b for k, b in records if k == b'IDAT')), 9)
    packed = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', compressed) + chunk(b'IEND', b'')
    data = base64.b64encode(packed).decode()
    return f'<figure><img src="data:image/png;base64,{data}" alt="{html.escape(caption)}"><figcaption>{html.escape(caption)}</figcaption></figure>'


page = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SolidArc · Sketch Cut and Trim</title><style>body{background:#111;color:#ddd;font:16px system-ui;max-width:1500px;margin:32px auto;padding:0 24px}p,li{line-height:1.6}h1,h2{color:white}img{width:100%;border:1px solid #444;border-radius:10px}figure{margin:24px 0}figcaption{padding:10px;color:#bbb}pre{overflow:auto;padding:20px;background:#191919;border-radius:10px}</style>
<h1>Bottom toolbar · Select / Cut / Trim</h1><p>The new compact monochrome toolbar is anchored at the bottom of the viewport in both the browser and native C++ / ImGui editor. Its buttons act on sketch curves, not solid bodies or surface faces. There are no placeholder tools.</p><ul><li><strong>Cut:</strong> arm the tool, then click a curve to split it at the picked exact NURBS parameter. On a closed curve the picked point and existing seam form two pieces; endpoints/seams refuse rather than produce a zero-length piece.</li><li><strong>Trim:</strong> arm the tool, then click inside the segment to remove between visible curve intersections. Open curve ends also bound intervals. Crossing boundary curves are preserved.</li><li><strong>Select / Esc:</strong> leave editing mode. Buttons are greyed out without eligible geometry; Trim needs actual intersections. Existing drawing protects its draft. Click-drag does not accidentally cut; Alt-drag still orbits upright in the browser.</li><li>Results are exact native curves, not browser meshes. Surviving pieces are selected, the first source identity is retained, construction/material metadata is preserved, and obsolete parametric blueprints are detached. Every edit supports single-step undo/redo and canonical save/reopen.</li></ul><p><strong>Verification:</strong> 35/35 native geometry metrics pass. Browser and native own-mouse toolbar/viewport tests pass, including disabled states, Cut, Trim, surviving pieces, unchanged cutters and undo/redo. Browser additionally checks non-editing drags, armed navigation, exact circle arcs and drawing-mode protection. Native additionally checks locked eligibility and cache invalidation. Existing face Extrude, disabled Loft and upright orbit regressions pass.</p><p><strong>Rendering disclosure:</strong> browser WebGL2 screenshot adapter is software SwiftShader with zero CPU fragments and zero RGBA framebuffer uploads. Native screenshots are the C++ CPU-reference raster with real ImGui mouse inputs, not evidence of a physical GPU. Screen-space curve picking evaluates the native NURBS; it does not render a CPU image for the browser.</p>"""
for prefix,title in [('SolidArc','Browser · WebGL2 / software SwiftShader'),('EditorProof_SolidArc_','Native C++ · CPU reference / ImGui')]:
    page+='<h2>'+title+'</h2>'
    for name,caption in [('CutTool.png','Cut armed from the bottom toolbar; no geometry is changed by arming.'),('CutResult.png','Actual viewport click splits the curve; both exact pieces are selected.'),('TrimTool.png','Trim armed with two visible intersecting boundary curves.'),('TrimResult.png','The clicked middle interval is removed; both surviving pieces and original boundaries remain.')]:
        page+=image(prefix+name,caption)
for name,title in [('SolidArcSketchToolsProof.json','Browser checks'),('SolidArcNativeSketchToolsProof.json','Native own-mouse checks')]:
    page+='<h2>'+title+'</h2><pre>'+html.escape(json.dumps(json.loads((Folder/name).read_text()),indent=2))+'</pre>'
page+='</html>'
Target=Folder/'SolidArcSketchToolsProof.html';Target.write_text(page);print(Target)
