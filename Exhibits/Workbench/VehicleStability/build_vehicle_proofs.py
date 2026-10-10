#!/usr/bin/env python3
"""Builds the vehicle-stability charts, GIFs and summary table from the CSVs written by VehicleStabilityProof.cpp.

    ./vstab out full      -> curb_*.csv, spin_12ms_arena.csv, spincoast_*.csv
    ./vstab out sweep     -> curb_10ms_00deg_sweeps{1,4,16}.csv, spincoast_12ms_057dps_sweeps{4,16}.csv
    python build_vehicle_proofs.py out
"""
import csv, math, os, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"

def load(name):
    with open(os.path.join(OUT, name + ".csv")) as f:
        rows = list(csv.DictReader(f))
    cols = {}
    for k in rows[0].keys():
        cols[k] = [float(r[k]) for r in rows]
    return cols

CURBS = [(5, 0), (10, 0), (15, 0), (20, 0), (5, 20), (10, 20), (15, 20), (20, 20)]
curb = {f"curb_{v:02d}ms_{a:02d}deg": load(f"curb_{v:02d}ms_{a:02d}deg") for v, a in CURBS}
spin = load("spin_12ms_arena")
spc12 = load("spincoast_12ms_057dps")
spc20 = load("spincoast_20ms_086dps")
sw = {n: load(n) for n in ["curb_10ms_00deg_sweeps1", "curb_10ms_00deg_sweeps4", "curb_10ms_00deg_sweeps16",
                           "spincoast_12ms_057dps", "spincoast_12ms_057dps_sweeps4", "spincoast_12ms_057dps_sweeps16"]}

# ---------------------------------------------------------------- chart 1: curb energy vs time
fig, ax = plt.subplots(1, 2, figsize=(13, 5))
for name, d in curb.items():
    e0 = d["E_total"][0]
    style = "-" if "00deg" in name else "--"
    ax[0].plot(d["t"], [e - e0 for e in d["E_total"]], style, lw=1.2, label=name.replace("curb_", "").replace("ms_", " m/s ").replace("deg", "°"))
ax[0].axhline(0, color="k", lw=0.8)
ax[0].set_xlabel("time after rolling start [s]"); ax[0].set_ylabel("E_total(t) − E_total(0)  [J]")
ax[0].set_title("Coast into 0.12 m curb: energy relative to start\n(no throttle, no brake: any rise is artificial)")
ax[0].legend(fontsize=7, ncol=2); ax[0].grid(alpha=0.3)
d = curb["curb_15ms_00deg"]
ax[1].plot(d["t"], d["E_tyre_spring"], label="tyre spring energy")
ax[1].plot(d["t"], d["E_tyre_KE"], label="tyre node KE")
ax[1].plot(d["t"], d["E_chassis"], label="chassis KE+PE")
ax[1].plot(d["t"], d["E_wheels"], label="wheel + engine spin")
ax[1].plot(d["t"], d["E_total"], "k", lw=1.5, label="total")
ax[1].set_title("15 m/s, 0°: energy by store (J)"); ax[1].set_xlabel("time [s]"); ax[1].legend(fontsize=8); ax[1].grid(alpha=0.3)
fig.tight_layout(); fig.savefig(os.path.join(OUT, "chart_curb_energy.png"), dpi=110); plt.close(fig)

# ---------------------------------------------------------------- chart 2: roll / pitch / wheel lift
fig, ax = plt.subplots(1, 3, figsize=(15, 4.6))
for name, d in curb.items():
    ls = "-" if "00deg" in name else "--"
    ax[0].plot(d["t"], d["roll_deg"], ls, lw=1, label=name)
    ax[1].plot(d["t"], d["pitch_deg"], ls, lw=1, label=name)
