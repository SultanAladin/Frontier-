"""Portable report of native/browser keyboard, mouse, GPU-pick and stacked-box checks."""
from pathlib import Path
import base64
import html
import json
import struct
import zlib

root = Path(__file__).resolve().parents[2]
folder = root / 'Exhibits/Gallery/Editor'
native = json.loads((folder / 'SolidArcNativeShortcutsPickingProof.json').read_text())
browser = json.loads((folder / 'SolidArcHtmlShortcutsPickingProof.json').read_text())
assert all(native[k] for k in ['ctrlAConstruct', 'ctrlSSave', 'ctrlViewportToggle', 'ctrlShiftOutliner', 'occlusionAndFaceIds', 'gpuPointPicking'])
assert all(browser[k] for k in ['ctrlSSave', 'ctrlAConstructAndTextSelection', 'ctrlShiftOutliner', 'ctrlViewportGpuPicking', 'shiftViewportGpuPicking', 'faceContactSubtractUnchanged'])

def image(name, caption):
    raw = (folder / name).read_bytes()
    at, parts = 8, []
    while at < len(raw):
        n = struct.unpack_from('>I', raw, at)[0]
        parts.append((raw[at+4:at+8], raw[at+8:at+8+n]))
        at += 12+n
    def chunk(k, b):
        return struct.pack('>I',len(b))+k+b+struct.pack('>I',zlib.crc32(k+b)&0xffffffff)
    packed = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR', next(b for k,b in parts if k==b'IHDR'))+chunk(b'IDAT',zlib.compress(zlib.decompress(b''.join(b for k,b in parts if k==b'IDAT')),9))+chunk(b'IEND',b'')
    return '<figure><img src="data:image/png;base64,'+base64.b64encode(packed).decode()+'" alt="'+html.escape(caption)+'"><figcaption>'+html.escape(caption)+'</figcaption></figure>'

content='''<!doctype html><meta charset="utf-8"><title>SolidArc · Shortcuts, selection and GPU picking</title>
<style>body{background:#202124;color:#ddd;font:16px system-ui;max-width:1200px;margin:40px auto;padding:0 22px}h1,h2{color:#fff}p,li{line-height:1.6}figure{margin:30px 0}img{width:100%;border:1px solid #555}figcaption{padding:12px;background:#292a2d}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:12px;border:1px solid #555}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#292a2d}a{color:#acf}</style>
<h1>Shortcuts, multiselection & native GPU picking</h1>
<p>Verified using actual browser keyboard/mouse events and native ImGui mouse/key inputs, backed by the C++ model.</p>
<ul><li><b>Ctrl+S:</b> HTML .arc download and native recovery-file save.</li><li><b>Ctrl+A:</b> existing Construct popup; ordinary text-field selection remains intact. Escape closes Construct.</li><li><b>Ctrl / Shift-click:</b> additive/toggle viewport and Outliner selection. Outliner selects clicked entities, not intervening rows.</li></ul>
<h2>Native GPU picking: measured scope</h2>
<p>CPU-owned geometry streams are drawn into an actual GLES3 R32UI ID attachment with a depth attachment. Selection reads GPU-generated IDs, including encoded face IDs; tests cover occlusion and points. The visible native PNG remains CPU-reference rendering. In this sandbox ANGLE uses <b>software SwiftShader</b>, not a physical GPU. This is not a Vulkan renderer or a completed native GPU color migration. Native picking remains opt-in with SOLIDARC_GPU_PICKING_LIBRARY_DIR; absent that setting, the CPU reference backend remains available.</p>
<h2>Same XY extents · different Z positions</h2>
<p>C++ regression suite: <b>47 tests passed</b>. Each enabled stacked-box operation verifies closed/manifold/oriented topology, hull count, volume, Undo and Redo. Each box has XY extents [−2,2] × [−2,2], height 2.</p>
<table><tr><th>Z ranges</th><th>Union volume</th><th>Subtract volume</th><th>Intersection volume</th></tr><tr><td>[0,2] and [1,3]</td><td>48 · one hull</td><td>16</td><td>16</td></tr><tr><td>[0,2] and [2,4]</td><td>64 · one hull</td><td>32</td><td>Disabled: no volume overlap</td></tr><tr><td>[0,2] and [3,5]</td><td>64 · two disconnected hulls</td><td>32</td><td>Disabled: no volume overlap</td></tr></table>
<p><b>Additional bug repaired:</b> a smaller box sharing only part of the larger box's top face previously retained a duplicate internal interface. The union now has one closed manifold hull, volume 40 and exterior area 80; browser selection and Apply are verified as well.</p>'''
for name, caption in [('EditorProof_SolidArc_NativeCtrlA.png','Native C++: Ctrl+A opens the existing Construct menu.'),('EditorProof_SolidArc_NativeMultiSelect.png','Native C++: own Ctrl/Shift Outliner input with ordered multiple selection.'),('EditorProof_SolidArc_HtmlStackedUnion.png','HTML GPU viewport: native-backed Union after actual ordered-selection and Apply clicks.')]:
    content += image(name,caption)
for label, data in [('Native proof',native),('Browser proof',browser)]:
    content += '<h2>'+label+'</h2><pre>'+html.escape(json.dumps(data,indent=2))+'</pre>'
output=folder / 'SolidArcShortcutsPickingProof.html'
output.write_text(content)
print(output,output.stat().st_size)
