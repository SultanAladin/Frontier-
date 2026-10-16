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
  for (const name of ["physics.wgsl", "render.wgsl", "terrain.wgsl"])
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

test("render and collision share terrain source and accepted material motion", async () => {
  const physics = await read("physics.wgsl"),
    render = await read("render.wgsl"),
    loader = await read("runtime-assets.js");
  assert(physics.includes("roadProfile("));
  assert(render.includes("roadProfile("));
  assert(loader.includes('fetchSource("terrain.wgsl")'));
  assert(!physics.includes("exp(-"));
  assert(!render.includes("v.y+=cam.options.w"));
  assert(render.includes("o.local=n.rest.xyz"));
  assert(render.includes("o.world=rimTransform(r)"));
  assert(physics.includes("r.x+u.speed*u.dt/.48"));
});
