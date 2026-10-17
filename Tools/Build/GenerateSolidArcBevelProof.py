"""Portable embedded evidence for the shared native bevel feature workflow."""
from pathlib import Path
import base64
import html
import json
import struct
import zlib

Root=Path(__file__).resolve().parents[2]
Folder=Root/'Exhibits/Gallery/Editor'

def image(Name,Caption):
    Raw=(Folder/Name).read_bytes();At=8;Records=[]
    while At<len(Raw):
        N=struct.unpack_from('>I',Raw,At)[0];Records.append((Raw[At+4:At+8],Raw[At+8:At+8+N]));At+=12+N
    def chunk(K,B):return struct.pack('>I',len(B))+K+B+struct.pack('>I',zlib.crc32(K+B)&0xffffffff)
    Header=next(B for K,B in Records if K==b'IHDR')
    Data=zlib.compress(zlib.decompress(b''.join(B for K,B in Records if K==b'IDAT')),9)
    Packed=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',Header)+chunk(b'IDAT',Data)+chunk(b'IEND',b'')
    return '<figure><img alt="'+html.escape(Caption)+'" src="data:image/png;base64,'+base64.b64encode(Packed).decode()+'"><figcaption>'+html.escape(Caption)+'</figcaption></figure>'

Page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SolidArc · Interactive Bevel / Chamfer</title><style>body{background:#111;color:#ddd;font:16px system-ui;max-width:1500px;margin:32px auto;padding:0 24px}p,li{line-height:1.6}h1,h2{color:#fff}img{width:100%;border:1px solid #444;border-radius:12px}figure{margin:24px 0}figcaption{padding:10px;color:#bbb}pre{overflow:auto;padding:20px;background:#191919;border-radius:10px}code{color:#bcd}</style>
<h1>Interactive Bevel / Chamfer · B</h1>
<p>One shared C++ feature implementation, with browser WebGL2 and native ImGui interaction. The approved workspace, Inspector, grid, gizmo and Select / Cut / Trim workflows remain intact.</p>
<ul><li>Select solid edges (2), whole planar sketch curves, or individual sketch corner vertices (1). Press <strong>B</strong>; Shift+B starts flat chamfer.</li><li>Move horizontally to adjust. Positive signed distance selects fillet radius; negative distance selects equal chamfer setback. Shift gives fine incremental adjustment. Type directly, or click the field: <code>250mm</code>, <code>-25cm</code>, metres, inches and feet are supported. Use <strong>Mouse adjust</strong> to return from pinned numeric entry.</li><li><strong>Enter / Apply / viewport left-click</strong> confirms; <strong>Esc / Cancel / viewport right-click</strong> cancels. Alt-left / middle-drag navigation remains available. Invalid sizes disable Apply. Unsupported native geometry refuses without partial changes.</li><li>Preview is isolated from the authored document, undo and persistence. Apply creates one undo transaction, retains object identity, and adds actual per-object feature metadata and exact input snapshots.</li><li>Click a <strong>Bevel history</strong> property or feature in the bottom history strip to edit size/mode. Multiple features can coexist on a solid or sketch. Editing an earlier feature rebuilds downstream steps only when their geometric targets resolve uniquely. Failure leaves every feature unchanged.</li><li>Canonical native save/reopen restores editable features. Rigid and uniform-scale transforms preserve attached bevel history. Changes outside the bevel chain may make earlier properties explicitly read-only rather than erase those changes.</li></ul>
<p><strong>Verification:</strong> 50 native geometry/feature metrics and 5 numeric-input tests pass. Actual browser and native own-mouse proofs cover 3D edge and 2D corner selection, B, units, typing without clicking the field, confirmation, cancellation, disabled invalid Apply, history edits, multiple-feature replay and undo/redo. Browser checks save/reopen and the clickable bottom history strip; native checks exact rational sketch arcs, solid validity and multiple 3D features. Existing native/browser Cut/Trim, E Extrude, disabled Loft, and upright orbit regressions pass.</p>
<p><strong>Boundaries:</strong> this interaction exposes constant-radius fillets and equal-setback chamfers, not Plasticity’s complete variable-radius, asymmetric or continuity-control toolset. Smooth curves have no sharp corners; join separate sketch segments into a cornered curve first. Rounded sketch corners require straight adjacent supports. Oversized/overlapping sets and unsupported curved-solid routes refuse. Conservative target rebinding can refuse earlier edits when downstream geometry moves or becomes ambiguous.</p>
<p><strong>Rendering disclosure:</strong> browser screenshots use WebGL2 with the software SwiftShader driver, zero CPU fragments and zero RGBA framebuffer uploads. Native screenshots use the real C++ CPU-reference raster and actual ImGui mouse/keyboard input. Neither is evidence of physical GPU execution.</p>'''
for Name,Caption in [
 ('SolidArcBevel3DResult.png','Browser: a real native rounded solid edge, retained object identity and an editable fillet property.'),
 ('SolidArcBevelHistoryEdit.png','Browser: edit that same feature as a flat chamfer using signed numeric input, without stacking an accidental second bevel.'),
 ('SolidArcBevel2DPreview.png','Browser: native 2D corner preview using a mouse-picked vertex; only that corner is targeted.'),
 ('SolidArcBevelMultipleHistory.png','Browser: two sketch bevel features, with the earlier feature edited and the later step replayed.'),
 ('SolidArcBevelRefusal.png','Browser: unsupported/oversized preview is refused and Apply is disabled; source geometry stays intact.'),
 ('EditorProof_SolidArc_Bevel3DPreview.png','Native ImGui: B opens a live solid-edge preview from its own viewport mouse selection.'),
 ('EditorProof_SolidArc_BevelHistoryEdit.png','Native ImGui: the Inspector feature property reopens for signed unit entry and atomic replay.'),
 ('EditorProof_SolidArc_Bevel2DResult.png','Native ImGui: own-mouse selected sketch corner, exact chamfer, editable history and Enter confirmation.')]:
    Page+=image(Name,Caption)
for Name,Title in [('SolidArcBevelProof.json','Browser interaction checks'),('SolidArcNativeBevelProof.json','Native own-input checks')]:
    Page+='<h2>'+Title+'</h2><pre>'+html.escape(json.dumps(json.loads((Folder/Name).read_text()),indent=2))+'</pre>'
Page+='</html>'
Target=Folder/'SolidArcBevelProof.html';Target.write_text(Page);print(Target)
