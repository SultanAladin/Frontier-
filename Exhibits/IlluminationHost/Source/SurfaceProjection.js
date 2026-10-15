//============================================================================================================================================
//                                                           SURFACEPROJECTION.JS
//============================================================================================================================================
// 🧩 Primary visibility (depth, attributes, motion) and the direct sun radiance resolved over it, sized to the screen.

import { OccupantRole, VertexStride } from "./FacetStructure.js";

export class SurfaceProjection
{
    constructor(Exchange, Shaders)
    {
        this.Exchange = Exchange;
        this.Shaders  = Shaders;
        this.Extent   = [0, 0];
    }

    async ConstructPrograms(FrameRecords, OccupantRecords, MaterialRecords)
    {
        this.FrameRecords    = FrameRecords;
        this.OccupantRecords = OccupantRecords;
        this.MaterialRecords = MaterialRecords;
        this.RasterLayout = this.Exchange.ConstructDescriptorLayout(["Uniform", "StorageRead"], GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, "Surface raster");
        this.RasterGroup = this.Exchange.ConstructDescriptorGroup(this.RasterLayout, [FrameRecords, OccupantRecords]);
        this.RasterProgram = await this.Shaders.ConstructRasterProgram("SurfaceRaster.wgsl", {
            VertexEntry: "SurfaceVertex", FragmentEntry: "SurfaceFragment",
            VertexLayouts: [{ arrayStride: VertexStride, attributes: [
                { shaderLocation: 0, offset: 0,  format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "uint32" },
                { shaderLocation: 2, offset: 16, format: "float32x3" }] }],
            Primitive: { topology: "triangle-list", cullMode: "none" },
            DepthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
            Targets: [{ format: "rgba16float" }, { format: "rg16float" }]
        }, [this.RasterLayout]);
        this.DirectLayout = this.Exchange.ConstructDescriptorLayout(
            ["Uniform", "StorageRead", "Texture2D", "TextureDepth2D", "TextureDepth2DLayered", "SamplerComparison", "Uniform", "Texture2D",
             "Sampler", "StorageTexture2D:rgba16float"], GPUShaderStage.COMPUTE, "Direct radiance");
        this.DirectProgram = await this.Shaders.ConstructComputeProgram("DirectRadiance.wgsl", "IntegrateDirectRadiance", [this.DirectLayout]);
    }

    ConstructTargets(Width, Height, Shadow, Atmosphere)
    {
        this.Extent = [Width, Height];
        for (const Texture of [this.DepthTexture, this.AttributeTexture, this.MotionTexture, this.DirectTexture])
            if (Texture) Texture.destroy();
        const Attachment = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
        this.DepthTexture     = this.Exchange.ConstructTexture({ label: "Surface depth", size: [Width, Height], format: "depth32float", usage: Attachment });
        this.AttributeTexture = this.Exchange.ConstructTexture({ label: "Surface attributes", size: [Width, Height], format: "rgba16float", usage: Attachment });
        this.MotionTexture    = this.Exchange.ConstructTexture({ label: "Surface motion", size: [Width, Height], format: "rg16float", usage: Attachment });
        this.DirectTexture    = this.Exchange.ConstructTexture({ label: "Direct radiance", size: [Width, Height], format: "rgba16float",
                                                                 usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
        this.Views = {
            Depth:      this.DepthTexture.createView(),
            Attributes: this.AttributeTexture.createView(),
            Motion:     this.MotionTexture.createView(),
            Direct:     this.DirectTexture.createView()
        };
        this.DirectGroup = this.Exchange.ConstructDescriptorGroup(this.DirectLayout,
            [this.FrameRecords, this.MaterialRecords, this.Views.Attributes, this.Views.Depth, Shadow.LayeredView, Shadow.ComparisonSampler,
             Shadow.ReceiverRecords, Atmosphere.SkyView, Atmosphere.SkySampler, this.Views.Direct]);
    }

    RecordSurface(Encoder, Scene, VertexRecords, TimestampWrites)
    {
        const Pass = Encoder.beginRenderPass({
            label: "Surface projection",
            colorAttachments: [
                { view: this.Views.Attributes, clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" },
                { view: this.Views.Motion, clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" }],
            depthStencilAttachment: { view: this.Views.Depth, depthClearValue: 0.0, depthLoadOp: "clear", depthStoreOp: "store" },
            timestampWrites: TimestampWrites
        });
        Pass.setPipeline(this.RasterProgram);
        Pass.setBindGroup(0, this.RasterGroup);
        Pass.setVertexBuffer(0, VertexRecords);
        Scene.Occupants.forEach((Occupant, Index) =>
        {
            if (!(Occupant.Roles & OccupantRole.Raster))
                return;
            const Set = Scene.FacetSets[Occupant.FacetSet];
            Pass.draw(Set.VertexCount, 1, Set.FirstVertex, Index);
        });
        Pass.end();
    }

    RecordDirect(Encoder, TimestampWrites)
    {
        const Pass = Encoder.beginComputePass({ label: "Direct radiance", timestampWrites: TimestampWrites });
        Pass.setPipeline(this.DirectProgram);
        Pass.setBindGroup(0, this.DirectGroup);
        Pass.dispatchWorkgroups(Math.ceil(this.Extent[0] / 8), Math.ceil(this.Extent[1] / 8));
        Pass.end();
    }
}
