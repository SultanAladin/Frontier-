//============================================================================================================================================
//                                                          VALIDATESHADERS.MJS
//============================================================================================================================================
// 🧩 Compiles every WGSL program module exactly as the exhibit assembles it — includes expanded, host constants
//    injected — on Dawn's null backend, so a shader error is caught without a browser or a GPU.
//
// 📝 Usage (the `webgpu` package is Dawn's Node binding; it is a test-only dependency, never imported by the
//    exhibit itself):
//        cd Experimental/IlluminationHost/Tests && npm install --no-save webgpu && node ValidateShaders.mjs
//    Without the package the check reports itself skipped. With it, any compilation error names the authored
//    file and line, through ShaderInterchange's own origin mapping.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let create;
try
{
    ({ create } = await import("webgpu"));
}
catch
{
    console.log("SKIP  webgpu package not installed — run: npm install --no-save webgpu (in Tests/)");
    process.exit(0);
}

const Root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { ShaderInterchange } = await import(join(Root, "Source", "ShaderInterchange.js"));

const gpu = create(["backend=null"]);
const adapter = await gpu.requestAdapter();
if (!adapter)
{
    console.log("SKIP  no null-backend adapter available");
    process.exit(0);
}
const device = await adapter.requestDevice();

// 📝 The host's injected constants (IlluminationHost.ConstructExhibit), with stand-in values of the right types.
const HostConstants = {
    MaximumTraversalSteps: { Type: "u32", Value: 96 },
    GroundPadMinimum:      { Type: "f32", Value: -60.0 },
    GroundTileExtent:      { Type: "f32", Value: 12.0 },
    GroundTileCount:       { Type: "u32", Value: 100 },
    GroundFirstCard:       { Type: "u32", Value: 0 },
    GroundStripCard:       { Type: "u32", Value: 0 },
    GroundFamilyFirst:     { Type: "u32", Value: 21 },
    GroundFamilyLast:      { Type: "u32", Value: 24 },
    PaintFamilyFirst:      { Type: "u32", Value: 23 },
    MarkMinimum:           { Type: "f32", Value: -60.0 },
    MarkExtent:            { Type: "f32", Value: 120.0 },
    WheelOccupantFirst:    { Type: "u32", Value: 1 },
    GlassOccupant:         { Type: "u32", Value: 999 }
};

const Interchange = new ShaderInterchange({ Device: device }, "Shader");
for (const File of readdirSync(join(Root, "Shader")).filter((Name) => Name.endsWith(".wgsl")))
    Interchange.Sources.set(File, readFileSync(join(Root, "Shader", File), "utf8"));

// 📝 Every file a Construct*Program call names. Include-only files (FrameDescriptor, PackingCodec, SceneRecords,
//    DistanceRecords, ReservoirRecords, PlumeRecords, TyreCarcass) compile through their includers.
const EntryFiles = ["AtmosphereScattering.wgsl", "CardCapture.wgsl", "CardDirect.wgsl", "CardFinal.wgsl",
    "CardIrradiance.wgsl", "CardProjection.wgsl", "CardRadiosity.wgsl", "DirectRadiance.wgsl", "DiscrepancySequence.wgsl",
    "DisplayAntialias.wgsl", "DisplayExposure.wgsl", "DisplayPresent.wgsl", "DisplayRecombination.wgsl",
    "DistanceTransfer.wgsl", "DistanceTraversal.wgsl", "DistanceUnion.wgsl", "EmberAdvection.wgsl", "EmberRaster.wgsl",
    "InspectionMarch.wgsl", "PlumeAdvection.wgsl", "PlumeMarch.wgsl", "PlumePressure.wgsl", "PlumeVorticity.wgsl",
    "ReflectionTraversal.wgsl", "ReservoirSpatial.wgsl", "ReservoirTemporal.wgsl", "ShadowRaster.wgsl", "SkyProjection.wgsl",
    "SurfaceRaster.wgsl", "SurfaceReflectance.wgsl", "VarianceTemporal.wgsl", "VarianceUpsample.wgsl", "VarianceWavelet.wgsl"];

let Failures = 0;
for (const File of EntryFiles)
{
    try
    {
        await Interchange.ConstructModule(File, HostConstants, File);
        console.log(`OK    ${File}`);
    }
    catch (Failure)
    {
        ++Failures;
        console.log(`FAIL  ${File}: ${Failure.message}`);
    }
}
console.log(Failures === 0 ? "\nall shader modules compile" : `\n${Failures} shader module(s) failed`);
process.exit(Failures === 0 ? 0 : 1);
