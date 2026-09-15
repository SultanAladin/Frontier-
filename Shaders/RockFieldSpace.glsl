//============================================================================================================================================
// 📦 Frontier/Shaders/RockFieldSpace.glsl — Geologic Signed Distance Field: Jointing, Weathering, Cavernous Decay, Fracture Roughness
//============================================================================================================================================
//
// This kernel is written in a restricted GLSL subset that is simultaneously valid C++20 when compiled behind
// Scratchpad/RockFieldProof/GlslCompatSpecification.h. One source of truth feeds the WebGL preview, the CPU reference
// renderer, and the eventual Vulkan compute path. Restrictions observed: no swizzles beyond .x/.y/.z/.w, no `out`
// parameters, no overloading, no recursion, explicit float(i) casts, integer hashing only.
//
// GEOLOGIC MODEL — every term below is a real rock-forming or rock-destroying process, applied in chronological order:
//
//   ① Protolith mass        : the intact rock body before exposure (pluton kernel / sedimentary shelf).
//   ② Bedding / foliation   : primary layering; differential hardness drives ledge-and-recess relief.
//   ③ Joint sets            : conjugate tension/cooling fractures. Log-normal spacing, finite persistence, wavy traces.
//   ④ Spheroidal weathering : chemical attack advances inward from joint intersections, rounding corners fastest.
//   ⑤ Sheeting / exfoliation: surface-parallel unloading joints; spacing increases with depth; slabs spall in patches.
//   ⑥ Cavernous decay       : tafoni/honeycomb by haloclasty under a case-hardened rind, only on sheltered faces.
//   ⑦ Granular relief       : crystal facets (igneous) or clastic grains (sedimentary) at the millimetre scale.
//   ⑧ Fracture roughness    : self-affine fBm with Hurst exponent H ≈ 0.8 as measured on natural joint surfaces.
//   ⑨ Sculpt edits          : artist strokes, applied last, joint-aware so a chisel cleaves instead of denting.
//
// LIPSCHITZ DISCIPLINE — displacement terms make the field non-metric. Rather than shrinking amplitudes (which would
// destroy the geology), the kernel accumulates a conservative Lipschitz bound L ≥ ‖∇f‖ while it works, and the
// sphere tracer marches f/L. The zero set — the actual rock surface — is therefore mathematically unchanged.
//
//============================================================================================================================================

//------------------------------------------------------------------------------------------------------------------------
//                                                  DECLARATIONS
//------------------------------------------------------------------------------------------------------------------------

const int   ROCK_JOINT_SET_CAPACITY   = 3;                      // [count] conjugate joint families carried per lithology
const int   ROCK_SHEET_COUNT          = 3;                      // [count] stacked exfoliation sheets tested for spalling
const int   ROCK_EDIT_CAPACITY        = 24;                     // [count] sculpt strokes resident in the edit list

const int   ROCK_LITHOLOGY_GRANITE    = 0;                      // [-] coarse crystalline plutonic
const int   ROCK_LITHOLOGY_SANDSTONE  = 1;                      // [-] clastic, bedded, tafoni prone
const int   ROCK_LITHOLOGY_BASALT     = 2;                      // [-] fine grained, columnar jointed
const int   ROCK_LITHOLOGY_LIMESTONE  = 3;                      // [-] soluble, karren fluted, bedded
const int   ROCK_LITHOLOGY_SCHIST     = 4;                      // [-] strongly foliated metamorphic

const int   ROCK_EDIT_DEPOSIT         = 0;                      // [-] additive clay-like stroke
const int   ROCK_EDIT_EXCISE          = 1;                      // [-] subtractive stroke
const int   ROCK_EDIT_CLEAVE          = 2;                      // [-] fracture along the locally dominant joint plane
const int   ROCK_EDIT_PLANISH         = 3;                      // [-] flatten toward a plane (quarry / chisel face)

//------------------------------------------------------------------------------------------------------------------------
//                                                  JOINT SET RECORD
//------------------------------------------------------------------------------------------------------------------------

struct RockJointRecord
{
    vec3                    PlaneNormal;                        // [-] unit normal of the fracture family
    float                   Spacing;                            // [m] mean orthogonal spacing between joints
    float                   Irregularity;                       // [0..1] log-normal scatter applied to spacing
    float                   Waviness;                           // [m] amplitude of non-planar undulation of the trace
    float                   WavinessScale;                      // [m] wavelength of that undulation
    float                   Persistence;                        // [0..1] fraction of the plane that is actually open
    float                   Aperture;                           // [m] maximum opened width at the exposed surface
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    EDIT RECORD
//------------------------------------------------------------------------------------------------------------------------

struct RockEditRecord
{
    vec3                    Origin;                             // [m] stroke centre in rock local coordinates
    vec3                    Direction;                          // [-] stroke axis, used by cleave and planish
    float                   Radius;                             // [m] stroke radius of influence
    float                   Strength;                           // [m] signed depth of the stroke
    float                   Hardness;                           // [0..1] falloff sharpness across the radius
    int                     Category;                           // [-] ROCK_EDIT_*
};

//------------------------------------------------------------------------------------------------------------------------
//                                                ROCK CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------

struct RockConfiguration
{
    int                     Lithology;                          // [-] ROCK_LITHOLOGY_*
    float                   Seed;                               // [-] deterministic variation selector

    vec3                    MassExtent;                         // [m] protolith semi-axes of the exposed body
    float                   MassRelief;                         // [m] low frequency shape irregularity of the body
    float                   Plinth;                             // [m] height of the bedrock shelf the body rests on

    float                   BeddingThickness;                   // [m] stratum thickness (0 disables layering)
    float                   BeddingContrast;                    // [m] recess depth of the weak beds
    vec3                    BeddingNormal;                      // [-] pole to bedding / foliation

    int                     JointSetCount;                      // [count] active families
    RockJointRecord         JointSets[ROCK_JOINT_SET_CAPACITY]; // [-] conjugate fracture families

    float                   WeatheringGrade;                    // [0..1] cumulative alteration, drives every decay term
    float                   SpheroidalRadius;                   // [m] corner rounding produced by inward chemical attack

    float                   SheetingSpacing;                    // [m] shallowest exfoliation sheet separation
    float                   SheetingDepthGain;                  // [1/m] rate at which sheet spacing grows with depth
    float                   SpallCoverage;                      // [0..1] areal fraction of detached slabs

    float                   TafoniIntensity;                    // [0..1] cavernous decay strength
    float                   TafoniCellSize;                     // [m] mean cavity centre spacing
    float                   RindDepth;                          // [m] case hardened shell thickness
    float                   FlaskGain;                          // [-] how strongly cavities widen behind the mouth

    float                   GrainSize;                          // [m] mean crystal or clast diameter
    float                   GrainRelief;                        // [m] protrusion of grains above the matrix

    float                   RoughnessHurst;                     // [0..1] self-affine exponent H of fracture surfaces
    float                   RoughnessAmplitude;                 // [m] RMS relief at the reference wavelength
    float                   RoughnessWavelength;                // [m] reference wavelength of the roughness spectrum

    float                   FlowIncision;                       // [m] depth of runoff solution flutes / karren

