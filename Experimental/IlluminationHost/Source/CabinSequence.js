//============================================================================================================================================
//                                                             CABINSEQUENCE.JS
//============================================================================================================================================
// 🧩 The cabin's live surfaces: the TabletPanel HMI and cluster as textures, the mirrors' reflected views, the Garage's car, the glass.

// 📝 Slate's HMI modules (Source/HMI, commit 3c987f33c71c2477bd73ca29c69d5bd0ee484d1a) provide the launcher,
//    cluster, applications and iconography. Their 2D canvases are uploaded only when dirty; CabinProjection maps them
//    onto Slate's physical steering-wheel binnacle and centre-stack tablet. Frontier keeps its Garage material preview,
//    live tyre/vehicle telemetry, mirror views and touch routing. Tablet rays map through the same HMI-only scale as the
//    display quads, so resizing the display never scales the wheel, seats, dashboard or seated camera.
//
//    The Garage application shows the car. The prototype rendered a three.js model into 640 × 400 and read it back;
//    here the exhibit's own facets are drawn by ForwardRaster.wgsl's studio mode into a texture the overlay composites
//    into the preview well (no read-back, the same car — popped tyres, derez and all), orbiting on its turntable.
//
//    Mirrors: the driver's eye reflected in each mirror's plane, through an off-axis frustum fitted to its glass
//    (Kooima's generalised perspective projection), its near plane on the glass. One mirror is re-rendered per frame
//    while the mirrors can be seen (an interior camera, or the chase camera within 14 m), so each refreshes at 20 Hz.

import { CabinLayout, ClusterHexagon, ExtractGlassFacets, ResolveCockpitFrame, PlaceSeatedEye, PlaceCockpitFixture, SeatHipPoints } from "./CabinStructure.js";
import { CourseMaterial } from "./MaterialSpecification.js";
import { VertexStride } from "./FacetStructure.js";
import { TransformPoint, TransformDirection, MultiplyTransform, ConstructViewTransform, SubtractVector, AddVector, ScaleVector,
         DotVector, CrossVector, NormalizeVector, LengthVector } from "./TransformProjection.js";

const OverlayFloats  = 10;                  // position xyz, kind (u32), normal xyz, layer, uv
const ViewStride     = 256;                 // [B] dynamic-offset alignment
const MirrorExtent   = [352, 192];          // [px]
const PreviewExtent  = [1024, 640];         // [px] the 640 × 400 well at the panel's 1.6×
const TabletPixels   = [1920, 1200];        // [px] 1200 × 750 at 1.6×
const ClusterPixels  = [1500, 838];         // [px] the hexagon's canvas: 1000 × 559 logical at 1.5× (ClusterSequence)
const KindGlass = 0, KindTablet = 1, KindCluster = 2, KindMirror = 3;

export const CabinSettingsDefaults = Object.freeze({
    SeeThroughGlass: true,     // glazing see-through (cabin visible from outside, the world from inside)
    Screens:         true,     // HMI tablet and cluster live
    Mirrors:         1,        // 0 off, 1 when visible, 2 always
    Brightness:      1.0,      // [-] screen brightness
    GlassTransmission: 0.72    // [-] at normal incidence
});

