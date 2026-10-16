//============================================================================================================================================
//                                                           SHADOWPROJECTION.JS
//============================================================================================================================================
// 🧩 Cascaded sun shadow depth: bounding-sphere slices of the view frustum, texel-snapped so the cascades do not shimmer.

import { VertexStride } from "./FacetStructure.js";
import { ConstructViewTransform, ConstructOrthographicTransform, MultiplyTransform, TransformPoint,
         AddVector, ScaleVector, SubtractVector, LengthVector, NormalizeVector, CrossVector, MultiplyAddVector } from "./TransformProjection.js";

const CascadeCount  = 3;                       // [-]
const CascadeSplits = [0.0, 12.0, 40.0, 140.0]; // [m] view distances bounding each cascade
const UniformStride = 256;                      // [B] dynamic offset alignment

export class ShadowProjection
{
    constructor(Exchange, Shaders, Extent)
    {
        this.Exchange = Exchange;
        this.Shaders  = Shaders;
        this.Extent   = Extent;
        this.Cascades = [];
    }

    async ConstructResources(OccupantRecords, CarcassRecords)
    {
        this.DepthTexture = this.Exchange.ConstructTexture({ label: "Shadow cascades", size: [this.Extent, this.Extent, CascadeCount],
                                                             format: "depth32float",
                                                             usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        this.LayerViews = [];
        for (let Layer = 0; Layer < CascadeCount; ++Layer)
            this.LayerViews.push(this.DepthTexture.createView({ dimension: "2d", baseArrayLayer: Layer, arrayLayerCount: 1 }));
        this.LayeredView = this.DepthTexture.createView({ dimension: "2d-array" });
        this.ComparisonSampler = this.Exchange.ConstructSampler({ compare: "less-equal", magFilter: "linear", minFilter: "linear" });
        this.CascadeRecords  = this.Exchange.ConstructRecords(UniformStride * CascadeCount, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "Cascade records");
        this.ReceiverRecords = this.Exchange.ConstructRecords(256, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "Cascade receiver");
        this.Layout = this.Exchange.ConstructDescriptorLayout(["UniformDynamic", "StorageRead", "StorageRead"], GPUShaderStage.VERTEX, "Shadow raster");
        this.Group = this.Exchange.ConstructDescriptorGroup(this.Layout,
            [{ buffer: this.CascadeRecords, offset: 0, size: 64 }, OccupantRecords, CarcassRecords]);
        this.Program = await this.Shaders.ConstructRasterProgram("ShadowRaster.wgsl", {
            VertexEntry: "ShadowVertex",
            VertexLayouts: [{ arrayStride: VertexStride, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" },
                                                                      { shaderLocation: 3, offset: 28, format: "uint32" }] }],
            Primitive: { topology: "triangle-list", cullMode: "none" },
            DepthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less",
                            depthBias: 2, depthBiasSlopeScale: 2.0, depthBiasClamp: 0.01 }
        }, [this.Layout]);
    }

