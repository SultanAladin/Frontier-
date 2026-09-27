// Small math helpers shared by the track builder and the car controller.

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Smooth 0..1 ease with zero derivative at both ends (Hermite).
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Symmetric bump shaped like a hill: 0 outside [center-halfWidth, center+halfWidth], 1 at center.
export function bump(x, center, halfWidth) {
  const d = Math.abs(x - center);
  if (d >= halfWidth) return 0;
  const t = 1 - d / halfWidth;
  return t * t * (3 - 2 * t);
}

export function degToRad(d) {
  return (d * Math.PI) / 180;
}

// Exponential smoothing usable with a variable dt ("lerp toward target at rate k per second").
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}
