#!/usr/bin/env python3
"""Serve the CarHmi prototype with no-store caching (the SpatialHud lesson:
ES modules + a heuristic cache = new markup against a stale script, which
looks like an impossible bug). Run from this directory:

    python3 serve.py --port 8099
"""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoStore(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8099)
    ap.add_argument("--bind", default="0.0.0.0")
    args = ap.parse_args()
    srv = ThreadingHTTPServer((args.bind, args.port), NoStore)
    print(f"CarHmi on http://{args.bind}:{args.port}/  (index.html = 3D tablet)")
    srv.serve_forever()
