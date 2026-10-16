//============================================================================================================================================
//                                                            TYRECARCASS.WGSL
//============================================================================================================================================
// 🧩 The soft tyre in the vertex stage: the flexible-ring belt deflections a wheel's tyre vertices take, its bulge, shift and folds.

// 📝 TyreCarcassSolver.js integrates a 96-node belt per wheel in the wheel's own frame. Here a tyre vertex, hub-local
//    with the axle along +Y, finds its belt angle φ in the x–z plane and moves inward by the belt's deflection there
//    times the share of the sidewall height it sits at — the bead stays on the rim (share 0), the tread takes all of
//    it (share 1), and every rim vertex, being inside the rim radius, is left alone. The sidewalls bulge out of both
//    faces by the deflection, the belt shifts sideways round the patch under cornering, and a tyre close to empty
//    throws radial folds that ride with the rubber. The normal turns with the profile: in the flattened patch it
//    faces the road. Every including shader declares
//
//        var<storage, read> Carcasses : array<TyreCarcass, 4>;

struct TyreCarcass
{
    Shape      : vec4f,               // x tread radius [m], y rim radius [m], z half width [m], w belt nodes
    Pose       : vec4f,               // x road angle in the wheel frame [rad], y lateral belt shift [m], z its angular spread [rad],
                                      // w sidewall bulge per metre of deflection [-]
    Folds      : vec4f,               // x fold amplitude [m], y fold count, z phase [rad], w pressure over reference [-]
    Deflection : array<vec4f, 24>,    // [m] radial belt deflection per node, inward positive
}

struct DeformedVertex
{
    Position : vec3f,
    Normal   : vec3f,
}

const CarcassNodeCount : i32 = 96;

fn ReadCarcassNode(Wheel: u32, Node: i32) -> f32
{
    let Wrapped = u32(((Node % CarcassNodeCount) + CarcassNodeCount) % CarcassNodeCount);
    return Carcasses[Wheel].Deflection[Wrapped / 4u][Wrapped % 4u];
}

// 📐 Catmull–Rom through the four nodes about φ: (deflection, ∂deflection/∂φ).
fn SampleCarcass(Wheel: u32, φ: f32) -> vec2f
{
    let Scale = f32(CarcassNodeCount) / 6.28318530718;
    let U = fract(φ / 6.28318530718) * f32(CarcassNodeCount);
    let Base = i32(floor(U));
    let T = U - floor(U);
    let P0 = ReadCarcassNode(Wheel, Base - 1);
    let P1 = ReadCarcassNode(Wheel, Base);
    let P2 = ReadCarcassNode(Wheel, Base + 1);
    let P3 = ReadCarcassNode(Wheel, Base + 2);
    let A = -P0 + 3.0 * P1 - 3.0 * P2 + P3;
    let B = 2.0 * P0 - 5.0 * P1 + 4.0 * P2 - P3;
    let C = -P0 + P2;
    let Value = 0.5 * (2.0 * P1 + C * T + B * T * T + A * T * T * T);
    let Slope = 0.5 * (C + 2.0 * B * T + 3.0 * A * T * T) * Scale;
    return vec2f(Value, Slope);
}

fn DeformTyre(Wheel: u32, Position: vec3f, Normal: vec3f) -> DeformedVertex
{
    var Deformed: DeformedVertex;
    Deformed.Position = Position;
    Deformed.Normal = Normal;
    let Shape = Carcasses[Wheel].Shape;
    let Radial = length(Position.xz);
    let Share = clamp((Radial - Shape.y) / max(Shape.x - Shape.y, 1.0e-4), 0.0, 1.0);
    if (Share <= 0.0)
    {
        return Deformed;
    }
    let Pose = Carcasses[Wheel].Pose;
    let Folds = Carcasses[Wheel].Folds;
    let φ = atan2(Position.z, Position.x);
    let Belt = SampleCarcass(Wheel, φ);
    let Arch = sin(3.14159265359 * Share);
    let FromRoad = atan2(sin(φ - Pose.x), cos(φ - Pose.x));
    let Shift = Pose.y * exp(-(FromRoad * FromRoad) / max(Pose.z * Pose.z, 1.0e-4)) * Share;
    let Bulge = Pose.w * max(Belt.x, 0.0) * Arch;
    let Fold = Folds.x * sin(Folds.y * φ + Folds.z) * Arch;
    let Reach = Radial - Belt.x * Share - Fold;
    let Side = clamp(Position.y / max(Shape.z, 1.0e-3), -1.0, 1.0);
    Deformed.Position = vec3f(cos(φ) * Reach, Position.y + Bulge * Side + Shift, sin(φ) * Reach);
    // 📐 The profile r(φ) turns its normal by atan(r′/r) away from radial; r′ = −∂w/∂φ · share.
    let Tilt = atan2(Belt.y * Share, max(Reach, 1.0e-3));
    let Cosine = cos(Tilt);
    let Sine = sin(Tilt);
    Deformed.Normal = vec3f(Normal.x * Cosine - Normal.z * Sine, Normal.y, Normal.x * Sine + Normal.z * Cosine);
    return Deformed;
}
