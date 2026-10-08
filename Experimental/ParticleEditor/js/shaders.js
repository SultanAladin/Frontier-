// WGSL sources for the Particle Editor. Each module declares only the bindings it
// uses; the bind group layouts live in engine.js. Units: metres and seconds.
(function () {
  "use strict";
  const PE = (window.PE = window.PE || {});

  // Shared structs and helpers. Every System uniform field is one vec4 (16 floats);
  // the offsets are mirrored in engine.js (SYS_SLOT).
  const COMMON = /* wgsl */ `
struct Glob {
  viewProj: mat4x4f,
  camRight: vec4f,
  camUp: vec4f,
  camPos: vec4f,
  windMin: vec4f,
  windSize: vec4f,
  windDim: vec4f,
  timing: vec4f,
  viz: vec4f,
};

struct Sys {
  origin: vec4f,   // xyz origin, w radius
  dir: vec4f,      // xyz direction (unit), w spread (radians)
  speed: vec4f,    // x min, y max, z drag (1/s), w gravity (g units)
  life: vec4f,     // x min, y max, z size start, w size end
  colA: vec4f,
  colB: vec4f,
  colC: vec4f,
  phys: vec4f,     // x dt, y time, z frame, w kind (0 spark,1 leaf,3 atom,4 chem,5 vfx)
  phys2: vec4f,    // x wind coupling (1/s), y bounce, z buoyancy, w flutter
  phys3: vec4f,    // x capacity, y emit shape, z fraction A (chem), w emit count this frame
  phys4: vec4f,    // xyz box half extents, w head index
  mol: vec4f,      // x temperature, y epsilon, z sigma, w reaction rate
  mol2: vec4f,     // x cell size, y grid dim, z slots per cell, w dissociation rate
  mol3: vec4f,     // x reaction radius, y damping, z -, w -
  emit: vec4f,     // x head, y seed base, z shape (0 streak,1 sphere,2 leaf,3 soft), w leaf mode
  misc: vec4f,     // x size scale
};

struct Part {
  p: vec4f,        // xyz position, w age
  v: vec4f,        // xyz velocity, w lifetime (dead when age >= life)
  c: vec4f,        // rgba
  m: vec4f,        // x size, y angle, z spin, w seed (or species for molecules)
};

fn hash(x0: u32) -> u32 {
  var x = x0;
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

fn rnd(s: ptr<function, u32>) -> f32 {
  *s = hash(*s + 0x9e3779b9u);
  return f32(*s & 0xffffffu) / 16777216.0;
}

fn hashF(seed: f32, k: u32) -> f32 {
  let h = hash(u32(seed) * 31u + k * 977u + 17u);
  return f32(h & 0xffffffu) / 16777216.0;
}

fn randSphere(u: f32, v: f32) -> vec3f {
  let z = 2.0 * u - 1.0;
  let a = 6.2831853 * v;
  let r = sqrt(max(0.0, 1.0 - z * z));
  return vec3f(r * cos(a), z, r * sin(a));
}

fn basisFrom(d: vec3f) -> mat3x3f {
  let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(d.y) > 0.95);
  let t = normalize(cross(up, d));
  let b = cross(d, t);
  return mat3x3f(t, b, d);
}

fn rotAxis(v: vec3f, k: vec3f, a: f32) -> vec3f {
  let c = cos(a);
  let s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
`;

  // ---------------------------------------------------------------- simulation
  const SIM = /* wgsl */ `
@group(0) @binding(0) var<uniform> G: Glob;
@group(0) @binding(1) var windTex: texture_3d<f32>;
@group(0) @binding(2) var windSamp: sampler;
@group(1) @binding(0) var<uniform> S: Sys;
@group(1) @binding(1) var<storage, read_write> parts: array<Part>;
@group(1) @binding(2) var<storage, read_write> stats: array<atomic<u32>, 8>;
@group(1) @binding(3) var<storage, read_write> cellCount: array<atomic<u32>>;
@group(1) @binding(4) var<storage, read_write> cellSlots: array<u32>;
@group(1) @binding(5) var<storage, read> snap: array<Part>;

const FMAX: f32 = 180.0;

fn sampleWind(p: vec3f) -> vec3f {
  let uvw = (p - G.windMin.xyz) / G.windSize.xyz;
  if (any(uvw < vec3f(0.0)) || any(uvw > vec3f(1.0))) { return vec3f(0.0); }
  return textureSampleLevel(windTex, windSamp, uvw, 0.0).xyz;
}

@compute @workgroup_size(64)
fn emitParticles(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let n = u32(S.phys3.w);
  if (i >= n) { return; }
  let cap = u32(S.phys3.x);
  let idx = (u32(S.emit.x) + i) % cap;
  var st = hash(idx * 2654435761u + u32(S.emit.y) * 40503u + 12345u);
  let r0 = rnd(&st); let r1 = rnd(&st); let r2 = rnd(&st); let r3 = rnd(&st);
  let r4 = rnd(&st); let r5 = rnd(&st); let r6 = rnd(&st);
  let kind = u32(S.phys.w);
  let shape = u32(S.phys3.y);
  let rad = S.origin.w;
  var pos = S.origin.xyz;
  if (shape == 1u) {
    pos += randSphere(r0, r1) * rad * pow(r2, 0.333);
  } else if (shape == 2u) {
    let a = 6.2831853 * r0;
    let rr = rad * sqrt(r1);
    pos += vec3f(cos(a) * rr, 0.0, sin(a) * rr);
  } else if (shape == 3u) {
    pos += (vec3f(r0, r1, r2) * 2.0 - 1.0) * S.phys4.xyz;
  }
  var vel = vec3f(0.0);
  var life = mix(S.life.x, S.life.y, r3);
  var species = 0.0;
  let molecular = kind == 3u || kind == 4u;
  if (molecular) {
    life = 1.0e9;
    pos = S.origin.xyz + (vec3f(r0, r1, r2) * 2.0 - 1.0) * S.phys4.xyz;
    vel = (vec3f(r4, r5, r6) - 0.5) * sqrt(12.0 * S.mol.x);
    if (kind == 4u) { species = select(1.0, 0.0, r3 < S.phys3.z); }
  } else {
    let basis = basisFrom(S.dir.xyz);
    let cosT = 1.0 - r4 * (1.0 - cos(S.dir.w));
    let sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
    let phi = 6.2831853 * r5;
    let local = vec3f(sinT * cos(phi), sinT * sin(phi), cosT);
    vel = (basis * local) * mix(S.speed.x, S.speed.y, r6);
  }
  var q: Part;
  q.p = vec4f(pos, 0.0);
  q.v = vec4f(vel, life);
  q.c = S.colA;
  q.m = vec4f(S.life.z * S.misc.x, r0 * 6.2831853, (r1 - 0.5) * 4.0,
              select(f32(st & 0xffffffu), species, molecular));
  parts[idx] = q;
}

// Ballistic / wind-driven particles: sparks, leaves, rain, smoke, fire, explosions.
@compute @workgroup_size(64)
fn updateParticles(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let cap = u32(S.phys3.x);
  if (i >= cap) { return; }
  let q = parts[i];
  let life = q.v.w;
  if (q.p.w >= life) { return; }
  let dt = S.phys.x;
  let kind = u32(S.phys.w);
  let age = q.p.w + dt;
  if (age >= life) { parts[i] = Part(); return; }
  let t01 = age / life;
  let seed = q.m.w;
  var pos = q.p.xyz;
  var v = q.v.xyz;

  // Wind field: velocity relaxes toward the local wind (sampled from the 3D grid).
  let wind = sampleWind(pos);
  let k = min(S.phys2.x * dt, 1.0);
  v += (wind - v) * k;
  v *= exp(-S.speed.z * dt);
  v.y += (-S.speed.w * 9.81 + S.phys2.z) * dt;
  if (S.phys2.w > 0.0) {
    let ph = age * 2.7 + seed * 0.013;
    v += vec3f(sin(ph), 0.25 * cos(ph * 1.3), cos(ph * 0.8 + 1.0)) * S.phys2.w * dt;
  }
  pos += v * dt;
  if (pos.y < 0.0) {
    pos.y = 0.0;
    if (kind == 1u) {
      v = vec3f(v.x * 0.55, 0.0, v.z * 0.55);
    } else {
      v.y = -v.y * S.phys2.y;
      v.x *= 0.7;
      v.z *= 0.7;
    }
  }
  if (length(pos - S.origin.xyz) > 60.0) { parts[i] = Part(); return; }

  let spin = q.m.z;
  let ang = q.m.y + spin * dt;
  let size = mix(S.life.z, S.life.w, t01) * S.misc.x * (0.7 + 0.6 * fract(seed * 0.618034));
  var c = mix(S.colA, S.colB, t01);
  c.a = c.a * smoothstep(0.0, 0.08, t01) * (1.0 - smoothstep(0.7, 1.0, t01));
  parts[i] = Part(vec4f(pos, age), vec4f(v, life), c, vec4f(size, ang, spin, seed));
}

fn cellOf(p: vec3f) -> vec3i {
  let gd = i32(S.mol2.y);
  let u = (p - S.origin.xyz + S.phys4.xyz) / S.mol2.x;
  return clamp(vec3i(floor(u)), vec3i(0), vec3i(gd - 1));
}

fn wallFix(c: f32, v: f32, B: f32) -> vec2f {
  if (c > B) { return vec2f(2.0 * B - c, -abs(v)); }
  if (c < -B) { return vec2f(-2.0 * B - c, abs(v)); }
  return vec2f(c, v);
}

@compute @workgroup_size(1)
fn resetStats() {
  for (var k = 0u; k < 8u; k++) { atomicStore(&stats[k], 0u); }
}

@compute @workgroup_size(64)
fn reduceStats(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let cap = u32(S.phys3.x);
  if (i >= cap) { return; }
  let q = parts[i];
  if (q.p.w >= q.v.w) { return; }
  atomicAdd(&stats[0], 1u);
  atomicAdd(&stats[4], u32(dot(q.v.xyz, q.v.xyz) * 1000.0));
  if (u32(S.phys.w) == 4u) {
    let s = u32(clamp(q.m.w, 0.0, 2.0));
    atomicAdd(&stats[1u + s], 1u);
  }
}

@compute @workgroup_size(64)
fn molClear(@builtin(global_invocation_id) gid: vec3u) {
  let gd = u32(S.mol2.y);
  let i = gid.x;
  if (i >= gd * gd * gd) { return; }
  atomicStore(&cellCount[i], 0u);
}

@compute @workgroup_size(64)
fn molInsert(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let cap = u32(S.phys3.x);
  if (i >= cap) { return; }
  let q = parts[i];
  if (q.p.w >= q.v.w) { return; }
  let K = u32(S.mol2.z);
  let gd = i32(S.mol2.y);
  let c = cellOf(q.p.xyz);
  let ci = u32(c.x + c.y * gd + c.z * gd * gd);
  let slot = atomicAdd(&cellCount[ci], 1u);
  if (slot < K) { cellSlots[ci * K + slot] = i; }
}

// Molecular step: reads the snapshot (race-free), writes only its own particle.
// Kind 3: Lennard-Jones-style gas with Langevin thermostat.
// Kind 4: soft repulsion + stochastic A + B -> C reaction and C -> A/B dissociation.
@compute @workgroup_size(64)
fn molStep(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let cap = u32(S.phys3.x);
  if (i >= cap) { return; }
  let me = snap[i];
  if (me.p.w >= me.v.w) { return; }
  let kind = u32(S.phys.w);
  let dt = S.phys.x;
  let sig = S.mol.z;
  let eps = S.mol.y;
  let rc = 2.5 * sig;
  let rc2 = rc * rc;
  let rr = S.mol3.x;
  let rr2 = rr * rr;
  let gd = i32(S.mol2.y);
  let K = u32(S.mol2.z);
  let c0 = cellOf(me.p.xyz);
  var f = vec3f(0.0);
  var sp = me.m.w;
  // Seed from the particle's position too: S.emit.y is constant within a frame, so without this
  // every sub-step would reuse the same thermostat noise and the noise would add coherently.
  var st = hash(i * 747796405u + u32(S.emit.y) * 2891336453u + bitcast<u32>(me.p.x) * 2654435761u + bitcast<u32>(me.p.y) * 2246822519u + 1u);
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let nc = c0 + vec3i(dx, dy, dz);
        if (any(nc < vec3i(0)) || any(nc >= vec3i(gd))) { continue; }
        let ci = u32(nc.x + nc.y * gd + nc.z * gd * gd);
        let cnt = min(atomicLoad(&cellCount[ci]), K);
        for (var s = 0u; s < cnt; s++) {
          let j = cellSlots[ci * K + s];
          if (j == i || j >= cap) { continue; }
          let o = snap[j];
          if (o.p.w >= o.v.w) { continue; }
          let rv = me.p.xyz - o.p.xyz;
          let d2 = dot(rv, rv);
          if (d2 < 1e-10 || d2 > rc2) { continue; }
          if (kind == 3u) {
            let r2 = max(d2, 0.04 * sig * sig);
            let sr2 = sig * sig / r2;
            let sr6 = sr2 * sr2 * sr2;
            let fm = clamp(24.0 * eps * (2.0 * sr6 * sr6 - sr6) / r2, -FMAX, FMAX);
            f += rv * fm;
          } else {
            let d = sqrt(d2);
            if (d < sig) { f += rv / d * (sig - d) * 120.0; }
            if (d2 < rr2) {
              let ot = o.m.w;
              let pair = (sp < 0.5 && ot > 0.5 && ot < 1.5) || (sp > 0.5 && sp < 1.5 && ot < 0.5);
              if (pair && rnd(&st) < S.mol.w * dt) { sp = 2.0; }
            }
          }
        }
      }
    }
  }
  if (kind == 4u && sp > 1.5 && rnd(&st) < S.mol2.w * dt) {
    sp = select(0.0, 1.0, rnd(&st) < 0.5);
  }
  var v = me.v.xyz;
  let fl = length(f);
  if (fl > FMAX) { f = f * (FMAX / fl); }
  v += f * dt;
  let gamma = S.mol3.y;
  v *= max(0.0, 1.0 - gamma * dt);
  let T = S.mol.x;
  let noise = vec3f(rnd(&st), rnd(&st), rnd(&st)) - vec3f(0.5);
  v += noise * sqrt(24.0 * gamma * T * dt);
  let sv = length(v);
  if (sv > 6.0) { v *= 6.0 / sv; }
  let Bh = S.phys4.x;
  let pos = me.p.xyz + v * dt;
  var local = pos - S.origin.xyz;
  let wx = wallFix(local.x, v.x, Bh);
  let wy = wallFix(local.y, v.y, Bh);
  let wz = wallFix(local.z, v.z, Bh);
  local = vec3f(wx.x, wy.x, wz.x);
  v = vec3f(wx.y, wy.y, wz.y);
  var outC: vec4f;
  if (kind == 3u) {
    outC = mix(S.colA, S.colB, clamp(length(v) / 1.2, 0.0, 1.0));
  } else {
    outC = select(select(S.colA, S.colB, sp > 0.5), S.colC, sp > 1.5);
  }
  let sz = sig * S.misc.x;
  parts[i] = Part(vec4f(S.origin.xyz + local, me.p.w + dt), vec4f(v, me.v.w), outC,
                  vec4f(sz, me.m.y, me.m.z, sp));
}
`;

  // ---------------------------------------------------------------- wind field
  const WIND = /* wgsl */ `
@group(0) @binding(0) var<uniform> G: Glob;
@group(0) @binding(1) var<storage, read> comps: array<CompW>;
@group(0) @binding(2) var windOut: texture_storage_3d<rgba16float, write>;

struct CompW {
  a: vec4f,   // x, z, radius, type (0 directional,1 gust,2 tornado,3 radial)
  b: vec4f,   // strength m/s, bearing rad, frequency, enabled
};

fn h31(p: vec3f) -> f32 {
  return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453);
}

fn vnoise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(h31(i), h31(i + vec3f(1.0, 0.0, 0.0)), u.x),
              mix(h31(i + vec3f(0.0, 1.0, 0.0)), h31(i + vec3f(1.0, 1.0, 0.0)), u.x), u.y);
  let b = mix(mix(h31(i + vec3f(0.0, 0.0, 1.0)), h31(i + vec3f(1.0, 0.0, 1.0)), u.x),
              mix(h31(i + vec3f(0.0, 1.0, 1.0)), h31(i + vec3f(1.0, 1.0, 1.0)), u.x), u.y);
  return mix(a, b, u.z);
}

// Evaluates every enabled component on the voxel grid. Output rgb = velocity (m/s, already
// scaled by the global wind scale), a = magnitude. Linear superposition, like the reference
// HTML wind model (EvaluateWind), plus an animated turbulence term.
@compute @workgroup_size(4, 4, 4)
fn buildWind(@builtin(global_invocation_id) id: vec3u) {
  let dim = vec3u(G.windDim.xyz);
  if (id.x >= dim.x || id.y >= dim.y || id.z >= dim.z) { return; }
  let fid = vec3f(id);
  let wp = G.windMin.xyz + (fid + 0.5) / G.windDim.xyz * G.windSize.xyz;
  let t = G.timing.x;
  var acc = vec3f(0.0);
  let n = u32(G.windDim.w);
  for (var k = 0u; k < n; k++) {
    let c = comps[k];
    if (c.b.w < 0.5 || c.b.x == 0.0) { continue; }
    let typ = u32(c.a.w + 0.5);
    let S = c.b.x;
    let R = max(c.a.z, 0.5);
    let rel = vec2f(wp.x - c.a.x, wp.z - c.a.y);
    let rr = length(rel);
    let dirv = vec2f(sin(c.b.y), cos(c.b.y));
    let fall = max(0.0, 1.0 - (rr / R) * (rr / R));
    if (typ == 0u) {
      acc += vec3f(dirv.x, 0.0, dirv.y) * S;
    } else if (typ == 1u) {
      let front = dot(rel, dirv) * 0.08 - t * c.b.z * 0.6;
      let ph = fract(front);
      let env = exp(-pow((ph - 0.5) * 3.5, 2.0));
      acc += vec3f(dirv.x, 0.0, dirv.y) * S * env * fall * fall;
    } else if (typ == 2u) {
      let q = rr / R;
      let core = q * exp(1.0 - q);
      let inv = 1.0 / max(rr, 1e-3);
      let tang = vec2f(-rel.y, rel.x) * inv;
      let wob = 1.0 + 0.2 * sin(t * 2.0 + wp.y * 1.5);
      acc += vec3f(tang.x, 0.0, tang.y) * S * core * wob;
      acc += vec3f(-rel.x, 0.0, -rel.y) * inv * (0.25 * S * core);
      acc.y += S * 0.5 * core * clamp(1.0 - wp.y / G.windSize.y, 0.0, 1.0);
    } else {
      let outv = rel / max(rr, 1e-3);
      acc += vec3f(outv.x, 0.0, outv.y) * S * fall * fall;
    }
  }
  let turb = G.viz.w;
  if (turb > 0.0) {
    let q = wp * 0.45 + vec3f(t * 0.25, t * 0.13, t * 0.18);
    let nx = vnoise3(q);
    let ny = vnoise3(q + vec3f(17.3, 3.1, 9.7));
    let nz = vnoise3(q + vec3f(5.2, 31.7, 1.9));
    acc += (vec3f(nx, ny, nz) * 2.0 - 1.0) * turb * (1.0 + length(acc) * 0.2);
  }
  acc *= G.timing.w;
  textureStore(windOut, vec3i(id), vec4f(acc, length(acc)));
}
`;

  // ---------------------------------------------------------------- rendering
  const RENDER = /* wgsl */ `
@group(0) @binding(0) var<uniform> G: Glob;
@group(0) @binding(1) var windTex: texture_3d<f32>;
@group(0) @binding(2) var windSamp: sampler;
@group(1) @binding(0) var<uniform> S: Sys;
@group(1) @binding(1) var<storage, read> parts: array<Part>;
@group(1) @binding(2) var<storage, read> segs: array<vec4f>;

struct VO {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec4f,
  @location(2) ex: vec4f,
};

struct QO {
  @builtin(position) pos: vec4f,
  @location(0) s: f32,
  @location(1) inten: f32,
};

struct LI {
  @location(0) pos: vec3f,
  @location(1) col: vec4f,
};

struct LO {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
};

fn h21(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn vnoise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2f(1.0, 0.0)), u.x),
             mix(h21(i + vec2f(0.0, 1.0)), h21(i + vec2f(1.0, 1.0)), u.x), u.y);
}

@vertex
fn vsPart(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  var o: VO;
  o.pos = vec4f(0.0, 0.0, 2.0, 1.0);
  let q = parts[ii];
  if (!(q.p.w < q.v.w && q.c.a > 0.002 && q.m.x > 0.0)) { return o; }
  let cs = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                           vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = cs[vi];
  let sz = q.m.x;
  let shape = u32(S.emit.z);
  var wp: vec3f;
  if (shape == 0u) {
    let ax = normalize(q.v.xyz + vec3f(0.0, 0.0001, 0.0));
    let toCam = normalize(G.camPos.xyz - q.p.xyz);
    var side = cross(ax, toCam);
    side = side / max(length(side), 1e-4);
    let L = sz * (1.0 + length(q.v.xyz) * 0.15);
    wp = q.p.xyz + ax * (c.y * L * 0.5) + side * (c.x * sz * 0.5);
  } else if (shape == 2u) {
    let sd = q.m.w;
    let ax = normalize(vec3f(hashF(sd, 1u) - 0.5, hashF(sd, 2u) - 0.5, hashF(sd, 3u) - 0.5)
                       + vec3f(0.0, 0.0001, 0.0));
    let local = vec3f(c.x * sz * 0.5, c.y * sz * 0.3, 0.0);
    wp = q.p.xyz + rotAxis(local, ax, q.m.y);
  } else {
    wp = q.p.xyz + G.camRight.xyz * (c.x * sz * 0.5) + G.camUp.xyz * (c.y * sz * 0.5);
  }
  o.pos = G.viewProj * vec4f(wp, 1.0);
  o.uv = c;
  o.col = q.c;
  o.ex = vec4f(q.p.w / q.v.w, q.m.w, sz, 0.0);
  return o;
}

@fragment
fn fsPart(i: VO) -> @location(0) vec4f {
  let shape = u32(S.emit.z);
  var rgb = i.col.rgb;
  var a = 1.0;
  if (shape == 0u) {
    let x = abs(i.uv.x);
    a = pow(max(0.0, 1.0 - x), 2.0) * (1.0 - pow(abs(i.uv.y), 3.0) * 0.5);
    rgb = mix(rgb, vec3f(1.0), pow(max(0.0, 1.0 - x), 6.0) * 0.8);
  } else if (shape == 1u) {
    let r2 = dot(i.uv, i.uv);
    if (r2 > 1.0) { discard; }
    let n = vec3f(i.uv, sqrt(1.0 - r2));
    let L = normalize(vec3f(0.35, 0.55, 0.75));
    let nd = max(dot(n, L), 0.0);
    rgb = rgb * (0.3 + 0.7 * nd) + vec3f(0.6) * pow(nd, 16.0) * 0.35;
    a = smoothstep(1.0, 0.85, sqrt(r2));
  } else if (shape == 2u) {
    if (S.emit.w > 0.5) {
      if (abs(i.uv.y) > 0.6) { discard; }
      rgb = rgb * (0.85 + 0.15 * sin(i.ex.y + i.uv.x * 6.0));
    } else {
      let e = i.uv.x * i.uv.x + i.uv.y * i.uv.y * 2.8;
      if (e > 1.0) { discard; }
      let vein = exp(-i.uv.y * i.uv.y * 300.0) * step(abs(i.uv.x), 0.9);
      rgb = mix(rgb, rgb * 0.55, vein);
      rgb = rgb * (0.7 + 0.3 * sqrt(1.0 - e));
    }
  } else {
    let r = length(i.uv);
    if (r > 1.0) { discard; }
    let n = vnoise2(i.uv * 2.5 + vec2f(i.ex.y * 0.001, i.ex.x * 3.0));
    a = exp(-r * r * 3.5) * (0.6 + 0.8 * n) * (1.0 - r * r * 0.3);
    a = clamp(a, 0.0, 1.0);
  }
  let alpha = clamp(a * i.col.a, 0.0, 1.0);
  return vec4f(rgb * alpha, alpha);
}

fn segQuad(a: vec3f, b: vec3f, wa: f32, wb: f32, vi: u32) -> vec4f {
  let cs = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(0.0, 1.0),
                           vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let c = cs[vi];
  let dir = normalize(b - a + vec3f(1e-6));
  let mid = (a + b) * 0.5;
  let toCam = normalize(G.camPos.xyz - mid);
  var side = cross(dir, toCam);
  side = side / max(length(side), 1e-5);
  let w = mix(wa, wb, c.x);
  let p = mix(a, b, c.x) + side * (c.y * w);
  return vec4f(p, c.y);
}

// Lightning: each segment is two vec4 in the segs buffer: (a.xyz, width), (b.xyz, intensity).
@vertex
fn vsSeg(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> QO {
  var o: QO;
  o.pos = vec4f(0.0, 0.0, 2.0, 1.0);
  let a0 = segs[2u * ii];
  let b0 = segs[2u * ii + 1u];
  if (b0.w <= 0.0001) { return o; }
  let q = segQuad(a0.xyz, b0.xyz, a0.w, a0.w * 0.8, vi);
  o.pos = G.viewProj * vec4f(q.xyz, 1.0);
  o.s = q.w;
  o.inten = b0.w;
  return o;
}

@fragment
fn fsSeg(i: QO) -> @location(0) vec4f {
  let s = i.s;
  let glow = exp(-s * s * 4.0);
  let core = exp(-s * s * 60.0);
  let col = (vec3f(0.35, 0.6, 1.0) * glow * 0.9 + vec3f(1.0) * core) * i.inten;
  return vec4f(col, 1.0);
}

fn colormap(t: f32) -> vec3f {
  let a = vec3f(0.15, 0.35, 1.0);
  let b = vec3f(0.2, 0.9, 0.9);
  let c = vec3f(1.0, 0.85, 0.2);
  let d = vec3f(1.0, 0.25, 0.15);
  if (t < 0.33) { return mix(a, b, t / 0.33); }
  if (t < 0.66) { return mix(b, c, (t - 0.33) / 0.33); }
  return mix(c, d, (t - 0.66) / 0.34);
}

// Wind grid visualisation: one arrow per voxel, read straight from the wind texture.
@vertex
fn vsArrow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> QO {
  var o: QO;
  o.pos = vec4f(0.0, 0.0, 2.0, 1.0);
  let gx = u32(G.windDim.x);
  let gy = u32(G.windDim.y);
  let x = ii % gx;
  let y = (ii / gx) % gy;
  let z = ii / (gx * gy);
  let v = textureLoad(windTex, vec3i(i32(x), i32(y), i32(z)), 0).xyz;
  let mag = length(v);
  if (mag < 0.03) { return o; }
  let cell = G.windSize.xyz / G.windDim.xyz;
  let wp = G.windMin.xyz + (vec3f(f32(x), f32(y), f32(z)) + 0.5) * cell;
  let dn = v / mag;
  let t = clamp(mag / G.viz.x, 0.0, 1.0);
  let len = min(cell.x, cell.z) * (0.35 + 0.9 * t);
  let a = wp - dn * len * 0.5;
  let b = wp + dn * len * 0.5;
  let q = segQuad(a, b, G.viz.y * (0.6 + 0.4 * t), G.viz.y * 0.25, vi);
  o.pos = G.viewProj * vec4f(q.xyz, 1.0);
  o.s = q.w;
  o.inten = t;
  return o;
}

@fragment
fn fsArrow(i: QO) -> @location(0) vec4f {
  let col = colormap(i.inten) * (0.55 + 0.45 * (1.0 - abs(i.s)));
  return vec4f(col * 0.55, 1.0);
}

@vertex
fn vsFloor(@builtin(vertex_index) vi: u32) -> VO {
  let cs = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                           vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = cs[vi] * 60.0;
  var o: VO;
  o.uv = c;
  o.pos = G.viewProj * vec4f(c.x, 0.0, c.y, 1.0);
  return o;
}

@fragment
fn fsFloor(i: VO) -> @location(0) vec4f {
  let g = abs(fract(i.uv - 0.5) - 0.5) / fwidth(i.uv);
  let line = 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
  let dist = length(i.uv - G.camPos.xz);
  let fade = exp(-dist * 0.06);
  let base = vec3f(0.055, 0.058, 0.068);
  return vec4f(base + vec3f(0.19, 0.21, 0.25) * line * fade, 1.0);
}

@vertex
fn vsLine(i: LI) -> LO {
  var o: LO;
  o.pos = G.viewProj * vec4f(i.pos, 1.0);
  o.col = i.col;
  return o;
}

@fragment
fn fsLine(i: LO) -> @location(0) vec4f {
  return vec4f(i.col.rgb * i.col.a, i.col.a);
}
`;

  // Shared helpers are prepended to every module that needs them.
  PE.Shaders = {
    sim: COMMON + SIM,
    wind: COMMON + WIND,
    render: COMMON + RENDER,
  };
})();
