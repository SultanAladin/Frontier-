// Moving trains: heavy-rail consists, suspended-monorail cabins and city trams.
// Routes are walked over the rail graph / road graph (right-hand running on double track),
// with station/halting stops, braking curves and dwell times; each car follows the centreline
// so consists bend correctly through turnouts and curves.
import * as THREE from 'three';
import { getRailProfile, railLayout, MONO_BEAM_D } from '../road/railProfiles.js';
import { getProfile, layout } from '../road/profiles.js';
import { railCenterline, TRACK_SPACING } from '../road/geom/rail.js';
import { computeRailJunction } from '../road/railJunction.js';

export const RAIL_TOP = 0.42;          // heavy-rail head above the formation frame
export const MONO_HANG = { top: -1.8, floor: -4.5, width: 2.6 };  // cabin envelope below beam top

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ routes
// A route is legs [{frame(s)->{x,y,z,tx,tz}, len}] with cumulative distances, stops [{d, dwell}]
// and either loop (circular) or ping-pong (reverse at the ends) motion.
class Route {
  constructor() { this.legs = []; this.cum = [0]; this.stops = []; this.loop = false; this.total = 0; }
  addLeg(frame, len) {
    if (len < 0.5) return;
    this.legs.push({ frame, len });
    this.total += len;
    this.cum.push(this.total);
  }
  addStop(d, dwell) { if (d > 3) this.stops.push({ d, dwell }); }
  finalize() {
    this.stops = this.stops.filter(st => st.d > 3 && st.d < this.total - 3).sort((a, b) => a.d - b.d);
  }
  frameAt(s) {
    s = this.loop ? ((s % this.total) + this.total) % this.total : Math.min(Math.max(s, 0), this.total);
    let lo = 0, hi = this.legs.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.cum[m + 1] < s) lo = m + 1; else hi = m; }
    const leg = this.legs[lo];
    return leg.frame(Math.min(Math.max(s - this.cum[lo], 0), leg.len));
  }
}

// Walk the rail graph from a starting edge/direction; random choice at turnouts.
export function walkRailRoute(rail, junctions, edge, dir, rng, maxLegs = 80) {
  const route = new Route();
  const fam = rail.family(edge);
  let e = edge, d = dir;
  const seen = new Set();
  for (let k = 0; k < maxLegs; k++) {
    const c = rail.centerline(e), len = c.length;
    const lay = railLayout(getRailProfile(e));
    const oc = lay.offs.length > 1 ? (d > 0 ? lay.offs[lay.offs.length - 1] : lay.offs[0]) : (lay.offs[0] || 0);
    const lift = fam === 'mono' ? 0 : RAIL_TOP;
    const base = route.total;
    route.addLeg(s => {
      const ls = d > 0 ? s : len - s;
      const f = c.frameAt(Math.min(Math.max(ls, 0), len));
      return {
        x: f.x + f.nx * oc, y: (f.y || 0) + lift, z: f.z + f.nz * oc,
        tx: f.tx * d, tz: f.tz * d,
      };
    }, len);
    // heavy halts sit partway along the edge
    if (fam === 'heavy') for (const ft of e.features || []) {
      if (ft.type !== 'halt') continue;
      route.addStop(base + (d > 0 ? ft.s : len - ft.s), 8);
    }
    const key = e.id + ':' + d;
    if (seen.has(key)) { route.loop = true; break; }
    seen.add(key);
    const node = d > 0 ? e.b : e.a;
    // mono stations are nodes: stop at the leg boundary
    if (fam === 'mono') {
      let J = junctions?.get(node);
      if (!J) { J = computeRailJunction(rail, node); junctions?.set(node, J); }
      if (J.kind === 'station') route.addStop(route.total, 10);
    }
    const cands = rail.nodeEdges(node).filter(x => x.id !== e.id && rail.family(x) === fam);
    if (!cands.length) break;                                  // buffer / terminus: reverse here
    const nx = cands[(rng() * cands.length) | 0];
    d = nx.a === node ? 1 : -1;
    e = nx;
  }
  route.finalize();
  return route.legs.length ? route : null;
}

