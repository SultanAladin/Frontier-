"""Dependency-free lab preview server. Never mix cached JS and WGSL revisions."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class LabHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        # Always return fresh bytes, including when a preview reload sends an old
        # Last-Modified validator. Asset URLs are also release-versioned.
        for name in ("If-Modified-Since", "If-None-Match"):
            if name in self.headers:
                del self.headers[name]
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    handler = partial(LabHandler, directory=str(Path(__file__).resolve().parent))
    server = ThreadingHTTPServer(("0.0.0.0", args.port), handler)
    print(f"Tyre lab: http://0.0.0.0:{args.port} (no-store assets)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
