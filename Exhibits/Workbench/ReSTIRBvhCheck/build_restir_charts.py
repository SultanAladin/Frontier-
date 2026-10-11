#!/usr/bin/env python3
"""Plots ris_bias_vs_m.csv written by RestirBvhCheck.cpp.   python build_restir_charts.py out"""
import csv, os, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
rows = list(csv.DictReader(open(os.path.join(OUT, "ris_bias_vs_m.csv"))))
M = [int(r["M"]) for r in rows]
bias = [100 * float(r["mean_rel_bias"]) for r in rows]
rmse = [100 * float(r["rmse_over_mean_ref"]) for r in rows]
fig, ax = plt.subplots(1, 2, figsize=(11, 4.2))
ax[0].semilogx(M, bias, "o-"); ax[0].axhline(0, color="k", lw=0.8)
ax[0].set_xlabel("RIS candidates M"); ax[0].set_ylabel("mean relative bias [%]")
ax[0].set_title("Bias vs brute force (200 receivers, 64 lights)"); ax[0].grid(alpha=0.3)
ax[1].semilogx(M, rmse, "o-", color="C1"); ax[1].set_xlabel("RIS candidates M"); ax[1].set_ylabel("per-receiver relative RMSE [%]")
ax[1].set_title("Spread vs M (did not fall with M in this run)"); ax[1].grid(alpha=0.3)
fig.tight_layout(); fig.savefig(os.path.join(OUT, "chart_ris_bias_vs_m.png"), dpi=110)
print("saved")
