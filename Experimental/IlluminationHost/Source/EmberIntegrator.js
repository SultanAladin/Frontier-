//============================================================================================================================================
//                                                            EMBERINTEGRATOR.JS
//============================================================================================================================================
// 🧩 Ember and spark particles: CPU spawning into a device ring, lattice-carried integration on the device, additive glowing streaks.

// 📝 The source projection names emitters each frame — burning flanks shed embers that ride the column, exhaust pops
//    and a burst tyre's rim spit sparks — and this module spawns their particles straight into a ring of device
//    records (a few hundred 48-byte writes at most), integrates every live one in a compute pass that reads the
//    plume's velocity lattice, and draws them as streaks into a radiance target the recombination adds before the
//    antialiasing. Nothing runs once the last particle has died.

// 📝 Sparks from a scrape (VehicleSolver.RecordScrape hands the host { Point, Velocity, Normal, Strength, Kind }
//    per contact): metal torn off at the contact does not spray isotropically — it leaves along the surface, in
//    the direction the contact is sliding, at a fraction of the sliding speed, tipped up off the surface by the
//    grinding wedge, with a little of the body's motion inherited. So a burst tyre's rim streams sparks backward
//    along the road (the contact patch's slip direction), and a sill grounding out or kissing a barrier sheets
//    them along the body instead of through it — the old projection threw them against the velocity with a wide
//    isotropic spread, which read as a fountain. The cone stays tight (Spread about the eject direction), steel
//    on the road runs white-hot, and the advection's ground bounce skips them along the asphalt.
// 📝 Spark: { Point [m], Velocity [m/s] of the contact point, Normal of the surface scraped, Strength [-], Kind }.
export function ProjectSparkEmitter(Spark)
{
    const Normal = Spark.Normal || [0.0, 0.0, 1.0];
    const Velocity = Spark.Velocity;
    const NormalSpeed = Velocity[0] * Normal[0] + Velocity[1] * Normal[1] + Velocity[2] * Normal[2];
    const Tangent = [Velocity[0] - Normal[0] * NormalSpeed, Velocity[1] - Normal[1] * NormalSpeed,
                     Velocity[2] - Normal[2] * NormalSpeed];
    const Slide = Math.hypot(Tangent[0], Tangent[1], Tangent[2]);
    const Direction = Slide > 0.3 ? Tangent.map((Scalar) => Scalar / Slide)
                                  : [-Velocity[0], -Velocity[1], 0.0].map((Scalar, Axis) =>
                                        Scalar / Math.max(Math.hypot(Velocity[0], Velocity[1]), 1.0e-3) * (Axis < 2 ? 1.0 : 0.0));
    const Eject = Math.min(16.0, Math.max(1.5, 0.55 * Slide));
    const Lift = Math.min(2.2, Math.max(0.4, 0.25 * Eject));
    return { Position: [Spark.Point[0] + Normal[0] * 0.02, Spark.Point[1] + Normal[1] * 0.02, Spark.Point[2] + Normal[2] * 0.02],
             Velocity: [Direction[0] * Eject + Normal[0] * Lift + Velocity[0] * 0.08,
                        Direction[1] * Eject + Normal[1] * Lift + Velocity[1] * 0.08,
                        Direction[2] * Eject + Normal[2] * Lift + Velocity[2] * 0.08],
             Rate: 320.0 * Spark.Strength, Temperature: Spark.Kind === "chassis" ? 2000.0 : 2200.0,
             Spread: 0.35 + 0.045 * Slide, Lift: 0.0, Gravity: 1.0, Life: 0.75 };
}

const ParticleCapacity = 4096;    // [-]
const ParticleStride   = 48;      // [B]  EmberParticle
const RecordBytes      = 48;      // [B]  EmberRecord
const ShadingBytes     = 16;      // [B]  EmberShading
const CoolingRate      = 1.1;     // [1/s] toward 600 K
const StreakSeconds    = 1.0 / 45.0;   // [s]

export class EmberIntegrator
{
    constructor(Exchange, Shaders)
    {
        this.Exchange    = Exchange;
        this.Shaders     = Shaders;
        this.Head        = 0;
        this.Seed        = 0x9E3779B9;
        this.Debt        = new Map();
        this.LongestLife = 0.0;
        this.QuietSeconds = 1.0e3;
        this.Cleared     = false;
        this.Spawned     = 0;
        this.ElapsedSeconds = 0.0;
        this.Staging     = new Float32Array(ParticleCapacity * ParticleStride / 4);
    }