// Walk road edges that carry tram lanes; stop short of busy junctions like a real tram stop.
export function walkTramRoute(net, edge, dir, rng, maxLegs = 80) {
  const route = new Route();
  const hasTram = e => layout(getProfile(e)).lanes.some(l => l.type === 'tram');
  let e = edge, d = dir;
  const seen = new Set();
  const pickLane = (ed, dd) => {
    const trams = layout(getProfile(ed)).lanes.filter(l => l.type === 'tram');
    return trams.find(l => (l.dir || 0) === dd) || trams.find(l => !(l.dir || 0)) || trams[0];
  };
  for (let k = 0; k < maxLegs; k++) {
    const c = net.centerline(e), len = c.length;
    const lane = pickLane(e, d);
    const oc = (lane.o0 + lane.o1) / 2, lift = 0.12;
    const base = route.total;
    route.addLeg(s => {
      const ls = d > 0 ? s : len - s;
      const f = c.frameAt(Math.min(Math.max(ls, 0), len));
      return {
        x: f.x + f.nx * oc, y: (f.y || 0) + lift, z: f.z + f.nz * oc,
        tx: f.tx * d, tz: f.tz * d,
      };
    }, len);
    const key = e.id + ':' + d;
    if (seen.has(key)) { route.loop = true; break; }
    seen.add(key);
    const node = d > 0 ? e.b : e.a;
    const cands = net.nodeEdges(node).filter(x => x.id !== e.id && hasTram(x));
    if (net.nodeEdges(node).length >= 3 && route.total > 30) route.addStop(route.total - 12, 6);
    if (!cands.length) break;
    // prefer the straightest continuation so trams don't sawtooth through grids
    const inT = (() => { const f = c.frameAt(d > 0 ? len : 0); return [f.tx * d, f.tz * d]; })();
    let best = null, bestDot = -2;
    for (const x of cands) {
      const xc = net.centerline(x), atA = x.a === node;
      const f = xc.frameAt(atA ? 0 : xc.length);
      const dot = inT[0] * f.tx * (atA ? 1 : -1) + inT[1] * f.tz * (atA ? 1 : -1);
      if (dot > bestDot + 0.15 || (best && dot > bestDot && rng() < 0.25)) { bestDot = dot; best = x; }
      if (!best) { best = x; bestDot = dot; }
    }
    d = best.a === node ? 1 : -1;
    e = best;
  }
  route.finalize();
  return route.legs.length ? route : null;
}

// Legacy polyline railway: a shuttle running the line end to end.
function legacyRoute(net, rail) {
  const rc = railCenterline(rail), len = rc.length;
  if (len < 20) return null;
  const route = new Route();
  const offs = (rail.tracks || 2) === 1 ? [0] : [-TRACK_SPACING / 2, TRACK_SPACING / 2];
  route.addLeg(s => {
    const f = rc.frameAt(Math.min(Math.max(s, 0), len));
    return { x: f.x + f.nx * offs[1], y: RAIL_TOP, z: f.z + f.nz * offs[1], tx: f.tx, tz: f.tz };
  }, len);
  return route;
}

// ------------------------------------------------------------------ vehicles
const MATS = {};
function mat(name, color, opts = {}) {
  const k = name + color;
  if (!MATS[k]) MATS[k] = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, ...opts });
  return MATS[k];
}
const GEO = {};
function box(w, h, l) {
  const k = `b${w},${h},${l}`;
  if (!GEO[k]) GEO[k] = new THREE.BoxGeometry(w, h, l);
  return GEO[k];
}
function cyl(rt, rb, h, seg = 12) {
  const k = `c${rt},${rb},${h},${seg}`;
  if (!GEO[k]) GEO[k] = new THREE.CylinderGeometry(rt, rb, h, seg);
  return GEO[k];
}
function part(group, geo, material, x, y, z, ry = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  if (ry) m.rotation.y = ry;
  m.castShadow = true;
  group.add(m);
  return m;
}

