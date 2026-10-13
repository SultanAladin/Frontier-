// Online pages: Messages / Contacts / Session / Account. Layout and copy are
// real; the network behind them is mock data shaped like the EOS lobby+match
// split (lobby object vs match session object — the UI says which is which).
// C++ landing spot: same HMI world, online data source swapped for EOS state.

const head = (t, s) => `<h1>${t}</h1><p class="sub">${s}</p>`;

const THREADS = [
  { who: 'Mara Voss', last: 'Lobby is up — join when ready', time: '12:41', unread: 2, cls: '' },
  { who: 'Paddock crew', last: 'Jonas: new PB on sector 2', time: '12:20', unread: 0, cls: 'amber' },
  { who: 'Jonas Reid', last: 'Try wing 18 at this track', time: '11:02', unread: 0, cls: '' },
];
const CONTACTS = [
  { who: 'Mara Voss', tag: 'In lobby', cls: 'inlobby', init: 'M' },
  { who: 'Jonas Reid', tag: 'In race', cls: 'inrace', init: 'J' },
  { who: 'A. Okafor', tag: 'Online', cls: '', init: 'A' },
  { who: 'Lena Marsh', tag: 'Offline', cls: '', init: 'L' },
];
const LOBBY = [
  { who: 'You', tag: 'Host · Ready', cls: 'inlobby', init: 'Y' },
  { who: 'Mara Voss', tag: 'Ready', cls: 'inlobby', init: 'M' },
  { who: 'Jonas Reid', tag: 'Not ready', cls: '', init: 'J' },
];
const BROWSE = [
  { name: 'Sunday GT3 · Kyalami', meta: '5/12 · ranked · EN', ping: '24 ms' },
  { name: 'Drift practice · open', meta: '3/8 · casual · EN', ping: '41 ms' },
  { name: 'Night cruise · no mic', meta: '7/10 · casual · ZH', ping: '88 ms' },
];

export function renderMessages() {
  return head('Messages', 'Threads + lobby chat share one UI · different badges') +
    `<div class="grid2"><div class="card"><h2>Threads</h2>
      ${THREADS.map((t) => `<div class="thread" data-thread="${t.who}">
        <span class="avatar ${t.cls}">${t.who[0]}</span>
        <span class="who"><b>${t.who}</b><span>${t.last}</span></span>
        <span class="presence">${t.time}</span></div>`).join('')}
    </div><div class="card"><h2 id="chatTitle">Mara Voss</h2>
      <div id="chatlog"><div class="bubble">Lobby is up — join when ready</div>
      <div class="bubble me">Two minutes, finishing a tune</div></div>
      <div class="composer"><input data-kb placeholder="Message…" id="chatInput">
      <button class="btn" id="chatSend">Send</button></div>
    </div></div>`;
}

export function wireMessages(root) {
  const log = root.querySelector('#chatlog');
  const input = root.querySelector('#chatInput');
  const send = () => {
    const v = input.value.trim();
    if (!v) return;
    const d = document.createElement('div');
    d.className = 'bubble me'; d.textContent = v; log.appendChild(d);
    input.value = ''; log.scrollTop = log.scrollHeight;
  };
  root.querySelector('#chatSend').addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  root.querySelectorAll('[data-thread]').forEach((t) => t.addEventListener('click', () => {
    root.querySelector('#chatTitle').textContent = t.dataset.thread;
  }));
}

export function renderContacts() {
  return head('Contacts', 'Presence mirrors lobby member attributes') +
    `<div class="grid2"><div class="card"><h2>Friends · 4</h2>
      ${CONTACTS.map((c) => `<div class="person"><span class="avatar">${c.init}</span>
        <span class="who"><b>${c.who}</b></span>
        <span class="presence ${c.cls}">${c.tag}</span></div>`).join('')}
    </div><div class="card"><h2>Invite</h2>
      <div class="row"><label>Invite to lobby<small>Sends a lobby invite, not a match join.</small></label>
      <button class="btn" id="inviteBtn">Invite</button></div>
      <div class="row"><label>Add friend<small>By display name.</small></label>
      <button class="btn ghost">Add</button></div>
    </div></div>`;
}

export function wireContacts(root) {
  const b = root.querySelector('#inviteBtn');
  b?.addEventListener('click', () => {
    b.textContent = 'Invited ✓'; b.disabled = true;
    setTimeout(() => { b.textContent = 'Invite'; b.disabled = false; }, 1600);
  });
}

