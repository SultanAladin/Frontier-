//============================================================================================================================================
//                                                            CABINPROJECTION.JS
//============================================================================================================================================
// 🧩 Slate's physical wheel, dashboard fittings and in-cabin HMI, projected onto the local host's HDR display targets.
//
// 📝 The mesh and placement follow Slate commit 3c987f33c71c2477bd73ca29c69d5bd0ee484d1a (CabinLayout.js and
//    CabinProjection.js). The local CabinSequence remains the owner of the live TabletPanel HMI, Garage preview,
//    material picker, mirrors and transparent shell; its canvases are sampled here so material changes, Solid/Ghost/Wire
//    and live telemetry still work. The raster pass is adapted from Slate's sRGB window target to the host's linear
//    rgba16float recombination target and reverse-Z depth buffer.

import { ClusterOutlines } from "./HMI/ClusterSequence.js";
import { CabinLayout, ConstructCabinTransform } from "./CabinLayout.js";
import { MultiplyTransform, InvertTransform, TransformPoint, TransformDirection, SubtractVector, CrossVector,
         NormalizeVector } from "./TransformProjection.js";

const PoseBytes = 256;
const TabletPreview = [78 / 1200, 248 / 750, 718 / 1200, 648 / 750];
const TabletCorner = [22 / 1200, 22 / 750];

export class CabinProjection
{
    constructor(Exchange, Shaders)
    {
        this.Exchange = Exchange;
        this.Shaders = Shaders;
        this.Cabin = null;
        this.ScreenScale = 1.0;
        this.Touching = false;
    }

