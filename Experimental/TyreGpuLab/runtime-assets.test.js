import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ASSET_RELEASE,
  COMPUTE_ENTRIES,
  verifyShaderSource,
} from "./runtime-assets.js";
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
test("release markers and pipeline entries match current WGSL", async () => {
  for (const name of ["physics.wgsl", "render.wgsl"])
    assert.equal(verifyShaderSource(await read(name), name), await read(name));
  assert(!COMPUTE_ENTRIES.includes("clearLambda"));
});
test("mixed/stale shader and missing entry fail before pipeline creation", async () => {
  const code = await read("physics.wgsl");
  assert.throws(
    () =>
      verifyShaderSource(
        code.replace(ASSET_RELEASE, "old-release"),
        "physics.wgsl",
      ),
    /version mismatch/,
  );
  assert.throws(
    () =>
      verifyShaderSource(
        code.replace("fn guardPartials(", "fn removedGuard("),
        "physics.wgsl",
      ),
    /missing guardPartials/,
  );
});
test("document and runtime dependency URLs carry the same release key", async () => {
  const html = await read("index.html");
  assert(html.includes(`app.js?release=${ASSET_RELEASE}`));
  assert(html.includes(`style.css?release=${ASSET_RELEASE}`));
  const app = await read("app.js");
  for (const file of ["mesh.js", "solver-plan.js", "runtime-assets.js"])
    assert(app.includes(`${file}?release=${ASSET_RELEASE}`));
});
