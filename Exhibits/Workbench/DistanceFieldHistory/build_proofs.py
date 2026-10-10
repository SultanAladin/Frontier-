"""Charts, GIF and table for the Distance Field history proof. Reads the TSVs written by proof.cpp."""
from pathlib import Path
import csv
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.animation import PillowWriter
import numpy as np

HERE = Path(__file__).resolve().parent
rows = list(csv.DictReader(open(HERE / "history_summary.tsv"), delimiter="\t"))
trace = list(csv.DictReader(open(HERE / "restarts_per_second.tsv"), delimiter="\t"))
SCENES = list(dict.fromkeys(r["scenario"] for r in rows))
BUILDS = ["old_exact", "new_tolerant"]
COLOUR = {"old_exact": "#c0392b", "new_tolerant": "#1f7a4d"}
LABEL = {"old_exact": "old build (1784c86): byte-exact, frame-to-frame",
         "new_tolerant": "new build: drift-tolerant, held baseline"}

def by(scene, build):
    return next(r for r in rows if r["scenario"] == scene and r["build"] == build)

# 1. Summary chart: restarts per frame and mean history run length
fig, (a1, a2) = plt.subplots(1, 2, figsize=(12, 4.6), dpi=110)
x = np.arange(len(SCENES)); w = 0.38
for i, b in enumerate(BUILDS):
    vals = [float(by(s, b)["restarts_per_frame"]) for s in SCENES]
    bars = a1.bar(x + (i - 0.5) * w, vals, w, color=COLOUR[b], label=LABEL[b])
    for bar, v in zip(bars, vals):
        a1.text(bar.get_x() + bar.get_width() / 2, v + 0.02, f"{v:.4f}", ha="center", fontsize=8)
a1.set_xticks(x, [s.replace("_", "\n") for s in SCENES]); a1.set_ylabel("history restarts per frame")
a1.set_ylim(0, 1.25); a1.set_title("Card-history restarts per frame (3600 frames, CPU exact)")
a1.legend(fontsize=7, loc="upper right")
for i, b in enumerate(BUILDS):
    vals = [float(by(s, b)["mean_history_run_frames"]) for s in SCENES]
    a2.bar(x + (i - 0.5) * w, vals, w, color=COLOUR[b], label=LABEL[b])
a2.set_xticks(x, [s.replace("_", "\n") for s in SCENES]); a2.set_ylabel("frames of history kept per restart (mean)")
a2.set_yscale("symlog"); a2.set_title("Frames of accumulated history between restarts")
fig.tight_layout(); fig.savefig(HERE / "chart_restarts_summary.png"); plt.close(fig)

# 2. Cumulative restarts per second, per scenario
fig, axes = plt.subplots(1, len(SCENES), figsize=(13, 4), dpi=110, sharey=False)
for ax, s in zip(axes, SCENES):
    for b in BUILDS:
        pts = [(int(r["second"]), int(r["cumulative_restarts"])) for r in trace if r["scenario"] == s and r["build"] == b]
        ax.plot([p[0] for p in pts], [p[1] for p in pts], color=COLOUR[b], label=b)
    ax.set_title(s.replace("_", " "), fontsize=10); ax.set_xlabel("seconds (60 fps)"); ax.set_ylabel("cumulative restarts")
axes[0].legend(fontsize=8)
fig.tight_layout(); fig.savefig(HERE / "chart_restarts_per_second.png"); plt.close(fig)

# 3. GIF: cumulative restarts filling in over 60 seconds, one scenario per panel
fig, axes = plt.subplots(1, len(SCENES), figsize=(13, 4.2), dpi=100)
series = {(s, b): [int(r["cumulative_restarts"]) for r in trace if r["scenario"] == s and r["build"] == b] for s in SCENES for b in BUILDS}
lines = {}
for ax, s in zip(axes, SCENES):
    top = max(max(series[(s, b)]) for b in BUILDS) * 1.1 + 1
    ax.set_xlim(1, 60); ax.set_ylim(0, top); ax.set_title(s.replace("_", " "), fontsize=10)
    ax.set_xlabel("seconds"); ax.set_ylabel("cumulative restarts")
    for b in BUILDS:
        (lines[(s, b)],) = ax.plot([], [], color=COLOUR[b], label=b, lw=2)
axes[0].legend(fontsize=8, loc="upper left")
fig.tight_layout()
frames = range(1, 61)
writer = PillowWriter(fps=12)
writer.setup(fig, str(HERE / "history_restarts.gif"), dpi=90)
for t in frames:
    for (s, b), line in lines.items():
        line.set_data(range(1, t + 1), series[(s, b)][:t])
    writer.grab_frame()
writer.finish()
plt.close(fig)

# 4. Markdown table for the README
with open(HERE / "history_table.md", "w") as f:
    f.write("| Scenario | Build | Restarts (60 s) | Restarts / frame | Mean history run (frames) | Longest run (frames) | Decision ns / frame (CPU) |\n")
    f.write("|---|---|---:|---:|---:|---:|---:|\n")
    for s in SCENES:
        for b in BUILDS:
            r = by(s, b)
            f.write(f"| {s} | {b} | {r['restarts']} | {float(r['restarts_per_frame']):.4f} | {float(r['mean_history_run_frames']):.1f} | {r['longest_history_run_frames']} | {float(r['decision_ns_per_frame']):.1f} |\n")
print("charts, gif and table written")
