//============================================================================================================================================
//                                                          TYRECARCASSSOLVER.JS
//============================================================================================================================================
// 🧩 Soft tyres: a flexible-ring carcass per wheel — inflation tension, sidewall support, belt bending — against the road, for the vertex stage.

// 📝 XPBD gives a convincing tyre at a cost no frame can carry, and a deformation authored in the material shader is
//    cheap but knows nothing: no pressure, no flat, no wave. Between the two sits the model tyre engineers reduce a
//    carcass to — the flexible ring on an elastic foundation (Gong; Pacejka, Tyre and Vehicle Dynamics, ch. 9; the
//    belt FTire and CDTire discretise). Per wheel, 96 nodes of belt in the wheel's own frame, each with a radial
//    deflection w, governed by
//
//        ρA·ẅ = T(p)·∂²w/∂s² − EI·∂⁴w/∂s⁴ − k(p)·w − c·ẇ ,   s = R·φ
//
//    | Term     | What it is                                    | Pressure                                   |
//    |----------|-----------------------------------------------|--------------------------------------------|
//    | T(p)     | hoop tension of the belt                      | inflation: T = p·R·w, plus the cords'       |
//    | k(p)     | radial support per metre of belt              | the air column plus the sidewalls' own     |
//    | EI       | bending of the steel belt                     | none                                       |
//
//    The road is a one-sided constraint: a node cannot sit below the ground under the hub, so the belt flattens into a
//    contact patch, and tension and bending carry the deflection out beyond it the way a real tread rolls in and out
//    of the patch. The nodes ride with the rubber (the wheel's frame spins), so nothing is advected: the patch walks
//    round the belt as the wheel turns, and at speed — when the tread outruns the belt's wave speed √(T/ρA) — a
//    standing wave trails the patch: about 210 km/h inflated, about 55 km/h flat.
//
//    The dynamics (VehicleSolver.js) carry the same tyre as a spring in series with each strut, K = K₀ + κ·p; this
//    ring is what the eye sees of it. Ported from the GI-Updated-Html-Version branch's TyreCarcassSolver, with two
//    additions: a shredded tyre (the rubber gone, the wheel on its rim) and a visual exaggeration of the deflection
//    for inspection — the dynamics never see the exaggeration.

export const CarcassNodes       = 96;                          // [-]
export const CarcassRecordBytes = 3 * 16 + CarcassNodes * 4;   // [B]  three vec4 of header, then the 96 deflections
export const VehicleHeaderBytes = 8 * 16;                      // [B]  Cabin, Column, Axis, CabinFrame, CabinShift, ScanState, PaintRipple, WheelRipple
export const VehicleRecordBytes = VehicleHeaderBytes + 4 * CarcassRecordBytes;

export const CarcassSpecification = Object.freeze({
    BeltMassPerLength:   8.0,       // [kg/m]  belt and tread per metre of circumference — heavier than real for a stable step
    TensionPerPascal:    0.12,      // [N/Pa]  p·R·w with R 0.5 m and an effective width of 0.24 m
    ResidualTension:     1800.0,    // [N]     the cords and rubber, no air
    FoundationPerPascal: 7.5,       // [N/m²/Pa] radial support of the air column per metre of belt
    SidewallFoundation:  2.6e5,     // [N/m²]  the sidewalls' own radial support
    BendingStiffness:    4.0,       // [N·m²]  the steel belt
    DampingRatio:        0.55,      // [-]     of the foundation mode
    StepSeconds:         1 / 3600,  // [s]     the highest ring mode at 300 kPa is ~4900 rad/s, the step's limit 7200
    MaximumSteps:        150,       // [-]     per advance
    PinchClearance:      0.022,     // [m]     rubber left between rim flange and road when the tyre is pinched
    LateralStiffness:    6.0e4,     // [N/m]   sidewall lateral stiffness, no air
    LateralPerPascal:    0.6,       // [N/m/Pa]
    LateralCeiling:      0.045,     // [m]
    LateralSpread:       0.65,      // [rad]   half-width of the belt's lateral shift round the patch
    ReferencePressure:   220000.0   // [Pa]
});

export class TyreCarcassSolver
{
    constructor(Radius, RimRadius, HalfWidth)
    {
        this.Radius    = Radius;
        this.RimRadius = RimRadius;
        this.HalfWidth = HalfWidth;
        this.Wheels = [0, 1, 2, 3].map((Index) => ({
            Deflection: new Float64Array(CarcassNodes), Velocity: new Float64Array(CarcassNodes), Floor: new Float64Array(CarcassNodes),
            DownAngle: -Math.PI / 2, HubDistance: 0.0, LateralShift: 0.0, Bulge: 0.0, PressureRatio: 1.0, Shredded: false,
            Pinched: false, PatchNodes: 0, Peak: 0.0, WavePeak: 0.0
        }));
        this.Accumulator = 0.0;
        this.Steps = 0;
        this.Bytes = new ArrayBuffer(VehicleRecordBytes);
    }

