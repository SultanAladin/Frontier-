"""Charts, GIF and table for the mesh SDF pipeline proof. Reads frame_cell_writes.tsv and run.log written by proof.cpp."""
from pathlib import Path
import csv
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.animation import PillowWriter
import numpy as np

HERE = Path(__file__).resolve().parent
rows = list(csv.DictReader(open(HERE / "frame_cell_writes.tsv"), delimiter="\t"))
frame = np.array([int(r["frame"]) for r in rows])
old = np.array([int(r["old_full_rebuild_writes"]) for r in rows], dtype=float)
new_static = np.array([int(r["new_static_field_writes"]) for r in rows], dtype=float)
new_movable = np.array([int(r["new_movable_field_writes"]) for r in rows], dtype=float)
new_total = new_static + new_movable
RED, GREEN, BLUE = "#c0392b", "#1f7a4d", "#2e6fbf"
seconds = frame / 60.0

# 1. Per-frame cell writes, old full rebuild vs new split (log scale, first 10 s zoom on the right)
fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 4.6), dpi=110, gridspec_kw={"width_ratios": [1.4, 1]})
a1.plot(seconds, old, color=RED, lw=1.2, label="old build: full 3 x 32^3 rebuild")
a1.plot(seconds, new_total, color=GREEN, lw=1.2, label="new build: total (static + movable)")
a1.set_yscale("log"); a1.set_xlabel("seconds (60 fps)"); a1.set_ylabel("cells written per frame (log)")
a1.set_title("Cells written per frame, 3600 frames (CPU exact count)"); a1.legend(fontsize=8)
mask = frame < 600
a2.stackplot(seconds[mask], new_static[mask], new_movable[mask], colors=[BLUE, GREEN],
             labels=["static field (camera slabs only)", "movable field (car footprint + slabs)"])
a2.set_xlabel("seconds"); a2.set_ylabel("cells written per frame"); a2.set_ylim(0, max(new_total[mask].max() * 1.15, 1))
a2.set_title("New build, first 10 s, split by field"); a2.legend(fontsize=7, loc="upper right")
fig.tight_layout(); fig.savefig(HERE / "chart_cells_per_frame.png"); plt.close(fig)

# 2. Cumulative cell writes
fig, ax = plt.subplots(figsize=(8, 4.4), dpi=110)
ax.plot(seconds, np.cumsum(old), color=RED, lw=2, label="old build")
ax.plot(seconds, np.cumsum(new_total), color=GREEN, lw=2, label="new build")
ax.set_xlabel("seconds (60 fps)"); ax.set_ylabel("cumulative cells written"); ax.set_title("Cumulative cell writes over 60 s")
ax.legend(); fig.tight_layout(); fig.savefig(HERE / "chart_cumulative_writes.png"); plt.close(fig)

# 3. GIF: cumulative writes filling in, one frame per 2 seconds of simulated time
cum_old, cum_new = np.cumsum(old), np.cumsum(new_total)
fig, ax = plt.subplots(figsize=(8, 4.4), dpi=90)
ax.set_xlim(0, 60); ax.set_ylim(0, cum_old[-1] * 1.05)
ax.set_xlabel("seconds (60 fps)"); ax.set_ylabel("cumulative cells written"); ax.set_title("Dirty-cell path vs full rebuild (cumulative)")
(lo,) = ax.plot([], [], color=RED, lw=2, label="old build: full rebuild")
(ln,) = ax.plot([], [], color=GREEN, lw=2, label="new build: dirty cells")
ax.legend(loc="upper left", fontsize=8)
fig.tight_layout()
writer = PillowWriter(fps=10)
writer.setup(fig, str(HERE / "dirty_cells.gif"), dpi=90)
for t in range(60, len(frame) + 1, 60):
    lo.set_data(seconds[:t], cum_old[:t]); ln.set_data(seconds[:t], cum_new[:t])
    writer.grab_frame()
writer.finish()
plt.close(fig)

# 4. Table
with open(HERE / "dirty_cells_table.md", "w") as f:
    f.write("| Metric (3600 frames, 3 clip levels of 32^3, one moving car, camera moving 1.5 m/s) | Old build | New build |\n|---|---:|---:|\n")
    f.write(f"| Cells written, total | {int(old.sum()):,} | {int(new_total.sum()):,} |\n")
    f.write(f"| Cells written per frame (mean) | {old.mean():,.1f} | {new_total.mean():,.1f} |\n")
    f.write(f"| Cells written per frame (max) | {int(old.max()):,} | {int(new_total.max()):,} |\n")
    f.write(f"| Static field cells, total | (shared with movable) | {int(new_static.sum()):,} |\n")
    f.write(f"| Movable field cells, total | (shared with static) | {int(new_movable.sum()):,} |\n")
    f.write(f"| Frames with a full rebuild | {int((old > 0).sum()):,} | 0 |\n")
    f.write(f"| Reduction in cells written | 1.0x | {old.sum() / max(new_total.sum(), 1):,.1f}x |\n")
print("charts, gif and table written")
