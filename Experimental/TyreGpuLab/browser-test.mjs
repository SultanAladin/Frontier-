// Optional end-to-end test. Start the lab separately, then npm run test:gpu.
// PLAYWRIGHT_MODULE can point to an existing Playwright installation.
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const args = JSON.parse(process.env.CHROMIUM_ARGS || "[]");
const browser = await chromium.launch({
  headless: true,
  args,
  ...(process.env.CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
    : {}),
  ...(process.env.CHROMIUM_IGNORE_DEFAULTS === "1"
    ? { ignoreDefaultArgs: true }
    : {}),
});
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
      return {
        adapter: tyreLab.adapter,
        stats: tyreLab.stats,
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
    assert(sample.stats.minJ > 0);
    assert(sample.maxPosition < 2);
  }
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
