// Optional roadside protection is rendered as an independent overlay. The ordinary road
// ribbons, curb solver, and junction meshes stay unchanged when no guardrail is configured.
import { box, sweep, yawFor } from './out.js';
import { normalizeGuardrail } from '../infrastructure.js';

const sideList = side => side === 'left' ? [-1] : side === 'right' ? [1] : [-1, 1];

function rectangle(width, bottom, top) {
  const half = width / 2;
  return [[-half, bottom], [half, bottom], [half, top], [-half, top], [-half, bottom]];
}

function beamSection(style, height) {
  if (style === 'wbeam' || style === 'thrie') {
    const waves = style === 'thrie' ? 3 : 2;
    const half = style === 'thrie' ? 0.23 : 0.15;
    const face = Array.from({ length: waves * 2 + 1 }, (_, i) => [
      i % 2 ? 0.045 : -0.035,
      height - half + (i * 2 * half) / (waves * 2),
    ]);
    return [...face, ...face.slice().reverse().map(([o, y]) => [o - 0.008, y]), face[0]];
  }
  if (style === 'boxbeam') {
    const bottom = height - 0.11, top = height + 0.11;
    return [
      [-0.08, bottom], [0.08, bottom], [0.08, top], [-0.08, top], [-0.08, bottom],
      [-0.065, bottom + 0.015], [-0.065, top - 0.015], [0.065, top - 0.015],
      [0.065, bottom + 0.015], [-0.065, bottom + 0.015],
    ];
  }
  return null;
}

function addCable(out, frames, offset, baseY, height, level, radius = 0.014) {
  const center = baseY + height * level;
  const circle = Array.from({ length: 9 }, (_, i) => {
    const a = (i % 8) * Math.PI / 4;
    return [Math.cos(a) * radius, center + Math.sin(a) * radius];
  });
  sweep(out, 'steel', frames, circle, offset);
}

function addGuardrailShape(out, style, frames, offset, baseY, height) {
  if (style === 'concrete') {
    const h = Math.max(0.5, height);
    const profile = [
      [-0.32, baseY], [-0.24, baseY + h * 0.24], [-0.11, baseY + h * 0.82],
      [-0.1, baseY + h], [0.1, baseY + h], [0.11, baseY + h * 0.82],
      [0.24, baseY + h * 0.24], [0.32, baseY],
    ];
    sweep(out, 'barrier', frames, profile.slice().reverse(), offset);
    return;
  }
  if (style === 'cable') {
    for (const level of [0.3, 0.5, 0.7, 0.9]) addCable(out, frames, offset, baseY, height, level);
    return;
  }
  if (style === 'railing') {
    for (const level of [0.38, 0.7, 0.97]) {
      const center = height * level;
      sweep(out, 'steel', frames, rectangle(0.046, baseY + center - 0.023, baseY + center + 0.023), offset);
    }
    return;
  }
  if (style === 'parapet') {
    sweep(out, 'concrete', frames, rectangle(0.24, baseY, baseY + 0.2), offset);
    addCable(out, frames, offset, baseY, height, 0.96, 0.033);
    addCable(out, frames, offset, baseY, height, 0.28, 0.024);
    return;
  }
  const section = beamSection(style, baseY + height - (style === 'thrie' ? 0.23 : style === 'boxbeam' ? 0.11 : 0.15));
  if (section) sweep(out, 'steel', frames, section, offset);
}

/** Add one or both configured protection runs to the independently built road output. */
export function buildRoadGuardrails(out, edge, c, lay, s0, s1, ctx = {}) {
  const raw = edge.flags?.roadGuardrail;
  if (!raw || s1 - s0 < 0.8) return 0;
  const config = normalizeGuardrail(raw);
  const step = Math.max(1.2, Math.min(3.0, config.postSpacing * 0.75));
  const stations = c.stations(s0, s1, [], step, 0.025);
  const centerFrames = stations.map(s => c.frameAt(s));
  const outerLeft = lay.lanes[0], outerRight = lay.lanes[lay.lanes.length - 1];

  for (const side of sideList(config.side)) {
    const offset = side < 0 ? lay.left - 0.24 : lay.right + 0.24;
    const outer = side < 0 ? outerLeft : outerRight;
    const baseY = outer?.h || 0;
    const frames = centerFrames;
    addGuardrailShape(out, config.style, frames, offset, baseY, config.height);

    if (config.style === 'concrete' || ctx.props === false) continue;
    const postSpacing = ['railing', 'parapet'].includes(config.style)
      ? Math.min(config.postSpacing, 2.5)
      : config.postSpacing;
    const start = s0 + Math.min(0.3, (s1 - s0) / 3);
    const mount = config.style === 'thrie' ? 0.25 : config.style === 'boxbeam' ? 0.1 : 0.16;
    for (let s = start; s < s1 - 0.15; s += postSpacing) {
      const f = c.frameAt(s);
      const yaw = yawFor(-f.nx * side, -f.nz * side);
      out.prop('roadPost', f.x + f.nx * offset, f.y + baseY, f.z + f.nz * offset, yaw, 1, config.height, 1);
      if (['wbeam', 'thrie', 'boxbeam'].includes(config.style)) {
        box(out, 'steel', f.x + f.nx * offset, f.y + baseY + config.height - mount,
          f.z + f.nz * offset, f.tx, f.tz, 0.07, 0.1, 0.055);
      }
    }
  }
  return centerFrames.length;
}
