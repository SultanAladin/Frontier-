// The tablet as an OBJECT — a raymarched chassis, a floor to stand on, and glass over the front.
//
// 🔴 WHY THE INTERFACE ALONE COULD NEVER LOOK LIKE A TABLET.
//
//    Engine/SpatialInterface draws figures on a plane. That is the right shape for a user
//    interface and it is all the engine has: a housing figure is a rounded rectangle with a dark
//    colour, which is a PICTURE of a bezel, not a bezel. It has no thickness, so there is no edge
//    to catch a highlight; no normal, so nothing responds to the room; no front surface, so there
//    is no glass; and nothing around it, so there is no scale and no place. A dark rectangle
//    floating in black cannot read as a device no matter what is drawn inside it, and every hour
//    spent tuning what is drawn inside it is an hour spent on the wrong problem.
//
// 🔴 WHY THIS IS A RAYMARCH AND NOT A MESH.
//
//    A chamfered slab as triangles means a mesh, a vertex buffer, an index buffer, normals, and a
//    depth buffer for it to self-occlude against — four bindings this exchange does not have and
//    one (depth) that the interface deliberately refuses, because every figure is coplanar within
//    three millimetres and a depth test would z-fight rather than resolve.
//
//    A signed distance costs none of that. The silhouette is exact at any zoom, the corner radius
//    is a number rather than a tessellation, the normal is the gradient, and the whole body is one
//    quad with no vertex data at all. It is also the same idea the rest of this interface is built
//    on, which matters more than the saving: there is one way shapes are described here.
//
// 🔴 WHAT IS FAKED AND WHAT IS NOT, STATED PLAINLY.
//
//    NOT faked: the silhouette, the thickness, the chamfer, the surface normal, the Fresnel ramp,
//    the key light, the shadow the tablet casts on the floor (solved where the shadow ray crosses
//    the panel plane - the aperture trick again), and the light the screen pools onto the floor.
//
//    Faked: the environment is a two-tone gradient rather than a captured room, so a reflection
//    shows a sky tone and a ground tone and not the furniture. That is the one place a render
//    target would buy something real, and it is listed in Docs/SpatialHud.md as such.

export const ChassisHalfWidth = 0.230;      // [m] matches PanelHalfWidth
export const ChassisHalfHeight = 0.135;     // [m] matches PanelHalfHeight
export const ChassisHalfDepth = 0.0046;     // [m] 9.2 mm, a tablet
export const ChassisCorner = 0.020;         // [m] the corner radius in the panel plane
export const ChassisChamfer = 0.0022;       // [m] the edge roll - this is what catches the rim light

// The floor sits exactly under the bottom edge, so the tablet STANDS rather than hovers.
export const FloorHeight = -ChassisHalfHeight;   // [m] world z, because panel up is world up

// One key light, warm, from above and to the left and in front. A single source with a hard
// direction is what gives an edge a highlight that moves when the object turns; an ambient-only
// render reads as a sticker however many bounces are in it.
export const KeyDirection = [-0.38, -0.52, 0.76];
export const KeyColour = [1.00, 0.96, 0.90];
export const KeyLevel = 0.95;

// 🔴 A SECOND LIGHT, FROM BEHIND AND TO THE RIGHT, AND IT IS NOT DECORATION.
//    With one source the away-facing edge falls to the background value and the silhouette simply
//    stops existing on that side — the object loses its outline and goes back to being a shape.
//    A rim light is how a photographer separates a dark object from a dark room, and it is the
//    cheapest thing in this file.
export const RimDirection = [0.72, 0.42, 0.18];
export const RimColour = [0.52, 0.66, 0.86];
export const RimLevel = 0.55;

// 🔴 GLASS REFLECTS AREAS, NOT POINTS.
//    A single sharp specular is a pinprick that reads as a bug. What tells an eye it is looking at
//    glass is a BROAD soft shape rolling across the surface as the object turns — a window, a
//    ceiling panel. So there are two lobes: the tight one for the lamp and a wide one standing in
//    for the softbox, and the wide one does most of the work.
export const SoftSharpness = 22.0;
export const SoftLevel = 0.16;

// The environment the glass reflects. Two tones, because a flat one shows no roll.
export const SkyTone = [0.055, 0.065, 0.085];
export const GroundTone = [0.012, 0.012, 0.014];

