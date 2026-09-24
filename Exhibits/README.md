# Frontier lighting exhibits

The five `SurfelGI_CornellBox_View*.png` files are deterministic views of the Project-Zero Cornell Box. The camera coordinate bug was corrected, and the exhibit render was raised from 8 to 32 indirect candidates with four spatial resampling passes.

The generic mesh-surfel backend is in `PhotometricIllumination/SurfelGlobalIllumination.*`. Its cache is denser by default, uses multi-surfel weighted reprojection instead of a single nearest surfel, transports source albedo correctly, and exposes a configurable shadow callback. It does not use an SDF.

Important status: Project-Zero's current renderer still uses its older ReSTIR reference path to produce these images; the dedicated surfel backend is not yet connected to `RayTracingSolver`. The remaining integration step is to feed the triangle solver into `SurfelShadowQuery` and replace the per-pixel bounce stage with the surfel cache for a true Surfel-vs-ReSTIR A/B render. The visible speckle is therefore primarily the current low-sample ReSTIR reference, not a claim that the surfel path itself must look this noisy.
