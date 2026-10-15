//============================================================================================================================================
//                                                           ILLUMINATIONHOST.JS
//============================================================================================================================================
// 🧩 Exhibit entry point: bring-up of every stage, then the frame — drive, invalidate, relight, gather, resolve, present.

import { DeviceExchange } from "./DeviceExchange.js";
import { ShaderInterchange } from "./ShaderInterchange.js";
import { SceneStructure, OccupantStride, GroundLayout } from "./FacetStructure.js";
import { ConstructMaterialSpecification, EncodeMaterialRecords } from "./MaterialSpecification.js";
import { OccupantDistanceSpace } from "./OccupantDistanceSpace.js";
import { SceneDistanceSpace, ResolveMovedBounds } from "./SceneDistanceSpace.js";
import { SurfaceCardDepot } from "./SurfaceCardDepot.js";
import { AtmosphereIntegrator } from "./AtmosphereIntegrator.js";
import { ShadowProjection } from "./ShadowProjection.js";
import { SurfaceProjection } from "./SurfaceProjection.js";
import { ResamplingSequence } from "./ResamplingSequence.js";
import { VarianceIntegrator } from "./VarianceIntegrator.js";
import { DisplayProjection } from "./DisplayProjection.js";
import { HardwareMetrics } from "./HardwareMetrics.js";
import { ControlPanel } from "./ControlPanel.js";
import { VehicleSolver } from "./VehicleSolver.js";
import { DriverInputIntegrator } from "./DriverInputIntegrator.js";
import { ChaseCameraSolver, FreeCameraSolver } from "./ChaseCameraSolver.js";
import { ConstructViewTransform, ConstructPerspectiveTransform, MultiplyTransform, InvertTransform, NormalizeVector,
         SubtractVector, MultiplyAddVector, ProjectRadicalInverse } from "./TransformProjection.js";

const ShaderSources = [
    "SceneRecords.wgsl", "FrameDescriptor.wgsl", "PackingCodec.wgsl", "DiscrepancySequence.wgsl", "SkyProjection.wgsl",
    "DistanceRecords.wgsl", "DistanceTraversal.wgsl", "DistanceTransfer.wgsl", "DistanceUnion.wgsl", "CardProjection.wgsl",
    "CardSampling.wgsl", "CardCapture.wgsl", "CardIrradiance.wgsl", "CardDirect.wgsl", "CardRadiosity.wgsl", "CardFinal.wgsl",
    "AtmosphereScattering.wgsl", "SurfaceReflectance.wgsl", "ShadowRaster.wgsl", "SurfaceRaster.wgsl", "DirectRadiance.wgsl",
    "ReservoirRecords.wgsl", "ReservoirTemporal.wgsl", "ReservoirSpatial.wgsl", "ReflectionTraversal.wgsl", "VarianceTemporal.wgsl",
    "VarianceWavelet.wgsl", "VarianceUpsample.wgsl", "InspectionMarch.wgsl", "DisplayRecombination.wgsl", "DisplayAntialias.wgsl",
    "DisplayExposure.wgsl", "DisplayPresent.wgsl"
];

// 📝 Quality grades trade cascade resolution, card density and traversal length; selected with ?quality=low|medium|high.
const QualityGrades = {
    high:   { ClipResolution: 128, FinestVoxel: 0.125, CardExtent: 2048, CardDensity: 1.0,  VoxelScale: 1.0, ShadowExtent: 2048,
              Steps: 96, RenderScale: 1.0,  TileBudget: 2048, PixelLimit: 1920 * 1080 },
    medium: { ClipResolution: 96,  FinestVoxel: 0.16,  CardExtent: 2048, CardDensity: 0.75, VoxelScale: 1.4, ShadowExtent: 2048,
              Steps: 80, RenderScale: 0.85, TileBudget: 1024, PixelLimit: 1600 * 900 },
    low:    { ClipResolution: 64,  FinestVoxel: 0.25,  CardExtent: 1024, CardDensity: 0.5,  VoxelScale: 2.2, ShadowExtent: 1024,
              Steps: 64, RenderScale: 0.6,  TileBudget: 384,  PixelLimit: 1280 * 720 }
};

const FeatureBits = { Indirect: 1, TemporalReuse: 2, SpatialReuse: 4, VisibilityReuse: 8, VarianceKernel: 16, Reflection: 32,
                      CardRadiosity: 64, Antialias: 128, DirectShadow: 256, AutoExposure: 512, RadianceRefresh: 1024 };

const TemporalRestartBit = 2048;   // [-] FeatureTemporalRestart in SceneRecords.wgsl

