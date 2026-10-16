// Repeatable, sampled WebGPU timings. Start the server first. No GPU speedup claim on software adapters.
import { launchTestBrowser } from "./browser-tools.mjs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const browser = await launchTestBrowser();
const base = process.env.TYRE_LAB_URL || "http://localhost:8080";
const samples = Number(process.env.BENCH_SAMPLES || 60),
  warmup = Number(process.env.BENCH_WARMUP || 60);
const percentile = (xs, p) =>
  [...xs].sort((a, b) => a - b)[
    Math.min(xs.length - 1, Math.floor((xs.length - 1) * p))
  ];
const results = [];
try {
  for (const variant of process.env.BASELINE_DIR
    ? ["baseline", "optimized"]
    : ["optimized"]) {
    const page = await browser.newPage({
        viewport: { width: 1280, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    if (variant === "baseline")
      await page.route("**/_baseline/**", async (route) => {
        const name = path.basename(new URL(route.request().url()).pathname);
        const file = path.join(process.env.BASELINE_DIR, name);
        if (name === "app.js") {
          let code = await readFile(file, "utf8");
          // Instrument CPU encode on the old copy, without altering its GPU workload.
          code = code.replace(
            "function frame(now) {",
            "function frame(now) { const benchStart=performance.now();",
          );
          code = code.replace(
            "device.queue.submit([encoder.finish()]);",
            "device.queue.submit([encoder.finish()]);window.__benchCpu=performance.now()-benchStart;",
          );
          await route.fulfill({
            body: code,
            contentType: "application/javascript",
          });
        } else await route.fulfill({ path: file });
      });
    const url = new URL(base);
    if (variant === "baseline") url.pathname = "/_baseline/index.html";
    await page.goto(url.href);
    await page.waitForFunction(
      () => window.tyreLab?.ready || window.tyreLab?.error,
    );
    const error = await page.evaluate(() => tyreLab.error);
    if (error) throw new Error(error);
    await page.evaluate(() => {
      tyreLab.state.paused = false;
      tyreLab.setModel(1);
    });
    await page.waitForFunction((n) => tyreLab.ticks >= n, warmup, {
      timeout: 120000,
    });
    const record = await page.evaluate(async (count) => {
      const out = [],
        start = performance.now(),
        firstTick = tyreLab.ticks;
      let seen = tyreLab.stats?.tick;
      await new Promise((resolve, reject) => {
        function tick() {
          if (tyreLab.error) return reject(new Error(tyreLab.error));
          if (performance.now() - start > 120000)
            return reject(new Error("Benchmark timed out"));
          const s = tyreLab.stats;
          if (s && s.tick !== seen) {
            seen = s.tick;
            out.push({
              tick: s.tick,
              gpuMs: tyreLab.gpuMs,
              cpuEncodeMs:
                tyreLab.diagnostics?.().cpuEncodeMs ?? window.__benchCpu,
              minJ: s.minJ,
              normal: s.normal,
              safe: s.minAcceptedStep ?? 1,
            });
          }
          if (out.length >= count) return resolve();
          requestAnimationFrame(tick);
        }
        tick();
      });
      return {
        adapter: tyreLab.adapter || null,
        mesh: tyreLab.mesh,
        parameters: { ...tyreLab.state },
        samples: out,
        elapsedMs: performance.now() - start,
        advancedTicks: tyreLab.ticks - firstTick,
        diagnostics: tyreLab.diagnostics?.(),
      };
    }, samples);
    if (errors.length) throw new Error(errors.join("\n"));
    const gpu = record.samples.map((s) => s.gpuMs).filter(Number.isFinite),
      cpu = record.samples.map((s) => s.cpuEncodeMs).filter(Number.isFinite);
    const summary = {
      variant,
      ...record,
      gpuMs: {
        p50: percentile(gpu, 0.5),
        p95: percentile(gpu, 0.95),
        p99: percentile(gpu, 0.99),
      },
      cpuEncodeMs: { p50: percentile(cpu, 0.5), p95: percentile(cpu, 0.95) },
    };
    results.push(summary);
    console.log(
      variant,
      JSON.stringify({
        gpuMs: summary.gpuMs,
        cpuEncodeMs: summary.cpuEncodeMs,
        diagnostics: record.diagnostics,
        adapter: record.adapter,
      }),
    );
    await page.close();
  }
  const report = {
    timestamp: new Date().toISOString(),
    environment:
      "Browser-reported adapter; software timings are validation only, not hardware GPU benchmarks",
    warmupTicks: warmup,
    sampleCount: samples,
    results,
  };
  if (process.env.BENCH_OUTPUT)
    await writeFile(
      process.env.BENCH_OUTPUT,
      JSON.stringify(report, null, 2) + "\n",
    );
} finally {
  await browser.close();
}
