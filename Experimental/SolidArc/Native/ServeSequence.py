"""Local development transport for native C++ commands. Browser WebGL2 owns rasterization."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import atexit
import argparse
import json
import os
import queue
import re
import subprocess
import threading
import time
from urllib.parse import urlsplit

Parser = argparse.ArgumentParser()
Parser.add_argument('--port', type=int, default=8081)
Parser.add_argument('--recover-sessions', help='Trusted local JSON checkpoints for a deliberate development-server upgrade')
Args = Parser.parse_args()

Root = Path(__file__).resolve().parents[3]
os.chdir(Root)
# Fresh checkouts do not retain ignored runtime logs. Create the directory before
# starting reply collectors, otherwise native requests wait on a dead collector.
(Root / '_AgentScratch/tmp').mkdir(parents=True, exist_ok=True)
Target = Root / '_AgentScratch/build/SolidArcNative/GeometryHost'
if not Target.exists():
    subprocess.run(['python3', str(Path(__file__).with_name('CompileSequence.py')), '--native'], check=True)
# The separately built native CAD blend worker is optional on unsupported hosts.
# Discover a provisioned installation so a normal server restart does not silently
# revert curved-edge tools to the older straight-edge-only path.
BlendHost = Root / '.cache/solidarc-occt/BlendHost'
if BlendHost.is_file():
    os.environ.setdefault('SOLIDARC_OCCT_BLEND_HOST', str(BlendHost))
Services = {}
Recovery = json.loads(Path(Args.recover_sessions).read_text()) if Args.recover_sessions else {}


class NativeSequence:
    def __init__(self, Identity):
        self.Process = subprocess.Popen([str(Target)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.Replies = queue.Queue()
        self.Touched = time.monotonic()
        self.Identity = Identity
        threading.Thread(target=self.Collect, daemon=True).start()
        # An explicit local checkpoint keeps the existing browser session/key,
        # authored construction journal, selection, view and bevel edit alive
        # across a kernel upgrade. Never accept recovery paths from HTTP input.
        Saved = Recovery.get(Identity)
        if Saved:
            try:
                self.Request({'action': 'create'})
                Opened = self.Request({'action': 'open', 'text': Saved['file']})
                if not Opened.get('success'):
                    raise ValueError('Checkpoint refused by the new native kernel; original checkpoint retained')
                if Saved.get('camera'):
                    self.Request({'action': 'render', 'camera': Saved['camera']})
                Bevel = Saved.get('bevel', {})
                if Bevel.get('active'):
                    self.Request(dict(action='bevel', operation=0, owner=Bevel.get('owner', 0), feature=Bevel.get('feature', 0), chamfer=Bevel.get('chamfer', False)))
                    self.Request(dict(action='bevel', operation=1, size=Bevel['size'], chamfer=Bevel.get('chamfer', False)))
            except Exception:
                self.Release()
                raise

    def Collect(self):
        Lines = []
        with (Root / f'_AgentScratch/tmp/GeometryHost-{self.Identity}.log').open('a') as Log:
            for Line in self.Process.stdout:
                if Line.startswith('SOLIDARC_PACKET '):
                    Response = json.loads(Line[len('SOLIDARC_PACKET '):])
                    Response['lines'] = Lines[-100:]
                    Lines = []
                    self.Replies.put(Response)
                else:
                    Lines.append(Line.rstrip())
                    if len(Lines) > 100:
                        Lines.pop(0)
                    Log.write(Line)
                    Log.flush()
        self.Replies.put({'error': 'Native C++ geometry process exited'})

    def Request(self, Value):
        self.Touched = time.monotonic()
        self.Process.stdin.write(json.dumps(Value, allow_nan=False) + '\n')
        self.Process.stdin.flush()
        return self.Replies.get(timeout=120)

    def Release(self):
        self.Process.terminate()
        try:
            self.Process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.Process.kill()
            self.Process.wait()


def Release():
    for Service in Services.values():
        Service.Release()


atexit.register(Release)


class GeometryExchange(BaseHTTPRequestHandler):
    def Respond(self, Status, Value):
        Body = json.dumps(Value, allow_nan=False).encode()
        self.send_response(Status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(Body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(Body)

    def do_GET(self):
        if self.path in ['/', '/native/health']:
            return self.Respond(200, {'transport': 'native-cpp-command-stream', 'raster': False})
        self.Respond(404, {'error': 'Not found'})

    def do_DELETE(self):
        Origin = self.headers.get('Origin')
        Expected = self.headers.get('X-Forwarded-Host', self.headers.get('Host'))
        if self.path != '/native' or Origin and urlsplit(Origin).netloc != Expected:
            return self.Respond(403, {'error': 'Same-origin session release required'})
        Service = Services.pop(self.headers.get('X-SolidArc-Session', ''), None)
        if Service:
            Service.Release()
        self.Respond(200, {'released': bool(Service)})

    def do_POST(self):
        if self.path != '/native':
            return self.Respond(404, {'error': 'Not found'})
        Origin = self.headers.get('Origin')
        Expected = self.headers.get('X-Forwarded-Host', self.headers.get('Host'))
        if Origin and urlsplit(Origin).netloc != Expected:
            return self.Respond(403, {'error': 'Same-origin input required'})
        try:
            Identity = self.headers.get('X-SolidArc-Session', '')
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', Identity):
                raise ValueError('Worker session identity required')
            Length = int(self.headers.get('Content-Length', 0))
            if not 0 < Length <= 8 * 1024 * 1024:
                raise ValueError('Request extent invalid')
            Request = json.loads(self.rfile.read(Length))
            if not isinstance(Request, dict):
                raise ValueError('Expected an object')
            # Do not silently destroy an idle browser's document after an hour.
            # Explicit DELETE releases closed sessions; the eight-session limit
            # bounds memory without discarding another user's authored geometry.
            if Identity not in Services:
                if len(Services) >= 8:
                    return self.Respond(503, {'error': 'Development service has eight active browser sessions; restart it to release them'})
                Services[Identity] = NativeSequence(Identity)
            Response = Services[Identity].Request(Request)
            Response['token'] = Request.get('token', 0)
            self.Respond(200, Response)
        except (ValueError, json.JSONDecodeError) as Error:
            self.Respond(400, {'error': str(Error)})
        except (queue.Empty, BrokenPipeError) as Error:
            if Identity in Services:
                Services.pop(Identity).Release()
            self.Respond(503, {'error': 'Native geometry unavailable: ' + str(Error)})


print(f'SolidArc native command stream listening on 0.0.0.0:{Args.port}; no CPU framebuffer', flush=True)
try:
    # Requests are serialized; each browser worker owns an isolated native process/document set.
    HTTPServer(('0.0.0.0', Args.port), GeometryExchange).serve_forever()
finally:
    Release()
