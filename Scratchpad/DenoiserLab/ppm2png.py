#!/usr/bin/env python3
# Minimal PPM(P6) -> PNG converter (zlib only, no PIL). Usage: ppm2png.py in.ppm out.png [scale]
import struct
import sys
import zlib


def read_ppm(path):
    data = open(path, "rb").read()
    if not data.startswith(b"P6"):
        raise SystemExit("not P6: " + path)
    parts = data.split(b"\n", 3)
    w, h = map(int, parts[1].split())
    return w, h, bytearray(parts[3][: w * h * 3])


def write_png(path, w, h, rgb):
    raw = bytearray()
    stride = w * 3
    for y in range(h):
        raw.append(0)
        raw += rgb[y * stride : (y + 1) * stride]
    def chunk(tag, payload):
        c = struct.pack(">I", len(payload)) + tag + payload
        return c + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    png += chunk(b"IEND", b"")
    open(path, "wb").write(png)


def scale_nearest(w, h, rgb, s):
    out = bytearray(w * s * h * s * 3)
    for y in range(h * s):
        sy = y // s
        for x in range(w * s):
            sx = x // s
            i, o = (sy * w + sx) * 3, (y * w * s + x) * 3
            out[o : o + 3] = rgb[i : i + 3]
    return w * s, h * s, out


if __name__ == "__main__":
    w, h, rgb = read_ppm(sys.argv[1])
    s = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    if s > 1:
        w, h, rgb = scale_nearest(w, h, rgb, s)
    write_png(sys.argv[2], w, h, rgb)
