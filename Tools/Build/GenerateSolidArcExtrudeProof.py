"""Portable embedded evidence of actual browser/native face selection and extrusion."""
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


page = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SolidArc · Contextual face Extrude</title><style>body{background:#111;color:#ddd;font:16px system-ui;margin:32px auto;max-width:1500px;padding:0 24px}p,li{line-height:1.6}h1,h2{color:#fff}figure{margin:24px 0}img{width:100%;border:1px solid #444;border-radius:10px}figcaption{padding:10px;color:#bbb}pre{overflow:auto;background:#191919;padding:20px;border-radius:10px}code{color:#eee}</style>
<h1>Face selection → E / Inspector Extrude → real C++ geometry</h1>
<p>Use face selection (3), click a face, or Shift-click additional faces. The contextual Inspector exposes Extrude. Press E to open the same parameter panel. Choose positive distance and Normal region or Individual face normals, then Apply. Escape cancels without modifying the body. E still opens sketch-profile extrusion; typing E in inputs does not activate a tool.</p>
<ul><li><strong>Normal region:</strong> parallel outward face normals; shared selected-face seams move with the cap and receive no internal walls.</li><li><strong>Individual normals:</strong> each planar face receives its own translated cap and ruled boundary walls. Differing normals disable shared-normal mode.</li><li>Native kernel eligibility drives browser and C++ Inspector. All body results are staged before mutation; a refusal leaves every source unchanged. Body IDs and cap selection remain; Apply is a single undo/redo step and saves/reopens.</li><li>Scope: positive-distance planar regions and existing supported single-face cylinder/cone push routes. Arbitrary curved multi-face regions, averaged-normal extrusion and inward cuts are not implemented; they refuse rather than pretend to work.</li></ul>
<p><strong>Verification:</strong> 27/27 native geometry tests, including connected coplanar shared rims (13 rather than 15 faces), parallel multi-body extrusion, distinct individual normals, invalid requests, staged atomic failure, save/reopen and undo/redo. Browser and native C++ own-mouse E/Inspector tests pass; existing loft and upright orbit regressions also pass.</p>
<p><strong>Rendering disclosure:</strong> browser screenshots use WebGL2 through software SwiftShader, with zero CPU fragment/RGBA uploads. Native screenshots are the C++ CPU-reference raster and real ImGui mouse/key inputs. Neither is evidence of a physical hardware GPU.</p>"""
for prefix, title in [("SolidArc", "Browser · WebGL2 / software SwiftShader"),("EditorProof_SolidArc_", "Native C++ · CPU reference / ImGui")]:
    page += '<h2>'+title+'</h2>'
    for suffix, caption in [
        ('ExtrudeFaceSelection.png','Mouse-selected top face; contextual Inspector Extrude.'),
        ('ExtrudeNormalOptions.png','E opens the distance and mode panel before modifying geometry.'),
        ('ExtrudeNormalResult.png','Apply produces an extended cap plus real ruled sidewalls; source body retained.'),
        ('ExtrudeMultiSelection.png','Shift-click selects another face with a distinct outward normal.'),
        ('ExtrudeIndividualOptions.png','Inspector Extrude opens Individual normals; incompatible shared-normal mode is disabled.'),
        ('ExtrudeIndividualResult.png','Apply extends both selected faces along their individual normals; single-step undo/redo verified.'),
    ]: page += image(prefix+suffix, caption)
for name, title in [('SolidArcExtrudeProof.json','Browser checks'),('SolidArcNativeExtrudeProof.json','Native own-mouse checks')]:
    page += '<h2>'+title+'</h2><pre>'+html.escape(json.dumps(json.loads((Folder/name).read_text()),indent=2))+'</pre>'
page += '</html>'
Target=Folder/'SolidArcExtrudeProof.html'
Target.write_text(page)
print(Target)
