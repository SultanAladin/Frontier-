//============================================================================================================================================
//                                                            TABLETSEQUENCE.JS
//============================================================================================================================================
// 📦 Shared-device prototype workflow: ray-to-UV touch input, independent camera views and a flat live screen texture.

import * as THREE from "three";
import { Applications, LauncherDesigns, ConstructDesignGlyph, ResolveDesign } from "./AppSpecification.js";
import { ConstructIconImages } from "./IconDepot.js";
import { ScreenSequence } from "./ScreenSequence.js";
import { ConstructTablet, ConstructCluster, DisplayDepth, TabletFamilies } from "./TabletStructure.js";
import { VehiclePreviewSequence } from "./VehiclePreviewSequence.js";
import { ClusterSequence, ClusterOutlines } from "./ClusterSequence.js";

async function ConstructExperience()
{
    await Promise.allSettled([document.fonts.load('400 24px "DM Sans"'), document.fonts.load('300 40px "DM Sans"')]);
    const Icons = await ConstructIconImages(Applications);
    const Canvas = document.getElementById("TabletCanvas");
    const Viewport = document.getElementById("Viewport");
    const Artwork = document.createElement("canvas");
    const ApplicationReading = document.getElementById("ApplicationReading");
    const ActiveScreen = new ScreenSequence(Artwork, Icons, () =>
    {
        ApplicationReading.textContent = ActiveScreen.Application ? Applications.find(Application => Application.Identifier === ActiveScreen.Application).Name + " · Local demo" : "12 apps · Touch-ready";
    });
    ActiveScreen.AdvanceClock();
    ActiveScreen.RasterScreen();
    const Renderer = new THREE.WebGLRenderer({ canvas: Canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    Renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    Renderer.outputColorSpace = THREE.SRGBColorSpace;
    Renderer.toneMapping = THREE.ACESFilmicToneMapping;
    Renderer.toneMappingExposure = 1.08;
    Renderer.shadowMap.enabled = true;
    Renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    Renderer.transmissionResolutionScale = 1;
    const Hardware = ConstructTablet(Renderer, Artwork);
    const Preview = new VehiclePreviewSequence(Renderer);
    ActiveScreen.Preview = Preview;
    Preview.Load(new URL("./ControlVehicle.glb", document.baseURI).href);
    const ClusterCanvas = document.createElement("canvas");
    const Cluster = new ClusterSequence(ClusterCanvas);
    const ClusterHardware = ConstructCluster(Hardware.Scene, Renderer, ClusterCanvas, Hardware.Materials);
    const Layout = { Family: "grand", Width: TabletFamilies.grand.Width, Height: TabletFamilies.grand.Height, Thickness: TabletFamilies.grand.Thickness, ClusterVisible: true };
    function ArrangeConsole()
    {
        // 📝 Console tablet below, cluster above and tilted toward the driver; the pair reframes whenever the car's dimensions change.
        const Outline = ClusterOutlines[Cluster.Outline];
        ClusterHardware.Build(Outline.Points(), Outline.Width, Outline.Height);
        ClusterHardware.Group.visible = Layout.ClusterVisible;
        ClusterHardware.Group.position.set(0, Layout.Height / 2 + 0.03 + Outline.Height / 2, -0.03);
        ClusterHardware.Group.rotation.x = -0.14;
        Hardware.Scene.updateMatrixWorld(true);
        Cluster.Dirty = true;
        SceneDirty = true;
        Renderer.shadowMap.needsUpdate = true;
    }
    function BuildConsole(Width, Height, Thickness, Family = "custom")
    {
        Layout.Width = Width; Layout.Height = Height; Layout.Thickness = Thickness; Layout.Family = Family;
        Hardware.BuildHardware(Width, Height, Thickness);
        Hardware.Hardware.Family = Family;
        const PreviousWidth = Artwork.width, PreviousHeight = Artwork.height;
        ActiveScreen.PresentAspect(Hardware.Hardware.DisplayWidth / Hardware.Hardware.DisplayHeight);
        // 📝 Canvas textures are allocated with immutable storage; a resized panel needs a fresh allocation, not a sub-upload.
        if (Artwork.width !== PreviousWidth || Artwork.height !== PreviousHeight) Hardware.DisplayTexture.dispose();
        Hardware.DisplayTexture.needsUpdate = true;
        Hardware.Cover.visible = document.getElementById("GlassEnabled").checked;
        document.getElementById("DimensionCaption").textContent = `${Math.round(Width * 1000)} × ${Math.round(Height * 1000)} mm · ${(Thickness * 1000).toFixed(0)} mm console · 2.4 mm cover glass`;
        for (const [Identifier, Value] of [["TabletWidth", Width], ["TabletHeight", Height], ["TabletThickness", Thickness]])
        {
            document.getElementById(Identifier).value = Math.round(Value * 1000);
            document.getElementById(Identifier + "Reading").textContent = Math.round(Value * 1000) + " mm";
        }
        for (const Button of document.querySelectorAll("[data-family]")) Button.setAttribute("aria-pressed", String(Button.dataset.family === Family));
        ArrangeConsole();
        ProjectCamera();
    }
    const Perspective = new THREE.PerspectiveCamera(35, 1, 0.01, 5);
    const Orthographic = new THREE.OrthographicCamera(-0.25, 0.25, 0.15, -0.15, 0.01, 5);
    const Raycaster = new THREE.Raycaster();
    const ContactPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -DisplayDepth);
    const CameraValues = { Mode: "3d", Yaw: -24, Pitch: 12, Zoom: 1 };
    let ActiveCamera = Perspective;
    let Gesture = null;
    let FrameCount = 0;
    let Disposed = false;
    let SceneDirty = true;
    let SceneWidth = 0, SceneHeight = 0;

    function ProjectCamera()
    {
        SceneDirty = true;
        const Aspect = SceneWidth / Math.max(1, SceneHeight);
        const WithCluster = Layout.ClusterVisible && CameraValues.Mode === "3d";
        const SceneExtentHeight = Layout.Height + (WithCluster ? 0.03 + ClusterOutlines[Cluster.Outline].Height : 0);
        const SceneExtentWidth = Math.max(Layout.Width, WithCluster ? ClusterOutlines[Cluster.Outline].Width : 0);
        const FrameHeight = Math.max(SceneExtentHeight * 1.18, SceneExtentWidth / Aspect * 1.24) / CameraValues.Zoom;
        // 📝 Frame the console and cluster together; the 2D view keeps the tablet screen alone so touch stays precise.
        const Focus = new THREE.Vector3(0, CameraValues.Mode === "3d" && Layout.ClusterVisible ? (0.03 + ClusterOutlines[Cluster.Outline].Height) / 2 : 0, 0);
        Perspective.aspect = Aspect;
        Perspective.updateProjectionMatrix();
        const Reach = FrameHeight / (2 * Math.tan(THREE.MathUtils.degToRad(Perspective.fov) / 2));
        if (CameraValues.Mode === "2d")
        {
            Orthographic.left = -FrameHeight * Aspect / 2;
            Orthographic.right = FrameHeight * Aspect / 2;
            Orthographic.top = FrameHeight / 2;
            Orthographic.bottom = -FrameHeight / 2;
            Orthographic.position.set(0, 0, Reach);
            Orthographic.lookAt(0, 0, 0);
            Orthographic.updateProjectionMatrix();
            ActiveCamera = Orthographic;
        }
        else
        {
            const θ = THREE.MathUtils.degToRad(CameraValues.Yaw);
            const φ = THREE.MathUtils.degToRad(CameraValues.Pitch);
            Perspective.position.set(Reach * Math.sin(θ) * Math.cos(φ), Focus.y + Reach * Math.sin(φ), Reach * Math.cos(θ) * Math.cos(φ));
            Perspective.lookAt(Focus);
            ActiveCamera = Perspective;
        }
        ActiveCamera.updateMatrixWorld();
        const Flat = CameraValues.Mode === "2d";
        document.getElementById("PerspectiveButton").setAttribute("aria-pressed", String(!Flat));
        document.getElementById("FlatButton").setAttribute("aria-pressed", String(Flat));
        document.getElementById("CameraYaw").disabled = Flat;
        document.getElementById("CameraPitch").disabled = Flat;
        document.getElementById("CameraYaw").value = CameraValues.Yaw;
        document.getElementById("CameraPitch").value = CameraValues.Pitch;
        document.getElementById("CameraYawReading").textContent = Math.round(CameraValues.Yaw) + "°";
        document.getElementById("CameraPitchReading").textContent = Math.round(CameraValues.Pitch) + "°";
    }

    function ResizeExperience()
    {
        SceneWidth = Math.max(1, Viewport.clientWidth);
        SceneHeight = Math.max(1, Viewport.clientHeight);
        Renderer.setSize(SceneWidth, SceneHeight, false);
        ProjectCamera();
    }

    function PresentCamera(Mode, Yaw = CameraValues.Yaw, Pitch = CameraValues.Pitch)
    {
        CameraValues.Mode = Mode;
        CameraValues.Yaw = Yaw;
        CameraValues.Pitch = Pitch;
        ProjectCamera();
    }

    function ProjectPointer(Event, Unbounded = false)
    {
        const Rectangle = Canvas.getBoundingClientRect();
        const Position = new THREE.Vector2((Event.clientX - Rectangle.left) / Rectangle.width * 2 - 1,
            1 - (Event.clientY - Rectangle.top) / Rectangle.height * 2);
        Raycaster.setFromCamera(Position, ActiveCamera);
        if (Unbounded)
        {
            const Point = Raycaster.ray.intersectPlane(ContactPlane, new THREE.Vector3());
            if (!Point) return null;
            return ActiveScreen.QueryPanelPoint(Point.x / Hardware.Hardware.DisplayWidth + 0.5, 0.5 - Point.y / Hardware.Hardware.DisplayHeight);
        }
        const Contact = Raycaster.intersectObject(Hardware.Screen, false)[0];
        return Contact ? ActiveScreen.QueryPanelPoint(Contact.uv.x, 1 - Contact.uv.y) : null;
    }

    function ForwardCancel()
    {
        ActiveScreen.ForwardPointer("cancel", 0, 0);
        if (Gesture && Canvas.hasPointerCapture(Gesture.Identifier)) Canvas.releasePointerCapture(Gesture.Identifier);
        Gesture = null;
    }

    Canvas.addEventListener("pointerdown", Event =>
    {
        if (Gesture) return;
        const Contact = Event.button === 0 ? ProjectPointer(Event) : null;
        Gesture = { Identifier: Event.pointerId, Mode: Contact ? "screen" : "camera", Left: Event.clientX, Top: Event.clientY,
            Yaw: CameraValues.Yaw, Pitch: CameraValues.Pitch };
        Canvas.setPointerCapture(Event.pointerId);
        if (Contact) ActiveScreen.ForwardPointer("down", Contact.Across, Contact.Down);
        else
        {
            ActiveScreen.ActiveTextInput?.blur();
            if (CameraValues.Mode === "2d") PresentCamera("3d", 0, 0);
            Canvas.style.cursor = "grabbing";
        }
        Event.preventDefault();
    });
    Canvas.addEventListener("pointermove", Event =>
    {
        if (Gesture?.Identifier === Event.pointerId)
        {
            if (Gesture.Mode === "screen")
            {
                const Contact = ProjectPointer(Event, true);
                if (Contact) ActiveScreen.ForwardPointer("move", Contact.Across, Contact.Down);
            }
            else
            {
                CameraValues.Yaw = ((Gesture.Yaw - (Event.clientX - Gesture.Left) * 0.36 + 540) % 360) - 180;
                CameraValues.Pitch = Math.max(-45, Math.min(65, Gesture.Pitch + (Event.clientY - Gesture.Top) * 0.29));
                ProjectCamera();
            }
            return;
        }
        const Contact = ProjectPointer(Event);
        const Target = Contact && ActiveScreen.ForwardPointer("hover", Contact.Across, Contact.Down);
        if (!Contact) ActiveScreen.ForwardPointer("hover", -100, -100);
        Canvas.style.cursor = Target ? "pointer" : Contact ? "default" : "grab";
    });
    Canvas.addEventListener("pointerup", Event =>
    {
        if (Gesture?.Identifier !== Event.pointerId) return;
        if (Gesture.Mode === "screen")
        {
            const Contact = ProjectPointer(Event, true);
            if (Contact) ActiveScreen.ForwardPointer("up", Contact.Across, Contact.Down);
            else ActiveScreen.ForwardPointer("cancel", 0, 0);
        }
        if (Canvas.hasPointerCapture(Event.pointerId)) Canvas.releasePointerCapture(Event.pointerId);
        Gesture = null;
        Canvas.style.cursor = "default";
    });
    Canvas.addEventListener("pointercancel", ForwardCancel);
    Canvas.addEventListener("lostpointercapture", () => { if (Gesture) ForwardCancel(); });
    Canvas.addEventListener("contextmenu", Event => Event.preventDefault());
    Canvas.addEventListener("wheel", Event =>
    {
        if (ActiveScreen.Application || ActiveScreen.Design !== "focus")
            CameraValues.Zoom = Math.max(0.62, Math.min(1.65, CameraValues.Zoom * Math.exp(-Event.deltaY * 0.001)));
        else
        {
            const Contact = ProjectPointer(Event);
            if (Contact) { ActiveScreen.FocusIndex = (ActiveScreen.FocusIndex + (Event.deltaY > 0 ? 1 : -1) + Applications.length) % Applications.length; ActiveScreen.Dirty = true; }
            else CameraValues.Zoom = Math.max(0.62, Math.min(1.65, CameraValues.Zoom * Math.exp(-Event.deltaY * 0.001)));
        }
        ProjectCamera();
        Event.preventDefault();
    }, { passive: false });
    window.addEventListener("blur", ForwardCancel);

    const Choices = document.getElementById("DesignChoices");
    function AnnounceDesign(Identifier)
    {
        for (const Button of Choices.querySelectorAll("button"))
            Button.setAttribute("aria-pressed", String(Button.dataset.design === Identifier));
    }
    for (const Design of LauncherDesigns)
    {
        const Button = document.createElement("button");
        Button.className = "DesignOption";
        Button.dataset.design = Design.Identifier;
        Button.setAttribute("aria-pressed", String(Design.Identifier === ActiveScreen.Design));
        Button.innerHTML = ConstructDesignGlyph(Design.Identifier) + `<span class="DesignWords"><strong>${Design.Name}</strong><small>${Design.Caption}</small></span><span class="DesignNumber">${Design.Number}</span>`;
        Button.addEventListener("click", () => { ForwardCancel(); ActiveScreen.PresentDesign(Design.Identifier); AnnounceDesign(Design.Identifier); });
        Choices.append(Button);
    }
    document.getElementById("HomeButton").addEventListener("click", () => ActiveScreen.PresentHome());
    document.getElementById("PerspectiveButton").addEventListener("click", () => PresentCamera("3d"));
    document.getElementById("FlatButton").addEventListener("click", () => { ForwardCancel(); PresentCamera("2d"); });
    document.getElementById("ResetCamera").addEventListener("click", () => { ForwardCancel(); CameraValues.Zoom = 1; PresentCamera("3d", -24, 12); });
    for (const Button of document.querySelectorAll("[data-camera]"))
    {
        Button.addEventListener("click", () =>
        {
            const Presets = { front: [0, 0], angle: [-24, 12], edge: [-66, 8], back: [170, 14] };
            const [Yaw, Pitch] = Presets[Button.dataset.camera];
            PresentCamera("3d", Yaw, Pitch);
        });
    }
    document.getElementById("CameraYaw").addEventListener("input", Event => { CameraValues.Yaw = Number(Event.target.value); ProjectCamera(); });
    document.getElementById("CameraPitch").addEventListener("input", Event => { CameraValues.Pitch = Number(Event.target.value); ProjectCamera(); });
    document.getElementById("GlassEnabled").addEventListener("change", Event => { Hardware.Cover.visible = Event.target.checked; SceneDirty = true; });
    document.getElementById("ReflectionStrength").addEventListener("input", Event =>
    {
        const Fraction = Number(Event.target.value) / 100;
        Hardware.CoverMaterial.envMapIntensity = Fraction * 1.14;
        Hardware.CoverMaterial.clearcoat = Fraction * 0.43;
        SceneDirty = true;
        document.getElementById("ReflectionReading").textContent = Event.target.value + "%";
    });
    for (const Button of document.querySelectorAll("[data-finish]"))
    {
        Button.addEventListener("click", () =>
        {
            const Colours = { titanium: ["#afb8bd", "#c6ced0"], graphite: ["#353c42", "#5b6269"], pearl: ["#deded3", "#f0eee2"] };
            const [BodyColour, EdgeColour] = Colours[Button.dataset.finish];
            Hardware.Metal.color.set(BodyColour);
            Hardware.EdgeMetal.color.set(EdgeColour);
            Hardware.BackMaterial.color.set(BodyColour);
            SceneDirty = true;
            for (const Choice of document.querySelectorAll("[data-finish]")) Choice.setAttribute("aria-pressed", String(Choice === Button));
        });
    }
    const Keyboard = document.getElementById("KeyboardReception");
    ActiveScreen.ActiveTextInput = Keyboard;
    Keyboard.addEventListener("input", Event => ActiveScreen.AdmitText(Event.target.value));
    Keyboard.addEventListener("keydown", Event =>
    {
        if (Event.key !== "Enter") return;
        if (ActiveScreen.TextTarget === "message") ActiveScreen.DeliverMessage();
        else { Keyboard.blur(); ActiveScreen.TextTarget = ""; ActiveScreen.Notice = "Display name saved locally for this visit."; ActiveScreen.Dirty = true; }
    });
    window.addEventListener("keydown", Event =>
    {
        if (Event.key === "Escape") { ForwardCancel(); ActiveScreen.PresentHome(); }
    });
    for (const Button of document.querySelectorAll("[data-family]"))
        Button.addEventListener("click", () => { ForwardCancel(); const Family = TabletFamilies[Button.dataset.family]; BuildConsole(Family.Width, Family.Height, Family.Thickness, Button.dataset.family); });
    for (const Identifier of ["TabletWidth", "TabletHeight", "TabletThickness"])
        document.getElementById(Identifier).addEventListener("input", () =>
            BuildConsole(Number(document.getElementById("TabletWidth").value) / 1000, Number(document.getElementById("TabletHeight").value) / 1000, Number(document.getElementById("TabletThickness").value) / 1000, "custom"));
    for (const Button of document.querySelectorAll("[data-outline]"))
        Button.addEventListener("click", () =>
        {
            Cluster.PresentOutline(Button.dataset.outline);
            for (const Choice of document.querySelectorAll("[data-outline]")) Choice.setAttribute("aria-pressed", String(Choice === Button));
            ArrangeConsole(); ProjectCamera();
        });
    document.getElementById("ClusterEnabled").addEventListener("change", Event => { Layout.ClusterVisible = Event.target.checked; ArrangeConsole(); ProjectCamera(); });
    document.getElementById("ClusterDemonstration").addEventListener("change", Event => { Cluster.Demonstration = Event.target.checked; Cluster.Dirty = true; });
    const Resize = new ResizeObserver(ResizeExperience);
    Resize.observe(Viewport);
    ResizeExperience();
    BuildConsole(Layout.Width, Layout.Height, Layout.Thickness, "grand");

    window.TabletPrototype = {
        QueryReading: () => ({ ...ActiveScreen.QueryReading(), Camera: { ...CameraValues }, Hardware: { ...Hardware.Hardware },
            Preview: Preview.QueryReading(), Cluster: { ...Cluster.QueryReading(), Visible: Layout.ClusterVisible },
            Families: Object.fromEntries(Object.entries(TabletFamilies).map(([Key, Family]) => [Key, { ...Family }])),
            GlassVisible: Hardware.Cover.visible, PhysicallyTransmissiveGlass: Hardware.CoverMaterial.transmission === 1,
            TextureWidth: Artwork.width, TextureHeight: Artwork.height, FrameCount, Renderer: Renderer.info.render, FlatDeviceTexture: true }),
        QueryRegions: () => ActiveScreen.Regions.map(({ Action, ...Region }) => ({ ...Region })),
        ProjectScreenPoint: (Across, Down) =>
        {
            const Fraction = ActiveScreen.QueryPanelFraction(Across, Down);
            const Position = new THREE.Vector3((Fraction.Across - 0.5) * Hardware.Hardware.DisplayWidth,
                (0.5 - Fraction.Down) * Hardware.Hardware.DisplayHeight, DisplayDepth);
            Position.project(ActiveCamera);
            const Rectangle = Canvas.getBoundingClientRect();
            return { Left: Rectangle.left + (Position.x + 1) / 2 * Rectangle.width, Top: Rectangle.top + (1 - Position.y) / 2 * Rectangle.height };
        },
        QueryScreenPng: () => Artwork.toDataURL("image/png"),
        QueryClusterPng: () => ClusterCanvas.toDataURL("image/png"),
        QueryPreviewPng: () => Preview.Readback.toDataURL("image/png"),
        PresentFamily: Identifier => { const Family = TabletFamilies[Identifier]; if (!Family) return false; BuildConsole(Family.Width, Family.Height, Family.Thickness, Identifier); return true; },
        PresentClusterDemonstration: Enabled => { Cluster.Demonstration = Boolean(Enabled); document.getElementById("ClusterDemonstration").checked = Cluster.Demonstration; Cluster.Dirty = true; },
        PresentPreviewSpin: Enabled => { Preview.Spin = Boolean(Enabled); Preview.Dirty = true; ActiveScreen.Dirty = true; },
        PresentConsole: (Width, Height, Thickness) => BuildConsole(Width, Height, Thickness, "custom"),
        PresentOutline: Identifier => { if (!Cluster.PresentOutline(Identifier)) return false; ArrangeConsole(); ProjectCamera(); return true; },
        Applications: Applications.map(Application => ({ ...Application })),
        Designs: LauncherDesigns.map(Design => ({ ...Design }))
    };
    document.getElementById("Loading").hidden = true;
    Canvas.dataset.ready = "true";

    function AdvanceFrame()
    {
        if (Disposed) return;
        requestAnimationFrame(AdvanceFrame);
        if (document.hidden) return;
        ActiveScreen.AdvanceClock();
        const Elapsed = performance.now() / 1000;
        if (ActiveScreen.Application === "garage" && Preview.Advance(Elapsed)) ActiveScreen.Dirty = true;
        if (Layout.ClusterVisible)
        {
            Cluster.AdvanceDemonstration(Elapsed);
            if (Cluster.RasterCluster(Elapsed)) { ClusterHardware.Texture.needsUpdate = true; SceneDirty = true; }
        }
        if (ActiveScreen.RasterScreen())
        {
            SceneDirty = true;
            Hardware.DisplayTexture.needsUpdate = true;
            AnnounceDesign(ActiveScreen.Design);
        }
        if (SceneDirty)
        {
            Renderer.render(Hardware.Scene, ActiveCamera);
            Renderer.shadowMap.autoUpdate = false;
            SceneDirty = false;
            ++FrameCount;
        }
    }
    requestAnimationFrame(AdvanceFrame);
    window.addEventListener("pagehide", () =>
    {
        Disposed = true;
        Resize.disconnect();
        Hardware.Scene.traverse(Entity =>
        {
            Entity.geometry?.dispose();
            if (Entity.material)
            {
                const Materials = Array.isArray(Entity.material) ? Entity.material : [Entity.material];
                for (const Material of Materials) Material.dispose();
            }
        });
        Hardware.DisplayTexture.dispose();
        ClusterHardware.Texture.dispose();
        Preview.Dispose();
        Hardware.Lighting.dispose();
        Renderer.dispose();
    }, { once: true });
}

ConstructExperience().catch(Reason =>
{
    document.getElementById("Loading").hidden = true;
    const Failure = document.getElementById("Failure");
    Failure.hidden = false;
    Failure.textContent = "The tablet could not start: " + Reason.message + ". A WebGL2-capable browser is required. The app does not silently substitute a different design.";
    console.error(Reason);
});