    async ConstructPrograms(FrameRecords, Scene, Cabin)
    {
        this.Cabin = Cabin;
        const Exchange = this.Exchange;
        const Device = Exchange.Device;
        this.PoseRecords = Exchange.ConstructRecords(PoseBytes, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "Slate cabin poses and HMI sizing");
        this.Layout = Exchange.ConstructDescriptorLayout(["Uniform", "Uniform", "Texture2D", "Texture2D", "Sampler", "Texture2D"],
            GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, "Slate cabin fittings and live HMI");
        this.Group = Exchange.ConstructDescriptorGroup(this.Layout, [FrameRecords, this.PoseRecords,
            Cabin.ClusterTexture.createView(), Cabin.TabletTexture.createView(), Cabin.LinearSampler, Cabin.PreviewTexture.createView()]);

        const Mesh = ConstructCabinMesh();
        this.VertexCount = Mesh.Count;
        this.Vertices = Exchange.ConstructRecords(Mesh.Bytes.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, "Slate cabin wheel and screens");
        Device.queue.writeBuffer(this.Vertices, 0, Mesh.Bytes);
        this.Program = await this.Shaders.ConstructRasterProgram("CabinRaster.wgsl", {
            VertexEntry: "CabinVertex", FragmentEntry: "CabinFragment",
            VertexLayouts: [{ arrayStride: 36, attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "float32x3" },
                { shaderLocation: 2, offset: 24, format: "float32x2" },
                { shaderLocation: 3, offset: 32, format: "uint32" }] }],
            Primitive: { topology: "triangle-list", cullMode: "none" },
            DepthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater-equal" },
            Targets: [{ format: "rgba16float" }]
        }, [this.Layout]);
        this.LastRecord = new Float32Array(PoseBytes / 4);
        this.LastRecord.fill(0.0);
        this.LastRecord.set(TabletPreview, 52);
        this.LastRecord.set(TabletCorner, 56);
        this.Update(this.Cabin.Settings.HmiScale || 1.0);
    }

    // 📝 Update the Slate fixture poses and only the HMI's scale/brightness. The wheel, dashboard and seated camera
    //    stay at their authored size; scaling the screen quads and their physical ray bounds together keeps touch exact.
    Update(ScreenScale = 1.0, Vehicle = null)
    {
        if (!this.PoseRecords)
            return;
        if (Vehicle)
        {
            this.BodyPose = Vehicle.QueryBodyTransform();
            this.WheelPose = MultiplyTransform(this.BodyPose,
                ConstructCabinTransform(CabinLayout.Wheel, CabinLayout.WheelTilt, Vehicle.SteerAngle * 3.0));
            this.TabletPose = MultiplyTransform(this.BodyPose, ConstructCabinTransform(CabinLayout.Tablet, CabinLayout.TabletTilt));
        }
        const Scale = Math.max(0.65, Math.min(1.4, Number.isFinite(ScreenScale) ? ScreenScale : 1.0));
        this.ScreenScale = Scale;
        const Screen = this.Cabin.Screen;
        const HmiLive = !!(Screen && this.Cabin.Settings.Screens);
        const Garage = HmiLive && Screen.Application === "garage";
        const PanelWidth = Screen ? Screen.PanelWidth : 1200;
        const PanelHeight = Screen ? Screen.PanelHeight : 750;
        const OffsetAcross = Screen ? Screen.OffsetAcross : 0;
        const OffsetDown = Screen ? Screen.OffsetDown : 0;
        const Display = [Scale, HmiLive ? this.Cabin.Settings.Brightness : 0.0, HmiLive ? 1.0 : 0.0, Garage ? 1.0 : 0.0];
        const Preview = [(78 + OffsetAcross) / PanelWidth, (248 + OffsetDown) / PanelHeight,
                         (718 + OffsetAcross) / PanelWidth, (648 + OffsetDown) / PanelHeight];
        const Corners = [22 / PanelWidth, 22 / PanelHeight, 0, 0];
        const Record = this.LastRecord;
        Record.fill(0.0);
        Record.set(this.BodyPose || new Float32Array(16), 0);
        Record.set(this.WheelPose || new Float32Array(16), 16);
        Record.set(this.TabletPose || new Float32Array(16), 32);
        Record.set(Display, 48);
        Record.set(Preview, 52);
        Record.set(Corners, 56);
        this.Exchange.Device.queue.writeBuffer(this.PoseRecords, 0, Record);
    }

    Advance(Vehicle, ScreenScale = 1.0)
    {
        this.Update(ScreenScale, Vehicle);
    }

    // 📝 World ray against the exact Slate tablet pose and its current physical HMI scale. Returns panel fractions,
    //    which the local HMI maps back through its own padded/aspect-aware logical layout.
    QueryTabletHit(Origin, Direction)
    {
        if (!this.TabletPose)
            return null;
        const Inverse = InvertTransform(this.TabletPose);
        const Eye = TransformPoint(Inverse, Origin);
        const LocalDirection = TransformDirection(Inverse, Direction);
        if (Eye[2] <= 0.0 || Math.abs(LocalDirection[2]) < 1.0e-6)
            return null;
        const Travel = (0.014 - Eye[2]) / LocalDirection[2];
        if (Travel <= 0.0 || Travel > 4.0)
            return null;
        const X = Eye[0] + LocalDirection[0] * Travel;
        const Y = Eye[1] + LocalDirection[1] * Travel;
        const HalfWidth = CabinLayout.TabletWidth * this.ScreenScale * 0.5;
        const HalfHeight = CabinLayout.TabletHeight * this.ScreenScale * 0.5;
        if (Math.abs(X) > HalfWidth || Math.abs(Y) > HalfHeight)
            return null;
        return { Across: 0.5 + X / (2.0 * HalfWidth), Down: 0.5 - Y / (2.0 * HalfHeight) };
    }

    Record(Encoder, TargetView, DepthView)
    {
        if (!this.Program || !this.VertexCount)
            return;
        const Pass = Encoder.beginRenderPass({
            label: "Slate cabin wheel and live HMI",
            colorAttachments: [{ view: TargetView, loadOp: "load", storeOp: "store" }],
            depthStencilAttachment: { view: DepthView, depthLoadOp: "load", depthStoreOp: "store" }
        });
        Pass.setPipeline(this.Program);
        Pass.setBindGroup(0, this.Group);
        Pass.setVertexBuffer(0, this.Vertices);
        Pass.draw(this.VertexCount);
        Pass.end();
    }
}

