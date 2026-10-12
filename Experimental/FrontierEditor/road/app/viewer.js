// Frontier Road Editor — WebGL2 viewer.
//
// One program, one vertex format (position, normal, colour, emissive), one draw
// call per visible tile per group. Colours come from the style table baked into
// vertex data by the worker, so a road never depends on a texture being loaded
// and the whole network is one buffer layout. Shading is a directional sun plus
// a sky/ground hemisphere, with a distance fog that fades the map edge into the
// horizon; the ground is a displaced grid sampled from the same terrain function
// the roads follow, so nothing floats and nothing z-fights.

import { MATERIALS } from '../core/styles.js';
import { boxVisible } from './camera.js';

const VERT = `#version 300 es
precision highp float;
in vec3 aPos;
in vec3 aNrm;
in vec4 aCol;
uniform mat4 uProj, uView;
uniform vec3 uOrigin;
out vec3 vNrm;
out vec4 vCol;
out vec3 vPos;
void main() {
  vec3 p = aPos - uOrigin;
  vNrm = aNrm;
  vCol = aCol;
  vPos = p;
  gl_Position = uProj * uView * vec4(p, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNrm;
in vec4 vCol;
in vec3 vPos;
uniform vec3 uSun, uSunCol, uSkyCol, uGroundCol, uFogCol, uCamPos;
uniform vec3 uOrigin;
uniform float uFogNear, uFogFar, uAmbient;
out vec4 outCol;
void main() {
  vec3 n = normalize(vNrm);
  float up = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 ambient = mix(uGroundCol, uSkyCol, up) * uAmbient;
  float lam = max(dot(n, uSun), 0.0);
  // A little wrap so vertical faces in shade are not pitch black.
  float wrap = max(dot(n, uSun) * 0.5 + 0.5, 0.0);
  vec3 diffuse = uSunCol * (lam * 0.75 + wrap * 0.25);
  vec3 base = vCol.rgb;
  vec3 lit = base * (ambient + diffuse) + base * vCol.a * 1.4;
  float d = length(vPos - (uCamPos - uOrigin));
  float f = clamp((d - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  outCol = vec4(mix(lit, uFogCol, f * f * 0.92), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader error');
  return s;
}

export class Viewer {
  constructor(canvas, opts = {}) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.canvas = canvas;
    this.opts = opts;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.loc = {};
    for (const name of ['uProj', 'uView', 'uOrigin', 'uSun', 'uSunCol', 'uSkyCol', 'uGroundCol', 'uFogCol', 'uCamPos', 'uFogNear', 'uFogFar', 'uAmbient']) {
      this.loc[name] = gl.getUniformLocation(prog, name);
    }
    this.attribs = {
      aPos: gl.getAttribLocation(prog, 'aPos'),
      aNrm: gl.getAttribLocation(prog, 'aNrm'),
      aCol: gl.getAttribLocation(prog, 'aCol'),
    };
    this.chunks = [];
    this.ground = null;
    this.origin = [0, 0, 0];
    this.time = 0;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    this.groups = { deck: true, markings: true, furniture: true, structures: true };
  }

  setGroup(name, on) { this.groups[name] = !!on; }

  uploadChunks(chunks) {
    const gl = this.gl;
    this.clear();
    for (const c of chunks) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const interleaved = new Float32Array(c.pos.length + c.nrm.length + c.col.length);
      // interleave: pos(3) nrm(3) col(4)
      const vcount = c.pos.length / 3;
      let o = 0;
      for (let v = 0; v < vcount; v++) {
        interleaved[o++] = c.pos[v * 3]; interleaved[o++] = c.pos[v * 3 + 1]; interleaved[o++] = c.pos[v * 3 + 2];
        interleaved[o++] = c.nrm[v * 3]; interleaved[o++] = c.nrm[v * 3 + 1]; interleaved[o++] = c.nrm[v * 3 + 2];
        interleaved[o++] = c.col[v * 4]; interleaved[o++] = c.col[v * 4 + 1]; interleaved[o++] = c.col[v * 4 + 2]; interleaved[o++] = c.col[v * 4 + 3];
      }
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
      const stride = 40;
      gl.enableVertexAttribArray(this.attribs.aPos);
      gl.vertexAttribPointer(this.attribs.aPos, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(this.attribs.aNrm);
      gl.vertexAttribPointer(this.attribs.aNrm, 3, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(this.attribs.aCol);
      gl.vertexAttribPointer(this.attribs.aCol, 4, gl.FLOAT, false, stride, 24);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, c.idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      this.chunks.push({
        group: c.group, key: c.key, bounds: c.bounds, tris: c.tris,
        vao, vbo, ibo, count: c.idx.length,
      });
    }
    this.origin = [0, 0, 0];
    return this.chunks.length;
  }

  buildGround(terrainH, bounds, colour = [0.30, 0.36, 0.22]) {
    const gl = this.gl;
    const pad = 900;
    const x0 = bounds[0] - pad, z0 = bounds[2] - pad;
    const x1 = bounds[3] + pad, z1 = bounds[5] + pad;
    const span = Math.max(x1 - x0, z1 - z0);
    const n = Math.max(24, Math.min(160, Math.round(span / 55)));
    const verts = [], idxs = [];
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const x = x0 + ((x1 - x0) * i) / n;
        const z = z0 + ((z1 - z0) * j) / n;
        verts.push(x, terrainH(x, z) - 0.22, z, 0, 1, 0, colour[0], colour[1], colour[2], 0);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        // Wound so the ground faces up: with x to the right on the map and z
        // along it, (a, a+1, b+1) is the counter-clockwise order seen from above,
        // and the opposite order would be back-facing and culled away entirely.
        const a = i * (n + 1) + j, b = (i + 1) * (n + 1) + j;
        idxs.push(a, a + 1, b + 1, a, b + 1, b);
      }
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    const stride = 40;
    gl.enableVertexAttribArray(this.attribs.aPos);
    gl.vertexAttribPointer(this.attribs.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.attribs.aNrm);
    gl.vertexAttribPointer(this.attribs.aNrm, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(this.attribs.aCol);
    gl.vertexAttribPointer(this.attribs.aCol, 4, gl.FLOAT, false, stride, 24);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idxs), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    if (this.ground) { gl.deleteVertexArray(this.ground.vao); gl.deleteBuffer(this.ground.vbo); gl.deleteBuffer(this.ground.ibo); }
    this.ground = { vao, vbo, ibo, count: idxs.length };
    return this.ground;
  }

  clear() {
    const gl = this.gl;
    for (const c of this.chunks) { gl.deleteVertexArray(c.vao); gl.deleteBuffer(c.vbo); gl.deleteBuffer(c.ibo); }
    this.chunks = [];
  }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    return w / h;
  }

  /** Draw one frame. Returns stats for the HUD. */
  render(cam, opts = {}) {
    const gl = this.gl;
    const aspect = this.resize();
    const fov = opts.fov ?? 60;
    const far = opts.far ?? 9000;
    const { proj, view } = cam.matrices(aspect, fov, 0.25, far);
    const horizon = 0.62;
    const sky = [0.42, 0.56, 0.72];
    const fog = [0.66, 0.72, 0.80];
    gl.clearColor(fog[0] * horizon + sky[0] * (1 - horizon), fog[1] * horizon + sky[1] * (1 - horizon), fog[2] * horizon + sky[2] * (1 - horizon), 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.loc.uProj, false, proj);
    gl.uniformMatrix4fv(this.loc.uView, false, view);
    gl.uniform3fv(this.loc.uOrigin, this.origin);
    gl.uniform3fv(this.loc.uSun, opts.sun || [0.42, 0.72, -0.55]);
    gl.uniform3fv(this.loc.uSunCol, opts.sunCol || [1.02, 0.98, 0.88]);
    gl.uniform3fv(this.loc.uSkyCol, sky);
    gl.uniform3fv(this.loc.uGroundCol, [0.20, 0.19, 0.17]);
    gl.uniform3fv(this.loc.uFogCol, fog);
    gl.uniform3fv(this.loc.uCamPos, cam.pos);
    gl.uniform1f(this.loc.uFogNear, Math.max(60, (opts.fogNear ?? 220)));
    gl.uniform1f(this.loc.uFogFar, opts.fogFar ?? 2600);
    gl.uniform1f(this.loc.uAmbient, opts.ambient ?? 0.55);

    let drawn = 0, tris = 0;
    if (this.ground && this.groups.deck !== 'ground-off') {
      gl.bindVertexArray(this.ground.vao);
      gl.drawElements(gl.TRIANGLES, this.ground.count, gl.UNSIGNED_INT, 0);
    }
    for (const c of this.chunks) {
      if (this.groups[c.group] === false) continue;
      if (!boxVisible(cam, c.bounds, aspect, fov, far)) continue;
      gl.bindVertexArray(c.vao);
      gl.drawElements(gl.TRIANGLES, c.count, gl.UNSIGNED_INT, 0);
      drawn++; tris += c.tris;
    }
    gl.bindVertexArray(null);
    return { chunks: drawn, total: this.chunks.length, tris };
  }

  /** Ground height under a plan point, if a ground mesh was built from terrain. */
  materialFor(name) { return MATERIALS[name]; }
}
