//============================================================================================================================================
//                                                          TYRECARCASSSOLVER.JS
//============================================================================================================================================
// 🧩 Soft tyres: a flexible-ring carcass per wheel — inflation tension, sidewall support, belt bending — against the road, for the vertex shader.

// 📝 XPBD gave a convincing tyre at a cost no frame could carry, and a deformation authored in the material shader is
//    cheap but knows nothing: no pressure, no flat, no wave. Between the two sits the model tyre engineers reduce a
//    carcass to — the flexible ring on an elastic foundation (Gong; Pacejka, Tyre and Vehicle Dynamics, ch. 9; the
//    belt that FTire and CDTire discretise). Per wheel, 96 nodes of belt in the wheel's own frame, each with a radial
//    deflection, governed by
//
//        ρA·ẅ = T(p)·∂²w/∂s² − EI·∂⁴w/∂s⁴ − k(p)·w − c·ẇ ,   s = R·φ
//
//    | Term     | What it is                                    | Pressure                                  |
//    |----------|-----------------------------------------------|-------------------------------------------|
//    | T(p)     | hoop tension of the belt                      | inflation: T = p·R·w, plus the rubber's    |
//    | k(p)     | radial support per metre of belt              | the air column plus the sidewalls' own    |
//    | EI       | bending of the steel belt                     | none                                      |
//
//    The road is a one-sided constraint: a node cannot sit below the ground under the hub, so the belt flattens into
//    a contact patch, and the tension and bending carry the deflection out beyond it the way a real tread rolls in
//    and out of the patch. The nodes ride with the rubber (the wheel's frame spins), so nothing has to be advected:
//    the patch walks round the belt as the wheel turns, and at speed — when the tread outruns the belt's wave speed
//    √(T/ρA) — a standing wave trails the patch: about 210 km/h for an inflated tyre, about 55 km/h for a flat.
//
//    What the shader reads, per wheel: the 96 deflections, the angle the road is at in the wheel's frame, the belt's
//    lateral shift under cornering, the sidewall bulge per metre of deflection and, for a tyre nearly out of air, the
//    amplitude of the folds a flat tyre's sidewalls throw. A bead stays on the rim: only vertices beyond the rim radius
//    move, by the share of the sidewall height they sit at.

