//============================================================================================================================================
//                                                         OCCUPANTDISTANCESPACE.JS
//============================================================================================================================================
// 🧩 Per-facet-set signed distance volumes, stacked in one 3D texel space and transferred on the device at bring-up.

import { ConstructBoundingStructure } from "./BoundingStructure.js";
import { OccupantRole } from "./FacetStructure.js";

const MaximumVolumeTexels = 128;    // [texel] - longest volume axis
const MinimumVolumeTexels = 8;      // [texel] - shortest volume axis
const SignRayCount        = 32;     // [-]     - rays per voxel for the back-face sign heuristic
const SlabVoxelBudget     = 65536;  // [voxel] - voxels per submission, so no single dispatch can trip a device watchdog

export class OccupantDistanceSpace
{
    constructor(Exchange, Shaders)
    {
        this.Exchange    = Exchange;
        this.Shaders     = Shaders;
        this.Volumes     = [];
        this.Texture     = null;
        this.TextureView = null;
        this.SpaceExtent = [0, 0, 0];
    }

    // 📝 ① choose each volume's voxel and resolution from its facet set; ② pack them into layers of a 3D texel space —
    //    shelves across each layer's plane, layers stacked along z, deepest volumes first so a layer wastes little —
    //    with one-texel gaps; ③ transfer each volume slab by slab. VoxelScale coarsens every volume uniformly for weaker
    //    adapters. Stacking every volume along z alone made the space as wide as the widest volume and as deep as all
    //    of them together; the yard's thirty facet sets cost a third of that packed.
    async ConstructVolumes(Scene, VoxelScale, ReportProgress)
    {
        const Required = new Set();
        for (const Occupant of Scene.Occupants)
        {
            if (Occupant.Roles & OccupantRole.Distance)
                Required.add(Occupant.FacetSet);
        }
        // 📝 Facet sets that occupants may take later (the stress-test scatter shapes, the bare rims) are transferred at
        //    bring-up too.
        Scene.FacetSets.forEach((Set, Index) =>
        {
            if (Set.DistanceRequired)
                Required.add(Index);
        });

        for (const SetIndex of Required)
        {
            const Set = Scene.FacetSets[SetIndex];
            let Voxel = Set.DistanceVoxel * VoxelScale;
            const Extent = [0, 1, 2].map((Axis) => Set.LocalMaximum[Axis] - Set.LocalMinimum[Axis]);
            const Margin = () => Math.max(4.0 * Voxel, 0.12);
            let Longest = Math.max(...Extent.map((Length) => Length + 2.0 * Margin()));
            if (Longest / Voxel > MaximumVolumeTexels)
                Voxel = Longest / MaximumVolumeTexels;
            const Resolution = Extent.map((Length) =>
                Math.max(MinimumVolumeTexels, Math.min(MaximumVolumeTexels, Math.ceil((Length + 2.0 * Margin()) / Voxel))));
            const Centre = [0, 1, 2].map((Axis) => 0.5 * (Set.LocalMinimum[Axis] + Set.LocalMaximum[Axis]));
            const Minimum = [0, 1, 2].map((Axis) => Centre[Axis] - 0.5 * Resolution[Axis] * Voxel);
            Set.VolumeIndex = this.Volumes.length;
            this.Volumes.push({ FacetSet: SetIndex, VoxelExtent: Voxel, Resolution, Minimum, TexelOrigin: [0, 0, 0] });
        }

        const Plane = MaximumVolumeTexels + 4;
        const Order = this.Volumes.map((Volume, Index) => Index)
                                  .sort((Left, Right) => (this.Volumes[Right].Resolution[2] - this.Volumes[Left].Resolution[2])
                                                       || (this.Volumes[Right].Resolution[1] - this.Volumes[Left].Resolution[1]));
        let LayerZ = 0, LayerDepth = 0, ShelfX = 0, ShelfY = 0, ShelfHeight = 0, Width = 0, Height = 0;
        for (const Index of Order)
        {
            const [X, Y, Z] = this.Volumes[Index].Resolution;
            if (ShelfX + X > Plane)
            {
                ShelfY += ShelfHeight + 1;
                ShelfX = 0;
                ShelfHeight = 0;
            }
            if (LayerDepth > 0 && ShelfY + Y > Plane)
            {
                LayerZ += LayerDepth + 1;
                LayerDepth = 0;
                ShelfX = 0;
                ShelfY = 0;
                ShelfHeight = 0;
            }
            this.Volumes[Index].TexelOrigin = [ShelfX, ShelfY, LayerZ];
            ShelfX += X + 1;
            ShelfHeight = Math.max(ShelfHeight, Y);
            LayerDepth = Math.max(LayerDepth, Z);
            Width = Math.max(Width, ShelfX);
            Height = Math.max(Height, ShelfY + Y);
        }
        const Depth = LayerZ + LayerDepth;
        const Limit = this.Exchange.Device.limits.maxTextureDimension3D;
        if (Depth > Limit)
            throw new Error(`Distance volumes need ${Depth} slices; the adapter allows ${Limit}`);
        this.SpaceExtent = [Width, Height, Math.max(Depth, 1)];

        this.Texture = this.Exchange.ConstructTexture({
            label: "Occupant distance space",
            size: this.SpaceExtent,
            dimension: "3d",
            format: "rgba16float",
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
        });
        this.TextureView = this.Texture.createView({ dimension: "3d" });

        const Layout = this.Exchange.ConstructDescriptorLayout(["Uniform", "StorageRead", "StorageRead", "StorageTexture3D:rgba16float"],
                                                                GPUShaderStage.COMPUTE, "Distance transfer");
        const Program = await this.Shaders.ConstructComputeProgram("DistanceTransfer.wgsl", "TransferDistance", [Layout]);
        const Device = this.Exchange.Device;

        let VoxelTotal = 0, VoxelDone = 0;
        for (const Volume of this.Volumes)
            VoxelTotal += Volume.Resolution[0] * Volume.Resolution[1] * Volume.Resolution[2];

        for (const Volume of this.Volumes)
        {
            const Set = Scene.FacetSets[Volume.FacetSet];
            const Corners = new Float32Array(Set.Facets.length * 9);
            Set.Facets.forEach((Facet, Index) =>
            {
                for (let Corner = 0; Corner < 3; ++Corner)
                    Corners.set(Facet.Corners[Corner], Index * 9 + Corner * 3);
            });
            const Structure = ConstructBoundingStructure(Corners);
            const NodeRecords  = this.Exchange.ConstructRecordsFrom(Structure.NodeScalars, GPUBufferUsage.STORAGE, `${Set.Name} nodes`);
            const FacetRecords = this.Exchange.ConstructRecordsFrom(Structure.FacetCorners, GPUBufferUsage.STORAGE, `${Set.Name} facets`);
            const SlicePlane = Volume.Resolution[0] * Volume.Resolution[1];
            const SlabSlices = Math.max(1, Math.floor(SlabVoxelBudget / SlicePlane));
            for (let Slab = 0; Slab < Volume.Resolution[2]; Slab += SlabSlices)
            {
                const SlabExtent = Math.min(SlabSlices, Volume.Resolution[2] - Slab);
                const Bytes = new ArrayBuffer(64);
                const Scalars = new Float32Array(Bytes);
                const Integers = new Uint32Array(Bytes);
                Scalars.set(Volume.Minimum, 0);
                Scalars[3] = Volume.VoxelExtent;
                Integers.set(Volume.TexelOrigin, 4);
                Integers[7] = Structure.NodeCount;
                Integers.set(Volume.Resolution, 8);
                Integers[11] = Structure.FacetCount;
                Integers[12] = Slab;
                Integers[13] = SlabExtent;
                Integers[14] = SignRayCount;
                const Uniform = this.Exchange.ConstructRecordsFrom(new Uint8Array(Bytes), GPUBufferUsage.UNIFORM, "Transfer record");
                const Group = this.Exchange.ConstructDescriptorGroup(Layout, [Uniform, NodeRecords, FacetRecords, this.TextureView]);
                const Encoder = Device.createCommandEncoder({ label: "Distance transfer" });
                const Pass = Encoder.beginComputePass({ label: `Transfer ${Set.Name}` });
                Pass.setPipeline(Program);
                Pass.setBindGroup(0, Group);
                Pass.dispatchWorkgroups(Math.ceil(Volume.Resolution[0] / 4), Math.ceil(Volume.Resolution[1] / 4), Math.ceil(SlabExtent / 4));
                Pass.end();
                Device.queue.submit([Encoder.finish()]);
                await Device.queue.onSubmittedWorkDone();
                Uniform.destroy();
                VoxelDone += SlicePlane * SlabExtent;
                if (ReportProgress)
                    ReportProgress(`Transferring distance volume: ${Set.Name}`, VoxelDone / VoxelTotal);
            }
            NodeRecords.destroy();
            FacetRecords.destroy();
        }
    }

    QueryVolume(Scene, FacetSet)
    {
        const Index = Scene.FacetSets[FacetSet].VolumeIndex;
        return Index >= 0 ? this.Volumes[Index] : null;
    }
}
