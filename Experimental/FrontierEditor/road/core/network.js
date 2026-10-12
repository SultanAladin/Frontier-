// Frontier Road Editor — the road network model.
//
// A network is nodes (junctions) and roads (polylines carrying a cross-section).
// Junction geometry is derived, never stored: every incident road end is trimmed
// back by a fixed-point solve so that no carriageway overshoots its neighbour,
// and the junction surface, kerb loops and corner fillets all fall out of those
// same trim lines. That is what makes the topology exact — the road ribbon and
// the junction ring share vertices by construction rather than by cleanup.

import {
  add2, sub2, mul2, norm2, left2, dot2, dist2, angle2, angleDelta,
  clamp, lerp, resample, catmullRom,
} from './math.js';
import { expandProfile, ROAD_CLASSES, roadVariation } from './styles.js';
import { clipHalfPlane, dedupeLoop, ensureUpFacing, loopSelfIntersects } from './poly.js';

const BIG = 1e4;

/** Radius of the circle through three plan points; Infinity when they are collinear. */
function circumRadius(a, b, c) {
  const ab = dist2(a, b), bc = dist2(b, c), ca = dist2(c, a);
  const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  if (area2 < 1e-9) return Infinity;
  return (ab * bc * ca) / (2 * area2);
}

/**
 * Pull every station whose three-point radius is below `minR` toward the chord
 * between its neighbours, ends fixed. Returns the number of passes that were
 * needed — zero means the plan was already clear.
 */
function smoothRadius(pts, minR, passes) {
  const n = pts.length;
  if (n < 4) return 0;
  let worst = 0;
  for (let pass = 0; pass < passes; pass++) {
    worst = Infinity;
    let moved = false;
    const next = pts.map((p) => p.slice());
    for (let i = 1; i < n - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const r = circumRadius(a, b, c);
      worst = Math.min(worst, r);
      if (r < minR) {
        next[i][0] = lerp(b[0], (a[0] + c[0]) / 2, 0.5);
        next[i][1] = lerp(b[1], (a[1] + c[1]) / 2, 0.5);
        moved = true;
      }
    }
    for (let i = 0; i < n; i++) pts[i] = next[i];
    if (!moved || worst >= minR) return pass + 1;
  }
  return passes;
}

export class RoadNetwork {
  constructor(opts = {}) {
    this.opts = {
      driveSide: opts.driveSide || 'left',
      seed: opts.seed ?? 1,
      step: opts.step ?? 2.0,
      curveStep: opts.curveStep ?? 1.0,
      maxGrade: opts.maxGrade ?? 0.085,
      junctionMargin: opts.junctionMargin ?? 0.4,
      cornerRadiusDefault: opts.cornerRadiusDefault ?? 8,
    };
    this.nodes = [];
    this.roads = [];
    this.terrainH = opts.terrainH || (() => 0);
    this.stats = { trims: 0, junctionFallbacks: 0, laneConnections: 0, roadsByClass: {} };
    this._nodeGrid = new Map();
  }

  // ── construction ───────────────────────────────────────────────────────────
  cellKey(p, cell = 8) { return `${Math.floor(p[0] / cell)}:${Math.floor(p[1] / cell)}`; }

  addNode(p, tags = {}) {
    const node = {
      id: this.nodes.length, p: [p[0], p[1]],
      y: tags.y ?? this.terrainH(p[0], p[1]),
      tags: { ...tags },
      roads: [], // {road, end}
      plan: null,
    };
    this.nodes.push(node);
    const k = this.cellKey(p);
    if (!this._nodeGrid.has(k)) this._nodeGrid.set(k, []);
    this._nodeGrid.get(k).push(node);
    return node;
  }

