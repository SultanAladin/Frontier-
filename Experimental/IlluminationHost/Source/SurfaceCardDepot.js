//============================================================================================================================================
//                                                           SURFACECARDDEPOT.JS
//============================================================================================================================================
// 🧩 The surface cache: oriented cards per occupant in one texel space, captured once, relit by a scheduled tile budget.

import { OccupantRole, VertexStride, ScatterCapacity } from "./FacetStructure.js";

const MinimumCardTexels       = 4;     // [texel] - shortest card edge
const MaximumCardTexels       = 256;   // [texel] - longest card edge
const CardStride              = 48;    // [B]     - CardRecord
const ScatterTilesPerOccupant = 24;    // [-]     - six cards of at most 16 × 16 texels (2 × 2 tiles) each
const TileBudgetCeiling       = 8192;  // [-]     - the panel's static-tile slider maximum

export class SurfaceCardDepot
{
    // 📝 Configuration: Extent (card texel space edge), DensityScale, TileBudget (8×8 tiles relit per frame beyond the
    //    moving occupants' tiles, which are relit every frame).
    constructor(Exchange, Shaders, Configuration)
    {
        this.Exchange      = Exchange;
        this.Shaders       = Shaders;
        this.Configuration = Configuration;
        this.Cards         = [];
        this.DynamicTiles  = [];
        this.StaticTiles   = [];
        this.Cursor        = 0;
        this.WarmFrames    = 6;
        this.ScheduledTiles = 0;
        this.OccupiedTexels = 0;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                               CARD ALLOCATION
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Six inward-looking cards on the faces of each occupant's local card bounds (one +Z card for a ground tile),
    //    sized by texel density and rounded to whole 4×4 radiosity sites, then shelf-packed. Should the packing
    //    overflow the texel space, every density is lowered together and the packing repeated.
    // 📝 Ground tiles and strips are allocated first, so GroundFirstCard and GroundStripCard — compiled into every
    //    shader as constants — stay 0 and TileCount² however many occupants the stress test adds. When the packing
    //    overflows, the scatter span's density is lowered before the authored scene's is touched.
    AllocateCards(Scene)
    {
        let DensityScale = this.Configuration.DensityScale;
        let ScatterScale = 1.0;
        const Ground = (Occupant) => (Occupant.Roles & OccupantRole.Cards) !== 0 && !(Occupant.Roles & OccupantRole.Distance);
        const Order = [];
        Scene.Occupants.forEach((Occupant, Index) => { if (Ground(Occupant)) Order.push(Index); });
        Scene.Occupants.forEach((Occupant, Index) => { if (!Ground(Occupant)) Order.push(Index); });
        for (let Attempt = 0; Attempt < 24; ++Attempt)
        {
            this.Cards = [];
            for (const Index of Order)
            {
                const Occupant = Scene.Occupants[Index];
                Occupant.FirstCard = this.Cards.length;
                Occupant.CardCount = 0;
                if (!(Occupant.Roles & OccupantRole.Cards))
                    continue;
                const Minimum = Occupant.CardMinimum.slice();
                const Maximum = Occupant.CardMaximum.slice();
                const Ground  = !(Occupant.Roles & OccupantRole.Distance);
                if (!Ground)
                {
                    for (let Axis = 0; Axis < 3; ++Axis)
                    {
                        const Grow = Math.max(0.01, 0.01 * (Maximum[Axis] - Minimum[Axis]));
                        Minimum[Axis] -= Grow;
                        Maximum[Axis] += Grow;
                    }
                }
                const Axes = Ground ? [4] : [0, 1, 2, 3, 4, 5];
                for (const Axis of Axes)
                {
                    const DepthAxis = Axis >> 1;
                    const AcrossU = (DepthAxis + 1) % 3, AcrossV = (DepthAxis + 2) % 3;
                    const Density = Occupant.CardDensity * DensityScale * (Occupant.Scatter ? ScatterScale : 1.0);
                    const Size = (Length) => Math.ceil(Math.min(MaximumCardTexels,
                                                       Math.max(MinimumCardTexels, Math.round(Length * Density))) / 4) * 4;
                    this.Cards.push({ LocalMinimum: Minimum, LocalMaximum: Maximum, Axis, Occupant: Index,
                                      TexelExtent: [Size(Maximum[AcrossU] - Minimum[AcrossU]), Size(Maximum[AcrossV] - Minimum[AcrossV])],
                                      TexelOrigin: [0, 0] });
                    Occupant.CardCount++;
                }
            }
            if (this.PackCards())
            {
                this.DensityScaleUsed = DensityScale;
                this.ScatterScaleUsed = ScatterScale;
                break;
            }
            if (Scene.ScatterCount > 0 && ScatterScale > 0.25)
                ScatterScale *= 0.7;
            else
                DensityScale *= 0.8;
            if (Attempt === 23)
                throw new Error("Surface cards do not fit the card texel space");
        }

        this.GroundFirstCard = Scene.Occupants[Scene.GroundTiles.First].FirstCard;
        this.GroundStripCard = Scene.Occupants[Scene.GroundTiles.Strips[0]].FirstCard;

        // 📝 Every tile joins the round-robin refresh; a dynamic occupant's tiles are also listed under it, so the
        //    schedule can relight an occupant every frame only while it actually moves (a parked car, a settled crate
        //    cost nothing beyond the refresh).
        this.DynamicTiles = [];
        this.StaticTiles = [];
        this.RefreshTiles = [];
        this.OccupantTiles = new Map();
        this.OccupiedTexels = 0;
        this.Cards.forEach((Card, CardIndex) =>
        {
            const Dynamic = (Scene.Occupants[Card.Occupant].Roles & OccupantRole.Dynamic) !== 0;
            this.OccupiedTexels += Card.TexelExtent[0] * Card.TexelExtent[1];
            for (let TileY = 0; TileY < Math.ceil(Card.TexelExtent[1] / 8); ++TileY)
            {
                for (let TileX = 0; TileX < Math.ceil(Card.TexelExtent[0] / 8); ++TileX)
                {
                    const Assignment = [CardIndex, (TileY << 16) | TileX];
                    (Dynamic ? this.DynamicTiles : this.StaticTiles).push(Assignment);
                    this.RefreshTiles.push(Assignment);
                    if (Dynamic)
                    {
                        if (!this.OccupantTiles.has(Card.Occupant))
                            this.OccupantTiles.set(Card.Occupant, []);
                        this.OccupantTiles.get(Card.Occupant).push(Assignment);
                    }
                }
            }
        });
        this.Cursor = this.RefreshTiles.length > 0 ? this.Cursor % this.RefreshTiles.length : 0;
    }

    PackCards()
    {
        const Extent = this.Configuration.Extent;
        const Order = this.Cards.map((Card, Index) => Index)
                                .sort((Left, Right) => this.Cards[Right].TexelExtent[1] - this.Cards[Left].TexelExtent[1]);
        let ShelfX = 0, ShelfY = 0, ShelfHeight = 0;
        for (const Index of Order)
        {
            const Card = this.Cards[Index];
            const [Width, Height] = Card.TexelExtent;
            if (ShelfX + Width > Extent)
            {
                ShelfY += ShelfHeight;
                ShelfX = 0;
                ShelfHeight = 0;
            }
            if (ShelfY + Height > Extent)
                return false;
            Card.TexelOrigin = [ShelfX, ShelfY];
            ShelfX += Width;
            ShelfHeight = Math.max(ShelfHeight, Height);
        }
        return true;
    }

    EncodeCardRecords()
    {
        const Bytes = new ArrayBuffer(Math.max(1, this.Cards.length) * CardStride);
        const Scalars = new Float32Array(Bytes);
        const Integers = new Uint32Array(Bytes);
        this.Cards.forEach((Card, Index) =>
        {
            const Offset = Index * (CardStride / 4);
            Scalars.set(Card.LocalMinimum, Offset);
            Integers[Offset + 3] = Card.Axis;
            Scalars.set(Card.LocalMaximum, Offset + 4);
            Integers[Offset + 7] = Card.Occupant;
            Integers[Offset + 8] = Card.TexelOrigin[0];
            Integers[Offset + 9] = Card.TexelOrigin[1];
            Integers[Offset + 10] = Card.TexelExtent[0];
            Integers[Offset + 11] = Card.TexelExtent[1];
        });
        return Scalars;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  RESOURCES
    //--------------------------------------------------------------------------------------------------------------------

    async ConstructResources(FrameRecords, OccupantRecords, MaterialRecords, DistanceLayout)
    {
        const Extent = this.Configuration.Extent;
        const Usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
        const Construct = (Label, Format, Extra = 0) =>
            this.Exchange.ConstructTexture({ label: Label, size: [Extent, Extent], format: Format, usage: Usage | Extra });
        this.AlbedoTexture   = Construct("Card albedo", "rgba8unorm-srgb");
        this.NormalTexture   = Construct("Card normal", "rgba8unorm");
        this.EmissionTexture = Construct("Card emission", "rgba16float");
        this.DepthTexture    = Construct("Card depth", "r16float");
        this.DirectTexture   = this.Exchange.ConstructTexture({ label: "Card direct irradiance", size: [Extent, Extent], format: "rgba16float",
                                                                usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
        this.FinalTexture    = this.Exchange.ConstructTexture({ label: "Card final radiance", size: [Extent, Extent], format: "rgba16float",
                                                                usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
        this.Views = {
            Albedo:   this.AlbedoTexture.createView(),
            Normal:   this.NormalTexture.createView(),
            Emission: this.EmissionTexture.createView(),
            Depth:    this.DepthTexture.createView(),
            Direct:   this.DirectTexture.createView(),
            Final:    this.FinalTexture.createView()
        };
        this.SiteStride   = Extent / 4;
        // 💾 Card and tile records are sized for the full scatter capacity up front, so adding stress-test occupants
        //    rewrites their contents and never rebuilds a descriptor group that references them.
        this.CardCapacity = this.Cards.length + ScatterCapacity * 6;
        this.TileCapacity = this.RefreshTiles.length + ScatterCapacity * ScatterTilesPerOccupant + TileBudgetCeiling;
        this.CardRecords  = this.Exchange.ConstructRecords(this.CardCapacity * CardStride, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, "Card records");
        this.Exchange.Device.queue.writeBuffer(this.CardRecords, 0, this.EncodeCardRecords());
        this.SiteRecords  = this.Exchange.ConstructRecords(this.SiteStride * this.SiteStride * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, "Radiosity sites");
        this.TileRecords  = this.Exchange.ConstructRecords(this.TileCapacity * 8, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, "Card tiles");
        this.TilePacking  = new Uint32Array(this.TileCapacity * 2);
        this.WorkRecords  = this.Exchange.ConstructRecords(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "Card work");

        const Compute = GPUShaderStage.COMPUTE;
        this.DirectLayout = this.Exchange.ConstructDescriptorLayout(
            ["Uniform", "StorageRead", "StorageRead", "StorageRead", "Uniform", "Texture2D", "Texture2D", "StorageTexture2D:rgba16float"], Compute, "Card direct");
        this.RadiosityLayout = this.Exchange.ConstructDescriptorLayout(
            ["Uniform", "StorageRead", "Uniform", "Texture2D", "Storage"], Compute, "Card radiosity");
        this.FinalLayout = this.Exchange.ConstructDescriptorLayout(
            ["Uniform", "StorageRead", "StorageRead", "Uniform", "Texture2D", "Texture2D", "Texture2D", "Texture2D", "StorageRead",
             "StorageTexture2D:rgba16float"], Compute, "Card final");
        this.SamplingLayout = this.Exchange.ConstructDescriptorLayout(
            ["StorageRead", "StorageRead", "Texture2D", "Texture2D", "Texture2D", "Sampler"], Compute | GPUShaderStage.FRAGMENT, "Card sampling");
        this.EmptyLayout = this.Exchange.ConstructDescriptorLayout([], Compute, "Empty");

        this.DirectGroup = this.Exchange.ConstructDescriptorGroup(this.DirectLayout,
            [FrameRecords, this.CardRecords, OccupantRecords, this.TileRecords, this.WorkRecords, this.Views.Normal, this.Views.Depth, this.Views.Direct]);
        this.RadiosityGroup = this.Exchange.ConstructDescriptorGroup(this.RadiosityLayout,
            [FrameRecords, this.TileRecords, this.WorkRecords, this.Views.Normal, this.SiteRecords]);
        this.FinalGroup = this.Exchange.ConstructDescriptorGroup(this.FinalLayout,
            [FrameRecords, this.CardRecords, this.TileRecords, this.WorkRecords, this.Views.Albedo, this.Views.Emission, this.Views.Direct,
             this.Views.Depth, this.SiteRecords, this.Views.Final]);

        this.DirectProgram    = await this.Shaders.ConstructComputeProgram("CardDirect.wgsl", "IntegrateCardDirect", [this.DirectLayout, DistanceLayout]);
        this.RadiosityProgram = await this.Shaders.ConstructComputeProgram("CardRadiosity.wgsl", "IntegrateCardRadiosity",
                                                                           [this.RadiosityLayout, DistanceLayout, this.SamplingLayout]);
        this.FinalProgram     = await this.Shaders.ConstructComputeProgram("CardFinal.wgsl", "IntegrateCardFinal", [this.FinalLayout]);

        this.CaptureLayout = this.Exchange.ConstructDescriptorLayout(["StorageRead", "StorageRead", "StorageRead"],
                                                                     GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, "Card capture");
        this.CaptureGroup = this.Exchange.ConstructDescriptorGroup(this.CaptureLayout, [this.CardRecords, OccupantRecords, MaterialRecords]);
        this.CaptureProgram = await this.Shaders.ConstructRasterProgram("CardCapture.wgsl", {
            VertexEntry: "CaptureVertex", FragmentEntry: "CaptureFragment",
            VertexLayouts: [{ arrayStride: VertexStride, attributes: [
                { shaderLocation: 0, offset: 0,  format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "uint32" },
                { shaderLocation: 2, offset: 16, format: "float32x3" }] }],
            Primitive: { topology: "triangle-list", cullMode: "none" },
            DepthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
            Targets: [{ format: "rgba8unorm-srgb" }, { format: "rgba8unorm" }, { format: "rgba16float" }, { format: "r16float" }]
        }, [this.CaptureLayout]);
    }

    ConstructSamplingGroup(OccupantRecords, SkyView, SkySampler)
    {
        return this.Exchange.ConstructDescriptorGroup(this.SamplingLayout,
            [OccupantRecords, this.CardRecords, this.Views.Depth, this.Views.Final, SkyView, SkySampler]);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                   CAPTURE
    //--------------------------------------------------------------------------------------------------------------------

    CaptureCards(Scene, VertexRecords)
    {
        const Device = this.Exchange.Device;
        const Extent = this.Configuration.Extent;
        const DepthAttachment = this.Exchange.ConstructTexture({ label: "Card capture depth", size: [Extent, Extent],
                                                                 format: "depth32float", usage: GPUTextureUsage.RENDER_ATTACHMENT });
        const Encoder = Device.createCommandEncoder({ label: "Card capture" });
        const Clear = (View, Value) => ({ view: View, clearValue: Value, loadOp: "clear", storeOp: "store" });
        const Pass = Encoder.beginRenderPass({
            label: "Card capture",
            colorAttachments: [Clear(this.Views.Albedo, [0, 0, 0, 0]), Clear(this.Views.Normal, [0.5, 0.5, 1, 0]),
                               Clear(this.Views.Emission, [0, 0, 0, 0]), Clear(this.Views.Depth, [4, 0, 0, 0])],
            depthStencilAttachment: { view: DepthAttachment.createView(), depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "discard" }
        });
        Pass.setPipeline(this.CaptureProgram);
        Pass.setBindGroup(0, this.CaptureGroup);
        Pass.setVertexBuffer(0, VertexRecords);
        this.Cards.forEach((Card, Index) =>
        {
            const Set = Scene.FacetSets[Scene.Occupants[Card.Occupant].FacetSet];
            Pass.setViewport(Card.TexelOrigin[0], Card.TexelOrigin[1], Card.TexelExtent[0], Card.TexelExtent[1], 0.0, 1.0);
            Pass.setScissorRect(Card.TexelOrigin[0], Card.TexelOrigin[1], Card.TexelExtent[0], Card.TexelExtent[1]);
            Pass.draw(Set.VertexCount, 1, Set.FirstVertex, Index);
        });
        Pass.end();
        Device.queue.submit([Encoder.finish()]);
        DepthAttachment.destroy();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                              LIGHTING SCHEDULE
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 A step change of the light (a preset, day to night) would otherwise drain out of the radiosity sites at the
    //    weight floor over seconds. The sites are cleared, so their next gather is taken whole, and every tile is relit.
    InvalidateLighting()
    {
        this.Exchange.Device.queue.writeBuffer(this.SiteRecords, 0, new Float32Array(this.SiteStride * this.SiteStride * 4));
        this.WarmFrames = Math.max(this.WarmFrames, 3);
    }

    // 📝 After the scene's card occupants change (the stress test): reallocate and repack every card, rewrite the card
    //    records in place, recapture the whole texel space and relight it from cleared radiosity sites.
    RewriteCards(Scene, VertexRecords)
    {
        this.AllocateCards(Scene);
        if (this.Cards.length > this.CardCapacity || this.RefreshTiles.length + TileBudgetCeiling > this.TileCapacity)
            throw new Error(`The card depot holds ${this.CardCapacity} cards / ${this.TileCapacity} tiles; the scene needs more`);
        this.Exchange.Device.queue.writeBuffer(this.CardRecords, 0, this.EncodeCardRecords());
        this.CaptureCards(Scene, VertexRecords);
        this.InvalidateLighting();
    }

    // 📝 Tiles of the occupants that moved this frame are relit every frame; every tile — static or dynamic — is also
    //    refreshed round-robin within the budget. The first WarmFrames relight everything so the depot starts lit and
    //    its radiosity has taken several bounces before the first image.
    ScheduleTiles(TileBudget, MovingOccupants = [])
    {
        const Packed = this.TilePacking;
        let Count = 0;
        const Append = (Assignment) =>
        {
            if (Count >= this.TileCapacity)
                return;
            Packed[Count * 2] = Assignment[0];
            Packed[Count * 2 + 1] = Assignment[1];
            Count++;
        };
        this.MovingTileCount = 0;
        if (this.WarmFrames > 0)
        {
            for (const Assignment of this.RefreshTiles)
                Append(Assignment);
            this.WarmFrames--;
        }
        else
        {
            for (const Occupant of MovingOccupants)
            {
                const Tiles = this.OccupantTiles.get(Occupant);
                if (Tiles)
                    for (const Assignment of Tiles)
                        Append(Assignment);
            }
            this.MovingTileCount = Count;
            const Budget = Math.min(this.RefreshTiles.length, Math.max(0, TileBudget));
            for (let Index = 0; Index < Budget; ++Index)
            {
                Append(this.RefreshTiles[this.Cursor]);
                this.Cursor = (this.Cursor + 1) % this.RefreshTiles.length;
            }
        }
        this.ScheduledTiles = Count;
        const Device = this.Exchange.Device;
        if (Count > 0)
            Device.queue.writeBuffer(this.TileRecords, 0, Packed, 0, Count * 2);
        const Work = new ArrayBuffer(16);
        new Uint32Array(Work, 0, 2).set([Count, this.SiteStride]);
        new Float32Array(Work, 8, 2).set([0.15, 0.35]);
        Device.queue.writeBuffer(this.WorkRecords, 0, Work);
    }

    RecordLighting(Encoder, DistanceGroup, SamplingGroup, RadiosityEnabled, TimestampWrites)
    {
        if (this.ScheduledTiles === 0)
            return;
        const GroupsX = Math.min(this.ScheduledTiles, 65535);
        const GroupsY = Math.ceil(this.ScheduledTiles / 65535);
        const Pass = Encoder.beginComputePass({ label: "Card lighting", timestampWrites: TimestampWrites });
        Pass.setPipeline(this.DirectProgram);
        Pass.setBindGroup(0, this.DirectGroup);
        Pass.setBindGroup(1, DistanceGroup);
        Pass.dispatchWorkgroups(GroupsX, GroupsY);
        if (RadiosityEnabled)
        {
            Pass.setPipeline(this.RadiosityProgram);
            Pass.setBindGroup(0, this.RadiosityGroup);
            Pass.setBindGroup(1, DistanceGroup);
            Pass.setBindGroup(2, SamplingGroup);
            Pass.dispatchWorkgroups(GroupsX, GroupsY);
        }
        Pass.setPipeline(this.FinalProgram);
        Pass.setBindGroup(0, this.FinalGroup);
        Pass.dispatchWorkgroups(GroupsX, GroupsY);
        Pass.end();
    }
}
