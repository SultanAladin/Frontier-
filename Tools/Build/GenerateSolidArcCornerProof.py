#!/usr/bin/env python3
"""Self-contained evidence for the actual mixed arc/line user corner."""
import base64
import html
import json
from pathlib import Path
import struct
import zlib
Root=Path(__file__).resolve().parents[2]
Folder=Root/'Exhibits/Gallery/Editor'
def ImageBlock(Name,Caption):
    Raw=(Folder/Name).read_bytes();At=8;Records=[]
    while At<len(Raw):
        N=struct.unpack_from('>I',Raw,At)[0];Records.append((Raw[At+4:At+8],Raw[At+8:At+8+N]));At+=12+N
    def Chunk(K,B):return struct.pack('>I',len(B))+K+B+struct.pack('>I',zlib.crc32(K+B)&0xffffffff)
    # Lossless re-compression only: the actual screenshot pixels are unchanged.
    Data=zlib.compress(zlib.decompress(b''.join(B for K,B in Records if K==b'IDAT')),9)
    Packed=b'\x89PNG\r\n\x1a\n';Written=False
    for K,B in Records:
        if K==b'IDAT':
            if not Written:Packed+=Chunk(K,Data);Written=True
        else:Packed+=Chunk(K,B)
    return '<figure><img src="data:image/png;base64,'+base64.b64encode(Packed).decode()+'"><figcaption>'+html.escape(Caption)+'</figcaption></figure>'
Page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SolidArc · Actual connected-corner repair</title><style>body{background:#111;color:#ddd;font:16px system-ui;max-width:1500px;margin:32px auto;padding:0 24px}p,li{line-height:1.6}h1,h2{color:#fff}img{width:100%;border:1px solid #444;border-radius:10px}figure{margin:24px 0}figcaption{padding:10px;color:#bbb}pre{overflow:auto;padding:20px;background:#191919;border-radius:10px}code{color:#bcd}a{color:#bcd}</style>
<h1>Actual user corner · connected arc + line</h1>
<p>The browser proof opens an isolated copy of the original live construction journal, including the two earlier fillets. The native own-input proof uses a minimized journal with the identical extrusion, face displacements, earlier radii and selected edges. Neither proof replaces the case with an independently rounded box.</p>
<ul><li>Earlier radii: <strong>258.2021677 mm</strong> and <strong>193.0693437927 mm</strong>. New selected rim: arc 14 plus tangent line 15, at <strong>20.2791507347 mm</strong>.</li><li>The shared C++ builder offsets the entire mixed rim together. The circular portion is an exact rational <strong>torus</strong>, joined tangentially to an exact <strong>cylinder</strong>. Flat mode uses an exact conical revolution and plane. Original support surfaces are retained and trimmed, not replaced by a triangle mesh.</li><li>A collapsed seam from the earlier local roll is compacted during a complete loop rebuild. The result has <strong>11 faces, 25 edges, 16 vertices, Euler 2, genus 0</strong>, with no open, non-manifold or misoriented edges.</li><li>The C++ proof checks every edge against both supporting surfaces (nine samples), G1 normals at both rails and the roll join, positive curvature-aware removal volume, selection order/deduplication, arc-only tangent expansion, rigid rotation and unsafe-size refusal. Maximum measured support gap: approximately <strong>2.2 × 10⁻⁹ m</strong>; this is a numerical consistency check, not a manufacturing-accuracy claim.</li><li>Both UIs use their own viewport mouse to select the arc and Shift-add its connected line, then B, numeric units and Apply. The third feature is editable as either fillet or chamfer. Undo/redo, save/reopen, refusal/cancel and editing the second feature to 180 mm while replaying the third are verified.</li></ul>
<p><strong>Verification:</strong> 55 native geometry/feature/concurrent-session tests and 5 input tests pass. Browser and native own-input corner proofs pass, along with existing bevel, Cut/Trim, Extrude, Loft eligibility and upright-orbit regressions. A concurrent import/export collision discovered during the tests was fixed using process-private native exchange files.</p>
<p><strong>Scope:</strong> this repair handles tangent straight/circular prismatic rims on one planar perpendicular cap, with supported straight terminations. It is not a universal multi-branch or arbitrary-surface rolling-ball solver. Unsafe radii, consumed endpoint clearances and self-intersecting cap offsets refuse without changing the source. Existing single-line journal semantics are preserved; explicitly selecting an arc opts into its tangent continuation. Earlier edits whose downstream targets cannot be rebound uniquely still refuse atomically.</p>
<p><strong>Live server:</strong> the same app on port 8081 and native service on 8083. Existing live session journal, selection, camera and pending bevel were checkpointed for the upgrade; no proof operation was committed into the user's session. An oversized pending value remains oversized: 1.552277 m cannot fit this corner; the demonstrated value is 20.2791507347 mm.</p>
<p><strong>Rendering disclosure:</strong> browser evidence is actual WebGL2 geometry drawing with software SwiftShader, zero CPU fragments and zero RGBA framebuffer uploads. Native evidence is the real C++ CPU-reference raster with actual ImGui mouse/keyboard events. Neither claims physical GPU execution. Detail shots change only the camera, not the geometry or radius.</p>'''
for Name,Caption in [
 ('SolidArcCornerSelected.png','Browser · original user journal, isolated body, own mouse arc pick and Shift-added line. Both earlier fillets remain.'),
 ('SolidArcCornerRound.png','Browser · applied round feature 03, 20.2791507347 mm. Inspector shows all three features and the repaired topology.'),
 ('SolidArcCornerRoundDetail.png','Browser · camera detail of the continuous toroidal/cylindrical roll through the selected arc/line corner.'),
 ('SolidArcCornerFlatDetail.png','Browser · same feature edited to flat chamfer, not an extra accidental operation.'),
 ('EditorProof_SolidArc_CornerRound.png','Native C++ / ImGui · own mouse selection, B, numeric units and Apply; three native editable features.'),
 ('EditorProof_SolidArc_CornerRoundDetail.png','Native C++ / ImGui · detail of the same exact torus-to-cylinder fillet.'),
 ('EditorProof_SolidArc_CornerFlatDetail.png','Native C++ / ImGui · same mixed rim, flat mode, changed through its Inspector feature property.'),
 ('SolidArcCornerRefused.png','Browser · 200 mm consumes endpoint clearance. Apply is disabled and cancelling leaves the complete source/history unchanged.')]:Page+=ImageBlock(Name,Caption)
for Name,Title in [('SolidArcKernelCornerProof.json','Direct shared C++ geometry checks'),('SolidArcBrowserCornerProof.json','Actual browser input checks'),('SolidArcNativeCornerProof.json','Actual native ImGui input checks')]:
    Page+='<h2>'+Title+'</h2><pre>'+html.escape(json.dumps(json.loads((Folder/Name).read_text()),indent=2))+'</pre>'
Page+='</html>'
Target=Folder/'SolidArcCornerProof.html';Target.write_text(Page);print(Target)
