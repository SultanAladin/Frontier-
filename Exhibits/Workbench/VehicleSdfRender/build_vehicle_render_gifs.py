#!/usr/bin/env python3
"""Turns the raw frames from VehicleSdfRender into GIFs with the physics readout overlaid.

    ./vsdf <csv-dir> <out-dir> <scenario> <mode>   (run for every scenario and mode)
    python build_vehicle_render_gifs.py <csv-dir> <out-dir>
"""
import csv, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

CSV_DIR, OUT = sys.argv[1], sys.argv[2]
SCEN = {"curb0": ("curb_15ms_00deg.csv", 0.1, 2.5, "Curb strike 15 m/s, 0.12 m curb, 0°"),
        "curb20": ("curb_15ms_20deg.csv", 0.1, 2.5, "Curb strike 15 m/s, 0.12 m curb, 20°"),
        "spin": ("spin_12ms_arena.csv", 0.2, 10.0, "Spin 12 m/s, power oversteer then coast")}
MODES = {"raster": "Raster: sun + sky, no indirect",
         "restir": "ReSTIR-style RIS: 8 sun candidates, visibility on selected",
         "gi": "SDF GI: sun + 12-sample gather (1 bounce)"}
W, H, SCALE = 192, 108, 4

def rows_of(name):
    with open(os.path.join(CSV_DIR, name)) as f:
        return list(csv.DictReader(f))

def row_at(rows, t):
    best = min(rows, key=lambda r: abs(float(r["t"]) - t))
    return best

font = next((ImageFont.truetype(p, 13) for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                                                  "/usr/share/fonts/dejavu/DejaVuSans.ttf"] if os.path.exists(p)),
            ImageFont.load_default())
bigf = next((ImageFont.truetype(p, 15) for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                                                  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"] if os.path.exists(p)), font)

summary = []
for scen, (csvname, dt, tend, title) in SCEN.items():
    rows = rows_of(csvname)
    for mode, mlabel in MODES.items():
        base = os.path.join(OUT, f"{scen}_{mode}")
        if not os.path.exists(base + ".rgb"):
            print("missing", base); continue
        n, w, h = map(int, open(base + ".frames").read().split())
        data = np.fromfile(base + ".rgb", dtype=np.uint8).reshape(n, h, w, 3)
        frames = []
        for i in range(n):
            t = i * dt
            r = row_at(rows, t)
            im = Image.fromarray(data[i]).resize((w * SCALE, h * SCALE), Image.NEAREST)
            d = ImageDraw.Draw(im)
            d.rectangle([0, 0, w * SCALE, 46], fill=(0, 0, 0))
            d.text((8, 4), f"{title}", font=bigf, fill=(255, 255, 255))
            d.text((8, 24), f"{mlabel}", font=font, fill=(220, 220, 220))
            contacts = int(float(r["wheels_in_contact"]))
            roll, pitch = float(r["roll_deg"]), float(r["pitch_deg"])
            stable = abs(roll) < 45 and abs(pitch) < 45
            line = (f"t={float(r['t']):4.2f}s  v={float(r['speed']):5.2f} m/s  roll={roll:+5.2f}°  pitch={pitch:+5.2f}°  "
                    f"contacts {contacts}/4  {'UPRIGHT' if stable else 'TIPPED'}")
            d.rectangle([0, h * SCALE - 20, w * SCALE, h * SCALE], fill=(0, 0, 0))
            d.text((8, h * SCALE - 17), line, font=font, fill=(255, 255, 255))
            frames.append(im)
        out_gif = os.path.join(OUT, f"vehicle_{scen}_{mode}.gif")
        frames[0].save(out_gif, save_all=True, append_images=frames[1:], duration=int(dt * 1000), loop=0, optimize=True)
        peak_roll = max(abs(float(r["roll_deg"])) for r in rows)
        peak_pitch = max(abs(float(r["pitch_deg"])) for r in rows)
        summary.append((scen, mode, n, peak_roll, peak_pitch, out_gif))
        print("wrote", out_gif, n, "frames")
with open(os.path.join(OUT, "vehicle_render_index.md"), "w") as f:
    f.write("| scenario | mode | frames | max |roll| [°] | max |pitch| [°] | file |\n|---|---|---|---|---|---|\n")
    for scen, mode, n, pr, pp, g in summary:
        f.write(f"| {scen} | {mode} | {n} | {pr:.2f} | {pp:.2f} | {os.path.basename(g)} |\n")
print(open(os.path.join(OUT, "vehicle_render_index.md")).read())
