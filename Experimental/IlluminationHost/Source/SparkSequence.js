//============================================================================================================================================
//                                                             SPARKSEQUENCE.JS
//============================================================================================================================================
// 🧩 Sparks: hot metal ground off where a rim or the body slides on the road or a wall — thrown, cooling, bouncing, drawn as streaks.

// 📝 The vehicle solver reports each frame's scrapes (VehicleSolver.RecordScrape): the strongest per contact — a hull
//    patch dragged along the asphalt, a rim pinched through a flat or bare once the rubber has gone — with the contact
//    point, the sliding velocity of the metal over the surface, the surface normal and a strength. Each scrape throws
//    sparks in proportion, at 1500–2100 K:
//
//    | Source | Where a spark leaves                          | With what velocity                                    |
//    |--------|-----------------------------------------------|-------------------------------------------------------|
//    | hull   | the scraping point                            | 30–75 % of the slide, fanned, kicked off the surface  |
//    | rim    | the rim's edge a little (α ≤ 0.47 rad) behind | that point's own: Slip + S(1 − cos α)·F + |S| sin α·N |
//    |        | the patch, where the metal leaves the road    | (S = Spin·r) — up off the trailing edge, so the trail |
//    |        |                                               | streams back from a rolling wheel                     |
//
//    In flight a spark falls, feels air drag, cools radiatively (its glow follows the blackbody temperature) and skips
//    off the road, losing most of its speed, until it is too cool to see.
//
//    A few hundred particles: they are integrated here on the CPU and drawn after the temporal antialiasing as thin
//    additive streaks (2.2 mm across, at least a pixel) from where the camera saw them a frame ago to where it sees
//    them now (SparkRaster.wgsl), depth-tested against the scene — thin, bright and fast-moving, they would otherwise
//    be averaged away by the history.

import { ResolveCourseHeight, ResolveCourseNormal } from "./CourseStructure.js";

const SparkCapacity     = 2048;
const InstanceFloats    = 12;            // head xyz + width, tail xyz + hotness, radiance rgb + flare
const Gravity           = 9.81;          // [m/s²]
const AirDrag           = 1.65;          // [1/s]
const AmbientKelvin     = 293.0;         // [K]
const RadiativeCooling  = 720.0;         // [K/s] at 2000 K (Stefan-Boltzmann T⁴ cooling)
const ConvectiveCooling = 1.35;          // [1/s] newtonian air cooling
const VisibleKelvin     = 1020.0;        // [K]  below this a spark is a dark cinder
const SparksPerStrength = 700.0;         // [1/s] per unit scrape strength
const SparkWidth        = 0.0022;        // [m]  streak width at Size 1 — a glowing chip a fraction of a millimetre across, blurred

export const SparkSettingsDefaults = Object.freeze({ Enabled: true, Rate: 1.0, Brightness: 1.0, Size: 1.0 });

export class SparkSequence
{
    constructor(Exchange, Shaders)
    {
        this.Exchange = Exchange;
        this.Shaders  = Shaders;
        this.Settings = { ...SparkSettingsDefaults };
        this.Particles = [];
        this.Instances = new Float32Array(SparkCapacity * InstanceFloats);
        this.InstanceRecords = Exchange.ConstructRecords(SparkCapacity * InstanceFloats * 4, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, "Spark instances");
        this.Metrics = { Live: 0, Emitted: 0, Scrapes: 0, Bounces: 0 };
        this.SparkLight = { Position: [0.0, 0.0, 0.0], Intensity: 0.0, Colour: [1.0, 0.76, 0.48], Reach: 9.0 };
        this.Seed = 0x5EED;
        this.Live = 0;
    }

