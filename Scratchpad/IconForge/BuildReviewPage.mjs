//============================================================================================================================================
// 📦 Frontier/Scratchpad/IconForge/BuildReviewPage.mjs — Generates the Standalone Icon Review & Triage Page
//============================================================================================================================================

import fs from 'fs';
import path from 'path';
import { GLYPHS, COLOUR_ROLES, CATEGORIES } from './FrontierGlyphs.mjs';
import { runAudit } from './AuditOriginality.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT  = path.resolve(HERE, '../../docs/IconReview.html');
const CMP  = path.resolve(HERE, 'proofs/ComparisonCorpus.js');

//--------------------------------------------------------------------------------------------------------------------------
//                                             OPTIONAL SIDE-BY-SIDE CORPUS
//--------------------------------------------------------------------------------------------------------------------------
//  Reference artwork (Lucide ISC / Feather MIT) is emitted to a SEPARATE, git-ignored file so that the
//  committed review page carries no third-party path data. If the file is present the page lights up a
//  side-by-side comparison; if it is absent the page degrades gracefully to score-only.
//--------------------------------------------------------------------------------------------------------------------------

function emitComparisonCorpus(audit)
{
    const AUDIT_ROOT = path.resolve('/home/user/Frontier-/Scratchpad/.audit');
    let lucide = {}, feather = {};
    try
    {
        lucide  = JSON.parse(fs.readFileSync(path.join(AUDIT_ROOT, 'lucide-static/package/icon-nodes.json'), 'utf8'));
        feather = JSON.parse(fs.readFileSync(path.join(AUDIT_ROOT, 'feather-icons/package/dist/icons.json'), 'utf8'));
    }
    catch { console.log('[cmp] corpora absent — skipping comparison payload'); return false; }

    const wanted = {};
    for (const a of audit)
    {
        const [set, name] = a.nearest.split('/');
        if (set === 'lucide' && lucide[name])
        {
            wanted[a.nearest] = lucide[name].map(([tag, at]) =>
                `<${tag} ${Object.entries(at).map(([k, v]) => `${k}="${v}"`).join(' ')} />`).join('');
        }
        else if (set === 'feather' && feather[name])
        {
            wanted[a.nearest] = feather[name];
        }
    }

    fs.mkdirSync(path.dirname(CMP), { recursive: true });
    fs.writeFileSync(CMP,
        '// GENERATED — reference artwork for local visual comparison only. NOT COMMITTED.\n' +
        '// Lucide icons: ISC © Lucide Contributors.  Feather icons: MIT © Cole Bemis 2013-2023.\n' +
        'window.FRONTIER_COMPARISON = ' + JSON.stringify(wanted, null, 0) + ';\n');
    console.log(`[cmp] wrote ${Object.keys(wanted).length} reference glyphs to ${path.relative(process.cwd(), CMP)}`);
    return true;
}

//--------------------------------------------------------------------------------------------------------------------------
//                                                   THEME TOKENS
//--------------------------------------------------------------------------------------------------------------------------

const THEMES = {
    Oled:    { main:'#000000', panel:'#0A0A0A', card:'#141415', sub:'#1C1C1E', text:'#F2F2F2', muted:'#666666', border:'rgba(255,255,255,.08)' },
    Dark:    { main:'#111111', panel:'#1A1A1A', card:'#222225', sub:'#2C2C30', text:'#E6E6E6', muted:'#808080', border:'rgba(255,255,255,.09)' },
    Dim:     { main:'#0F172A', panel:'#1E293B', card:'#283548', sub:'#334155', text:'#F1F5F9', muted:'#94A3B8', border:'rgba(148,163,184,.25)' },
    Light:   { main:'#F1F5F9', panel:'#FFFFFF', card:'#F8FAFC', sub:'#E2E8F0', text:'#0F172A', muted:'#64748B', border:'#E2E8F0' },
    Sepia:   { main:'#EADDCF', panel:'#F4EBE1', card:'#FAEED9', sub:'#EEDCC3', text:'#5C4B3A', muted:'#8C7A6B', border:'#D8C3B0' },
    Dracula: { main:'#282A36', panel:'#44475A', card:'#383A59', sub:'#6272A4', text:'#F8F8F2', muted:'#6272A4', border:'rgba(98,114,164,.4)' },
    Nord:    { main:'#2E3440', panel:'#3B4252', card:'#434C5E', sub:'#4C566A', text:'#ECEFF4', muted:'#D8DEE9', border:'#4C566A' },
    GitHub:  { main:'#0D1117', panel:'#161B22', card:'#21262D', sub:'#30363D', text:'#C9D1D9', muted:'#8B949E', border:'#30363D' }
};