  /** Nearest existing node within `tol`, else null. */
  findNode(p, tol = 3) {
    const cell = 8;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const k = `${Math.floor(p[0] / cell) + dx}:${Math.floor(p[1] / cell) + dz}`;
        for (const n of this._nodeGrid.get(k) || []) if (dist2(n.p, p) <= tol) return n;
      }
    }
    return null;
  }

  findOrAddNode(p, tags = {}, tol = 3) { return this.findNode(p, tol) || this.addNode(p, tags); }

  addRoad(a, b, opts = {}) {
    const A = typeof a === 'number' ? this.nodes[a] : a;
    const B = typeof b === 'number' ? this.nodes[b] : b;
    const cls = opts.class || 'street';
    const section = opts.section || opts.profile || null;
    const profile = expandProfile(section || defaultSectionFor(cls, opts), {
      driveSide: this.opts.driveSide,
      oneWay: opts.oneWay,
      laneWidths: opts.laneWidths,
      widthScale: opts.widthScale,
      centreMarking: opts.centreMarking,
      speed: ROAD_CLASSES[cls]?.speed,
      shared: opts.shared,
    });
    const road = {
      id: this.roads.length, a: A.id, b: B.id, class: cls,
      ctrl: opts.ctrl ? opts.ctrl.map((p) => [p[0], p[1]]) : null, // extra control points (excluding ends)
      section: profile.id, profile,
      oneWay: profile.oneWay, name: opts.name || null,
      flags: {
        bridge: !!opts.bridge, tunnel: !!opts.tunnel, elevated: !!opts.elevated,
        interchange: !!opts.interchange, rail: profile.railway, metro: opts.metro || false,
        busCorridor: !!opts.busCorridor, cycleRoute: !!opts.cycleRoute, parking: opts.parking ?? null,
        scenic: !!opts.scenic, service: !!opts.service, waterfront: !!opts.waterfront,
        ramp: !!opts.ramp, noThrough: !!opts.noThrough, private: !!opts.private,
        divided: !!profile.median, deckY: opts.deckY ?? null, boreY: opts.boreY ?? null,
        starts: opts.starts ?? null,
      },
      variation: roadVariation(this.roads.length, this.opts.seed),
      junctions: { a: null, b: null },
      laneGraph: null,
      samples: null,
      stats: {},
    };
    if (opts.ctrl && opts.ctrl.length) road.ctrl = opts.ctrl.map((p) => [p[0], p[1]]);
    this.roads.push(road);
    A.roads.push({ road, end: 'a' }); B.roads.push({ road, end: 'b' });
    this.stats.roadsByClass[cls] = (this.stats.roadsByClass[cls] || 0) + 1;
    return road;
  }

  /** Full raw polyline including the node positions (plan space). */
  roadPlan(road) {
    const A = this.nodes[road.a], B = this.nodes[road.b];
    if (road.ctrl && road.ctrl.length) return catmullRom([A.p, ...road.ctrl, B.p], 10);
    return [A.p.slice(), B.p.slice()];
  }

  // ── elevation + sampling ───────────────────────────────────────────────────
  /**
   * Sample a road: uniform stations in plan space with elevation, tangent and
   * left normal. Trim lengths from the junction solve are kept, not applied —
   * the mesher decides what part of the ribbon it draws.
   */
  sampleRoad(road, opts = {}) {
    if (road.samples && !opts.force) return road.samples;
    const raw = this.roadPlan(road);
    const step = opts.step ?? (road.ctrl ? this.opts.curveStep : this.opts.step);
    const { pts, s, length } = resample(raw, step);
    // A centreline tighter than the section's own half width folds the outer
    // edge over itself: the ribbon crosses, the kerbs swap sides and the deck
    // comes out with triangles facing both ways. Straighten the plan until every
    // station's radius clears the corridor, and remember how hard it had to try.
    const minR = (road.profile?.corridorHalf ?? 8) * 1.15 + 0.5;
    const passes = smoothRadius(pts, minR, opts.maxSmooth ?? 60);
    if (passes > 0) {
      const r2 = resample(pts, step);
      pts.length = 0; s.length = 0;
      pts.push(...r2.pts); s.push(...r2.s);
    }
    const lengthFix = s.length ? s[s.length - 1] : length;
    void lengthFix;
    const n = pts.length;
    const y = new Array(n);

    if (road.flags.bridge || road.flags.tunnel || road.flags.elevated) {
      // Deck / bore roads run on their own alignment: straight interpolation
      // between the end elevations with a slight camber.
      const ya = this.nodes[road.a].y, yb = this.nodes[road.b].y;
      for (let i = 0; i < n; i++) {
        const t = length > 0 ? s[i] / length : 0;
        y[i] = lerp(ya, yb, t) + Math.sin(Math.PI * t) * (road.flags.camber ?? 0);
      }
    } else {
      for (let i = 0; i < n; i++) y[i] = this.terrainH(pts[i][0], pts[i][1]);
      y[0] = this.nodes[road.a].y; y[n - 1] = this.nodes[road.b].y;
      this.limitGrade(y, s, this.opts.maxGrade);
      for (let pass = 0; pass < 2; pass++) {
        const copy = y.slice();
        for (let i = 1; i < n - 1; i++) y[i] = (copy[i - 1] + 2 * copy[i] + copy[i + 1]) / 4;
        y[0] = this.nodes[road.a].y; y[n - 1] = this.nodes[road.b].y;
      }
    }

    const p3 = new Array(n), tangent = new Array(n), left = new Array(n), grade = new Array(n);
    for (let i = 0; i < n; i++) {
      p3[i] = [pts[i][0], y[i], pts[i][1]];
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(n - 1, i + 1)];
      const d = norm2(sub2(next, prev));
      const t = (d[0] || d[1]) ? d : [1, 0];
      tangent[i] = t;
      left[i] = left2(t);
      const ip = Math.max(0, i - 1), inx = Math.min(n - 1, i + 1);
      const dl = Math.max(1e-4, s[inx] - s[ip]);
      grade[i] = (y[inx] - y[ip]) / dl;
    }
    const curvature = new Array(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      const dl = Math.max(1e-4, s[i + 1] - s[i - 1]);
      curvature[i] = Math.abs(angleDelta(angle2(tangent[i - 1]), angle2(tangent[i + 1]))) / dl;
    }
    road.samples = {
      pts: p3, plan: pts, s, length: s[s.length - 1] ?? length, tangent, left, grade, curvature,
      smoothed: passes, minRadius: minR, count: n,
    };
    return road.samples;
  }

  limitGrade(y, s, maxGrade) {
    for (let i = 1; i < y.length; i++) {
      const ds = s[i] - s[i - 1];
      y[i] = clamp(y[i], y[i - 1] - maxGrade * ds, y[i - 1] + maxGrade * ds);
    }
    for (let i = y.length - 2; i >= 0; i--) {
      const ds = s[i + 1] - s[i];
      y[i] = clamp(y[i], y[i + 1] - maxGrade * ds, y[i + 1] + maxGrade * ds);
    }
  }

  /** Position/tangent at a station offset (m) from the start node. */
  pointAt(road, offset, opts = {}) {
    const sm = road.samples || this.sampleRoad(road, opts);
    const { s, pts, tangent, left, grade } = sm;
    const t = clamp(offset, 0, sm.length);
    let i = 0;
    while (i < s.length - 2 && s[i + 1] < t) i++;
    const seg = Math.max(1e-6, s[i + 1] - s[i]);
    const u = clamp((t - s[i]) / seg, 0, 1);
    const p = [lerp(pts[i][0], pts[i + 1][0], u), lerp(pts[i][1], pts[i + 1][1], u), lerp(pts[i][2], pts[i + 1][2], u)];
    const dir = norm2([lerp(tangent[i][0], tangent[i + 1][0], u), lerp(tangent[i][1], tangent[i + 1][1], u)]);
    return { p, dir, left: left2(dir), grade: lerp(grade[i], grade[i + 1], u), index: i, u };
  }

  // ── junction solve ─────────────────────────────────────────────────────────
  incidentEnds(node) {
    const out = [];
    for (const { road, end } of node.roads) {
      const sm = this.sampleRoad(road);
      const i = end === 'a' ? 0 : sm.count - 1;
      const toward = end === 'a' ? 1 : -1;
      const dir = end === 'a' ? sm.tangent[0] : [-sm.tangent[sm.count - 1][0], -sm.tangent[sm.count - 1][1]];
      const half = road.profile.carriagewayHalf;
      // left-hand normal of the outward direction: the kerb line on each side
      const l = left2(dir);
      out.push({
        road, end, dir, left: l, half,
        corridorHalf: road.profile.corridorHalf,
        angle: angle2(dir),
        rail: !!road.profile.railway,
        profile: road.profile,
        toward,
      });
    }
    out.sort((p, q) => angleDelta(0, p.angle) - angleDelta(0, q.angle));
    return out;
  }

  /**
   * Trim distances. A junction is the intersection of the incident cut lines:
   * the half-plane dot(dir_i, x - c) <= trim_i for every arm i. It is only
   * non-degenerate when every mouth (the 2*half_i wide end edge of road i) is
   * inside *all* the other half-planes, so the solve pushes each neighbour's
   * trim out until that holds. Near-parallel arms are skipped: their mouths
   * merge anyway and their projection is unbounded.
   */
  solveTrims(node, inc, pairs, marginArg) {
    const n = inc.length;
    const margin = marginArg ?? this.opts.junctionMargin;
    const minTrim = inc.map((e) => e.half + margin);

    // Acute pairs (arms meeting at under ~48°) have a runaway trim: pushing one mouth out
    // of the neighbour's ribbon pushes the neighbour's containment further out
    // too, so the fixpoint spirals to the cap. The two kerb lines cross at the
    // pair's corner point K, and a mouth at K is tangent to both kerbs — anything
    // beyond it is inside the neighbour's ribbon, so K bounds the trim.
    const limits = inc.map(() => Infinity);
    if (pairs) {
      for (const { geom, a, b } of pairs) {
        if (!geom) continue;
        // Only acute pairs run away: on an obtuse pair the mouth of one arm
        // projects behind the node on the other, so the fixpoint settles.
        if (dot2(a.dir, b.dir) <= 0) continue;
        if (Math.abs(a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0]) >= 0.75) continue;
        const idxA = inc.indexOf(a), idxB = inc.indexOf(b);
        const limA = dot2(sub2(geom.corner, node.p), a.dir) + margin;
        const limB = dot2(sub2(geom.corner, node.p), b.dir) + margin;
        if (idxA >= 0) limits[idxA] = Math.min(limits[idxA], limA);
        if (idxB >= 0) limits[idxB] = Math.min(limits[idxB], limB);
      }
    }

    const trims = minTrim.slice();
    if (pairs) {
      for (const { geom, a, b } of pairs) {
        const idxA = inc.indexOf(a), idxB = inc.indexOf(b);
        // Corridor constraint: the two corridor (footway outer) edges of a pair
        // meet at the block corner. The mouth must reach past it or the sidewalk
        // corner would spill into the road bands; capped, because on a wide
        // obtuse corner the block corner is legitimately far away.
        const cross = Math.abs(a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0]);
        if (cross >= 0.18) {
          const outerA = armOuter(a, -1), outerB = armOuter(b, +1);
          const X = lineIntersect2D(
            add2(node.p, mul2(a.left, -outerA)), a.dir,
            add2(node.p, mul2(b.left, outerB)), b.dir,
          );
          if (X) {
            const needA = dot2(sub2(X, node.p), a.dir) + margin;
            const needB = dot2(sub2(X, node.p), b.dir) + margin;
            const capOut = 2.5 * Math.max(outerA, outerB);
            if (needA <= capOut && idxA >= 0) trims[idxA] = Math.max(trims[idxA], needA);
            if (needB <= capOut && idxB >= 0) trims[idxB] = Math.max(trims[idxB], needB);
          }
        }
        // Fillet constraint: a fillet is tangent to the two kerb lines at
        // stations K+r, so the trim must reach that station or the kerb curve
        // would start outside the junction, inside a road ribbon.
        if (geom) {
          if (idxA >= 0) trims[idxA] = Math.max(trims[idxA], geom.stationA + 0.001);
          if (idxB >= 0) trims[idxB] = Math.max(trims[idxB], geom.stationB + 0.001);
        }
      }
    }
    for (let i = 0; i < n; i++) trims[i] = Math.min(trims[i], Math.max(limits[i], minTrim[i]));

    const cap = Math.max(...inc.map((e) => e.half)) / Math.max(0.2, Math.min(...pairwiseSin(inc))) * 3;
    for (let iter = 0; iter < 24; iter++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        const e = inc[i];
        const base = add2(node.p, mul2(e.dir, trims[i]));
        for (const lateral of [e.half, -e.half]) {
          const mouth = add2(base, mul2(e.left, lateral));
          for (let j = 0; j < n; j++) {
            if (j === i) continue;
            const other = inc[j];
            if (Math.abs(other.dir[0] * e.dir[1] - other.dir[1] * e.dir[0]) < 0.25) continue;
            const need = dot2(other.dir, sub2(mouth, node.p)) + margin;
            if (need > trims[j] + 1e-6) {
              const hi = Math.min(cap, limits[j]);
              trims[j] = Math.min(need, Math.max(hi, trims[j]));
              changed = true;
              this.stats.trims++;
            }
          }
        }
      }
      if (!changed) break;
      if (iter === 23) this.stats.junctionFallbacks++;
    }
    return trims;
  }

  cutLineWidth(loop, c, inc, trim) {
    // Length of the part of the loop boundary lying on road i's cut line.
    let best = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      const da = dot2(inc.dir, sub2(a, c)) - trim;
      const db = dot2(inc.dir, sub2(b, c)) - trim;
      if (Math.abs(da) < 1e-6 && Math.abs(db) < 1e-6) best = Math.max(best, dist2(a, b));
    }
    return best;
  }

  /**
   * Plan a junction. Everything the mesher needs, derived from the trim solve:
   *
   *   pavement     drivable loop: mouths + kerb runs + corner arcs
   *   mouths[i]    the road ribbon's end edge — the same vertices the ribbon
   *                ends on, so ribbon and junction are watertight by construction
   *   corners[i]   sidewalk corner polygon between inc[i] and inc[i+1]: bounded
   *                inward by the two kerb runs and the fillet arc, outward by
   *                the corridor edges (building line), ends by the mouth lines
   *   inc[i].splitLeft / splitRight
   *                station at which the road's raised side bands (kerb, footway,
   *                verge, cycle track) start — the corner polygon owns the band
   *                between the mouth and the arc
   */
  planJunction(node, opts = {}) {
    if (node.plan && !opts.force) return node.plan;
    const inc = this.incidentEnds(node);
    if (inc.length === 0) { node.plan = null; return null; }
    if (inc.length === 1) return this.planJunctionOnce(node, inc, opts);

    // Escalation. Clustered arms and near-parallel pairs can make the first
    // attempt's mouth ring fold onto itself; each retry widens the junction or
    // drops the fillets, and a wider junction with square corners is always the
    // simpler construction. The last attempt is kept even if it folds, but it is
    // flagged, because shipping a folded ring silently is worse than saying so.
    const tries = [
      {}, { margin: 1.6 }, { margin: 2.4 }, { noFillets: true },
      { margin: 2.4, noFillets: true }, { margin: 4, noFillets: true },
    ];
    let plan = null;
    let attempt = 0;
    for (const tune of tries) {
      attempt++;
      plan = this.planJunctionOnce(node, inc, opts, tune);
      if (!plan.selfIntersects) { plan.retry = attempt > 1 ? { attempt, ...tune } : null; break; }
      this.stats.junctionRetries = (this.stats.junctionRetries || 0) + 1;
    }
    plan.retry = attempt > 1 ? { attempt, tune: tries[attempt - 1] } : null;

    // Arms that overlap: under ~14° apart no trim line can separate two ribbons,
    // so the pair needs a merge taper. Reported rather than faked.
    plan.overlap = [];
    for (let i = 0; i < inc.length; i++) {
      for (let j = i + 1; j < inc.length; j++) {
        if (Math.abs(inc[i].dir[0] * inc[j].dir[1] - inc[i].dir[1] * inc[j].dir[0]) < 0.24) {
          plan.overlap.push([i, j]);
          this.stats.overlappingArms = (this.stats.overlappingArms || 0) + 1;
        }
      }
    }

    for (let i = 0; i < inc.length; i++) {
      const e = inc[i];
      const prev = e.road.junctions[e.end] || {};
      e.road.junctions[e.end] = {
        ...prev, node: node.id, trim: plan.trims[i], plan, index: i, mouth: plan.mouths[i],
      };
    }
    node.plan = plan;
    return plan;
  }

  planJunctionOnce(node, inc, opts = {}, tune = {}) {
    if (opts.force) node.plan = null;
    const margin = this.opts.junctionMargin * (tune.margin || 1);

    if (inc.length === 1) {
      const e = inc[0];
      const trim = e.half + this.opts.junctionMargin;
      const mouthLeft = add2(node.p, add2(mul2(e.dir, trim), mul2(e.left, e.half)));
      const mouthRight = add2(node.p, add2(mul2(e.dir, trim), mul2(e.left, -e.half)));
      const plan = {
        node, inc, type: 'terminus', trims: [trim], corners: [], fillets: [], mouths: [{
          road: e.road, end: e.end, index: 0, trim, left: mouthLeft, right: mouthRight, exposed: true,
        }],
        pavement: ensureUpFacing([mouthLeft, mouthRight, add2(node.p, mul2(e.dir, trim))]),
        rail: !!e.rail, roundaboutRadius: 0, armCount: 1, midPoint: node.p.slice(),
      };
      e.road.junctions[e.end] = { node: node.id, trim, plan, index: 0, mouth: plan.mouths[0], splitLeft: trim, splitRight: trim };
      node.plan = plan;
      return plan;
    }

    const n = inc.length;
    const trims = [];
    const roundaboutRadius = node.tags.roundabout ? (node.tags.roundaboutRadius || 18) : 0;
    const type = roundaboutRadius ? 'roundabout'
      : (node.tags.junction || (inc.some((e) => e.rail) ? 'rail' : defaultJunctionType(inc)));

    // Corners. Each angularly adjacent pair gets one kerb geometry (a fillet
    // disc tangent to both kerb lines, or the sharp kerb corner) and one shared
    // path, used by both the pavement loop and the sidewalk corner polygon so
    // the two tile the corner exactly: no overlap, no crack, any radius.
    //
    //   pocket  (sidewalk) = mouthA → box corner C → mouthB → back along the
    //                        kerbs, detouring around the fillet arc
    //   pavement           = the same path mirrored, so the corner the fillet
    //                        cuts away becomes drivable — which is what a kerb
    //                        fillet is for.
    const rawPairs = [];
    for (let i = 0; i < n; i++) {
      const a = inc[i], b = inc[(i + 1) % n];
      const skip = a.rail || b.rail || type === 'shared' || type === 'rail' || opts.noFillets || tune.noFillets;
      const geom = skip ? null : cornerGeometry(node, a, b, cornerRadiusFor(a.road, b.road, this.opts));
      rawPairs.push({ a, b, geom });
    }
    const solved = this.solveTrims(node, inc, rawPairs, margin);
    for (let i = 0; i < n; i++) trims[i] = solved[i];

    const fillets = [];
    const corners = [];
    const cornerPaths = [];
    for (let i = 0; i < n; i++) {
      const a = inc[i], b = inc[(i + 1) % n];
      const trimA = trims[i], trimB = trims[(i + 1) % n];
      const mouthA = add2(node.p, add2(mul2(a.dir, trimA), mul2(a.left, -a.half)));
      const mouthB = add2(node.p, add2(mul2(b.dir, trimB), mul2(b.left, b.half)));
      const geom = rawPairs[i].geom;
      const K = geom ? geom.corner : (kerbCorner(node, a, b) || mouthA);
      // Shallow pairs (arms within ~20°) have no corner to round: the two mouths
      // nearly touch and the "kerb corner" is tens of metres away. The corner is
      // then a plain shared surface, counted so the fraction stays visible.
      const shallow = Math.abs(a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0]) < 0.35;

      // Only keep the fillet when its tangents really sit inside the pocket.
      let fillet = null;
      let kerbLegs = null;
      if (geom && geom.stationA <= trimA + 1e-6 && geom.stationB <= trimB + 1e-6) {
        fillet = geom;
        kerbLegs = { a: trimA - geom.stationA, b: trimB - geom.stationB };
      }

      // Kerb-side path from mouthA to mouthB, the boundary between the junction
      // pavement and the sidewalk pocket.
      const path = [mouthA];
      if (shallow) {
        this.stats.shallowCorners = (this.stats.shallowCorners || 0) + 1;
      } else if (fillet) {
        path.push(fillet.tangentA);
        for (const p of fillet.arc) path.push(p);
        path.push(fillet.tangentB);
      } else if (!shallow) {
        path.push(K);
      }
      path.push(mouthB);
      const cleanPath = dedupeLoop(path, 1e-7);
      cornerPaths.push(cleanPath);

      fillets.push(fillet);
      if (fillet) {
        this.stats.filletCount = (this.stats.filletCount || 0) + 1;
        this.stats.filletRadiusSum = (this.stats.filletRadiusSum || 0) + fillet.radius;
        this.stats.filletMin = Math.min(this.stats.filletMin ?? Infinity, fillet.radius);
      }

      // Sidewalk pocket: the mirrored kerb path inside, the block corner
      // outside. When both mouths reach past their corridors the two corridor
      // edges meet at the block corner, so the sidewalk fills the corner the way
      // a real kerb does; otherwise the two mouth lines bound a shallower wedge.
      const C = lineIntersect2D(add2(node.p, mul2(a.dir, trimA)), a.left, add2(node.p, mul2(b.dir, trimB)), b.left);
      const skip = shallow || (!geom && (a.rail || b.rail || type === 'shared' || type === 'rail'));
      if (skip) { corners.push(null); continue; }
      const outerA = armOuter(a, -1), outerB = armOuter(b, +1);
      const outA = add2(mouthA, mul2(a.left, -(outerA - a.half)));
      const outB = add2(mouthB, mul2(b.left, outerB - b.half));
      const deep = trimA >= outerA + 0.05 && trimB >= outerB + 0.05;
      const X = deep ? lineIntersect2D(outA, a.dir, outB, b.dir) : null;
      let pocket;
      if (X) {
        pocket = [mouthA, outA, X, outB, mouthB];
      } else {
        if (!C || dist2(C, node.p) > 6 * Math.max(a.corridorHalf, b.corridorHalf)) {
          this.stats.pocketFallbacks = (this.stats.pocketFallbacks || 0) + 1;
          corners.push(null);
          continue;
        }
        pocket = [mouthA, C, mouthB];
      }
      for (const p of cleanPath.slice(1, -1).reverse()) pocket.push(p);
      const cleaned = dedupeLoop(pocket, 1e-7);
      if (cleaned.length < 3) { corners.push(null); continue; }
      if (loopSelfIntersects(cleaned)) {
        this.stats.pocketFallbacks = (this.stats.pocketFallbacks || 0) + 1;
        corners.push(null);
        continue;
      }
      corners.push(cleaned);
    }

    // Pavement loop, walked plan-CCW: for every arm — across the mouth
    // left→right, then the shared corner path to the next arm's mouth-left
    // corner. Mouth corners and kerb runs are the ribbon's own end profile, so
    // a ribbon's raised bands start exactly where this boundary leaves them.
    const pavement = [];
    const mouths = [];
    for (let i = 0; i < n; i++) {
      const e = inc[i];
      const trim = trims[i];
      const base = add2(node.p, mul2(e.dir, trim));
      const mouthLeft = add2(base, mul2(e.left, e.half));
      const mouthRight = add2(base, mul2(e.left, -e.half));
      mouths.push({ road: e.road, end: e.end, index: i, trim, left: mouthLeft, right: mouthRight, exposed: true });
      pavement.push(mouthLeft, mouthRight, ...cornerPaths[i]);
    }
    const pavementLoop = dedupeLoop(pavement, 1e-6);
    const pavementHit = loopSelfIntersects(pavementLoop);

    const plan = {
      node, inc, trims, type, fillets, corners, mouths,
      pavement: ensureUpFacing(pavementLoop),
      selfIntersects: pavementHit,
      roundaboutRadius: roundaboutRadius || 0,
      rail: inc.some((e) => e.rail),
      signalised: type === 'signal',
      armCount: n,
      midPoint: node.p.slice(),
    };
    for (let i = 0; i < n; i++) {
      const e = inc[i];
      const prevFillet = fillets[(i - 1 + n) % n];
      const nextFillet = fillets[i];
      e.road.junctions[e.end] = {
        node: node.id, trim: trims[i], plan, index: i, mouth: mouths[i],
        // Station where the ribbon's raised side bands (kerb, footway, verge,
        // cycle track) start: past the fillet tangent, because the corner pocket
        // owns the band between the mouth line and the arc.
        splitLeft: prevFillet ? Math.max(trims[i], prevFillet.stationB) : trims[i],
        splitRight: nextFillet ? Math.max(trims[i], nextFillet.stationA) : trims[i],
        filletLeft: prevFillet || null,
        filletRight: nextFillet || null,
      };
    }
    node.plan = plan;
    return plan;
  }

  // ── lane graph ─────────────────────────────────────────────────────────────
  /** Lanes of a road as runs with an offset band, direction and travel sense. */
  roadLanes(road) {
    if (road.laneGraph) return road.laneGraph;
    const p = road.profile;
    const lanes = [];
    for (const band of p.bands) {
      if (band.lane === false || band.rail) continue;
      const mid = (band.from + band.to) / 2;
      const width = Math.abs(band.to - band.from);
      const dir = band.dir === 'both' ? 0 : band.dir === '+' ? 1 : -1;
      lanes.push({
        id: `${road.id}:${band.side}:${band.laneIndex}`,
        road: road.id, side: band.side, index: band.laneIndex,
        role: band.role, from: band.from, to: band.to, offset: mid, width,
        dir, // +1 travels a->b, -1 travels b->a, 0 shared
        speed: p.speed, oneWay: p.oneWay,
      });
    }
    road.laneGraph = lanes;
    return lanes;
  }

  /** Count of travel lanes per direction (for capacity/geometry statistics). */
  laneCounts(road) {
    const lanes = this.roadLanes(road);
    const fwd = lanes.filter((l) => l.dir === 1).length;
    const back = lanes.filter((l) => l.dir === -1).length;
    return { forward: fwd, backward: back, shared: lanes.filter((l) => l.dir === 0).length, total: lanes.length };
  }

  /** Connect lanes across every junction (straight/left/right/u-turn). */
  buildLaneConnections() {
    let count = 0;
    for (const node of this.nodes) {
      const plan = node.plan || this.planJunction(node);
      if (!plan || plan.inc.length < 2) continue;
      if (plan.type === 'roundabout') { count += this.connectRoundabout(node, plan); continue; }
      const inc = plan.inc;
      for (const fromEnd of inc) {
        const fromLanes = this.roadLanes(fromEnd.road).filter((l) => (fromEnd.end === 'a' ? l.dir === 1 : l.dir === -1));
        for (const fl of fromLanes) {
          const conns = [];
          for (const toEnd of inc) {
            if (toEnd === fromEnd) continue;
            const outLanes = this.roadLanes(toEnd.road).filter((l) => (toEnd.end === 'a' ? l.dir === -1 : l.dir === 1));
            if (!outLanes.length) continue;
            const turn = classifyTurn(fromEnd, toEnd);
            if (turn === 'uturn' && !node.tags.uturnAllowed) continue;
            const wanted = pickOutLane(outLanes, turn, fl, fromEnd, toEnd);
            if (wanted) { conns.push({ lane: wanted.id, turn, node: node.id }); count++; }
          }
          fl.next = conns;
        }
      }
    }
    this.stats.laneConnections = count;
    return count;
  }

  connectRoundabout(node, plan) {
    let count = 0;
    const R = plan.roundaboutRadius;
    for (const e of plan.inc) {
      const inLanes = this.roadLanes(e.road).filter((l) => (e.end === 'a' ? l.dir === 1 : l.dir === -1));
      for (const fl of inLanes) {
        const ring = { id: `ring:${node.id}:0`, node: node.id, offset: R, role: 'motor', dir: 1, ring: true };
        fl.next = [{ lane: ring.id, turn: 'roundabout-entry', node: node.id }];
        count++;
      }
      const outLanes = this.roadLanes(e.road).filter((l) => (e.end === 'a' ? l.dir === -1 : l.dir === 1));
      for (const ol of outLanes) ol.prevRing = { id: `ring:${node.id}:0`, node: node.id };
    }
    return count;
  }

  /** Disjoint set over nodes connected by roads (for connectivity reporting). */
  connectivity() {
    const parent = this.nodes.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (const r of this.roads) { const a = find(r.a), b = find(r.b); if (a !== b) parent[a] = b; }
    const groups = new Map();
    for (const n of this.nodes) { const g = find(n.id); groups.set(g, (groups.get(g) || 0) + 1); }
    return { components: groups.size, largest: Math.max(0, ...groups.values()) };
  }

  sampleAll() { for (const road of this.roads) this.sampleRoad(road); }

  totals() {
    let length = 0, laneKm = 0, bridge = 0, tunnel = 0, rail = 0;
    for (const r of this.roads) {
      const sm = r.samples || this.sampleRoad(r);
      length += sm.length;
      const lanes = this.roadLanes(r).filter((l) => !l.rail && l.role !== 'footway' && l.role !== 'verge');
      laneKm += (lanes.reduce((s, l) => s + l.width, 0) * sm.length) / 1000;
      if (r.flags.bridge) bridge += sm.length;
      if (r.flags.tunnel) tunnel += sm.length;
      if (r.flags.rail || r.flags.metro) rail += sm.length;
    }
    const junctions = this.nodes.filter((n) => n.roads.length >= 3).length;
    return { roads: this.roads.length, nodes: this.nodes.length, junctions, length, laneKm, bridge, tunnel, rail, ...this.connectivity() };
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
export function defaultSectionFor(cls, opts = {}) {
  const table = {
    motorway: 'motorway-2x3', expressway: 'expressway-2x2', arterial: 'arterial-2x2',
    boulevard: 'boulevard-2x3-median', avenue: 'avenue-2x1-parking', street: 'street-2x1',
    lane: 'lane-2x1-shared', homezone: 'homezone-shared', alley: 'alley-service',
    service: 'street-2x1', ramp: 'ramp-1way', 'brt-way': 'brt-2way', 'cycle-way': 'cycle-superhighway',
    'coastal-drive': 'coastal-drive-2x1', viaduct: 'viaduct-2x2', underpass: 'underpass-2x2',
    'farm-track': 'farm-track-single', 'rail-line': 'rail-2track', 'metro-line': 'metro-2track',
    'tram-line': 'tram-median', interchange: 'ramp-1way',
  };
  return table[cls] || 'street-2x1';
}

function defaultJunctionType(inc) {
  const big = inc.filter((e) => ['motorway', 'expressway', 'arterial', 'boulevard', 'viaduct'].includes(e.road.class)).length;
  if (inc.length >= 4 && big >= 2) return 'signal';
  const minor = inc.filter((e) => ['alley', 'lane', 'homezone', 'farm-track', 'service'].includes(e.road.class)).length;
  if (minor === inc.length) return 'shared';
  if (big === 0) return 'giveway';
  return 'giveway';
}

export function cornerRadiusFor(roadA, roadB, opts = {}) {
  const speed = Math.max(roadA.profile.speed || 40, roadB.profile.speed || 40);
  const base = opts.cornerRadiusDefault ?? 8;
  const r = clamp(base * (speed / 45) ** 0.8, 2.5, 30);
  // The arc must stay inside both sidewalk bands, otherwise it would cut
  // through a corridor edge and the corner region would fold on itself.
  const bandA = roadA.profile.corridorHalf - roadA.profile.carriagewayHalf;
  const bandB = roadB.profile.corridorHalf - roadB.profile.carriagewayHalf;
  const rMax = Math.min(bandA, bandB) * 0.98;
  return clamp(r, 0.8, Math.max(0.8, rMax));
}

/** Minimum |sin| of the angle between any two arms (drives the trim cap). */
/** Outer (corridor) offset of an arm on one side: +1 = arm.left, -1 = arm right. */
function armOuter(e, sideSign) {
  const profSign = e.end === 'a' ? sideSign : -sideSign;
  const s = e.profile.sides.find((x) => x.sign === profSign);
  return s ? s.outer : e.corridorHalf;
}

function pairwiseSin(inc) {
  const out = [];
  for (let i = 0; i < inc.length; i++) {
    for (let j = i + 1; j < inc.length; j++) {
      out.push(Math.abs(inc[i].dir[0] * inc[j].dir[1] - inc[i].dir[1] * inc[j].dir[0]));
    }
  }
  return out.length ? out : [1];
}

function boxLoop(c, r) {
  return [[c[0] - r, c[1] - r], [c[0] + r, c[1] - r], [c[0] + r, c[1] + r], [c[0] - r, c[1] + r]];
}

/** Sort up to four points of a cut line by their position along the line axis. */
function orderAlong4(axis, ...pts) {
  return pts.slice().sort((p, q) => dot2(p, axis) - dot2(q, axis));
}

/**
 * Kerb corner fillet between angularly adjacent arms A = inc[i], B = inc[i+1]
 * (plan-CCW order, so the shared corner is on A's RIGHT kerb and B's LEFT kerb).
 *
 * The arc is tangent to both kerb lines, centred inside the sidewalk, and its
 * radius is clamped to min(band width) so it can never leave the sidewalk bands.
 * Tangent points are reported as stations along each arm: they may fall inside
 * the mouth lines, which is exactly what happens at a tight corner.
 */
export function cornerGeometry(node, eA, eB, radius) {
  const cross = eA.dir[0] * eB.dir[1] - eA.dir[1] * eB.dir[0];
  if (Math.abs(cross) < 0.14) return null; // near-parallel arms: no corner to round

  const sideA = -1, sideB = 1;
  const kerbA = add2(node.p, mul2(eA.left, sideA * eA.half));
  const kerbB = add2(node.p, mul2(eB.left, sideB * eB.half));
  const K = lineIntersect2D(kerbA, eA.dir, kerbB, eB.dir);
  if (!K) return null;

  const inwardA = mul2(eA.left, -sideA); // from A's corner kerb into A's carriageway
  const inwardB = mul2(eB.left, -sideB);
  const bis = norm2(add2(mul2(inwardA, -1), mul2(inwardB, -1))); // into the sidewalk
  if (!bis[0] && !bis[1]) return null;
  const cosHalf = clamp(dot2(bis, mul2(inwardA, -1)), 0.05, 1);

  // The fillet must stay inside both sidewalk bands: a wider arc would push the
  // kerb past a corridor edge and the corner would fold on itself.
  const bandA = Math.max(0.4, eA.corridorHalf - eA.half);
  const bandB = Math.max(0.4, eB.corridorHalf - eB.half);
  const r = clamp(radius, 0.8, Math.min(bandA, bandB) * 0.98);
  if (r < 0.8) return null;

  const centre = add2(K, mul2(bis, r / cosHalf));
  const tangentA = add2(centre, mul2(inwardA, r));
  const tangentB = add2(centre, mul2(inwardB, r));
  const stationA = dot2(sub2(tangentA, node.p), eA.dir);
  const stationB = dot2(sub2(tangentB, node.p), eB.dir);
  if (stationA <= 0.2 || stationB <= 0.2) return null;
  return {
    centre, radius: r, corner: K, tangentA, tangentB, stationA, stationB,
    sideA, sideB, arc: arcBetween(centre, r, tangentA, tangentB),
    clamped: r < radius - 1e-9,
  };
}

/** Backwards-compatible name used by the harness. */
export function cornerFillet(node, eA, eB, trimA, trimB, radius) {
  const g = cornerGeometry(node, eA, eB, radius);
  if (!g) return null;
  return { ...g, tangentRight: g.tangentA, tangentLeft: g.tangentB, trimA, trimB };
}

/** Short-way arc points from `from` to `to` about c (never more than a half turn). */
export function arcBetween(c, r, from, to) {
  const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
  const a1 = Math.atan2(to[1] - c[1], to[0] - c[0]);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const steps = Math.max(3, Math.ceil(Math.abs(delta) / (Math.PI / 10)));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (delta * i) / steps;
    out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
  }
  return out;
}

