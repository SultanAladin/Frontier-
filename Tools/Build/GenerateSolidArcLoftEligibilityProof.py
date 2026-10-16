"""Portable evidence of greyed-out coplanar solid loft actions."""
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


page = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SolidArc · Loft eligibility</title><style>body{background:#111;color:#ddd;font:16px system-ui;max-width:1500px;margin:32px auto;padding:0 24px}p,li{line-height:1.6}img{width:100%;border:1px solid #444;border-radius:10px}figure{margin:24px 0}figcaption{padding:10px;color:#bbb}pre{overflow:auto;padding:20px;background:#191919}</style><h1>Coplanar closed profiles: solid Loft disabled</h1><p>Loft remains visible but greyed out when all selected closed profiles lie in one plane. Its tooltip explains the zero-thickness restriction and moving a section out of the plane re-enables it immediately. The check is shared C++ geometry logic, using rational control points against an actual support plane, not a comparison of Z coordinates.</p><p>Intentional sheets are different: open coplanar profiles retain Loft, and explicit <code>loft selected --sheet</code> remains supported. The default solid command rejects coplanar closed profiles atomically even if invoked outside the Inspector.</p><p><strong>Checks:</strong> 30/30 native metrics pass, including horizontal, vertical and oblique planes; separation; open-profile planar sheets; explicit sheet output; atomic command refusal. Actual native ImGui and browser mouse clicks on disabled Loft do not open Apply or alter geometry. Moving a section re-enables the button and produces a real valid solid. Existing browser loft and browser/native face Extrude regressions pass.</p><p><strong>Rendering:</strong> browser WebGL2 uses software SwiftShader; native screenshots are the C++ CPU-reference raster. No physical hardware GPU claim.</p>"""
for name, caption in [
 ('SolidArcLoftDisabled.png','Browser: coplanar closed curves selected; Loft remains visible but disabled.'),
 ('SolidArcLoftReenabled.png','Browser: moving the second profile out of the plane re-enables Loft.'),
 ('EditorProof_SolidArc_LoftDisabled.png','Native C++ / ImGui: disabled Loft ignores actual mouse clicks; tooltip explains the reason.'),
 ('EditorProof_SolidArc_LoftReenabled.png','Native C++: separating a profile restores Loft; subsequent mouse Apply creates a validated solid.'),
]: page += image(name,caption)
page += '<h2>Browser checks</h2><pre>'+html.escape(json.dumps(json.loads((Folder/'SolidArcLoftEligibilityProof.json').read_text()),indent=2))+'</pre></html>'
Target=Folder/'SolidArcLoftEligibilityProof.html'
Target.write_text(page)
print(Target)
