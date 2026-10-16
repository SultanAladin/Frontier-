//============================================================================================================================================
//                                                           EXHIBITEXCHANGE.MJS
//============================================================================================================================================
// 🧩 Zero-dependency static file exchange for the exhibit: every request answered from this folder, never cached.

// 📝 Usage: node Experimental/IlluminationHost/ExhibitExchange.mjs [--port 8080] [--address 0.0.0.0]
//    The exhibit fetches its shaders and facet archives by relative URL, so it must be served over HTTP; a file://
//    page has no WebGPU secure context. Responses carry Cache-Control: no-store so an edited shader or module is
//    picked up by a plain reload.

import { createServer } from "node:http";
import { stat, readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ExhibitRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));

const ContentDescriptors = Object.freeze({
    ".html":  "text/html; charset=utf-8",
    ".js":    "text/javascript; charset=utf-8",
    ".mjs":   "text/javascript; charset=utf-8",
    ".wgsl":  "text/plain; charset=utf-8",
    ".css":   "text/css; charset=utf-8",
    ".json":  "application/json; charset=utf-8",
    ".md":    "text/markdown; charset=utf-8",
    ".png":   "image/png",
    ".jpg":   "image/jpeg",
    ".svg":   "image/svg+xml",
    ".facet": "application/octet-stream"
});

function ResolveArgument(Name, Fallback)
{
    const Position = process.argv.indexOf(`--${Name}`);
    return Position >= 0 && process.argv[Position + 1] ? process.argv[Position + 1] : Fallback;
}

const ListeningPort    = Number(ResolveArgument("port", process.env.PORT || 8080));
const ListeningAddress = ResolveArgument("address", "0.0.0.0");

// 📝 Maps a request path onto the exhibit folder and refuses anything that would leave it.
function ResolveRequestPath(RequestUrl)
{
    const Pathname = decodeURIComponent(new URL(RequestUrl, "http://exhibit").pathname);
    const Relative = normalize(Pathname === "/" ? "/index.html" : Pathname).replace(/^([/\\])+/, "");
    const Absolute = resolve(join(ExhibitRoot, Relative));
    if (Absolute !== ExhibitRoot && !Absolute.startsWith(ExhibitRoot + sep))
        return null;
    return Absolute;
}

const Exchange = createServer(async (Request, Response) =>
{
    const Headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    try
    {
        if (Request.method !== "GET" && Request.method !== "HEAD")
        {
            Response.writeHead(405, Headers).end();
            return;
        }
        let Absolute = ResolveRequestPath(Request.url);
        if (!Absolute)
        {
            Response.writeHead(403, Headers).end("Refused");
            return;
        }
        let Information = await stat(Absolute).catch(() => null);
        if (Information && Information.isDirectory())
        {
            Absolute = join(Absolute, "index.html");
            Information = await stat(Absolute).catch(() => null);
        }
        if (!Information || !Information.isFile())
        {
            Response.writeHead(404, { ...Headers, "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
            return;
        }
        const Content = await readFile(Absolute);
        Response.writeHead(200, { ...Headers, "Content-Type": ContentDescriptors[extname(Absolute).toLowerCase()] || "application/octet-stream",
                                  "Content-Length": Content.length });
        Response.end(Request.method === "HEAD" ? undefined : Content);
    }
    catch (Failure)
    {
        Response.writeHead(500, { ...Headers, "Content-Type": "text/plain; charset=utf-8" }).end(String(Failure));
    }
});

Exchange.listen(ListeningPort, ListeningAddress, () =>
{
    console.log(`IlluminationHost exhibit served from ${ExhibitRoot}`);
    console.log(`Listening on http://${ListeningAddress}:${ListeningPort}/`);
});