    async ConstructPrograms(FrameRecords)
    {
        this.Layout = this.Exchange.ConstructDescriptorLayout(["Uniform"], GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, "Spark raster");
        this.Group = this.Exchange.ConstructDescriptorGroup(this.Layout, [FrameRecords]);
        this.Program = await this.Shaders.ConstructRasterProgram("SparkRaster.wgsl", {
            VertexEntry: "SparkVertex", FragmentEntry: "SparkFragment",
            VertexLayouts: [{ arrayStride: InstanceFloats * 4, stepMode: "instance", attributes: [
                { shaderLocation: 0, offset: 0,  format: "float32x4" },
                { shaderLocation: 1, offset: 16, format: "float32x4" },
                { shaderLocation: 2, offset: 32, format: "float32x4" }] }],
            Primitive: { topology: "triangle-list", cullMode: "none" },
            DepthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "greater" },
            Targets: [{ format: "rgba16float", blend: { color: { srcFactor: "one", dstFactor: "one", operation: "add" },
                                                        alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" } } }]
        }, [this.Layout]);
    }

    Random()
    {
        this.Seed = (Math.imul(this.Seed, 1664525) + 1013904223) >>> 0;
        return this.Seed / 4294967296;
    }

    // 📝 Scrapes: [{ Point, Velocity (the metal's slide over the surface), Normal, Strength, Wheel,
    //    Rim: { Forward, SpinSpeed, Radius } for a rim, null for the hull }].
    Emit(Scrapes, Seconds)
    {
        if (!this.Settings.Enabled || !(Seconds > 0.0))
            return;
        this.Metrics.Scrapes = Scrapes.length;
        for (const Scrape of Scrapes)
        {
            const Expected = SparksPerStrength * this.Settings.Rate * Scrape.Strength * Seconds;
            let Count = Math.floor(Expected) + (this.Random() < Expected - Math.floor(Expected) ? 1 : 0);
            Count = Math.min(Count, 96);
            const Normal = Scrape.Normal || [0.0, 0.0, 1.0];
            const Slide = Scrape.Velocity;
            const SlideSpeed = Math.hypot(Slide[0], Slide[1], Slide[2]);
            for (let Spark = 0; Spark < Count && this.Particles.length < SparkCapacity; ++Spark)
            {
                const Spread = [this.Random() * 2.0 - 1.0, this.Random() * 2.0 - 1.0, this.Random() * 2.0 - 1.0];
                let Origin, Velocity;
                if (Scrape.Rim)
                {
                    // 📐 Detached α behind the patch in the sense the rim turns (most right behind it): from the patch at
                    //    R((1 − cos α)·N − σ·sin α·F), moving at Slip + S(1 − cos α)·F + |S|·sin α·N, σ = sign S; it keeps
                    //    75–100 % of that, scattered in a narrow cone and bounced a little off the road.
                    const { Forward, SpinSpeed, Radius } = Scrape.Rim;
                    const Sense = SpinSpeed < 0.0 ? -1.0 : 1.0;
                    const Detach = 0.02 + 0.45 * this.Random() * this.Random();
                    const Cosine = Math.cos(Detach), Sine = Math.sin(Detach);
                    Origin = [0, 1, 2].map((Axis) => Scrape.Point[Axis] + Radius * ((1.0 - Cosine) * Normal[Axis] - Sense * Sine * Forward[Axis]));
                    const Metal = [0, 1, 2].map((Axis) => Slide[Axis] + SpinSpeed * (1.0 - Cosine) * Forward[Axis] + Math.abs(SpinSpeed) * Sine * Normal[Axis]);
                    const Speed = Math.hypot(Metal[0], Metal[1], Metal[2]);
                    const Share = 0.75 + 0.25 * this.Random();
                    const Scatter = 0.12 * Speed + 0.4;
                    const Bounce = 0.3 + 1.2 * this.Random();
                    Velocity = [0, 1, 2].map((Axis) => Metal[Axis] * Share + Spread[Axis] * Scatter + Normal[Axis] * Bounce);
                }
                else
                {
                    // 📝 Along the slide at 30–75 % of its speed, fanned ±35° and kicked 1–4 m/s off the surface.
                    const Share = 0.3 + 0.45 * this.Random();
                    const Fan = 0.6 * Math.max(2.0, SlideSpeed * 0.35);
                    const Kick = 1.0 + 3.0 * this.Random();
                    const Jitter = 0.04;
                    Origin = [Scrape.Point[0] + (this.Random() - 0.5) * Jitter, Scrape.Point[1] + (this.Random() - 0.5) * Jitter,
                              Scrape.Point[2] + 0.01 + this.Random() * 0.02];
                    Velocity = [0, 1, 2].map((Axis) => Slide[Axis] * Share + Spread[Axis] * Fan + Normal[Axis] * Kick);
                }
                // 📝 Born part-way through the frame, with a tail back along its path so even a new spark is a streak.
                //    Exothermic carbon-steel / alloy oxidation ignites freshly sheared chips at 2450–3350 K (white-hot
                //    incandescent core), cooling by T⁴ radiation and convection through straw-amber to cherry-red embers.
                const Born = this.Random() * Seconds;
                const Position = [0, 1, 2].map((Axis) => Origin[Axis] + Velocity[Axis] * Born);
                const InitialKelvin = 2450.0 + 820.0 * Math.pow(this.Random(), 0.7) + Math.min(280.0, SlideSpeed * 10.0);
                const MaxLife = 0.32 + 0.68 * Math.pow(this.Random(), 1.3);
                this.Particles.push({
                    Position,
                    Prior: Origin,
                    Velocity,
                    Kelvin: InitialKelvin,
                    Age: 0.0,
                    MaxLife,
                    BurstAt: this.Random() < 0.28 ? MaxLife * (0.68 + 0.22 * this.Random()) : -1.0,
                    Fresh: true,
                    Size: (0.55 + 0.85 * this.Random()) * this.Settings.Size
                });
                this.Metrics.Emitted++;
            }
        }
    }

    // 📝 Reflects a spark's velocity off a surface normal with Coulomb friction, restitution and micro-roughness scatter.
    ReflectSpark(Spark, HitPoint, Normal, Restitution = 0.38, Friction = 0.66)
    {
        Spark.Position = [
            HitPoint[0] + Normal[0] * 0.006,
            HitPoint[1] + Normal[1] * 0.006,
            HitPoint[2] + Normal[2] * 0.006
        ];
        const V = Spark.Velocity;
        const Vn = V[0] * Normal[0] + V[1] * Normal[1] + V[2] * Normal[2];
        if (Vn >= 0.0)
            return;
        const Tx = V[0] - Normal[0] * Vn, Ty = V[1] - Normal[1] * Vn, Tz = V[2] - Normal[2] * Vn;
        const Speed = Math.hypot(V[0], V[1], V[2]);
        const Scatter = 0.08 * Speed;
        const Bounce = Restitution * (0.75 + 0.5 * this.Random());
        Spark.Velocity = [
            Tx * Friction - Normal[0] * Vn * Bounce + (this.Random() - 0.5) * Scatter,
            Ty * Friction - Normal[1] * Vn * Bounce + (this.Random() - 0.5) * Scatter,
            Tz * Friction - Normal[2] * Vn * Bounce + (this.Random() - 0.5) * Scatter
        ];
        // Impact re-heats/exposes fresh metal slightly on hard hits
        if (-Vn > 4.0)
            Spark.Kelvin = Math.min(3300.0, Spark.Kelvin + Math.min(220.0, (-Vn - 4.0) * 18.0));
        this.Metrics.Bounces++;
    }

    // 📝 Collides a spark segment Prior → Position against world geometry: static obstacle AABBs and dynamic convex hulls.
    CollideWorldGeometry(Spark, World)
    {
        if (!World)
            return;
        const A = Spark.Prior, B = Spark.Position;
        const MinX = Math.min(A[0], B[0]) - 0.02, MaxX = Math.max(A[0], B[0]) + 0.02;
        const MinY = Math.min(A[1], B[1]) - 0.02, MaxY = Math.max(A[1], B[1]) + 0.02;
        const MinZ = Math.min(A[2], B[2]) - 0.02, MaxZ = Math.max(A[2], B[2]) + 0.02;

        // ① Static world obstacles (walls, hangar panels/roof, shipping containers, jersey barriers, tower, intact props)
        const Obstacles = World.Obstacles;
        if (Obstacles)
        {
            for (let Index = 0; Index < Obstacles.length; ++Index)
            {
                const Box = Obstacles[Index];
                const Lo = Box.Minimum, Hi = Box.Maximum;
                if (MaxX < Lo[0] || MinX > Hi[0] || MaxY < Lo[1] || MinY > Hi[1] || MaxZ < Lo[2] || MinZ > Hi[2])
                    continue;
                const Hit = CollideSegmentBox(A, B, Lo, Hi);
                if (Hit)
                {
                    this.ReflectSpark(Spark, Hit.Point, Hit.Normal, 0.42, 0.68);
                    return;
                }
            }
        }

        // ② Dynamic rigid-body convex hulls (fracture debris slabs, knocked cones, stress objects)
        const Bodies = World.Bodies;
        if (Bodies)
        {
            const P = Spark.Position;
            for (let Index = 0; Index < Bodies.length; ++Index)
            {
                const Body = Bodies[Index];
                const DX = P[0] - Body.Position[0], DY = P[1] - Body.Position[1], DZ = P[2] - Body.Position[2];
                const Limit = Body.Radius + 0.03;
                if (DX * DX + DY * DY + DZ * DZ > Limit * Limit)
                    continue;
                const Planes = Body.WorldPlanes;
                const PlaneCount = Body.Planes ? Body.Planes.length : 0;
                if (!Planes || PlaneCount === 0)
                    continue;
                let Inside = true, BestDepth = Infinity, BestPlane = -1;
                for (let Plane = 0; Plane < PlaneCount; ++Plane)
                {
                    const Base = Plane * 4;
                    const Signed = Planes[Base] * P[0] + Planes[Base + 1] * P[1] + Planes[Base + 2] * P[2] - Planes[Base + 3];
                    if (Signed > 0.0)
                    {
                        Inside = false;
                        break;
                    }
                    if (-Signed < BestDepth)
                    {
                        BestDepth = -Signed;
                        BestPlane = Base;
                    }
                }
                if (Inside && BestPlane >= 0)
                {
                    const Normal = [Planes[BestPlane], Planes[BestPlane + 1], Planes[BestPlane + 2]];
                    const SurfacePoint = [
                        P[0] + Normal[0] * BestDepth,
                        P[1] + Normal[1] * BestDepth,
                        P[2] + Normal[2] * BestDepth
                    ];
                    this.ReflectSpark(Spark, SurfacePoint, Normal, 0.36, 0.64);
                    return;
                }
            }
        }
    }

    // 📝 Ballistic with linear drag, Stefan–Boltzmann radiative + convective cooling, and collisions against the course & world geometry.
    Advance(Seconds, World = null)
    {
        if (!(Seconds > 0.0))
            return;
        const Survivors = [];
        let LightPower = 0.0;
        const LightCentre = [0.0, 0.0, 0.0];
        const LightColour = [0.0, 0.0, 0.0];
        for (const Spark of this.Particles)
        {
            // 📝 A spark born this frame already sits where it flew to since; the rest step from where they were.
            if (Spark.Fresh)
            {
                Spark.Fresh = false;
            }
            else
            {
                Spark.Age += Seconds;
                Spark.Prior = Spark.Position.slice();
                const Damping = Math.exp(-AirDrag * Seconds);
                Spark.Velocity = [Spark.Velocity[0] * Damping, Spark.Velocity[1] * Damping, Spark.Velocity[2] * Damping - Gravity * Seconds];
                Spark.Position = [Spark.Position[0] + Spark.Velocity[0] * Seconds, Spark.Position[1] + Spark.Velocity[1] * Seconds,
                                  Spark.Position[2] + Spark.Velocity[2] * Seconds];
            }

            // ① Course relief collision (asphalt, kerbs, jump ramp with analytic surface normal)
            const Ground = ResolveCourseHeight(Spark.Position[0], Spark.Position[1]);
            if (Spark.Position[2] < Ground + 0.005)
            {
                const Normal = Ground > 0.0 ? ResolveCourseNormal(Spark.Position[0], Spark.Position[1]) : [0.0, 0.0, 1.0];
                this.ReflectSpark(Spark, [Spark.Position[0], Spark.Position[1], Ground], Normal, 0.34, 0.62);
            }

            // ② World geometry collision (walls, hangar, containers, barriers, props, cones, debris)
            this.CollideWorldGeometry(Spark, World);

            // ③ Physical Stefan–Boltzmann T⁴ radiative + convective cooling (white-hot → straw-gold → amber → cherry-red)
            const TNorm = Spark.Kelvin / 2000.0;
            const AmbNorm = AmbientKelvin / 2000.0;
            const RadLoss = RadiativeCooling * (TNorm * TNorm * TNorm * TNorm - AmbNorm * AmbNorm * AmbNorm * AmbNorm);
            const ConvLoss = ConvectiveCooling * (Spark.Kelvin - AmbientKelvin);
            Spark.Kelvin = Math.max(AmbientKelvin, Spark.Kelvin - (RadLoss + ConvLoss) * Seconds);

            // Terminal exothermic carbon-oxidation micro-burst near end of life
            if (Spark.BurstAt > 0.0 && Spark.Age >= Spark.BurstAt)
            {
                Spark.BurstAt = -1.0;
                Spark.Kelvin = Math.min(3150.0, Spark.Kelvin + 520.0);
                Spark.Velocity[0] += (this.Random() - 0.5) * 2.2;
                Spark.Velocity[1] += (this.Random() - 0.5) * 2.2;
                Spark.Velocity[2] += 0.6 + 1.4 * this.Random();
            }

            if (Spark.Kelvin > VisibleKelvin && Spark.Age < Spark.MaxLife)
            {
                Survivors.push(Spark);
                const Chromaticity = ResolveSparkChromaticity(Spark.Kelvin);
                const Weight = Math.pow(Math.max(0.0, (Spark.Kelvin - VisibleKelvin) / 1600.0), 3.2) * Spark.Size;
                if (Weight > 0.0)
                {
                    for (let Axis = 0; Axis < 3; ++Axis)
                    {
                        LightCentre[Axis] += Spark.Position[Axis] * Weight;
                        LightColour[Axis] += Chromaticity[Axis] * Weight;
                    }
                    LightPower += Weight;
                }
            }
        }
        this.Particles = Survivors;
        this.Live = Survivors.length;
        this.Metrics.Live = this.Live;
        if (LightPower > 0.0)
        {
            const Flicker = 0.84 + 0.32 * this.Random();
            this.SparkLight.Position = LightCentre.map((Component) => Component / LightPower);
            this.SparkLight.Position[2] = Math.max(0.18, this.SparkLight.Position[2] + 0.08);
            this.SparkLight.Colour = LightColour.map((Component) => Component / LightPower);
            this.SparkLight.Intensity = Math.min(4.8, LightPower * 0.085 * this.Settings.Brightness * Flicker);
        }
        else
        {
            this.SparkLight.Intensity = 0.0;
        }
        if (this.Live === 0)
            return;
        // 📝 Instances: the streak from where the spark was a frame ago (the raster projects it with last frame's camera,
        //    so the streak is the motion the camera saw) to where it is.
        const Brightness = this.Settings.Brightness;
        for (let Index = 0; Index < this.Live; ++Index)
        {
            const Spark = this.Particles[Index];
            const Offset = Index * InstanceFloats;
            const Tail = Spark.Prior || Spark.Position;
            const Hotness = Math.max(0.0, Math.min(1.0, (Spark.Kelvin - 1100.0) / 2100.0));
            const LifeFade = 1.0 - Math.pow(Math.min(1.0, Spark.Age / Math.max(Spark.MaxLife, 0.1)), 3.0);
            const Radiance = ResolveSparkRadiance(Spark.Kelvin).map((Channel) => Channel * Brightness * LifeFade);
            this.Instances.set([...Spark.Position, SparkWidth * Spark.Size, ...Tail, Hotness, ...Radiance, Hotness * Hotness], Offset);
        }
        this.Exchange.Device.queue.writeBuffer(this.InstanceRecords, 0, this.Instances, 0, this.Live * InstanceFloats);
    }

    // 📝 Additively over the post radiance, depth-tested against the opaque surface (read only).
    Record(Encoder, TargetView, DepthView)
    {
        if (!this.Program || this.Live === 0)
            return;
        const Pass = Encoder.beginRenderPass({
            label: "Sparks",
            colorAttachments: [{ view: TargetView, loadOp: "load", storeOp: "store" }],
            depthStencilAttachment: { view: DepthView, depthReadOnly: true }
        });
        Pass.setPipeline(this.Program);
        Pass.setBindGroup(0, this.Group);
        Pass.setVertexBuffer(0, this.InstanceRecords);
        Pass.draw(6, this.Live, 0, 0);
        Pass.end();
    }

    Clear()
    {
        this.Particles = [];
        this.Live = 0;
        this.SparkLight.Intensity = 0.0;
    }

    QueryReadout()
    {
        return [`sparks live: ${this.Metrics.Live} · emitted ${this.Metrics.Emitted} · scrapes ${this.Metrics.Scrapes} · bounces ${this.Metrics.Bounces}`];
    }
}

// 📐 Swept segment A → B against an axis-aligned box [Lo, Hi]; handles both entry along the segment and endpoints inside.
function CollideSegmentBox(A, B, Lo, Hi)
{
    // If B is inside the box, push out through the nearest face (or entry face along A → B)
    if (B[0] > Lo[0] && B[0] < Hi[0] && B[1] > Lo[1] && B[1] < Hi[1] && B[2] > Lo[2] && B[2] < Hi[2])
    {
        const Exits = [B[0] - Lo[0], Hi[0] - B[0], B[1] - Lo[1], Hi[1] - B[1], B[2] - Lo[2], Hi[2] - B[2]];
        let Face = 0;
        for (let Candidate = 1; Candidate < 6; ++Candidate)
            if (Exits[Candidate] < Exits[Face])
                Face = Candidate;
        const Normal = [0.0, 0.0, 0.0];
        const Axis = Face >> 1;
        Normal[Axis] = (Face & 1) ? 1.0 : -1.0;
        const Point = B.slice();
        Point[Axis] = (Face & 1) ? Hi[Axis] : Lo[Axis];
        return { Point, Normal };
    }
    let TMin = 0.0, TMax = 1.0, HitAxis = -1, HitSign = 0.0;
    for (let Axis = 0; Axis < 3; ++Axis)
    {
        const Delta = B[Axis] - A[Axis];
        if (Math.abs(Delta) < 1.0e-7)
        {
            if (A[Axis] < Lo[Axis] || A[Axis] > Hi[Axis])
                return null;
            continue;
        }
        const Inv = 1.0 / Delta;
        let T0 = (Lo[Axis] - A[Axis]) * Inv;
        let T1 = (Hi[Axis] - A[Axis]) * Inv;
        let Sign = -1.0;
        if (T0 > T1)
        {
            const Swap = T0; T0 = T1; T1 = Swap;
            Sign = 1.0;
        }
        if (T0 > TMin)
        {
            TMin = T0;
            HitAxis = Axis;
            HitSign = Sign;
        }
        TMax = Math.min(TMax, T1);
        if (TMin > TMax)
            return null;
    }
    if (HitAxis < 0 || TMin < 0.0 || TMin > 1.0)
        return null;
    const Normal = [0.0, 0.0, 0.0];
    Normal[HitAxis] = HitSign;
    const Point = [
        A[0] + (B[0] - A[0]) * TMin,
        A[1] + (B[1] - A[1]) * TMin,
        A[2] + (B[2] - A[2]) * TMin
    ];
    return { Point, Normal };
}

// 📐 Physical Planckian locus chromaticity in linear Rec.709 for incandescent metal sparks:
//    • 3000–3400 K: brilliant pale incandescent white-gold ([1.00, 0.91, 0.78])
//    • 2300–2800 K: luminous warm white-straw ([1.00, 0.76, 0.48])
//    • 1700–2100 K: warm golden-amber ([1.00, 0.50, 0.18])
//    • 1050–1450 K: deep cherry-red ember ([1.00, 0.18, 0.03])
export function ResolveSparkChromaticity(Kelvin)
{
    const T = Math.max(1000.0, Math.min(4000.0, Kelvin));
    const U = (T - 1000.0) / 2400.0; // 0 at 1000 K, 1 at 3400 K
    const Red = 1.0;
    const Green = Math.min(0.95, 0.12 + 0.82 * Math.pow(Math.max(0.0, U), 1.08));
    const Blue = Math.min(0.84, 0.015 + 0.80 * Math.pow(Math.max(0.0, U - 0.12) / 0.88, 1.55));
    return [Red, Green, Blue];
}

export function ResolveSparkRadiance(Kelvin)
{
    const Chromaticity = ResolveSparkChromaticity(Kelvin);
    const Ratio = Math.max(0.4, Kelvin / 1850.0);
    const Brightness = 95.0 * Math.pow(Ratio, 3.6);
    return Chromaticity.map((Channel) => Channel * Brightness);
}