export class CabinSequence
{
    constructor(Exchange, Shaders)
    {
        this.Exchange = Exchange;
        this.Shaders  = Shaders;
        this.Settings = { ...CabinSettingsDefaults };
        this.Layout   = CabinLayout;
        this.Cockpit  = ResolveCockpitFrame();   // the cockpit's scale and offset (the host refreshes it every frame)
        this.Clock    = 0.0;
        this.MirrorCursor = 0;
        this.MirrorsRendered = 0;
        this.Preview  = { External: true, Loaded: true, Facets: 0, Spin: true, Dirty: true, Yaw: 0.6, Pitch: 0.2,
                          DisplayMode: "solid", MaterialTarget: "body", Finish: "gloss", FinishColour: "#c1cf00", ApplyMaterial: null,
                          Orbit: (Yaw, Pitch) => { this.Preview.Yaw += Yaw; this.Preview.Pitch = Math.max(-0.1, Math.min(0.9, this.Preview.Pitch + Pitch)); } };
        this.Metrics  = { TabletUploads: 0, ClusterUploads: 0, MirrorPasses: 0, PreviewPasses: 0, Hmi: "starting" };
        this.LiveRevision = -1;
        this.PumpedPressure = null;
        this.HmiProjection = null;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  BRING-UP
    //--------------------------------------------------------------------------------------------------------------------

    async ConstructResources({ FrameRecords, OccupantRecords, MaterialRecords, EffectRecords, VehicleRecords, Shadow, Atmosphere, Scene })
    {
        const Exchange = this.Exchange;
        const Device = Exchange.Device;
        this.Scene = Scene;
        this.Preview.Facets = Scene.FacetSets[Scene.VehicleBodySet].Facets.length
                            + 4 * Scene.FacetSets[Scene.Occupants[Scene.VehicleOccupants.Wheels[0]].FacetSet].Facets.length;
        const Wireframe = this.ConstructVehicleWireframe(Scene);
        this.WireRuns = Wireframe.Runs;
        this.WireVertexRecords = Exchange.ConstructRecordsFrom(Wireframe.Records, GPUBufferUsage.VERTEX, "Vehicle wireframe vertices");

        // ① overlay geometry, car-body frame
        const Vertices = [];
        const Push = (Position, Kind, Normal, Layer, U, V) => Vertices.push(...Position, Kind, ...Normal, Layer, U, V);
        for (const Facet of ExtractGlassFacets(Scene.FacetSets[Scene.VehicleBodySet].Facets))
        {
            const [A, B, C] = Facet.Corners;
            const Normal = NormalizeVector(CrossVector(SubtractVector(B, A), SubtractVector(C, A)));
            for (const Corner of Facet.Corners)
                Push(Corner, KindGlass, Normal, 0, 0, 0);
        }
        const VertexCount = () => Vertices.length / OverlayFloats;
        this.OverlayRanges = { Glass: { First: 0, Count: VertexCount() } };
        const Rectangle = (Fixture, Kind, Layer, Flip) =>
        {
            const Corner = (X, Y) => AddVector(AddVector(Fixture.Centre, ScaleVector(Fixture.Right, X * Fixture.Width * 0.5)), ScaleVector(Fixture.Up, Y * Fixture.Height * 0.5));
            const Coordinate = (X, Y) => [Flip ? 0.5 - 0.5 * X : 0.5 + 0.5 * X, 0.5 - 0.5 * Y];
            for (const [X, Y] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]])
                Push(Corner(X, Y), Kind, Fixture.Normal, Layer, ...Coordinate(X, Y));
        };
        Rectangle(this.Layout.Tablet, KindTablet, 0, false);
        this.OverlayRanges.Tablet = { First: this.OverlayRanges.Glass.Count, Count: VertexCount() - this.OverlayRanges.Glass.Count };
        const Cluster = this.Layout.Cluster;
        const Hexagon = ClusterHexagon.map(([X, Y]) => ({ X, Y, Position: AddVector(AddVector(Cluster.Centre, ScaleVector(Cluster.Right, X * Cluster.Width * 0.5)),
                                                                                    ScaleVector(Cluster.Up, Y * Cluster.Height * 0.5)) }));
        for (let Index = 1; Index < 5; ++Index)
            for (const Point of [Hexagon[0], Hexagon[Index], Hexagon[Index + 1]])
                Push(Point.Position, KindCluster, Cluster.Normal, 0, 0.5 + 0.5 * Point.X, 0.5 - 0.5 * Point.Y);
        this.OverlayRanges.Cluster = { First: this.OverlayRanges.Tablet.First + this.OverlayRanges.Tablet.Count,
                                       Count: VertexCount() - this.OverlayRanges.Tablet.First - this.OverlayRanges.Tablet.Count };
        this.OverlayRanges.Mirrors = { First: VertexCount(), Count: 0 };
        this.Layout.Mirrors.forEach((Mirror, Index) => Rectangle(Mirror, KindMirror, Index, true));
        this.OverlayRanges.Mirrors.Count = VertexCount() - this.OverlayRanges.Mirrors.First;
        const Bytes = new ArrayBuffer(Vertices.length * 4);
        const Scalars = new Float32Array(Bytes), Integers = new Uint32Array(Bytes);
        Vertices.forEach((Value, Index) => { if (Index % OverlayFloats === 3) Integers[Index] = Value; else Scalars[Index] = Value; });
        this.OverlayVertexCount = Vertices.length / OverlayFloats;
        this.OverlayRecords = Exchange.ConstructRecordsFrom(Scalars, GPUBufferUsage.VERTEX, "Cabin overlay vertices");
        this.OverlayUniform = Exchange.ConstructRecords(64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "Cabin overlay record");

