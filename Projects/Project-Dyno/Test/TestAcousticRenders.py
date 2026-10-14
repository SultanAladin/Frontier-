#!/usr/bin/env python3
"""Frontier Engine Audio Sim v3 — headless regression proof for Project-Dyno.

Renders four contrasting cars offline through the real binary and asserts the
properties the hybrid was built for:

  * determinism      — two identical renders are byte-identical (seeded RNG)
  * audibility       — every car produces finite, non-silent output
  * no hard clipping — peaks stay under full scale after the soft saturator
  * character        — the Viper is measurably darker than the LaFerrari,
                       and no two cars share the same brightness (zero-crossing
                       rate is a cheap, stdlib-only spectral proxy)

Usage:  python3 Projects/Project-Dyno/Test/TestAcousticRenders.py [path-to-Project-Dyno]
Exit code 0 = PASS.
"""
import hashlib
import math
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

CARS = ["laferrari", "viper", "amg-gt3", "taycan"]


def default_binary() -> Path:
    root = Path(__file__).resolve().parents[3]
    return root / "Projects/Project-Dyno/Build/Output/Linux/Release/Binary/Project-Dyno"


def render(binary: Path, out: Path, car: str) -> str:
    proc = subprocess.run(
        [str(binary), "--render", str(out), "--car", car, "--pull", "pull"],
        capture_output=True, text=True, timeout=300,
    )
    if proc.returncode != 0:
        raise SystemExit(f"FAIL render {car}: exit {proc.returncode}\n{proc.stdout}\n{proc.stderr}")
    return proc.stdout + proc.stderr


def analyse(path: Path):
    with wave.open(str(path)) as w:
        frames, channels, rate = w.getnframes(), w.getnchannels(), w.getframerate()
        raw = w.readframes(frames)
    samples = []
    for i in range(0, len(raw) - 1, 2):
        samples.append((raw[i] | (raw[i + 1] << 8)) if raw[i + 1] < 128 else (raw[i] | (raw[i + 1] << 8)) - 65536)
    mono = [samples[i * channels] / 32768.0 for i in range(frames)]
    seg = mono[rate * 2: rate * 12]  # mid-pull: warmed up, still climbing
    rms = math.sqrt(sum(x * x for x in seg) / len(seg))
    peak = max(abs(x) for x in seg)
    crossings = sum(1 for a, b in zip(seg, seg[1:]) if (a < 0) != (b < 0))
    zcr_hz = crossings / 2.0 / (len(seg) / rate)
    return rms, peak, zcr_hz, all(math.isfinite(x) for x in seg)


def main() -> int:
    binary = Path(sys.argv[1]) if len(sys.argv) > 1 else default_binary()
    if not binary.exists():
        print(f"FAIL binary not found: {binary}\nBuild it: bash Projects/Project-Dyno/Build/ToolchainSequence.sh")
        return 1
    failures = []
    results = {}
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for car in CARS:
            out = tmp / f"{car}.wav"
            render(binary, out, car)
            rms, peak, zcr, finite = analyse(out)
            results[car] = (rms, peak, zcr)
            ok = finite and rms > 0.01 and peak <= 1.0
            print(f"{'PASS' if ok else 'FAIL'} {car:10s} rms={rms:.4f} peak={peak:.3f} brightness~{zcr:6.0f} Hz")
            if not ok:
                failures.append(f"{car}: rms={rms:.4f} peak={peak:.3f} finite={finite}")
        # determinism: the hero car, rendered twice, must be byte-identical
        a, b = tmp / "hero-a.wav", tmp / "hero-b.wav"
        render(binary, a, "laferrari")
        render(binary, b, "laferrari")
        ha, hb = hashlib.sha256(a.read_bytes()).hexdigest(), hashlib.sha256(b.read_bytes()).hexdigest()
        det_ok = ha == hb
        print(f"{'PASS' if det_ok else 'FAIL'} determinism  sha256={ha[:16]}…")
        if not det_ok:
            failures.append("offline renders are not byte-identical")
    # character: Viper darker than LaFerrari; all brightness values distinct
    if results:
        if not results["viper"][2] < results["laferrari"][2]:
            failures.append(f"viper brightness {results['viper'][2]:.0f} !< laferrari {results['laferrari'][2]:.0f}")
        zs = [round(v[2]) for v in results.values()]
        if len(set(zs)) != len(zs):
            failures.append(f"cars share brightness values: {zs}")
        print(f"{'PASS' if not failures else 'FAIL'} character    viper darker than laferrari, all four distinct")
    if failures:
        for f in failures:
            print("FAIL", f)
        return 1
    print("Project-Dyno acoustic renders: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
