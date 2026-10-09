#!/usr/bin/env python3
"""Serve the repository for the browser experiments, without letting anything be cached.

    python3 Tools/Build/ServeExperiments.py [--port 8099]

🔴 WHY THIS EXISTS RATHER THAN `python3 -m http.server`.

   The plain handler sends no Cache-Control at all. A browser meeting a response with no freshness
   information applies a heuristic and may reuse it for a while WITHOUT revalidating, which is
   usually harmless and is poison here: these pages are ES modules that import each other, so the
   browser can happily load a new index.html against a cached app.js from five minutes ago.

   That failure is not loud. It looks like a working page with one impossible bug — the symptom that
   cost real time on the spatial HUD was a black canvas and an untouched readout, caused by nothing
   worse than a renamed control attribute in markup the cached script had never seen.

   So: no-store on everything, and the correct MIME type for .mjs, which the standard handler does
   not know and which makes a module script fail to load at all.
"""
import argparse
import functools
import http.server
import socketserver
from pathlib import Path

Root = Path(__file__).resolve().parents[2]


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.mjs': 'text/javascript',
        '.js': 'text/javascript',
        '.wgsl': 'text/plain',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    # The conditional-request path would answer 304 from the browser's copy, which is exactly what
    # no-store is here to prevent. Always send the file.
    def send_head(self):
        self.headers.replace_header('If-Modified-Since', '') if 'If-Modified-Since' in self.headers else None
        if 'If-None-Match' in self.headers:
            del self.headers['If-None-Match']
        return super().send_head()

    def log_message(self, form, *arguments):
        if '200' not in (form % arguments):
            super().log_message(form, *arguments)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    Parser = argparse.ArgumentParser()
    Parser.add_argument('--port', type=int, default=8099)
    Parser.add_argument('--bind', default='0.0.0.0')
    Arguments = Parser.parse_args()

    with Server((Arguments.bind, Arguments.port),
                functools.partial(Handler, directory=str(Root))) as Listening:
        print(f'ServeExperiments: {Root} on {Arguments.bind}:{Arguments.port}, nothing cached',
              flush=True)
        Listening.serve_forever()