        // ② textures: the two canvases, the preview, the mirrors
        const Texture = (Label, Size, Format, Usage, Layers = 1) => Exchange.ConstructTexture({ label: Label, size: [Size[0], Size[1], Layers], format: Format, usage: Usage });
        const CanvasUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT;
        this.TabletTexture  = Texture("Cabin tablet", TabletPixels, "rgba8unorm-srgb", CanvasUsage);
        this.ClusterTexture = Texture("Cabin cluster", ClusterPixels, "rgba8unorm-srgb", CanvasUsage);
        this.PreviewTexture = Texture("Garage preview", PreviewExtent, "rgba8unorm-srgb", GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT);
        this.PreviewDepth   = Texture("Garage preview depth", PreviewExtent, "depth32float", GPUTextureUsage.RENDER_ATTACHMENT);
        this.MirrorTexture  = Texture("Mirror views", MirrorExtent, "rgba16float", GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT, 3);
        this.MirrorDepth    = Texture("Mirror depth", MirrorExtent, "depth32float", GPUTextureUsage.RENDER_ATTACHMENT);
        this.MirrorLayers   = [0, 1, 2].map((Layer) => this.MirrorTexture.createView({ dimension: "2d", baseArrayLayer: Layer, arrayLayerCount: 1 }));
        this.LinearSampler  = Exchange.ConstructSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" });
        this.ClearCanvasTextures();

