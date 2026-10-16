// Bump the release key AND the versioned module URLs when the JS/WGSL ABI changes.
export const ASSET_RELEASE = "tyre-gpu-20261016-r4";
export const COMPUTE_ENTRIES = Object.freeze([
  "predict",
  "solveEdges",
  "solveTets",
  "contact",
  "guardPartials",
  "guardReduce",
  "guardPrepare",
  "solveBarrier",
  "finish",
  "reducePartials",
  "reduce",
]);
export function verifyShaderSource(source, name) {
  if (!source.startsWith(`// tyre-lab-release: ${ASSET_RELEASE}\n`)) {
    throw new Error(
      `Application/shader version mismatch (${name}). Reload the preview with Ctrl+Shift+R. Expected ${ASSET_RELEASE}; no physics fallback was used.`,
    );
  }
  if (name === "physics.wgsl") {
    for (const entry of COMPUTE_ENTRIES) {
      if (!new RegExp(`\\bfn\\s+${entry}\\s*\\(`).test(source)) {
        throw new Error(
          `Application/shader version mismatch: ${name} is missing ${entry}. Reload the preview with Ctrl+Shift+R.`,
        );
      }
    }
  }
  return source;
}
let sharedTerrain;
async function fetchSource(name) {
  const url = new URL(name, import.meta.url);
  url.searchParams.set("release", ASSET_RELEASE);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok)
    throw new Error(`Cannot load ${name}: HTTP ${response.status}`);
  return verifyShaderSource(await response.text(), name);
}
export async function fetchShader(name) {
  const source = await fetchSource(name);
  if (name === "terrain.wgsl") return source;
  sharedTerrain ??= fetchSource("terrain.wgsl");
  return source + "\n" + (await sharedTerrain);
}
