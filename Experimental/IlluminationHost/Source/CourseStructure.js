//============================================================================================================================================
//                                                            COURSESTRUCTURE.JS
//============================================================================================================================================
// 🧩 Project-Drive's proving ground (DriveCourse.h) — the terrain query the tyres read and the course facets the yard places.

import { CourseMaterial } from "./MaterialSpecification.js";

// 📝 Frontier::Drive::CourseConstants (metres, +X forward / +Y left / +Z up), with the drift yard's placements: the ramp
//    moves to the west run-up, the kerb to the warehouse apron, and the bumps and slalom cones are not laid
//    (YardStructure.js owns the layout; this file keeps the terrain query every solver reads in step with it).
export const CourseConstants = Object.freeze({
    PadHalfExtent:  60.0,
    RampNearX:      -42.0,
    RampRunX:       6.0,
    RampRise:       1.35,
    RampHalfWidth:  3.2,
    BumpCount:      0,
    BumpFirstX:     -7.0,
    BumpSpacingX:   -4.5,
    BumpHeight:     0.11,
    BumpHalfWidthY: 4.0,
    BumpHalfLenX:   0.55,
    BumpArc:        10,
    ConeCount:      0,
    ConeRadius:     0.22,
    ConeHeight:     0.55,
    ConeSegments:   14,
    SurroundHeight: -0.02
});

export const KerbConstants = Object.freeze({
    CentreY: 22.0,
    Height:  0.120,
    Depth:   0.300,
    NearX:   -28.0,
    FarX:    12.0
});

//------------------------------------------------------------------------------------------------------------------------
//                                                   TERRAIN QUERIES
//------------------------------------------------------------------------------------------------------------------------

export function WithinKerb(PositionX, PositionY)
{
    return PositionX >= KerbConstants.NearX && PositionX <= KerbConstants.FarX
        && PositionY >= KerbConstants.CentreY && PositionY <= KerbConstants.CentreY + KerbConstants.Depth;
}

// 📝 Verbatim CourseHeight(): kerb, ramp wedge (dropping to zero past the crest so the car launches), cosine bumps.
export function ResolveCourseHeight(PositionX, PositionY)
{
    const C = CourseConstants;
    if (WithinKerb(PositionX, PositionY))
        return KerbConstants.Height;
    if (PositionX >= C.RampNearX && PositionX <= C.RampNearX + C.RampRunX && Math.abs(PositionY) <= C.RampHalfWidth)
        return C.RampRise * (PositionX - C.RampNearX) / C.RampRunX;
    if (Math.abs(PositionY) <= C.BumpHalfWidthY)
    {
        let Height = 0.0;
        for (let Bump = 0; Bump < C.BumpCount; ++Bump)
        {
            const CentreX = C.BumpFirstX + Bump * C.BumpSpacingX;
            const Offset  = PositionX - CentreX;
            if (Math.abs(Offset) < C.BumpHalfLenX)
                Height += C.BumpHeight * 0.5 * (1.0 + Math.cos(Math.PI * Offset / C.BumpHalfLenX));
        }
        return Height;
    }
    return 0.0;
}