// car origin: track centre at rail head (heavy/tram) or beam top (mono), +Z = forward.
function buildLoco(livery) {
  const g = new THREE.Group(), L = 18;
  part(g, box(2.9, 2.6, L * 0.92), mat('body', livery), 0, 2.5, 0);
  part(g, box(2.92, 0.7, L * 0.94), mat('stripe', 0xe8e4da), 0, 1.55, 0);
  part(g, box(2.5, 0.9, L * 0.3), mat('cab', 0x22303c, { roughness: 0.3, metalness: 0.5 }), 0, 3.6, L * 0.28);
  part(g, box(2.5, 0.9, L * 0.3), mat('cab', 0x22303c, { roughness: 0.3, metalness: 0.5 }), 0, 3.6, -L * 0.28);
  part(g, box(2.7, 0.25, L * 0.8), mat('roof', 0x3a3f45), 0, 3.95, 0);
  // pantograph
  part(g, box(0.08, 1.3, 0.08), mat('dark', 0x1c1e22), -0.5, 4.6, 0);
  part(g, box(0.08, 1.3, 0.08), mat('dark', 0x1c1e22), 0.5, 4.6, 0);
  part(g, box(1.6, 0.08, 0.5), mat('dark', 0x1c1e22), 0, 5.25, 0);
  for (const zs of [5.8, -5.8]) {
    part(g, box(2.4, 0.9, 3.4), mat('dark', 0x1c1e22), 0, 0.75, zs);
    for (const dx of [-1.05, 1.05]) for (const dz of [-1.1, 1.1]) {
      const w = part(g, cyl(0.45, 0.45, 0.3), mat('wheel', 0x2a2d33, { metalness: 0.7 }), dx, 0.45, zs + dz);
      w.rotation.z = Math.PI / 2;
    }
  }
  const head = part(g, box(0.5, 0.35, 0.1), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 }), -0.8, 2.2, L * 0.47);
  const tail = part(g, box(0.5, 0.35, 0.1), new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2222, emissiveIntensity: 1.2 }), 0.8, 2.2, -L * 0.47);
  return { group: g, len: L, head, tail };
}
function buildWagon(kind, i) {
  const g = new THREE.Group(), L = 14;
  const colors = [0x7a4a2b, 0x4a6b8a, 0x5a7a3a, 0x8a8a7a, 0x6b4a6e];
  if (kind === 'tank') {
    const t = part(g, cyl(1.4, 1.4, L * 0.86, 16), mat('tank', 0xb9bcbe, { metalness: 0.6, roughness: 0.35 }), 0, 2.2, 0);
    t.rotation.x = Math.PI / 2;
    part(g, box(2.2, 0.5, L * 0.86), mat('dark', 0x1c1e22), 0, 0.85, 0);
  } else if (kind === 'flat') {
    part(g, box(2.8, 0.5, L * 0.94), mat('flat', 0x5a4a3a), 0, 1.15, 0);
    part(g, box(2.4, 1.6, 4.5), mat('crate', colors[i % colors.length]), 0, 2.2, -2.5);
    part(g, box(2.4, 1.6, 4.5), mat('crate', colors[(i + 2) % colors.length]), 0, 2.2, 2.5);
  } else {
    part(g, box(2.9, 2.8, L * 0.94), mat('box', colors[i % colors.length]), 0, 2.4, 0);
    part(g, box(2.95, 0.3, L * 0.94), mat('roof', 0x3a3f45), 0, 3.9, 0);
  }
  for (const zs of [4.4, -4.4]) {
    part(g, box(2.4, 0.9, 3.0), mat('dark', 0x1c1e22), 0, 0.75, zs);
    for (const dx of [-1.05, 1.05]) for (const dz of [-0.9, 0.9]) {
      const w = part(g, cyl(0.45, 0.45, 0.3), mat('wheel', 0x2a2d33, { metalness: 0.7 }), dx, 0.45, zs + dz);
      w.rotation.z = Math.PI / 2;
    }
  }
  return { group: g, len: L };
}
// Suspended cabin: origin at beam top, body hangs in the MONO_HANG envelope.
function buildMonoCabin() {
  const g = new THREE.Group(), L = 10;
  const cy = (MONO_HANG.top + MONO_HANG.floor) / 2;      // -3.15
  const ch = MONO_HANG.top - MONO_HANG.floor;            // 2.7
  part(g, box(MONO_HANG.width, ch, L * 0.96), mat('monoBody', 0xe8e0cc), 0, cy, 0);
  part(g, box(MONO_HANG.width + 0.04, 0.8, L * 0.9), mat('monoBand', 0x1c7a8a), 0, cy + ch / 2 - 0.5, 0);
  part(g, box(MONO_HANG.width + 0.06, 0.9, L * 0.7), mat('cab', 0x22303c, { roughness: 0.3, metalness: 0.5 }), 0, cy + 0.35, 0);
  part(g, box(MONO_HANG.width * 0.7, 0.18, L * 0.9), mat('roof', 0x8a8578), 0, MONO_HANG.top + 0.09, 0);
  for (const zs of [L * 0.32, -L * 0.32]) {
    // hanger arms rise past the beam underside into the running channels
    part(g, box(0.18, 1.1, 0.5), mat('dark', 0x2a2d33), -0.32, MONO_HANG.top + 0.55, zs);
    part(g, box(0.18, 1.1, 0.5), mat('dark', 0x2a2d33), 0.32, MONO_HANG.top + 0.55, zs);
    part(g, box(0.9, 0.3, 0.7), mat('bogie', 0x3a3f45), 0, -MONO_BEAM_D + 0.1, zs);
  }
  const head = part(g, box(0.4, 0.3, 0.1), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 }), 0, cy + 0.4, L * 0.49);
  return { group: g, len: L, head };
}
function buildTramSection(first) {
  const g = new THREE.Group(), L = 7.5;
  part(g, box(2.4, 2.0, L * 0.96), mat('tramBody', 0x2e6e4e), 0, 1.9, 0);
  part(g, box(2.44, 0.9, L * 0.8), mat('cab', 0x22303c, { roughness: 0.3, metalness: 0.5 }), 0, 2.5, 0);
  part(g, box(2.42, 0.35, L * 0.94), mat('tramCream', 0xe8e0cc), 0, 1.15, 0);
  part(g, box(2.2, 0.2, L * 0.9), mat('roof', 0x9a958a), 0, 3.0, 0);
  if (first) {
    part(g, box(0.08, 1.2, 0.08), mat('dark', 0x1c1e22), -0.4, 3.6, 0);
    part(g, box(0.08, 1.2, 0.08), mat('dark', 0x1c1e22), 0.4, 3.6, 0);
    part(g, box(1.4, 0.08, 0.4), mat('dark', 0x1c1e22), 0, 4.2, 0);
  }
  for (const zs of [L * 0.32, -L * 0.32]) {
    part(g, box(2.0, 0.8, 1.8), mat('dark', 0x1c1e22), 0, 0.6, zs);
    for (const dx of [-0.72, 0.72]) for (const dz of [-0.5, 0.5]) {
      const w = part(g, cyl(0.34, 0.34, 0.25), mat('wheel', 0x2a2d33, { metalness: 0.7 }), dx, 0.34, zs + dz);
      w.rotation.z = Math.PI / 2;
    }
  }
  const head = first ? part(g, box(0.4, 0.3, 0.1), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 }), 0, 1.7, L * 0.49) : null;
  return { group: g, len: L, head };
}