    // 📝 Contacts: per wheel { InContact, HubDistance [m], DownAngle [rad, wheel frame], Pressure [Pa gauge],
    //    LateralForce [N], Shredded }. Advances the four rings by fixed steps over Seconds.
    Advance(Contacts, Seconds)
    {
        this.Steps = 0;
        Contacts.forEach((Contact, Index) => this.AdvanceWheel(this.Wheels[Index], Contact));
    }

    AdvanceWheel(Wheel, Contact)
    {
        const Specification = CarcassSpecification;
        const Pressure = Math.max(0.0, Contact.Pressure);
        const Pinch = this.Radius - this.RimRadius - Specification.PinchClearance;
        Wheel.DownAngle = Contact.DownAngle;
        Wheel.HubDistance = Contact.InContact && Number.isFinite(Contact.HubDistance) ? Contact.HubDistance : 0.0;
        Wheel.Shredded = !!Contact.Shredded;
        Wheel.Deflection.fill(0.0);
        Wheel.Velocity.fill(0.0);
        Wheel.LateralShift = 0.0;
        Wheel.Bulge = 0.0;
        Wheel.PatchNodes = 0;
        Wheel.WavePeak = 0.0;
        if (Wheel.Shredded)
        {
            Wheel.Pinched = false;
            Wheel.Peak = 0.0;
            Wheel.PressureRatio = 0.0;
            return;
        }
        const Deflection = Contact.InContact ? Math.max(0.0, this.Radius - Wheel.HubDistance) : 0.0;
        Wheel.Pinched = Deflection > Pinch;
        Wheel.Peak = Math.min(Deflection, Pinch);
        Wheel.PressureRatio = Math.min(1.5, Pressure / Specification.ReferencePressure);
    }

    // 📝 The VehicleRecord TyreCarcass.wgsl reads: the cabin header (Header: { SteeringAngle, SeeThroughGlass,
    //    Exaggeration, Lamp, Column [xyz], Axis [xyz], Cockpit { Anchor, Scale, Offset } }) then four wheel records.
    //    Vertex tyre deformation is disabled so intact tyres render round with their authored smooth normals.
    EncodeRecord(Header)
    {
        const Scalars = new Float32Array(this.Bytes);
        const Cockpit = Header.Cockpit || { Anchor: [0.0, 0.0, 0.0], Scale: 1.0, Offset: [0.0, 0.0, 0.0] };
        Scalars.set([Header.SteeringAngle || 0.0, Header.SeeThroughGlass ? 1.0 : 0.0, 1.0, Header.Lamp ?? 0.0], 0);
        Scalars.set([...(Header.Column || [0.0, 0.0, 0.0]), 0.0], 4);
        Scalars.set([...(Header.Axis || [1.0, 0.0, 0.0]), 0.0], 8);
        Scalars.set([...Cockpit.Anchor, Cockpit.Scale], 12);
        Scalars.set([...Cockpit.Offset, 0.0], 16);
        Scalars.set(Header.ScanState || [3.25, 0.0, 0.0, 0.0], 20);
        Scalars.set(Header.PaintRipple || [2.45, 0.0, 0.25, 0.0], 24);
        Scalars.set(Header.WheelRipple || [1.73, 1.05, -0.15, 0.0], 28);
        this.Wheels.forEach((Wheel, Index) =>
        {
            const Offset = (VehicleHeaderBytes + Index * CarcassRecordBytes) / 4;
            Scalars.set([this.Radius, this.RimRadius, this.HalfWidth, Wheel.Shredded ? 1.0 : 0.0], Offset);
            Scalars.set([Wheel.DownAngle, 0.0, CarcassSpecification.LateralSpread, 0.0], Offset + 4);
            Scalars.set([0.0, 0.0, 0.0, Wheel.PressureRatio], Offset + 8);
            for (let Node = 0; Node < CarcassNodes; ++Node)
                Scalars[Offset + 12 + Node] = 0.0;
        });
        return this.Bytes;
    }

    // 📝 Readings for the inspector and the HMI: patch length [m], peak deflection [m], standing-wave amplitude [m].
    QueryReadings()
    {
        const Arc = this.Radius * 2.0 * Math.PI / CarcassNodes;
        return this.Wheels.map((Wheel) => ({ Patch: Wheel.PatchNodes * Arc, Peak: Wheel.Peak, Wave: Wheel.WavePeak, Pinched: Wheel.Pinched,
                                             Shredded: Wheel.Shredded, Ratio: Wheel.PressureRatio }));
    }

    Reset()
    {
        for (const Wheel of this.Wheels)
        {
            Wheel.Deflection.fill(0.0);
            Wheel.Velocity.fill(0.0);
        }
    }
}
