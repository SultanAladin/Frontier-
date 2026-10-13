//============================================================================================================================================
//                                                           TABLETSTRUCTURE.JS
//============================================================================================================================================
// 📦 Rounded metal hardware, recessed flat screen and physically transmissive cover glass in a shared 3D scene.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export const DeviceWidth = 0.4;
export const DeviceHeight = 0.25;
export const DisplayWidth = 0.376;
export const DisplayHeight = 0.235;
export const DisplayDepth = 0.003;
export const CoverThickness = 0.0024;

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

    const Body = ConstructSolid(DeviceWidth - 0.003, DeviceHeight - 0.003, 0.016, 0.012, 0.0015, Metal, -0.013);
    Body.name = "Machined tablet body";
    Device.add(Body);
    const RimSurface = ConstructSolid(0.396, 0.246, 0.015, 0.001, 0.0006, EdgeMetal, -0.0005);
    RimSurface.name = "Polished perimeter";
    Device.add(RimSurface);
    const Bezel = ConstructSheet(0.393, 0.243, 0.0148, Bed, 0.001);
    Bezel.name = "Recessed black bezel";
    Device.add(Bezel);

    const DisplayTexture = new THREE.CanvasTexture(ScreenCanvas);
    DisplayTexture.colorSpace = THREE.SRGBColorSpace;
    DisplayTexture.anisotropy = Math.min(8, Renderer.capabilities.getMaxAnisotropy());
    DisplayTexture.minFilter = THREE.LinearMipmapLinearFilter;
    const ScreenMaterial = new THREE.MeshBasicMaterial({ map: DisplayTexture, toneMapped: false });
    const Screen = ConstructSheet(DisplayWidth, DisplayHeight, 0.0094, ScreenMaterial, DisplayDepth);
    Screen.name = "Flat HMI render texture";
    Device.add(Screen);

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
    const Cover = ConstructSolid(0.389, 0.239, 0.013, CoverThickness, 0.00012, CoverMaterial, DisplayDepth + 0.0002);
    Cover.name = "2.4 mm transmissive glass";
    Cover.castShadow = false;
    Cover.receiveShadow = false;
    Cover.renderOrder = 4;
    Device.add(Cover);

    const Sensor = new THREE.Mesh(new THREE.SphereGeometry(0.0015, 16, 8), new THREE.MeshStandardMaterial({ color: "#1f2d39", metalness: 0.6, roughness: 0.2 }));
    Sensor.scale.z = 0.14;
    Sensor.position.set(0, 0.1194, 0.0018);
    Device.add(Sensor);
    for (const Position of [0.042, 0.082])
    {
        const Button = new THREE.Mesh(new THREE.BoxGeometry(0.0022, Position === 0.042 ? 0.020 : 0.011, 0.004), EdgeMetal);
        Button.position.set(0.201, Position, -0.006);
        Device.add(Button);
    }
    const Port = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.0014, 0.004), Dark);
    Port.position.set(0, -0.126, -0.006);
    Device.add(Port);
    for (let Index = 0; Index < 14; ++Index)
    {
        const Slot = new THREE.Mesh(new THREE.BoxGeometry(0.0011, 0.0014, 0.002), Dark);
        Slot.position.set(-0.048 + Index * 0.0028, -0.126, -0.006);
        Device.add(Slot);
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
    const BackSurface = ConstructSheet(0.385, 0.235, 0.012, BackMaterial, 0);
    BackSurface.rotation.y = Math.PI;
    BackSurface.position.z = -0.0147;
    BackSurface.name = "Rear engraving";
    Device.add(BackSurface);

    const Floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ color: "#5d6865", opacity: 0.15 }));
    Floor.rotation.x = -Math.PI / 2;
    Floor.position.y = -0.164;
    Floor.receiveShadow = true;
    Scene.add(Floor);

    return { Scene, Device, Screen, Cover, DisplayTexture, Metal, EdgeMetal, BackMaterial, CoverMaterial, Lighting,
        Hardware: { Width: DeviceWidth, Height: DeviceHeight, BodyThickness: 0.012, CoverThickness, DisplayWidth, DisplayHeight, DisplayDepth } };
}