/**
 * Replace the parts of an open polyline that fall inside a disc with the disc's
 * arc, keeping the region outside. Returns { pts, arc } where `arc` is the run
 * of arc points actually used (the kerb curve), or null when the path misses the
 * disc entirely.
 */
export function detourAroundDisc(pts, centre, radius) {
  const r = radius;
  const hits = (p, q) => {
    // Intersections of segment p→q with the circle |x-c| = r, as t values.
    const dx = q[0] - p[0], dz = q[1] - p[1];
    const fx = p[0] - centre[0], fz = p[1] - centre[1];
    const a = dx * dx + dz * dz;
    if (a < 1e-12) return [];
    const b = 2 * (fx * dx + fz * dz);
    const c = fx * fx + fz * fz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 1e-9) return [];
    const sq = Math.sqrt(Math.max(0, disc));
    const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
    const out = [];
    for (const t of [t1, t2]) if (t > 1e-7 && t < 1 - 1e-7) out.push(t);
    return out.sort((x, y) => x - y);
  };
  const inside = (p) => (p[0] - centre[0]) ** 2 + (p[1] - centre[1]) ** 2 < r * r - 1e-9;
  const out = [];
  let arc = null;
  let insideState = inside(pts[0]);
  if (insideState) pts = pts.slice(); // trimmed below if the very first point is inside
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    const ts = hits(p, q);
    if (!ts.length) {
      if (!insideState) out.push(p);
      continue;
    }
    let cursor = 0;
    for (const t of ts) {
      const point = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      if (!insideState) {
        out.push(p);
        out.push(point);
        insideState = true;
        arc = { entry: point, exit: null, points: [point], runs: [] };
      } else {
        insideState = false;
        if (arc) {
          const a0 = Math.atan2(arc.entry[1] - centre[1], arc.entry[0] - centre[0]);
          const a1 = Math.atan2(point[1] - centre[1], point[0] - centre[0]);
          const chord = arcBetween(centre, r, arc.entry, point);
          const midAngle = (a0 + a1) / 2;
          arc.points = chord;
          arc.exit = point;
          out.push(...chord.slice(1));
          if (!arc.runs.length) arc.runs.push(chord);
        }
        out.push(point);
      }
      cursor = t;
    }
    if (!insideState && (!ts.length || cursor === 0)) out.push(q);
    else if (!insideState && ts[ts.length - 1] < 1 - 1e-7) out.push(q);
  }
  if (insideState) return null; // path ends inside the disc: caller falls back
  const cleaned = out.filter((p, i, arr) => i === 0 || dist2(arr[i - 1], p) > 1e-7);
  if (!arc || !arc.exit) return null;
  return { pts: cleaned, arc: arc.points };
}

