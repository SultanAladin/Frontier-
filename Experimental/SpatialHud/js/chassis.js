// The tablet as an OBJECT: a body with thickness, edges that catch light, and glass that reflects
// the room it is standing in.
//
// 🔴 WHY THIS IS A RAYMARCH AND NOT A PICTURE OF A BEZEL.
//
//    Everything in Engine/SpatialInterface is a flat figure on a plane. That is exactly right for
//    the interface — a needle has no thickness — and exactly wrong for the thing the interface is
//    printed on. A tablet read as a tablet because of three cues, none of which a plane can give:
//
//      1. A SILHOUETTE WITH DEPTH. Turn a real device and its side wall comes into view. A quad
//         has no side wall; it just gets narrower, which is what a sticker does.
//      2. AN EDGE THAT CATCHES THE KEY. The bright chamfer running along the top edge is the
//         single strongest "machined object" cue there is, and it exists because the edge is a
//         curved surface whose normal sweeps through the light.
//      3. GLASS THAT REFLECTS SOMETHING. A screen that emits and never reflects reads as a lamp.
//         The reflection has to MOVE against the surface as the eye moves, which means it has to
//         be computed from the view direction and not painted on.
//
//    All three are properties of a surface normal, so all three need a surface. The body is a
//    rounded box signed distance evaluated in the panel's own space — the same kind of function
//    the interface already is, one dimension up — marched in a pass of its own before the
//    interface draws, and the glass is a second quad composited after it.
//
//    This is the "custom raster" rung. It is not a render target: still no offscreen texture, no
//    sampler, no second camera. One more pass over the same frame.
//
// 🔴 WHAT IS DELIBERATELY NOT HERE YET.
//
//    No floor and no contact shadow, so the tablet is a product shot in a dark room rather than an
//    object resting on something. A floor wants the panel leaned back on a stand, which moves the
//    housing's quarter turn about X that the layout and its checks are built on. Worth doing;
//    worth doing on purpose.
//
//    No refraction through the glass, and no parallax between the glass surface and the interface
//    beneath it. Both want the interface rendered before the glass is shaded, which is the first
//    thing here that would actually need an offscreen target.

import { PanelHalfWidth, PanelHalfHeight } from './layout.js';

export const RoomFloats = 36;                  // 9 vec4s

// The body, in panel metres. The front face sits at panel z = 0, so the interface — which is
// authored on that plane — lands exactly on the glass.
export const Chassis = {
  halfWidth: 0.2320,          // [m] a touch proud of the face, so there is a bezel to see
  halfHeight: 0.1370,
  halfDepth: 0.0105,          // [m] 21 mm thick: a rugged fascia, not a phone, and thick
                              //     enough that the side wall is a surface you can see
  cornerRadius: 0.0210,       // [m] the corner of the slab, in all three dimensions
  bodyRoughness: 0.34,        // anodised aluminium, bead blasted
  glassRoughness: 0.055,      // a hard coat: a tight reflection that still is not a mirror
  keyIntensity: 2.6,
  screenSpill: 0.55,          // how much of the screen's own light lands on the bezel around it
};

export function packRoom(out, rows, camera) {
  out.fill(0);
  const put = (slot, a, b, c, d) => out.set([a, b, c, d], slot * 4);

  out.set(rows[0], 0);
  out.set(rows[1], 4);
  out.set(rows[2], 8);
  put(3, Chassis.halfWidth, Chassis.halfHeight, Chassis.halfDepth, Chassis.cornerRadius);
  put(4, camera.forward[0], camera.forward[1], camera.forward[2], camera.tanHalf);
  put(5, camera.right[0], camera.right[1], camera.right[2], camera.aspect);
  put(6, camera.up[0], camera.up[1], camera.up[2], Chassis.screenSpill);
  put(7, Chassis.bodyRoughness, Chassis.glassRoughness, Chassis.keyIntensity, 0);
  // The PANEL rectangle, which is what the display texture covers and so what the glass
  // samples across. It is not the body's: the body stands a couple of millimetres proud.
  put(8, PanelHalfWidth, PanelHalfHeight, 0, 0);
  return out;
}

