//============================================================================================================================================
//                                                          SMOKETRANSPORT.SLANG
//============================================================================================================================================
// 📦 Fine scalar advection over completed coarse world velocity, exact rigid obstruction and swept tyre contact sources.

#version 450
layout(local_size_x = 4, local_size_y = 4, local_size_z = 4) in;

layout(std430, binding = 0) readonly buffer VelocityReception { vec4 VelocityOccupancy[]; };
struct Injection
{
    vec4 PositionRadius;
    vec4 VelocityDensity;
    vec4 Temperature;
};
layout(std430, binding = 1) readonly buffer SourceReception { Injection Sources[]; };
layout(binding = 2) uniform sampler3D PreviousThermo;
layout(rgba16f, binding = 3) uniform writeonly image3D CurrentThermo;
layout(std140, binding = 4) uniform Specification
{
    vec4 OriginSpan;
    vec4 Rates;                // seconds, density decay, heat decay, inverse completed tick count
    vec4 ChassisPosition;
    vec4 ChassisInverse;
    vec4 ChassisMinimum;
    vec4 ChassisMaximum;
    vec4 SourceMinimum;
    vec4 SourceMaximum;
} Parameters;
layout(std430, binding = 5) buffer CoverageReception { uvec4 MinimumCell; uvec4 MaximumCell; };

void MarkCoverage(ivec3 Cell, vec3 Thermo)
{
    if (Thermo.r < 0.0001 && Thermo.z < 0.001) return;
    atomicMin(MinimumCell.x, uint(Cell.x)); atomicMin(MinimumCell.y, uint(Cell.y)); atomicMin(MinimumCell.z, uint(Cell.z));
    atomicMax(MaximumCell.x, uint(Cell.x + 1)); atomicMax(MaximumCell.y, uint(Cell.y + 1)); atomicMax(MaximumCell.z, uint(Cell.z + 1));
}

layout(push_constant) uniform Advance
{
    vec4 PreviousOriginTime;
    uvec4 Counts;              // source end, source start, fine extent, operation (0 transport, 1 scroll only)
} Cycle;

vec4 ReadCoarse(vec3 World)
{
    vec3 Coordinate = clamp((World - Parameters.OriginSpan.xyz) / Parameters.OriginSpan.w * 32.0 - 0.5, vec3(0.0), vec3(31.0));
    ivec3 Lower = ivec3(floor(Coordinate));
    ivec3 Upper = min(Lower + 1, ivec3(31));
    vec3 Fraction = Coordinate - vec3(Lower);
    vec4 Sum = vec4(0.0);
    for (int Height = 0; Height < 2; ++Height)
        for (int Row = 0; Row < 2; ++Row)
            for (int Column = 0; Column < 2; ++Column)
            {
                ivec3 Cell = ivec3(Column == 0 ? Lower.x : Upper.x, Row == 0 ? Lower.y : Upper.y, Height == 0 ? Lower.z : Upper.z);
                vec3 Weight = mix(vec3(1.0) - Fraction, Fraction, vec3(Column, Row, Height));
                Sum += VelocityOccupancy[Cell.x + 32 * (Cell.y + 32 * Cell.z)] * Weight.x * Weight.y * Weight.z;
            }
    return Sum;
}

vec3 FineVelocity(vec3 World)
{
    vec3 Velocity = ReadCoarse(World).xyz;
    // 📝 Each component omits its own coordinate: this world-anchored analytic curl is divergence-free.
    vec3 Phase = World * 3.7 + vec3(0.43, -0.31, 0.27) * Cycle.PreviousOriginTime.w;
    Velocity += 0.24 * vec3(sin(Phase.y) - sin(Phase.z), sin(Phase.z) - sin(Phase.x), sin(Phase.x) - sin(Phase.y));
    return Velocity;
}

vec3 RotateInverse(vec3 Point)
{
    vec4 Rotation = Parameters.ChassisInverse;
    return Point + 2.0 * cross(Rotation.xyz, cross(Rotation.xyz, Point) + Rotation.w * Point);
}

void main()
{
    ivec3 Cell = ivec3(gl_GlobalInvocationID.xyz);
    int Extent = int(Cycle.Counts.z);
    if (any(greaterThanEqual(Cell, ivec3(Extent)))) return;
    float Spacing = Parameters.OriginSpan.w / float(Extent);
    vec3 World = Parameters.OriginSpan.xyz + (vec3(Cell) + 0.5) * Spacing;
    vec3 Thermo = vec3(0.0);
    if (Cycle.Counts.w == 1u)
    {
        // 📝 Integer relocation has an exact texel path; newly exposed cells are clear, never clamped edge copies.
        ivec3 Shift = ivec3(round((Parameters.OriginSpan.xyz - Cycle.PreviousOriginTime.xyz) / Spacing));
        ivec3 PreviousCell = Cell + Shift;
        if (all(greaterThanEqual(PreviousCell, ivec3(0))) && all(lessThan(PreviousCell, ivec3(Extent))))
            Thermo = texelFetch(PreviousThermo, PreviousCell, 0).rgb;
        MarkCoverage(Cell, Thermo);
        imageStore(CurrentThermo, Cell, vec4(Thermo, 0.0));
        return;
    }
    vec3 Local = RotateInverse(World - Parameters.ChassisPosition.xyz);
    bool ChassisSolid = all(greaterThanEqual(Local, Parameters.ChassisMinimum.xyz)) &&
                        all(lessThanEqual(Local, Parameters.ChassisMaximum.xyz));
    if (ReadCoarse(World).w > 0.5 || ChassisSolid)
    {
        imageStore(CurrentThermo, Cell, vec4(0.0));
        return;
    }
    {
        vec3 Midpoint = World - FineVelocity(World) * Parameters.Rates.x * 0.5;
        vec3 Departure = World - FineVelocity(Midpoint) * Parameters.Rates.x;
        vec3 Coordinate = (Departure - Cycle.PreviousOriginTime.xyz) / Parameters.OriginSpan.w;
        if (all(greaterThanEqual(Coordinate, vec3(0.0))) && all(lessThanEqual(Coordinate, vec3(1.0))))
            Thermo = texture(PreviousThermo, Coordinate).rgb;
    }
    Thermo *= exp(-vec3(Parameters.Rates.yz, 1.8) * Parameters.Rates.x);
    if (all(greaterThanEqual(World, Parameters.SourceMinimum.xyz)) && all(lessThanEqual(World, Parameters.SourceMaximum.xyz)))
        for (uint Index = Cycle.Counts.y; Index < Cycle.Counts.x; ++Index)
        {
            Injection Source = Sources[Index];
            float Radius = max(Source.PositionRadius.w, Spacing * 0.72);
            vec3 Centre = Source.PositionRadius.xyz;
            Centre.z += Spacing * 0.55; // [m] - resolve a sub-cell contact above, not underneath, the supporting plane
            vec3 Distance = (World - Centre) / Radius;
            float SquaredDistance = dot(Distance, Distance);
            if (SquaredDistance > 12.25) continue;
            float Weight = exp(-SquaredDistance * 1.7) * Parameters.Rates.x * Parameters.Rates.w;
            Thermo += vec3(Source.VelocityDensity.w, Source.Temperature.xy) * Weight;
        }
    Thermo = clamp(Thermo, vec3(0.0), vec3(64.0, 4096.0, 16.0));
    MarkCoverage(Cell, Thermo);
    imageStore(CurrentThermo, Cell, vec4(Thermo, 0.0));
}