export const ScreenPool = [0.030, 0.105, 0.150];   // what the lit face throws onto the floor
export const BodyAlbedo = [0.0165, 0.0175, 0.0200];
export const FloorAlbedo = [0.0200, 0.0210, 0.0240];
export const GlassF0 = 0.045;                // [-] dielectric
export const BodyF0 = 0.230;                 // [-] anodised aluminium, dulled
export const GlassSharpness = 1400.0;
export const BodySharpness = 120.0;

export const ChassisFloats = 72;              // 18 vec4s

// `view` carries the panel's world rows and the camera basis, because the march needs a ray and
// the interface's own Globals does not carry one.
export function packChassis(out, view) {
  out.fill(0);
  const put = (slot, a, b, c, d) => out.set([a, b, c, d], slot * 4);
  const unit = (A) => { const L = Math.hypot(A[0], A[1], A[2]) || 1; return [A[0] / L, A[1] / L, A[2] / L]; };
  const K = unit(KeyDirection), R = unit(RimDirection);

  put(0, ChassisHalfWidth, ChassisHalfHeight, ChassisHalfDepth, ChassisCorner);
  out.set(view.rows[0], 4); out.set(view.rows[1], 8); out.set(view.rows[2], 12);
  put(4, K[0], K[1], K[2], KeyLevel);
  put(5, KeyColour[0], KeyColour[1], KeyColour[2], 0);
  put(6, SkyTone[0], SkyTone[1], SkyTone[2], 0);
  put(7, GroundTone[0], GroundTone[1], GroundTone[2], 0);
  put(8, BodyAlbedo[0], BodyAlbedo[1], BodyAlbedo[2], ChassisChamfer);
  put(9, FloorAlbedo[0], FloorAlbedo[1], FloorAlbedo[2], FloorHeight);
  put(10, ScreenPool[0], ScreenPool[1], ScreenPool[2], 0);
  put(11, GlassF0, BodyF0, GlassSharpness, BodySharpness);
  put(12, R[0], R[1], R[2], RimLevel);
  put(13, RimColour[0], RimColour[1], RimColour[2], 0);
  put(14, SoftSharpness, SoftLevel, 0, 0);
  out.set([...view.right, 0], 60);
  out.set([...view.up, 0], 64);
  out.set([...view.forward, 0], 68);
  return out;
}