let sessionTab = 'lobby';
export function renderSession() {
  const tabs = [['lobby', 'Session'], ['browse', 'Browse'], ['setup', 'Setup'], ['history', 'History']];
  let body = '';
  if (sessionTab === 'lobby') {
    body = `<div class="grid2"><div class="card"><h2>Lobby · 3/8</h2>
      ${LOBBY.map((c) => `<div class="person"><span class="avatar">${c.init}</span>
        <span class="who"><b>${c.who}</b></span><span class="presence ${c.cls}">${c.tag}</span></div>`).join('')}
      </div><div class="card"><h2>Voice</h2>
      <div class="row"><label>Microphone<small>RTC room · starts muted.</small></label>
      <span class="switch"><input type="checkbox" id="micT"><i></i></span></div>
      <div class="row"><label>Ready<small>Publish readiness to the lobby.</small></label>
      <span class="switch"><input type="checkbox" id="readyT" checked><i></i></span></div>
      <div class="row"><label>Match session<small>Host starts the separate match object.</small></label>
      <button class="btn warn" id="startMatch">Prepare</button></div>
      <div class="row"><label>Leave lobby<small>Cascade: ends match session first.</small></label>
      <button class="btn ghost" id="leaveLobby">Leave</button></div>
      </div></div>`;
  } else if (sessionTab === 'browse') {
    body = `<div class="card"><h2>Lobbies + match sessions</h2>
      ${BROWSE.map((l) => `<div class="lobbyrow"><span class="who"><b>${l.name}</b>
        <span>${l.meta}</span></span><span class="presence">${l.ping}</span>
        <button class="btn ghost" data-join="${l.name}">Join</button></div>`).join('')}
      </div>`;
  } else if (sessionTab === 'setup') {
    body = `<div class="grid2"><div class="card"><h2>Match setup (host)</h2>
      <div class="row"><label>Track</label><span class="seg" data-staticseg>
        <button class="on">Kyalami</button><button>Coast</button><button>Dusk</button></span></div>
      <div class="row"><label>Mode</label><span class="seg" data-staticseg>
        <button class="on">Race</button><button>Cruise</button><button>Drift</button></span></div>
      <div class="row"><label>Max players</label><output>12</output></div>
      <div class="row"><label>Join in progress</label>
        <span class="switch"><input type="checkbox" checked><i></i></span></div>
      </div><div class="card"><h2>Lobby settings</h2>
      <div class="row"><label>Visibility</label><span class="seg" data-staticseg>
        <button class="on">Public</button><button>Friends</button><button>Invite</button></span></div>
      <div class="row"><label>Voice room</label>
        <span class="switch"><input type="checkbox" checked><i></i></span></div>
      <div class="row"><label>Lobby note</label></div>
      <div class="composer"><input data-kb placeholder="e.g. clean racing, no cuts"></div>
      </div></div>`;
  } else {
    body = `<div class="card"><h2>History · local record</h2>
      <div class="row"><label>Sun 14:02 · Kyalami · Race<small>12:44 · completed · 3/8 real players</small></label></div>
      <div class="row"><label>Sat 21:37 · Coast · Cruise<small>31:09 · completed · 2/10</small></label></div>
      <div class="row"><label>Sat 19:15 · Kyalami · Race<small>04:12 · abandoned · host left</small></label></div>
      </div>`;
  }
  return head('Session', 'Lobby object + separate match session · RTC voice · mock data') +
    `<div class="tabs">${tabs.map((t) =>
      `<button data-stab="${t[0]}" class="${t[0] === sessionTab ? 'on' : ''}">${t[1]}</button>`).join('')}</div>${body}`;
}

export function wireSession(root, rerender) {
  root.querySelectorAll('[data-stab]').forEach((b) => b.addEventListener('click', () => {
    sessionTab = b.dataset.stab; rerender();
  }));
  root.querySelectorAll('[data-staticseg] button').forEach((b) => b.addEventListener('click', () => {
    [...b.parentElement.children].forEach((x) => x.classList.toggle('on', x === b));
  }));
  const sm = root.querySelector('#startMatch');
  sm?.addEventListener('click', () => {
    sm.textContent = sm.textContent === 'Prepare' ? 'Starting…' : 'Prepare';
    setTimeout(() => { if (sm.isConnected) sm.textContent = 'Started ✓'; }, 1200);
  });
  root.querySelector('#leaveLobby')?.addEventListener('click', (e) => {
    e.target.textContent = 'Left ✓';
  });
  root.querySelectorAll('[data-join]').forEach((b) => b.addEventListener('click', () => {
    b.textContent = 'Joined ✓';
  }));
}

export function renderAccount() {
  return head('Account & settings', 'Profile · login · language · units · HMI') +
    `<div class="grid2"><div class="card"><h2>Profile</h2>
      <div class="row"><label>Signed in as<small>Mock driver · verified</small></label>
      <span class="presence inlobby">Verified</span></div>
      <div class="row"><label>Auto-login<small>Persistent auth, no browser.</small></label>
      <span class="switch"><input type="checkbox" checked><i></i></span></div>
      <div class="row"><label>Language<small>Switchable live · logs stay English.</small></label>
      <span class="seg" data-staticseg><button class="on">EN</button><button>中文</button></span></div>
    </div><div class="card"><h2>HMI</h2>
      <div class="row"><label>Units</label>
      <span class="seg" id="unitSeg"><button data-u="metric" class="on">km/h</button>
      <button data-u="imperial">mph</button></span></div>
      <div class="row"><label>Brightness</label>
      <input type="range" id="brightR" min="0.4" max="1.2" step="0.05" value="1">
      <output id="brightO">100%</output></div>
      <div class="row"><label>Voice mute<small>RTC input mute.</small></label>
      <span class="switch"><input type="checkbox" checked><i></i></span></div>
    </div></div>`;
}

export function wireAccount(root) {
  root.querySelectorAll('[data-staticseg] button').forEach((b) => b.addEventListener('click', () => {
    [...b.parentElement.children].forEach((x) => x.classList.toggle('on', x === b));
  }));
  const seg = root.querySelector('#unitSeg');
  seg?.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    [...seg.children].forEach((x) => x.classList.toggle('on', x === b));
    document.dispatchEvent(new CustomEvent('hmi-units', { detail: b.dataset.u }));
  }));
  const r = root.querySelector('#brightR'), o = root.querySelector('#brightO');
  r?.addEventListener('input', () => {
    document.documentElement.style.setProperty('--bright', r.value);
    o.textContent = Math.round(r.value * 100) + '%';
  });
}
