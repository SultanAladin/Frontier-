# Third-party notices

## Marching Cubes lookup data

`Source/MarchingCubesTables.h` contains the standard Lorensen–Cline edge and
triangle lookup values transcribed from the Three.js `MarchingCubes.js`
implementation.

Three.js is Copyright © 2010–2026 three.js authors and distributed under the MIT
License: https://github.com/mrdoob/three.js/blob/dev/LICENSE

The lookup data is used only to select cube edges and triangle topology. Project
Fluid's sparse field evaluation, dirty-brick cache, global edge welding,
gradient normals, topology checks, volume restoration, renderer, and OBJ export
are native implementations in this repository.
