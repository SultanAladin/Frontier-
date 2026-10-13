// Multicolour SVG app icons, 64x64. Each icon is a gradient tile (2-3 stops)
// plus a contrasting glyph, so every icon carries >=3 distinct colours —
// pinned by Checks.mjs. DOM-free data: APPS + icon() helper.

const T = (id, stops) =>
  `<defs><linearGradient id="g-${id}" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs>
   <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#g-${id})"/>`;
const S = (o, c) => `<stop offset="${o}" stop-color="${c}"/>`;

export const APPS = [
  { id: 'nav', name: 'Navigation', blurb: 'Route home · 12 min',
    svg: `<svg viewBox="0 0 64 64">${T('nav', S(0, '#2f7bff') + S(1, '#19d3ff'))}
      <path d="M32 8 L45 47 L32 39 L19 47 Z" fill="#ffffff"/>
      <circle cx="47" cy="15" r="4.5" fill="#ffb020"/></svg>` },
  { id: 'media', name: 'Media', blurb: 'Now playing · Synthwave Mix',
    svg: `<svg viewBox="0 0 64 64">${T('media', S(0, '#ff4d8d') + S(.55, '#ff6a3d') + S(1, '#ff8a3d'))}
      <rect x="12" y="24" width="5" height="16" rx="2.5" fill="#ffffff" opacity=".85"/>
      <rect x="19" y="19" width="5" height="26" rx="2.5" fill="#ffffff" opacity=".65"/>
      <path d="M30 20 L50 32 L30 44 Z" fill="#ffffff"/></svg>` },
  { id: 'phone', name: 'Phone', blurb: 'Mara Voss · missed call',
    svg: `<svg viewBox="0 0 64 64">${T('phone', S(0, '#34d399') + S(1, '#0e9f6e'))}
      <path d="M22 12c-5 0-8 3-8 8 0 15 12 27 27 27 5 0 8-3 8-8v-6l-9-3-4 4c-3-2-7-6-9-9l4-4-3-9h-6z" fill="#ffffff"/>
      <circle cx="46" cy="16" r="6" fill="#ff5a5a"/><text x="46" y="20" font-size="9" font-weight="700" text-anchor="middle" fill="#fff">1</text></svg>` },
  { id: 'messages', name: 'Messages', blurb: '2 unread threads',
    svg: `<svg viewBox="0 0 64 64">${T('msg', S(0, '#7c5cff') + S(1, '#2fb9ff'))}
      <rect x="10" y="14" width="44" height="30" rx="10" fill="#ffffff"/>
      <path d="M22 44 L18 52 L30 44 Z" fill="#ffffff"/>
      <circle cx="24" cy="29" r="3.4" fill="#7c5cff"/><circle cx="33" cy="29" r="3.4" fill="#2fb9ff"/>
      <circle cx="42" cy="29" r="3.4" fill="#ffb020"/></svg>` },
  { id: 'climate', name: 'Climate', blurb: '21.5° · auto · seats on',
    svg: `<svg viewBox="0 0 64 64">${T('clim', S(0, '#22d3ee') + S(1, '#2563eb'))}
      <g fill="#ffffff" opacity=".92"><ellipse cx="32" cy="22" rx="6" ry="10"/>
      <ellipse cx="32" cy="22" rx="6" ry="10" transform="rotate(120 32 32)"/>
      <ellipse cx="32" cy="22" rx="6" ry="10" transform="rotate(240 32 32)"/></g>
      <circle cx="32" cy="32" r="6" fill="#ffb020"/><circle cx="32" cy="32" r="2.4" fill="#7c2d12"/></svg>` },
  { id: 'camera', name: 'Camera', blurb: 'Dashcam · recording',
    svg: `<svg viewBox="0 0 64 64">${T('cam', S(0, '#64748b') + S(1, '#0f172a'))}
      <circle cx="30" cy="34" r="15" fill="#0b1220" stroke="#e2e8f0" stroke-width="3.5"/>
      <circle cx="30" cy="34" r="8" fill="#38bdf8"/><circle cx="30" cy="34" r="4" fill="#0c4a6e"/>
      <circle cx="27" cy="31" r="2.2" fill="#ffffff"/>
      <circle cx="50" cy="14" r="5" fill="#ff5a5a"/></svg>` },
  { id: 'photos', name: 'Photos', blurb: 'Track day · 48 shots',
    svg: `<svg viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="15" fill="#f1f5f9"/>
      <g transform="translate(32 32)"><ellipse cx="0" cy="-9" rx="7" ry="11" fill="#f43f5e"/>
      <ellipse cx="0" cy="-9" rx="7" ry="11" fill="#f59e0b" transform="rotate(90)"/>
      <ellipse cx="0" cy="-9" rx="7" ry="11" fill="#22c55e" transform="rotate(180)"/>
      <ellipse cx="0" cy="-9" rx="7" ry="11" fill="#3b82f6" transform="rotate(270)"/>
      <circle r="5" fill="#f1f5f9"/></g></svg>` },
  { id: 'tune', name: 'Tune', blurb: 'Wing 14° · 2.0 Hz · ABS on',
    svg: `<svg viewBox="0 0 64 64">${T('tune', S(0, '#fbbf24') + S(1, '#ef4444'))}
      <g stroke="#ffffff" stroke-width="4.5" stroke-linecap="round">
      <circle cx="32" cy="32" r="10" fill="none"/>
      <path d="M32 10v9M32 45v9M10 32h9M45 32h9M16.4 16.4l6.4 6.4M41.2 41.2l6.4 6.4M47.6 16.4l-6.4 6.4M22.8 41.2l-6.4 6.4"/></g>
      <circle cx="32" cy="32" r="4" fill="#7c2d12"/></svg>` },
  { id: 'data', name: 'Data', blurb: '182 km/h · gear 5',
    svg: `<svg viewBox="0 0 64 64">${T('data', S(0, '#4f46e5') + S(1, '#7c3aed'))}
      <rect x="13" y="36" width="8" height="14" rx="2" fill="#22d3ee"/>
      <rect x="25" y="28" width="8" height="22" rx="2" fill="#3ddc84"/>
      <rect x="37" y="20" width="8" height="30" rx="2" fill="#ffb020"/>
      <polyline points="13,32 25,24 37,26 51,12" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/></svg>` },
  { id: 'session', name: 'Session', blurb: 'Lobby 3/8 · ready',
    svg: `<svg viewBox="0 0 64 64">${T('sess', S(0, '#334155') + S(1, '#020617'))}
      <rect x="12" y="10" width="5" height="44" rx="2" fill="#ffb020"/>
      <g><rect x="19" y="12" width="9" height="9" fill="#ffffff"/><rect x="28" y="12" width="9" height="9" fill="#0f172a"/>
      <rect x="37" y="12" width="9" height="9" fill="#ffffff"/><rect x="19" y="21" width="9" height="9" fill="#0f172a"/>
      <rect x="28" y="21" width="9" height="9" fill="#ffffff"/><rect x="37" y="21" width="9" height="9" fill="#0f172a"/>
      <rect x="19" y="30" width="9" height="9" fill="#ffffff"/><rect x="28" y="30" width="9" height="9" fill="#0f172a"/>
      <rect x="37" y="30" width="9" height="9" fill="#ffffff"/></g>
      <circle cx="48" cy="46" r="7" fill="#3ddc84"/><path d="M44.5 46l2.5 2.5 4.5-5" stroke="#04140b" stroke-width="2.5" fill="none"/></svg>` },
  { id: 'contacts', name: 'Contacts', blurb: '4 friends · 2 online',
    svg: `<svg viewBox="0 0 64 64">${T('con', S(0, '#2dd4bf') + S(1, '#0ea5e9'))}
      <circle cx="24" cy="24" r="9" fill="#ffffff"/><path d="M10 50c1-9 7-14 14-14s13 5 14 14" fill="#ffffff"/>
      <circle cx="44" cy="26" r="7" fill="#fef08a"/><path d="M34 50c1-7 5-11 10-11s9 4 10 11" fill="#fef08a"/></svg>` },
  { id: 'weather', name: 'Weather', blurb: 'Benoni · 21° · clear',
    svg: `<svg viewBox="0 0 64 64">${T('wx', S(0, '#38bdf8') + S(1, '#818cf8'))}
      <g stroke="#ffd23d" stroke-width="3.5" stroke-linecap="round">
      <path d="M22 10v6M10 22h6M12.2 12.2l4.2 4.2"/></g>
      <circle cx="24" cy="24" r="10" fill="#ffd23d"/>
      <ellipse cx="40" cy="42" rx="14" ry="9" fill="#ffffff"/>
      <ellipse cx="32" cy="38" rx="9" ry="7" fill="#e0f2fe"/></svg>` },
  { id: 'clock', name: 'Clock', blurb: 'Lap timer · 1:24.6',
    svg: `<svg viewBox="0 0 64 64">${T('clk', S(0, '#0f172a') + S(1, '#475569'))}
      <circle cx="32" cy="32" r="21" fill="#f8fafc"/>
      <path d="M32 32 L32 17" stroke="#f59e0b" stroke-width="4" stroke-linecap="round"/>
      <path d="M32 32 L42 38" stroke="#0ea5e9" stroke-width="4" stroke-linecap="round"/>
      <circle cx="32" cy="32" r="3" fill="#ef4444"/></svg>` },
  { id: 'settings', name: 'Settings', blurb: 'Units · language · HMI',
    svg: `<svg viewBox="0 0 64 64">${T('set', S(0, '#94a3b8') + S(1, '#334155'))}
      <g stroke="#ffffff" stroke-width="4" stroke-linecap="round">
      <circle cx="32" cy="32" r="9" fill="none"/>
      <path d="M32 13v7M32 44v7M13 32h7M44 32h7M18.6 18.6l5 5M40.4 40.4l5 5M45.4 18.6l-5 5M23.6 40.4l-5 5"/></g>
      <circle cx="32" cy="32" r="4.5" fill="#ffd23d"/></svg>` },
];

export const icon = (id) => APPS.find((a) => a.id === id)?.svg ?? '';
export const appName = (id) => APPS.find((a) => a.id === id)?.name ?? id;
export const appBlurb = (id) => APPS.find((a) => a.id === id)?.blurb ?? '';