const ACCENTS = { White:'#FFFFFF', Orange:'#F97316', Amber:'#F59E0B', Lime:'#84CC16', Emerald:'#10B981',
                  Cyan:'#06B6D4', Blue:'#3B82F6', Violet:'#8B5CF6', Fuchsia:'#D946EF', Rose:'#F43F5E' };

//--------------------------------------------------------------------------------------------------------------------------
//                                                    PAGE ASSEMBLY
//--------------------------------------------------------------------------------------------------------------------------

const audit = runAudit(false);
const hasCmp = emitComparisonCorpus(audit);
const auditBy = Object.fromEntries(audit.map(a => [a.id, a]));

const payload = GLYPHS.map(g => ({
    id: g.id, name: g.name, cat: g.cat, kw: g.kw, note: g.note, l: g.l,
    audit: auditBy[g.id] || null
}));

const stats = {
    total:  payload.length,
    clean:  audit.filter(a => a.verdict === 'CLEAN').length,
    near:   audit.filter(a => a.verdict === 'NEAR').length,
    review: audit.filter(a => a.verdict === 'REVIEW').length
};

const html = `<!DOCTYPE html>
<!--========================================================================================================================================-->
<!-- 📦 Frontier/docs/IconReview.html — Frontier Draughting Icon Set: Review, Triage and Originality Audit Surface                          -->
<!--                                                                                                                                        -->
<!-- GENERATED by Scratchpad/IconForge/BuildReviewPage.mjs — do not hand-edit. Re-run the generator instead.                                -->
<!--========================================================================================================================================-->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Frontier Draughting — Editor Icon Set Review</title>
<style>
:root{
  --main:${THEMES.Oled.main}; --panel:${THEMES.Oled.panel}; --card:${THEMES.Oled.card};
  --sub:${THEMES.Oled.sub}; --text:${THEMES.Oled.text}; --muted:${THEMES.Oled.muted};
  --border:${THEMES.Oled.border}; --accent:${ACCENTS.Blue};
  --ok:#10B981; --warn:#F59E0B; --bad:#F43F5E;
  --size:52px; --radius:14px;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--main);color:var(--text);
  font-family:"Inter","General Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
code,kbd{font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace}

/* ---------- top bar ---------- */
header{position:sticky;top:0;z-index:50;background:var(--panel);
  border-bottom:1px solid var(--border);backdrop-filter:blur(12px)}
.bar{max-width:1680px;margin:0 auto;padding:14px 22px}
.row{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
h1{font-size:17px;font-weight:650;margin:0;letter-spacing:-.01em}
h1 .dim{color:var(--muted);font-weight:400}
.pill{font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid var(--border);
  color:var(--muted);white-space:nowrap}
.pill.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent)}
.pill.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,transparent)}
.pill.bad{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 40%,transparent)}
.spacer{flex:1}
input[type=search],select{background:var(--card);color:var(--text);border:1px solid var(--border);
  border-radius:9px;padding:7px 11px;font-size:13px;font-family:inherit;outline:none}
input[type=search]{min-width:230px}
input[type=search]:focus,select:focus{border-color:var(--accent)}
label.ctl{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted);white-space:nowrap}
input[type=range]{accent-color:var(--accent);width:112px}
.seg{display:flex;border:1px solid var(--border);border-radius:9px;overflow:hidden}
.seg button{background:transparent;color:var(--muted);border:0;padding:7px 13px;font-size:12px;
  cursor:pointer;font-family:inherit;transition:.12s}
.seg button:hover{color:var(--text)}
.seg button[aria-pressed=true]{background:var(--accent);color:#fff}
button.act{background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:9px;
  padding:7px 13px;font-size:12px;cursor:pointer;font-family:inherit;transition:.12s}
button.act:hover{border-color:var(--accent)}

/* ---------- layout ---------- */
main{max-width:1680px;margin:0 auto;padding:22px}
section{margin-bottom:34px;scroll-margin-top:120px}
.sechead{display:flex;align-items:baseline;gap:12px;margin:0 0 4px}
.sechead h2{font-size:15px;font-weight:620;margin:0;letter-spacing:-.01em}
.sechead .cnt{font-size:11px;color:var(--muted)}
.blurb{color:var(--muted);font-size:12.5px;margin:0 0 14px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(184px,1fr))}

/* ---------- card ---------- */
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);
  padding:13px 12px 11px;display:flex;flex-direction:column;gap:9px;position:relative;transition:.14s}
.card:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--border))}
.card[data-mark=keep]{border-color:var(--ok);box-shadow:0 0 0 1px color-mix(in srgb,var(--ok) 35%,transparent)}
.card[data-mark=fix]{border-color:var(--warn);box-shadow:0 0 0 1px color-mix(in srgb,var(--warn) 35%,transparent)}
.card[data-mark=drop]{border-color:var(--bad);opacity:.55}
.card[data-mark=copy]{border-color:var(--bad);box-shadow:0 0 0 1px color-mix(in srgb,var(--bad) 45%,transparent)}
.art{height:104px;display:flex;align-items:center;justify-content:center;
  background:var(--sub);border-radius:10px;position:relative;overflow:hidden}
.art svg{display:block}
.vbadge{position:absolute;top:6px;right:7px;font-size:9px;letter-spacing:.04em;padding:2px 6px;
  border-radius:5px;font-family:ui-monospace,monospace;cursor:help}
.vbadge.CLEAN{background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok)}
.vbadge.NEAR{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}
.vbadge.REVIEW{background:color-mix(in srgb,var(--bad) 20%,transparent);color:var(--bad)}
.nm{font-size:12.5px;font-weight:560;letter-spacing:-.005em;word-break:break-word}
.meta{font-size:10.5px;color:var(--muted);font-family:ui-monospace,monospace}
.note{font-size:11px;color:var(--muted);line-height:1.45;display:none}
body.shownotes .note{display:block}
.marks{display:flex;gap:4px}
.marks button{flex:1;background:var(--sub);border:1px solid transparent;color:var(--muted);
  border-radius:7px;padding:5px 0;font-size:14px;cursor:pointer;line-height:1;transition:.12s}
.marks button:hover{color:var(--text);border-color:var(--border)}
.marks button[aria-pressed=true]{background:var(--accent);color:#fff}
.marks button[data-m=fix][aria-pressed=true]{background:var(--warn)}
.marks button[data-m=drop][aria-pressed=true],
.marks button[data-m=copy][aria-pressed=true]{background:var(--bad)}
.tools{display:flex;gap:4px}
.tools button{flex:1;background:transparent;border:1px solid var(--border);color:var(--muted);
  border-radius:7px;padding:4px 0;font-size:10px;cursor:pointer;font-family:inherit;transition:.12s}
.tools button:hover{color:var(--text);border-color:var(--accent)}

/* ---------- compare drawer ---------- */
.cmp{display:none;gap:8px;align-items:center;background:var(--sub);border-radius:9px;padding:8px}
body.showcmp .cmp{display:flex}
.cmp .half{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px}
.cmp .lbl{font-size:9px;color:var(--muted);font-family:ui-monospace,monospace;text-align:center;line-height:1.3}
.cmp .vs{font-size:9px;color:var(--muted)}

/* ---------- drawer / export ---------- */
dialog{background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:16px;
  padding:0;max-width:900px;width:92vw;box-shadow:0 24px 70px rgba(0,0,0,.6)}
dialog::backdrop{background:rgba(0,0,0,.66);backdrop-filter:blur(3px)}
.dhead{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px}
.dhead h3{margin:0;font-size:15px}
.dbody{padding:16px 20px;max-height:62vh;overflow:auto}
textarea{width:100%;height:340px;background:var(--main);color:var(--text);border:1px solid var(--border);
  border-radius:10px;padding:12px;font-family:ui-monospace,monospace;font-size:11.5px;resize:vertical;outline:none}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin-top:9px}
.legend span{display:flex;align-items:center;gap:5px}
.sw{width:11px;height:11px;border-radius:3px;display:inline-block}
.empty{color:var(--muted);font-size:13px;padding:40px 0;text-align:center}
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(20px);
  background:var(--accent);color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;
  opacity:0;pointer-events:none;transition:.2s;z-index:100}
.toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
.notice{background:var(--card);border:1px solid var(--border);border-left:3px solid var(--accent);
  border-radius:10px;padding:13px 16px;margin-bottom:22px;font-size:12.5px;color:var(--muted)}
.notice b{color:var(--text);font-weight:600}
.notice code{background:var(--sub);padding:1px 5px;border-radius:4px;font-size:11px}
</style>
</head>
<body class="shownotes">

<header>
 <div class="bar">
  <div class="row">
    <h1>Frontier Draughting <span class="dim">— Editor Icon Set</span></h1>
    <span class="pill">${stats.total} glyphs</span>
    <span class="pill ok" title="No coordinate overlap and no verbatim run against 2,125 reference icons">${stats.clean} clean</span>
    <span class="pill warn" title="Shape converges on a universal symbol; no copied coordinates">${stats.near} near</span>
    <span class="pill bad" title="High raster overlap with a reference icon — judge these yourself">${stats.review} review</span>
    <span class="spacer"></span>
    <input type="search" id="q" placeholder="Search name, category or keyword…">
  </div>
  <div class="row" style="margin-top:11px">
    <div class="seg" id="variant">
      <button data-v="mono"   aria-pressed="false">Mono</button>
      <button data-v="accent" aria-pressed="false">Accent</button>
      <button data-v="multi"  aria-pressed="true">Multicolour</button>
    </div>
    <label class="ctl">Size <input type="range" id="size" min="16" max="96" value="52"><span id="sizev" class="meta">52</span></label>
    <label class="ctl">Theme
      <select id="theme">${Object.keys(THEMES).map(t => `<option${t === 'Oled' ? ' selected' : ''}>${t}</option>`).join('')}</select>
    </label>
    <label class="ctl">Accent
      <select id="accent">${Object.keys(ACCENTS).map(a => `<option${a === 'Blue' ? ' selected' : ''}>${a}</option>`).join('')}</select>
    </label>
    <label class="ctl">Show
      <select id="filter">
        <option value="all">Everything</option>
        <option value="unmarked">Not yet judged</option>
        <option value="keep">Marked keep</option>
        <option value="fix">Marked fix</option>
        <option value="drop">Marked drop</option>
        <option value="copy">Marked copied</option>
        <option value="REVIEW">Audit: review</option>
        <option value="NEAR">Audit: near</option>
        <option value="CLEAN">Audit: clean</option>
      </select>
    </label>
    <span class="spacer"></span>
    <button class="act" id="tnotes">Notes</button>
    <button class="act" id="tcmp">Compare${hasCmp ? '' : ' (n/a)'}</button>
    <button class="act" id="exp">Export review →</button>
  </div>
 </div>
</header>

<main>
  <div class="notice">
    <b>How to use this page.</b> Judge every icon with the four buttons on each card:
    <b>✓</b> keep · <b>✎</b> needs correction · <b>✕</b> drop/bad · <b>⎘</b> looks copied.
    Your marks save to this browser automatically. When you are done hit <b>Export review</b> and paste the
    result back to me — I will action it and wire the survivors into <code>DisplayPresentation/VectorCodec.cpp</code>.
    <br><br>
    <b>On originality.</b> Every glyph was diffed against <b>2,125 reference icons</b> (1,838 Lucide + 287 Feather)
    on four measures: coordinate-pair overlap, command fingerprint, 64×64 rendered-pixel IoU, and longest verbatim
    path run. Hover any badge for its numbers. A <b>REVIEW</b> badge with <code>coord 0 · verb 0</code> means the
    outline converges on a universal symbol (a chevron is a chevron) while sharing <i>zero</i> coordinate data —
    turn on <b>Compare</b> to see both side by side and decide for yourself.
    <div class="legend">
      ${Object.entries(COLOUR_ROLES).map(([k, v]) =>
        `<span><i class="sw" style="background:${v.hex}"></i>${v.title}</span>`).join('')}
    </div>
  </div>
  <div id="host"></div>
  <div class="empty" id="empty" style="display:none">Nothing matches that filter.</div>
</main>

<dialog id="dlg">
  <div class="dhead"><h3>Review export</h3><span class="spacer"></span>
    <button class="act" id="cp">Copy to clipboard</button>
    <button class="act" id="cl">Close</button></div>
  <div class="dbody"><textarea id="out" spellcheck="false"></textarea></div>
</dialog>

<div class="toast" id="toast"></div>

<script src="../Scratchpad/IconForge/proofs/ComparisonCorpus.js" onerror="window.FRONTIER_COMPARISON=null"></script>
<script>
const GLYPHS = ${JSON.stringify(payload)};
const CATS   = ${JSON.stringify(CATEGORIES)};
const ROLES  = ${JSON.stringify(COLOUR_ROLES)};
const THEMES = ${JSON.stringify(THEMES)};
const ACCENTS= ${JSON.stringify(ACCENTS)};
const KEY    = 'frontier.icon.review.v1';

let marks   = JSON.parse(localStorage.getItem(KEY) || '{}');
let variant = 'multi';

//----------------------------------------------------------------------------------------------------------
// RENDERING
//----------------------------------------------------------------------------------------------------------
function layer(L, mode){
  const role = L.role ? ROLES[L.role].hex : null;
  const col  = (mode==='mono' || !role) ? 'currentColor'
             : (mode==='accent' ? (L.role==='hot' ? 'var(--accent)' : 'currentColor') : role);
  const a=['d="'+L.d+'"'];
  a.push(L.f ? 'fill="'+col+'"' : 'fill="none"');
  a.push(L.f ? 'stroke="none"'  : 'stroke="'+col+'"');
  if(L.w)   a.push('stroke-width="'+L.w+'"');
  if(L.cap) a.push('stroke-linecap="'+L.cap+'"');
  if(L.dash)a.push('stroke-dasharray="'+L.dash+'"');
  if(L.o!==undefined) a.push('opacity="'+L.o+'"');
  return '<path '+a.join(' ')+'/>';
}
function svgOf(g, mode, px){
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+px+'" height="'+px+'" viewBox="0 0 24 24" '
       + 'fill="none" stroke-width="1.75" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="4">'
       + g.l.map(L=>layer(L,mode)).join('') + '</svg>';
}
function refSvg(key, px){
  const C = window.FRONTIER_COMPARISON;
  if(!C || !C[key]) return '<div class="lbl">not available</div>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+px+'" height="'+px+'" viewBox="0 0 24 24" '
       + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
       + C[key] + '</svg>';
}

function card(g){
  const px = +document.getElementById('size').value;
  const a  = g.audit || {verdict:'—',nearest:'—',coord:0,cmd:0,iou:0,verb:0};
  const tip = 'nearest: '+a.nearest+'  |  coord-pair overlap '+a.coord+'  ·  command cosine '+a.cmd
            + '  ·  raster IoU '+a.iou+'  ·  verbatim run '+a.verb;
  const m = marks[g.id]||'';
  const mk = (k,ch,t)=>'<button data-m="'+k+'" data-id="'+g.id+'" title="'+t+'" aria-pressed="'+(m===k)+'">'+ch+'</button>';
  return '<div class="card" data-id="'+g.id+'" data-mark="'+m+'" data-cat="'+g.cat+'" '
       + 'data-v="'+a.verdict+'" data-s="'+(g.id+' '+g.name+' '+g.cat+' '+g.kw).toLowerCase()+'">'
       + '<div class="art" style="height:'+Math.max(104,px+42)+'px">'+svgOf(g,variant,px)
       + '<span class="vbadge '+a.verdict+'" title="'+tip+'">'+a.verdict+'</span></div>'
       + '<div><div class="nm">'+g.name+'</div><div class="meta">'+g.id+'</div></div>'
       + '<div class="cmp"><div class="half"><div>'+svgOf(g,'mono',30)+'</div><div class="lbl">Frontier</div></div>'
       +   '<div class="vs">vs</div>'
       +   '<div class="half"><div>'+refSvg(a.nearest,30)+'</div><div class="lbl">'+a.nearest+'</div></div></div>'
       + '<div class="note">'+g.note+'</div>'
       + '<div class="marks">'+mk('keep','✓','Keep as-is')+mk('fix','✎','Needs correction')
       +   mk('drop','✕','Bad — drop it')+mk('copy','⎘','Looks copied')+'</div>'
       + '<div class="tools"><button data-act="svg" data-id="'+g.id+'">Copy SVG</button>'
       +   '<button data-act="path" data-id="'+g.id+'">Copy paths</button></div>'
       + '</div>';
}

function render(){
  const host=document.getElementById('host');
  const q=document.getElementById('q').value.trim().toLowerCase();
  const f=document.getElementById('filter').value;
  let shown=0, html='';
  for(const c of CATS){
    const items=GLYPHS.filter(g=>g.cat===c.id).filter(g=>{
      if(q && !(g.id+' '+g.name+' '+g.cat+' '+g.kw).toLowerCase().includes(q)) return false;
      const m=marks[g.id]||'';
      if(f==='unmarked') return !m;
      if(['keep','fix','drop','copy'].includes(f)) return m===f;
      if(['CLEAN','NEAR','REVIEW'].includes(f)) return g.audit && g.audit.verdict===f;
      return true;
    });
    if(!items.length) continue;
    shown+=items.length;
    html+='<section id="sec-'+c.id+'"><div class="sechead"><h2>'+c.title+'</h2>'
        + '<span class="cnt">'+items.length+' glyph'+(items.length===1?'':'s')+' · enum <code>'+c.enumName+'</code></span></div>'
        + '<p class="blurb">'+c.blurb+'</p><div class="grid">'+items.map(card).join('')+'</div></section>';
  }
  host.innerHTML=html;
  document.getElementById('empty').style.display = shown ? 'none':'block';
}

//----------------------------------------------------------------------------------------------------------
// INTERACTION
//----------------------------------------------------------------------------------------------------------
function toast(t){const e=document.getElementById('toast');e.textContent=t;e.classList.add('on');
  clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('on'),1500);}

document.addEventListener('click',e=>{
  const mb=e.target.closest('.marks button');
  if(mb){
    const id=mb.dataset.id, m=mb.dataset.m;
    marks[id] = (marks[id]===m) ? '' : m;
    if(!marks[id]) delete marks[id];
    localStorage.setItem(KEY,JSON.stringify(marks));
    const card=mb.closest('.card');
    card.dataset.mark=marks[id]||'';
    card.querySelectorAll('.marks button').forEach(b=>b.setAttribute('aria-pressed', marks[id]===b.dataset.m));
    const f=document.getElementById('filter').value;
    if(f!=='all') render();
    return;
  }
  const tb=e.target.closest('.tools button');
  if(tb){
    const g=GLYPHS.find(x=>x.id===tb.dataset.id);
    const txt = tb.dataset.act==='svg' ? svgOf(g,variant,24)
              : g.l.map(L=>L.d).join('\\n');
    navigator.clipboard.writeText(txt).then(()=>toast('Copied '+g.id));
  }
});

document.getElementById('variant').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b)return;
  variant=b.dataset.v;
  [...e.currentTarget.children].forEach(x=>x.setAttribute('aria-pressed', x===b));
  render();
});
document.getElementById('size').addEventListener('input',e=>{
  document.getElementById('sizev').textContent=e.target.value; render();
});
document.getElementById('q').addEventListener('input',render);
document.getElementById('filter').addEventListener('change',render);
document.getElementById('theme').addEventListener('change',e=>{
  const t=THEMES[e.target.value];
  for(const [k,v] of Object.entries(t)) document.documentElement.style.setProperty('--'+k,v);
});
document.getElementById('accent').addEventListener('change',e=>{
  document.documentElement.style.setProperty('--accent',ACCENTS[e.target.value]);
});
document.getElementById('tnotes').addEventListener('click',()=>document.body.classList.toggle('shownotes'));
document.getElementById('tcmp').addEventListener('click',()=>document.body.classList.toggle('showcmp'));

document.getElementById('exp').addEventListener('click',()=>{
  const by=k=>GLYPHS.filter(g=>marks[g.id]===k).map(g=>g.id);
  const keep=by('keep'),fix=by('fix'),drop=by('drop'),copy=by('copy');
  const un=GLYPHS.filter(g=>!marks[g.id]).map(g=>g.id);
  let t='# Frontier Icon Review — verdict\\n\\n';
  t+='Total '+GLYPHS.length+' · keep '+keep.length+' · fix '+fix.length+' · drop '+drop.length
   + ' · copied '+copy.length+' · unjudged '+un.length+'\\n';
  const sec=(ttl,arr,hint)=>{ if(!arr.length)return'';
    let s='\\n## '+ttl+' ('+arr.length+')\\n'+(hint?hint+'\\n':'');
    for(const id of arr){ const g=GLYPHS.find(x=>x.id===id);
      s+='- **'+id+'** ('+g.cat+')'+(g.audit?' — audit '+g.audit.verdict+', nearest '+g.audit.nearest+', IoU '+g.audit.iou:'')+'\\n'; }
    return s; };
  t+=sec('KEEP',keep);
  t+=sec('NEEDS CORRECTION',fix,'_Tell me what is wrong with each and I will redraw._');
  t+=sec('DROP',drop);
  t+=sec('LOOKS COPIED',copy,'_I will redraw these from scratch on a different construction._');
  t+=sec('NOT YET JUDGED',un);
  document.getElementById('out').value=t;
  document.getElementById('dlg').showModal();
});
document.getElementById('cp').addEventListener('click',()=>{
  const o=document.getElementById('out'); o.select();
  navigator.clipboard.writeText(o.value).then(()=>toast('Review copied'));
});
document.getElementById('cl').addEventListener('click',()=>document.getElementById('dlg').close());

render();
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`[page] ${path.relative(process.cwd(), OUT)}  (${(html.length / 1024).toFixed(0)} KB, ${payload.length} glyphs)`);
console.log(`[page] clean=${stats.clean} near=${stats.near} review=${stats.review}`);