        // ③ the overlay pass
        const Stages = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
        this.OverlayLayout = Exchange.ConstructDescriptorLayout(["Uniform", "StorageRead", "Uniform", "Uniform", "StorageRead", "Texture2D", "Texture2D",
                                                                 "Texture2D", "Texture2DLayered", "Sampler", "Texture2D", "Sampler"], Stages, "Cabin overlay");
        this.OverlayGroup = Exchange.ConstructDescriptorGroup(this.OverlayLayout,
            [FrameRecords, OccupantRecords, this.OverlayUniform, EffectRecords, VehicleRecords, this.TabletTexture.createView(), this.ClusterTexture.createView(),
             this.PreviewTexture.createView(), this.MirrorTexture.createView({ dimension: "2d-array" }), this.LinearSampler, Atmosphere.SkyView, Atmosphere.SkySampler]);
        this.OverlayProgram = await this.Shaders.ConstructRasterProgram("CabinOverlay.wgsl", {
            VertexEntry: "OverlayVertex", FragmentEntry: "OverlayFragment",
            VertexLayouts: [{ arrayStride: OverlayFloats * 4, attributes: [
                { shaderLocation: 0, offset: 0,  format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "uint32" },
                { shaderLocation: 2, offset: 16, format: "float32x3" },
                { shaderLocation: 3, offset: 28, format: "float32" },
                { shaderLocation: 4, offset: 32, format: "float32x2" }] }],
            Primitive: { topology: "triangle-list", cullMode: "none" },
            DepthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "greater" },
            Targets: [{ format: "rgba16float", blend: { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                                                        alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" } } }]
        }, [this.OverlayLayout]);

        // ④ the forward views: mirrors (radiance) and the studio preview (display-referred)
        this.ViewRecords = Exchange.ConstructRecords(ViewStride * 4, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "Cabin views");
        this.ForwardLayout = Exchange.ConstructDescriptorLayout(["Uniform", "UniformDynamic", "StorageRead", "StorageRead", "StorageRead", "Uniform",
                                                                 "TextureDepth2DLayered", "SamplerComparison", "Uniform", "Texture2D", "Sampler"], Stages, "Forward views");
        this.ForwardGroup = Exchange.ConstructDescriptorGroup(this.ForwardLayout,
            [FrameRecords, { buffer: this.ViewRecords, offset: 0, size: 128 }, OccupantRecords, MaterialRecords, VehicleRecords, EffectRecords,
             Shadow.LayeredView, Shadow.ComparisonSampler, Shadow.ReceiverRecords, Atmosphere.SkyView, Atmosphere.SkySampler]);
        const ForwardDescriptor = (Format, Options = {}) => ({
            VertexEntry: "ForwardVertex", FragmentEntry: "ForwardFragment",
            VertexLayouts: [{ arrayStride: VertexStride, attributes: [
                { shaderLocation: 0, offset: 0,  format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "uint32" },
                { shaderLocation: 2, offset: 16, format: "float32x3" },
                { shaderLocation: 3, offset: 28, format: "uint32" }] }],
            Primitive: { topology: Options.Topology || "triangle-list", cullMode: "none" },
            DepthStencil: { format: "depth32float", depthWriteEnabled: Options.DepthWrite !== false,
                            depthCompare: Options.DepthCompare || "less" },
            Targets: [{ format: Format, ...(Options.Blend ? { blend: {
                color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
            } } : {}) }]
        });
        this.MirrorProgram  = await this.Shaders.ConstructRasterProgram("ForwardRaster.wgsl", ForwardDescriptor("rgba16float"), [this.ForwardLayout]);
        this.PreviewProgram = await this.Shaders.ConstructRasterProgram("ForwardRaster.wgsl", ForwardDescriptor("rgba8unorm-srgb"), [this.ForwardLayout]);
        this.GhostPreviewProgram = await this.Shaders.ConstructRasterProgram("ForwardRaster.wgsl",
            ForwardDescriptor("rgba8unorm-srgb", { DepthWrite: false, DepthCompare: "less-equal", Blend: true }), [this.ForwardLayout]);
        this.WireProgram = await this.Shaders.ConstructRasterProgram("ForwardRaster.wgsl",
            ForwardDescriptor("rgba8unorm-srgb", { Topology: "line-list", DepthWrite: false, DepthCompare: "less-equal", Blend: true }),
            [this.ForwardLayout]);

        // ⑤ Slate's HMI assets with the local live-telemetry and Garage material/preview extensions. A headless host
        //    keeps the cleared textures and reports HMI unavailable rather than failing bring-up.
        await this.ConstructHmi().catch((Failure) => { this.Metrics.Hmi = `unavailable: ${Failure && Failure.message ? Failure.message : Failure}`; });
    }

    ClearCanvasTextures()
    {
        const Device = this.Exchange.Device;
        const Encoder = Device.createCommandEncoder({ label: "Cabin clear" });
        for (const [Texture, Colour] of [[this.TabletTexture, [0.004, 0.006, 0.007, 1]], [this.ClusterTexture, [0, 0, 0, 0]], [this.PreviewTexture, [0.01, 0.02, 0.022, 1]]])
        {
            const Pass = Encoder.beginRenderPass({ colorAttachments: [{ view: Texture.createView(), clearValue: Colour, loadOp: "clear", storeOp: "store" }] });
            Pass.end();
        }
        Device.queue.submit([Encoder.finish()]);
    }

    async ConstructHmi()
    {
        if (typeof document === "undefined" || typeof document.createElement !== "function" || typeof Image === "undefined")
            throw new Error("no 2D canvas in this host");
        const TabletCanvas = document.createElement("canvas");
        const ClusterCanvas = document.createElement("canvas");
        if (!TabletCanvas.getContext || !TabletCanvas.getContext("2d"))
            throw new Error("no 2D canvas in this host");
        const [{ ScreenSequence }, { ClusterSequence }, { Applications }, { ConstructIconImages }] = await Promise.all([
            import("./HMI/ScreenSequence.js"), import("./HMI/ClusterSequence.js"), import("./HMI/AppSpecification.js"), import("./HMI/IconDepot.js")]);
        if (document.fonts && document.fonts.load)
            await Promise.all([document.fonts.load('300 20px "DM Sans"'), document.fonts.load('400 20px "DM Sans"')]).catch(() => null);
        const Icons = await ConstructIconImages(Applications);
        this.Screen = new ScreenSequence(TabletCanvas, Icons, () => { this.Screen.Dirty = true; });
        this.Screen.Preview = this.Preview;
        this.Screen.PresentAspect(this.Layout.Tablet.Width / this.Layout.Tablet.Height);
        this.Cluster = new ClusterSequence(ClusterCanvas);
        this.Cluster.Demonstration = false;
        this.Metrics.Hmi = "live";
        if (this.PendingPressure !== undefined)
            this.AssignPressure(this.PendingPressure);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                    FRAME
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Live: { Speed [km/h], Revolutions, Gear, Temperatures [°C ×4], Pressures [kPa ×4], Tread [×4], States [×4] }.
    //    Returns a pressure [kPa] when the Tyres application's slider asks the tyres to be pumped.
    Advance(Seconds, Live)
    {
        this.Clock += Seconds;
        if (this.Preview.Spin)
            this.Preview.Yaw += 0.35 * Seconds;
        if (!this.Screen || !this.Settings.Screens)
            return null;
        const Device = this.Exchange.Device;
        const Screen = this.Screen;
        Screen.AdvanceClock();
        // 📝 The live applications redraw at 5 Hz; the rest of the panel only when touched.
        const Revision = Math.floor(this.Clock * 5.0);
        if (Revision !== this.LiveRevision)
        {
            this.LiveRevision = Revision;
            Screen.Live = Live;
            if (Screen.Application === "telemetry" || Screen.Application === "tyres")
                Screen.Dirty = true;
        }
        if (Screen.Application === "garage")
            Screen.Dirty = Screen.Dirty || false;
        if (Screen.RasterScreen())
        {
            Device.queue.copyExternalImageToTexture({ source: Screen.Canvas }, { texture: this.TabletTexture },
                                                    [Math.min(Screen.Canvas.width, TabletPixels[0]), Math.min(Screen.Canvas.height, TabletPixels[1])]);
            this.Metrics.TabletUploads++;
        }
        const Cluster = this.Cluster;
        const Speed = Math.round(Math.abs(Live.Speed)), Revolutions = Math.round(Live.Revolutions / 25) * 25;
        const Tyres = Live.Pressures.map((Pressure, Index) => ({ Pressure, Warning: Pressure < 150 || !!Live.States[Index] }));
        const TyreKey = Tyres.map((Tyre) => `${Math.round(Tyre.Pressure)}${Tyre.Warning ? "!" : ""}`).join(",");
        if (Speed !== Cluster.Speed || Math.abs(Revolutions - Cluster.Revolutions) > 40 || Live.Gear !== Cluster.Gear || TyreKey !== this.TyreKey)
        {
            Object.assign(Cluster, { Speed, Revolutions, Gear: Live.Gear, Tyres, Dirty: true });
            this.TyreKey = TyreKey;
        }
        if (Cluster.RasterCluster(this.Clock))
        {
            Device.queue.copyExternalImageToTexture({ source: Cluster.Canvas }, { texture: this.ClusterTexture },
                                                    [Math.min(Cluster.Canvas.width, ClusterPixels[0]), Math.min(Cluster.Canvas.height, ClusterPixels[1])]);
            this.ClusterHeightFraction = Math.min(1.0, Cluster.Canvas.height / ClusterPixels[1]);
            this.ClusterWidthFraction = Math.min(1.0, Cluster.Canvas.width / ClusterPixels[0]);
            this.Metrics.ClusterUploads++;
        }
        // 📝 The Tyres slider: a pressure set on the panel pumps every intact tyre.
        const Asked = Screen.Values.pressure;
        if (this.PumpedPressure === null)
            this.PumpedPressure = Asked;
        if (Asked !== this.PumpedPressure && !Screen.Pointer)
        {
            this.PumpedPressure = Asked;
            return Asked;
        }
        return null;
    }

    // 📝 The host's own pressure edits show on the panel's slider.
    AssignPressure(Kilopascals)
    {
        this.PendingPressure = Kilopascals;
        if (!this.Screen)
            return;
        const Clamped = Math.max(140, Math.min(240, Math.round(Kilopascals)));
        this.Screen.Values.pressure = Clamped;
        this.PumpedPressure = Clamped;
        this.Screen.Dirty = true;
    }

    // 📝 Mirrors and the studio preview. BodyTransform: the car's local → world; Visible: whether mirrors can be seen.
    RecordViews(Encoder, Scene, VertexRecords, BodyTransform, MirrorsVisible)
    {
        if (!this.MirrorProgram)
            return;
        const Mode = this.Settings.Mirrors;
        const Render = Mode === 2 || (Mode === 1 && MirrorsVisible);
        if (Render)
        {
            // 📝 All three on the first frame they are needed, then one per frame.
            const Mirrors = this.MirrorsRendered === 0 ? [0, 1, 2] : [this.MirrorCursor];
            this.MirrorCursor = (this.MirrorCursor + 1) % 3;
            for (const Index of Mirrors)
                this.RecordMirror(Encoder, Scene, VertexRecords, BodyTransform, Index);
            this.MirrorsRendered++;
        }
        else
            this.MirrorsRendered = 0;
        if (this.Screen && this.Settings.Screens && this.Screen.Application === "garage")
            this.RecordPreview(Encoder, Scene, VertexRecords, BodyTransform);
    }

    WriteView(Slot, ViewProjection, Camera, Mode, Lights = null)
    {
        const Scalars = new Float32Array(32);
        Scalars.set(ViewProjection, 0);
        Scalars.set([...Camera, Mode], 16);
        if (Lights)
        {
            Scalars.set(Lights[0], 20);
            Scalars.set(Lights[1], 24);
            Scalars.set(Lights[2], 28);
        }
        this.Exchange.Device.queue.writeBuffer(this.ViewRecords, Slot * ViewStride, Scalars);
    }

    // 📐 Kooima's generalised perspective: the eye, the screen's lower-left, lower-right and upper-left corners; the
    //    near plane on the screen itself; WebGPU depth [0, 1], standard (not reversed).
    static ResolveOffAxis(Eye, LowerLeft, LowerRight, UpperLeft, Far)
    {
        const Right = NormalizeVector(SubtractVector(LowerRight, LowerLeft));
        const Up = NormalizeVector(SubtractVector(UpperLeft, LowerLeft));
        const Toward = NormalizeVector(CrossVector(Right, Up));
        const A = SubtractVector(LowerLeft, Eye), B = SubtractVector(LowerRight, Eye), C = SubtractVector(UpperLeft, Eye);
        const Distance = -DotVector(A, Toward);
        // 📝 The near plane a centimetre past the screen (the mirror's glass and housing stay behind it).
        const Near = Math.max(Distance + 0.01, 1.0e-3);
        const Left = DotVector(Right, A) * Near / Distance, RightEdge = DotVector(Right, B) * Near / Distance;
        const Bottom = DotVector(Up, A) * Near / Distance, Top = DotVector(Up, C) * Near / Distance;
        const Projection = new Float32Array([
            2.0 * Near / (RightEdge - Left), 0, 0, 0,
            0, 2.0 * Near / (Top - Bottom), 0, 0,
            (RightEdge + Left) / (RightEdge - Left), (Top + Bottom) / (Top - Bottom), Far / (Near - Far), -1,
            0, 0, Near * Far / (Near - Far), 0]);
        const View = new Float32Array([
            Right[0], Up[0], Toward[0], 0,
            Right[1], Up[1], Toward[1], 0,
            Right[2], Up[2], Toward[2], 0,
            -DotVector(Right, Eye), -DotVector(Up, Eye), -DotVector(Toward, Eye), 1]);
        return MultiplyTransform(Projection, View);
    }

    RecordMirror(Encoder, Scene, VertexRecords, BodyTransform, Index)
    {
        const Mirror = this.Layout.Mirrors[Index];
        const World = (Point) => TransformPoint(BodyTransform, Point);
        const Direction = (Vector) => NormalizeVector(TransformDirection(BodyTransform, Vector));
        const Centre = World(Mirror.Centre), Right = Direction(Mirror.Right), Up = Direction(Mirror.Up), Normal = Direction(Mirror.Normal);
        // 📝 The mirrors are the shell's; the eye is the seated driver's, so it rides with the seat as the cockpit is sized.
        const Eye = World(PlaceSeatedEye(this.Layout.DriverEye.Position, SeatHipPoints.Driver, this.Cockpit));
        // 📝 The driver's eye reflected in the glass's plane; the glass seen from there, mirrored (its right is −Right).
        const Virtual = SubtractVector(Eye, ScaleVector(Normal, 2.0 * DotVector(SubtractVector(Eye, Centre), Normal)));
        const W = 0.5 * Mirror.Width, H = 0.5 * Mirror.Height;
        const Corner = (X, Y) => AddVector(AddVector(Centre, ScaleVector(Right, X * W)), ScaleVector(Up, Y * H));
        const ViewProjection = CabinSequence.ResolveOffAxis(Virtual, Corner(1, -1), Corner(-1, -1), Corner(1, 1), 600.0);
        this.WriteView(Index, ViewProjection, Virtual, 0.0);
        const Pass = Encoder.beginRenderPass({
            label: `Mirror ${Index}`,
            colorAttachments: [{ view: this.MirrorLayers[Index], clearValue: [0.3, 0.4, 0.55, 1], loadOp: "clear", storeOp: "store" }],
            depthStencilAttachment: { view: this.MirrorDepth.createView(), depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "discard" }
        });
        Pass.setPipeline(this.MirrorProgram);
        Pass.setBindGroup(0, this.ForwardGroup, [Index * ViewStride]);
        Pass.setVertexBuffer(0, VertexRecords);
        for (const Run of Scene.DrawRuns)
        {
            const Set = Scene.FacetSets[Run.FacetSet];
            Pass.draw(Set.VertexCount, Run.Count, Set.FirstVertex, Run.First);
        }
        Pass.end();
        this.Metrics.MirrorPasses++;
    }

    // 📝 One line-list record per triangle edge. Keeping the vehicle's five occupants separate lets the forward vertex
    //    stage reuse the exact body transform, steering and soft-tyre deformation used by the filled preview.
    ConstructVehicleWireframe(Scene)
    {
        const Vertices = [];
        const Runs = [];
        const Occupants = [Scene.VehicleOccupants.Body, ...Scene.VehicleOccupants.Wheels];
        const Edges = [[0, 1], [1, 2], [2, 0]];
        for (const Occupant of Occupants)
        {
            const Set = Scene.FacetSets[Scene.Occupants[Occupant].FacetSet];
            const First = Vertices.length / (VertexStride / 4);
            for (const Facet of Set.Facets)
            {
                const FaceNormal = NormalizeVector(CrossVector(SubtractVector(Facet.Corners[1], Facet.Corners[0]),
                                                               SubtractVector(Facet.Corners[2], Facet.Corners[0])));
                for (const [A, B] of Edges)
                {
                    for (const Corner of [A, B])
                    {
                        const Position = Facet.Corners[Corner];
                        const Normal = Facet.Normals ? Facet.Normals[Corner] : FaceNormal;
                        Vertices.push(Position[0], Position[1], Position[2], Facet.Family,
                                      Normal[0], Normal[1], Normal[2], 0);
                    }
                }
            }
            Runs.push({ Occupant, First, Count: Vertices.length / (VertexStride / 4) - First });
        }
        const Bytes = new ArrayBuffer(Vertices.length * 4);
        const Scalars = new Float32Array(Bytes), Integers = new Uint32Array(Bytes);
        for (let Index = 0; Index < Vertices.length; Index += VertexStride / 4)
        {
            Scalars.set(Vertices.slice(Index, Index + 3), Index);
            Integers[Index + 3] = Vertices[Index + 3];
            Scalars.set(Vertices.slice(Index + 4, Index + 7), Index + 4);
            Integers[Index + 7] = Vertices[Index + 7];
        }
        return { Records: Scalars, Runs };
    }

    // 📝 The Garage's studio: the same live car, with solid, transparent ghost and x-ray wireframe presentations.
    RecordPreview(Encoder, Scene, VertexRecords, BodyTransform)
    {
        const Centre = TransformPoint(BodyTransform, [0.0, 0.0, 0.15]);
        const Heading = Math.atan2(BodyTransform[1], BodyTransform[0]);
        const Yaw = Heading + Math.PI + this.Preview.Yaw, Pitch = this.Preview.Pitch, Distance = 8.2;
        const Eye = [Centre[0] + Distance * Math.cos(Pitch) * Math.cos(Yaw), Centre[1] + Distance * Math.cos(Pitch) * Math.sin(Yaw),
                     Centre[2] + Distance * Math.sin(Pitch)];
        const View = ConstructViewTransform(Eye, Centre);
        const Aspect = PreviewExtent[0] / PreviewExtent[1], Fov = 30.0 * Math.PI / 180.0, Near = 0.1, Far = 60.0;
        const F = 1.0 / Math.tan(0.5 * Fov);
        const Projection = new Float32Array([F / Aspect, 0, 0, 0, 0, F, 0, 0, 0, 0, Far / (Near - Far), -1, 0, 0, Near * Far / (Near - Far), 0]);
        const Back = NormalizeVector(SubtractVector(Eye, Centre));
        const Side = NormalizeVector(CrossVector([0.0, 0.0, 1.0], Back));
        const Key = NormalizeVector(AddVector(AddVector(ScaleVector(Side, 0.55), [0.0, 0.0, 0.8]), ScaleVector(Back, 0.45)));
        const Fill = NormalizeVector(AddVector(AddVector(ScaleVector(Side, -0.8), [0.0, 0.0, 0.3]), ScaleVector(Back, 0.5)));
        const Rim = NormalizeVector(AddVector(ScaleVector(Back, -0.9), [0.0, 0.0, 0.55]));
        const Mode = this.Preview.DisplayMode || "solid";
        const Ghost = Mode === "ghost", Wireframe = Mode === "wireframe";
        const RimControl = [...Rim, Ghost || Wireframe ? this.Clock : 2.4];
        this.WriteView(3, MultiplyTransform(Projection, View), Eye, Wireframe ? 3.0 : Ghost ? 2.0 : 1.0,
                       [[...Key, 3.2], [...Fill, 1.0], RimControl]);

        if (!Wireframe)
        {
            const Pass = Encoder.beginRenderPass({
                label: Ghost ? "Garage ghost preview" : "Garage preview",
                colorAttachments: [{ view: this.PreviewTexture.createView(), clearValue: [0.012, 0.022, 0.025, 1], loadOp: "clear", storeOp: "store" }],
                depthStencilAttachment: { view: this.PreviewDepth.createView(), depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store" }
            });
            Pass.setPipeline(Ghost ? this.GhostPreviewProgram : this.PreviewProgram);
            Pass.setBindGroup(0, this.ForwardGroup, [3 * ViewStride]);
            Pass.setVertexBuffer(0, VertexRecords);
            for (const Run of Scene.DrawRuns)
            {
                if (Run.First >= 5)
                    continue;
                const Set = Scene.FacetSets[Run.FacetSet];
                Pass.draw(Set.VertexCount, Run.Count, Set.FirstVertex, Run.First);
            }
            Pass.end();
        }

        if (Ghost || Wireframe)
        {
            const Pass = Encoder.beginRenderPass({
                label: Wireframe ? "Garage wireframe preview" : "Garage ghost edges",
                colorAttachments: [{ view: this.PreviewTexture.createView(), clearValue: [0.012, 0.022, 0.025, 1],
                                     loadOp: Wireframe ? "clear" : "load", storeOp: "store" }],
                depthStencilAttachment: { view: this.PreviewDepth.createView(), depthClearValue: 1.0,
                                          depthLoadOp: Wireframe ? "clear" : "load", depthStoreOp: "store" }
            });
            Pass.setPipeline(this.WireProgram);
            Pass.setBindGroup(0, this.ForwardGroup, [3 * ViewStride]);
            Pass.setVertexBuffer(0, this.WireVertexRecords);
            for (const Run of this.WireRuns)
                Pass.draw(Run.Count, 1, Run.First, Run.Occupant);
            Pass.end();
        }
        this.Preview.Dirty = false;
        this.Metrics.PreviewPasses++;
    }

    // 📝 Over the recombined radiance, before the antialiasing; the surface depth read only.
    RecordOverlay(Encoder, TargetView, DepthView, ExternalHmi = false)
    {
        if (!this.OverlayProgram)
            return;
        const Screen = this.Screen;
        const Garage = !!(Screen && this.Settings.Screens && Screen.Application === "garage");
        const PanelWidth = Screen ? Screen.PanelWidth : 1200, PanelHeight = Screen ? Screen.PanelHeight : 750;
        const OffsetAcross = Screen ? Screen.OffsetAcross : 0, OffsetDown = Screen ? Screen.OffsetDown : 0;
        const Well = [(78 + OffsetAcross) / PanelWidth, (248 + OffsetDown) / PanelHeight, (718 + OffsetAcross) / PanelWidth, (648 + OffsetDown) / PanelHeight];
        const Live = !!Screen && this.Settings.Screens;
        const Record = new Float32Array([
            this.Layout.Tablet.Luminance, Live ? this.Settings.Brightness : 0.0, Garage ? 1.0 : 0.0, 0.0,
            ...Well,
            22.0 / PanelWidth, 22.0 / PanelHeight, Live ? this.Layout.Cluster.Luminance : 0.0, 0.0,
            this.Settings.GlassTransmission, 0.82, this.MirrorsRendered > 0 ? 1.0 : 0.0, 0.0]);
        this.Exchange.Device.queue.writeBuffer(this.OverlayUniform, 0, Record);
        const Pass = Encoder.beginRenderPass({
            label: "Cabin overlay",
            colorAttachments: [{ view: TargetView, loadOp: "load", storeOp: "store" }],
            depthStencilAttachment: { view: DepthView, depthReadOnly: true }
        });
        Pass.setPipeline(this.OverlayProgram);
        Pass.setBindGroup(0, this.OverlayGroup);
        Pass.setVertexBuffer(0, this.OverlayRecords);
        if (ExternalHmi)
        {
            const Glass = this.OverlayRanges.Glass, Mirrors = this.OverlayRanges.Mirrors;
            if (Glass.Count > 0) Pass.draw(Glass.Count, 1, Glass.First);
            if (Mirrors.Count > 0) Pass.draw(Mirrors.Count, 1, Mirrors.First);
        }
        else
            Pass.draw(this.OverlayVertexCount);
        Pass.end();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                    TOUCH
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 A world ray against the tablet's glass: the panel fraction (Across, Down ∈ [0, 1]) or null.
    QueryTabletHit(Origin, Direction, BodyTransform)
    {
        if (this.HmiProjection)
            return this.HmiProjection.QueryTabletHit(Origin, Direction);
        const Tablet = PlaceCockpitFixture(this.Layout.Tablet, this.Cockpit);
        const Centre = TransformPoint(BodyTransform, Tablet.Centre);
        const Normal = NormalizeVector(TransformDirection(BodyTransform, Tablet.Normal));
        const Right = NormalizeVector(TransformDirection(BodyTransform, Tablet.Right));
        const Up = NormalizeVector(TransformDirection(BodyTransform, Tablet.Up));
        const Facing = DotVector(Direction, Normal);
        if (Math.abs(Facing) < 1.0e-4)
            return null;
        const Travel = DotVector(SubtractVector(Centre, Origin), Normal) / Facing;
        if (Travel <= 0.0 || Travel > 4.0)
            return null;
        const Hit = AddVector(Origin, ScaleVector(Direction, Travel));
        const Local = SubtractVector(Hit, Centre);
        const Across = 0.5 + DotVector(Local, Right) / Tablet.Width, Down = 0.5 - DotVector(Local, Up) / Tablet.Height;
        return Across >= 0.0 && Across <= 1.0 && Down >= 0.0 && Down <= 1.0 ? { Across, Down } : null;
    }

    // 📝 Phase: "hover" | "down" | "move" | "up" | "cancel"; the fractions go through the panel's own mapping.
    ForwardPointer(Phase, Across, Down)
    {
        if (!this.Screen)
            return false;
        const Point = this.Screen.QueryPanelPoint(Across, Down);
        return this.Screen.ForwardPointer(Phase, Point.Across, Point.Down);
    }

    QueryReadout()
    {
        const Screen = this.Screen;
        return [`HMI ${this.Metrics.Hmi}${Screen ? ` · ${Screen.Design}${Screen.Application ? ` › ${Screen.Application}` : ""}` : ""}`
                + ` · tablet uploads ${this.Metrics.TabletUploads} · cluster ${this.Metrics.ClusterUploads}`,
                `mirror passes ${this.Metrics.MirrorPasses} · garage previews ${this.Metrics.PreviewPasses} · glass ${this.Settings.SeeThroughGlass ? "see-through" : "opaque"}`];
    }
}

export { KindGlass, KindTablet, KindCluster, KindMirror, CourseMaterial };