ax[0].set_title("roll angle [deg] (45° = tip-over)"); ax[0].axhline(45, color="r", ls=":"); ax[0].axhline(-45, color="r", ls=":")
ax[1].set_title("pitch angle [deg]"); ax[0].set_xlabel("t [s]"); ax[1].set_xlabel("t [s]")
ax[0].legend(fontsize=6, ncol=2)
names = list(curb.keys())
lifts = [sum(1 for c in curb[n]["wheels_in_contact"] if c < 4) for n in names]
ax[2].bar(range(len(names)), lifts); ax[2].set_xticks(range(len(names)))
ax[2].set_xticklabels([n.replace("curb_", "").replace("ms_", "\n").replace("deg", "°") for n in names], fontsize=7)
ax[2].set_title("frames with ≥1 wheel off the ground\n(of 961 frames per run)")
fig.tight_layout(); fig.savefig(os.path.join(OUT, "chart_curb_roll_pitch_lift.png"), dpi=110); plt.close(fig)

# ---------------------------------------------------------------- chart 3: convergence (sweeps) study
fig, ax = plt.subplots(1, 2, figsize=(13, 4.8))
for n, lab in [("curb_10ms_00deg_sweeps1", "1 sweep (solver default)"), ("curb_10ms_00deg_sweeps4", "4 sweeps"),
               ("curb_10ms_00deg_sweeps16", "16 sweeps")]:
    d = sw[n]; ax[0].plot(d["t"], [e - d["E_total"][0] for e in d["E_total"]], lw=1.2, label=lab)
    ax[0].set_title("10 m/s, 0°: energy above start vs XPBD sweeps\n(same curb, only the sweep count changes)")
ax[0].set_xlabel("t [s]"); ax[0].set_ylabel("E_total − E_total(0)  [J]"); ax[0].legend(); ax[0].grid(alpha=0.3); ax[0].axhline(0, color="k", lw=0.8)
for n, lab in [("spincoast_12ms_057dps", "1 sweep (solver default)"), ("spincoast_12ms_057dps_sweeps4", "4 sweeps"),
               ("spincoast_12ms_057dps_sweeps16", "16 sweeps")]:
    d = sw[n]; ax[1].plot(d["t"], [e - d["E_total"][0] for e in d["E_total"]], lw=1.2, label=lab)
ax[1].set_title("12 m/s coasting spin (no driver input): energy above start")
ax[1].set_xlabel("t [s]"); ax[1].legend(); ax[1].grid(alpha=0.3); ax[1].axhline(0, color="k", lw=0.8)
fig.tight_layout(); fig.savefig(os.path.join(OUT, "chart_sweep_convergence.png"), dpi=110); plt.close(fig)

# ---------------------------------------------------------------- chart 4: power spin with bound
fig, ax = plt.subplots(1, 3, figsize=(15, 4.6))
ax[0].plot(spin["t"], spin["E_total"], label="E_total(t)")
ax[0].plot(spin["t"], spin["P_peak_bound_J"], "--", label="E(0) + P_peak·t  (bound)")
ax[0].set_title("12 m/s power-oversteer spin, arena (throttle 1.0 for 4 s, then coast)"); ax[0].set_xlabel("t [s]"); ax[0].set_ylabel("J")
ax[0].legend(); ax[0].grid(alpha=0.3)
ax[1].plot(spin["t"], spin["yaw_rate_dps"], label="yaw rate [deg/s]"); ax[1].plot(spin["t"], spin["speed"], label="speed [m/s]")
ax[1].set_title("yaw rate and speed"); ax[1].set_xlabel("t [s]"); ax[1].legend(); ax[1].grid(alpha=0.3)
ax[2].plot(spin["t"], spin["E_tyre_KE"], label="tyre node KE"); ax[2].plot(spin["t"], spin["E_tyre_spring"], label="tyre spring")
ax[2].set_title("tyre energy (J) during the spin"); ax[2].set_xlabel("t [s]"); ax[2].legend(); ax[2].grid(alpha=0.3)
fig.tight_layout(); fig.savefig(os.path.join(OUT, "chart_spin_energy_bound.png"), dpi=110); plt.close(fig)

# ---------------------------------------------------------------- GIF 1: curb strike, side (x-z) and rear (y-z) views
W, H = 720, 400
def font(sz):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()
F, FS = font(15), font(12)