// ------------------------------------------------------------------ trains
const GAP = 1.2;
class Train {
  constructor(route, cars, opts) {
    this.route = route;
    this.cars = cars;
    this.kind = opts.kind || 'heavy';
    this.vmax = opts.vmax; this.acc = opts.acc; this.brake = opts.brake;
    this.s = opts.s0 ?? 0;
    this.dir = opts.dir ?? 1;
    this.v = 0;
    this.dwell = 0;
    this.group = new THREE.Group();
    // car offsets behind the head
    let back = 0;
    for (const c of cars) {
      back += c.len / 2;
      c.back = back;
      back += c.len / 2 + GAP;
      this.group.add(c.group);
    }
    this.place();
  }
  nextStop() {
    const R = this.route;
    if (this.dir > 0) {
      for (const st of R.stops) if (st.d > this.s + 0.6) return st;
      if (R.loop && R.stops.length) return { d: R.stops[0].d + R.total, dwell: R.stops[0].dwell };
    } else {
      for (let i = R.stops.length - 1; i >= 0; i--) if (R.stops[i].d < this.s - 0.6) return R.stops[i];
      if (R.loop && R.stops.length) { const l = R.stops[R.stops.length - 1]; return { d: l.d - R.total, dwell: l.dwell }; }
    }
    return null;
  }
  step(dt) {
    const R = this.route;
    if (this.dwell > 0) { this.dwell -= dt; this.v = 0; this.place(); return; }
    let target = this.vmax;
    const st = this.nextStop();
    if (st) {
      const dist = Math.abs(st.d - this.s);
      target = Math.min(target, Math.sqrt(2 * this.brake * Math.max(0, dist)));
      if (dist < 0.9 && this.v < 0.6) {
        this.s = ((st.d % R.total) + R.total) % R.total;
        this.v = 0; this.dwell = st.dwell;
        this.place();
        return;
      }
    }
    // ends of a ping-pong route: brake to a stop, then reverse
    if (!R.loop) {
      const endD = this.dir > 0 ? R.total - this.s : this.s;
      target = Math.min(target, Math.sqrt(2 * this.brake * Math.max(0, endD)));
      if (endD < 0.9 && this.v < 0.6) { this.dir *= -1; this.dwell = 2; this.flipLights(); this.place(); return; }
    }
    this.v += Math.sign(target - this.v) * Math.min(Math.abs(target - this.v), (target > this.v ? this.acc : this.brake * 1.6) * dt);
    this.s += this.dir * this.v * dt;
    if (R.loop) this.s = ((this.s % R.total) + R.total) % R.total;
    else this.s = Math.min(Math.max(this.s, 0), R.total);
    this.place();
  }
  flipLights() {
    for (const c of this.cars) {
      if (!c.head || !c.tail) continue;
      const h = c.head.material.emissiveIntensity;
      c.head.material.emissiveIntensity = c.tail.material.emissiveIntensity;
      c.tail.material.emissiveIntensity = h;
    }
  }
  place() {
    const R = this.route;
    for (const c of this.cars) {
      let cs = this.s - this.dir * c.back;
      if (R.loop) cs = ((cs % R.total) + R.total) % R.total;
      const f = R.frameAt(cs);
      const g = R.frameAt(cs + this.dir * 2);
      c.group.position.set(f.x, f.y, f.z);
      c.group.rotation.order = 'YXZ';
      c.group.rotation.y = Math.atan2(f.tx * this.dir, f.tz * this.dir);
      c.group.rotation.x = -Math.atan2(g.y - f.y, 2);
    }
  }
}