const PassNames = ["Distance union", "Card lighting", "Shadow", "Surface", "Direct", "ReSTIR GI", "Diffuse reconstruction",
                   "Reflection", "Glossy reconstruction", "Resolve"];

//------------------------------------------------------------------------------------------------------------------------
//                                                       BRING-UP
//------------------------------------------------------------------------------------------------------------------------

class IlluminationHost
{
    constructor()
    {
        const Query = new URLSearchParams(location.search);
        this.GradeName = QualityGrades[Query.get("quality")] ? Query.get("quality") : "high";
        this.Grade = { ...QualityGrades[this.GradeName] };
        if (Query.has("scale"))
            this.Grade.RenderScale = Math.max(0.25, Math.min(2.0, Number(Query.get("scale"))));
        this.Settings = {
            Inspection: Number(Query.get("inspection") || 0), DistanceInspection: 1, InsetEnabled: true, SliceHeight: 0.6,
            SunElevation: 38.0, SunAzimuth: 145.0, SolarIlluminance: 12.0, SkyScale: 1.0, EmissionScale: 1.0,
            ExposureCompensation: 0.0, AutoExposure: true, DirectShadow: true,
            Indirect: true, TemporalReuse: true, SpatialReuse: true, VisibilityReuse: true, RadianceRefresh: true,
            SpatialCount: 5, SpatialRadius: 20, TemporalTallyLimit: 20, IndirectScale: 1.0, VarianceKernel: true, Reflection: true,
            Antialias: true, TraceScale: 2, FreezeDistance: false, CardRadiosity: true, CardTileBudget: this.Grade.TileBudget,
            Quality: ["low", "medium", "high"].indexOf(this.GradeName)
        };
        if (Query.has("preset"))
            this.PendingPreset = Query.get("preset");
        this.Keys = new Set();
        this.FrameIndex = 0;
        this.FreeCamera = false;
        this.Ready = false;
        this.ScriptedInput = null;
        // 🔍 Diagnostic only: ?omit=Union,Cards,Shadow,... leaves the named stages out of the frame.
        this.Omitted = new Set((Query.get("omit") || "").split(",").filter((Name) => Name.length > 0));
        // 🔍 Diagnostic only: ?capture=1 presents into an offscreen texture read back into a 2D canvas, for hosts
        //    (headless software adapters) whose WebGPU canvas presentation is unavailable.
        this.Capture = Query.get("capture") === "1";
    }

    ReportProgress(Caption, Fraction)
    {
        if (this.LastCaption !== Caption)
            console.info(`[bring-up] ${(performance.now() / 1000).toFixed(2)} s · ${Caption}`);
        this.LastCaption = Caption;
        const Overlay = document.getElementById("bring-up");
        if (!Overlay)
            return;
        Overlay.querySelector(".bring-up-caption").textContent = Caption;
        Overlay.querySelector(".bring-up-bar > div").style.width = `${Math.round(Math.min(1.0, Math.max(0.0, Fraction)) * 100)}%`;
    }

