#!/usr/bin/env python3
"""
Builds the SolidArc raster proof exhibit from the raw frames written by Verification/PipelineMirrorProof.cpp.

    python3 build_proofs.py <proof-out-dir>

Inputs  (from the C++ harness): frames_{surface,line,point}.rgba, timings.tsv, checks.txt
Outputs (this folder): *_orbit.gif, *_still.png, three_pipelines.png, chart_*.png, timings_summary.tsv, README.md

Every number printed here is CPU exact-mirror wall-clock on the machine that ran the harness. Nothing in this exhibit is a GPU
measurement or a GPU model; see README.md.
"""
import csv
import platform
import statistics
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

W, H, FRAMES = 480, 300, 72
PIPELINES = [("surface", "Surface", "SurfaceVS / SurfaceFS"),
             ("line", "Line", "LineVS / LineFS"),
             ("point", "Point", "PointVS / PointFS")]
HERE = Path(__file__).resolve().parent


def load_frames(raw_dir: Path, name: str) -> np.ndarray:
    data = np.fromfile(raw_dir / f"frames_{name}.rgba", dtype=np.uint8)
    frames = data.reshape(-1, H, W, 4)[..., :3]
    if frames.shape[0] != FRAMES:
        sys.exit(f"RED — {name}: expected {FRAMES} frames, found {frames.shape[0]}")
    return frames


def read_timings(raw_dir: Path) -> dict:
    rows = {}
    with open(raw_dir / "timings.tsv", newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            rows.setdefault(row["pipeline"], []).append(row)
    return rows


def summarise(rows: list) -> dict:
    ms = np.array([float(r["cpu_ms"]) for r in rows])
    mean = float(ms.mean())
    return {
        "frames": len(ms),
        "mean_ms": mean,
        "median_ms": float(np.median(ms)),
        "p95_ms": float(np.percentile(ms, 95)),
        "stdev_ms": float(statistics.pstdev(ms)),
        "cpu_fps_mean": 1000.0 / mean,
        "triangles": int(rows[0]["triangles"]),
        "segments": int(rows[0]["segments"]),
        "points": int(rows[0]["points"]),
        "fragments_mean": float(np.mean([int(r["fragments"]) for r in rows])),
        "depth_rejected_mean": float(np.mean([int(r["depth_rejected"]) for r in rows])),
        "back_facing_mean": float(np.mean([int(r["back_facing"]) for r in rows])),
        "ms": ms,
    }


def write_gifs(raw_dir: Path) -> None:
    for name, _, _ in PIPELINES:
        frames = load_frames(raw_dir, name)
        images = [Image.fromarray(f).convert("P", palette=Image.ADAPTIVE, colors=128) for f in frames]
        images[0].save(HERE / f"{name}_orbit.gif", save_all=True, append_images=images[1:],
                       duration=80, loop=0, optimize=True)
        Image.fromarray(frames[0]).save(HERE / f"{name}_still.png", optimize=True)


def write_three_panel(raw_dir: Path) -> None:
    fig, axes = plt.subplots(1, 3, figsize=(15, 4.6), dpi=110)
    for ax, (name, label, shader) in zip(axes, PIPELINES):
        ax.imshow(load_frames(raw_dir, name)[18])
        ax.set_title(f"{label} pipeline · {shader}", fontsize=10)
        ax.axis("off")
    fig.suptitle("SolidArc raster pipelines · CPU exact mirror of the Slang bodies (frame 18 of 72)", fontsize=11)
    fig.tight_layout()
    fig.savefig(HERE / "three_pipelines.png")
    plt.close(fig)


def write_charts(stats: dict) -> None:
    labels = [label for _, label, _ in PIPELINES]
    colours = ["#4c78a8", "#f2b134", "#54a24b"]
    footer = f"CPU exact mirror (SoftwareRaster) · {platform.machine()} · {platform.python_implementation()} {platform.python_version()} · NOT GPU"

    fig, ax = plt.subplots(figsize=(8, 4.8), dpi=120)
    data = [stats[n]["ms"] for n, _, _ in PIPELINES]
    ax.boxplot(data, tick_labels=labels, showfliers=False)
    for i, d in enumerate(data, start=1):
        ax.scatter(np.full(len(d), i) + np.random.default_rng(i).uniform(-0.08, 0.08, len(d)), d, s=6, alpha=0.5, color=colours[i - 1])
    ax.set_ylabel("CPU mirror frame time per target [ms]")
    ax.set_title("Frame time per pipeline over one 72-frame orbit")
    ax.grid(axis="y", alpha=0.3)
    fig.text(0.01, 0.01, footer, fontsize=7, color="#555")
    fig.tight_layout(rect=(0, 0.03, 1, 1))
    fig.savefig(HERE / "chart_frame_time.png")
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8, 4.8), dpi=120)
    fps = [stats[n]["cpu_fps_mean"] for n, _, _ in PIPELINES]
    bars = ax.bar(labels, fps, color=colours)
    for b, v in zip(bars, fps):
        ax.text(b.get_x() + b.get_width() / 2, v, f"{v:,.1f}", ha="center", va="bottom", fontsize=9)
    ax.set_ylabel("CPU mirror frames per second (1000 / mean ms)")
    ax.set_title("Throughput of each pipeline on the CPU mirror")
    ax.grid(axis="y", alpha=0.3)
    fig.text(0.01, 0.01, footer, fontsize=7, color="#555")
    fig.tight_layout(rect=(0, 0.03, 1, 1))
    fig.savefig(HERE / "chart_cpu_fps.png")
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8, 4.8), dpi=120)
    x = np.arange(len(PIPELINES))
    tri = [stats[n]["triangles"] for n, _, _ in PIPELINES]
    seg = [stats[n]["segments"] for n, _, _ in PIPELINES]
    pts = [stats[n]["points"] for n, _, _ in PIPELINES]
    frag = [stats[n]["fragments_mean"] for n, _, _ in PIPELINES]
    width = 0.2
    ax.bar(x - 1.5 * width, tri, width, label="triangles")
    ax.bar(x - 0.5 * width, seg, width, label="segments")
    ax.bar(x + 0.5 * width, pts, width, label="points")
    ax.bar(x + 1.5 * width, frag, width, label="fragments (mean/frame)")
    ax.set_yscale("log")
    ax.set_xticks(x, labels)
    ax.set_ylabel("count per frame (log scale)")
    ax.set_title("Workload per frame (exact counts from the mirror)")
    ax.legend(fontsize=8)
    ax.grid(axis="y", alpha=0.3)
    fig.text(0.01, 0.01, footer, fontsize=7, color="#555")
    fig.tight_layout(rect=(0, 0.03, 1, 1))
    fig.savefig(HERE / "chart_workload.png")
    plt.close(fig)