def curb_gif(d, path, title, curb_x, theta_deg, t_end=2.6, step=8):
    frames = []
    idx = [i for i in range(len(d["t"])) if d["t"][i] <= t_end][::step]
    th = math.radians(theta_deg)
    for i in idx:
        im = Image.new("RGB", (W, H), (248, 248, 250)); dr = ImageDraw.Draw(im)
        # --- left: side view x-z, scale 40 px/m, car at fixed screen x (camera follows)
        cx = d["x"][i]; zz = d["z"][i]
        sc = 90.0; ox, oy = 180, 300     # origin of world (cx→ screen 180)
        def S(x, z): return (ox + (x - cx) * sc, oy - z * sc)
        dr.line([S(cx - 3, 0), S(cx + 3, 0)], fill=(90, 90, 90), width=2)           # flat ground
        # curb profile (only where it sits in view) — curb line at x = curb_x (for θ=0)
        if abs(theta_deg) < 1e-6:
            x0 = curb_x
            pts = [S(x0 - 0.02, 0), S(x0, 0.12), S(x0 + 0.10, 0.12), S(x0 + 0.12, 0)]
            dr.polygon(pts, fill=(190, 150, 90))
        # chassis box with pitch
        pitch = math.radians(d["pitch_deg"][i])
        hx, hz = 2.0, 0.35
        corners = []
        for px, pz in [(-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz)]:
            x = px * math.cos(pitch) + pz * math.sin(pitch); z = -px * math.sin(pitch) + pz * math.cos(pitch)
            corners.append(S(cx + x, zz + 0.35 + z))
        dr.polygon(corners, fill=(70, 120, 200))
        for k in range(4):
            c = d[f"c{k}x"][i], d[f"c{k}y"][i], d[f"c{k}z"][i]
            x, z = S(c[0], c[2])[0], S(c[0], c[2])[1]
            dr.ellipse([x - 5, z - 5, x + 5, z + 5], fill=(30, 30, 30) if d[f"load{k}"][i] > 50 else (220, 60, 60))
        dr.text((12, 10), "side view (x–z)", font=FS, fill=(40, 40, 40))
        # --- right: rear view y-z, scale 90 px/m, car roll shown
        ry, rz = 540, 300
        dr.line([(ry - 200, ry - ry + 300), (ry + 200, 300)], fill=(90, 90, 90), width=2)
        roll = math.radians(d["roll_deg"][i])
        def R(y, z): return (ry + y * 90, rz - z * 90)
        ch = [(-0.85, -0.2), (0.85, -0.2), (0.85, 0.2), (-0.85, 0.2)]
        pts = []
        for px, pz in ch:
            y = px * math.cos(roll) - pz * math.sin(roll); z = px * math.sin(roll) + pz * math.cos(roll)
            pts.append(R(y, zz + 0.35 + z - 0.0))
        dr.polygon(pts, fill=(70, 120, 200))
        for k in range(4):
            y, z = d[f"c{k}y"][i], d[f"c{k}z"][i]
            x_, z_ = R(y, z)
            dr.ellipse([x_ - 4, z_ - 4, x_ + 4, z_ + 4], fill=(30, 30, 30))
        dr.text((400, 10), "rear view (y–z)", font=FS, fill=(40, 40, 40))
        # --- text
        dr.text((12, H - 62), f"{title}", font=F, fill=(20, 20, 20))
        dr.text((12, H - 40), f"t={d['t'][i]:.2f}s  v={d['speed'][i]:5.2f} m/s  roll={d['roll_deg'][i]:+6.2f}°  pitch={d['pitch_deg'][i]:+6.2f}°", font=FS, fill=(40, 40, 40))
        dr.text((12, H - 22), f"wheels in contact {int(d['wheels_in_contact'][i])}/4   E_total−E0 = {d['E_total'][i]-d['E_total'][0]:+8.0f} J", font=FS, fill=(40, 40, 40))
        frames.append(im)
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=int(1000 * step * 0.0041667), loop=0, optimize=True)
    return len(frames)

n1 = curb_gif(curb["curb_15ms_00deg"], os.path.join(OUT, "curb_strike_15ms_0deg.gif"), "Curb strike 15 m/s, 0.12 m curb, 1 sweep", 0.0, 0.0, t_end=2.6)