    async ConstructExhibit()
    {
        this.ReportProgress("Negotiating the WebGPU device", 0.02);
        this.Exchange = new DeviceExchange();
        const Device = await this.Exchange.ConstructDevice();
        this.Exchange.ErrorListeners.push((Message) => this.ReportFailure(Message, false));
        this.Canvas = document.getElementById("viewport");
        if (this.Capture)
        {
            this.Exchange.CanvasFormat = "rgba8unorm";
        }
        else
        {
            this.Context = this.Canvas.getContext("webgpu");
            this.Context.configure({ device: Device, format: this.Exchange.CanvasFormat, alphaMode: "opaque",
                                     viewFormats: [`${this.Exchange.CanvasFormat}-srgb`] });
        }

        this.ReportProgress("Retrieving shaders and the ControlVehicle archives", 0.05);
        this.Shaders = new ShaderInterchange(this.Exchange, "Shader");
        await this.Shaders.RetrieveSources(ShaderSources);
        this.Scene = new SceneStructure();
        await this.Scene.ConstructScene("Archive");
        this.Vehicle = new VehicleSolver(this.Scene.QueryObstacleBounds());
        this.PositionVehicle();
        this.Scene.RetainOccupantTransform(this.Scene.VehicleOccupants.Body);
        for (const Wheel of this.Scene.VehicleOccupants.Wheels)
            this.Scene.RetainOccupantTransform(Wheel);

        // ① records every stage shares
        const Materials = ConstructMaterialSpecification();
        this.VertexRecords   = this.Exchange.ConstructRecordsFrom(this.Scene.EncodeVertexRecords(), GPUBufferUsage.VERTEX, "Facet vertices");
        this.MaterialRecords = this.Exchange.ConstructRecordsFrom(EncodeMaterialRecords(Materials), GPUBufferUsage.STORAGE, "Materials");
        this.FrameRecords    = this.Exchange.ConstructRecords(480, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "Frame record");
        this.OccupantRecords = this.Exchange.ConstructRecords(this.Scene.Occupants.length * OccupantStride,
                                                              GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, "Occupant records");

        // ② per-occupant distance volumes (the analogue of mesh distance fields), transferred on the device
        this.Volumes = new OccupantDistanceSpace(this.Exchange, this.Shaders);
        await this.Volumes.ConstructVolumes(this.Scene, this.Grade.VoxelScale, (Caption, Fraction) => this.ReportProgress(Caption, 0.08 + 0.55 * Fraction));

        // ③ surface cards, then the occupant records that reference volumes and cards
        this.ReportProgress("Allocating surface cards", 0.66);
        this.Cards = new SurfaceCardDepot(this.Exchange, this.Shaders, { Extent: this.Grade.CardExtent, DensityScale: this.Grade.CardDensity });
        this.Cards.AllocateCards(this.Scene);
        if (new URLSearchParams(location.search).has("warm"))
            this.Cards.WarmFrames = Number(new URLSearchParams(location.search).get("warm"));
        Device.queue.writeBuffer(this.OccupantRecords, 0, this.Scene.EncodeOccupantRecords(this.Volumes));
        this.Constants = {
            MaximumTraversalSteps: { Type: "u32", Value: this.Grade.Steps },
            GroundPadMinimum:      { Type: "f32", Value: GroundLayout.PadMinimum },
            GroundTileExtent:      { Type: "f32", Value: GroundLayout.TileExtent },
            GroundTileCount:       { Type: "u32", Value: GroundLayout.TileCount },
            GroundFirstCard:       { Type: "u32", Value: this.Cards.GroundFirstCard },
            GroundStripCard:       { Type: "u32", Value: this.Cards.GroundStripCard }
        };
        const InheritedConstruct = this.Shaders.ConstructModule.bind(this.Shaders);
        this.Shaders.ConstructModule = (FileName, Constants = {}, Label = FileName) => InheritedConstruct(FileName, { ...this.Constants, ...Constants }, Label);

        // ④ the scene distance field
        this.ReportProgress("Building the scene distance field cascades", 0.70);
        this.Distance = new SceneDistanceSpace(this.Exchange, this.Shaders, { ClipCount: 4, Resolution: this.Grade.ClipResolution,
                                                                             FinestVoxel: this.Grade.FinestVoxel, BandVoxels: 6, HitFraction: 0.2 });
        await this.Distance.ConstructResources(this.Volumes.TextureView, this.OccupantRecords);

        // ⑤ every remaining stage
        this.ReportProgress("Compiling lighting programs", 0.76);
        this.Atmosphere = new AtmosphereIntegrator(this.Exchange, this.Shaders);
        await this.Atmosphere.ConstructResources();
        this.Shadow = new ShadowProjection(this.Exchange, this.Shaders, this.Grade.ShadowExtent);
        await this.Shadow.ConstructResources(this.OccupantRecords);
        await this.Cards.ConstructResources(this.FrameRecords, this.OccupantRecords, this.MaterialRecords, this.Distance.TraversalLayout);
        this.SamplingGroup = this.Cards.ConstructSamplingGroup(this.OccupantRecords, this.Atmosphere.SkyView, this.Atmosphere.SkySampler);
        this.ReportProgress("Compiling surface and resampling programs", 0.84);
        this.Surface = new SurfaceProjection(this.Exchange, this.Shaders);
        await this.Surface.ConstructPrograms(this.FrameRecords, this.OccupantRecords, this.MaterialRecords);
        this.Resampling = new ResamplingSequence(this.Exchange, this.Shaders);
        await this.Resampling.ConstructPrograms(this.FrameRecords, this.MaterialRecords, this.Distance.TraversalLayout, this.Cards.SamplingLayout);
        this.Diffuse = new VarianceIntegrator(this.Exchange, this.Shaders, "Diffuse", { MinimumWeight: 0.08, TallyLimit: 24, WaveletIterations: 3, ColourSigma: 4.0 });
        await this.Diffuse.ConstructPrograms(this.FrameRecords);
        this.Glossy = new VarianceIntegrator(this.Exchange, this.Shaders, "Glossy", { MinimumWeight: 0.12, TallyLimit: 12, WaveletIterations: 2, ColourSigma: 3.0 });
        await this.Glossy.ConstructPrograms(this.FrameRecords);
        this.Display = new DisplayProjection(this.Exchange, this.Shaders);
        await this.Display.ConstructPrograms(this.FrameRecords, this.MaterialRecords, this.Distance.TraversalLayout, this.Cards.SamplingLayout);
        this.Metrics = new HardwareMetrics(this.Exchange, PassNames);

        this.ReportProgress("Capturing surface cards", 0.94);
        this.Cards.CaptureCards(this.Scene, this.VertexRecords);
        this.Driver = new DriverInputIntegrator();
        this.Chase = new ChaseCameraSolver();
        this.Flight = new FreeCameraSolver();
        this.ConstructPanel();
        this.ConstructInput();
        this.ReconstructScreenTargets();
        await Device.queue.onSubmittedWorkDone();
        this.ReportProgress("Ready", 1.0);
        document.getElementById("bring-up").classList.add("hidden");
        this.Ready = true;
        this.LastTime = performance.now();
        window.IlluminationExhibit = this;
        requestAnimationFrame((Now) => this.AdvanceFrame(Now));
    }

