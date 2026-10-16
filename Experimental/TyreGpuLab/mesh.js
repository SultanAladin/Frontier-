// A periodic annular solid. Units are metres, kilograms, seconds.
export function makeTyre(segments = 64, radial = 4, across = 7) {
  if (
    !Number.isInteger(segments) ||
    segments < 8 ||
    segments % 2 ||
    !Number.isInteger(radial) ||
    radial < 2 ||
    !Number.isInteger(across) ||
    across < 3 ||
    across % 2 === 0
  )
    throw new Error("Expected even segments >=8, radial >=2, odd across >=3");
  const rest = [],
    tets = [],
    edges = [],
    surface = [],
    pinned = [],
    tetBatches = Array.from({ length: 24 }, () => []);
  const id = (s, r, z) =>
    ((s + segments) % segments) * radial * across + r * across + z;
  for (let s = 0; s < segments; s++)
    for (let r = 0; r < radial; r++)
      for (let z = 0; z < across; z++) {
        const a = (s / segments) * Math.PI * 2,
          w = (z / (across - 1)) * 2 - 1;
        const outer = 0.48 - 0.035 * Math.pow(Math.abs(w), 4),
          radius = 0.265 + ((outer - 0.265) * r) / (radial - 1);
        rest.push([Math.cos(a) * radius, Math.sin(a) * radius, w * 0.155]);
        pinned.push(r === 0);
      }
  const det = (a, b, c) =>
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0]);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  for (let s = 0; s < segments; s++)
    for (let r = 0; r < radial - 1; r++)
      for (let z = 0; z < across - 1; z++) {
        const v = [
          id(s, r, z),
          id(s + 1, r, z),
          id(s, r + 1, z),
          id(s + 1, r + 1, z),
          id(s, r, z + 1),
          id(s + 1, r, z + 1),
          id(s, r + 1, z + 1),
          id(s + 1, r + 1, z + 1),
        ];
        for (const [kind, q] of [
          [0, 1, 3, 7],
          [0, 3, 2, 7],
          [0, 2, 6, 7],
          [0, 6, 4, 7],
          [0, 4, 5, 7],
          [0, 5, 1, 7],
        ].entries()) {
          const t = q.map((i) => v[i]);
          if (
            det(
              sub(rest[t[1]], rest[t[0]]),
              sub(rest[t[2]], rest[t[0]]),
              sub(rest[t[3]], rest[t[0]]),
            ) < 0
          )
            [t[1], t[2]] = [t[2], t[1]];
          tets.push(t);
          // A Kuhn tet is a monotone 3-axis path. For each orientation, the
          // middle coordinate plus parity of the endpoints gives four disjoint
          // translations. Even angular segments preserve this at the seam.
          const middle = [1, 0, 2, 1, 0, 2][kind],
            cell = [s, r, z];
          const parity =
            2 * (cell[middle] & 1) + ((s + r + z - cell[middle]) & 1);
          tetBatches[4 * kind + parity].push(tets.length - 1);
        }
      }
  // Extract boundary faces, guaranteeing exactly the same surface as the volume mesh.
  const faces = new Map(),
    es = new Set();
  for (const t of tets) {
    for (const f of [
      [t[0], t[2], t[1]],
      [t[0], t[1], t[3]],
      [t[0], t[3], t[2]],
      [t[1], t[2], t[3]],
    ]) {
      const key = [...f].sort((a, b) => a - b).join(",");
      if (faces.has(key)) faces.delete(key);
      else faces.set(key, f);
    }
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++)
        es.add([t[i], t[j]].sort((a, b) => a - b).join(","));
  }
  for (const e of es) edges.push(e.split(",").map(Number));
  for (const f of faces.values()) surface.push(...f);
  const surfaceLines = new Set();
  for (const f of faces.values())
    for (let i = 0; i < 3; i++)
      surfaceLines.add([f[i], f[(i + 1) % 3]].sort((a, b) => a - b).join(","));
  const lines = [...surfaceLines].flatMap((e) => e.split(",").map(Number));
  const tetData = [];
  for (const t of tets) {
    const a = sub(rest[t[1]], rest[t[0]]),
      b = sub(rest[t[2]], rest[t[0]]),
      c = sub(rest[t[3]], rest[t[0]]),
      d = det(a, b, c);
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    // Rows of inverse rest matrix, packed in padded vec4s.
    tetData.push(
      ...t,
      ...cross(b, c).map((x) => x / d),
      0,
      ...cross(c, a).map((x) => x / d),
      0,
      ...cross(a, b).map((x) => x / d),
      d / 6,
    );
  }
  // Each of the seven positive grid directions forms disjoint open paths or
  // even periodic cycles. Alternate their edges: 7 directions * 2 = 14 colours.
  // Interior valence is 14 edges / 24 tets, so both schedules meet the lower
  // bound for a matching-based solver on the default topology.
  const edgeBatches = Array.from({ length: 14 }, () => []);
  const coordinates = (i) => [
    Math.floor(i / (radial * across)),
    Math.floor(i / across) % radial,
    i % across,
  ];
  edges.forEach(([a, b], i) => {
    let start = coordinates(a),
      end = coordinates(b);
    let d = end.map((v, k) => v - start[k]);
    if (d[0] > 1) d[0] -= segments;
    if (d[0] < -1) d[0] += segments;
    const axis = d.findIndex((v) => v !== 0);
    if (d[axis] < 0) {
      [start, end] = [end, start];
      d = d.map((v) => -v);
    }
    if (d.some((v) => v !== 0 && v !== 1))
      throw new Error("Invalid structured edge direction");
    const direction = d[0] + 2 * d[1] + 4 * d[2];
    edgeBatches[2 * (direction - 1) + (start[axis] & 1)].push(i);
  });
  return {
    rest,
    pinned,
    tets,
    edges,
    surface,
    lines,
    tetData,
    edgeBatches,
    tetBatches,
    segments,
    radial,
    across,
  };
}
