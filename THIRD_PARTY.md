# Third-party material for Projection Studio visuals

## TouchDesigner Studio

- [Three.js](https://github.com/mrdoob/three.js) — MIT, installed as `three` 0.187.0. Uses the maintained core plus official GLTFLoader, OBJLoader and PLYLoader add-ons for scan previews; no copied loader code.

- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x) — MIT, installed as `@modelcontextprotocol/sdk` 1.32.2 with `zod` 4.6.7. Used in the Electron main process for standards-based MCP Streamable HTTP, tool discovery/calls, and OAuth 2.1/PKCE support. No source modifications.
- [TouchDesigner TDMCP](https://github.com/TouchDesigner/TDMCP) — external user-installed MCP server/component; its official [Shared Use License](https://github.com/TouchDesigner/TDMCP/blob/main/LICENSE.md) permits use for projects but says TDMCP itself may not be redistributed as a product. Lumen does not bundle or copy its code.
- [Ollama](https://github.com/ollama/ollama) — local user-installed model runtime accessed through the documented HTTP API; no Ollama dependency or code copied.

The SDK installation added 78 packages in npm's reported installation tree. An owner-approved `npm audit --json` reported 18 dependency advisories (4 moderate, 13 high, 1 critical), including transitive `tar` and existing Electron/electron-builder components. Suggested fixes require major upgrades to existing build/runtime dependencies. No automatic fixes or unrelated dependency updates were applied; see STATUS.md and KNOWN_ISSUES.md.

## Projection Studio research

## Research only; no imported code or assets

The animation redesign is informed by these open-source projects and public graphics references. This milestone does not add a dependency, source file, shader, preset, or image from them.

- [Butterchurn](https://github.com/jberg/butterchurn) — MIT. Studied as a WebGL MilkDrop implementation; no code or presets copied.
- [projectM](https://github.com/projectM-visualizer/projectm) — LGPL-2.1 core library. Studied as a cross-platform MilkDrop-compatible design; no dependency or code copied. Any separately distributed preset packs require their own license review.
- [Stefan Gustavson: Simplex Noise Demystified](https://cgvr.cs.uni-bremen.de/teaching/cg_literatur/simplexnoise.pdf) and [Gustavson & McEwan: Tiling Simplex Noise and Flow Noise](https://jcgt.org/published/0011/01/02/paper.pdf) — algorithm references only; no source implementation copied.
- [Inigo Quilez procedural graphics articles](https://iquilezles.org/articles/) — SDF, palette, noise, and domain-warp references; no code copied. The canonical site returned HTTP 403 to the research browser during this milestone.
- [Craig Reynolds, Flocks, Herds, and Schools](https://www.cs.toronto.edu/~dt/siggraph97-course/cwr87/) — behavioral-model reference only; no implementation copied.
- [The Book of Shaders](https://thebookofshaders.com/) and [NVIDIA's Gray-Scott GPU sample](https://developer.download.nvidia.com/SDK/9.5/Samples/DEMOS/OpenGL/src/gpgpu_disease/docs/gpgpu_disease_userguide.pdf) — learning references only; no code or assets copied.

If implementation later imports or adapts third-party code, presets, or media, record the exact upstream revision, author, license, modifications, and required notices here before merging it.
