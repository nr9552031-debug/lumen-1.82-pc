# Third-party material for Projection Studio visuals

## Research only; no imported code or assets

The animation redesign is informed by these open-source projects and public graphics references. This milestone does not add a dependency, source file, shader, preset, or image from them.

- [Butterchurn](https://github.com/jberg/butterchurn) — MIT. Studied as a WebGL MilkDrop implementation; no code or presets copied.
- [projectM](https://github.com/projectM-visualizer/projectm) — LGPL-2.1 core library. Studied as a cross-platform MilkDrop-compatible design; no dependency or code copied. Any separately distributed preset packs require their own license review.
- [Stefan Gustavson: Simplex Noise Demystified](https://cgvr.cs.uni-bremen.de/teaching/cg_literatur/simplexnoise.pdf) and [Gustavson & McEwan: Tiling Simplex Noise and Flow Noise](https://jcgt.org/published/0011/01/02/paper.pdf) — algorithm references only; no source implementation copied.
- [Inigo Quilez procedural graphics articles](https://iquilezles.org/articles/) — SDF, palette, noise, and domain-warp references; no code copied. The canonical site returned HTTP 403 to the research browser during this milestone.
- [Craig Reynolds, Flocks, Herds, and Schools](https://www.cs.toronto.edu/~dt/siggraph97-course/cwr87/) — behavioral-model reference only; no implementation copied.
- [The Book of Shaders](https://thebookofshaders.com/) and [NVIDIA's Gray-Scott GPU sample](https://developer.download.nvidia.com/SDK/9.5/Samples/DEMOS/OpenGL/src/gpgpu_disease/docs/gpgpu_disease_userguide.pdf) — learning references only; no code or assets copied.

If implementation later imports or adapts third-party code, presets, or media, record the exact upstream revision, author, license, modifications, and required notices here before merging it.
