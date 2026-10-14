import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import Path from "node:path";

const Folder = Path.dirname(fileURLToPath(import.meta.url));
await build({
    entryPoints: [Path.join(Folder, "TabletSequence.js")],
    outfile: Path.join(Folder, "TabletRuntime.js"),
    bundle: true,
    format: "esm",
    target: "es2022",
    minify: true,
    legalComments: "inline",
    sourcemap: false,
    logLevel: "info"
});
