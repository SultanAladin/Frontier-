#!/usr/bin/env python3
"""Self-contained current orbit/face-UV evidence. No external images or network."""
from pathlib import Path
import base64, html, io, json, sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'.cache/proof-python'))
from PIL import Image
F=ROOT/'Exhibits/Gallery/Editor'
def embed(path):
    image=Image.open(path);out=io.BytesIO();image.save(out,format='PNG',optimize=True)
    return 'data:image/png;base64,'+base64.b64encode(out.getvalue()).decode()
frames=[Image.open(F/f'SolidArcOrbitUv_motion_{i:02}.png').convert('RGB') for i in range(1,13)]
frames[0].save(F/'SolidArcOrbitFaceUV.gif',save_all=True,append_images=frames[1:],duration=[110]*11+[1000],loop=0)
gif='data:image/gif;base64,'+base64.b64encode((F/'SolidArcOrbitFaceUV.gif').read_bytes()).decode()
parts=[f'<h2>Viewport orbit and face-UV text · WebGL2 / SwiftShader</h2><img src="{gif}" alt="Real browser mouse orbit with cube face text following its UV plane">']
if (F/'SolidArcRightDragProof.json').exists():
    right=['<h2>Latest correction · RIGHT mouse button</h2><p>Actual RMB mouse events: horizontal drag rotates world Z only; vertical drag changes elevation only. No roll, no pan, fixed pivot/radius. MMB or Shift+RMB pans. Left/Alt free-orbit is separate.</p>']
    for name,title in [('SolidArcRightDrag_iso_horizontal.png','HTML · right-drag horizontal/world-Z test'),('SolidArcRightDrag_iso_vertical.png','HTML · right-drag vertical/elevation test'),('EditorProof_SolidArc_RightDrag.png','C++ CPU proof · native RMB horizontal and vertical mouse tests')]:
        right.append('<h3>'+title+'</h3><img src="'+embed(F/name)+'" alt="'+title+'">')
    right.append('<details><summary>Right-button input results</summary><pre>'+html.escape((F/'SolidArcRightDragProof.json').read_text())+'</pre></details>')
    parts.insert(0,''.join(right))
for name,title in [
 ('SolidArcCubeFaceUV.png','HTML · text mapped to each cube face'),
 ('SolidArcOrbitUv_top_before.png','HTML · Top view before horizontal drag'),
 ('SolidArcOrbitUv_top_after.png','HTML · after horizontal drag: eye orbits away from the pole'),
 ('SolidArcOrbitUv_bottom_after.png','HTML · Bottom-view orbit'),
 ('EditorProof_SolidArc_OrientationCube.png','Native C++ · textured font vertices mapped through face UVs'),
 ('EditorProof_SolidArc_OrbitTopBefore.png','Native C++ · Top view before native mouse drag'),
 ('EditorProof_SolidArc_OrbitTopAfter.png','Native C++ · after 24 native pointer moves; fixed pivot and orbit radius')]:
 parts.append(f'<h2>{html.escape(title)}</h2><img src="{embed(F/name)}" alt="{html.escape(title)}">')
for name in ['SolidArcOrbitUvProof.json','SolidArcNativeCubeProof.json']:
 parts.append('<details><summary>'+name+'</summary><pre>'+html.escape((F/name).read_text())+'</pre></details>')
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SolidArc · Orbit and face UV correction</title><style>body{font:15px system-ui;background:#101214;color:#eee;max-width:1440px;margin:32px auto;padding:0 24px}p{line-height:1.65;color:#bcc6d2}img{display:block;width:100%;border-radius:12px;margin:18px 0 36px}pre{white-space:pre-wrap}details{padding:20px;background:#191d21;border-radius:12px;margin:16px 0}</style><h1>Viewport orbit + cube-face UV text</h1><p>16 October 2026. Left/Alt drag motion rotates the camera eye and up together around the fixed target; distance and scene geometry are unchanged. Horizontal dragging leaves Top/Bottom instead of merely spinning at the pole. Both camera implementations agree across 28 steps and all seven named views. Cube text is attached to each face's UV basis, not a screen-facing billboard.</p><p>The browser images are WebGL2 with software SwiftShader, zero CPU image uploads. Native images are C++ CPU reference rasters of real scene and ImGui glyph triangles, not native Vulkan/physical-GPU evidence. The box is an explicit command-created test fixture; all demonstrated orbit gestures are actual injected browser/native mouse input. Six native cube-face clicks and workplane snaps also pass.</p>'''+''.join(parts)+'</html>'
(F/'SolidArcOrbitUvProof.html').write_text(page)
# Fresh workspaces may not retain the previous ignored gallery; keep /proofs useful.
if not (F/'SolidArcProofs.html').exists():
    (F/'SolidArcProofs.html').write_text(page)
print(F/'SolidArcOrbitUvProof.html')