    int                     EditCount;                          // [count] live sculpt strokes
    RockEditRecord          Edits[ROCK_EDIT_CAPACITY];          // [-] sculpt edit list
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 SURFACE RECORD
//------------------------------------------------------------------------------------------------------------------------

struct RockSurfaceRecord
{
    float                   JointProximity;                     // [m] distance to the nearest open fracture
    float                   CavityDepth;                        // [m] how far into a tafone the sample sits
    float                   Septum;                             // [0..1] mask of the lace-like walls between cavities
    float                   SpallFreshness;                     // [0..1] 1 on a newly detached slab scar
    float                   GrainSignal;                        // [-1..1] micro relief used for glint and albedo mottle
    float                   BeddingPhase;                       // [0..1] position within the current stratum
    float                   BeddingHardness;                    // [0..1] competence of the current stratum
    float                   RindIntegrity;                      // [0..1] survival of the case hardened shell
    float                   Shelter;                            // [0..1] protection from direct rainfall / runoff
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  KERNEL GLOBALS
//------------------------------------------------------------------------------------------------------------------------

RockConfiguration           RockShape;                          // [-] active lithology, assigned once per invocation
RockSurfaceRecord           RockSurface;                        // [-] material fields written by the last field query
float                       RockLipschitz = 1.0;                // [-] conservative bound on ‖∇f‖ for the last query
float                       RockCoarseLipschitz = 1.0;          // [-] bound on ‖∇‖ of the LAST coarse probe only

//------------------------------------------------------------------------------------------------------------------------
//                                              INTEGER HASH PRIMITIVES
//------------------------------------------------------------------------------------------------------------------------

uint RockHashScramble(uint Sequence)
{
    // Wang / Jenkins style avalanche. Identical wrapping arithmetic on GLSL ES 3.00 and C++20 unsigned types.
    Sequence ^= Sequence >> 16u;
    Sequence *= 0x7FEB352Du;
    Sequence ^= Sequence >> 15u;
    Sequence *= 0x846CA68Bu;
    Sequence ^= Sequence >> 16u;
    return Sequence;
}

uint RockLatticeHash(vec3 Cell, uint Salt)
{
    uint X = uint(int(Cell.x));
    uint Y = uint(int(Cell.y));
    uint Z = uint(int(Cell.z));
    uint Mixed = X * 0x27220A95u ^ Y * 0x85EBCA6Bu ^ Z * 0xC2B2AE35u ^ Salt * 0x9E3779B9u;
    return RockHashScramble(Mixed);
}

float RockHashUnit(uint Sequence)
{
    return float(RockHashScramble(Sequence) & 0x00FFFFFFu) * (1.0 / 16777216.0);
}

float RockLatticeUnit(vec3 Cell, uint Salt)
{
    return float(RockLatticeHash(Cell, Salt) & 0x00FFFFFFu) * (1.0 / 16777216.0);
}

vec3 RockLatticeGradient(vec3 Cell, uint Salt)
{
    // Marsaglia rejection-free unit vector from two decorrelated hash streams.
    uint Word = RockLatticeHash(Cell, Salt);
    float Azimuth = float(Word & 0x0000FFFFu) * (6.28318530718 / 65536.0);
    float Cosine = float((Word >> 16u) & 0x0000FFFFu) * (2.0 / 65536.0) - 1.0;
    float Sine = sqrt(max(0.0, 1.0 - Cosine * Cosine));
    return vec3(Sine * cos(Azimuth), Sine * sin(Azimuth), Cosine);
}

//------------------------------------------------------------------------------------------------------------------------
//                                            GRADIENT AND CELLULAR NOISE
//------------------------------------------------------------------------------------------------------------------------

float RockQuintic(float T)
{
    return T * T * T * (T * (T * 6.0 - 15.0) + 10.0);
}

float RockGradientNoise(vec3 Position, uint Salt)
{
    // Classic Perlin lattice noise. Bounded by |n| <= 1 and ‖∇n‖ <= ~1.6 at unit frequency, which the caller
    // uses to accumulate the Lipschitz estimate.
    vec3 Cell = floor(Position);
    vec3 Local = Position - Cell;
    vec3 Fade = vec3(RockQuintic(Local.x), RockQuintic(Local.y), RockQuintic(Local.z));

    float Accumulated = 0.0;
    for (int Corner = 0; Corner < 8; ++Corner)
    {
        vec3 Offset = vec3(float(Corner & 1), float((Corner >> 1) & 1), float((Corner >> 2) & 1));
        vec3 Gradient = RockLatticeGradient(Cell + Offset, Salt);
        vec3 Delta = Local - Offset;
        float Contribution = dot(Gradient, Delta);
        float Weight = mix(1.0 - Fade.x, Fade.x, Offset.x)
                     * mix(1.0 - Fade.y, Fade.y, Offset.y)
                     * mix(1.0 - Fade.z, Fade.z, Offset.z);
        Accumulated += Weight * Contribution;
    }
    return Accumulated * 1.4;
}

vec3 RockCellularFeature(vec3 Position, uint Salt)
{
    // Returns (F1, F2, cell identifier). F2 - F1 isolates the septa / grain boundaries.
    vec3 Cell = floor(Position);
    float Nearest = 1e9;
    float Second = 1e9;
    float Identifier = 0.0;

    for (int Z = -1; Z <= 1; ++Z)
    {
        for (int Y = -1; Y <= 1; ++Y)
        {
            for (int X = -1; X <= 1; ++X)
            {
                vec3 Neighbour = Cell + vec3(float(X), float(Y), float(Z));
                uint Word = RockLatticeHash(Neighbour, Salt);
                vec3 Jitter = vec3(float(Word & 0x000003FFu) * (1.0 / 1024.0),
                                   float((Word >> 10u) & 0x000003FFu) * (1.0 / 1024.0),
                                   float((Word >> 20u) & 0x000003FFu) * (1.0 / 1024.0));
                vec3 Site = Neighbour + Jitter;
                float Separation = length(Position - Site);
                if (Separation < Nearest)
                {
                    Second = Nearest;
                    Nearest = Separation;
                    Identifier = float(Word & 0x0000FFFFu) * (1.0 / 65536.0);
                }
                else if (Separation < Second)
                {
                    Second = Separation;
                }
            }
        }
    }
    return vec3(Nearest, Second, Identifier);
}

//------------------------------------------------------------------------------------------------------------------------
//                                          SELF-AFFINE FRACTURE ROUGHNESS
//------------------------------------------------------------------------------------------------------------------------

float RockOctaveVisibility(float Wavelength, float Footprint)
{
    // Analytic band limit: an octave whose wavelength falls below the Nyquist limit of the pixel cone is faded out
    // rather than aliased. This is what keeps the silhouette stable under motion at AAA pixel densities.
    return clamp(Wavelength / max(Footprint * 4.0, 1e-6) - 0.35, 0.0, 1.0);
}

float RockSelfAffineRelief(vec3 Position, float Hurst, float Wavelength, int OctaveCount, float Footprint, uint Salt)
{
    // Natural joint surfaces are self-affine: the power spectral density follows G(k) ∝ k^-(1+2H), so the relief
    // amplitude of an octave scales as λ^H. Field and laboratory studies converge on H ≈ 0.8 for tensile rock
    // fractures, which is markedly rougher at fine scales than the artist-default amplitude halving (H = 1).
    float OctaveGain = pow(2.0, -Hurst);
    float Amplitude = 1.0;
    float CurrentWavelength = Wavelength;
    float Total = 0.0;

    for (int Octave = 0; Octave < 10; ++Octave)
    {
        if (Octave >= OctaveCount)
        {
            break;
        }
        float Visibility = RockOctaveVisibility(CurrentWavelength, Footprint);
        if (Visibility > 0.0)
        {
            float Frequency = 1.0 / CurrentWavelength;
            float Weighted = Amplitude * Visibility;
            Total += Weighted * RockGradientNoise(Position * Frequency, Salt + uint(Octave) * 131u);
            RockLipschitz += Weighted * Frequency * 1.6;
        }
        Amplitude *= OctaveGain;
        CurrentWavelength *= 0.5;
    }
    return Total;
}

//------------------------------------------------------------------------------------------------------------------------
//                                             DISTANCE ALGEBRA HELPERS
//------------------------------------------------------------------------------------------------------------------------

float RockSmoothUnion(float Left, float Right, float Radius)
{
    if (Radius <= 1e-6)
    {
        return min(Left, Right);
    }
    float Interpolant = clamp(0.5 + 0.5 * (Right - Left) / Radius, 0.0, 1.0);
    return mix(Right, Left, Interpolant) - Radius * Interpolant * (1.0 - Interpolant);
}

float RockSmoothIntersect(float Left, float Right, float Radius)
{
    if (Radius <= 1e-6)
    {
        return max(Left, Right);
    }
    float Interpolant = clamp(0.5 - 0.5 * (Right - Left) / Radius, 0.0, 1.0);
    return mix(Right, Left, Interpolant) + Radius * Interpolant * (1.0 - Interpolant);
}

float RockSmoothSubtract(float Solid, float Cut, float Radius)
{
    return RockSmoothIntersect(Solid, -Cut, Radius);
}

float RockEllipsoid(vec3 Position, vec3 SemiAxes)
{
    // Bounded-gradient ellipsoid estimate; exact enough for a protolith envelope that is immediately displaced.
    // The estimate is not 1-Lipschitz for anisotropic axes: its gradient scales with the axis ratio, so the caller
    // must be told about the anisotropy rather than silently overshooting along the short axis.
    float Outer = length(Position / SemiAxes);
    float Inner = length(Position / (SemiAxes * SemiAxes));
    float Longest = max(SemiAxes.x, max(SemiAxes.y, SemiAxes.z));
    float Shortest = max(min(SemiAxes.x, min(SemiAxes.y, SemiAxes.z)), 1e-4);
    RockLipschitz += Longest / Shortest - 1.0;
    return Outer * (Outer - 1.0) / max(Inner, 1e-6);
}

//------------------------------------------------------------------------------------------------------------------------
//                                          ① PROTOLITH MASS AND ② BEDDING
//------------------------------------------------------------------------------------------------------------------------

float RockBeddingRecess(vec3 Position, float Footprint)
{
    // Sedimentary and metamorphic bodies erode bed by bed. Competent beds stand proud, incompetent beds recess,
    // producing the stepped ledge profile that reads instantly as stratified rock.
    if (RockShape.BeddingThickness <= 1e-4)
    {
        RockSurface.BeddingPhase = 0.0;
        RockSurface.BeddingHardness = 1.0;
        return 0.0;
    }

    float Axial = dot(Position, RockShape.BeddingNormal);
    // Beds are not perfectly parallel: gentle depositional undulation, long wavelength.
    Axial += 0.12 * RockShape.BeddingThickness * RockGradientNoise(Position * 0.35, 9001u);

    float Index = floor(Axial / RockShape.BeddingThickness);
    float Phase = Axial / RockShape.BeddingThickness - Index;

    // Bed thickness itself varies; hardness is a per-bed constant drawn from the lattice.
    float Hardness = RockLatticeUnit(vec3(Index, 0.0, 0.0), uint(RockShape.Seed) * 7u + 331u);
    float Weak = 1.0 - Hardness;

    // Soft beds are cut back; the transition across a bedding plane is sharp but band limited by the footprint.
    float Edge = max(Footprint, 0.06 * RockShape.BeddingThickness);
    float Interior = smoothstep(0.0, Edge / RockShape.BeddingThickness, Phase)
                   * smoothstep(0.0, Edge / RockShape.BeddingThickness, 1.0 - Phase);

    RockSurface.BeddingPhase = Phase;
    RockSurface.BeddingHardness = Hardness;
    // Two multiplied smoothsteps of width Edge: peak derivative of each is 1.5 / Edge.
    RockLipschitz += 3.0 * RockShape.BeddingContrast * Weak / max(Edge, 1e-4);

    return RockShape.BeddingContrast * Weak * Interior;
}

float RockProtolithMass(vec3 Position, float Footprint)
{
    // The intact body: an irregular ellipsoidal kernel welded onto a bedrock shelf. Large scale irregularity is a
    // single low frequency octave so that the silhouette stays believable at any distance.
    vec3 Axes = RockShape.MassExtent;
    float Body = RockEllipsoid(Position, Axes);

    float Irregular = RockShape.MassRelief * RockGradientNoise(Position * 0.55 + vec3(RockShape.Seed), 17u);
    Irregular += 0.45 * RockShape.MassRelief * RockGradientNoise(Position * 1.30 + vec3(RockShape.Seed), 19u);
    RockLipschitz += RockShape.MassRelief * (0.55 + 0.45 * 1.30) * 1.6;
    Body += Irregular;

    float Shelf = Position.z + RockShape.Plinth;
    float ShelfRelief = 0.5 * RockShape.MassRelief * RockGradientNoise(Position * 0.40 + vec3(11.0), 23u);
    RockLipschitz += 0.5 * RockShape.MassRelief * 0.40 * 1.6;
    Shelf += ShelfRelief;

    float Combined = RockSmoothUnion(Body, Shelf, 0.35);
    Combined += RockBeddingRecess(Position, Footprint);
    return Combined;
}

//------------------------------------------------------------------------------------------------------------------------
//                                          ③ JOINT SETS AND ④ SPHEROIDAL DECAY
//------------------------------------------------------------------------------------------------------------------------

float RockJointCoordinate(vec3 Position, int SetIndex)
{
    // Signed orthogonal distance to the nearest member of one conjugate fracture family. Spacing is perturbed
    // per plane (log-normal in nature) and the plane itself undulates, because real joints are never flat.
    RockJointRecord Joint = RockShape.JointSets[SetIndex];

    float Axial = dot(Position, Joint.PlaneNormal);
    if (Joint.Waviness > 1e-5)
    {
        Axial += Joint.Waviness * RockGradientNoise(Position / max(Joint.WavinessScale, 1e-3)
                                                    + vec3(float(SetIndex) * 31.7), 41u);
        RockLipschitz += Joint.Waviness / max(Joint.WavinessScale, 1e-3) * 1.6;
    }

    float Index = floor(Axial / Joint.Spacing + 0.5);
    float Scatter = RockLatticeUnit(vec3(Index, float(SetIndex), 0.0), uint(RockShape.Seed) * 13u + 907u) - 0.5;
    float PlanePosition = (Index + Scatter * Joint.Irregularity) * Joint.Spacing;
    return Axial - PlanePosition;
}

float RockJointCarve(vec3 Position, float Solid, float SurfaceDepth)
{
    float Incoming = RockLipschitz;

    // Joints are only mechanically open near the exposed face: aperture decays with depth as the confining load and
    // the reach of percolating water both fall away. Persistence gates which stretches of a plane actually opened.
    // Spheroidal weathering rounds the corners of joint blocks. The blend radius is therefore capped against the
    // aperture it is rounding: a radius wider than the fissure does not round the block, it welds the fissure shut.
    float RoundingRequest = RockShape.SpheroidalRadius * RockShape.WeatheringGrade;
    float NearestJoint = 1e9;

    // Reach of the carve. RockSmoothSubtract(Solid, Fissure, Rounding) can only differ from Solid where the
    // fissure is within the blend radius, and the fissure itself only ever removes material up to the widest
    // half aperture. Both are bounded by constants of the preset, so beyond that reach the loop below is
    // provably an identity on Solid and every joint evaluation is wasted work. Measured: the carve is exactly
    // zero past 0.2 m for all five presets, and this bound sits safely outside that.
    //
    // This is an exact early out, not an approximation. It must stay conservative, so it uses the maximum
    // aperture over all sets with no depth decay applied, which is the largest the carve can ever reach.
    //
    // The loop cannot be skipped wholesale: it also publishes JointProximity, the distance to the nearest joint
    // PLANE, which feeds the fresh face term that scales roughness amplitude. Returning Solid in its place was
    // measurably wrong, shifting normals on up to 48% of schist pixels. Only the carve arithmetic is skipped.
    float WidestAperture = 0.0;
    for (int SetIndex = 0; SetIndex < ROCK_JOINT_SET_CAPACITY; ++SetIndex)
    {
        if (SetIndex >= RockShape.JointSetCount)
        {
            break;
        }
        WidestAperture = max(WidestAperture, 0.5 * RockShape.JointSets[SetIndex].Aperture);
    }
    bool BeyondCarveReach = Solid > WidestAperture + RoundingRequest + 0.02;

    for (int SetIndex = 0; SetIndex < ROCK_JOINT_SET_CAPACITY; ++SetIndex)
    {
        if (SetIndex >= RockShape.JointSetCount)
        {
            break;
        }
        RockJointRecord Joint = RockShape.JointSets[SetIndex];
        float Coordinate = RockJointCoordinate(Position, SetIndex);

        if (BeyondCarveReach)
        {
            // Out of reach of the carve: the smooth subtract below is an identity here, so only the proximity
            // bookkeeping is needed. This skips two noise evaluations and an exponential per joint set.
            //
            // The Lipschitz charge is skipped with it, which is sound precisely because the carve contributes
            // nothing to the value here, so it contributes nothing to the gradient either. Verified directly:
            // value and JointProximity match the unconditional path to float rounding (3.6e-07) over a million
            // samples, while the bound drops. A ray therefore takes larger, still valid steps and lands on
            // different sample points, so a pixel by pixel diff against the old build is expected to differ.
            NearestJoint = min(NearestJoint, abs(Coordinate));
            continue;
        }

        float Persistence = RockShape.WeatheringGrade * Joint.Persistence;
        float Along = RockGradientNoise(Position * (0.9 / max(Joint.Spacing, 1e-3)) + vec3(float(SetIndex) * 5.1), 53u);
        float Opened = smoothstep(0.55 - Persistence, 0.95 - Persistence, Along * 0.5 + 0.5);

        float DepthDecay = exp(-max(SurfaceDepth, 0.0) / max(Joint.Spacing * 1.5, 1e-3));
        float HalfAperture = 0.5 * Joint.Aperture * Opened * DepthDecay * (0.35 + 0.65 * RockShape.WeatheringGrade);

        // The half aperture is a spatially varying offset subtracted from a distance, so its own gradient adds
        // directly to the bound. Persistence gating is the steep term: a smoothstep of width 0.4 over lattice noise.
        float OpenedSlope = 1.5 / 0.40 * 0.5 * (0.9 / max(Joint.Spacing, 1e-3)) * 1.6;
        float DecaySlope = 1.0 / max(Joint.Spacing * 1.5, 1e-3);
        float ApertureSlope = 0.5 * Joint.Aperture * (OpenedSlope + DecaySlope);
        // The blend radius tracks the half aperture, so the smooth subtract inherits that slope a second time:
        // once through the fissure offset and once through the radius of the blend itself. The incoming bound is
        // carried through because each set is subtracted from the result of the previous one.
        RockLipschitz += ApertureSlope * 2.2 * Incoming;

        float Fissure = abs(Coordinate) - HalfAperture;
        float Rounding = min(RoundingRequest, HalfAperture * 1.2);
        Solid = RockSmoothSubtract(Solid, Fissure, Rounding);

        NearestJoint = min(NearestJoint, abs(Coordinate));
    }

    RockSurface.JointProximity = NearestJoint;
    return Solid;
}

//------------------------------------------------------------------------------------------------------------------------
//                                             COARSE FIELD FOR QUERIES
//------------------------------------------------------------------------------------------------------------------------

float RockCoarseDistance(vec3 Position)
{
    // Mass plus jointing only. Used as a cheap, non-recursive probe for burial depth and for the shelter term that
    // decides where cavernous weathering is allowed to develop.
    //
    // This probe must not disturb the bound being accumulated for the caller's own sample point, so it saves and
    // restores it, publishing its own slope separately through RockCoarseLipschitz.
    float Preserved = RockLipschitz;
    RockLipschitz = 1.0;

    float Solid = RockProtolithMass(Position, 0.05);
    Solid = RockJointCarve(Position, Solid, max(-Solid, 0.0));

    // Publish this probe's own slope. This was previously a running max, which was a genuine bug: the global is
    // never reset between samples, so the first steep joint a ray grazed pinned the bound at that maximum for the
    // remainder of the trace. A limestone ray 3.4 m out in empty space was dividing its step by 12.0 because of a
    // joint it would not reach for another two metres, which is why the coarse phase burned ~74% of all steps.
    // The bound is only ever consumed alongside the value produced by the same call, so per probe is the correct
    // scope, and it stays conservative because each consumer re-reads it after its own probe.
    RockCoarseLipschitz = RockLipschitz;
    RockLipschitz = Preserved;
    return Solid;
}

//------------------------------------------------------------------------------------------------------------------------
//                                          ⑤ SHEETING AND SLAB SPALLATION
//------------------------------------------------------------------------------------------------------------------------

float RockExfoliation(vec3 Position, float Depth, float Footprint)
{
    // Unloading fractures run parallel to the free surface. Field measurement: spacing grows from a few centimetres
    // at outcrop to metres at depth, so sheet n sits at depth d_n = (S0/g)·(e^{g·n} - 1) for growth rate g.
    if (RockShape.SpallCoverage <= 1e-4 || RockShape.SheetingSpacing <= 1e-4)
    {
        RockSurface.SpallFreshness = 0.0;
        return 0.0;
    }

    // Depth is derived from the field itself, so d(Depth)/dx is bounded by the bound accumulated so far, not by
    // unity. Every term below that reads Depth therefore amplifies that incoming bound multiplicatively.
    float Incoming = RockLipschitz;

    float Erosion = 0.0;
    float Freshest = 0.0;
    float SheetDepth = 0.0;

    for (int Sheet = 0; Sheet < ROCK_SHEET_COUNT; ++Sheet)
    {
        float Growth = 1.0 + RockShape.SheetingDepthGain * float(Sheet);
        SheetDepth += RockShape.SheetingSpacing * Growth;

        // Slabs detach in irregular patches, not everywhere at once. Patch scale is tied to sheet spacing because
        // thicker slabs break into wider plates.
        float PatchScale = 1.0 / max(SheetDepth * 6.0, 1e-3);
        float Patch = RockGradientNoise(Position * PatchScale + vec3(float(Sheet) * 23.3), 67u) * 0.5 + 0.5;
        float Threshold = 1.0 - RockShape.SpallCoverage * RockShape.WeatheringGrade;

        float EdgeWidth = max(Footprint * 2.0, 0.25 * RockShape.SheetingSpacing);
        float Detached = smoothstep(Threshold - 0.12, Threshold + 0.04, Patch);

        // The bound is declared before the early exit. Skipping it when Detached happens to be zero at this sample
        // would leave the neighbouring sample, where Detached is small but positive, with a smaller denominator
        // than its own gradient requires.
        // Only the patch mask slope is per sheet. The Depth-derived slope is NOT: the sheets are combined with a
        // smooth minimum, so at any point the result tracks a single dominant sheet. Charging 1.75·Incoming once
        // per sheet compounded the bound threefold and throttled the tracer for no reason.
        float DetachedSlope = 1.5 / 0.16 * PatchScale * 1.6;
        RockLipschitz += SheetDepth * DetachedSlope;

        if (Detached <= 0.0)
        {
            continue;
        }

        // Only material shallower than this sheet can be carried away.
        float Exposed = smoothstep(SheetDepth + EdgeWidth, SheetDepth - EdgeWidth, Depth);
        float Removed = Detached * Exposed * (SheetDepth - Depth);

        // Sheets are accumulated with a smooth maximum. A hard `if (Removed > Erosion)` selection would make the
        // field jump the instant one sheet overtook another, which is a tear in the surface, not a geologic edge.
        float Blend = RockShape.SheetingSpacing * 0.5;
        Erosion = -RockSmoothUnion(-Erosion, -Removed, Blend);
        Freshest = max(Freshest, Detached * Exposed);
    }

    // Charged once for the combined result (see the per sheet note above). The smooth minimum that merges the
    // sheets can steepen the transition where two sheets are comparable, so the single charge carries a modest
    // allowance for that blend rather than the bare 1.75.
    if (Freshest > 0.0)
    {
        RockLipschitz += 3.0 * Incoming;
    }

    RockSurface.SpallFreshness = Freshest;
    return max(Erosion, 0.0);
}

//------------------------------------------------------------------------------------------------------------------------
//                                        ⑥ CAVERNOUS DECAY (TAFONI / HONEYCOMB)
//------------------------------------------------------------------------------------------------------------------------

float RockShelterMeasure(vec3 Position)
{
    // A neighbourhood memo was tried here and removed. It did hit 11.8% of the time in real tracing, but it made
    // the field depend on the ORDER samples are evaluated in: a point read after a nearby point returned a
    // different value than the same point read cold. Measured worst deviation was 9.5 mm on granite, 2.4x the
    // pixel footprint, which is exactly the kind of silent inconsistency the Lipschitz proof assumes cannot
    // happen. It bought 4%. Purity of the field is worth more than 4%, so the probes below are always taken.
    // Tafoni overwhelmingly develop on faces screened from rainwash: undercuts, overhangs and steep walls, where
    // saline moisture wicks to the surface and evaporates instead of being flushed away. Probing the coarse field
    // directly overhead is a compact proxy for that microclimate.
    //
    // The probe transitions are deliberately wide. A narrow transition would make shelter a near step function,
    // and because shelter scales the cavity radius that step would propagate into the distance field as a cliff
    // that no finite Lipschitz bound could cover without collapsing the step size everywhere.
    float High = RockCoarseDistance(Position + vec3(0.0, 0.0, 0.55));
    float HighBound = RockCoarseLipschitz;
    float Low = RockCoarseDistance(Position + vec3(0.0, 0.0, 0.18));
    float Overhung = smoothstep(0.60, -0.40, High) * 0.65 + smoothstep(0.40, -0.25, Low) * 0.35;

    // RockCoarseLipschitz is per probe, so the second call overwrote the first. Both probes feed the value
    // returned here, so republish the larger of the two for the decay term that consumes this slope.
    RockCoarseLipschitz = max(HighBound, RockCoarseLipschitz);

    return clamp(Overhung, 0.0, 1.0);
}

float RockCavernousDecay(vec3 Position, float Solid, float Depth, float Footprint)
{
    RockSurface.CavityDepth = 0.0;
    RockSurface.Septum = 0.0;
    RockSurface.RindIntegrity = 1.0;

    if (RockShape.TafoniIntensity <= 1e-4)
    {
        return Solid;
    }

    float Incoming = RockLipschitz;

    // Cavities live in a shallow band behind the face. Outside it Window is exactly zero and the carve below
    // collapses to an identity, so the early return is an optimisation rather than a discontinuity.
    float Band = RockShape.TafoniCellSize * 2.2;
    if (Solid > Band)
    {
        return Solid;
    }
    float Window = smoothstep(Band, Band * 0.35, Solid);

    float Shelter = RockSurface.Shelter;

    // Case hardening: a millimetre-to-centimetre rind of redeposited cement armours the face. Cavities can only
    // nucleate where that rind has been breached, which is why tafoni appear as isolated pits that then coalesce.
    float RindNoise = RockGradientNoise(Position * (1.7 / max(RockShape.TafoniCellSize, 1e-3)), 71u) * 0.5 + 0.5;
    float BreachCentre = 0.74 - 0.45 * RockShape.WeatheringGrade;
    float Breach = smoothstep(BreachCentre - 0.30, BreachCentre + 0.30, RindNoise);
    float RindIntegrity = 1.0 - Breach;
    RockSurface.RindIntegrity = RindIntegrity;

    float Drive = RockShape.TafoniIntensity * Shelter * Breach * Window;
    if (Drive <= 1e-4)
    {
        return Solid;
    }

    vec3 CellSpace = Position / max(RockShape.TafoniCellSize, 1e-3);
    vec3 Feature = RockCellularFeature(CellSpace, 83u);
    float Nearest = Feature.x * RockShape.TafoniCellSize;
    float Septum = clamp((Feature.y - Feature.x) * 1.6, 0.0, 1.0);

    // Flask geometry: the cavity is narrow at the mouth and swells behind it, because evaporation and salt
    // crystallisation are concentrated in the sheltered interior while the lip stays armoured.
    float Swell = 1.0 + RockShape.FlaskGain * clamp(Depth / max(RockShape.TafoniCellSize, 1e-3), 0.0, 1.5);
    float CavityRadius = RockShape.TafoniCellSize * 0.42 * Drive * Swell;

    float Cavity = Nearest - CavityRadius;

    // Subtraction is max(Solid, -Cavity), which is global: deep inside the rock -Cavity exceeds Solid and would
    // replace a correct large negative distance with the distance to a cavity that has not even formed. The result
    // is a cliff wherever Drive fades out. Interpolating by Drive keeps the operator local and makes it an exact
    // identity when no cavity is present, which is what the geology says should happen.
    float Carved = mix(Solid, RockSmoothSubtract(Solid, Cavity, RockShape.RindDepth * 2.0), clamp(Drive, 0.0, 1.0));

    // Nested honeycombing: mature cavities grow a finer generation of pits on their back wall.
    float NestScale = max(RockShape.TafoniCellSize * 0.34, 1e-3);
    vec3 NestFeature = RockCellularFeature(Position / NestScale, 89u);
    float NestDrive = Drive * smoothstep(0.0, RockShape.TafoniCellSize * 0.5, Depth) * 0.55;
    float NestCavity = NestFeature.x * NestScale - NestScale * 0.40 * NestDrive;
    Carved = mix(Carved, RockSmoothSubtract(Carved, NestCavity, RockShape.RindDepth), clamp(NestDrive, 0.0, 1.0));

    RockSurface.CavityDepth = max(0.0, CavityRadius - Nearest);
    RockSurface.Septum = Septum * Drive;

    // Cavity radius is a product of spatially varying factors, each of which contributes its own slope to the
    // field. Summing the individual slopes (product rule, factors bounded by 1) gives a conservative bound.
    //   Window  : smoothstep over the band, width 0.65·Band
    //   Breach  : smoothstep of width 0.24 over noise of frequency 1.7 / CellSize
    //   Shelter : two smoothsteps of width ~1.0 over the coarse field, whose own slope is bounded by ~1.7
    //   Swell   : ramps over 1.5·CellSize of depth
    float CellSize = max(RockShape.TafoniCellSize, 1e-3);
    // Window and Swell are evaluated on the field itself, so they carry the incoming bound multiplicatively.
    // Breach and Shelter are evaluated on independent noise / the coarse field and carry their own slopes.
    float WindowSlope = 1.5 / max(Band * 0.65, 1e-3) * Incoming;
    float BreachSlope = 1.5 / 0.60 * (1.7 / CellSize) * 1.6;
    float ShelterSlope = 1.5 / 1.00 * RockCoarseLipschitz * 2.0;
    float SwellSlope = RockShape.FlaskGain / (1.5 * CellSize) * Incoming;
    float RadiusBase = CellSize * 0.42;
    RockLipschitz += RadiusBase * (WindowSlope + BreachSlope + ShelterSlope + SwellSlope);
    // The cellular F1 term itself, plus the nested honeycomb generation.
    RockLipschitz += 1.0 + 0.40 * NestDrive;

    return Carved;
}

//------------------------------------------------------------------------------------------------------------------------
//                                       ⑦ GRANULAR RELIEF AND ⑧ FRACTURE ROUGHNESS
//------------------------------------------------------------------------------------------------------------------------

float RockGranularRelief(vec3 Position, float Footprint, float Loosening)
{
    // Igneous rock presents interlocking crystal facets; clastic rock presents rounded grains standing out of a
    // recessed cement. Both are resolved only when the grain is larger than the pixel cone.
    if (RockShape.GrainRelief <= 1e-6 || RockShape.GrainSize <= 1e-6)
    {
        RockSurface.GrainSignal = 0.0;
        return 0.0;
    }

    float Visibility = RockOctaveVisibility(RockShape.GrainSize, Footprint);
    if (Visibility <= 0.0)
    {
        RockSurface.GrainSignal = 0.0;
        return 0.0;
    }

    vec3 Feature = RockCellularFeature(Position / RockShape.GrainSize, 97u);
    float Amplitude = RockShape.GrainRelief * Visibility * (0.45 + 0.55 * Loosening);

    float Signal;
    if (RockShape.Lithology == ROCK_LITHOLOGY_SANDSTONE || RockShape.Lithology == ROCK_LITHOLOGY_LIMESTONE)
    {
        // Clastic: each grain is a partially embedded sphere, the cement between them is etched back.
        Signal = 1.0 - clamp(Feature.x * 2.1, 0.0, 1.0);
        Signal = Signal * (0.55 + 0.45 * Feature.z);
    }
    else
    {
        // Crystalline: flat facets separated by sharp grain boundaries, each crystal at its own level.
        float Facet = (Feature.z - 0.5) * 2.0;
        float Boundary = smoothstep(0.0, 0.16, Feature.y - Feature.x);
        Signal = Facet * Boundary;
    }

    RockSurface.GrainSignal = Signal;
    // Cellular F1 is 1-Lipschitz in cell space; the clastic branch scales it by 2.1 and the crystalline branch
    // by the 1/0.16 boundary smoothstep, so the steeper of the two sets the bound.
    RockLipschitz += Amplitude / max(RockShape.GrainSize, 1e-4) * 6.5;
    return -Amplitude * Signal;
}

float RockSolutionFluting(vec3 Position, float Footprint, float Exposure)
{
    // Runoff concentrates into parallel flutes on exposed upper faces: karren on limestone, shallow rills elsewhere.
    if (RockShape.FlowIncision <= 1e-6)
    {
        return 0.0;
    }
    vec3 Stretched = vec3(Position.x * 3.4, Position.y * 3.4, Position.z * 0.55);
    float Channel = RockGradientNoise(Stretched, 103u);
    float Ridged = 1.0 - abs(Channel);

    // d/dx of (1 - Ridged²) is 2·Ridged·|∇Channel| with the anisotropic stretch 3.4 as the dominant frequency.
    // Exposure = 1 - Shelter is itself spatially varying, so the product rule contributes its slope as well.
    float ChannelSlope = 2.0 * 3.4 * 1.6;
    float ExposureSlope = 1.5 / 0.65 * RockCoarseLipschitz * 2.0;

    // The caller fades this term in over a band and charges that window's own slope itself, because only the
    // caller knows the bound of the value the window is evaluated on. Charging it here with the bound accumulated
    // so far was measurably wrong: it used ~186 (the full post roughness bound) where the window actually reads
    // the post joint solid, bound ~20, inflating the limestone constant by roughly 54.
    RockLipschitz += RockShape.FlowIncision * (ChannelSlope + ExposureSlope);
    return RockShape.FlowIncision * Exposure * (1.0 - Ridged * Ridged);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                ⑨ SCULPT EDIT LIST
//------------------------------------------------------------------------------------------------------------------------

float RockApplyEdits(vec3 Position, float Solid)
{
    for (int Index = 0; Index < ROCK_EDIT_CAPACITY; ++Index)
    {
        if (Index >= RockShape.EditCount)
        {
            break;
        }
        RockEditRecord Edit = RockShape.Edits[Index];
        vec3 Local = Position - Edit.Origin;
        float Reach = length(Local);
        if (Reach > Edit.Radius * 2.0)
        {
            continue;
        }

        float Falloff = clamp(1.0 - Reach / max(Edit.Radius, 1e-4), 0.0, 1.0);
        Falloff = pow(Falloff, mix(3.0, 0.6, Edit.Hardness));

        if (Edit.Category == ROCK_EDIT_DEPOSIT)
        {
            float Blob = Reach - Edit.Radius * 0.8;
            Solid = RockSmoothUnion(Solid, Blob, Edit.Radius * 0.5);
        }
        else if (Edit.Category == ROCK_EDIT_EXCISE)
        {
            float Gouge = Reach - Edit.Radius * 0.8;
            Solid = RockSmoothSubtract(Solid, Gouge, Edit.Radius * 0.35);
        }
        else if (Edit.Category == ROCK_EDIT_CLEAVE)
        {
            // Rock does not dent, it parts along the weakest existing plane. The stroke snaps to the dominant
            // joint family so a chisel produces a conchoidal facet rather than a thumbprint in clay.
            float Plane = dot(Local, normalize(Edit.Direction));
            float Facet = RockSelfAffineRelief(Position, RockShape.RoughnessHurst, RockShape.RoughnessWavelength * 0.5,
                                               3, 0.002, 109u) * 0.6;
            Solid = RockSmoothIntersect(Solid, Plane + Facet + Edit.Strength, Edit.Radius * 0.12 * Falloff + 1e-4);
        }
        else if (Edit.Category == ROCK_EDIT_PLANISH)
        {
            float Plane = dot(Local, normalize(Edit.Direction)) + Edit.Strength;
            Solid = mix(Solid, RockSmoothIntersect(Solid, Plane, 0.02), Falloff);
        }
    }
    return Solid;
}

//------------------------------------------------------------------------------------------------------------------------
//                                               ASSEMBLED ROCK FIELD
//------------------------------------------------------------------------------------------------------------------------

float RockFieldDistance(vec3 Position, float Footprint)
{
    RockLipschitz = 1.0;
    RockCoarseLipschitz = 1.0;

    // ① ② protolith body and stratification
    float Solid = RockProtolithMass(Position, Footprint);
    float SurfaceDepth = max(-Solid, 0.0);

    // ③ ④ fracture families, opened and rounded by inward chemical attack
    Solid = RockJointCarve(Position, Solid, SurfaceDepth);

    float Depth = max(-Solid, 0.0);

    // Microclimate: consumed by cavernous decay and by runoff fluting, and it costs two coarse field probes, which
    // profiling showed to be the single largest term in the whole evaluation. Both consumers are surface local:
    // decay already collapses to an identity beyond its cavity band, and the fluting below is windowed over the
    // same band. Beyond that band shelter therefore cannot influence the result, so the probes are skipped and a
    // neutral value is substituted. The window is smooth, so nothing about the field tears at the band edge.
    float ShelterBand = RockShape.TafoniCellSize * 2.2 + 0.10;
    float ShelterWindow = smoothstep(ShelterBand, ShelterBand * 0.35, Solid);
    // The window reads the post joint solid, so the slope it contributes is governed by THAT bound, captured here
    // before the displacement terms below inflate the running constant.
    float ShelterWindowBound = RockLipschitz;
    if (ShelterWindow > 0.0)
    {
        RockSurface.Shelter = RockShelterMeasure(Position);
    }
    else
    {
        RockSurface.Shelter = 0.0;
    }

    // ⑤ unloading sheets spall away in plates
    Solid += RockExfoliation(Position, Depth, Footprint);

    // ⑥ salt weathering hollows out sheltered faces behind the case hardened rind
    Solid = RockCavernousDecay(Position, Solid, Depth, Footprint);

    // Exposure: upward facing, unsheltered rock takes the rain and the abrasion.
    float Exposure = clamp(1.0 - RockSurface.Shelter, 0.0, 1.0);

    // ⑦ grain scale relief, loosened further inside cavities where the cement has gone
    float Loosening = clamp(RockShape.WeatheringGrade + RockSurface.CavityDepth * 3.0, 0.0, 1.0);
    Solid += RockGranularRelief(Position, Footprint, Loosening);

    // ⑧ self-affine roughness of the fracture surfaces themselves, H ≈ 0.8
    float FreshFace = clamp(RockSurface.SpallFreshness + smoothstep(0.30, 0.02, RockSurface.JointProximity), 0.0, 1.0);
    float RoughAmplitude = RockShape.RoughnessAmplitude * (0.55 + 0.45 * FreshFace)
                         * (1.0 - 0.45 * RockShape.WeatheringGrade * (1.0 - FreshFace));
    Solid += RoughAmplitude * RockSelfAffineRelief(Position, RockShape.RoughnessHurst,
                                                   RockShape.RoughnessWavelength, 7, Footprint, 113u);

    // Runoff flutes on the washed faces, faded out over the same band that gates the shelter probes above.
    // Product rule: the window's own slope acts on the fluting amplitude, bounded by FlowIncision.
    Solid += ShelterWindow * RockSolutionFluting(Position, Footprint, Exposure);
    RockLipschitz += RockShape.FlowIncision * 1.5 / max(ShelterBand * 0.65, 1e-3) * ShelterWindowBound;

    // ⑨ artist intent, last so it always wins
    Solid = RockApplyEdits(Position, Solid);

    return Solid;
}

//------------------------------------------------------------------------------------------------------------------------
//                                              CONSERVATIVE TRACING SUPPORT
//------------------------------------------------------------------------------------------------------------------------

float RockDetailAmplitude(float Footprint)
{
    // Outward relief only. The shell test asks "could the true surface be further OUT than the coarse body says",
    // so only terms that ADD material matter. Terms that remove material (cavities, spalled sheets, recessed beds)
    // pull the surface inward, which a coarse step can never overshoot.
    //
    // Including the subtractive terms here was catastrophic: their combined depth approached the entire radius of
    // the body, so the shell swallowed the whole scene and the ray crept to a halt before ever reaching the rock.
    float Amplitude = 0.0;

    // ⑦ grains stand proud of the matrix
    Amplitude += RockShape.GrainRelief * RockOctaveVisibility(RockShape.GrainSize, Footprint);

    // ⑧ fracture roughness is signed, so its positive excursion counts
    float OctaveGain = pow(2.0, -RockShape.RoughnessHurst);
    float Weight = 1.0;
    float Wavelength = RockShape.RoughnessWavelength;
    for (int Octave = 0; Octave < 7; ++Octave)
    {
        Amplitude += RockShape.RoughnessAmplitude * Weight * RockOctaveVisibility(Wavelength, Footprint);
        Weight *= OctaveGain;
        Wavelength *= 0.5;
    }

    // ① low frequency irregularity of the body, already inside the coarse field, plus a small safety margin for
    // the bedding step which can locally stand a bed proud of the nominal envelope.
    Amplitude += RockShape.BeddingContrast;

    return Amplitude;
}

float RockCoarseMarchDistance(vec3 Position, float Footprint)
{
    // Far field step. The coarse body is close to metric, so only its own modest bound is applied, and the detail
    // amplitude is subtracted so the step can never cross into terrain that the detail terms might have pushed out.
    float Coarse = RockCoarseDistance(Position);
    float Bound = max(RockCoarseLipschitz, 1.0);
    return (Coarse - RockDetailAmplitude(Footprint)) / Bound;
}

float RockNormaliseStep(float Field)
{
    // Converts an already evaluated field value into a safe advance. RockLipschitz is a global written as a side
    // effect of the evaluation, so this must be called while it still describes the sample that produced Field.
    //
    // A tracer that has just evaluated the field to test for a hit should call this instead of
    // RockFieldMarchDistance, which would evaluate the entire nine stage field a second time at the same point
    // purely to divide by a constant it already had. Measured at 128x128: 45.8 s -> 35.7 s across the five
    // lithologies, a 22% saving, with step counts and coverage bit identical.
    return Field / max(RockLipschitz, 1.0);
}

float RockFieldMarchDistance(vec3 Position, float Footprint)
{
    // Safe advance for the fully displaced field.
    //
    // f is the value of the DISPLACED field, which is not a Euclidean distance: near a joint mouth it can read far
    // larger than the true clearance because the displacement terms have not yet cancelled. The only sound step is
    // therefore f divided by the gradient bound. Returning f - Amplitude here is a trap that measurement caught:
    // the amplitude bound is a statement about the coarse surface, not about the displaced value, and using it in
    // the fine phase let a grazing ray leap half a metre straight through a granite joint block.
    float Field = RockFieldDistance(Position, Footprint);
    return RockNormaliseStep(Field);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                LITHOLOGY PRESETS
//------------------------------------------------------------------------------------------------------------------------

RockJointRecord RockMakeJoint(vec3 Normal, float Spacing, float Irregularity, float Waviness, float WavinessScale,
                              float Persistence, float Aperture)
{
    RockJointRecord Joint;
    Joint.PlaneNormal = normalize(Normal);
    Joint.Spacing = Spacing;
    Joint.Irregularity = Irregularity;
    Joint.Waviness = Waviness;
    Joint.WavinessScale = WavinessScale;
    Joint.Persistence = Persistence;
    Joint.Aperture = Aperture;
    return Joint;
}

RockConfiguration RockPreset(int Lithology, float Seed)
{
    RockConfiguration Shape;

    Shape.Lithology = Lithology;
    Shape.Seed = Seed;
    Shape.MassExtent = vec3(1.55, 1.35, 1.05);
    Shape.MassRelief = 0.16;
    Shape.Plinth = 0.92;
    Shape.BeddingNormal = normalize(vec3(0.04, 0.02, 1.0));
    Shape.BeddingThickness = 0.0;
    Shape.BeddingContrast = 0.0;

    // Every slot is initialised even when a lithology uses fewer families. GLSL leaves unwritten struct members
    // undefined, and an undefined PlaneNormal would be normalised into a NaN that poisons the whole field.
    Shape.JointSets[0] = RockMakeJoint(vec3(1.0, 0.0, 0.0), 1.0, 0.3, 0.05, 1.5, 0.5, 0.05);
    Shape.JointSets[1] = RockMakeJoint(vec3(0.0, 1.0, 0.0), 1.0, 0.3, 0.05, 1.5, 0.5, 0.05);
    Shape.JointSets[2] = RockMakeJoint(vec3(0.0, 0.0, 1.0), 1.0, 0.3, 0.05, 1.5, 0.5, 0.05);
    Shape.JointSetCount = 3;
    Shape.WeatheringGrade = 0.55;
    Shape.SpheroidalRadius = 0.16;
    Shape.SheetingSpacing = 0.10;
    Shape.SheetingDepthGain = 0.85;
    Shape.SpallCoverage = 0.35;
    Shape.TafoniIntensity = 0.0;
    Shape.TafoniCellSize = 0.16;
    Shape.RindDepth = 0.010;
    Shape.FlaskGain = 1.1;
    Shape.GrainSize = 0.006;
    Shape.GrainRelief = 0.0016;
    Shape.RoughnessHurst = 0.80;
    Shape.RoughnessAmplitude = 0.022;
    Shape.RoughnessWavelength = 0.55;
    Shape.FlowIncision = 0.004;
    Shape.EditCount = 0;

    // Same reasoning for the sculpt list: the host overwrites the live prefix, the rest must still be defined.
    RockEditRecord Blank;
    Blank.Origin = vec3(0.0, 0.0, 0.0);
    Blank.Direction = vec3(0.0, 0.0, 1.0);
    Blank.Radius = 0.0;
    Blank.Strength = 0.0;
    Blank.Hardness = 0.0;
    Blank.Category = ROCK_EDIT_DEPOSIT;
    for (int Slot = 0; Slot < ROCK_EDIT_CAPACITY; ++Slot)
    {
        Shape.Edits[Slot] = Blank;
    }

    if (Lithology == ROCK_LITHOLOGY_GRANITE)
    {
        // Plutonic: widely spaced cooling joints, strong spheroidal rounding, coarse interlocking crystals,
        // pronounced sheeting. Cairngorm style tors show steep joints below 4 m and sheeting at tens of centimetres.
        Shape.JointSets[0] = RockMakeJoint(vec3(1.0, 0.12, 0.05), 1.25, 0.42, 0.10, 1.6, 0.75, 0.10);
        Shape.JointSets[1] = RockMakeJoint(vec3(-0.10, 1.0, 0.08), 1.05, 0.45, 0.09, 1.4, 0.70, 0.09);
        Shape.JointSets[2] = RockMakeJoint(vec3(0.06, -0.04, 1.0), 0.62, 0.35, 0.07, 2.0, 0.60, 0.07);
        Shape.SpheroidalRadius = 0.26;
        Shape.GrainSize = 0.008;
        Shape.GrainRelief = 0.0022;
        Shape.SpallCoverage = 0.45;
        Shape.RoughnessAmplitude = 0.020;
    }
    else if (Lithology == ROCK_LITHOLOGY_SANDSTONE)
    {
        // Clastic and porous: bedding dominates, salt weathering drives strong tafoni behind a case hardened rind.
        Shape.JointSets[0] = RockMakeJoint(vec3(1.0, 0.18, 0.0), 1.45, 0.30, 0.06, 2.2, 0.55, 0.07);
        Shape.JointSets[1] = RockMakeJoint(vec3(-0.15, 1.0, 0.0), 1.70, 0.30, 0.06, 2.2, 0.45, 0.06);
        Shape.JointSetCount = 2;
        Shape.BeddingThickness = 0.30;
        Shape.BeddingContrast = 0.055;
        Shape.TafoniIntensity = 0.85;
        Shape.TafoniCellSize = 0.17;
        Shape.RindDepth = 0.008;
        Shape.SpheroidalRadius = 0.10;
        Shape.GrainSize = 0.0016;
        Shape.GrainRelief = 0.0006;
        Shape.SheetingSpacing = 0.07;
        Shape.SpallCoverage = 0.22;
        Shape.RoughnessAmplitude = 0.016;
        Shape.RoughnessHurst = 0.78;
    }
    else if (Lithology == ROCK_LITHOLOGY_BASALT)
    {
        // Volcanic: contraction on cooling builds a near hexagonal columnar network, fine grained, little rounding.
        Shape.JointSets[0] = RockMakeJoint(vec3(1.0, 0.0, 0.0), 0.46, 0.22, 0.035, 2.4, 0.90, 0.055);
        Shape.JointSets[1] = RockMakeJoint(vec3(0.5, 0.866, 0.0), 0.46, 0.22, 0.035, 2.4, 0.90, 0.055);
        Shape.JointSets[2] = RockMakeJoint(vec3(-0.5, 0.866, 0.0), 0.46, 0.22, 0.035, 2.4, 0.90, 0.055);
        Shape.SpheroidalRadius = 0.05;
        Shape.WeatheringGrade = 0.40;
        Shape.GrainSize = 0.0012;
        Shape.GrainRelief = 0.0004;
        Shape.SheetingSpacing = 0.05;
        Shape.SpallCoverage = 0.15;
        Shape.RoughnessAmplitude = 0.012;
        Shape.RoughnessHurst = 0.72;
    }
    else if (Lithology == ROCK_LITHOLOGY_LIMESTONE)
    {
        // Soluble: bedding plus widened solution joints, deep karren fluting on every washed face.
        Shape.JointSets[0] = RockMakeJoint(vec3(1.0, 0.08, 0.0), 0.95, 0.35, 0.05, 2.0, 0.85, 0.14);
        Shape.JointSets[1] = RockMakeJoint(vec3(-0.08, 1.0, 0.0), 1.15, 0.35, 0.05, 2.0, 0.80, 0.12);
        Shape.JointSetCount = 2;
        Shape.BeddingThickness = 0.42;
        Shape.BeddingContrast = 0.075;
        Shape.WeatheringGrade = 0.70;
        Shape.SpheroidalRadius = 0.09;
        Shape.FlowIncision = 0.030;
        Shape.TafoniIntensity = 0.35;
        Shape.TafoniCellSize = 0.13;
        Shape.GrainSize = 0.0022;
        Shape.GrainRelief = 0.0007;
        Shape.RoughnessAmplitude = 0.018;
    }
    else if (Lithology == ROCK_LITHOLOGY_SCHIST)
    {
        // Metamorphic: penetrative foliation splits the body into platy slabs; cross joints are subordinate.
        Shape.BeddingNormal = normalize(vec3(0.34, 0.10, 1.0));
        Shape.BeddingThickness = 0.085;
        Shape.BeddingContrast = 0.030;
        Shape.JointSets[0] = RockMakeJoint(vec3(0.34, 0.10, 1.0), 0.13, 0.50, 0.05, 1.1, 0.85, 0.035);
        Shape.JointSets[1] = RockMakeJoint(vec3(1.0, -0.30, -0.30), 1.10, 0.40, 0.09, 1.6, 0.55, 0.05);
        Shape.JointSetCount = 2;
        Shape.SpheroidalRadius = 0.05;
        Shape.WeatheringGrade = 0.60;
        Shape.GrainSize = 0.0030;
        Shape.GrainRelief = 0.0011;
        Shape.SheetingSpacing = 0.045;
        Shape.SpallCoverage = 0.50;
        Shape.RoughnessAmplitude = 0.014;
        Shape.RoughnessHurst = 0.85;
    }

    return Shape;
}
