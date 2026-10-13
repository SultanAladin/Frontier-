// HMI theme tokens — the single contract the tablet, the cluster and the C++
// port all read. Palette is the SpatialHud instrument habit (cyan accent,
// amber caution, near-black card) so the whole car reads as one system.
// C++ landing spot: HmiWorldStructure theme block. DOM-free: Checks.mjs
// imports this in node.

export const Theme = {
  bg: '#070b0f',        // glass-off black
  bgSoft: '#0b1116',    // page background
  card: '#121a21',      // card / sheet surface
  cardEdge: 'rgba(255,255,255,0.08)',
  accent: '#14b8f2',    // cyan — primary, selections, links
  caution: '#ff991f',   // amber — warnings, sport, shift flash
  marking: '#dbe6f2',   // primary text
  muted: '#8b98a5',     // secondary text
  faint: '#4a5560',     // disabled / captions
  ok: '#3ddc84',
  danger: '#ff5a5a',
  radius: 14,           // [px] card radius at 1440 wide
  rail: 84,             // [px] left icon rail width
  status: 44,           // [px] status bar height
  font: '"DM Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
  mono: 'ui-monospace,"SF Mono",Consolas,monospace',
};

// Relative luminance 0..1 of an #rrggbb token — used by Checks.mjs to pin the
// contract "text is brighter than its card, accent is visible on bg".
export function luminance(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = v.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