// ------------------------------------------------------------------ system
export class TrainSystem {
  constructor(scene, net, opts = {}) {
    this.scene = scene;
    this.net = net;
    this.group = new THREE.Group();
    this.group.name = 'trains';
    scene.add(this.group);
    this.trains = [];
    this.junctions = opts.railJunctions || new Map();
    const rng = mulberry32(opts.seed ?? 7);
    const counts = { heavy: 3, mono: 2, tram: 4, legacy: 2, ...opts.counts };
    // kept progress from a previous system, per kind, so edits don't teleport trains
    const keepQ = {};
    for (const k of opts.keep || []) (keepQ[k.kind] || (keepQ[k.kind] = [])).push(k);
    const keep = kind => (keepQ[kind] || []).shift();
    const rail = net.rail;
    if (rail) {
      const heavy = [...rail.edges.values()].filter(e => rail.family(e) === 'heavy');
      const mono = [...rail.edges.values()].filter(e => rail.family(e) === 'mono');
      for (let i = 0; i < counts.heavy && heavy.length; i++) {
        const e = heavy[(rng() * heavy.length) | 0];
        const r = walkRailRoute(rail, this.junctions, e, rng() < 0.5 ? 1 : -1, rng);
        if (r && r.total > 60) this.addHeavy(r, rng, { kind: 'heavy', keep: keep('heavy') });
      }
      for (let i = 0; i < counts.mono && mono.length; i++) {
        const e = mono[(rng() * mono.length) | 0];
        const r = walkRailRoute(rail, this.junctions, e, rng() < 0.5 ? 1 : -1, rng);
        if (r && r.total > 60) this.addMono(r, rng, keep('mono'));
      }
    }
    const tramEdges = [...net.edges.values()].filter(e => layout(getProfile(e)).lanes.some(l => l.type === 'tram'));
    for (let i = 0; i < counts.tram && tramEdges.length; i++) {
      const e = tramEdges[(rng() * tramEdges.length) | 0];
      const r = walkTramRoute(net, e, rng() < 0.5 ? 1 : -1, rng);
      if (r && r.total > 60) this.addTram(r, rng, keep('tram'));
    }
    const legacy = [...net.rails.values()];
    for (let i = 0; i < counts.legacy && i < legacy.length; i++) {
      const r = legacyRoute(net, legacy[i % legacy.length]);
      if (r) this.addHeavy(r, rng, { shuttle: true, kind: 'legacy', keep: keep('legacy') });
    }
  }
  addHeavy(route, rng, o = {}) {
    const kinds = ['box', 'tank', 'flat'];
    const cars = [buildLoco(0x9e2b25)];
    const n = o.shuttle ? 2 : 3 + ((rng() * 2) | 0);
    for (let i = 0; i < n; i++) cars.push(buildWagon(kinds[(rng() * 3) | 0], i));
    const r0 = rng();   // drawn always: keeps the rng sequence identical with or without kept progress
    const t = new Train(route, cars, { kind: o.kind || 'heavy', vmax: getRailProfile({ profile: 'heavy2' }).speed, acc: 0.7, brake: 0.9, s0: o.keep ? o.keep.frac * route.total : r0 * route.total, dir: o.keep?.dir || 1 });
    this.trains.push(t);
    this.group.add(t.group);
  }
  addMono(route, rng, kp) {
    const cars = [buildMonoCabin(), buildMonoCabin(), buildMonoCabin()];
    const r0 = rng();   // drawn always: keeps the rng sequence identical with or without kept progress
    const t = new Train(route, cars, { kind: 'mono', vmax: getRailProfile({ profile: 'mono2' }).speed, acc: 0.9, brake: 1.1, s0: kp ? kp.frac * route.total : r0 * route.total, dir: kp?.dir || 1 });
    this.trains.push(t);
    this.group.add(t.group);
  }
  addTram(route, rng, kp) {
    const cars = [buildTramSection(true), buildTramSection(false)];
    // bellows between sections
    const bel = new THREE.Mesh(box(2.0, 2.2, GAP + 0.6), mat('bel', 0x1c1e22));
    cars[0].group.add(bel);
    bel.position.set(0, 1.9, -cars[0].len / 2 - GAP / 2);
    const r0 = rng();   // drawn always: keeps the rng sequence identical with or without kept progress
    const t = new Train(route, cars, { kind: 'tram', vmax: 11, acc: 1.1, brake: 1.4, s0: kp ? kp.frac * route.total : r0 * route.total, dir: kp?.dir || 1 });
    this.trains.push(t);
    this.group.add(t.group);
  }
  update(dt) {
    if (!this.group.visible) return;
    dt = Math.min(dt, 0.1);
    for (const t of this.trains) t.step(dt);
  }
  setVisible(v) { this.group.visible = v; }
  dispose() {
    this.scene.remove(this.group);
    this.trains = [];
  }
}