// 📝 Verbatim CourseNormal(): central differences over ±0.15 m.
export function ResolveCourseNormal(PositionX, PositionY)
{
    const Step = 0.15;
    const SlopeX = (ResolveCourseHeight(PositionX + Step, PositionY) - ResolveCourseHeight(PositionX - Step, PositionY)) / (2.0 * Step);
    const SlopeY = (ResolveCourseHeight(PositionX, PositionY + Step) - ResolveCourseHeight(PositionX, PositionY - Step)) / (2.0 * Step);
    const Length = Math.hypot(SlopeX, SlopeY, 1.0);
    return [-SlopeX / Length, -SlopeY / Length, 1.0 / Length];
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    FACET EMISSION
//------------------------------------------------------------------------------------------------------------------------

// 📝 Each emitter appends world- or local-space facets as { Corners: [[x,y,z]×3], Family } in the authored winding.
function EmitQuad(Facets, A, B, C, D, Family)
{
    Facets.push({ Corners: [A, B, C], Family });
    Facets.push({ Corners: [A, C, D], Family });
}

// 📝 Ramp wedge, world space: sloped surface, far vertical face, the two side walls.
// 🔴 EmitCourseTriangles() winds every ramp facet INWARD (the sloped face's cross product points down and forward).
//    The distance transfer classifies inside from back-facing hits, so the authored corners are kept and each facet's
//    winding is reversed here; the geometry is unchanged.
export function EmitRampFacets()
{
    const C = CourseConstants;
    const Near = C.RampNearX, Far = C.RampNearX + C.RampRunX, Rise = C.RampRise, Width = C.RampHalfWidth;
    const Facets = [];
    EmitQuad(Facets, [Near, -Width, 0.0], [Near, Width, 0.0], [Far, Width, Rise], [Far, -Width, Rise], CourseMaterial.Ramp);
    EmitQuad(Facets, [Far, -Width, Rise], [Far, Width, Rise], [Far, Width, 0.0], [Far, -Width, 0.0], CourseMaterial.Ramp);
    Facets.push({ Corners: [[Near, -Width, 0.0], [Far, -Width, Rise], [Far, -Width, 0.0]], Family: CourseMaterial.Ramp });
    Facets.push({ Corners: [[Near, Width, 0.0], [Far, Width, 0.0], [Far, Width, Rise]], Family: CourseMaterial.Ramp });
    for (const Facet of Facets)
        Facet.Corners = [Facet.Corners[0], Facet.Corners[2], Facet.Corners[1]];
    return Facets;
}

// 📝 One speed bump, local to its centre line (x = 0): a raised-cosine ridge across ±BumpHalfWidthY, ten arc segments.
export function EmitBumpFacets()
{
    const C = CourseConstants;
    const Facets = [];
    for (let Segment = 0; Segment < C.BumpArc; ++Segment)
    {
        const T0 = -C.BumpHalfLenX + (2.0 * C.BumpHalfLenX) * (Segment / C.BumpArc);
        const T1 = -C.BumpHalfLenX + (2.0 * C.BumpHalfLenX) * ((Segment + 1) / C.BumpArc);
        const Z0 = C.BumpHeight * 0.5 * (1.0 + Math.cos(Math.PI * T0 / C.BumpHalfLenX));
        const Z1 = C.BumpHeight * 0.5 * (1.0 + Math.cos(Math.PI * T1 / C.BumpHalfLenX));
        EmitQuad(Facets, [T0, -C.BumpHalfWidthY, Z0], [T1, -C.BumpHalfWidthY, Z1],
                 [T1, C.BumpHalfWidthY, Z1], [T0, C.BumpHalfWidthY, Z0], CourseMaterial.Bump);
    }
    return Facets;
}

// 📝 One slalom cone, local to its base centre: fourteen side facets and fourteen base facets.
export function EmitConeFacets()
{
    const C = CourseConstants;
    const Facets = [];
    for (let Segment = 0; Segment < C.ConeSegments; ++Segment)
    {
        const A0 = (2.0 * Math.PI * Segment) / C.ConeSegments;
        const A1 = (2.0 * Math.PI * (Segment + 1)) / C.ConeSegments;
        const P0 = [C.ConeRadius * Math.cos(A0), C.ConeRadius * Math.sin(A0), 0.0];
        const P1 = [C.ConeRadius * Math.cos(A1), C.ConeRadius * Math.sin(A1), 0.0];
        Facets.push({ Corners: [P0, P1, [0.0, 0.0, C.ConeHeight]], Family: CourseMaterial.Cone });
        Facets.push({ Corners: [P1, P0, [0.0, 0.0, 0.0]], Family: CourseMaterial.Cone });
    }
    return Facets;
}

// 📝 A closed axis-aligned box, local to its bottom centre, outward counter-clockwise winding.
export function EmitBoxFacets(ExtentX, ExtentY, ExtentZ, Family)
{
    const X = 0.5 * ExtentX, Y = 0.5 * ExtentY, Z = ExtentZ;
    const Facets = [];
    EmitQuad(Facets, [-X, -Y, Z], [X, -Y, Z], [X, Y, Z], [-X, Y, Z], Family);       // top    (+Z)
    EmitQuad(Facets, [-X, Y, 0.0], [X, Y, 0.0], [X, -Y, 0.0], [-X, -Y, 0.0], Family); // bottom (−Z)
    EmitQuad(Facets, [X, -Y, 0.0], [X, Y, 0.0], [X, Y, Z], [X, -Y, Z], Family);       // front  (+X)
    EmitQuad(Facets, [-X, Y, 0.0], [-X, -Y, 0.0], [-X, -Y, Z], [-X, Y, Z], Family);   // back   (−X)
    EmitQuad(Facets, [X, Y, 0.0], [-X, Y, 0.0], [-X, Y, Z], [X, Y, Z], Family);       // left   (+Y)
    EmitQuad(Facets, [-X, -Y, 0.0], [X, -Y, 0.0], [X, -Y, Z], [-X, -Y, Z], Family);   // right  (−Y)
    return Facets;
}
