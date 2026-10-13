// The 5 app-grid designs + collections (folders, dock, chunks). DOM-free:
// GRIDS is the registry the shell renders and Checks.mjs pins.

export const GRIDS = [
  { id: 'pages', name: 'Pages', desc: 'Classic phone grid · swipe pages + dock' },
  { id: 'folders', name: 'Folders', desc: 'Category folders with live previews' },
  { id: 'tiles', name: 'Tiles', desc: 'Mixed-size live tiles + widgets' },
  { id: 'drawer', name: 'Drawer', desc: 'Search + alphabetical list' },
  { id: 'cards', name: 'Cards', desc: 'Snap-scroll carousel of app cards' },
];

export const FOLDERS = [
  { name: 'Drive', apps: ['nav', 'tune', 'data', 'session'] },
  { name: 'Media', apps: ['media', 'photos', 'camera'] },
  { name: 'Comms', apps: ['phone', 'messages', 'contacts'] },
  { name: 'System', apps: ['climate', 'weather', 'clock', 'settings'] },
];

export const DOCK = ['phone', 'messages', 'nav', 'media'];

// Pages grid: 5 columns x 2 rows per page (landscape tablet).
export const PAGE_COLS = 5, PAGE_ROWS = 2;
export const PAGE_SIZE = PAGE_COLS * PAGE_ROWS;

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
