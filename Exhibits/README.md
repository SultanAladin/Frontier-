# Frontier lighting exhibits

`SurfelGI_CornellBox_View1.png` through `View5.png` are five deterministic views of the Project-Zero Cornell Box after routing the exhibit composition through a mesh-surface surfel cache. The path now samples actual triangle hits, gathers direct irradiance between surfels with `RayTracingSolver::EvaluateOcclusion`, and uses normal/depth-aware reprojection rather than noisy random bounce radiance.

The surfel path is deliberately diffuse GI: it evaluates the material albedo and emissive-light response used by the current analytical scene. The current Project-Zero material model does not yet apply roughness or metallic BRDF terms in this CPU reference renderer; those properties must be added before this is a full PBR material evaluation. The generic `SurfelGlobalIllumination` backend does carry albedo, roughness, and metallic through `MaterialCodec`, but its current reference gather is diffuse.

The cache is mesh-only—no SDF or voxel GI. The broad soft edges in the images are the intended one-bounce diffuse transport and shadow penumbra, not temporal speckle. Production sharpening should use a BVH/spatial surfel index and temporal accumulation rather than increasing blur.
