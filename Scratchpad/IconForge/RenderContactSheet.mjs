//============================================================================================================================================
// 📦 Frontier/Scratchpad/IconForge/RenderContactSheet.mjs — Rasterised Contact Sheet for Visual Self-Review
//============================================================================================================================================

import fs from 'fs';
import path from 'path';
import { Resvg } from '@resvg/resvg-js';
import { GLYPHS, COLOUR_ROLES } from './FrontierGlyphs.mjs';

const OUT   = path.resolve('/home/user/Frontier-/Scratchpad/IconForge/proofs');
fs.mkdirSync(OUT, { recursive: true });

const CELL  = Number(process.env.CELL || 112);
const COLS  = Number(process.env.COLS || 10);
const LABEL = 16;

function layerMarkup(L, mode)
{
    const role   = L.role ? COLOUR_ROLES[L.role].hex : null;
    const colour = (mode === 'mono' || !role) ? '#E8EAED' : role;
    const attrs  = [
        `d="${L.d}"`,
        L.f ? `fill="${colour}"` : 'fill="none"',
        L.f ? 'stroke="none"' : `stroke="${colour}"`,
        L.w   ? `stroke-width="${L.w}"`      : '',
        L.cap ? `stroke-linecap="${L.cap}"`  : '',
        L.dash ? `stroke-dasharray="${L.dash}"` : '',
        (L.o !== undefined) ? `opacity="${L.o}"` : ''
    ].filter(Boolean).join(' ');
    return `<path ${attrs} />`;
}

export function glyphSvg(g, mode = 'multi', px = 24)
{
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" `
         + `fill="none" stroke-width="1.75" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="4">`
         + g.l.map(L => layerMarkup(L, mode)).join('')
         + `</svg>`;
}

//--------------------------------------------------------------------------------------------------------------------------
//                                                    SHEET COMPOSITOR
//--------------------------------------------------------------------------------------------------------------------------

function buildSheet(glyphs, mode, title)
{
    const rows = Math.ceil(glyphs.length / COLS);
    const W = COLS * CELL;
    const H = rows * (CELL + LABEL) + 34;

    let body = `<rect width="${W}" height="${H}" fill="#0A0A0B"/>`;
    body += `<text x="12" y="22" fill="#7A8290" font-family="monospace" font-size="14">${title}</text>`;

    glyphs.forEach((g, i) =>
    {
        const cx = (i % COLS) * CELL;
        const cy = Math.floor(i / COLS) * (CELL + LABEL) + 34;
        const pad = CELL * 0.18;
        const inner = CELL - pad * 2;

        body += `<rect x="${cx + 3}" y="${cy + 3}" width="${CELL - 6}" height="${CELL - 6}" fill="#141416" stroke="#232329"/>`;
        body += `<g transform="translate(${cx + pad},${cy + pad}) scale(${inner / 24})">`
              + g.l.map(L => layerMarkup(L, mode)).join('')
              + `</g>`;
        body += `<text x="${cx + CELL / 2}" y="${cy + CELL + 11}" fill="#6C7280" font-family="monospace" `
              + `font-size="9" text-anchor="middle">${g.id}</text>`;
    });

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" `
              + `fill="none" stroke-width="1.75" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="4">${body}</svg>`;
    return new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
}

//--------------------------------------------------------------------------------------------------------------------------
//                                                    SMALL-SIZE PROOF
//--------------------------------------------------------------------------------------------------------------------------

function buildLegibilitySheet(glyphs)
{
    const SIZES = [16, 20, 24, 32];
    const ROWH  = 46;
    const W     = 1180;
    const H     = glyphs.length * ROWH + 40;

    let body = `<rect width="${W}" height="${H}" fill="#0A0A0B"/>`;
    body += `<text x="12" y="24" fill="#7A8290" font-family="monospace" font-size="14">LEGIBILITY LADDER — 16 / 20 / 24 / 32 px (mono)</text>`;

    glyphs.forEach((g, i) =>
    {
        const y = 40 + i * ROWH;
        body += `<text x="12" y="${y + 26}" fill="#6C7280" font-family="monospace" font-size="11">${g.id}</text>`;
        let x = 230;
        for (const s of SIZES)
        {
            body += `<rect x="${x - 6}" y="${y + 4}" width="${s + 12}" height="${s + 12}" fill="#141416" stroke="#232329"/>`;
            body += `<g transform="translate(${x},${y + 10}) scale(${s / 24})">`
                  + g.l.map(L => layerMarkup(L, 'mono')).join('') + `</g>`;
            x += s + 46;
        }
        // Multicolour reference at 32 for comparison
        body += `<g transform="translate(${x + 40},${y + 6}) scale(${34 / 24})">`
              + g.l.map(L => layerMarkup(L, 'multi')).join('') + `</g>`;
        x += 120;
        // Inverted (light theme) check
        body += `<rect x="${x - 6}" y="${y + 4}" width="44" height="44" fill="#F1F5F9"/>`;
        body += `<g transform="translate(${x},${y + 10}) scale(${32 / 24})" color="#0F172A">`
              + g.l.map(L => layerMarkup({ ...L }, 'mono')).join('').replace(/#E8EAED/g, '#0F172A') + `</g>`;
    });

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" `
              + `fill="none" stroke-width="1.75" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="4">${body}</svg>`;
    return new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
}

//--------------------------------------------------------------------------------------------------------------------------

const which = process.argv[2] || 'all';

if (which === 'all' || which === 'sheet')
{
    const cats = [...new Set(GLYPHS.map(g => g.cat))];
    for (const c of cats)
    {
        const sub = GLYPHS.filter(g => g.cat === c);
        fs.writeFileSync(path.join(OUT, `sheet-${c}.png`), buildSheet(sub, 'multi', `${c.toUpperCase()} — ${sub.length} glyphs (multicolour)`));
        fs.writeFileSync(path.join(OUT, `sheet-${c}-mono.png`), buildSheet(sub, 'mono', `${c.toUpperCase()} — ${sub.length} glyphs (mono)`));
    }
    console.log('[proofs] category sheets written');
}

if (which === 'all' || which === 'ladder')
{
    const arg = process.argv[3];
    const sub = arg ? GLYPHS.filter(g => g.cat === arg || g.id === arg) : GLYPHS;
    fs.writeFileSync(path.join(OUT, `ladder${arg ? '-' + arg : ''}.png`), buildLegibilitySheet(sub));
    console.log('[proofs] legibility ladder written');
}
