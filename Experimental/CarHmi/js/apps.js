// App windows — every icon opens a working mini-app. renderAppScreen() is a
// pure HTML-string builder (Checks.mjs calls it in node); wireAppScreen()
// attaches behaviour and returns a cleanup function for timers.

import { appName } from './icons.js';

const head = (t, s) => `<div class="aw-head"><button class="aw-back" data-close>‹</button>
  <div><b>${t}</b><span>${s}</span></div></div>`;

const esc = (s) => s.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── full chat interface (Messages app) ─────────────────────────────
// 3-pane layout after the supplied reference: threads | conversation |
// group info. Sized for the tablet window (~900x480 content box).
let chatActive = 'group1';

const CAV = (init, cls) => `<span class="cav ${cls}">${init}</span>`;

const CHAT_ONLINE = [['SA', 'av1'], ['RK', 'av2'], ['DG', 'av3'], ['ZA', 'av4'], ['MO', 'av5']];

const CHAT_THREADS = [
  { id: 'suneo', name: 'Suneo Marinir', init: 'SM', cls: 'av1', sub: 'Suneo is typing…', typing: true,
    unread: 2, time: '', reply: 'Copy — flashing it now.',
    msgs: [
      { from: 'Suneo Marinir', init: 'SM', cls: 'av1', time: '2m',
        text: 'New tune feels great through sector 2.', reacts: [['👍', 3]] },
      { self: true, init: 'YO', cls: 'av0', time: '1m', text: 'Wing 18 next run — try it.' },
    ] },
  { id: 'kick', name: 'Kick Andy', init: 'KA', cls: 'av2', sub: 'Voice message', dot: true,
    unread: 0, time: '', reply: 'Exactly. See you on track.',
    msgs: [
      { from: 'Kick Andy', init: 'KA', cls: 'av2', time: '9:40',
        text: 'Line through the last corner:', voice: { dur: '0:09' } },
      { self: true, init: 'YO', cls: 'av0', time: '9:41', text: 'Late apex, got it.' },
    ] },
  { id: 'group1', name: 'Sunday GT3', init: 'G1', cls: 'av4', sub: "You: wow, that's an interesting…",
    time: '9:32', group: true, reply: 'Setup file is in Shared Media.',
    msgs: [
      { from: 'Nagita salavina', init: 'NS', cls: 'av1', time: '1d',
        text: 'Hii, are we going to Kyalami this Sunday?', reacts: [['👍', 6], ['👎', 2]] },
      { date: 'Today, 17 Nov' },
      { from: 'Dedy Gunawan', init: 'DG', cls: 'av3', time: '10m',
        text: "So, here i have some recommended setups, let's see",
        voice: { dur: '0:13' }, imgs: ['ph1', 'ph2'], reacts: [['🔥', 8], ['👍', 1]] },
      { self: true, init: 'YO', cls: 'av0', time: '10m', text: "wow, that's an interesting place" },
    ] },
  { id: 'mara', name: 'Mara Voss', init: 'MV', cls: 'av5', sub: 'Voice message', dot: true,
    unread: 0, time: '', reply: 'Join when ready 🏁',
    msgs: [
      { from: 'Mara Voss', init: 'MV', cls: 'av5', time: '8:15',
        text: 'Lobby password changed:', voice: { dur: '0:06' } },
    ] },
];

const CHAT_PARTS = [
  ['Marimo Zoldic', 'Busy! Sorry for Slowers', 'MZ', 'av2'],
  ['Rojer Mozart', 'At Work', 'RM', 'av3'],
  ['Convy Suchinda', 'Gaming and IT', 'CS', 'av5'],
];
const CHAT_MEDIA = [
  ['Setup Kyalami.pdf', '2.1 Mb', 'pdf'], ['Telemetry L12.zip', '18 Mb', 'zip'],
  ['Livery v3.png', '4.6 Mb', 'img'], ['Onboard AUD.mp4', '96 Mb', 'vid'],
];

