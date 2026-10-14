//============================================================================================================================================
//                                                           TABLETSTRUCTURE.JS
//============================================================================================================================================
// 📦 Rounded metal hardware, recessed flat screen and physically transmissive cover glass in a shared 3D scene.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export const TabletFamilies = {
    coupe:   { Name: "Coupé console",   Caption: "Compact, upright",        Width: 0.30, Height: 0.20, Thickness: 0.010 },
    grand:   { Name: "Grand tourer",    Caption: "The reference 400 × 250", Width: 0.40, Height: 0.25, Thickness: 0.012 },
    estate:  { Name: "Wide estate",     Caption: "Low and panoramic",       Width: 0.48, Height: 0.22, Thickness: 0.014 },
    utility: { Name: "Utility",         Caption: "Tall portrait console",   Width: 0.26, Height: 0.33, Thickness: 0.016 }
};

export const CoverThickness = 0.0024;
export const DisplayDepth = 0.003;

export function ResolveTabletGeometry(Width, Height, Thickness)
{
    const Bezel = Math.max(0.006, Math.min(Width, Height) * 0.03);
    return { Width, Height, Thickness, Bezel, DisplayWidth: Width - Bezel * 2, DisplayHeight: Height - Bezel * 2,
        Radius: Math.min(Width, Height) * 0.064, DisplayRadius: Math.min(Width, Height) * 0.0376 };
}

function ConstructRoundedShape(Width, Height, Radius)
{
    const Shape = new THREE.Shape();
    const Left = -Width / 2, Bottom = -Height / 2;
    Shape.moveTo(Left + Radius, Bottom);
    Shape.lineTo(Left + Width - Radius, Bottom);
    Shape.quadraticCurveTo(Left + Width, Bottom, Left + Width, Bottom + Radius);
    Shape.lineTo(Left + Width, Bottom + Height - Radius);
    Shape.quadraticCurveTo(Left + Width, Bottom + Height, Left + Width - Radius, Bottom + Height);
    Shape.lineTo(Left + Radius, Bottom + Height);
    Shape.quadraticCurveTo(Left, Bottom + Height, Left, Bottom + Height - Radius);
    Shape.lineTo(Left, Bottom + Radius);
    Shape.quadraticCurveTo(Left, Bottom, Left + Radius, Bottom);
    return Shape;
}

function ConstructSheet(Width, Height, Radius, Material, Depth)
{
    const Geometry = new THREE.ShapeGeometry(ConstructRoundedShape(Width, Height, Radius), 18);
    const Positions = Geometry.getAttribute("position");
    const Coordinates = Geometry.getAttribute("uv");
    for (let Index = 0; Index < Positions.count; ++Index)
        Coordinates.setXY(Index, Positions.getX(Index) / Width + 0.5, Positions.getY(Index) / Height + 0.5);
    const Surface = new THREE.Mesh(Geometry, Material);
    Surface.position.z = Depth;
    return Surface;
}

function ConstructSolid(Width, Height, Radius, Thickness, Bevel, Material, Depth)
{
    const Geometry = new THREE.ExtrudeGeometry(ConstructRoundedShape(Width, Height, Radius),
        { depth: Thickness, bevelEnabled: Bevel > 0, bevelThickness: Bevel, bevelSize: Bevel, bevelSegments: 4, curveSegments: 16, steps: 1 });
    Geometry.translate(0, 0, Depth);
    const Surface = new THREE.Mesh(Geometry, Material);
    Surface.castShadow = true;
    Surface.receiveShadow = true;
    return Surface;
}

// 📝 The driver cluster is a second flat texture whose housing is cut to the same irregular outline as its raster mask.
export function ConstructCluster(Scene, Renderer, ClusterCanvas, Materials)
{
    const Group = new THREE.Group();
    Group.name = "Driver cluster";
    Scene.add(Group);
    const Texture = new THREE.CanvasTexture(ClusterCanvas);
    Texture.colorSpace = THREE.SRGBColorSpace;
    Texture.anisotropy = Math.min(8, Renderer.capabilities.getMaxAnisotropy());
    const FaceMaterial = new THREE.MeshBasicMaterial({ map: Texture, toneMapped: false, transparent: true });
    const Parts = [];
    const Reading = { Outline: "", Width: 0, Height: 0 };
    function Build(Points, Width, Height)
    {
        for (const Part of Parts) { Group.remove(Part); Part.geometry.dispose(); }
        Parts.length = 0;
        const Shape = (Scale) => { const Outline = new THREE.Shape(); Points.forEach(([Across, Down], Index) => Outline[Index ? "lineTo" : "moveTo"](Across * Width / 2 * Scale, Down * Height / 2 * Scale)); Outline.closePath(); return Outline; };
        const Housing = new THREE.Mesh(new THREE.ExtrudeGeometry(Shape(1.06), { depth: 0.014, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2 }), Materials.Metal);
        Housing.position.z = -0.015; Housing.castShadow = true; Housing.receiveShadow = true;
        const Bed = new THREE.Mesh(new THREE.ShapeGeometry(Shape(1.02)), Materials.Bed);
        Bed.position.z = 0.0003;
        const Face = new THREE.Mesh(new THREE.ShapeGeometry(Shape(1)), FaceMaterial);
        const Attributes = Face.geometry.attributes.position;
        const Coordinates = Face.geometry.attributes.uv;
        for (let Index = 0; Index < Attributes.count; ++Index)
            Coordinates.setXY(Index, Attributes.getX(Index) / Width + 0.5, Attributes.getY(Index) / Height + 0.5);
        Coordinates.needsUpdate = true;
        Face.position.z = 0.0008;
        for (const Part of [Housing, Bed, Face]) { Group.add(Part); Parts.push(Part); }
        Object.assign(Reading, { Width, Height });
    }
    return { Group, Texture, Build, Reading };
}