/** Sharp kerb corner where two arms' kerb lines cross (the no-fillet case). */
export function kerbCorner(node, eA, eB) {
  const kerbA = add2(node.p, mul2(eA.left, -eA.half));
  const kerbB = add2(node.p, mul2(eB.left, eB.half));
  return lineIntersect2D(kerbA, eA.dir, kerbB, eB.dir);
}

/**
 * The sidewalk corner: bounded inward by road A's kerb run, the fillet arc and
 * road B's kerb run; outward by the two corridor edges meeting at the building
 * line corner; and at the ends by each arm's mouth line. Every edge is shared
 * with a road ribbon or the junction pavement, so the corner neither cracks nor
 * overlaps.
 */
export function cornerSidewalkPolygon(node, a, b, trimA, trimB, fillet) {
  const sideA = -1, sideB = 1;
  const mouthA = add2(node.p, add2(mul2(a.dir, trimA), mul2(a.left, sideA * a.half)));
  const mouthB = add2(node.p, add2(mul2(b.dir, trimB), mul2(b.left, sideB * b.half)));
  const outerA = add2(node.p, add2(mul2(a.dir, trimA), mul2(a.left, sideA * a.corridorHalf)));
  const outerB = add2(node.p, add2(mul2(b.dir, trimB), mul2(b.left, sideB * b.corridorHalf)));

  const loop = [];
  const push = (p) => { if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return; const last = loop[loop.length - 1]; if (!last || dist2(last, p) > 1e-7) loop.push(p); };
  push(mouthA);
  if (fillet) {
    push(fillet.tangentRight);
    for (const p of fillet.arc) push(p);
    push(fillet.tangentLeft);
  } else {
    push(kerbCorner(node, a, b));
  }
  push(mouthB);
  push(outerB);
  // Building-line corner: where the two corridor edges cross. When they are
  // near-parallel the crossing shoots away, so fall back to a chained path.
  const corrA = add2(node.p, mul2(a.left, sideA * a.corridorHalf));
  const corrB = add2(node.p, mul2(b.left, sideB * b.corridorHalf));
  const Kc = lineIntersect2D(corrA, a.dir, corrB, b.dir);
  const far = Kc && dist2(Kc, node.p) > 6 * Math.max(a.corridorHalf, b.corridorHalf);
  if (Kc && !far) push(Kc);
  push(outerA);
  return loop.map((p) => p.slice());
}

