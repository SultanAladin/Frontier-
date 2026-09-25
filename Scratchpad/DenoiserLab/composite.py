#!/usr/bin/env python3
# Builds the comparison sheets from Results/*.ppm: per-zone crop rows across every variant, plus a full-frame
# overview grid. Pure python + zlib (no PIL); labels use an embedded 5x7 font.
import os
import sys

from ppm2png import read_ppm, write_png

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "Results")

COLS = [
    ("REF",   "Reference"),
    ("NOISY", "NoDenoise"),
    ("V0",    "V0_Baseline"),
    ("V1",    "V1_GlintSafeClamp"),
    ("V2",    "V2_YoungVarianceFloor"),
    ("V3",    "V3_SigmaSchedule"),
    ("V4",    "V4_LogLumaStop"),
    ("V5",    "V5_OutputDither"),
    ("V6",    "V6_DepthGradient"),
    ("V7",    "V7_AlbedoDemodulation"),
    ("V8",    "V8_Combined"),
]

# zone: (label, x0, y0, w, h, stretch_gain)  — gain > 1 amplifies around the reference mean (sky banding)
ZONES = [
    ("GLINTS",    336, 128, 96, 96, 1.0),
    ("TEXTURE",   120,  90, 96, 96, 1.0),
    ("TRIM STEP",  56, 300, 96, 96, 1.0),
    ("DISOCCLUDE", 208, 396, 96, 96, 1.0),
    ("SKY X8",    192,   0, 96, 64, 8.0),
]

FONT = {
    "A": ["01110","10001","10001","11111","10001","10001","10001"],
    "B": ["11110","10001","10001","11110","10001","10001","11110"],
    "C": ["01110","10001","10000","10000","10000","10001","01110"],
    "D": ["11110","10001","10001","10001","10001","10001","11110"],
    "E": ["11111","10000","10000","11110","10000","10000","11111"],
    "F": ["11111","10000","10000","11110","10000","10000","10000"],
    "G": ["01110","10001","10000","10111","10001","10001","01111"],
    "H": ["10001","10001","10001","11111","10001","10001","10001"],
    "I": ["11111","00100","00100","00100","00100","00100","11111"],
    "K": ["10001","10010","10100","11000","10100","10010","10001"],
    "L": ["10000","10000","10000","10000","10000","10000","11111"],
    "M": ["10001","11011","10101","10101","10001","10001","10001"],
    "N": ["10001","11001","10101","10011","10001","10001","10001"],
    "O": ["01110","10001","10001","10001","10001","10001","01110"],
    "P": ["11110","10001","10001","11110","10000","10000","10000"],
    "R": ["11110","10001","10001","11110","10100","10010","10001"],
    "S": ["01111","10000","10000","01110","00001","00001","11110"],
    "T": ["11111","00100","00100","00100","00100","00100","00100"],
    "U": ["10001","10001","10001","10001","10001","10001","01110"],
    "V": ["10001","10001","10001","10001","10001","01010","00100"],
    "W": ["10001","10001","10001","10101","10101","11011","10001"],
    "X": ["10001","01010","00100","00100","00100","01010","10001"],
    "Y": ["10001","01010","00100","00100","00100","00100","00100"],
    "0": ["01110","10001","10011","10101","11001","10001","01110"],
    "1": ["00100","01100","00100","00100","00100","00100","01110"],
    "2": ["01110","10001","00001","00010","00100","01000","11111"],
    "3": ["11110","00001","00001","01110","00001","00001","11110"],
    "4": ["00010","00110","01010","10010","11111","00010","00010"],
    "5": ["11111","10000","11110","00001","00001","10001","01110"],
    "6": ["01110","10000","10000","11110","10001","10001","01110"],
    "7": ["11111","00001","00010","00100","01000","01000","01000"],
    "8": ["01110","10001","10001","01110","10001","10001","01110"],
    " ": ["00000","00000","00000","00000","00000","00000","00000"],
}


class Canvas:
    def __init__(self, w, h, fill=(18, 18, 22)):
        self.w, self.h = w, h
        self.px = bytearray(w * h * 3)
        for i in range(w * h):
            self.px[i * 3 : i * 3 + 3] = bytes(fill)

    def blit(self, x0, y0, w, h, rgb):
        for y in range(h):
            di = ((y0 + y) * self.w + x0) * 3
            si = y * w * 3
            self.px[di : di + w * 3] = rgb[si : si + w * 3]

    def text(self, x0, y0, s, scale=2, colour=(230, 230, 230)):
        cx = x0
        for ch in s.upper():
            glyph = FONT.get(ch, FONT[" "])
            for gy in range(7):
                for gx in range(5):
                    if glyph[gy][gx] == "1":
                        for sy in range(scale):
                            for sx in range(scale):
                                x, y = cx + gx * scale + sx, y0 + gy * scale + sy
                                if 0 <= x < self.w and 0 <= y < self.h:
                                    i = (y * self.w + x) * 3
                                    self.px[i : i + 3] = bytes(colour)
            cx += 6 * scale


def crop(rgb, W, x0, y0, w, h):
    out = bytearray(w * h * 3)
    for y in range(h):
        si = ((y0 + y) * W + x0) * 3
        out[y * w * 3 : (y + 1) * w * 3] = rgb[si : si + w * 3]
    return out