export function ConstructTablet(Renderer, ScreenCanvas)
{
    const Scene = new THREE.Scene();
    Scene.background = new THREE.Color("#efefeb");
    const Environment = new RoomEnvironment();
    const Prefilter = new THREE.PMREMGenerator(Renderer);
    const Lighting = Prefilter.fromScene(Environment, 0.04);
    Scene.environment = Lighting.texture;
    Scene.environmentIntensity = 0.7;
    Environment.dispose();
    Prefilter.dispose();

    const Ambient = new THREE.HemisphereLight("#fffaf0", "#8c9793", 2.3);
    Scene.add(Ambient);
    const Key = new THREE.DirectionalLight("#fff7eb", 3.5);
    Key.position.set(-0.6, 0.8, 0.7);
    Key.castShadow = true;
    Key.shadow.mapSize.set(1024, 1024);
    Key.shadow.camera.left = -0.55; Key.shadow.camera.right = 0.55;
    Key.shadow.camera.top = 0.4; Key.shadow.camera.bottom = -0.4;
    Key.shadow.camera.near = 0.1; Key.shadow.camera.far = 3;
    Key.shadow.bias = -0.00015;
    Key.shadow.normalBias = 0.001;
    Scene.add(Key);
    const Rim = new THREE.DirectionalLight("#c7e4ea", 1.5);
    Rim.position.set(0.65, 0.4, -0.3);
    Scene.add(Rim);

    const Device = new THREE.Group();
    Scene.add(Device);
    const Metal = new THREE.MeshStandardMaterial({ color: "#afb8bd", metalness: 0.82, roughness: 0.31, envMapIntensity: 1.1 });
    const EdgeMetal = new THREE.MeshStandardMaterial({ color: "#c6ced0", metalness: 0.86, roughness: 0.25 });
    const Bed = new THREE.MeshStandardMaterial({ color: "#151d23", metalness: 0.12, roughness: 0.37 });
    const Dark = new THREE.MeshStandardMaterial({ color: "#192024", metalness: 0.35, roughness: 0.4 });

    const DisplayTexture = new THREE.CanvasTexture(ScreenCanvas);
    DisplayTexture.colorSpace = THREE.SRGBColorSpace;
    DisplayTexture.anisotropy = Math.min(8, Renderer.capabilities.getMaxAnisotropy());
    DisplayTexture.minFilter = THREE.LinearMipmapLinearFilter;
    const ScreenMaterial = new THREE.MeshBasicMaterial({ map: DisplayTexture, toneMapped: false });

    const CoverMaterial = new THREE.MeshPhysicalMaterial({
        color: "#ffffff", metalness: 0, roughness: 0, transmission: 1, thickness: CoverThickness,
        ior: 1.517, attenuationColor: new THREE.Color("#eefbfa"), attenuationDistance: 2,
        envMapIntensity: 0.4, clearcoat: 0.15, clearcoatRoughness: 0.045
    });
    CoverMaterial.onBeforeCompile = Shader =>
    {
        // 📝 A clear device cover must not inherit the BRDF's minimum roughness as frosted transmission.
        const Transmission = THREE.ShaderChunk.transmission_pars_fragment.replace(
            "float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );\n\t\treturn textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );",
            "return textureLod( transmissionSamplerMap, fragCoord.xy, 0.0 );");
        Shader.fragmentShader = Shader.fragmentShader.replace("#include <transmission_pars_fragment>", Transmission);
    };
    CoverMaterial.customProgramCacheKey = () => "clear-tablet-cover";
    const SensorMaterial = new THREE.MeshStandardMaterial({ color: "#1f2d39", metalness: 0.6, roughness: 0.2 });

    const Hardware = { Width: 0, Height: 0, Thickness: 0, Bezel: 0, DisplayWidth: 0, DisplayHeight: 0, CoverThickness, DisplayDepth, Family: "grand" };
    const Parts = { Screen: null, Cover: null, Items: [] };

    // 📝 Every car carries its own console: the chassis is rebuilt from width, height and thickness while the launcher stays the same texture.
    function BuildHardware(Width, Height, Thickness)
    {
        for (const Item of Parts.Items) { Device.remove(Item); Item.geometry.dispose(); }
        Parts.Items.length = 0;
        const Geometry = ResolveTabletGeometry(Width, Height, Thickness);
        Object.assign(Hardware, Geometry);
        const Add = (Mesh, Name) => { Mesh.name = Name; Device.add(Mesh); Parts.Items.push(Mesh); return Mesh; };
        const Body = Add(ConstructSolid(Width - 0.003, Height - 0.003, Geometry.Radius, Thickness, 0.0015, Metal, -Thickness - 0.001), "Machined tablet body");
        Add(ConstructSolid(Width - 0.004, Height - 0.004, Geometry.Radius * 0.94, 0.001, 0.0006, EdgeMetal, -0.0005), "Polished perimeter");
        Add(ConstructSheet(Width - 0.007, Height - 0.007, Geometry.Radius * 0.92, Bed, 0.001), "Recessed black bezel");
        Parts.Screen = Add(ConstructSheet(Geometry.DisplayWidth, Geometry.DisplayHeight, Geometry.DisplayRadius, ScreenMaterial, DisplayDepth), "Flat HMI render texture");
        Parts.Cover = Add(ConstructSolid(Width - 0.011, Height - 0.011, Geometry.Radius * 0.81, CoverThickness, 0.00012, CoverMaterial, DisplayDepth + 0.0002), "2.4 mm transmissive glass");
        Parts.Cover.castShadow = false; Parts.Cover.receiveShadow = false; Parts.Cover.renderOrder = 4;
        const Sensor = Add(new THREE.Mesh(new THREE.SphereGeometry(0.0015, 16, 8), SensorMaterial), "Ambient sensor");
        Sensor.scale.z = 0.14;
        Sensor.position.set(0, Height / 2 - Geometry.Bezel * 0.5, 0.0018);
        for (const Position of [0.042, 0.082])
        {
            const Button = Add(new THREE.Mesh(new THREE.BoxGeometry(0.0022, Position === 0.042 ? 0.020 : 0.011, Thickness * 0.33), EdgeMetal), "Side button");
            Button.position.set(Width / 2 + 0.001, Math.min(Position, Height / 2 - 0.03), -Thickness / 2);
        }
        const Port = Add(new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.0014, Thickness * 0.33), Dark), "Port");
        Port.position.set(0, -Height / 2 - 0.001, -Thickness / 2);
        for (let Index = 0; Index < 14; ++Index)
        {
            const Slot = Add(new THREE.Mesh(new THREE.BoxGeometry(0.0011, 0.0014, 0.002), Dark), "Speaker slot");
            Slot.position.set(-0.048 + Index * 0.0028, -Height / 2 - 0.001, -Thickness / 2);
        }
        const Rear = Add(ConstructSheet(Width - 0.015, Height - 0.015, Geometry.Radius * 0.75, BackMaterial, 0), "Rear engraving");
        Rear.rotation.y = Math.PI;
        Rear.position.z = -Thickness - 0.0027;
        Body.castShadow = true;
        return Geometry;
    }

    const BackCanvas = document.createElement("canvas");
    BackCanvas.width = 1024; BackCanvas.height = 640;
    const BackContext = BackCanvas.getContext("2d");
    BackContext.fillStyle = "#ffffff"; BackContext.fillRect(0, 0, 1024, 640);
    BackContext.font = '300 68px "DM Sans", sans-serif'; BackContext.textAlign = "center"; BackContext.fillStyle = "#747f83";
    BackContext.fillText("f r o n t i e r", 512, 308);
    BackContext.font = '400 15px "DM Sans", sans-serif'; BackContext.fillText("H U M A N  ·  M A C H I N E", 512, 355);
    const BackTexture = new THREE.CanvasTexture(BackCanvas);
    BackTexture.colorSpace = THREE.SRGBColorSpace;
    const BackMaterial = new THREE.MeshStandardMaterial({ map: BackTexture, metalness: 0.72, roughness: 0.42 });
    BuildHardware(TabletFamilies.grand.Width, TabletFamilies.grand.Height, TabletFamilies.grand.Thickness);

    const Floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ color: "#5d6865", opacity: 0.15 }));
    Floor.rotation.x = -Math.PI / 2;
    Floor.position.y = -0.164;
    Floor.receiveShadow = true;
    Scene.add(Floor);

    return { Scene, Device, get Screen() { return Parts.Screen; }, get Cover() { return Parts.Cover; }, DisplayTexture, Metal, EdgeMetal, BackMaterial, CoverMaterial, Lighting,
        Hardware, BuildHardware, Materials: { Metal, EdgeMetal, Bed, Dark } };
}