export const CarcassNodes       = 96;                          // [-]
export const CarcassRecordBytes = 3 * 16 + CarcassNodes * 4;   // [B]  three vec4 of header, then the 96 deflections

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
            Deflection: new Float64Array(CarcassNodes), Velocity: new Float64Array(CarcassNodes),
            DownAngle: -Math.PI / 2, LateralShift: 0.0, Bulge: 0.0, Wrinkle: 0.0, PressureRatio: 1.0,
            Pinched: false, PatchNodes: 0, Peak: 0.0, WavePeak: 0.0, Phase: 1.7 * Index + 0.4
        }));
        this.Accumulator = 0.0;
        this.Bytes = new ArrayBuffer(4 * CarcassRecordBytes);
    }

    // 📝 Contacts: per wheel { InContact, HubDistance [m], DownAngle [rad, wheel frame], Pressure [Pa gauge],
    //    LateralForce [N], Shredded }. Advances the four rings by fixed steps over Seconds.
    Advance(Contacts, Seconds)
    {
        const Specification = CarcassSpecification;
        this.Accumulator = Math.min(this.Accumulator + Math.max(0.0, Seconds), Specification.StepSeconds * Specification.MaximumSteps);
        const Steps = Math.floor(this.Accumulator / Specification.StepSeconds);
        this.Accumulator -= Steps * Specification.StepSeconds;
        Contacts.forEach((Contact, Index) => this.AdvanceWheel(this.Wheels[Index], Contact, Steps));
    }

    AdvanceWheel(Wheel, Contact, Steps)
    {
        const Specification = CarcassSpecification;
        const Pressure = Math.max(0.0, Contact.Pressure);
        const Tension = Specification.ResidualTension + Specification.TensionPerPascal * Pressure;
        const Foundation = Specification.SidewallFoundation + Specification.FoundationPerPascal * Pressure;
        const Mass = Specification.BeltMassPerLength;
        const Damping = 2.0 * Specification.DampingRatio * Math.sqrt(Foundation * Mass);
        const Arc = this.Radius * 2.0 * Math.PI / CarcassNodes;
        const TensionTerm = Tension / (Arc * Arc), BendingTerm = Specification.BendingStiffness / (Arc * Arc * Arc * Arc);
        const Step = Specification.StepSeconds;
        const Pinch = this.Radius - this.RimRadius - Specification.PinchClearance;
        const W = Wheel.Deflection, V = Wheel.Velocity;
        const Count = CarcassNodes;
        Wheel.DownAngle = Contact.DownAngle;
        Wheel.Pinched = false;
        const Floor = new Float64Array(Count);
        // ① the road under the hub as a floor for each node: r·cos θ ≤ d, so w ≥ R − d / cos θ near the patch
        for (let Node = 0; Node < Count; ++Node)
        {
            Floor[Node] = -Infinity;
            if (!Contact.InContact || Contact.Shredded)
                continue;
            let θ = (2.0 * Math.PI * Node) / Count - Contact.DownAngle;
            θ = Math.atan2(Math.sin(θ), Math.cos(θ));
            if (Math.abs(θ) < 1.2)
                Floor[Node] = this.Radius - Contact.HubDistance / Math.cos(θ);
        }
        // ② semi-implicit steps of the ring, the floor and the pinch projected after each
        for (let Iteration = 0; Iteration < Steps; ++Iteration)
        {
            for (let Node = 0; Node < Count; ++Node)
            {
                const P2 = W[(Node + Count - 2) % Count], P1 = W[(Node + Count - 1) % Count], C = W[Node];
                const N1 = W[(Node + 1) % Count], N2 = W[(Node + 2) % Count];
                const Force = TensionTerm * (N1 - 2.0 * C + P1) - BendingTerm * (N2 - 4.0 * N1 + 6.0 * C - 4.0 * P1 + P2)
                            - Foundation * C - Damping * V[Node];
                V[Node] += Force / Mass * Step;
            }
            for (let Node = 0; Node < Count; ++Node)
            {
                W[Node] += V[Node] * Step;
                if (W[Node] < Floor[Node])
                {
                    W[Node] = Floor[Node];
                    if (V[Node] < 0.0)
                        V[Node] = 0.0;
                }
                if (W[Node] > Pinch)
                {
                    W[Node] = Pinch;
                    if (V[Node] > 0.0)
                        V[Node] = 0.0;
                    if (Floor[Node] > Pinch)
                        Wheel.Pinched = true;
                }
            }
        }
        // ③ what the shader reads besides the ring: lateral shift, bulge, folds
        const Ratio = Math.min(1.5, Pressure / Specification.ReferencePressure);
        const Lateral = Specification.LateralStiffness + Specification.LateralPerPascal * Pressure;
        const Shift = Contact.InContact ? Math.max(-Specification.LateralCeiling, Math.min(Specification.LateralCeiling, (Contact.LateralForce || 0.0) / Lateral)) : 0.0;
        Wheel.LateralShift += (Shift - Wheel.LateralShift) * 0.35;
        Wheel.PressureRatio = Ratio;
        Wheel.Bulge = 0.55 + 0.95 * Math.max(0.0, 1.0 - Ratio);
        const Empty = Math.max(0.0, Math.min(1.0, 1.0 - Ratio / 0.3));
        Wheel.Wrinkle = 0.016 * Empty * Empty;
        let Peak = 0.0, Patch = 0, Wave = 0.0;
        for (let Node = 0; Node < Count; ++Node)
        {
            Peak = Math.max(Peak, W[Node]);
            if (W[Node] <= Floor[Node] + 1.0e-5)
                ++Patch;
            Wave = Math.max(Wave, Math.abs(W[Node]) * (Floor[Node] === -Infinity ? 1.0 : 0.0));
        }
        Wheel.Peak = Peak;
        Wheel.PatchNodes = Patch;
        Wheel.WavePeak = Wave;
    }

    // 📝 Four TyreCarcass records (TyreCarcass in SurfaceRaster.wgsl / ShadowRaster.wgsl): shape, pose, folds, 96 deflections.
    EncodeRecords()
    {
        const Scalars = new Float32Array(this.Bytes);
        this.Wheels.forEach((Wheel, Index) =>
        {
            const Offset = Index * (CarcassRecordBytes / 4);
            Scalars.set([this.Radius, this.RimRadius, this.HalfWidth, CarcassNodes], Offset);
            Scalars.set([Wheel.DownAngle, Wheel.LateralShift, CarcassSpecification.LateralSpread, Wheel.Bulge], Offset + 4);
            Scalars.set([Wheel.Wrinkle, 9.0, Wheel.Phase, Wheel.PressureRatio], Offset + 8);
            for (let Node = 0; Node < CarcassNodes; ++Node)
                Scalars[Offset + 12 + Node] = Wheel.Deflection[Node];
        });
        return this.Bytes;
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