export const CHASSIS_WGSL = String.raw`
//------------------------------------------------------------------------------------------------------------------------
//                                                   THE TABLET ITSELF
//------------------------------------------------------------------------------------------------------------------------

struct Room {
  rowX : vec4f,     // panel -> world, as the interface's own placement rows
  rowY : vec4f,
  rowZ : vec4f,
  body : vec4f,     // xyz half extent [m] (z = half depth), w corner radius [m]
  look : vec4f,     // xyz camera forward, w tan(fov / 2)
  side : vec4f,     // xyz camera right, w aspect
  rise : vec4f,     // xyz camera up, w screen spill
  tone : vec4f,     // x body roughness, y glass roughness, z key intensity
  face : vec4f,     // xy panel half extent [m] - the rectangle the display covers
};

@group(0) @binding(3) var<uniform> R : Room;

// The key. One hard source high and over the viewer's left shoulder, which is where a product shot
// puts it, and the one the glass reflection is built around.
const kKeyDirection = vec3f(-0.3827, -0.6428, 0.6634);

// 🔴 AND THE THING THE GLASS REFLECTS IS A DIFFERENT LIGHT ENTIRELY.
//
//    The key above is high, which is where a key belongs: it rakes the top edge and gives the slab
//    its form. It is useless to the glass. This panel stands UPRIGHT, so its mirror direction for
//    any eye at roughly screen height points DOWNWARD and slightly forward — a vertical screen
//    reflects what is in front of it, never the ceiling. Aim the key at the glass and the maths
//    says the highlight is somewhere below the floor, which is why the first attempt produced a
//    black sheet with a rim.
//
//    A studio solves this with a second thing: a large soft card in front of the subject. Work out
//    where it has to be rather than guessing - for an eye above the panel's centre the mirror
//    direction points DOWN, so the card belongs LOW, which in a real room is the lit table the
//    device is standing on. That is also what you are looking at in the reflection of every dark
//    television you have ever seen.
//
//    The consequence is worth having: head-on the card is near the edge of the lobe and the glass
//    is almost clear, and as the panel tilts the reflection blooms across it. That swing is the
//    behaviour, not a side effect of it.
const kFrontCard = vec3f(-0.3302, -0.8805, -0.3402);

// The room behind the tablet is the same studio seen directly rather than in a surface, and it is
// dimmed because it is scenery. The tablet is the subject and has to stay the brightest thing in
// the picture at every orbit, including the grazing ones where the front card swings into view.
const kRoomFalloff = 0.55;

// ── the room ─────────────────────────────────────────────────────────────────────────────────────
// There is no environment map and there is not going to be one — a sampled cube is a texture
// binding, which this exchange does not have and does not want. The room is a closed-form function
// of a direction, exactly as the streak field is a closed-form function of a plane coordinate, and
// for the same reason: a surface has to be able to answer what it reflects at a hit point.

// 🔴 THE LIGHT IS A CARD, NOT A POINT, AND THAT IS THE WHOLE TRICK.
//
//    A first attempt used pow(dot(dir, key), n) for the source. On a rough surface that is fine.
//    On GLASS it produces nothing: a flat mirror reflects one direction per pixel, so a lobe tight
//    enough to look sharp is tight enough that the eye never lands in it, and the screen comes out
//    as a dark sheet with a rim. Every photograph of a device in the world shows a long soft STRIP
//    lying across the glass, and that shape is the light's shape, not the material's.
//
//    So a source here is a rectangle, measured in the tangent plane about its own axis: wide in
//    one direction, narrow in the other. The surface decides how blurred it is, the card decides
//    what it looks like, and the two are no longer the same number.
fn RoomCard(direction : vec3f, axis : vec3f, wide : f32, tall : f32, sharpness : f32) -> f32 {
  let depth = dot(direction, axis);
  if (depth <= 0.02) { return 0.0; }

  let sideways = normalize(cross(axis, vec3f(0.0, 0.0, 1.0)));
  let upward = cross(sideways, axis);
  let spread = mix(3.0, 1.0, sharpness);         // a rough surface sees a bigger, softer card

  let across = dot(direction, sideways) / depth / (wide * spread);
  let along = dot(direction, upward) / depth / (tall * spread);
  return exp(-(across * across + along * along));
}

fn RoomLight(direction : vec3f, sharpness : f32) -> vec3f {
  // The shell: a dark studio, a little lift toward the ceiling, a cool floor bounce.
  let height = clamp(direction.z * 0.5 + 0.5, 0.0, 1.0);
  var light = mix(vec3f(0.0070, 0.0080, 0.0105), vec3f(0.0360, 0.0400, 0.0500), height * height);
  light += vec3f(0.0130, 0.0145, 0.0175) * pow(clamp(-direction.z, 0.0, 1.0), 2.0);

  // The key: a long narrow strip high and over the viewer's left shoulder. This is the one that
  // draws the chamfer along the top edge of the body.
  light += vec3f(1.00, 0.985, 0.955)
         * RoomCard(direction, kKeyDirection, 0.55, 0.070, sharpness) * mix(1.1, 6.0, sharpness);

  // The front card: large, soft, nearly horizontal, standing where a photographer would stand.
  // This is what the GLASS shows.
  light += vec3f(0.94, 0.965, 1.00)
         * RoomCard(direction, kFrontCard, 1.10, 0.26, sharpness) * mix(0.7, 2.4, sharpness);

  // A second, cooler and much softer card on the right, so the dark side of the slab is not black
  // and the glass has more than one thing to show.
  light += vec3f(0.30, 0.42, 0.62)
         * RoomCard(direction, normalize(vec3f(0.80, -0.36, 0.22)), 0.45, 0.30, sharpness)
         * mix(0.35, 1.5, sharpness);
  return light;
}

// ── panel space ──────────────────────────────────────────────────────────────────────────────────
// The rows carry panel -> world and the rotation is orthonormal, so the inverse is the transpose:
// the COLUMNS of the rows. The whole body is solved in panel metres, where it is axis aligned.

fn RoomToPanelPoint(world : vec3f) -> vec3f {
  let offset = world - vec3f(R.rowX.w, R.rowY.w, R.rowZ.w);
  return vec3f(dot(vec3f(R.rowX.x, R.rowY.x, R.rowZ.x), offset),
               dot(vec3f(R.rowX.y, R.rowY.y, R.rowZ.y), offset),
               dot(vec3f(R.rowX.z, R.rowY.z, R.rowZ.z), offset));
}

fn RoomToPanelDirection(world : vec3f) -> vec3f {
  return vec3f(dot(vec3f(R.rowX.x, R.rowY.x, R.rowZ.x), world),
               dot(vec3f(R.rowX.y, R.rowY.y, R.rowZ.y), world),
               dot(vec3f(R.rowX.z, R.rowY.z, R.rowZ.z), world));
}

fn RoomToWorldDirection(panel : vec3f) -> vec3f {
  return vec3f(dot(R.rowX.xyz, panel), dot(R.rowY.xyz, panel), dot(R.rowZ.xyz, panel));
}

// ── the body ─────────────────────────────────────────────────────────────────────────────────────
// A rounded box: the three dimensional sibling of DistanceRoundedRectangle, and the same identity —
// push the half extent in by the radius, measure to the shrunken box, push back out.

fn RoomBody(panel : vec3f) -> f32 {
  let radius = R.body.w;
  let centre = vec3f(0.0, 0.0, -R.body.z);                 // front face lands on panel z = 0
  let inner = max(R.body.xyz - vec3f(radius), vec3f(0.0));
  let delta = abs(panel - centre) - inner;
  return length(max(delta, vec3f(0.0))) + min(max(delta.x, max(delta.y, delta.z)), 0.0) - radius;
}

fn RoomNormal(panel : vec3f) -> vec3f {
  // Tetrahedral differences: four evaluations instead of six, and no bias toward an axis.
  let h = 2.0e-5;
  let a = vec3f( 1.0, -1.0, -1.0);
  let b = vec3f(-1.0, -1.0,  1.0);
  let c = vec3f(-1.0,  1.0, -1.0);
  let d = vec3f( 1.0,  1.0,  1.0);
  return normalize(a * RoomBody(panel + a * h) + b * RoomBody(panel + b * h)
                 + c * RoomBody(panel + c * h) + d * RoomBody(panel + d * h));
}

struct RoomHit {
  struck : bool,
  panel  : vec3f,
  travel : f32,
};

fn RoomMarch(origin : vec3f, direction : vec3f) -> RoomHit {
  var hit : RoomHit;
  hit.struck = false;
  hit.panel = origin;
  hit.travel = 0.0;

  var travel = 0.0;
  for (var step = 0; step < 72; step = step + 1) {
    let here = origin + direction * travel;
    let distance = RoomBody(here);
    if (distance < 1.5e-5) {
      hit.struck = true;
      hit.panel = here;
      hit.travel = travel;
      return hit;
    }
    travel += max(distance, 1.0e-5);
    if (travel > 6.0) { break; }
  }
  return hit;
}

// ── shading ──────────────────────────────────────────────────────────────────────────────────────
// Anodised aluminium: a dark, slightly metallic albedo with a broad specular lobe. The point of the
// material is not that it is physically complete; it is that the EDGE behaves — the normal sweeps
// through the key along the chamfer, so the rim lights up and the slab reads as machined.

fn RoomSchlick(cosine : f32, base : f32) -> f32 {
  let f = clamp(1.0 - cosine, 0.0, 1.0);
  let f2 = f * f;
  return base + (1.0 - base) * f2 * f2 * f;
}

fn RoomBodyShade(worldPoint : vec3f, worldNormal : vec3f, view : vec3f, screenNear : f32) -> vec3f {
  let roughness = R.tone.x;
  let sharpness = clamp(1.0 - roughness, 0.0, 1.0);

  let albedo = vec3f(0.0320, 0.0345, 0.0400);
  let lambert = max(dot(worldNormal, kKeyDirection), 0.0);
  var light = albedo * (lambert * R.tone.z + 0.14);

  // Ambient from the room, in the direction the surface faces.
  light += albedo * RoomLight(worldNormal, 0.0) * 3.4;

  // The reflection. A rough metal still mirrors the softbox, just widely.
  let bounce = reflect(-view, worldNormal);
  let fresnel = RoomSchlick(max(dot(worldNormal, view), 0.0), 0.055);
  light += RoomLight(bounce, sharpness * 0.55) * fresnel * 1.9;

  // The chamfer. Where the slab turns, its normal sweeps through the key in the space of a couple
  // of millimetres and a bright line runs along the edge. It is the strongest "machined from a
  // solid" cue there is, and on a plane it simply cannot happen.
  let turn = 1.0 - abs(dot(worldNormal, normalize(vec3f(R.rowX.z, R.rowY.z, R.rowZ.z))));
  light += vec3f(0.30, 0.33, 0.40) * pow(clamp(turn, 0.0, 1.0), 2.0) * lambert * 0.55;

  // The screen spills onto the bezel around it. A lit panel in a dark room does this, and leaving
  // it out is what makes a bezel look painted on rather than adjacent to something bright.
  light += vec3f(0.055, 0.195, 0.300) * screenNear * R.rise.w;
  return light;
}

// ── the pass ─────────────────────────────────────────────────────────────────────────────────────

struct RoomVarying {
  @builtin(position) Position : vec4f,
};

@vertex
fn vsRoom(@builtin(vertex_index) Vertex : u32) -> RoomVarying {
  // One oversized triangle. Cheaper than a quad and with no seam down the diagonal.
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out : RoomVarying;
  out.Position = vec4f(corners[Vertex], 0.0, 1.0);
  return out;
}

@fragment
fn fsRoom(in : RoomVarying) -> @location(0) vec4f {
  let screen = in.Position.xy / G.extent.xy * 2.0 - vec2f(1.0);
  let direction = normalize(R.look.xyz
                          + R.side.xyz * (screen.x * R.side.w * R.look.w)
                          + R.rise.xyz * (-screen.y * R.look.w));

  let originPanel = RoomToPanelPoint(G.eye.xyz);
  let dirPanel = RoomToPanelDirection(direction);

  let hit = RoomMarch(originPanel, dirPanel);
  if (!hit.struck) {
    // The room behind the tablet. Faint, but it is what the glass has to reflect, so it had better
    // be the same function the glass asks.
    return vec4f(RoomLight(direction, 0.0) * kRoomFalloff, 1.0);
  }

  let normalPanel = RoomNormal(hit.panel);
  let worldNormal = normalize(RoomToWorldDirection(normalPanel));
  let worldPoint = G.eye.xyz + direction * hit.travel;
  let view = -direction;

  // How close this point is to the lit face, for the spill. Measured in the panel's own plane and
  // only on the front, so the back of the device stays dark.
  let faceReach = DistanceRoundedRectangle(hit.panel.xy, R.body.xy - vec2f(0.0115), 0.0145);
  let facing = clamp(normalPanel.z, 0.0, 1.0);
  let screenNear = facing * exp(-max(faceReach, 0.0) / 0.010);

  // The glass itself is not shaded here: the interface draws into this region next, and the
  // reflection goes over the top of it in the glass pass. What is left is a near-black well, so an
  // interface element that never covers a pixel still reads as switched-off screen, not as hole.
  if (faceReach < 0.0 && normalPanel.z > 0.86) {
    return vec4f(vec3f(0.0042, 0.0048, 0.0060), 1.0);
  }

  return vec4f(RoomBodyShade(worldPoint, worldNormal, view, screenNear), 1.0);
}

// ── the glass ────────────────────────────────────────────────────────────────────────────────────
// A quad on the panel's own plane, composited over the finished interface. Fresnel against the
// The glass is no longer here. It became a pass that SAMPLES the display target rather than
// one that adds light on top of a finished picture, so it lives in js/display.js next to
// the target it reads. See the header there for why additive glass was never glass.
`;
