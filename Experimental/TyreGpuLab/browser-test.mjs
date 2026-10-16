// Optional end-to-end test. Start the lab separately, then npm run test:gpu.
// PLAYWRIGHT_MODULE can point to an existing Playwright installation.
import assert from "node:assert/strict";
import { launchTestBrowser } from "./browser-tools.mjs";
const browser = await launchTestBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.goto(process.env.TYRE_LAB_URL || "http://localhost:8080");
  await page.waitForFunction(
    () => window.tyreLab?.ready || window.tyreLab?.error,
  );
  assert.equal(await page.evaluate(() => tyreLab.error), undefined);
  await page.evaluate(() => {
    tyreLab.state.paused = true;
  });
  async function run(label, ticks) {
    const end = (await page.evaluate(() => tyreLab.ticks)) + ticks;
    await page.evaluate((ticks) => tyreLab.step(ticks), ticks);
    await page.waitForFunction(
      (end) => tyreLab.ticks >= end || tyreLab.error,
      end,
      { timeout: 120000 },
    );
    const sample = await page.evaluate(async () => {
      const a = await tyreLab.snapshot();
      let minY = Infinity,
        maxPosition = 0,
        finite = true;
      for (let i = 0; i < a.length; i += 20) {
        minY = Math.min(minY, a[i + 1]);
        for (let j = 0; j < 3; j++) {
          finite &&= Number.isFinite(a[i + j]);
          maxPosition = Math.max(maxPosition, Math.abs(a[i + j]));
        }
      }
      // Independent CPU assertion over a readback; never part of the runtime solver.
      if (!window.__testTopology)
        window.__testTopology = (await import("./mesh.js")).makeTyre();
      let snapshotMinJ = Infinity;
      for (let t = 0; t < window.__testTopology.tets.length; t++) {
        const ids = window.__testTopology.tets[t],
          at = ids[0] * 20;
        const v = ids
          .slice(1)
          .map((i) => [
            a[i * 20] - a[at],
            a[i * 20 + 1] - a[at + 1],
            a[i * 20 + 2] - a[at + 2],
          ]);
        const [x, y, z] = v;
        const det =
          x[0] * (y[1] * z[2] - y[2] * z[1]) -
          x[1] * (y[0] * z[2] - y[2] * z[0]) +
          x[2] * (y[0] * z[1] - y[1] * z[0]);
        snapshotMinJ = Math.min(
          snapshotMinJ,
          det / (6 * window.__testTopology.tetData[t * 16 + 15]),
        );
      }
      return {
        snapshotMinJ,
        adapter: tyreLab.adapter,
        stats: tyreLab.stats,
        diagnostics: tyreLab.diagnostics(),
        gpuMs: tyreLab.gpuMs,
        tick: tyreLab.ticks,
        error: tyreLab.error,
        finite,
        minY,
        maxPosition,
      };
    });
    console.log(label, JSON.stringify(sample));
    assert(!sample.error);
    assert(sample.finite);
    assert(sample.minY >= -1e-5);
    assert(sample.stats && sample.stats.normal > 0);
    assert(sample.stats.minJ >= 0.099);
    assert(sample.snapshotMinJ >= 0.099);
    assert(sample.maxPosition < 2);
  }
  await page.evaluate(() => tyreLab.setModel(0));
  await page.waitForFunction(() => tyreLab.ticks === 0);
  await run("XPBD edge carcass / 100 ticks", 100);
  await page.click("#flesh");
  await page.waitForFunction(() => tyreLab.ticks === 0);
  await run("Corotated solid / 100 ticks", 100);
  await page.selectOption("#view", "1");
  await page.check("#wire");
  await page.check("#ghost");
  await page.click("#cleat");
  await page.locator("#speed").evaluate((el) => {
    el.value = "1";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await run("Corotated rolling + cleat / 60 ticks", 60);
  // The reported failure configuration: soft carcass, deep compression and rolling cleat.
  await page.evaluate(() =>
    Object.assign(tyreLab.state, {
      compression: 92,
      stiffness: 0.25,
      speed: 3,
    }),
  );
  await run("Severe soft tyre / 92 mm / 3 m/s", 100);
  await page.evaluate(() => (tyreLab.state.speed = 5));
  await run("Severe soft tyre / 5 m/s", 60);
  await page.check("#adaptive");
  await run("Adaptive / 5 m/s / 16 substeps", 8);
  assert.equal(
    await page.evaluate(() => tyreLab.diagnostics().activeSubsteps),
    16,
  );
  const guardCases = await page.evaluate(async () => {
    const { runGuardCases } = await import("./guard-browser.js");
    return runGuardCases();
  });
  for (const c of guardCases) {
    assert(c.finite);
    assert(c.j >= 0.099);
    if (c.reject) assert(c.safe < 1);
  }
  console.log("Isolated GPU guard cases", JSON.stringify(guardCases));
  const download = page.waitForEvent("download");
  await page.click("#capture");
  assert((await download).suggestedFilename().endsWith(".json"));
  await page.click("#reset");
  await page.waitForFunction(() => tyreLab.ticks === 0);
  const reset = await page.evaluate(async () => {
    const a = await tyreLab.snapshot();
    return { vx: a[8], y: a[1], restY: a[13] };
  });
  assert.equal(reset.vx, 0);
  assert(Math.abs(reset.y - reset.restY - 0.48) < 1e-6);
  // A software adapter must be rejected at the normal URL (test bypass is localhost-only).
  assert.deepEqual(errors, []);
  const software = await page.evaluate(() => tyreLab.adapter.software);
  if (software) {
    await page.goto("http://localhost:8080");
    await page.waitForFunction(() => tyreLab.error);
    assert.match(
      await page.locator("#error").textContent(),
      /software.*adapter/i,
    );
  }

  console.log(
    "PASS: shader validation, two materials, rolling contact, finite nodes, positive determinants, reset, controls, export, adapter policy.",
  );
} finally {
  await browser.close();
}
