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
      const rig = await tyreLab.rigSnapshot();
      return {
        rig,
        snapshotMinJ,
        markerPosition: Array.from(a.slice(139 * 20, 139 * 20 + 3)),
        markerRest: Array.from(a.slice(139 * 20 + 12, 139 * 20 + 15)),
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
    assert(sample.minY >= -0.035 - 1e-5);
    assert(sample.stats && sample.stats.normal > 0);
    assert(sample.stats.minJ >= 0.099);
    assert(sample.snapshotMinJ >= 0.099);
    assert(sample.maxPosition < 2);
    return sample;
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
  const parked = await run("Parked rounded cleat / actual height", 70);
  assert(parked.rig[2] > 0.035);
  assert(parked.stats.normal > 500);
  await page.locator("#speed").evaluate((el) => {
    el.value = "1";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const rolling = await run("Corotated rolling + moving cleat / 60 ticks", 60);
  assert(
    Math.abs(rolling.rig[0] - parked.rig[0]) > 0.2,
    "accepted tyre must rotate",
  );
  assert(
    Math.abs(rolling.rig[3] - parked.rig[3]) > 0.2,
    "cleat and belt phase must advance",
  );
  assert.deepEqual(
    rolling.markerRest,
    parked.markerRest,
    "material coordinates must not be animated independently",
  );
  assert(
    Math.hypot(
      ...rolling.markerPosition.map((v, i) => v - parked.markerPosition[i]),
    ) > 0.1,
    "solved material marker must travel in world space",
  );
  await page.click("#flat");
  const flat = await run("Return to flat moving belt", 60);
  assert(flat.rig[2] < 0.001);
  assert(flat.stats.actualBeltSpeed > 0.2);
  await page.click("#cleat");
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
  await page.uncheck("#adaptive");
  await page.evaluate(() => {
    Object.assign(tyreLab.state, {
      compression: 95,
      speed: 5,
      stiffness: 0.25,
      friction: 0.45,
      obstacle: 0.045,
    });
    tyreLab.reset();
  });
  await page.waitForFunction(() => tyreLab.ticks === 0);
  const exact = await run("Fresh max-input 95 mm / 5 m/s / soft cleat", 120);
  assert(
    Math.abs(exact.rig[0]) > 0.05 || Math.abs(exact.rig[3]) > 0.05,
    "accepted rig must not remain at initial pose",
  );
  const roadCases = await page.evaluate(async () => {
    const { runRoadCases } = await import("./road-browser.js");
    return runRoadCases();
  });
  assert(Math.abs(roadCases[0].height) < 1e-6);
  assert(Math.abs(roadCases[1].height - 0.045) < 1e-6);
  assert(Math.abs(roadCases[2].height - 0.045) < 1e-6);
  assert(Math.abs(roadCases[5].height - 0.045) < 1e-6);
  assert(roadCases[3].dx < -0.3);
  assert(Math.abs(roadCases[4].height + 0.035) < 1e-6);
  for (const c of roadCases)
    assert(Math.abs(Math.hypot(...c.normal) - 1) < 1e-6);
  console.log("Shared GPU road profile", JSON.stringify(roadCases));
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
  const reductions = await page.evaluate(async () => {
    const { runReductionCases } = await import("./reduction-browser.js");
    return runReductionCases();
  });
  for (const c of reductions) {
    assert.equal(c.reducedSafe, c.safe);
    assert.equal(c.preparedSafe, c.safe);
    assert.equal(c.reducedJ, c.j);
    assert.equal(c.preparedJ, c.j);
    assert.equal(c.active, c.j < 0.3);
    assert.deepEqual(
      c.groups,
      c.j < 0.3
        ? [...Array.from({ length: 24 }, (_, i) => 3 + (i % 4)), 1, 108, 1]
        : Array(27).fill(0),
    );
    assert(c.yz.every(([y, z]) => y === 1 && z === 1));
  }
  console.log("Parallel guard/indirect tail cases", JSON.stringify(reductions));
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
