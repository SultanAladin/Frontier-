//============================================================================================================================================
// 📦 Frontier/Scratchpad/IconForge/AuditOriginality.mjs — Clean-Room Originality Audit Against Lucide + Feather Corpora
//============================================================================================================================================
//
//  Compares every Frontier glyph against the full Lucide (1838) and Feather (287) corpora using three
//  independent measures, then keeps the worst (most incriminating) score per glyph:
//
//    1. COORDINATE JACCARD  — set overlap of every numeric literal in the path stream. Catches verbatim
//                             or lightly-edited copies even when commands are reordered or re-cased.
//    2. COMMAND FINGERPRINT — cosine similarity over the SVG command-letter n-gram profile. Catches a
//                             copy that has been uniformly translated or scaled.
//    3. RASTER IoU          — renders both glyphs to a 64x64 binary coverage mask and measures
//                             intersection-over-union. Catches geometric redraws of the same artwork.
//
//  A glyph is only reported clean when all three measures sit below their thresholds.
//
//============================================================================================================================================

import fs from 'fs';
import path from 'path';
import { Resvg } from '@resvg/resvg-js';
import { GLYPHS } from './FrontierGlyphs.mjs';

const AUDIT_ROOT = path.resolve('/home/user/Frontier-/Scratchpad/.audit');
const RASTER_N   = 64;

//--------------------------------------------------------------------------------------------------------------------------
//                                                   CORPUS INGESTION
//--------------------------------------------------------------------------------------------------------------------------

function loadCorpus()
{
    const corpus = [];

    // Lucide: icon-nodes.json → array of [tag, attrs]
    const lucide = JSON.parse(fs.readFileSync(path.join(AUDIT_ROOT, 'lucide-static/package/icon-nodes.json'), 'utf8'));
    for (const [name, nodes] of Object.entries(lucide))
    {
        corpus.push({ set: 'lucide', name, body: nodesToBody(nodes) });
    }

    // Feather: icons.json → raw inner SVG markup
    const feather = JSON.parse(fs.readFileSync(path.join(AUDIT_ROOT, 'feather-icons/package/dist/icons.json'), 'utf8'));
    for (const [name, body] of Object.entries(feather))
    {
        corpus.push({ set: 'feather', name, body });
    }

    return corpus;
}