export const CHASSIS_WGSL = String.raw`
//------------------------------------------------------------------------------------------------------------------------
//                                                   THE CHASSIS
//------------------------------------------------------------------------------------------------------------------------
// A rounded slab, a floor, two lights and a glass front, marched in the panel's own space so the
// body moves with the tablet for free and the same rows the fibres use carry it.

struct Chassis {
  half    : vec4f,    // xyz half extent [m], w corner radius [m]
  rowX    : vec4f,    // the panel's world rows
  rowY    : vec4f,
  rowZ    : vec4f,
  key     : vec4f,    // xyz direction toward the lamp (world), w level
  keyTint : vec4f,
  sky     : vec4f,
  ground  : vec4f,
  body    : vec4f,    // xyz albedo, w chamfer [m]
  floors  : vec4f,    // xyz albedo, w world height [m]
  screen  : vec4f,    // xyz the light the face pools onto the floor
  optics  : vec4f,    // x glass F0, y body F0, z glass sharpness, w body sharpness
  rim     : vec4f,    // xyz direction, w level
  rimTint : vec4f,
  soft    : vec4f,    // x sharpness, y level
  camR    : vec4f,    // the camera basis, already scaled by aspect and the field of view
  camU    : vec4f,
  camF    : vec4f,
};

@group(0) @binding(3) var<uniform> CH : Chassis;

fn chPanelOf(world : vec3f) -> vec3f {
  let offset = world - vec3f(CH.rowX.w, CH.rowY.w, CH.rowZ.w);
  return vec3f(dot(vec3f(CH.rowX.x, CH.rowY.x, CH.rowZ.x), offset),
               dot(vec3f(CH.rowX.y, CH.rowY.y, CH.rowZ.y), offset),
               dot(vec3f(CH.rowX.z, CH.rowY.z, CH.rowZ.z), offset));
}

fn chTurnIn(world : vec3f) -> vec3f {
  return vec3f(dot(vec3f(CH.rowX.x, CH.rowY.x, CH.rowZ.x), world),
               dot(vec3f(CH.rowX.y, CH.rowY.y, CH.rowZ.y), world),
               dot(vec3f(CH.rowX.z, CH.rowY.z, CH.rowZ.z), world));
}

fn chTurnOut(panel : vec3f) -> vec3f {
  return vec3f(dot(CH.rowX.xyz, panel), dot(CH.rowY.xyz, panel), dot(CH.rowZ.xyz, panel));
}

// The engine's own rounded rectangle in the panel plane, extruded with a rolled edge. Rounding the
// EXTRUSION rather than the box puts the chamfer on the rim only, where a milled edge has one,
// instead of swelling the corner radius in the plane as well.
fn chBody(panel : vec3f) -> f32 {
  let chamfer = CH.body.w;
  let plane = DistanceRoundedRectangle(panel.xy, CH.half.xy, CH.half.w) + chamfer;
  let through = abs(panel.z) - CH.half.z + chamfer;
  return min(max(plane, through), 0.0) + length(max(vec2f(plane, through), vec2f(0.0))) - chamfer;
}

fn chNormal(panel : vec3f) -> vec3f {
  let h = 0.00018;
  return normalize(vec3f(
    chBody(panel + vec3f(h, 0.0, 0.0)) - chBody(panel - vec3f(h, 0.0, 0.0)),
    chBody(panel + vec3f(0.0, h, 0.0)) - chBody(panel - vec3f(0.0, h, 0.0)),
    chBody(panel + vec3f(0.0, 0.0, h)) - chBody(panel - vec3f(0.0, 0.0, h))));
}

fn chEnvironment(direction : vec3f) -> vec3f {
  return mix(CH.ground.xyz, CH.sky.xyz, clamp(direction.z * 0.5 + 0.5, 0.0, 1.0));
}

fn chFresnel(f0 : f32, cosine : f32) -> f32 {
  return f0 + (1.0 - f0) * pow(clamp(1.0 - cosine, 0.0, 1.0), 5.0);
}

// Does the lamp reach this point? The slab is thin, so rather than march a shadow ray the sightline
// is carried to the panel plane and tested against the face - the aperture solve, again.
fn chLit(panel : vec3f) -> f32 {
  let toLight = chTurnIn(CH.key.xyz);
  if (abs(toLight.z) < 1.0e-7) { return 1.0; }
  let cross = -panel.z / toLight.z;
  if (cross <= 0.0) { return 1.0; }
  let meet = panel.xy + toLight.xy * cross;
  return 1.0 - CoverageFromDistance(DistanceRoundedRectangle(meet, CH.half.xy, CH.half.w), 0.004);
}

fn chRay(position : vec2f) -> vec3f {
  let ndc = vec2f(position.x / G.extent.x * 2.0 - 1.0, 1.0 - position.y / G.extent.y * 2.0);
  return normalize(CH.camF.xyz + CH.camR.xyz * ndc.x + CH.camU.xyz * ndc.y);
}

// A full-screen triangle. Three vertices, no buffer, and it covers the viewport exactly once.
@vertex
fn vsScreenwide(@builtin(vertex_index) vi : u32) -> @builtin(position) vec4f {
  let x = f32((vi << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vi & 2u) * 2.0 - 1.0;
  return vec4f(x, -y, 0.0, 1.0);
}

@fragment
fn fsChassis(@builtin(position) at : vec4f) -> @location(0) vec4f {
  let ray = chRay(at.xy);
  let eye = G.eye.xyz;
  let keyLit = CH.keyTint.xyz * CH.key.w;
  let rimLit = CH.rimTint.xyz * CH.rim.w;

  var best = 1.0e9;
  var kind = 0u;                                   // 0 nothing, 1 the body, 2 the floor

  if (ray.z < -1.0e-6 && eye.z > CH.floors.w) {
    let t = (CH.floors.w - eye.z) / ray.z;
    if (t > 0.0) { best = t; kind = 2u; }
  }

  // The body, sphere-traced in panel space: the transform is rigid, so the distance carries over.
  let eyePanel = chPanelOf(eye);
  let dirPanel = chTurnIn(ray);
  var t = 0.0;
  for (var step = 0; step < 72; step++) {
    let d = chBody(eyePanel + dirPanel * t);
    if (d < 2.0e-5) { if (t < best) { best = t; kind = 1u; } break; }
    t += d;
    if (t > 6.0 || t > best) { break; }
  }
  if (kind == 0u) { discard; }

  let where = eye + ray * best;
  let view = -ray;
  var colour = vec3f(0.0);

  if (kind == 1u) {
    let panel = chPanelOf(where);
    let nPanel = chNormal(panel);
    let normal = chTurnOut(nPanel);
    let facing = nPanel.z > 0.70;                  // the glass front, not the rim and not the back

    let albedo = select(CH.body.xyz, vec3f(0.0030, 0.0032, 0.0038), facing);
    let f0 = select(CH.optics.y, CH.optics.x, facing);
    let sharp = select(CH.optics.w, CH.optics.z, facing);

    let shade = chLit(panel);
    let lambert = max(dot(normal, CH.key.xyz), 0.0) * shade;
    let grazing = max(dot(normal, CH.rim.xyz), 0.0);
    let half = normalize(CH.key.xyz + view);
    let aim = max(dot(normal, half), 0.0);
    let toward = chFresnel(f0, max(dot(normal, view), 0.0));
    let mirror = chEnvironment(reflect(ray, normal));

    colour = albedo * (keyLit * lambert + rimLit * grazing + chEnvironment(normal) * 1.6)
           + (keyLit * pow(aim, sharp) * 1.3 * shade + keyLit * pow(aim, CH.soft.x) * CH.soft.y) * toward
           + mirror * toward * 1.5;
  } else {
    let normal = vec3f(0.0, 0.0, 1.0);
    let panel = chPanelOf(where);
    let lambert = max(CH.key.z, 0.0) * chLit(panel);

    // The face is an AREA source, so the pool falls off more gently than inverse square and is
    // weighted by how much of the face the floor point can see.
    let toFace = vec3f(CH.rowX.w, CH.rowY.w, CH.rowZ.w) - where;
    let reach = length(toFace);
    let sees = max(dot(normal, toFace / max(reach, 1.0e-4)), 0.0);
    let toward = chFresnel(0.035, max(dot(normal, view), 0.0));

    colour = CH.floors.xyz * (keyLit * lambert + chEnvironment(normal) * 1.5)
           + CH.screen.xyz * exp(-reach / 0.21) * sees
           + chEnvironment(vec3f(-view.x, -view.y, abs(view.z))) * toward * 0.8;

    // No hard horizon: the floor dissolves into the background rather than ending.
    colour = mix(vec3f(0.012, 0.014, 0.018), colour, clamp(exp(-max(reach - 0.5, 0.0) / 0.85), 0.0, 1.0));
  }

  return vec4f(colour, 1.0);
}

// 🔴 THE GLASS GOES ON LAST, OVER THE INTERFACE.
//    A reflection lives on the outer surface and the picture is behind it. Drawing the sheen under
//    the readout would say the opposite, and an eye reads that instantly as a decal.
@fragment
fn fsGlass(@builtin(position) at : vec4f) -> @location(0) vec4f {
  let ray = chRay(at.xy);
  let eyePanel = chPanelOf(G.eye.xyz);
  let dirPanel = chTurnIn(ray);
  if (abs(dirPanel.z) < 1.0e-7) { discard; }

  let t = (CH.half.z - eyePanel.z) / dirPanel.z;
  if (t <= 0.0) { discard; }

  let panel = eyePanel + dirPanel * t;
  let edge = CoverageFromDistance(DistanceRoundedRectangle(panel.xy, CH.half.xy, CH.half.w), 0.0006);
  if (edge <= 0.0) { discard; }

  let face = chTurnOut(vec3f(0.0, 0.0, 1.0));
  let view = -ray;
  let cosine = dot(face, view);
  if (cosine <= 0.0) { discard; }

  let toward = chFresnel(CH.optics.x, cosine);
  let half = normalize(CH.key.xyz + view);
  let aim = max(dot(face, half), 0.0);
  let mirror = chEnvironment(reflect(ray, face));
  let keyLit = CH.keyTint.xyz * CH.key.w;

  // The display edge: where the painted bezel behind the glass gives way to the panel. On a real
  // tablet this is a hairline, not a border, and leaving it out is one of the things that makes a
  // render read as a drawing of a tablet rather than as one.
  let inner = DistanceRoundedRectangle(panel.xy, CH.half.xy - vec2f(0.0082), 0.0145);
  let seam = exp(-(inner * inner) / (0.00055 * 0.00055)) * 0.020;

  let level = toward * edge;
  let lit = (mirror * 1.5 + keyLit * (pow(aim, CH.optics.z) * 1.6 + pow(aim, CH.soft.x) * CH.soft.y)) * level
          + vec3f(1.0, 1.04, 1.12) * seam * edge;
  return vec4f(lit, 1.0);
}
`;