function voiceHtml(dur) {
  let bars = '';
  for (let i = 0; i < 26; i++) bars += `<i style="height:${5 + ((i * 37 + 11) % 17)}px"></i>`;
  return `<div class="voice" data-voice><button class="vplay">▶</button>` +
    `<span class="vbars">${bars}</span><span class="vtime">${dur}</span></div>`;
}

function renderChatLog(t) {
  return t.msgs.map((m) => {
    if (m.date) return `<div class="cdate"><span>${m.date}</span></div>`;
    const who = m.self
      ? `<div class="cwho me"><b>You</b><span>${m.time}</span>${CAV(m.init, m.cls)}</div>`
      : `<div class="cwho">${CAV(m.init, m.cls)}<b>${m.from}</b><span>${m.time}</span></div>`;
    const txt = m.text ? `<div class="cbub${m.self ? ' me' : ''}">${m.text}</div>` : '';
    const voi = m.voice ? voiceHtml(m.voice.dur) : '';
    const img = m.imgs ? `<div class="cimgs">${m.imgs.map((c) => `<span class="cimg ${c}"></span>`).join('')}</div>` : '';
    const react = m.reacts ? `<div class="creacts">${m.reacts.map((r) =>
      `<button data-react>${r[0]} <b>${r[1]}</b></button>`).join('')}</div>` : '';
    return `<div class="cmsg${m.self ? ' self' : ''}">${who}${txt}${voi}${img}${react}</div>`;
  }).join('');
}

function chatShell() {
  const t = CHAT_THREADS.find((x) => x.id === chatActive);
  return `<div class="chatwrap">
    <div class="chat-top"><button data-close>‹</button><b>Messages</b>
      <span class="csp"></span><span class="cdot-live">● 3 online in Session</span></div>
    <div class="chat3">
      <aside class="c-left">
        <div class="c-me">${CAV('RK', 'av0')}<div><b>Rohmad Khoir</b><span>My account</span></div></div>
        <div class="c-sect"><b>Online now</b><span class="cbadge">10</span></div>
        <div class="c-online">${CHAT_ONLINE.map((o) =>
          `<span class="cavo">${CAV(o[0], o[1])}<i class="cdot"></i></span>`).join('')}</div>
        <div class="c-sect"><b>Messages ▾</b><span class="csp"></span><span class="cic">✎ ☆</span></div>
        <div class="c-search"><input id="cq" placeholder="⌕ Search"></div>
        <div class="c-threads">${CHAT_THREADS.map((x) => `
          <button class="cthread${x.id === chatActive ? ' on' : ''}" data-thread="${x.id}">
            ${CAV(x.init, x.cls)}<span class="ct">
              <span class="ct1"><b>${x.name}</b>${x.time ? `<span class="ctime">${x.time}</span>` : ''}</span>
              <span class="ct2"><i class="${x.typing ? 'typing' : ''}">${x.sub}</i>
              ${x.unread ? `<span class="cbadge">${x.unread}</span>` : ''}${x.dot ? '<span class="cdot2"></span>' : ''}</span>
            </span></button>`).join('')}</div>
        <div class="c-live"><span class="livedot"></span><b>LIVE</b><span>23:54</span>
          <span class="csp"></span>${CAV('ZA', 'av4')}<span class="cbadge">6</span></div>
      </aside>
      <section class="c-main">
        <div class="c-ghead"><div><b id="cgtitle">${t.name}</b>
          <span id="cgsub">${t.group ? '@Kyalami · 24 participants' : 'online'}</span></div>
          <span class="csp"></span><span class="cic">🎥 📞 🖼 ❏</span>
          <span class="cstack">${CAV('RK', 'av0')}${CAV('NS', 'av1')}<span class="cmore">+6</span></span></div>
        <div class="c-log" id="clog">${renderChatLog(t)}</div>
        <div class="c-typing" id="ctyping" hidden></div>
        <div class="c-compose">${CAV('YO', 'av0')}<input id="cinput" placeholder="Your message…">
          <button id="cmic" title="Voice">🎙</button><button id="cattach" title="Attach">📎</button>
          <button id="csend" title="Send">➤</button></div>
      </section>
      <aside class="c-right">
        <div class="c-ginfo"><span class="cav big av4">G1</span><b>Sunday GT3</b><span>@Kyalami</span></div>
        <div class="c-sect"><b>24 Participants</b><span class="csp"></span>
          <button class="clink" data-see="participants">See all</button></div>
        ${CHAT_PARTS.map((p) => `<div class="prow sm">${CAV(p[2], p[3])}` +
          `<div class="who"><b>${p[0]}</b><span>${p[1]}</span></div></div>`).join('')}
        <div class="c-sect"><b>Shared Media</b><span class="csp"></span>
          <button class="clink" data-see="media">See all</button></div>
        ${CHAT_MEDIA.map((m) => `<div class="frow"><span class="fic ${m[2]}">${m[2].toUpperCase()}</span>` +
          `<div class="who"><b>${m[0]}</b><span>${m[1]}</span></div></div>`).join('')}
      </aside>
    </div></div>`;
}

