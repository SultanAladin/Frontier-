# Rendering exhibits

`SurfelGI_CornellBox.png` is the rendered Project-Zero Cornell-box scene after fixing the demo camera coordinate. It is the current ReSTIR ray-traced baseline scene used to validate the lighting composition; the new generic mesh-surfel backend is implemented in `PhotometricIllumination/SurfelGlobalIllumination.*` but is not yet selected by Project-Zero's dedicated renderer.

The image shows why the surfel path needs temporal reuse and spatial filtering: the baseline is visibly noisy from the low sample count. The next renderer step is to feed the Project-Zero triangle solver into the surfel shadow callback and render a direct A/B comparison using the same camera and light.
