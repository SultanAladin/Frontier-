#!/usr/bin/env python3
"""Embed current no-roll evidence without image/font/network dependencies."""
from pathlib import Path
import base64,html,struct,zlib
ROOT=Path(__file__).resolve().parents[2]
F=ROOT/'Exhibits/Gallery/Editor'
def image(name):
    raw=(F/name).read_bytes();at=8;records=[]
    while at<len(raw):
        n=struct.unpack_from('>I',raw,at)[0];records.append((raw[at+4:at+8],raw[at+8:at+8+n]));at+=12+n
    def chunk(k,b):return struct.pack('>I',len(b))+k+b+struct.pack('>I',zlib.crc32(k+b)&0xffffffff)
    header=next(b for k,b in records if k==b'IHDR')
    data=zlib.compress(zlib.decompress(b''.join(b for k,b in records if k==b'IDAT')),9)
    packed=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',header)+chunk(b'IDAT',data)+chunk(b'IEND',b'')
    return 'data:image/png;base64,'+base64.b64encode(packed).decode()
parts=[]
for name,title in [
 ('SolidArcUpright_front_left.png','HTML · Front → plain left-drag: vertical edges remain upright'),
 ('SolidArcUpright_iso_alt-left.png','HTML · Alt-left drag: no separate rolled/free-orbit path'),
 ('SolidArcUpright_iso_right.png','HTML · right-drag: world-Z yaw and camera-right elevation'),
 ('SolidArcUpright_LegacyRestored.png','HTML · restoring an old rolled camera clears roll'),
 ('EditorProof_SolidArc_RightDrag.png','Native C++ CPU proof · upright mouse rotation and face-UV labels')]:
    parts.append('<h2>'+html.escape(title)+'</h2><img src="'+image(name)+'" alt="'+html.escape(title)+'">')
parts.append('<details><summary>Actual mouse-input checks</summary><pre>'+html.escape((F/'SolidArcUprightProof.json').read_text())+'</pre></details>')
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SolidArc · Upright navigation correction</title><style>body{font:16px system-ui;background:#101214;color:#eee;max-width:1440px;margin:32px auto;padding:0 24px}p{line-height:1.6;color:#bdc8d2}img{width:100%;display:block;border-radius:12px;margin:18px 0 32px}pre{white-space:pre-wrap}details{padding:16px;background:#1a2025}</style><h1>Upright CAD navigation · screenshot regression fixed</h1><p>The remaining free-orbit path was removed from ALL viewport drags, including left and Alt-left. Horizontal drag rotates world Z; vertical drag changes elevation. No roll, no inversion, fixed pivot and distance. Old rolled camera state restores upright. Cube-face UV text remains attached to the faces.</p><p>Verified 12 view/button combinations and 144 actual browser mouse moves, plus native mouse input and native/HTML matrix agreement. Browser images use WebGL2/SwiftShader with zero CPU image uploads; native image is a C++ CPU raster proof, not physical-GPU/Vulkan evidence. Geometry is a command-created test fixture; rotation gestures are actual injected mouse events.</p>'''+''.join(parts)+'</html>'
for name in ['SolidArcUprightProof.html','SolidArcProofs.html']:(F/name).write_text(page)
print(F/'SolidArcUprightProof.html')
