//============================================================================================================================================
//                                                        VEHICLEPREVIEWSEQUENCE.JS
//============================================================================================================================================
// 📦 Isolated studio scene rendering the actual ControlVehicle into its own texture at its own rate, independent of the cockpit camera.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export const PreviewWidth = 640;
export const PreviewHeight = 400;

export class VehiclePreviewSequence
{
    constructor(Renderer)
    {
        this.Renderer = Renderer;
        this.Target = new THREE.WebGLRenderTarget(PreviewWidth, PreviewHeight, { colorSpace: THREE.SRGBColorSpace, samples: 4 });
        this.Scene = new THREE.Scene();
        this.Scene.background = new THREE.Color("#1a2a2b");
        const Environment = new RoomEnvironment();
        const Prefilter = new THREE.PMREMGenerator(Renderer);
        this.Lighting = Prefilter.fromScene(Environment, 0.04);
        this.Scene.environment = this.Lighting.texture;
        this.Scene.environmentIntensity = 0.95;
        Environment.dispose();
        Prefilter.dispose();
        this.Camera = new THREE.PerspectiveCamera(32, PreviewWidth / PreviewHeight, 0.1, 60);
        this.Yaw = -0.62;
        this.Pitch = 0.3;
        this.Distance = 9.2;
        this.Spin = true;
        this.Loaded = false;
        this.Failure = "";
        this.Revision = 0;
        this.RateHz = 30;
        this.LastRender = -1;
        this.Facets = 0;
        this.Dirty = true;
        this.Pixels = new Uint8Array(PreviewWidth * PreviewHeight * 4);
        this.Readback = document.createElement("canvas");
        this.Readback.width = PreviewWidth; this.Readback.height = PreviewHeight;
        this.ReadbackContext = this.Readback.getContext("2d");
        this.Fill = new THREE.HemisphereLight("#f2f7ff", "#24302c", 1.2);
        this.Scene.add(this.Fill);
        const Key = new THREE.DirectionalLight("#fff4e6", 4.5);
        Key.position.set(-5, 8, 6);
        Key.castShadow = true;
        Key.shadow.mapSize.set(1024, 1024);
        Key.shadow.camera.left = -5; Key.shadow.camera.right = 5; Key.shadow.camera.top = 5; Key.shadow.camera.bottom = -5;
        Key.shadow.bias = -0.0005;
        this.Scene.add(Key);
        const Rim = new THREE.DirectionalLight("#9ad0e0", 2.2);
        Rim.position.set(6, 4, -7);
        this.Scene.add(Rim);
        const Floor = new THREE.Mesh(new THREE.CircleGeometry(7, 64), new THREE.MeshStandardMaterial({ color: "#20302f", roughness: 0.92, metalness: 0 }));
        Floor.rotation.x = -Math.PI / 2;
        Floor.receiveShadow = true;
        this.Scene.add(Floor);
        const Ring = new THREE.Mesh(new THREE.RingGeometry(4.6, 4.72, 96), new THREE.MeshBasicMaterial({ color: "#8fc9a8", side: THREE.DoubleSide }));
        Ring.rotation.x = -Math.PI / 2;
        Ring.position.y = 0.004;
        this.Scene.add(Ring);
        this.Vehicle = new THREE.Group();
        this.Scene.add(this.Vehicle);
    }

    async Load(Url)
    {
        const Loader = new GLTFLoader();
        try
        {
            const Document = await Loader.loadAsync(Url);
            // 📝 The scene glTF is already Y-up metres (tyres rest at y ≈ 0.02); only recentre, never re-orient.
            Document.scene.updateMatrixWorld(true);
            const Bounds = new THREE.Box3().setFromObject(Document.scene);
            const Centre = Bounds.getCenter(new THREE.Vector3());
            Document.scene.position.set(-Centre.x, -Bounds.min.y, -Centre.z);
            Document.scene.traverse(Entity =>
            {
                if (!Entity.isMesh) return;
                Entity.castShadow = true;
                Entity.receiveShadow = true;
                this.Facets += Entity.geometry.index ? Entity.geometry.index.count / 3 : Entity.geometry.attributes.position.count / 3;
                if (Entity.material?.transmission > 0) Entity.material.transmission = 0;
                if (Entity.material?.name === "Glass") { Entity.material.opacity = 0.55; Entity.material.transparent = true; Entity.material.roughness = 0.05; Entity.material.metalness = 0.6; }
                if (Entity.material?.name === "MetalicCoat") { Entity.material.metalness = 0.35; Entity.material.roughness = 0.32; Entity.material.clearcoat = 1; Entity.material.clearcoatRoughness = 0.08; }
            });
            this.Vehicle.add(Document.scene);
            this.Loaded = true;
            this.Dirty = true;
        }
        catch (Reason)
        {
            this.Failure = Reason.message || String(Reason);
        }
    }

    Orbit(DeltaYaw, DeltaPitch)
    {
        this.Yaw += DeltaYaw;
        this.Pitch = Math.max(0.05, Math.min(1.2, this.Pitch + DeltaPitch));
        this.Spin = false;
        this.Dirty = true;
    }

    Advance(Elapsed)
    {
        if (!this.Loaded) return false;
        if (this.Spin) { this.Yaw += 0.0045; this.Dirty = true; }
        if (!this.Dirty) return false;
        if (this.LastRender >= 0 && Elapsed - this.LastRender < 1 / this.RateHz) return false;
        this.LastRender = Elapsed;
        this.Camera.position.set(Math.sin(this.Yaw) * Math.cos(this.Pitch) * this.Distance, Math.sin(this.Pitch) * this.Distance + 0.6,
            Math.cos(this.Yaw) * Math.cos(this.Pitch) * this.Distance);
        this.Camera.lookAt(0, 0.65, 0);
        const Previous = this.Renderer.getRenderTarget();
        const Exposure = this.Renderer.toneMappingExposure;
        this.Renderer.setRenderTarget(this.Target);
        this.Renderer.render(this.Scene, this.Camera);
        // 📝 The preview is its own world; the flat screen only ever receives finished pixels.
        this.Renderer.readRenderTargetPixels(this.Target, 0, 0, PreviewWidth, PreviewHeight, this.Pixels);
        this.Renderer.setRenderTarget(Previous);
        this.ReadbackContext.putImageData(new ImageData(new Uint8ClampedArray(this.Pixels.buffer), PreviewWidth, PreviewHeight), 0, 0);
        this.Renderer.toneMappingExposure = Exposure;
        this.Dirty = false;
        ++this.Revision;
        return true;
    }

    QueryReading()
    {
        return { Loaded: this.Loaded, Failure: this.Failure, Facets: Math.round(this.Facets), Revision: this.Revision, RateHz: this.RateHz,
            Width: PreviewWidth, Height: PreviewHeight, OwnCamera: true, OwnLighting: true, Spin: this.Spin };
    }

    Dispose()
    {
        this.Target.dispose();
        this.Lighting.dispose();
        this.Scene.traverse(Entity => { Entity.geometry?.dispose(); Entity.material?.dispose?.(); });
    }
}
