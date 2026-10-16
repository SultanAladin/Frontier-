import assert from "node:assert/strict";
import { launchTestBrowser } from "./browser-tools.mjs";
import { ASSET_RELEASE } from "./runtime-assets.js";
const browser = await launchTestBrowser();
try {
  const page = await browser.newPage();
  const url = process.env.TYRE_LAB_URL || "http://localhost:8080";
  await page.goto(url);
  await page.waitForFunction(() => tyreLab.ready || tyreLab.error);
  assert.equal(await page.evaluate(() => tyreLab.error), undefined);
  assert.equal(await page.evaluate(() => tyreLab.release), ASSET_RELEASE);
  const response = await page.request.get(new URL("physics.wgsl", url).href, {
    headers: { "If-Modified-Since": "Fri, 01 Jan 2100 00:00:00 GMT" },
  });
  assert.equal(response.status(), 200);
  assert.match(response.headers()["cache-control"], /no-store/);
  await page.route("**/physics.wgsl*", async (route) => {
    assert.equal(
      new URL(route.request().url()).searchParams.get("release"),
      ASSET_RELEASE,
    );
    const real = await route.fetch();
    const body = (await real.text()).replace(ASSET_RELEASE, "stale-release");
    await route.fulfill({ response: real, body });
  });
  await page.reload();
  await page.waitForFunction(() => tyreLab.error);
  assert.match(
    await page.locator("#error").textContent(),
    /Application\/shader version mismatch/,
  );
  assert(!(await page.evaluate(() => tyreLab.ready)));
  await page.unroute("**/physics.wgsl*");
  await page.reload();
  await page.waitForFunction(() => tyreLab.ready || tyreLab.error);
  assert.equal(await page.evaluate(() => tyreLab.error), undefined);
  console.log(
    "PASS: fresh startup, no-store headers, old-validator 200, release-keyed shader requests, mismatch rejection, same-browser reload recovery.",
  );
} finally {
  await browser.close();
}