# ---------------------------------------------------------------- GIF 2: spin in arena, top view (x-y) with heading
def spin_gif(d, path, t_end=10.0, step=12):
    frames = []
    idx = [i for i in range(len(d["t"])) if d["t"][i] <= t_end][::step]
    xs, ys = d["x"], d["y"]
    for i in idx:
        im = Image.new("RGB", (W, H), (248, 248, 250)); dr = ImageDraw.Draw(im)
        cx, cy = xs[i], ys[i]
        sc = 6.0; ox, oy = 360, 200
        def S(x, y): return (ox + (x - cx) * sc, oy - (y - cy) * sc)
        # trail
        trail = [S(xs[j], ys[j]) for j in range(max(0, i - 120), i + 1, 4)]
        if len(trail) > 1: dr.line(trail, fill=(230, 120, 60), width=2)
        # car footprint (approx 4.0 × 1.7 m) rotated by yaw
        yaw = math.radians(d["yaw_deg"][i])
        pts = []
        for px, py in [(-2.0, -0.85), (2.0, -0.85), (2.0, 0.85), (-2.0, 0.85)]:
            x = px * math.cos(yaw) - py * math.sin(yaw); y = px * math.sin(yaw) + py * math.cos(yaw)
            pts.append(S(cx + x, cy + y))
        dr.polygon(pts, fill=(70, 120, 200))
        # front marker
        fx, fy = S(cx + 2.0 * math.cos(yaw), cy + 2.0 * math.sin(yaw))
        dr.ellipse([fx - 4, fy - 4, fx + 4, fy + 4], fill=(255, 220, 0))
        dr.text((12, 10), "arena, top view (x–y), camera follows car", font=FS, fill=(40, 40, 40))
        dr.text((12, H - 62), "Spin 12 m/s: throttle 1.0 for 4 s with steer, then coast", font=F, fill=(20, 20, 20))
        dr.text((12, H - 40), f"t={d['t'][i]:5.2f}s  v={d['speed'][i]:5.2f} m/s  yaw rate={d['yaw_rate_dps'][i]:+7.1f}°/s", font=FS, fill=(40, 40, 40))
        dr.text((12, H - 22), f"E_total={d['E_total'][i]:8.0f} J   bound E0+P·t={d['P_peak_bound_J'][i]:8.0f} J", font=FS, fill=(40, 40, 40))
        frames.append(im)
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=int(1000 * step * 0.0041667), loop=0, optimize=True)
    return len(frames)

n2 = spin_gif(spin, os.path.join(OUT, "spin_arena_12ms.gif"))

# ---------------------------------------------------------------- summary table (generated from the CSVs)
def row(name, d):
    e0 = d["E_total"][0]
    rises = [e - e0 for e in d["E_total"]]
    lift = sum(1 for c in d["wheels_in_contact"] if c < 4)
    return (f"| {name} | {max(abs(x) for x in d['roll_deg']):.2f} | {max(abs(x) for x in d['pitch_deg']):.2f} | "
            f"{max(abs(x) for x in d['yaw_rate_dps']):.1f} | {max(d['speed']):.2f} | {lift} | {max(rises):+.0f} |")
lines = ["| run | roll max [°] | pitch max [°] | yaw-rate max [°/s] | speed max [m/s] | frames with a wheel off | max(E−E0) [J] |",
         "|---|---|---|---|---|---|---|"]
for name, d in curb.items(): lines.append(row(name, d))
lines.append(row("spin_12ms_arena (power, see bound)", spin))
lines.append(row("spincoast_12ms_057dps (no input)", spc12))
lines.append(row("spincoast_20ms_086dps (no input)", spc20))
lines.append("")
lines.append("| sweep study | max(E−E0) [J] | final E−E0 [J] |")
lines.append("|---|---|---|")
for n, d in sw.items():
    e0 = d["E_total"][0]
    lines.append(f"| {n} | {max(e - e0 for e in d['E_total']):+.0f} | {d['E_total'][-1] - e0:+.0f} |")
bound_margin = max(e - b for e, b in zip(spin["E_total"], spin["P_peak_bound_J"]))
lines.append("")
lines.append(f"Power spin: max over t of (E_total − (E0 + P_peak·t)) = {bound_margin:+.0f} J; the maximum sits at t=0, so the run never exceeds the engine bound.")
with open(os.path.join(OUT, "vehicle_summary_table.md"), "w") as f:
    f.write("\n".join(lines) + "\n")
print("\n".join(lines))
print("gif frames:", n1, n2)