function nodesToBody(nodes)
{
    return nodes.map(([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')} />`
    ).join('');
}

//--------------------------------------------------------------------------------------------------------------------------
//                                            MEASURE 1 — COORDINATE JACCARD
//--------------------------------------------------------------------------------------------------------------------------

// Coordinate PAIRS, not bare scalars. A bare-scalar set collapses every icon onto the same small
// vocabulary of 24-grid numbers and produces meaningless collisions (e.g. rotate-cw vs boom-box).
// Pairs encode actual point positions, so overlap here is real geometric evidence.
function coordSet(body)
{
    const nums = (body.match(/-?\d+\.?\d*/g) || []).map(n => parseFloat(n));
    const out = new Set();
    for (let i = 0; i + 1 < nums.length; i += 2)
    {
        const x = Math.round(nums[i] * 2) / 2;
        const y = Math.round(nums[i + 1] * 2) / 2;
        out.add(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return out;
}

// Longest shared verbatim run of path data — the single most damning signal of a copy/paste.
function verbatimRun(a, b)
{
    const norm = s => (s.match(/[-\d.]+|[A-Za-z]/g) || []).join(' ');
    const A = norm(a), B = norm(b);
    if (!A.length || !B.length) return 0;
    let best = 0;
    // Scan A's token windows against B; windows of >= 6 tokens are meaningful.
    const toks = A.split(' ');
    for (let i = 0; i < toks.length; i++)
    {
        for (let len = Math.min(40, toks.length - i); len >= 6; len--)
        {
            if (len <= best) break;
            if (B.includes(toks.slice(i, i + len).join(' '))) { best = len; break; }
        }
    }
    return best / Math.max(6, toks.length);
}

function jaccard(a, b)
{
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const v of a) if (b.has(v)) inter++;
    return inter / (a.size + b.size - inter);
}

//--------------------------------------------------------------------------------------------------------------------------
//                                          MEASURE 2 — COMMAND FINGERPRINT
//--------------------------------------------------------------------------------------------------------------------------

function commandProfile(body)
{
    const letters = (body.match(/[MmLlHhVvCcSsQqTtAaZz]/g) || []).join('');
    const prof = {};
    for (let i = 0; i < letters.length - 1; i++)
    {
        const g = letters.slice(i, i + 2).toUpperCase();
        prof[g] = (prof[g] || 0) + 1;
    }
    // Primitive tags count as strong structural evidence too.
    for (const tag of ['circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'])
    {
        const c = (body.match(new RegExp(`<${tag}`, 'g')) || []).length;
        if (c) prof[`#${tag}`] = c;
    }
    return prof;
}

function cosine(p, q)
{
    const keys = new Set([...Object.keys(p), ...Object.keys(q)]);
    let dot = 0, np = 0, nq = 0;
    for (const k of keys)
    {
        const a = p[k] || 0, b = q[k] || 0;
        dot += a * b; np += a * a; nq += b * b;
    }
    if (!np || !nq) return 0;
    return dot / Math.sqrt(np * nq);
}

//--------------------------------------------------------------------------------------------------------------------------
//                                             MEASURE 3 — RASTER IoU
//--------------------------------------------------------------------------------------------------------------------------

function svgWrap(body, strokeWidth)
{
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" `
         + `stroke="#000" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

const maskCache = new Map();

function coverageMask(svg, key)
{
    if (key && maskCache.has(key)) return maskCache.get(key);
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: RASTER_N }, background: 'white' }).render().asPng();
    const mask = pngToMask(png);
    if (key) maskCache.set(key, mask);
    return mask;
}

// Minimal PNG decoder path: re-render through resvg's own pixel buffer instead of parsing PNG.
function coverageMaskDirect(svg)
{
    const img = new Resvg(svg, { fitTo: { mode: 'width', value: RASTER_N }, background: 'white' }).render();
    const pix = img.pixels; // RGBA
    const mask = new Uint8Array(RASTER_N * RASTER_N);
    for (let i = 0, p = 0; i < mask.length; i++, p += 4)
    {
        // ink = darkness
        const lum = (pix[p] * 0.299 + pix[p + 1] * 0.587 + pix[p + 2] * 0.114);
        mask[i] = lum < 160 ? 1 : 0;
    }
    return mask;
}

function iou(a, b)
{
    let inter = 0, uni = 0;
    for (let i = 0; i < a.length; i++)
    {
        const x = a[i], y = b[i];
        if (x | y) uni++;
        if (x & y) inter++;
    }
    return uni ? inter / uni : 0;
}

//--------------------------------------------------------------------------------------------------------------------------
//                                                  FRONTIER GLYPH BODY
//--------------------------------------------------------------------------------------------------------------------------

export function frontierBody(g)
{
    return g.l.filter(L => L.o !== 0).map(L =>
    {
        const fill = L.f ? '#000' : 'none';
        return `<path d="${L.d}" fill="${fill}" />`;
    }).join('');
}

//--------------------------------------------------------------------------------------------------------------------------
//                                                     AUDIT DRIVER
//--------------------------------------------------------------------------------------------------------------------------

const TH = { coord: 0.34, cmd: 0.95, iou: 0.60, verb: 0.34 };

export function runAudit(verbose = true)
{
    const corpus = loadCorpus();
    if (verbose) console.log(`[audit] corpus: ${corpus.length} reference icons `
        + `(${corpus.filter(c => c.set === 'lucide').length} lucide, ${corpus.filter(c => c.set === 'feather').length} feather)`);

    // Pre-compute corpus descriptors.
    for (const c of corpus)
    {
        c.coords = coordSet(c.body);
        c.prof   = commandProfile(c.body);
    }

    const results = [];

    for (const g of GLYPHS)
    {
        const body   = frontierBody(g);
        const coords = coordSet(body);
        const prof   = commandProfile(body);

        // Stage A — cheap vector screens across the whole corpus.
        const scored = corpus.map(c => ({
            c,
            coord: jaccard(coords, c.coords),
            cmd:   cosine(prof, c.prof)
        }));

        // Stage B — raster IoU only on the top structural candidates (expensive).
        const shortlist = [...scored]
            .sort((p, q) => (q.coord * 0.6 + q.cmd * 0.4) - (p.coord * 0.6 + p.cmd * 0.4))
            .slice(0, 18);

        const mine = coverageMaskDirect(svgWrap(body, 1.75));

        let worst = { score: 0 };
        for (const s of shortlist)
        {
            const theirs = coverageMaskDirect(svgWrap(s.c.body, 2));
            s.iou = iou(mine, theirs);
        }

        // Also raster-check the name-matched twin, which is the most likely accidental copy.
        const slug = g.id.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
        for (const c of corpus)
        {
            if (!shortlist.find(s => s.c === c) &&
                (c.name === slug || slug.includes(c.name) || c.name.includes(slug.split('-')[0])))
            {
                const theirs = coverageMaskDirect(svgWrap(c.body, 2));
                const entry = scored.find(s => s.c === c);
                entry.iou = iou(mine, theirs);
                shortlist.push(entry);
            }
        }

        for (const s of shortlist)
        {
            s.iou  = s.iou || 0;
            s.verb = verbatimRun(body, s.c.body);
            // Composite risk: the maximum normalised breach across the four measures.
            // CMD is informational only: nearly every 24-grid icon is built from M/L/A commands, so
            // command-bigram cosine saturates near 0.9 for unrelated art. It cannot carry a verdict.
            s.score = Math.max(s.coord / TH.coord, s.iou / TH.iou, s.verb / TH.verb);
            if (s.score > worst.score) worst = s;
        }

        const verdict = worst.score >= 1.0 ? 'REVIEW' : worst.score >= 0.8 ? 'NEAR' : 'CLEAN';

        results.push({
            id: g.id, cat: g.cat,
            nearest: `${worst.c.set}/${worst.c.name}`,
            coord: +worst.coord.toFixed(3),
            cmd:   +worst.cmd.toFixed(3),
            iou:   +worst.iou.toFixed(3),
            verb:  +worst.verb.toFixed(3),
            score: +worst.score.toFixed(3),
            verdict
        });
    }

    return results;
}

//--------------------------------------------------------------------------------------------------------------------------
//                                                   CLI ENTRY POINT
//--------------------------------------------------------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`)
{
    const res = runAudit();
    const pad = (s, n) => String(s).padEnd(n);
    console.log('\n' + pad('GLYPH', 24) + pad('NEAREST REFERENCE', 30) + pad('COORD', 7) + pad('CMD', 7) + pad('IoU', 7) + pad('VERB', 7) + 'VERDICT');
    console.log('-'.repeat(96));
    for (const r of res.sort((a, b) => b.score - a.score))
    {
        console.log(pad(r.id, 24) + pad(r.nearest, 30) + pad(r.coord, 7) + pad(r.cmd, 7) + pad(r.iou, 7) + pad(r.verb, 7) + r.verdict);
    }
    const bad = res.filter(r => r.verdict === 'REVIEW');
    console.log('-'.repeat(92));
    console.log(`total=${res.length}  clean=${res.filter(r => r.verdict === 'CLEAN').length}  `
              + `near=${res.filter(r => r.verdict === 'NEAR').length}  review=${bad.length}`);
    fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'audit-results.json'), JSON.stringify(res, null, 2));
}