export function renderAppScreen(id) {
  switch (id) {
    case 'nav': return head('Navigation', 'Route preview · live') + `
      <div class="aw-body"><svg viewBox="0 0 400 190" class="map">
        <rect width="400" height="190" rx="12" fill="#0b1520"/>
        <g stroke="#1c2a3a" stroke-width="7" fill="none"><path d="M-10 150 L120 120 L210 130 L410 60"/>
        <path d="M40 -10 L90 200 M250 -10 L230 200 M330 -10 L360 200"/></g>
        <path id="route" d="M20 165 L120 120 L210 130 L300 95 L380 70" fill="none" stroke="#14b8f2"
          stroke-width="5" stroke-linecap="round" stroke-dasharray="10 8"/>
        <circle cx="20" cy="165" r="7" fill="#3ddc84"/><circle cx="380" cy="70" r="7" fill="#ff5a5a"/>
        <circle id="navdot" cx="20" cy="165" r="6" fill="#fff"/></svg>
      <div class="chips"><button class="chip on">Home · 12 min</button>
      <button class="chip">Track · 26 min</button><button class="chip">Charge · 6 min</button></div></div>`;
    case 'media': return head('Media', 'Synthwave Mix · FLAC') + `
      <div class="aw-body center"><div class="art"></div><b>Night Drive</b>
      <span class="dim">Neon Coast — 3:42</span>
      <div class="prog"><i id="mprog"></i></div>
      <div class="mctl"><button data-m="prev">⏮</button><button data-m="play" class="big">⏸</button>
      <button data-m="next">⏭</button></div></div>`;
    case 'phone': return head('Phone', 'Hands-free · connected') + `
      <div class="aw-body center"><div class="dialnum" id="dialnum">—</div>
      <div class="pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']
        .map((d) => `<button data-d="${d}">${d}</button>`).join('')}</div>
      <button class="btn call" id="callbtn">📞 Call</button>
      <span class="dim" id="callstatus"></span></div>`;
    case 'messages': return `<div class="aw-body wide">${chatShell()}</div>`;
    case 'climate': return head('Climate', 'Dual zone · auto') + `
      <div class="aw-body"><div class="clim">
        <button data-t="-1">−</button><div class="temp"><b id="ctemp">21.5°</b><span>driver</span></div>
        <button data-t="1">+</button></div>
      <div class="rowline"><label>Fan</label><input type="range" id="fan" min="0" max="7" value="3">
      <output id="fanout">3</output></div>
      <div class="rowline"><label>Seat heat</label>
      <span class="switch"><input type="checkbox" id="seat" checked><i></i></span></div></div>`;
    case 'camera': return head('Camera', 'Dashcam · ● REC') + `
      <div class="aw-body"><div class="vf" id="vf"><span class="rec">● REC 00:42</span>
        <div class="vgrid"></div><span class="flash" id="vflash"></span></div>
      <div class="center"><button class="btn" id="shutter">◉ Capture</button></div></div>`;
    case 'photos': return head('Photos', 'Track day · 6 shots') + `
      <div class="aw-body"><div class="thumbs">${[0, 1, 2, 3, 4, 5]
        .map((i) => `<button class="thumb t${i}" data-p="${i}"></button>`).join('')}</div></div>`;
    case 'tune': return head('Tune', 'Live · writes to the car') + `
      <div class="aw-body">
      <div class="rowline"><label>Wing angle</label><input type="range" data-tune="wing" min="4" max="22" step="0.5" value="14">
      <output id="o-wing">14°</output></div>
      <div class="rowline"><label>Ride freq F</label><input type="range" data-tune="freq" min="1" max="3.5" step="0.05" value="2">
      <output id="o-freq">2.00 Hz</output></div>
      <div class="rowline"><label>ABS</label>
      <span class="switch"><input type="checkbox" id="tuneabs" checked><i></i></span></div>
      <div class="rowline"><label>Preset</label><span class="seg" id="tuneseg">
      <button class="on">Road</button><button>Track</button><button>Drift</button></span></div></div>`;
    case 'data': return head('Data', 'Telemetry · live') + `
      <div class="aw-body"><div class="datenums">
        <div><b id="d-speed">0</b><span>KM/H</span></div>
        <div><b id="d-rpm">0</b><span>RPM</span></div>
        <div><b id="d-gear">N</b><span>GEAR</span></div></div>
      <div class="rowline"><label>Throttle</label><div class="bar"><i id="d-thr"></i></div></div>
      <div class="rowline"><label>Brake</label><div class="bar"><i id="d-brk"></i></div></div></div>`;
    case 'session': return head('Session', 'Lobby 3/8 · ranked') + `
      <div class="aw-body"><div class="prow"><span class="avatar">Y</span><b>You · host</b>
        <span class="presence in">ready</span></div>
      <div class="prow"><span class="avatar a">M</span><b>Mara Voss</b><span class="presence in">ready</span></div>
      <div class="prow"><span class="avatar">J</span><b>Jonas Reid</b><span class="presence">not ready</span></div>
      <div class="rowline"><label>Voice</label>
      <span class="switch"><input type="checkbox" checked><i></i></span></div>
      <div class="center"><button class="btn warn" id="sstart">Prepare match</button></div></div>`;
    case 'contacts': return head('Contacts', '4 friends') + `
      <div class="aw-body">${[['M', 'Mara Voss', 'In lobby', 'in'], ['J', 'Jonas Reid', 'In race', 'race'],
        ['A', 'A. Okafor', 'Online', ''], ['L', 'Lena Marsh', 'Offline', '']]
        .map((c) => `<div class="prow"><span class="avatar">${c[0]}</span><b>${c[1]}</b>
        <span class="presence ${c[3]}">${c[2]}</span>
        <button class="btn ghost sm" data-call="${c[1]}">Call</button></div>`).join('')}</div>`;
    case 'weather': return head('Weather', 'Benoni · now') + `
      <div class="aw-body center"><div class="bigtemp">21°</div><span class="dim">Clear · H 24° L 14°</span>
      <div class="hourly">${[['Now', '21°'], ['15:00', '23°'], ['16:00', '24°'], ['17:00', '22°'], ['18:00', '19°']]
        .map((h) => `<div><b>${h[1]}</b><span>${h[0]}</span></div>`).join('')}</div></div>`;
    case 'clock': return head('Clock', 'Lap timer armed') + `
      <div class="aw-body center"><svg viewBox="0 0 120 120" class="analog">
        <circle cx="60" cy="60" r="54" fill="#0d1319" stroke="#2a3540" stroke-width="3"/>
        <g id="ticks"></g><line id="hh" x1="60" y1="60" x2="60" y2="34" stroke="#f59e0b" stroke-width="5" stroke-linecap="round"/>
        <line id="mh" x1="60" y1="60" x2="60" y2="20" stroke="#0ea5e9" stroke-width="3.5" stroke-linecap="round"/>
        <circle cx="60" cy="60" r="4" fill="#ef4444"/></svg>
      <b class="digi" id="digi">--:--:--</b><span class="dim">Best lap 1:24.612</span></div>`;
    case 'settings': return head('Settings', 'HMI + units') + `
      <div class="aw-body">
      <div class="rowline"><label>Units</label><span class="seg" id="setunits">
      <button class="on">km/h</button><button>mph</button></span></div>
      <div class="rowline"><label>Language</label><span class="seg" id="setlang">
      <button class="on">EN</button><button>中文</button></span></div>
      <div class="rowline"><label>Brightness</label><input type="range" id="setbright" min="0.5" max="1.1" step="0.05" value="1">
      <output id="setbrighto">100%</output></div>
      <div class="rowline"><label>Wallpaper</label><span class="seg" id="setwall">
      <button class="on">Aurora</button><button>Ember</button><button>Mono</button></span></div></div>`;
    default: return head(appName(id), '') + `<div class="aw-body"><p class="dim">Coming soon.</p></div>`;
  }
}

