// Railway graph: nodes + edges with the same topology machinery as roads (centrelines,
// continuation smoothing, spatial queries). Lives on RoadNetwork as `net.rail` so a city file
// carries roads and railways together; the editor drives both through one undo history.
import { Centerline } from './centerline.js';
import { getRailProfile } from './railProfiles.js';

export class RailNetwork {
  constructor() {
    this.nodes = new Map();   // id -> {id,x,z,y,station,name}
    this.edges = new Map();   // id -> {id,a,b,profile,pts:[{x,z,y?}],name,features:[]}
    this.adj = new Map();     // nodeId -> Set(edgeId)
    this.cl = new Map();      // centreline cache
    this.seq = 1;
    this.onTouch = null;
  }

  id(prefix) { return prefix + (this.seq++).toString(36); }

  addNode(n) {
    const node = { id: n.id || this.id('rn'), x: n.x, z: n.z, y: n.y || 0, station: !!n.station, name: n.name || '' };
    this.nodes.set(node.id, node);
    if (!this.adj.has(node.id)) this.adj.set(node.id, new Set());
    if (this.onTouch) this.onTouch('rnode', node.id);
    return node;
  }
  addEdge(e) {
    const edge = { id: e.id || this.id('re'), a: e.a, b: e.b, profile: e.profile || 'heavy2', pts: e.pts || [], name: e.name || '', features: e.features || [] };
    this.edges.set(edge.id, edge);
    if (!this.adj.has(edge.a)) this.adj.set(edge.a, new Set());
    if (!this.adj.has(edge.b)) this.adj.set(edge.b, new Set());
    this.adj.get(edge.a).add(edge.id);
    this.adj.get(edge.b).add(edge.id);
    if (this.onTouch) this.onTouch('redge', edge.id);
    return edge;
  }
  removeEdge(id) {
    const e = this.edges.get(id); if (!e) return;
    if (this.onTouch) this.onTouch('redge', id);
    this.adj.get(e.a)?.delete(id); this.adj.get(e.b)?.delete(id);
    this.edges.delete(id); this.cl.delete(id);
  }
  removeNode(id) {
    for (const eid of [...(this.adj.get(id) || [])]) this.removeEdge(eid);
    if (this.onTouch && this.nodes.has(id)) this.onTouch('rnode', id);
    this.nodes.delete(id); this.adj.delete(id);
  }
  touchNode(id) { if (this.onTouch) this.onTouch('rnode', id); }
  touchEdge(id) { if (this.onTouch) this.onTouch('redge', id); this.cl.delete(id); }
  nodeEdges(id) { return [...(this.adj.get(id) || [])].map(e => this.edges.get(e)).filter(Boolean); }
  other(edge, nodeId) { return edge.a === nodeId ? edge.b : edge.a; }
  family(edge) { return getRailProfile(edge).family; }

  rawDir(edge, nodeId) {
    const pts = this.controlPoints(edge);
    const p0 = nodeId === edge.a ? pts[0] : pts[pts.length - 1];
    const p1 = nodeId === edge.a ? pts[1] : pts[pts.length - 2];
    const l = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
    return [(p1.x - p0.x) / l, (p1.z - p0.z) / l];
  }
  controlPoints(edge) {
    const A = this.nodes.get(edge.a), B = this.nodes.get(edge.b);
    return [{ x: A.x, z: A.z, y: A.y }, ...edge.pts, { x: B.x, z: B.z, y: B.y }];
  }

  // Degree-2 node whose two edges share a profile and run nearly straight: track flows through.
  isContinuation(nodeId) {
    const es = this.nodeEdges(nodeId);
    const node = this.nodes.get(nodeId);
    if (!node || es.length !== 2 || node.station) return false;
    if (es[0].profile !== es[1].profile) return false;
    const [ax, az] = this.rawDir(es[0], nodeId), [bx, bz] = this.rawDir(es[1], nodeId);
    return ax * bx + az * bz < -0.94;
  }
  continuationAxis(edge, nodeId) {
    const es = this.nodeEdges(nodeId), o = es[0].id === edge.id ? es[1] : es[0];
    const [ax, az] = this.rawDir(edge, nodeId), [bx, bz] = this.rawDir(o, nodeId);
    const l = Math.hypot(ax - bx, az - bz) || 1;
    return [(ax - bx) / l, (az - bz) / l];
  }

  centerline(edge) {
    let c = this.cl.get(edge.id);
    if (c) return c;
    const opts = {};
    if (this.isContinuation(edge.a)) opts.t0 = this.continuationAxis(edge, edge.a);
    if (this.isContinuation(edge.b)) { const [x, z] = this.continuationAxis(edge, edge.b); opts.t1 = [-x, -z]; }
    c = new Centerline(this.controlPoints(edge), opts);
    this.cl.set(edge.id, c);
    return c;
  }
  invalidate(edgeIds) { for (const id of edgeIds) this.cl.delete(id); }

  stats() {
    let km = 0;
    const byFamily = {};
    for (const e of this.edges.values()) {
      const L = this.centerline(e).length / 1000;
      km += L;
      const f = this.family(e);
      byFamily[f] = (byFamily[f] || 0) + L;
    }
    return { nodes: this.nodes.size, edges: this.edges.size, km, byFamily };
  }

  toJSON() {
    return { seq: this.seq, nodes: [...this.nodes.values()], edges: [...this.edges.values()] };
  }
  static fromJSON(j) {
    const r = new RailNetwork();
    r.seq = j.seq || 1;
    for (const x of j.nodes || []) { r.nodes.set(x.id, { ...x }); if (!r.adj.has(x.id)) r.adj.set(x.id, new Set()); }
    for (const e of j.edges || []) {
      if (!r.nodes.has(e.a) || !r.nodes.has(e.b)) continue;
      r.edges.set(e.id, { features: [], pts: [], ...e });
      r.adj.get(e.a).add(e.id); r.adj.get(e.b).add(e.id);
    }
    return r;
  }
}

// Split a rail edge at arclength s; returns the new node.
export function splitRailEdgeAt(rail, e, s) {
  const c = rail.centerline(e);
  const L = c.length;
  if (s < 2) return rail.nodes.get(e.a);
  if (s > L - 2) return rail.nodes.get(e.b);
  const f = c.frameAt(s);
  const n = rail.addNode({ x: f.x, z: f.z, y: f.y });
  const ctrl = rail.controlPoints(e);
  const cs = c.ctrlS;
  const left = [], right = [];
  for (let i = 1; i < ctrl.length - 1; i++) {
    if (cs[i] < s - 3) left.push(e.pts[i - 1]); else if (cs[i] > s + 3) right.push(e.pts[i - 1]);
  }
  const base = { profile: e.profile, name: e.name };
  rail.addEdge({ ...base, a: e.a, b: n.id, pts: left, features: e.features.filter(ft => ft.s < s - 1).map(ft => ({ ...ft })) });
  rail.addEdge({ ...base, a: n.id, b: e.b, pts: right, features: e.features.filter(ft => ft.s > s + 1).map(ft => ({ ...ft, s: ft.s - s })) });
  rail.removeEdge(e.id);
  return n;
}
