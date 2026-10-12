// Frontier Road Editor — build worker.
//
// The city is generated and meshed here, off the main thread: a 40 km network is
// a couple of seconds of work, and a 4 km one is a lot more, so the page must
// stay responsive and show progress while it happens. The result travels back as
// transferable buffers — one compact vertex/index pair per spatial tile per
// group — which the viewer uploads without copying.

import { generateCity, describeCity } from '../core/city.js';
import { buildNetworkGeometry, validateGroups } from '../core/geometry.js';

import { tile, TILE } from './tiles.js';

function build(msg) {
  const opts = msg.opts || {};
  const stage = (name, pct) => self.postMessage({ type: 'progress', stage: name, pct });
  stage('planning the network', 0.05);
  const city = generateCity(opts);
  stage('sampling alignments', 0.2);
  city.net.sampleAll();
  stage('solving junctions', 0.3);
  for (const node of city.net.nodes) if (node.roads.length) city.net.planJunction(node);
  stage('meshing the deck', 0.5);
  const built = buildNetworkGeometry(city.net, opts.geometry || {});
  stage('validating', 0.9);
  const validation = {};
  for (const [g, r] of Object.entries(validateGroups(built))) {
    validation[g] = { tris: r.triangles, failures: r.failures, nonManifold: r.nonManifoldEdges, flipped: r.flippedEdges };
  }
  stage('tiling for view culling', 0.95);
  const chunks = [];
  for (const [name, geo] of Object.entries(built.groups)) {
    if (geo.indices.length) tile(name, geo, opts.chunk ?? TILE, chunks);
  }
  const describe = describeCity(city);
  // Road centrelines for the minimap, flattened into one float array.
  const lines = [];
  for (const road of city.net.roads) {
    const sm = road.samples;
    lines.push(sm.count);
    for (let i = 0; i < sm.count; i++) lines.push(sm.pts[i][0], sm.pts[i][2]);
  }
  const transfer = [];
  for (const c of chunks) transfer.push(c.pos.buffer, c.nrm.buffer, c.col.buffer, c.idx.buffer);
  const payload = {
    type: 'done',
    chunks,
    stats: built.stats,
    validation,
    describe,
    minimap: new Float32Array(lines),
    bounds: built.bounds,
    warnings: built.stats.warnings,
  };
  self.postMessage(payload, transfer);
}

self.onmessage = (e) => {
  try {
    if (e.data?.cmd === 'build') build(e.data);
    else if (e.data?.cmd === 'ping') self.postMessage({ type: 'pong' });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.stack ? err.stack : err) });
  }
};
