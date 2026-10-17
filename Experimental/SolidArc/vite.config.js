import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { copyFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "native-proof-pages",
      configureServer(server) {
        const reports={"/proofs":"SolidArcBroadGeometryProof.html","/proofs/broad-geometry":"SolidArcBroadGeometryProof.html","/proofs/cylinder-sphere-bevel":"SolidArcCylinderSphereBevelProof.html","/proofs/booleans3d":"SolidArcBooleans3DProof.html","/proofs/booleans2d":"SolidArcBooleans2DProof.html"};
        server.middlewares.use((req,res,next)=>{
          const name=reports[req.url?.split("?")[0]];if(!name)return next();
          const path=fileURLToPath(new URL(`../../Exhibits/Gallery/Editor/${name}`,import.meta.url));
          res.setHeader("Content-Type","text/html; charset=utf-8");
          res.statusCode=existsSync(path)?200:404;
          res.end(existsSync(path)?readFileSync(path):"<h1>Proof not generated</h1><p>Run the corresponding Tools/Build proof generator. This is not an editor session.</p>");
        });
      },
    },
    {
      name: "runtime-license-copy",
      closeBundle() {
        const Output = fileURLToPath(
          new URL("./dist/Notices/", import.meta.url),
        );
        mkdirSync(Output, { recursive: true });
        for (const Name of ["EmscriptenLicense.txt", "LibcxxLicense.txt"])
          copyFileSync(
            fileURLToPath(new URL(`./Runtime/${Name}`, import.meta.url)),
            `${Output}/${Name}`,
          );
      },
    },
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    headers: { "Cache-Control": "no-store" },
    proxy: { "/native": { target: process.env.SOLIDARC_GEOMETRY_URL || "http://127.0.0.1:8081", changeOrigin: false } },
    allowedHosts: true,
    fs: {
      allow: [
        fileURLToPath(new URL("../..", import.meta.url)),
        fileURLToPath(
          new URL("../../EngineContent/Fonts/SunReference", import.meta.url),
        ),
      ],
    },
  },
  worker: { format: "es" },
  build: { assetsInlineLimit: 0 },
  preview: { host: "0.0.0.0", port: 5173, allowedHosts: true },
});