export function lineIntersect2D(p, d, q, e) {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-12) return null;
  const w = sub2(q, p);
  const t = (w[0] * e[1] - w[1] * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

export function classifyTurn(fromEnd, toEnd) {
  const a = angle2(fromEnd.dir), b = angle2(toEnd.dir);
  const turn = angleDelta(a, b); // >0 = left (in plan with +x, +z)
  const abs = Math.abs(turn);
  if (abs > 2.6) return 'uturn';
  if (abs < 0.5) return 'straight';
  return turn > 0 ? 'left' : 'right';
}

export function pickOutLane(outLanes, turn, fromLane, fromEnd, toEnd) {
  const sorted = outLanes.slice().sort((a, b) => a.offset - b.offset);
  // 'left' means the driver crosses to the far side of the receiving carriageway.
  const cross = fromEnd.dir[0] * toEnd.dir[1] - fromEnd.dir[1] * toEnd.dir[0];
  const preferHighOffset = (turn === 'left' && cross > 0) || (turn === 'right' && cross < 0);
  if (turn === 'straight' || turn === 'uturn') {
    const mid = sorted.reduce((s, l) => s + l.offset, 0) / (sorted.length || 1);
    return sorted.sort((a, b) => Math.abs(a.offset - mid) - Math.abs(b.offset - mid))[0];
  }
  return preferHighOffset ? sorted[sorted.length - 1] : sorted[0];
}
