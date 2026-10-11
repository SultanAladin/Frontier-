// The road network document: nodes, roads, subway lines, and the edit history.
// Pure data + events — nothing in here touches three.js, so the model can be
// serialised, diffed and unit-checked without a browser.

import { getProfile, cloneLanes } from './profiles.js';

export const NETWORK_VERSION = 3;

let nodeSeq = 1;
let roadSeq = 1;
let detailSeq = 1;
let lineSeq = 1;

export function makeId(prefix) {
  return `${prefix}${Date.now().toString(36)}${(Math.random() * 1e6).toFixed(0).toString(36)}`;
}

export class Network {
  constructor() {
    this.nodes = new Map();
    this.roads = new Map();
    this.subways = new Map();
    this.settings = {
      driveSide: 'right',
      curbHeight: 0.15,
      terrain: { enabled: true, amplitude: 7, scale: 620, seed: 1337 },
      city: null, // last generation parameters, kept for "regenerate"
    };
    this.listeners = new Set();
    this.history = [];
    this.historyIndex = -1;
    this.suspendHistory = false;
    this.dirty = false;
  }

  /* ---------------- events ---------------- */

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type = 'change', payload = {}) {
    this.dirty = true;
    for (const fn of this.listeners) fn({ type, ...payload });
  }

  /* ---------------- history ---------------- */

  snapshot() {
    return JSON.stringify(this.serialize());
  }

  commit(label = 'edit') {
    if (this.suspendHistory) return;
    const snap = this.snapshot();
    if (this.historyIndex >= 0 && this.history[this.historyIndex] === snap) return;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snap);
    if (this.history.length > 80) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.lastLabel = label;
  }

  undo() {
    if (this.historyIndex <= 0) return false;
    this.historyIndex--;
    this.restore(this.history[this.historyIndex]);
    return true;
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return false;
    this.historyIndex++;
    this.restore(this.history[this.historyIndex]);
    return true;
  }

  get canUndo() {
    return this.historyIndex > 0;
  }

  get canRedo() {
    return this.historyIndex < this.history.length - 1;
  }

  restore(json) {
    this.suspendHistory = true;
    this.deserialize(typeof json === 'string' ? JSON.parse(json) : json);
    this.suspendHistory = false;
    this.emit('reload');
  }

  /* ---------------- nodes ---------------- */

  addNode(x, z, y = 0, kind = 'plain', extra = {}) {
    const id = extra.id || `n${nodeSeq++}`;
    const node = { id, x, y: y ?? 0, z, kind, ...extra };
    if (extra.id) {
      const match = /^n(\d+)$/.exec(extra.id);
      if (match) nodeSeq = Math.max(nodeSeq, parseInt(match[1], 10) + 1);
    }
    this.nodes.set(id, node);
    return node;
  }

  moveNode(id, x, z, y) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.x = x;
    node.z = z;
    if (typeof y === 'number') node.y = y;
  }

  removeNode(id) {
    this.nodes.delete(id);
    for (const road of this.roads.values()) {
      const before = road.nodeIds.length;
      road.nodeIds = road.nodeIds.filter((n) => n !== id);
      if (road.nodeIds.length !== before && road.nodeIds.length < 2) this.roads.delete(road.id);
    }
    for (const line of this.subways.values()) {
      line.nodeIds = line.nodeIds.filter((n) => n !== id);
      if (line.nodeIds.length < 2) this.subways.delete(line.id);
    }
  }

  getNode(id) {
    return this.nodes.get(id);
  }

  /** Node ids used by a road, resolved to {x,y,z}. */
  roadPoints(road) {
    return road.nodeIds.map((id) => this.nodes.get(id)).filter(Boolean);
  }

  /** Every road touching a node. */
  roadsAtNode(nodeId) {
    const out = [];
    for (const road of this.roads.values()) {
      if (road.nodeIds.includes(nodeId)) out.push(road);
    }
    return out;
  }

  /** Degree of a node = number of connected roads. */
  nodeDegree(nodeId) {
    let n = 0;
    for (const road of this.roads.values()) {
      const ends = road.nodeIds[0] === nodeId || road.nodeIds[road.nodeIds.length - 1] === nodeId;
      if (road.nodeIds.includes(nodeId) && ends) n++;
      else if (road.nodeIds.includes(nodeId)) n++;
    }
    return n;
  }

  /** Node closest to a point, within `radius`. */
  nearestNode(x, z, radius = 6, filter = null) {
    let best = null;
    let bestDist = radius * radius;
    for (const node of this.nodes.values()) {
      if (filter && !filter(node)) continue;
      const dx = node.x - x;
      const dz = node.z - z;
      const d = dx * dx + dz * dz;
      if (d <= bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  }

  /* ---------------- roads ---------------- */

  addRoad(nodeIds, profileId = 'residential-street', extra = {}) {
    if (!nodeIds || nodeIds.length < 2) return null;
    const id = extra.id || `r${roadSeq++}`;
    if (extra.id) {
      const match = /^r(\d+)$/.exec(extra.id);
      if (match) roadSeq = Math.max(roadSeq, parseInt(match[1], 10) + 1);
    }
    const road = {
      id,
      nodeIds: nodeIds.slice(),
      profileId,
      name: extra.name || '',
      lanes: null, // per-road lane override (cloned from the profile when edited)
      centerLine: null,
      edgeLine: null,
      curbHeight: null,
      structure: null, // 'none' | 'bridge' | 'tunnel'
      deckHeight: extra.deckHeight ?? null,
      closed: !!extra.closed,
      group: extra.group || null,
      details: [],
      visible: true,
      locked: false,
    };
    this.roads.set(id, road);
    return road;
  }

  removeRoad(id) {
    this.roads.delete(id);
  }

  getRoad(id) {
    return this.roads.get(id);
  }

  /** Effective profile for a road: catalogue entry plus any per-road overrides. */
  effectiveProfile(road) {
    const base = getProfile(road.profileId);
    return {
      ...base,
      lanes: road.lanes ? road.lanes : base.lanes,
      centerLine: road.centerLine ?? base.centerLine,
      edgeLine: road.edgeLine ?? base.edgeLine,
      structure: road.structure ?? base.structure ?? 'none',
    };
  }

  /** Start editing a road's lane layout (materialises a private copy). */
  detachLanes(road) {
    if (!road.lanes) {
      road.lanes = cloneLanes(getProfile(road.profileId).lanes);
    }
    return road.lanes;
  }

  resetRoadToProfile(road) {
    road.lanes = null;
    road.centerLine = null;
    road.edgeLine = null;
    road.curbHeight = null;
  }

  addDetail(roadId, detail) {
    const road = this.roads.get(roadId);
    if (!road) return null;
    const entry = { id: `d${detailSeq++}`, ...detail };
    road.details.push(entry);
    return entry;
  }

  removeDetail(roadId, detailId) {
    const road = this.roads.get(roadId);
    if (!road) return;
    road.details = road.details.filter((d) => d.id !== detailId);
  }

  /* ---------------- subway ---------------- */

  addSubway(nodeIds, extra = {}) {
    const id = extra.id || `s${lineSeq++}`;
    const line = {
      id,
      nodeIds: nodeIds.slice(),
      name: extra.name || `Line ${this.subways.size + 1}`,
      color: extra.color ?? 0x4f9ee8,
      depth: extra.depth ?? -13,
      stations: extra.stations || [],
      visible: true,
    };
    this.subways.set(id, line);
    return line;
  }

  removeSubway(id) {
    this.subways.delete(id);
  }

  /* ---------------- stats ---------------- */

  stats() {
    let length = 0;
    for (const road of this.roads.values()) {
      const points = this.roadPoints(road);
      for (let i = 0; i < points.length - 1; i++) {
        length += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
      }
    }
    return {
      nodes: this.nodes.size,
      roads: this.roads.size,
      subways: this.subways.size,
      details: [...this.roads.values()].reduce((sum, road) => sum + road.details.length, 0),
      length,
    };
  }

  /* ---------------- serialisation ---------------- */

  serialize() {
    return {
      version: NETWORK_VERSION,
      settings: JSON.parse(JSON.stringify(this.settings)),
      nodes: [...this.nodes.values()].map((n) => ({ ...n })),
      roads: [...this.roads.values()].map((r) => ({ ...r, details: r.details.map((d) => ({ ...d })) })),
      subways: [...this.subways.values()].map((s) => ({ ...s, stations: s.stations.map((st) => ({ ...st })) })),
    };
  }

  deserialize(data) {
    this.nodes.clear();
    this.roads.clear();
    this.subways.clear();
    if (!data) return;
    this.settings = { ...this.settings, ...(data.settings || {}) };
    for (const node of data.nodes || []) this.nodes.set(node.id, { kind: 'plain', ...node });
    for (const road of data.roads || []) {
      this.roads.set(road.id, { visible: true, locked: false, details: [], lanes: null, ...road });
    }
    for (const line of data.subways || []) this.subways.set(line.id, { stations: [], visible: true, ...line });
    // Keep the id counters ahead of anything we just loaded.
    for (const id of this.nodes.keys()) {
      const m = /^n(\d+)$/.exec(id);
      if (m) nodeSeq = Math.max(nodeSeq, parseInt(m[1], 10) + 1);
    }
    for (const id of this.roads.keys()) {
      const m = /^r(\d+)$/.exec(id);
      if (m) roadSeq = Math.max(roadSeq, parseInt(m[1], 10) + 1);
    }
    for (const id of this.subways.keys()) {
      const m = /^s(\d+)$/.exec(id);
      if (m) lineSeq = Math.max(lineSeq, parseInt(m[1], 10) + 1);
    }
  }

  clear() {
    this.nodes.clear();
    this.roads.clear();
    this.subways.clear();
  }
}
