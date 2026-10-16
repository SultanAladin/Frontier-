// A periodic annular solid. Units are metres, kilograms, seconds.
export function makeTyre(segments = 64, radial = 4, across = 7) {
  const rest = [],
    tets = [],
    edges = [],
    surface = [],
    pinned = [];
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
        for (const q of [
          [0, 1, 3, 7],
          [0, 3, 2, 7],
          [0, 2, 6, 7],
          [0, 6, 4, 7],
          [0, 4, 5, 7],
          [0, 5, 1, 7],
        ]) {
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
  // Greedy graph colouring: constraints within a batch never share a node.
  function colour(constraints) {
    const batches = [],
      used = Array.from({ length: rest.length }, () => new Set());
    constraints.forEach((ids, index) => {
      let c = 0;
      while (ids.some((i) => used[i].has(c))) c++;
      (batches[c] ??= []).push(index);
      ids.forEach((i) => used[i].add(c));
    });
    return batches;
  }
  const edgeBatches = colour(edges),
    tetBatches = colour(tets);
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
