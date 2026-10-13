// Phone-contract gestures over Pointer Events: tap, long-press, drag, swipe,
// pinch. The tablet shell, the preview viewport and the shade all attach here;
// the recogniser reports HMI-local px, never DOM nodes, so the port keeps the
// state machine and swaps the event source for ray→UV→px.
// C++ landing spot: HmiTouchProjection.

export const TAP_MS = 300, TAP_PX = 12, LONG_MS = 500, SWIPE_PX = 48;

// Pure: classify a release flick. DOM-free so Checks.mjs pins the thresholds.
export function classifySwipe(dx, dy, dtMs) {
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (Math.max(adx, ady) < SWIPE_PX || dtMs > 800) return null;
  if (adx > ady * 1.4) return dx > 0 ? 'right' : 'left';
  if (ady > adx * 1.4) return dy > 0 ? 'down' : 'up';
  return null;
}

function localPx(el, e) {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
}

export function attachGestures(el, h = {}) {
  const pts = new Map();   // pointerId -> {x,y,t,sx,sy,moved,longFired}
  let pinch0 = 0, pinchScale = 1;
  let longTimer = 0;

  const clearLong = () => { if (longTimer) { clearTimeout(longTimer); longTimer = 0; } };

  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture?.(e.pointerId);
    const p = localPx(el, e);
    pts.set(e.pointerId, { ...p, t: performance.now(), sx: p.x, sy: p.y, moved: false, longFired: false });
    if (pts.size === 1) {
      clearLong();
      longTimer = setTimeout(() => {
        const q = pts.get(e.pointerId);
        if (q && !q.moved && h.onLongPress) { q.longFired = true; h.onLongPress(localPx(el, e)); }
      }, LONG_MS);
    }
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; pinchScale = 1;
      clearLong();
    }
    h.onDown?.(p);
  });

  el.addEventListener('pointermove', (e) => {
    const q = pts.get(e.pointerId);
    if (!q) return;
    const p = localPx(el, e);
    const dx = p.x - q.sx, dy = p.y - q.sy;
    if (Math.hypot(dx, dy) > TAP_PX) { q.moved = true; clearLong(); }
    q.x = p.x; q.y = p.y;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const s = d / pinch0;
      h.onPinch?.({ scale: s / pinchScale, total: s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 });
      pinchScale = s;
    } else if (q.moved && h.onDrag) {
      h.onDrag({ x: p.x, y: p.y, dx: p.x - (q.px ?? q.sx), dy: p.y - (q.py ?? q.sy), totalDx: dx, totalDy: dy });
    }
    q.px = p.x; q.py = p.y;
  });

  const up = (e) => {
    const q = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch0 = 0;
    if (!q) return;
    clearLong();
    const p = localPx(el, e);
    const dt = performance.now() - q.t;
    if (!q.moved && !q.longFired && dt < TAP_MS) h.onTap?.(p);
    else if (q.moved && pts.size === 0) {
      const dir = classifySwipe(p.x - q.sx, p.y - q.sy, dt);
      if (dir && h.onSwipe) h.onSwipe({ dir, ...p });
    }
    h.onUp?.(p);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
