#!/usr/bin/env python3
"""Turns the raw float buffers from SdfGiRender.cpp into PNGs, a convergence GIF and a chart.

    ./sdfgi out && python build_sdf_gi_proofs.py out
"""
import csv, os, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
W, H = 320, 180

def load(name):
    a = np.fromfile(os.path.join(OUT, name + ".f32"), dtype=np.float32)
    return a.reshape(H, W, 3).astype(np.float64)

def tonemap(x):
    x = np.clip(x, 0, None)
    y = x / (1.0 + x)                       # Reinhard, as in the shader's output stage
    return (np.clip(np.power(y, 1 / 2.2), 0, 1) * 255).astype(np.uint8)

def save_png(x, name, scale=3):
    im = Image.fromarray(tonemap(x), "RGB").resize((W * scale, H * scale), Image.NEAREST)
    im.save(os.path.join(OUT, name))
    return im

off = load("gi_off")
ref = load("gi_reference_512")
p32 = load("gi_32_prod")
s1, s4, s32 = load("gi_snap_1"), load("gi_snap_4"), load("gi_snap_32")

save_png(off, "gi_off.png")
save_png(ref, "gi_reference_512.png")
save_png(p32, "gi_32_samples_prod.png")
diff = np.abs(p32 - ref)
save_png(np.clip(diff * 10.0, 0, 1) * 1.0, "gi_error_32_vs_ref_x10.png")

# side-by-side comparison panel with labels
font = None
for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf"]:
    if os.path.exists(p):
        font = ImageFont.truetype(p, 16)
if font is None:
    font = ImageFont.load_default()
panels = [("GI off (sun + sky fill)", off), ("GI on, 32 samples (48-step)", p32), ("GI reference, 512 samples", ref)]
S = 2
canvas = Image.new("RGB", (W * S * 3 + 40, H * S + 40), (20, 20, 22))
for i, (label, img) in enumerate(panels):
    im = Image.fromarray(tonemap(img), "RGB").resize((W * S, H * S), Image.NEAREST)
    x = 10 + i * (W * S + 10)
    canvas.paste(im, (x, 30))
    ImageDraw.Draw(canvas).text((x + 6, 6), label, font=font, fill=(235, 235, 235))
canvas.save(os.path.join(OUT, "gi_comparison.png"))

# convergence GIF: the 1, 4, 32-sample prefixes and the reference
frames = []
seq = [("1 sample", load("gi_snap_1")), ("4 samples", load("gi_snap_4")), ("32 samples", load("gi_snap_32")),
       ("512 samples (reference)", ref)]
for label, img in seq:
    im = Image.fromarray(tonemap(img), "RGB").resize((W * 2, H * 2), Image.NEAREST)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 260, 26], fill=(0, 0, 0))
    d.text((6, 4), "gather: " + label, font=font, fill=(255, 255, 255))
    frames.append(im)
frames[0].save(os.path.join(OUT, "gi_convergence.gif"), save_all=True, append_images=frames[1:], duration=1200, loop=0)

# convergence chart from the CSV
rows = list(csv.DictReader(open(os.path.join(OUT, "convergence.csv"))))
sweep = [r for r in rows if r["samples"].isdigit()]
N = np.array([int(r["samples"]) for r in sweep], float)
rm = np.array([float(r["rmse_vs_ref512"]) for r in sweep])
mask = N < 512
fig, ax = plt.subplots(1, 2, figsize=(12, 4.6))
ax[0].loglog(N[mask], rm[mask], "o-", label="RMSE vs 512-sample reference")
c = rm[mask][0] * (N[mask][0] / N[mask]) ** 0.5
ax[0].loglog(N[mask], c, "k--", lw=1, label="N^-1/2 (Monte Carlo rate)")
ax[0].scatter([32], [float(next(r["rmse_vs_ref512"] for r in rows if r["samples"] == "gi_32_prod_48step"))],
              color="r", zorder=5, label="32 samples, 48-step trace (production)")
ax[0].set_xlabel("gather samples per pixel"); ax[0].set_ylabel("RMSE (linear RGB)")
ax[0].set_title("Gather convergence, same ray sequence"); ax[0].grid(alpha=0.3, which="both"); ax[0].legend(fontsize=8)
ax[1].plot(N[mask], [float(r["mean_linear_rgb"]) for r in sweep][:len(N[mask])], "o-", label="mean, gather N")
ax[1].axhline(float(sweep[0]["mean_ref512"]), color="k", ls="--", lw=1, label="mean, 512-sample reference")
ax[1].axhline(float(next(r["mean_linear_rgb"] for r in rows if r["samples"] == "gi_off")), color="g", ls=":", lw=1,
              label="mean, GI off")
ax[1].set_xscale("log"); ax[1].set_xlabel("gather samples per pixel"); ax[1].set_ylabel("mean linear RGB")
ax[1].set_title("Mean brightness: bias check"); ax[1].grid(alpha=0.3); ax[1].legend(fontsize=8)
fig.tight_layout(); fig.savefig(os.path.join(OUT, "chart_gi_convergence.png"), dpi=110); plt.close(fig)

# colour bleed check: the red block should tint the floor next to it when GI is on
# floor pixels: the lower part of the frame, excluding the block itself (approximate mask by brightness)
def tint(img):
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    region = (np.arange(H)[:, None] > 120) & (np.arange(W)[None, :] > 110) & (np.arange(W)[None, :] < 230)
    return float(np.mean((r - g)[region]))
bleed = [("GI off", tint(off)), ("GI on 32 (prod)", tint(p32)), ("GI reference 512", tint(ref))]
with open(os.path.join(OUT, "gi_colour_bleed.txt"), "w") as f:
    f.write("mean(R-G) over the floor region beside the red block (rows>120, cols 110..230):\n")
    for k, v in bleed:
        f.write(f"  {k:20s} {v:+.5f}\n")
print(open(os.path.join(OUT, "gi_colour_bleed.txt")).read())
print("mean linear RGB:", {k: round(float(img.mean()), 5) for k, img in [("gi_off", off), ("gi_32", p32), ("gi_ref512", ref)]})
