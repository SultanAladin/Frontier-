"""Portable embedded evidence from actual browser/native selection and loft tests."""
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


page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SolidArc · Ordered selection and Inspector loft</title>
<style>body{background:#111;color:#ddd;font:16px system-ui;margin:32px auto;max-width:1500px;padding:0 24px}p,li{line-height:1.6}h1,h2{color:white}figure{margin:24px 0}img{width:100%;border:1px solid #444;border-radius:10px}figcaption{padding:10px;color:#bbb}pre{overflow:auto;background:#191919;padding:20px;border-radius:10px}.green{color:#33ff73}.blue{color:#4099ff}</style>
<h1>Ordered curve selection → Inspector operations → native loft</h1>
<p>Select two curves (Shift-click to add). The Inspector lists the section order and compatible operations from C++: Loft, Sweep, Ruled Surface, Bridge for two open curves, and Join for endpoint-connected curves. More than two sections can be lofted. Kernel geometry validation still runs on Apply.</p>
<p><strong class="green">Last selected = active, green.</strong> <strong class="blue">Other selected curves = blue.</strong> Reverse order changes both the operand order and active curve. Sweep uses the first curve as profile and the second as path.</p>
<p>The browser loft dialog exposes degree and automatic solid/sheet or forced-sheet output. Applying creates real native C++ geometry, selects the result within the same transaction, and undoes/redoes in one step. Both native ImGui mouse input and browser outliner/viewport mouse selection are tested.</p>
<p><strong>Validation:</strong> 23 native geometry tests passed, including ordered colours, eligibility, save/reopen and loft undo/redo. Native own-mouse Inspector Loft + Apply produces a validated solid. Browser screenshot adapter is software SwiftShader WebGL2 (zero CPU fragments / RGBA uploads); native screenshots are the C++ CPU reference, not hardware GPU evidence.</p>'''
for name, caption in [
    ('SolidArcLoftSelection.png', 'Browser: two curves selected against creation order; green active and blue earlier section; C++-compatible Inspector operations.'),
    ('SolidArcLoftParameters.png', 'Browser: ordered operands, loft degree and automatic/forced-sheet result options before Apply.'),
    ('SolidArcLoftResult.png', 'Browser: native solid loft created and automatically selected; one-step undo/redo verified.'),
    ('EditorProof_SolidArc_LoftSelection.png', 'Native C++ / CPU reference: own-mouse Shift selection, active green and earlier blue, matching Inspector options.'),
    ('EditorProof_SolidArc_LoftParameters.png', 'Native: Inspector reversal and Loft button open explicit native operands/parameters.'),
    ('EditorProof_SolidArc_LoftResult.png', 'Native: own-mouse Apply creates a valid solid; one-step undo/redo verified.'),
]:
    page += image(name, caption)
for name, title in [('SolidArcLoftProof.json', 'Browser checks'), ('SolidArcNativeLoftProof.json', 'Native own-mouse checks')]:
    page += '<h2>' + title + '</h2><pre>' + html.escape(json.dumps(json.loads((Folder / name).read_text()), indent=2)) + '</pre>'
page += '</html>'
Target = Folder / 'SolidArcLoftProof.html'
Target.write_text(page)
print(Target)
