#!/usr/bin/env python3
"""Thin HTTP transport for the real headless C++ editor. Not a browser GPU backend.
One local proof session, serialized input, no arbitrary commands/paths from clients.
"""
import argparse
import atexit
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import math
import mimetypes
import http.client
import os
from pathlib import Path
import queue
import subprocess
import threading
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
os.chdir(ROOT)
p = argparse.ArgumentParser()
p.add_argument('--port', type=int, default=8080)
p.add_argument('--build', action='store_true')
p.add_argument('--geometry-port', type=int, default=8081)
args = p.parse_args()
binary = ROOT / '.cache/solidarc-editor/SolidArcEditorProof'
if args.build or not binary.exists():
    subprocess.run(['python3', 'Tools/Build/RunSolidArcEditorProof.py', '--build-only'], check=True)
running_build = str(binary.stat().st_mtime_ns)
keys = subprocess.check_output([str(binary), '--keys'])
child = subprocess.Popen([str(binary), '--interactive'], stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
ready = queue.Queue()
log_path = ROOT / '.cache/solidarc-editor/Mirror.log'

def collect():
    with log_path.open('w') as log:
        for line in child.stdout:
            log.write(line)
            log.flush()
            if line.strip() == 'SOLIDARC_FRAME_READY':
                ready.put(True)
    ready.put(False)

threading.Thread(target=collect, daemon=True).start()

def close():
    child.terminate()
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait()

atexit.register(close)
frame = ROOT / 'Exhibits/Gallery/Editor/SolidArcMirror.png'
html = ROOT / 'Exhibits/Workbench/Editor/SolidArcMirror.html'

def advance(data):
    fields = []
    for name, default in [('x', -1), ('y', -1), ('buttons', 0), ('wheel', 0),
                          ('mods', 0), ('key', 0), ('down', 0), ('character', 0)]:
        v = data.get(name, default)
        if not isinstance(v, (int, float)) or not math.isfinite(v) or abs(v) > 100000:
            raise ValueError('invalid numeric input: ' + name)
        fields.append(v)
    if any(int(fields[i]) != fields[i] for i in [2, 4, 5, 6, 7]):
        raise ValueError('input codes must be integers')
    for i in [2, 4, 5, 6, 7]:
        fields[i] = int(fields[i])
    if not 0 <= fields[2] <= 7 or not 0 <= fields[4] <= 7:
        raise ValueError('invalid pointer/modifier mask')
    child.stdin.write(' '.join(map(str, fields)) + '\n')
    child.stdin.flush()
    if not ready.get(timeout=45):
        raise RuntimeError('native process exited; see ' + str(log_path))
    return frame.read_bytes()

# Interactive native startup is empty (or offers recovery); regression fixtures are proof-only.
advance({})

class Handler(BaseHTTPRequestHandler):
    def respond(self, status, mime, body):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def proxy_native(self):
        # Same-origin browser route to the C++ vertex-command service. No pixels.
        length=int(self.headers.get('Content-Length',0))
        if not 0<=length<=1024*1024:
            return self.respond(413,'text/plain',b'Request too large')
        headers={k:v for k,v in self.headers.items() if k.lower() in
                 ('content-type','origin','x-solidarc-session')}
        headers['X-Forwarded-Host']=self.headers.get('Host','')
        connection=http.client.HTTPConnection('127.0.0.1',args.geometry_port,timeout=120)
        try:
            connection.request(self.command,self.path,body=self.rfile.read(length) if length else None,headers=headers)
            reply=connection.getresponse()
            self.respond(reply.status,reply.getheader('Content-Type','application/json'),reply.read())
        except (OSError,http.client.HTTPException) as error:
            self.respond(503,'application/json',json.dumps({'error':'Native GPU command service unavailable: '+str(error)}).encode())
        finally:
            connection.close()

    def do_DELETE(self):
        if self.path=='/native':return self.proxy_native()
        self.respond(404,'text/plain',b'Not found')

    def do_GET(self):
        path = urlsplit(self.path).path
        if path in ('/native','/native/health'):
            return self.proxy_native()
        if path=='/gpu':
            self.send_response(302);self.send_header('Location','/gpu/');self.end_headers();return
        if path.startswith('/gpu/'):
            root=(ROOT/'Experimental/SolidArc/dist').resolve()
            asset=(root/(path[len('/gpu/'):] or 'index.html')).resolve()
            if asset.is_relative_to(root) and asset.is_file():
                return self.respond(200,mimetypes.guess_type(str(asset))[0] or 'application/octet-stream',asset.read_bytes())
            return self.respond(404,'text/plain',b'GPU build asset missing; npm run build -- --base=/gpu/')
        if path == '/evidence-manifest':
            names = ('SolidArcOrbit.gif', 'SolidArcMouseMotion.png', 'EditorProof_SolidArc_Construct.png',
                     'SolidArcGpuDrawing.gif', 'SolidArcHtmlViewGrids.gif', 'SolidArcNativeViewGrids.gif')
            return self.respond(200, 'application/json', json.dumps({
                '/evidence/' + name: (ROOT/'Exhibits/Gallery/Editor'/name).is_file() for name in names
            }).encode())
        if path.startswith('/evidence/'):
            allowed={'SolidArcOrbit.gif','SolidArcMouseMotion.png','EditorProof_SolidArc_Construct.png',
                     'SolidArcGpuDrawing.gif','SolidArcGpuDrawing.json','SolidArcOrbitProof.json',
                     'SolidArcHtmlViewGrids.gif','SolidArcNativeViewGrids.gif','SolidArcNativeViewGrid.json'}
            name=path[len('/evidence/'):]
            asset=ROOT/'Exhibits/Gallery/Editor'/name
            if name in allowed and asset.is_file():
                return self.respond(200,mimetypes.guess_type(name)[0] or 'application/octet-stream',asset.read_bytes())
            return self.respond(404,'text/plain',b'Evidence not generated')
        if path in ('/', '/cpp'):
            self.respond(200, 'text/html; charset=utf-8', html.read_text().replace('__NATIVE_BUILD__', running_build).encode())
        elif path in ('/proofs/bevel-corner', '/proofs/bevel'):
            name = 'SolidArcCornerProof.html' if path.endswith('bevel-corner') else 'SolidArcBevelProof.html'
            proof = ROOT / 'Exhibits/Gallery/Editor' / name
            if proof.is_file():
                self.respond(200, 'text/html; charset=utf-8', proof.read_bytes())
            else:
                self.respond(404, 'text/plain', b'Bevel proof has not been generated')
        elif path == '/proofs':
            gallery = ROOT / 'Exhibits/Gallery/Editor/SolidArcProofs.html'
            if gallery.exists():
                self.respond(200, 'text/html; charset=utf-8', gallery.read_bytes())
            else:
                self.respond(404, 'text/plain', b'Proof gallery not generated. Run RunSolidArcEditorProof.py then GenerateSolidArcProofGallery.py.')
        elif path == '/version':
            self.respond(200, 'application/json', json.dumps({
                'runningBuild': running_build,
                'currentBuild': str(binary.stat().st_mtime_ns),
                'restartRequired': running_build != str(binary.stat().st_mtime_ns),
            }).encode())
        elif path == '/frame':
            self.respond(200, 'image/png', frame.read_bytes())
        elif path == '/keys':
            self.respond(200, 'application/json', keys)
        else:
            self.respond(404, 'text/plain', b'Not found')

    def do_POST(self):
        if self.path=='/native':return self.proxy_native()
        if self.path != '/input':
            return self.respond(404, 'text/plain', b'Not found')
        origin = self.headers.get('Origin')
        if origin and urlsplit(origin).netloc != self.headers.get('Host'):
            return self.respond(403, 'text/plain', b'Same-origin input only')
        try:
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= 4096:
                raise ValueError('input must be 1..4096 bytes')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('input must be an object')
            self.respond(200, 'image/png', advance(data))
        except (ValueError, json.JSONDecodeError) as error:
            self.respond(400, 'text/plain', str(error).encode())
        except (RuntimeError, queue.Empty, BrokenPipeError) as error:
            self.respond(503, 'text/plain', ('Native proof unavailable: ' + str(error)).encode())

print(f'SolidArc native CPU mirror listening on 0.0.0.0:{args.port}', flush=True)
try:
    HTTPServer(('0.0.0.0', args.port), Handler).serve_forever()
finally:
    close()