export function wireAppScreen(root, id, api) {
  const cleanups = [];
  const every = (ms, fn) => { const h = setInterval(fn, ms); cleanups.push(() => clearInterval(h)); };
  const later = (ms, fn) => { const h = setTimeout(fn, ms); cleanups.push(() => clearTimeout(h)); };
  const on = (sel, ev, fn) => root.querySelector(sel)?.addEventListener(ev, fn);

  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', api.close));

  if (id === 'nav') {
    let k = 0;
    every(60, () => {
      k = (k + 0.008) % 1;
      const route = root.querySelector('#route'), dot = root.querySelector('#navdot');
      if (route && dot && route.getTotalLength) {
        const pt = route.getPointAtLength(route.getTotalLength() * k);
        dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
      }
    });
    root.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
      root.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
      api.toast(`Routing · ${c.textContent}`);
    }));
  }
  if (id === 'media') {
    let playing = true, prog = 0.3;
    const btn = root.querySelector('[data-m="play"]'), bar = root.querySelector('#mprog');
    every(200, () => { if (playing) { prog = (prog + 0.004) % 1; if (bar) bar.style.width = `${prog * 100}%`; } });
    btn?.addEventListener('click', () => { playing = !playing; btn.textContent = playing ? '⏸' : '▶'; });
    root.querySelector('[data-m="next"]')?.addEventListener('click', () => { prog = 0; api.toast('Next track'); });
    root.querySelector('[data-m="prev"]')?.addEventListener('click', () => { prog = 0; api.toast('Previous track'); });
  }
  if (id === 'phone') {
    let num = '';
    const disp = root.querySelector('#dialnum');
    root.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
      if (num.length < 12) num += b.dataset.d;
      if (disp) disp.textContent = num || '—';
    }));
    on('#callbtn', 'click', () => {
      const st = root.querySelector('#callstatus');
      if (st) st.textContent = num ? `Calling ${num}…` : 'Calling Mara Voss…';
      api.toast('Hands-free call started');
    });
  }
  if (id === 'messages') {
    const thread = () => CHAT_THREADS.find((x) => x.id === chatActive);
    const logEl = () => root.querySelector('#clog');
    const scrollEnd = () => { const l = logEl(); if (l) l.scrollTop = l.scrollHeight; };
    scrollEnd();
    const hideTyping = () => { const el = root.querySelector('#ctyping'); if (el) el.hidden = true; };
    const showTyping = (who) => {
      const el = root.querySelector('#ctyping');
      if (el) {
        el.hidden = false;
        el.innerHTML = `<span class="tdots"><i></i><i></i><i></i></span> <b>${who}</b> is typing…`;
      }
    };
    const setThread = (nid) => {
      chatActive = nid;
      const t = thread();
      root.querySelectorAll('[data-thread]').forEach((b) =>
        b.classList.toggle('on', b.dataset.thread === nid));
      root.querySelector('#cgtitle').textContent = t.name;
      root.querySelector('#cgsub').textContent = t.group ? '@Kyalami · 24 participants' : 'online';
      const l = logEl();
      if (l) { l.innerHTML = renderChatLog(t); l.scrollTop = l.scrollHeight; }
      hideTyping();
    };
    root.querySelectorAll('[data-thread]').forEach((b) =>
      b.addEventListener('click', () => setThread(b.dataset.thread)));
    root.querySelector('#cq')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      root.querySelectorAll('[data-thread]').forEach((b) => {
        const t = CHAT_THREADS.find((x) => x.id === b.dataset.thread);
        b.style.display = t.name.toLowerCase().includes(q) ? '' : 'none';
      });
    });
    logEl()?.addEventListener('click', (e) => {
      const r = e.target.closest('[data-react]');
      if (r) {
        const n = r.querySelector('b'), v = parseInt(n.textContent, 10);
        n.textContent = r.classList.toggle('voted') ? v + 1 : v - 1;
        return;
      }
      const v = e.target.closest('[data-voice]');
      if (v) {
        const p = v.querySelector('.vplay');
        p.textContent = v.classList.toggle('playing') ? '⏸' : '▶';
      }
    });
    const input = root.querySelector('#cinput');
    const send = () => {
      const v = input.value.trim();
      if (!v) return;
      const t = thread();
      logEl().insertAdjacentHTML('beforeend',
        `<div class="cmsg self"><div class="cwho me"><b>You</b><span>now</span>${CAV('YO', 'av0')}</div>` +
        `<div class="cbub me">${esc(v)}</div></div>`);
      input.value = ''; scrollEnd();
      t.sub = `You: ${v.length > 24 ? `${v.slice(0, 24)}…` : v}`;
      const row = root.querySelector(`[data-thread="${t.id}"] .ct2 i`);
      if (row) { row.textContent = t.sub; row.classList.remove('typing'); }
      showTyping('Zaidan');
      later(1400, () => {
        hideTyping();
        logEl().insertAdjacentHTML('beforeend',
          `<div class="cmsg"><div class="cwho">${CAV('ZA', 'av4')}<b>Zaidan</b><span>now</span></div>` +
          `<div class="cbub">${t.reply}</div></div>`);
        scrollEnd();
      });
    };
    on('#csend', 'click', send);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    on('#cmic', 'click', () => api.toast('Voice note · 0:06 recorded'));
    on('#cattach', 'click', () => api.toast('Attach · setup + photo + file'));
    root.querySelectorAll('[data-see]').forEach((b) => b.addEventListener('click', () =>
      api.toast(`${b.dataset.see === 'media' ? 'Shared media' : 'Participants'} · full list soon`)));
  }
  if (id === 'climate') {
    let temp = 21.5;
    const out = root.querySelector('#ctemp');
    root.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => {
      temp = Math.min(28, Math.max(16, temp + (+b.dataset.t) * 0.5));
      if (out) out.textContent = `${temp.toFixed(1)}°`;
    }));
    on('#fan', 'input', (e) => { root.querySelector('#fanout').textContent = e.target.value; });
    on('#seat', 'change', (e) => api.toast(e.target.checked ? 'Seat heat on' : 'Seat heat off'));
  }
  if (id === 'camera') {
    on('#shutter', 'click', () => {
      const f = root.querySelector('#vflash');
      if (f) { f.classList.add('go'); setTimeout(() => f.classList.remove('go'), 350); }
      api.toast('Clip saved · 00:42');
    });
  }
  if (id === 'photos') {
    root.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
      b.classList.toggle('zoom'); api.toast(b.classList.contains('zoom') ? 'Zoom 2×' : 'Zoom 1×');
    }));
  }
  if (id === 'tune') {
    const units = { wing: '°', freq: ' Hz' };
    root.querySelectorAll('[data-tune]').forEach((r) => r.addEventListener('input', () => {
      const o = root.querySelector(`#o-${r.dataset.tune}`);
      if (o) o.textContent = `${(+r.value).toFixed(r.dataset.tune === 'freq' ? 2 : 1)}${units[r.dataset.tune]}`;
    }));
    root.querySelectorAll('#tuneseg button').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll('#tuneseg button').forEach((x) => x.classList.toggle('on', x === b));
      api.toast(`Preset · ${b.textContent}`);
    }));
    on('#tuneabs', 'change', (e) => api.toast(e.target.checked ? 'ABS on' : 'ABS off'));
  }
  if (id === 'data') {
    let t = 0;
    every(120, () => {
      t += 0.12;
      const spd = 120 + Math.sin(t * 0.5) * 70 + Math.sin(t * 2.2) * 8;
      const gear = Math.min(7, Math.max(1, 1 + Math.floor(spd / 34)));
      const rpm = 1500 + ((spd - (gear - 1) * 34) / 34) * 5400;
      const set = (sel, v) => { const e = root.querySelector(sel); if (e) e.textContent = v; };
      set('#d-speed', Math.round(Math.max(0, spd))); set('#d-rpm', Math.round(rpm)); set('#d-gear', gear);
      const thr = root.querySelector('#d-thr'), brk = root.querySelector('#d-brk');
      if (thr) thr.style.width = `${Math.round(40 + Math.sin(t * 1.3) * 35)}%`;
      if (brk) brk.style.width = `${Math.round(Math.max(0, Math.sin(t * 0.7 - 2)) * 60)}%`;
    });
  }
  if (id === 'session') {
    on('#sstart', 'click', (e) => { e.target.textContent = 'Match starting…'; api.toast('Match session preparing'); });
  }
  if (id === 'contacts') {
    root.querySelectorAll('[data-call]').forEach((b) => b.addEventListener('click', () =>
      api.toast(`Calling ${b.dataset.call}…`)));
  }
  if (id === 'clock') {
    const ticks = root.querySelector('#ticks');
    if (ticks) {
      let s = '';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        s += `<line x1="${60 + Math.cos(a) * 46}" y1="${60 + Math.sin(a) * 46}" x2="${60 + Math.cos(a) * 51}" y2="${60 + Math.sin(a) * 51}" stroke="#3b4756" stroke-width="3"/>`;
      }
      ticks.innerHTML = s;
    }
    const draw = () => {
      const n = new Date(), hh = root.querySelector('#hh'), mh = root.querySelector('#mh');
      const ha = ((n.getHours() % 12) + n.getMinutes() / 60) / 12 * Math.PI * 2 - Math.PI / 2;
      const ma = (n.getMinutes() + n.getSeconds() / 60) / 60 * Math.PI * 2 - Math.PI / 2;
      if (hh) { hh.setAttribute('x2', 60 + Math.cos(ha) * 26); hh.setAttribute('y2', 60 + Math.sin(ha) * 26); }
      if (mh) { mh.setAttribute('x2', 60 + Math.cos(ma) * 40); mh.setAttribute('y2', 60 + Math.sin(ma) * 40); }
      const d = root.querySelector('#digi'); if (d) d.textContent = n.toTimeString().slice(0, 8);
    };
    draw(); every(1000, draw);
  }
  if (id === 'settings') {
    const seg = (sel, fn) => root.querySelectorAll(`${sel} button`).forEach((b) =>
      b.addEventListener('click', () => {
        root.querySelectorAll(`${sel} button`).forEach((x) => x.classList.toggle('on', x === b)); fn(b);
      }));
    seg('#setunits', (b) => api.toast(`Units · ${b.textContent}`));
    seg('#setlang', (b) => api.toast(`Language · ${b.textContent}`));
    seg('#setwall', (b) => api.setWallpaper(['Aurora', 'Ember', 'Mono'].indexOf(b.textContent)));
    on('#setbright', 'input', (e) => {
      api.setScreenBright(+e.target.value);
      root.querySelector('#setbrighto').textContent = `${Math.round(e.target.value * 100)}%`;
    });
  }
  return () => cleanups.forEach((fn) => fn());
}