function ConstructCabinMesh()
{
    const Vertices = [];
    const Triangle = (Points, Material, UV = null, Normals = null) =>
    {
        const Normal = NormalizeVector(CrossVector(SubtractVector(Points[1], Points[0]), SubtractVector(Points[2], Points[0])));
        Points.forEach((Position, Index) => Vertices.push({ Position, Normal: Normals?.[Index] || Normal, UV: UV?.[Index] || [0, 0], Material }));
    };
    const Quad = (A, B, C, D, Material) =>
    {
        Triangle([A, B, C], Material, [[0, 1], [1, 1], [1, 0]]);
        Triangle([A, C, D], Material, [[0, 1], [1, 0], [0, 0]]);
    };

    // 📐 Slate's toroidal wheel, three spokes, and the cluster's hexagon mounted in its upper opening.
    const Radius = CabinLayout.WheelRadius, Tube = 0.018, Sectors = 64, Sides = 10;
    const RingPoint = (Segment, Side) =>
    {
        const Angle = Segment / Sectors * 2.0 * Math.PI, TubeAngle = Side / Sides * 2.0 * Math.PI;
        return [(Radius + Tube * Math.cos(TubeAngle)) * Math.cos(Angle),
                (Radius + Tube * Math.cos(TubeAngle)) * Math.sin(Angle), Tube * Math.sin(TubeAngle)];
    };
    for (let Segment = 0; Segment < Sectors; ++Segment)
        for (let Side = 0; Side < Sides; ++Side)
            Quad(RingPoint(Segment, Side), RingPoint(Segment + 1, Side), RingPoint(Segment + 1, Side + 1), RingPoint(Segment, Side + 1), 1);
    Quad([-0.17, -0.018, 0], [0.17, -0.018, 0], [0.17, 0.018, 0], [-0.17, 0.018, 0], 1);
    Quad([-0.018, -0.18, 0], [0.018, -0.18, 0], [0.028, 0, 0], [-0.028, 0, 0], 1);

    const Outline = ClusterOutlines.hexagon.Points();
    const ClusterWidth = 0.27, ClusterHeight = 0.151;
    for (let Index = 0; Index < Outline.length; ++Index)
    {
        const A = Outline[Index], B = Outline[(Index + 1) % Outline.length];
        Triangle([[0, 0, 0.018], [A[0] * ClusterWidth * 0.54, A[1] * ClusterHeight * 0.54, 0.018],
                  [B[0] * ClusterWidth * 0.54, B[1] * ClusterHeight * 0.54, 0.018]], 1);
        Triangle([[0, 0, 0.023], [A[0] * ClusterWidth * 0.5, A[1] * ClusterHeight * 0.5, 0.023],
                  [B[0] * ClusterWidth * 0.5, B[1] * ClusterHeight * 0.5, 0.023]], 2,
                 [[0.5, 0.5], [A[0] * 0.5 + 0.5, 0.5 - A[1] * 0.5], [B[0] * 0.5 + 0.5, 0.5 - B[1] * 0.5]]);
    }

    // 📐 Slate's centre-stack tablet bezel and 16:10 active display.
    const HalfWidth = CabinLayout.TabletWidth * 0.5, HalfHeight = CabinLayout.TabletHeight * 0.5;
    Quad([-HalfWidth - 0.012, -HalfHeight - 0.012, 0.008], [HalfWidth + 0.012, -HalfHeight - 0.012, 0.008],
         [HalfWidth + 0.012, HalfHeight + 0.012, 0.008], [-HalfWidth - 0.012, HalfHeight + 0.012, 0.008], 3);
    Quad([-HalfWidth, -HalfHeight, 0.014], [HalfWidth, -HalfHeight, 0.014], [HalfWidth, HalfHeight, 0.014], [-HalfWidth, HalfHeight, 0.014], 4);

    const Buffer = new ArrayBuffer(Vertices.length * 36);
    const Floats = new Float32Array(Buffer), Integers = new Uint32Array(Buffer);
    Vertices.forEach((Vertex, Index) =>
    {
        const Offset = Index * 9;
        Floats.set(Vertex.Position, Offset);
        Floats.set(Vertex.Normal, Offset + 3);
        Floats.set(Vertex.UV, Offset + 6);
        Integers[Offset + 8] = Vertex.Material;
    });
    return { Bytes: Buffer, Count: Vertices.length };
}