def write_summary(stats: dict) -> None:
    keys = ["frames", "mean_ms", "median_ms", "p95_ms", "stdev_ms", "cpu_fps_mean", "triangles", "segments",
            "points", "fragments_mean", "depth_rejected_mean", "back_facing_mean"]
    with open(HERE / "timings_summary.tsv", "w", newline="") as fh:
        w = csv.writer(fh, delimiter="\t")
        w.writerow(["pipeline"] + keys)
        for name, _, _ in PIPELINES:
            w.writerow([name] + [f"{stats[name][k]:.4f}" if isinstance(stats[name][k], float) else stats[name][k] for k in keys])


def write_readme(stats: dict, checks: str) -> None:
    rows = []
    for name, label, shader in PIPELINES:
        s = stats[name]
        rows.append(f"| {label} | `{shader}` | {s['mean_ms']:.2f} | {s['median_ms']:.2f} | {s['p95_ms']:.2f} | "
                    f"{s['cpu_fps_mean']:.1f} | {s['triangles']:,} | {s['segments']:,} | {s['points']:,} | {s['fragments_mean']:,.0f} |")
    table = "\n".join(rows)
    text = f"""# SolidArc · Vulkan raster pipelines · CPU exact-mirror proof

**What this is.** Visual and timing proof for the three SolidArc raster pipelines of the Vulkan path: **Surface**, **Line** and
**Point**. Each pipeline is driven in isolation over one full 72-frame turntable orbit (5° per frame) at 480×300.

**What it is not.** No GPU was available when this was produced (no Vulkan ICD in the build sandbox). **These are CPU timings of the
exact mirror, not GPU frame rates.** No GPU FPS is claimed or modelled here. The Vulkan path
(`Presentation/VulkanRaster.cpp`) has been compiled against the Vulkan headers and its SPIR-V checked, but it has **not been executed
on a device**. Its parity with this mirror is therefore unmeasured.

## Files

| File | Content |
|---|---|
| `three_pipelines.png` | One still per pipeline (frame 18) |
| `surface_orbit.gif`, `line_orbit.gif`, `point_orbit.gif` | 72-frame orbits, 80 ms per frame |
| `surface_still.png`, `line_still.png`, `point_still.png` | Frame 0 of each orbit, full size |
| `chart_frame_time.png` | Distribution of CPU frame time per pipeline |
| `chart_cpu_fps.png` | Mean CPU-mirror frames per second per pipeline |
| `chart_workload.png` | Exact per-frame counts (triangles, segments, points, fragments) |
| `timings_summary.tsv` | All numbers behind the charts |
| `checks.txt` | Self-checks run by the harness |

## Timings (CPU exact mirror, one run, warm-up of 3 frames excluded)

| Pipeline | Shader | Mean ms | Median ms | p95 ms | Mean CPU FPS | Triangles | Segments | Points | Fragments / frame (mean) |
|---|---|---|---|---|---|---|---|---|---|
{table}

Measured on: {platform.machine()}, {platform.python_implementation()} {platform.python_version()} for the plotting step only; the
timed code is the C++ harness built with `g++ -O2`.

## Self-checks (`checks.txt`)

```
{checks.strip()}
```

## Honest limits

* The mirror (`SoftwareRaster`) runs the same `.slang` bodies as C++. The GPU runs them as SPIR-V. Identical source text does not
  prove identical pixels; that needs a device run of `VulkanRaster` against this mirror, which has not happened.
* Matcap studios: the mirror samples pre-rendered 128×128 layers; the GPU evaluates the analytic studio per fragment.
* The mirror uses 4-tap supersampling for the lattice and analytic shaders; the GPU path reproduces the same taps in
  `LatticeFS` but does not supersample surfaces, lines or points.
* Fragment, depth-reject and back-face tallies are CPU-side counts. The Vulkan path does not read them back.

## Reproduce

```
bash run_proof.sh          # builds the C++ harness at -O2, runs it, then runs build_proofs.py
```
"""
    (HERE / "README.md").write_text(text, encoding="utf-8")


def main() -> None:
    raw_dir = Path(sys.argv[1]).resolve()
    timings = read_timings(raw_dir)
    stats = {name: summarise(timings[name]) for name, _, _ in PIPELINES}
    for name, label, _ in PIPELINES:
        s = stats[name]
        print(f"{label:8s} mean {s['mean_ms']:.2f} ms · {s['cpu_fps_mean']:.1f} CPU-mirror FPS · frames {s['frames']}")
    write_gifs(raw_dir)
    write_three_panel(raw_dir)
    write_charts(stats)
    write_summary(stats)
    write_readme(stats, (raw_dir / "checks.txt").read_text(encoding="utf-8"))
    print("GREEN — exhibit written to", HERE)


if __name__ == "__main__":
    main()