def scale2(w, h, rgb):
    out = bytearray(w * 2 * h * 2 * 3)
    for y in range(h * 2):
        for x in range(w * 2):
            i, o = ((y // 2) * w + (x // 2)) * 3, (y * w * 2 + x) * 3
            out[o : o + 3] = rgb[i : i + 3]
    return out


def stretch(rgb, ref, gain):
    if gain <= 1.0:
        return rgb
    out = bytearray(len(rgb))
    for i in range(0, len(rgb), 3):
        for c in range(3):
            v = 128.0 + (rgb[i + c] - ref[i + c]) * gain + (ref[i + c] - 128.0) * 0.35
            out[i + c] = max(0, min(255, int(v)))
    return out


def downscale2(w, h, rgb):
    out = bytearray((w // 2) * (h // 2) * 3)
    for y in range(h // 2):
        for x in range(w // 2):
            o = (y * (w // 2) + x) * 3
            for c in range(3):
                s = 0
                for dy in range(2):
                    for dx in range(2):
                        s += rgb[((y * 2 + dy) * w + x * 2 + dx) * 3 + c]
                out[o + c] = s // 4
    return out


def main():
    frames = {}
    for _, name in COLS:
        w, h, rgb = read_ppm(os.path.join(RES, name + ".ppm"))
        frames[name] = (w, h, rgb)
    W = frames["Reference"][0]

    # ---- crop sheet -----------------------------------------------------------------------------------------------
    cell, margin, top = 192, 4, 30
    left = 130
    sheet_w = left + len(COLS) * (cell + margin)
    sheet_h = top + len(ZONES) * (cell + margin)
    sheet = Canvas(sheet_w, sheet_h)
    for ci, (label, _) in enumerate(COLS):
        sheet.text(left + ci * (cell + margin) + 4, 8, label)
    for zi, (zlabel, zx, zy, zw, zh, gain) in enumerate(ZONES):
        ytop = top + zi * (cell + margin)
        sheet.text(6, ytop + cell // 2 - 8, zlabel, scale=2)
        refc = crop(frames["Reference"][2], W, zx, zy, zw, zh)
        for ci, (_, name) in enumerate(COLS):
            c = crop(frames[name][2], W, zx, zy, zw, zh)
            c = stretch(c, refc, gain)
            c2 = scale2(zw, zh, c)
            sheet.blit(left + ci * (cell + margin), ytop, zw * 2, zh * 2, c2)
    write_png(os.path.join(RES, "Composite_Crops.png"), sheet.w, sheet.h, sheet.px)

    # ---- amplified |out - ref| sheet: makes the subtle variants visible --------------------------------------------
    dsheet = Canvas(sheet_w, sheet_h)
    for ci, (label, _) in enumerate(COLS):
        dsheet.text(left + ci * (cell + margin) + 4, 8, label)
    for zi, (zlabel, zx, zy, zw, zh, gain) in enumerate(ZONES):
        ytop = top + zi * (cell + margin)
        dsheet.text(6, ytop + cell // 2 - 8, zlabel, scale=2)
        refc = crop(frames["Reference"][2], W, zx, zy, zw, zh)
        for ci, (_, name) in enumerate(COLS):
            c = crop(frames[name][2], W, zx, zy, zw, zh)
            d = bytearray(len(c))
            for i in range(len(c)):
                d[i] = min(255, abs(c[i] - refc[i]) * 6)
            c2 = scale2(zw, zh, d)
            dsheet.blit(left + ci * (cell + margin), ytop, zw * 2, zh * 2, c2)
    write_png(os.path.join(RES, "Composite_Diffs.png"), dsheet.w, dsheet.h, dsheet.px)

    # ---- wide sky strips: the banding probe -------------------------------------------------------------------------
    strip_rows = [("REF", "Reference"), ("V0", "V0_Baseline"), ("V3", "V3_SigmaSchedule"),
                  ("V5", "V5_OutputDither"), ("V8", "V8_Combined")]
    sx, sy, sw, sh, sgain = 16, 6, 480, 60, 10.0
    sk_w = 90 + sw * 2
    sk_h = 8 + len(strip_rows) * (sh * 2 + 10)
    sk = Canvas(sk_w, sk_h)
    srefc = crop(frames["Reference"][2], W, sx, sy, sw, sh)
    for ri, (label, name) in enumerate(strip_rows):
        y0 = 8 + ri * (sh * 2 + 10)
        sk.text(6, y0 + sh - 8, label)
        c = crop(frames[name][2], W, sx, sy, sw, sh)
        c = stretch(c, srefc, sgain)
        sk.blit(90, y0, sw * 2, sh * 2, scale2(sw, sh, c))
    write_png(os.path.join(RES, "Composite_Sky.png"), sk.w, sk.h, sk.px)

    # ---- full-frame overview grid ---------------------------------------------------------------------------------
    half = W // 2
    gcols, grows = 6, 2
    ov_w = gcols * (half + margin) + margin
    ov_h = grows * (half + margin + 24) + margin
    ov = Canvas(ov_w, ov_h)
    for i, (label, name) in enumerate(COLS):
        gx, gy = i % gcols, i // gcols
        x0 = margin + gx * (half + margin)
        y0 = margin + gy * (half + margin + 24)
        ov.text(x0, y0, label)
        w, h, rgb = frames[name]
        ov.blit(x0, y0 + 20, half, half, downscale2(w, h, rgb))
    write_png(os.path.join(RES, "Composite_Overview.png"), ov.w, ov.h, ov.px)
    print("composites written")


if __name__ == "__main__":
    main()