    ConstructPanel()
    {
        this.Panel = new ControlPanel(document.getElementById("panel-body"), document.getElementById("hud"), this.Settings, (Key) =>
        {
            if (Key === "ToggleCamera")
                this.ToggleCamera();
            else if (Key === "Respawn")
                this.RespawnVehicle();
            else if (Key === "TraceScale")
                this.ReconstructScreenTargets();
            else if (Key === "FreezeDistance")
                this.Distance.Frozen = this.Settings.FreezeDistance;
            else if (Key === "Quality")
            {
                const Query = new URLSearchParams(location.search);
                Query.set("quality", ["low", "medium", "high"][this.Settings.Quality]);
                location.search = Query.toString();
            }
        });
        document.getElementById("adapter").textContent = `${this.Exchange.QueryAdapterDescription()} · quality ${this.GradeName}`;
        if (this.PendingPreset)
            this.Panel.ApplyPreset(this.PendingPreset);
    }

    ConstructInput()
    {
        window.addEventListener("keydown", (Event) =>
        {
            if (Event.target instanceof HTMLInputElement || Event.target instanceof HTMLSelectElement)
                return;
            if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "F8"].includes(Event.code))
                Event.preventDefault();
            if (Event.code === "F8" || (Event.code === "KeyF" && !Event.repeat))
                this.ToggleCamera();
            if (Event.code === "KeyR" && !Event.repeat)
                this.RespawnVehicle();
            this.Keys.add(Event.code);
        });
        window.addEventListener("keyup", (Event) => this.Keys.delete(Event.code));
        window.addEventListener("blur", () => this.Keys.clear());
        let Dragging = false, LastX = 0, LastY = 0;
        this.Canvas.addEventListener("pointerdown", (Event) =>
        {
            Dragging = true;
            LastX = Event.clientX;
            LastY = Event.clientY;
            this.Canvas.setPointerCapture(Event.pointerId);
            if (document.activeElement instanceof HTMLElement)
                document.activeElement.blur();
        });
        this.Canvas.addEventListener("pointerup", () => { Dragging = false; });
        this.Canvas.addEventListener("pointermove", (Event) =>
        {
            if (!Dragging)
                return;
            const DeltaX = Event.clientX - LastX, DeltaY = Event.clientY - LastY;
            LastX = Event.clientX;
            LastY = Event.clientY;
            if (this.FreeCamera)
            {
                this.Flight.Yaw -= DeltaX * 0.004;
                this.Flight.Pitch = Math.max(-1.5, Math.min(1.5, this.Flight.Pitch - DeltaY * 0.004));
            }
            else
            {
                this.Chase.OrbitYaw -= DeltaX * 0.006;
                this.Chase.OrbitPitch = Math.max(-0.25, Math.min(1.2, this.Chase.OrbitPitch + DeltaY * 0.004));
            }
        });
        this.Canvas.addEventListener("wheel", (Event) =>
        {
            Event.preventDefault();
            this.Chase.OrbitScale = Math.max(0.5, Math.min(3.0, this.Chase.OrbitScale * Math.exp(Event.deltaY * 0.001)));
        }, { passive: false });
        new ResizeObserver(() => this.ReconstructScreenTargets()).observe(this.Canvas);
    }

    ToggleCamera()
    {
        this.FreeCamera = !this.FreeCamera;
        if (this.FreeCamera)
            this.Flight.AssignFromChase(this.Chase.Eye, this.Chase.Target);
        this.Panel.AssignCameraMode(this.FreeCamera);
    }

    RespawnVehicle()
    {
        this.Vehicle.Respawn();
        this.Driver.Reset();
        this.Chase.Seeded = false;
        this.PriorValid = false;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                SCREEN TARGETS
    //--------------------------------------------------------------------------------------------------------------------

    ReconstructScreenTargets()
    {
        if (!this.Surface)
            return;
        let Ratio = Math.min(window.devicePixelRatio || 1.0, 2.0) * this.Grade.RenderScale;
        const Pixels = this.Canvas.clientWidth * this.Canvas.clientHeight * Ratio * Ratio;
        if (Pixels > this.Grade.PixelLimit)
            Ratio *= Math.sqrt(this.Grade.PixelLimit / Pixels);
        const Width  = Math.max(64, Math.floor(this.Canvas.clientWidth * Ratio));
        const Height = Math.max(64, Math.floor(this.Canvas.clientHeight * Ratio));
        const Scale = this.Settings.TraceScale;
        if (this.ScreenExtent && this.ScreenExtent[0] === Width && this.ScreenExtent[1] === Height && this.TraceScaleUsed === Scale)
            return;
        this.Canvas.width = Width;
        this.Canvas.height = Height;
        this.ScreenExtent = [Width, Height];
        this.TraceScaleUsed = Scale;
        this.TraceExtent = [Math.ceil(Width / Scale), Math.ceil(Height / Scale)];
        this.Surface.ConstructTargets(Width, Height, this.Shadow, this.Atmosphere);
        this.Resampling.ConstructTargets(this.TraceExtent, this.Surface);
        this.Diffuse.ConstructTargets(this.TraceExtent, this.ScreenExtent, this.Surface,
                                      [this.Resampling.Views.Irradiance, this.Resampling.Views.Irradiance], this.Resampling.Views.Guides);
        this.Glossy.ConstructTargets(this.TraceExtent, this.ScreenExtent, this.Surface,
                                     [this.Resampling.Views.Reflection, this.Resampling.Views.Reflection], this.Resampling.Views.Guides);
        this.Display.ConstructTargets(this.ScreenExtent, this.Surface, this.Resampling, this.Diffuse, this.Glossy, this.Cards);
        this.PriorValid = false;
        if (this.Capture)
        {
            if (this.CaptureTexture)
                this.CaptureTexture.destroy();
            this.CaptureTexture = this.Exchange.ConstructTexture({ label: "Capture", size: [Width, Height], format: "rgba8unorm",
                                                                   usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
                                                                   viewFormats: ["rgba8unorm-srgb"] });
            this.CaptureView = this.CaptureTexture.createView({ format: "rgba8unorm-srgb" });
            this.CaptureStride = Math.ceil(Width * 4 / 256) * 256;
            this.CaptureRecords = this.Exchange.ConstructRecords(this.CaptureStride * Height, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, "Capture readback");
            this.CapturePending = false;
        }
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                    FRAME
    //--------------------------------------------------------------------------------------------------------------------

    PositionVehicle()
    {
        const Body = this.Vehicle ? this.Vehicle.QueryBodyTransform() : null;
        if (!Body)
            return;
        this.Scene.AssignOccupantTransform(this.Scene.VehicleOccupants.Body, Body);
        for (let Wheel = 0; Wheel < 4; ++Wheel)
            this.Scene.AssignOccupantTransform(this.Scene.VehicleOccupants.Wheels[Wheel], this.Vehicle.QueryWheelTransform(Wheel));
    }

    ResolveCamera(Δτ)
    {
        const Telemetry = this.Vehicle.QueryTelemetry();
        this.Chase.AdvanceChase(this.Vehicle.Position, this.Vehicle.QueryForward(), Telemetry.Speed, Δτ);
        let Eye, Target, FieldOfView;
        if (this.FreeCamera)
        {
            this.Flight.AdvanceFlight(this.Keys, Δτ);
            Eye = this.Flight.Eye;
            Target = MultiplyAddVector(Eye, this.Flight.ResolveForward(), 10.0);
            FieldOfView = this.Flight.FieldOfView;
        }
        else
        {
            Eye = this.Chase.Eye;
            Target = this.Chase.Target;
            FieldOfView = this.Chase.FieldOfView;
        }
        const Forward = NormalizeVector(SubtractVector(Target, Eye));
        return { Position: Eye, Target, Forward, VerticalFieldOfView: FieldOfView * Math.PI / 180.0,
                 Aspect: this.ScreenExtent[0] / this.ScreenExtent[1], Near: 0.05 };
    }

    EncodeFrameRecord(Camera, Light)
    {
        const [Width, Height] = this.ScreenExtent;
        const Jittered = this.Settings.Antialias;
        const Sequence = (this.FrameIndex % 16) + 1;
        const JitterX = Jittered ? (ProjectRadicalInverse(Sequence, 2) - 0.5) * 2.0 / Width : 0.0;
        const JitterY = Jittered ? (ProjectRadicalInverse(Sequence, 3) - 0.5) * 2.0 / Height : 0.0;
        const View = ConstructViewTransform(Camera.Position, Camera.Target);
        const Projection = ConstructPerspectiveTransform(Camera.VerticalFieldOfView, Camera.Aspect, Camera.Near, JitterX, JitterY);
        const Unjittered = MultiplyTransform(ConstructPerspectiveTransform(Camera.VerticalFieldOfView, Camera.Aspect, Camera.Near), View);
        const ViewProjection = MultiplyTransform(Projection, View);
        const Previous = this.PreviousUnjittered || Unjittered;
        this.PreviousUnjittered = Unjittered;

        const Bytes = new ArrayBuffer(480);
        const Scalars = new Float32Array(Bytes);
        const Integers = new Uint32Array(Bytes);
        Scalars.set(ViewProjection, 0);
        Scalars.set(InvertTransform(ViewProjection), 16);
        Scalars.set(Unjittered, 32);
        Scalars.set(Previous, 48);
        Scalars.set(View, 64);
        Scalars.set(Camera.Position, 80);
        Integers[83] = this.FrameIndex;
        Scalars.set(Light.Direction, 84);
        Scalars[87] = performance.now() * 0.001;
        Scalars.set(Light.Illuminance, 88);
        Scalars[91] = this.Settings.SkyScale;
        Scalars.set([Width, Height, 1.0 / Width, 1.0 / Height], 92);
        Scalars.set([this.TraceExtent[0], this.TraceExtent[1], 1.0 / this.TraceExtent[0], 1.0 / this.TraceExtent[1]], 96);
        Scalars.set([JitterX, JitterY], 100);
        Integers[102] = this.TraceScaleUsed;
        let Features = 0;
        for (const [Key, Bit] of Object.entries(FeatureBits))
            if (this.Settings[Key]) Features |= Bit;
        if (!this.PriorValid)
        {
            Features &= ~(FeatureBits.TemporalReuse);
            Features |= TemporalRestartBit;
        }
        Integers[103] = Features;
        Integers[104] = this.Settings.Inspection;
        Scalars[105] = this.Settings.TemporalTallyLimit;
        Scalars[106] = this.Settings.SpatialRadius;
        Integers[107] = this.Settings.SpatialCount;
        Scalars.set(Light.NightSky, 108);
        Scalars[111] = this.Settings.EmissionScale;
        Scalars[112] = this.Settings.SliceHeight;
        Scalars[113] = this.Settings.ExposureCompensation;
        Scalars[114] = this.Settings.IndirectScale;
        Integers[115] = this.Settings.DistanceInspection;
        Scalars.set(this.Focus, 116);
        Integers[119] = this.Settings.InsetEnabled ? 1 : 0;
        this.Exchange.Device.queue.writeBuffer(this.FrameRecords, 0, Bytes);
    }

    AdvanceFrame(Now)
    {
        if (this.Failed)
            return;
        // 📝 At most two frames in flight: without it a slow adapter queues work faster than it retires it and the
        //    controls lag by seconds. A swapchain throttles on its own; a capture target does not.
        if ((this.FramesInFlight || 0) >= 2)
        {
            requestAnimationFrame((Next) => this.AdvanceFrame(Next));
            return;
        }
        const Δτ = Math.min(0.1, Math.max(0.0, (Now - this.LastTime) * 0.001));
        this.LastTime = Now;
        this.FrameSeconds = (this.FrameSeconds || Δτ) * 0.9 + Δτ * 0.1;
        const Device = this.Exchange.Device;
        const Parity = this.FrameIndex & 1;

        // ① drive: keyboard (or a scripted command) through the input ramps into the vehicle solver
        const Keys = this.FreeCamera ? new Set(["Space"]) : this.Keys;
        const Command = this.ScriptedInput ? this.ScriptedInput : this.Driver.Advance(Keys, Δτ);
        this.Vehicle.Advance(Command, this.FixedStep ? this.FixedStep : Δτ);
        this.PositionVehicle();

        // ② camera, light, cascade focus
        const Camera = this.ResolveCamera(Δτ);
        this.Focus = MultiplyAddVector(Camera.Position, Camera.Forward, 0.45 * this.Grade.ClipResolution * this.Grade.FinestVoxel);
        const Light = this.Atmosphere.ResolveLight(this.Settings.SunElevation, this.Settings.SunAzimuth, this.Settings.SolarIlluminance);
        const Brightness = Light.Illuminance[0] + Light.Illuminance[1] + Light.Illuminance[2];
        if (this.PriorLight)
        {
            const Cosine = Light.Direction[0] * this.PriorLight.Direction[0] + Light.Direction[1] * this.PriorLight.Direction[1]
                         + Light.Direction[2] * this.PriorLight.Direction[2];
            const Ratio = Math.abs(Brightness - this.PriorLight.Brightness) / Math.max(Brightness, this.PriorLight.Brightness, 1.0e-4);
            if (Cosine < Math.cos(10.0 * Math.PI / 180.0) || Ratio > 0.3)
            {
                this.Cards.InvalidateLighting();
                this.PriorValid = false;
            }
        }
        this.PriorLight = { Direction: Light.Direction.slice(), Brightness };
        this.EncodeFrameRecord(Camera, Light);
        Device.queue.writeBuffer(this.OccupantRecords, 0, this.Scene.EncodeOccupantRecords(this.Volumes, this.Scene.DynamicCount));

        // ③ invalidation and relighting schedules
        this.Distance.ScheduleInvalidation(this.Focus, ResolveMovedBounds(this.Scene, this.Distance.Frozen));
        this.Cards.ScheduleTiles(this.Settings.CardTileBudget);
        this.Shadow.ResolveCascades(Camera, Light.Direction);

        // ④ record
        const Encoder = Device.createCommandEncoder({ label: `Frame ${this.FrameIndex}` });
        const Included = (Name) => !this.Omitted.has(Name);
        this.Atmosphere.RecordSkyView(Encoder, this.Settings.SolarIlluminance);
        if (Included("Union"))
            this.Distance.RecordUnion(Encoder, this.Scene.DistanceCount, this.FrameIndex, this.Metrics.QueryWrites("Distance union"));
        if (Included("Shadow"))
            this.Shadow.RecordCascades(Encoder, this.Scene, this.VertexRecords, this.Metrics.QueryWrites("Shadow"));
        if (Included("Cards"))
            this.Cards.RecordLighting(Encoder, this.Distance.TraversalGroup, this.SamplingGroup, this.Settings.CardRadiosity,
                                      this.Metrics.QueryWrites("Card lighting"));
        this.Surface.RecordSurface(Encoder, this.Scene, this.VertexRecords, this.Metrics.QueryWrites("Surface"));
        if (Included("Direct"))
            this.Surface.RecordDirect(Encoder, this.Metrics.QueryWrites("Direct"));
        if (this.Settings.Indirect && Included("Resampling"))
        {
            this.Resampling.RecordResampling(Encoder, Parity, this.Distance.TraversalGroup, this.SamplingGroup, this.Metrics.QueryWrites("ReSTIR GI"));
            if (Included("Diffuse"))
                this.Diffuse.Record(Encoder, Parity, this.Settings.VarianceKernel, this.Metrics.QueryWrites("Diffuse reconstruction"));
            if (this.Settings.Reflection && Included("Reflection"))
            {
                this.Resampling.RecordReflection(Encoder, this.Distance.TraversalGroup, this.SamplingGroup, this.Metrics.QueryWrites("Reflection"));
                this.Glossy.Record(Encoder, Parity, this.Settings.VarianceKernel, this.Metrics.QueryWrites("Glossy reconstruction"));
            }
        }
        if (this.Settings.Inspection === 6 && Included("Inspection"))
            this.Display.RecordInspection(Encoder, this.Distance.TraversalGroup, this.SamplingGroup);
        if (Included("Resolve"))
            this.Display.RecordResolve(Encoder, Parity, this.Metrics.QueryWrites("Resolve"));
        let CaptureReady = false;
        if (Included("Present"))
        {
            const Target = this.Capture ? this.CaptureView : this.Context.getCurrentTexture().createView({ format: `${this.Exchange.CanvasFormat}-srgb` });
            this.Display.RecordPresent(Encoder, Parity, Target, this.Distance.TraversalGroup);
            if (this.Capture && !this.CapturePending)
            {
                Encoder.copyTextureToBuffer({ texture: this.CaptureTexture }, { buffer: this.CaptureRecords, bytesPerRow: this.CaptureStride },
                                            [this.ScreenExtent[0], this.ScreenExtent[1]]);
                CaptureReady = true;
            }
        }
        const Timed = this.Metrics.RecordResolve(Encoder);
        Device.queue.submit([Encoder.finish()]);
        this.FramesInFlight = (this.FramesInFlight || 0) + 1;
        Device.queue.onSubmittedWorkDone().then(() => { this.FramesInFlight--; });
        if (Timed)
            this.Metrics.CollectDurations();
        if (CaptureReady)
            this.ProjectCapture(this.FrameIndex);
        this.PriorValid = true;

        this.PresentMeasurements(Now, Light);
        this.FrameIndex++;
        requestAnimationFrame((Next) => this.AdvanceFrame(Next));
    }

    // 🔍 Copies the read-back present target into the 2D capture canvas laid over the viewport.
    async ProjectCapture(CapturedFrame)
    {
        this.CapturePending = true;
        const [Width, Height] = this.ScreenExtent;
        const Records = this.CaptureRecords;
        await Records.mapAsync(GPUMapMode.READ);
        if (Records !== this.CaptureRecords)
            return;
        const Source = new Uint8Array(Records.getMappedRange());
        const Pixels = new Uint8ClampedArray(Width * Height * 4);
        for (let Row = 0; Row < Height; ++Row)
            Pixels.set(Source.subarray(Row * this.CaptureStride, Row * this.CaptureStride + Width * 4), Row * Width * 4);
        Records.unmap();
        const Canvas = document.getElementById("capture");
        Canvas.width = Width;
        Canvas.height = Height;
        Canvas.getContext("2d").putImageData(new ImageData(Pixels, Width, Height), 0, 0);
        this.CapturedFrame = CapturedFrame;
        this.CapturePending = false;
    }

    PresentMeasurements(Now, Light)
    {
        const Telemetry = this.Vehicle.QueryTelemetry();
        const Counts = this.Distance.FrameLevelCounts;
        const Rate = (1.0 / Math.max(this.FrameSeconds, 1.0e-4)).toFixed(0);
        const Screen = `${this.ScreenExtent[0]}×${this.ScreenExtent[1]}`;
        const Trace = `${this.TraceExtent[0]}×${this.TraceExtent[1]}`;
        const Speed = (Math.abs(Telemetry.Speed) * 3.6).toFixed(0).padStart(3);
        const Rewritten = Counts.map((Count, Level) => `C${Level}:${String(Count).padStart(4)}`).join("  ");
        const Lines = [
            `${Rate} fps · ${(this.FrameSeconds * 1000).toFixed(1)} ms · ${Screen} · trace ${Trace}`,
            `ControlVehicle  ${Speed} km/h · gear ${Telemetry.Gear} · ${Telemetry.EngineRPM.toFixed(0)} rpm · ${Telemetry.Contacts}/4 contact`,
            `GDF bricks rewritten  ${Rewritten}${this.Distance.Frozen ? "  (frozen)" : ""}`,
            `Card tiles relit  ${this.Cards.ScheduledTiles}`
        ];
        if (this.Metrics.Enabled)
        {
            const Durations = Object.entries(this.Metrics.Durations).filter(([, Milliseconds]) => Milliseconds > 0.0);
            Lines.push(...Durations.map(([Name, Milliseconds]) => `  ${Name.padEnd(24)}${Milliseconds.toFixed(2).padStart(7)} ms`));
        }
        Lines.push("W/S throttle·brake  A/D steer  Space handbrake  R respawn  F8 free camera  drag orbit");
        const Resolution = this.Grade.ClipResolution;
        const FieldLines = this.Distance.Clips.map((Clip, Level) =>
            `cascade ${Level}: ${Resolution}³ · voxel ${(Clip.VoxelExtent * 100).toFixed(1)} cm · span ${(Clip.VoxelExtent * Resolution).toFixed(0)} m`);
        FieldLines.push(`distance occupants: ${this.Scene.DistanceCount} · volumes: ${this.Volumes.Volumes.length}`);
        FieldLines.push(`bricks rewritten since start: ${this.Distance.TotalBricks}`);
        const Occupied = (this.Cards.OccupiedTexels / 1.0e6).toFixed(2);
        const DepotLines = [`cards: ${this.Cards.Cards.length} · texel space ${this.Grade.CardExtent}² · occupied ${Occupied} M`,
                            `tiles: ${this.Cards.DynamicTiles.length} moving (every frame) + ${this.Cards.StaticTiles.length} static`];
        this.Panel.PresentMeasurements(Now, Lines, FieldLines, DepotLines);
    }

    ReportFailure(Message, Fatal)
    {
        const Panel = document.getElementById("failure");
        Panel.classList.remove("hidden");
        const Line = document.createElement("div");
        Line.textContent = Message;
        Panel.appendChild(Line);
        if (Fatal)
            this.Failed = true;
    }
}

const Host = new IlluminationHost();
Host.ConstructExhibit().catch((Failure) =>
{
    console.error(Failure);
    Host.ReportFailure(String(Failure && Failure.message ? Failure.message : Failure), true);
    const Overlay = document.getElementById("bring-up");
    if (Overlay)
        Overlay.classList.add("hidden");
});
