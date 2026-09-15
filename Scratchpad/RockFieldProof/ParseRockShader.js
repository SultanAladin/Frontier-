//============================================================================================================================================
// 📦 Frontier/Scratchpad/RockFieldProof/ParseRockShader.js — GLSL ES 3.00 Syntax Gate for the Shared Rock Kernel
//============================================================================================================================================
//
// Assembles exactly what the browser assembles — preview prelude + Shaders/RockFieldSpace.glsl + preview body — and
// parses it as GLSL ES 3.00. Catches C++ constructs that would compile on the host but fail in a shader.
//
//============================================================================================================================================

const fs = require("fs");
const path = require("path");

function LocateParser()
{
    const candidates = [
        path.join(__dirname, "../../node_modules/@shaderfrog/glsl-parser"),
        path.join(__dirname, "../../../node_modules/@shaderfrog/glsl-parser"),
        path.join(process.env.HOME || "", "node_modules/@shaderfrog/glsl-parser"),
        "@shaderfrog/glsl-parser"
    ];
    for (const candidate of candidates)
    {
        try
        {
            return require(candidate);
        }
        catch (error)
        {
            // try the next location
        }
    }
    throw new Error("@shaderfrog/glsl-parser is not installed.");
}

function ExtractTemplate(source, name)
{
    const match = new RegExp("const " + name + " = `([\\s\\S]*?)`;").exec(source);
    if (!match)
    {
        throw new Error(`Could not extract ${name} from the preview render sequence.`);
    }
    return match[1];
}

function Main()
{
    const repositoryRoot = path.join(__dirname, "../..");
    const kernelPath = path.join(repositoryRoot, "Shaders/RockFieldSpace.glsl");
    const previewPath = path.join(repositoryRoot, "Scratchpad/RockFieldPreview/RenderSequence.js");

    const kernel = fs.readFileSync(kernelPath, "utf8");
    const preview = fs.readFileSync(previewPath, "utf8");

    const assembled = ExtractTemplate(preview, "TRACE_PRELUDE")
                    + "\n" + kernel + "\n"
                    + ExtractTemplate(preview, "TRACE_BODY");

    const { parser } = LocateParser();

    // The parser reports built-in globals such as gl_FragCoord on stderr; those are not syntax errors.
    const suppressed = console.error;
    console.error = () => {};
    try
    {
        parser.parse(assembled);
    }
    finally
    {
        console.error = suppressed;
    }

    const lineCount = assembled.split("\n").length;
    console.log(`   ok — ${lineCount} lines parsed as GLSL ES 3.00`);
}

try
{
    Main();
}
catch (error)
{
    console.error(`   GLSL parse failure: ${error.message}`);
    process.exit(1);
}