    async ConstructPrograms(FrameRecords, Plume)
    {
        this.FrameRecords    = FrameRecords;
        this.ParticleRecords = this.Exchange.ConstructRecords(ParticleCapacity * ParticleStride, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, "Ember particles");
        this.UniformRecords  = this.Exchange.ConstructRecords(RecordBytes, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "Ember record");
        this.ShadingRecords  = this.Exchange.ConstructRecords(ShadingBytes, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "Ember shading");
        this.AdvectionLayout = this.Exchange.ConstructDescriptorLayout(["Uniform", "Storage", "Uniform", "Texture3D", "Sampler"],
                                                                       GPUShaderStage.COMPUTE, "Ember advection");
        this.RasterLayout = this.Exchange.ConstructDescriptorLayout(["Uniform", "StorageRead", "Uniform"],
                                                                    GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, "Ember raster");
        this.AdvectionProgram = await this.Shaders.ConstructComputeProgram("EmberAdvection.wgsl", "AdvectEmbers", [this.AdvectionLayout]);
        this.RasterProgram = await this.Shaders.ConstructRasterProgram("EmberRaster.wgsl", {
            VertexEntry: "EmberVertex", FragmentEntry: "EmberFragment", VertexLayouts: [],
            Primitive: { topology: "triangle-list", cullMode: "none" },
            DepthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "greater" },
            Targets: [{ format: "rgba16float", blend: { color: { srcFactor: "one", dstFactor: "one", operation: "add" },
                                                        alpha: { srcFactor: "one", dstFactor: "one", operation: "add" } } }]
        }, [this.RasterLayout]);
        this.RasterGroup = this.Exchange.ConstructDescriptorGroup(this.RasterLayout, [FrameRecords, this.ParticleRecords, this.ShadingRecords]);
        this.ConstructLatticeGroups(Plume);
    }

    // 📝 The advection reads the latest velocity state; rebuilt whenever the plume rebuilds its lattices.
    ConstructLatticeGroups(Plume)
    {
        this.AdvectionGroups = [0, 1].map((State) => this.Exchange.ConstructDescriptorGroup(this.AdvectionLayout,
            [this.UniformRecords, this.ParticleRecords, Plume.UniformRecords, Plume.VelocityViews[State], Plume.LatticeSampler]));
    }

    ConstructTargets(ScreenExtent, Surface)
    {
        if (this.RadianceTexture)
            this.RadianceTexture.destroy();
        this.RadianceTexture = this.Exchange.ConstructTexture({ label: "Ember radiance", size: ScreenExtent, format: "rgba16float",
                                                                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        this.RadianceView = this.RadianceTexture.createView();
        this.DepthView = Surface.Views.Depth;
        this.Cleared = false;
    }

    ProjectUniform()
    {
        this.Seed ^= this.Seed << 13;
        this.Seed ^= this.Seed >>> 17;
        this.Seed ^= this.Seed << 5;
        return (this.Seed >>> 0) / 4294967296.0;
    }

    // 📝 Emitters: [{ Position, Velocity, Rate [1/s], Temperature [K], Spread [m/s], Lift [m/s²], Gravity [-], Life [s] }].
    //    Fractional spawns carry over per emitter slot, so a slow emitter still emits on a fast display.
    Emit(Emitters, Seconds, Scale = 1.0)
    {
        const Writes = [];
        Emitters.forEach((Emitter, Slot) =>
        {
            const Owed = (this.Debt.get(Slot) || 0.0) + Emitter.Rate * Scale * Seconds;
            const Count = Math.min(256, Math.floor(Owed));
            this.Debt.set(Slot, Owed - Count);
            for (let Index = 0; Index < Count; ++Index)
            {
                const Jitter = () => (this.ProjectUniform() - 0.5) * 2.0;
                const Life = Emitter.Life * (0.6 + 0.8 * this.ProjectUniform());
                const Spread = Emitter.Spread;
                const Record = [
                    Emitter.Position[0] + Jitter() * 0.12, Emitter.Position[1] + Jitter() * 0.12, Emitter.Position[2] + Jitter() * 0.08, Life,
                    Emitter.Velocity[0] + Jitter() * Spread, Emitter.Velocity[1] + Jitter() * Spread, Emitter.Velocity[2] + Math.abs(Jitter()) * Spread,
                    Emitter.Temperature * (0.85 + 0.3 * this.ProjectUniform()),
                    Emitter.Gravity, Emitter.Lift, Emitter.Gravity > 0.5 ? 0.6 : 3.5, 0.012 + 0.012 * this.ProjectUniform()];
                Writes.push({ Slot: this.Head, Record });
                this.Head = (this.Head + 1) % ParticleCapacity;
                this.LongestLife = Math.max(this.LongestLife, Life);
            }
        });
        if (Writes.length === 0)
            return;
        // 📝 Contiguous ring runs become one write each — at most two per frame, where the ring wraps.
        let RunStart = Writes[0].Slot, RunRecords = [];
        const Flush = () =>
        {
            if (RunRecords.length === 0)
                return;
            const Scalars = this.Staging.subarray(0, RunRecords.length * 12);
            RunRecords.forEach((Record, Offset) => Scalars.set(Record, Offset * 12));
            this.Exchange.Device.queue.writeBuffer(this.ParticleRecords, RunStart * ParticleStride, Scalars);
            RunRecords = [];
        };
        for (const Write of Writes)
        {
            if (RunRecords.length > 0 && Write.Slot !== RunStart + RunRecords.length)
            {
                Flush();
                RunStart = Write.Slot;
            }
            if (RunRecords.length === 0)
                RunStart = Write.Slot;
            RunRecords.push(Write.Record);
        }
        Flush();
        this.Spawned += Writes.length;
        this.QuietSeconds = 0.0;
    }

    // 📝 Writes this frame's step record; false when nothing is alive and the target is already clear.
    Schedule(Seconds, PlumeResident, Wind, Intensity)
    {
        this.QuietSeconds += Seconds;
        this.ElapsedSeconds += Seconds;
        this.Active = this.QuietSeconds <= this.LongestLife + 0.2;
        if (!this.Active)
        {
            this.LongestLife = 0.0;
            return this.Cleared === false;
        }
        const Bytes = new ArrayBuffer(RecordBytes);
        const Scalars = new Float32Array(Bytes), Unsigned = new Uint32Array(Bytes);
        Scalars.set([Math.min(Seconds, 1.0 / 20.0), 9.81, this.ElapsedSeconds, PlumeResident ? 1.0 : 0.0], 0);
        Scalars.set([...Wind, CoolingRate], 4);
        Unsigned[8] = ParticleCapacity;
        this.Exchange.Device.queue.writeBuffer(this.UniformRecords, 0, Bytes);
        this.Exchange.Device.queue.writeBuffer(this.ShadingRecords, 0, new Float32Array([2.4 * Intensity, StreakSeconds, 1.2, 0.0]));
        return true;
    }

    RecordAdvection(Encoder, PlumeState)
    {
        if (!this.Active)
            return;
        const Pass = Encoder.beginComputePass({ label: "Ember advection" });
        Pass.setPipeline(this.AdvectionProgram);
        Pass.setBindGroup(0, this.AdvectionGroups[PlumeState]);
        Pass.dispatchWorkgroups(Math.ceil(ParticleCapacity / 64));
        Pass.end();
    }

    // 📝 Clears the radiance target every frame something is alive, and once more after the last one dies.
    RecordRaster(Encoder)
    {
        if (!this.RadianceView || (!this.Active && this.Cleared))
            return;
        const Pass = Encoder.beginRenderPass({
            label: "Ember raster",
            colorAttachments: [{ view: this.RadianceView, clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" }],
            depthStencilAttachment: { view: this.DepthView, depthReadOnly: true }
        });
        if (this.Active)
        {
            Pass.setPipeline(this.RasterProgram);
            Pass.setBindGroup(0, this.RasterGroup);
            Pass.draw(6, ParticleCapacity, 0, 0);
        }
        Pass.end();
        this.Cleared = !this.Active;
    }

    QueryLiveEstimate()
    {
        return this.Active ? Math.min(ParticleCapacity, this.Spawned) : 0;
    }
}