    // 📝 Each cascade is the bounding sphere of its frustum slice, so its footprint is rotation-invariant; the sphere
    //    centre is then snapped to whole shadow texels in light space so translation does not crawl the edges.
    ResolveCascades(Camera, LightDirection)
    {
        const Up = Math.abs(LightDirection[2]) > 0.98 ? [1.0, 0.0, 0.0] : [0.0, 0.0, 1.0];
        const Forward = Camera.Forward;
        const Right = NormalizeVector(CrossVector(Forward, [0.0, 0.0, 1.0]));
        const Upward = CrossVector(Right, Forward);
        const TanY = Math.tan(0.5 * Camera.VerticalFieldOfView);
        const TanX = TanY * Camera.Aspect;
        this.Cascades = [];
        const Receiver = new Float32Array(64);
        for (let Cascade = 0; Cascade < CascadeCount; ++Cascade)
        {
            const Near = Math.max(CascadeSplits[Cascade], Camera.Near);
            const Far = CascadeSplits[Cascade + 1];
            let Centre = [0.0, 0.0, 0.0];
            const Corners = [];
            for (const Distance of [Near, Far])
            {
                for (const SignX of [-1, 1])
                {
                    for (const SignY of [-1, 1])
                    {
                        const Corner = MultiplyAddVector(MultiplyAddVector(MultiplyAddVector(Camera.Position, Forward, Distance),
                                                                           Right, SignX * TanX * Distance), Upward, SignY * TanY * Distance);
                        Corners.push(Corner);
                        Centre = AddVector(Centre, Corner);
                    }
                }
            }
            Centre = ScaleVector(Centre, 1.0 / 8.0);
            let Radius = 0.0;
            for (const Corner of Corners)
                Radius = Math.max(Radius, LengthVector(SubtractVector(Corner, Centre)));
            Radius = Math.ceil(Radius * 16.0) / 16.0;
            const TexelWorld = (2.0 * Radius) / this.Extent;
            const Reach = Radius + 220.0;
            let View = ConstructViewTransform(MultiplyAddVector(Centre, LightDirection, Reach), Centre, Up);
            const Snapped = TransformPoint(View, Centre);
            const OffsetX = Snapped[0] - Math.round(Snapped[0] / TexelWorld) * TexelWorld;
            const OffsetY = Snapped[1] - Math.round(Snapped[1] / TexelWorld) * TexelWorld;
            const Projection = ConstructOrthographicTransform(-Radius + OffsetX, Radius + OffsetX, -Radius + OffsetY, Radius + OffsetY,
                                                              1.0, Reach + Radius + 60.0);
            const LightViewProjection = MultiplyTransform(Projection, View);
            this.Cascades.push({ LightViewProjection, TexelWorld });
            Receiver.set(LightViewProjection, Cascade * 16);
            Receiver[48 + Cascade] = Far;
            Receiver[52 + Cascade] = TexelWorld;
        }
        Receiver[51] = CascadeCount;
        const Device = this.Exchange.Device;
        const Records = new Float32Array(CascadeCount * UniformStride / 4);
        this.Cascades.forEach((Cascade, Index) => Records.set(Cascade.LightViewProjection, Index * UniformStride / 4));
        Device.queue.writeBuffer(this.CascadeRecords, 0, Records);
        Device.queue.writeBuffer(this.ReceiverRecords, 0, Receiver);
    }

    RecordCascades(Encoder, Scene, VertexRecords, TimestampWrites, Fragments = null)
    {
        for (let Cascade = 0; Cascade < CascadeCount; ++Cascade)
        {
            const Pass = Encoder.beginRenderPass({
                label: `Shadow cascade ${Cascade}`,
                colorAttachments: [],
                depthStencilAttachment: { view: this.LayerViews[Cascade], depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store" },
                timestampWrites: ProjectCascadeTimestamps(TimestampWrites, Cascade)
            });
            Pass.setPipeline(this.Program);
            Pass.setBindGroup(0, this.Group, [Cascade * UniformStride]);
            Pass.setVertexBuffer(0, VertexRecords);
            for (const Run of Scene.ShadowRuns)
            {
                const Set = Scene.FacetSets[Run.FacetSet];
                Pass.draw(Set.VertexCount, Run.Count, Set.FirstVertex, Run.First);
            }
            if (Fragments && Fragments.VertexCount > 0)
            {
                Pass.setVertexBuffer(0, Fragments.VertexRecords);
                Pass.draw(Fragments.VertexCount, 1, 0, Scene.FragmentFirst);
            }
            Pass.end();
        }
    }
}

// 📝 One timestamp pair spans the three cascade passes: the beginning on the first, the end on the last.
function ProjectCascadeTimestamps(TimestampWrites, Cascade)
{
    if (!TimestampWrites)
        return undefined;
    if (Cascade === 0)
        return { querySet: TimestampWrites.querySet, beginningOfPassWriteIndex: TimestampWrites.beginningOfPassWriteIndex };
    if (Cascade === CascadeCount - 1)
        return { querySet: TimestampWrites.querySet, endOfPassWriteIndex: TimestampWrites.endOfPassWriteIndex };
    return undefined;
}

export { CascadeCount };
