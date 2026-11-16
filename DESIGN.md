# Projection Studio animation overhaul

Status: design approved for implementation by the project request; implementation has not started. This plan preserves the current project format and WebGL 1 renderer unless a measured compatibility need justifies a change.

## What exists today

`src/shared/proj-render.js` compiles 35 inline fragment shaders into one WebGL program per animation. All use the same shape-masked mesh, common hash/value-noise/fBm helpers, uniforms for hue/brightness/opacity/audio/evolution, and a CPU-side transition path. `ProjRenderer.render()` is called by `requestAnimationFrame` in both the editor preview and `src/renderer/projector.js`. The projector canvas is sized to up to 2x device pixel ratio. The editor has a preview-only draw-throttling heuristic; the full-screen projector has no quality selector or adaptive fallback. Several shaders use their own fixed RGB values or unrelated palette phase, despite sharing a hue offset. Existing audio features include six frequency bands, RMS, centroid, flux/onset, beat/tempo/phase, energy/trend/build/drop, and silence detection. Each project stores a stable string preset ID in each region.

No animation has been visually profiled on a real projector in this environment. Shader presence tests do not prove successful compilation on both platforms or that the imagery looks good on a wall.

## Research notes

- MilkDrop/projectM and Butterchurn demonstrate a preset-driven visualizer with per-frame audio controls and blended preset transitions. Lumen will borrow those interaction ideas, not embed an alternate engine or third-party presets. Butterchurn's source is MIT licensed; projectM's core is LGPL-2.1, with separate preset-pack licensing to check before any future use.
- Inigo Quilez's procedural graphics articles are useful references for signed-distance primitives, smooth unions, domain warping, palettes, and compact shader construction. The canonical article host returned HTTP 403 to the research browser, so exact article code was not copied or treated as verified source material.
- Stefan Gustavson's simplex-noise work discusses lower directional artifacts and continuous gradients; the 2022 tiling simplex/flow-noise work provides a basis for flowing fields. We will use independently written, bounded GLSL helpers and benchmark them in Lumen rather than import sample code.
- Reynolds' original boids model derives flock motion from local separation, alignment, and cohesion. For a wall visual, use a bounded field-following particle approximation rather than an all-pairs simulation.
- Gray-Scott reaction-diffusion is a compelling pattern source but normally needs state carried between frames. Treat it as an optional low-resolution ping-pong pass with a procedural fallback, and add it only if measured cost and WebGL 1 compatibility are acceptable.

Primary references:

- [projectM](https://github.com/projectM-visualizer/projectm) and its [LGPL-2.1 license](https://github.com/projectM-visualizer/projectm/blob/master/LICENSE.txt)
- [Butterchurn](https://github.com/jberg/butterchurn) and its [MIT license](https://github.com/jberg/butterchurn/blob/master/LICENSE)
- Inigo Quilez: [2D distance functions](https://iquilezles.org/articles/distfunctions2d/), [palettes](https://iquilezles.org/articles/palettes/), [domain warping](https://iquilezles.org/articles/warp/)
- Stefan Gustavson, [Simplex Noise Demystified](https://cgvr.cs.uni-bremen.de/teaching/cg_literatur/simplexnoise.pdf), and Gustavson & McEwan, [Tiling Simplex Noise and Flow Noise](https://jcgt.org/published/0011/01/02/paper.pdf)
- Craig Reynolds, [Flocks, Herds, and Schools](https://www.cs.toronto.edu/~dt/siggraph97-course/cwr87/)
- [Gray-Scott reaction-diffusion notes](https://www.nvidia.com/docs/io/8227/gdc2003_physsim_onsv.pdf) (GPU technique reference)
- [The Book of Shaders: Noise](https://thebookofshaders.com/11/)

No source code, shaders, preset files, or artwork from these projects is being copied into Lumen in this milestone. No new dependency is planned. If a later milestone imports implementation code or media, first verify its exact license and add its required notices in `THIRD_PARTY.md`.

## Current animation inventory and treatment

Primary families are editorial groups; shared helper techniques may appear across families. No existing preset is dropped. Existing stable IDs remain loadable and keep their current behavior until their family milestone lands.

| Family | Current IDs | Assessment and direction |
| --- | --- | --- |
| Flow | `aurora`, `fire`, `smoke`, `clouds`, `ocean`, `waves`, `flow`, `lava`, `rain`, `snow`, `rays` | Rebuild as distinct large-scale motion: layered curtains, rising flame, lifting smoke, slow cloud advection, wall-crossing tides, wind-shaped precipitation, and caustic light. `ocean`/`waves` and `flow`/`ink` currently overlap in warped fields; separate their spatial rhythm and silhouette. |
| Particles | `stars`, `particles`, `bokeh`, `fireflies`, `magic` | Several are repeated hash-grid dots. Rebuild as distinct depth, streaming, soft-focus, organic drift, and orbiting trails. Keep counts deterministic and quality-scaled. |
| Geometry | `warp`, `portal`, `energy`, `fractal`, `kaleido`, `tunnel`, `synth`, `rings`, `laser`, `disco`, `hex` | Preserve the recognizable shapes but improve edge stability, motion pacing, and restrained palettes. `portal`/`tunnel`/`rings` currently share radial emphasis; give them separate framing and movement. |
| Noise fields | `galaxy`, `nebula`, `plasma`, `ink` | Share a tested noise/palette foundation but preserve distinct silhouettes: spiral arms, broad luminous clouds, smooth energy bands, and pigment-like blooms. Reduce unbounded color mixing and high-frequency shimmer. |
| Reactive | `lightning` | Make onset/beat events clear but brief, clamp brightness, and ensure silent playback settles to a slow non-flashing idle. Reuse this feature mapping for reactive accents in other families. |
| Ambient | `gradient`, `glow`, `sunset` | Keep slow, low-contrast room-friendly scenes; make the selected palette consistent and avoid an unintended rainbow drift. |

There are 35 IDs in this inventory. The table intentionally describes current names, not final picker labels. New effects are additive: **Wall Tide** (long waves crossing the entire mapped region), **Ripple Choir** (overlapping bass-seeded SDF ripples), **Ribbon Weave** (highlights carried along a curl-like flow), **Murmuration** (boids-inspired particle streams), **Frame Drips** (gravity-driven drips attached to the mapped shape's upper edge), **Cell Garden** (soft-union metaball clusters), and **Reaction Bloom** (optional low-resolution Gray-Scott texture with fallback). Final names and grouping will be checked in a rendered picker before release.

## Shared visual contract

Every shader receives the same normalized input contract: palette ID and phase, shape hue offset, speed-scaled time, brightness, opacity, and audio controls. Per-shape settings and the saved project palette remain separate. Missing fields in older layouts receive defaults through `Proj.project()` and `Proj.region()`.

- Add a compact palette set designed for wall projection (for example: ember, tide, aurora, dusk, monochrome). Use a small number of clear stops and luminance-aware interpolation; do not interpolate unrelated saturated RGB endpoints into gray/mud.
- Make noise helpers deterministic and shared: smooth hash/value noise first; consider simplex/flow noise only after a shader cost comparison. Keep fBm octave count bounded by quality level. Use SDFs for stable circles, bands, edges, and smooth unions where they simplify masks.
- Map low bands/sub-bass to broad movement and scale; bass/beat to a soft pulse or ripple; mids to advection/rotation; high-mid/treble to sparse detail; onset/flux to short transients; build to gradual complexity; drop to one capped bloom; silence to a calm, continuing animation with no random bursts. Preserve attack/release smoothing and never turn audio noise into rapid full-screen flashes.
- Share movement design, not a single look: each shader needs an obvious main form at low quality and on a large wall. Keep projected geometry clipped to the mapped region.
- Transitions remain shape-local. Improve the current crossfade with smooth dissolve/noise masks and a small, authored family of wipes; event timing may follow a confident beat, but transitions must still complete on silence or tempo loss.

## Compatibility and migration

- Keep the saved JSON shape and project fields compatible. New fields are optional and normalized on load.
- Keep all 35 existing preset IDs forever as aliases. If a picker label changes, the saved ID continues to resolve. If an implementation is retired, add an explicit `PRESET_ALIASES` entry from the old ID to its replacement; apply aliases in one shared normalization path used by editor, projector, API, and tests.
- Do not rename region IDs or alter shape points while migrating. Verify a fixture containing all existing preset IDs, all starter layouts, unknown future fields, and missing new palette/quality fields.
- Keep the app's WebGL 1 path working on Windows and macOS. WebGL 2-only transforms/compute are out of scope unless an equivalent WebGL 1 path is supplied and tested. Handle context loss and shader compilation errors without crashing the UI.

## Performance and quality policy

Add Low / Medium / High quality, saved as an optional project setting; use Medium for older projects. The projector and preview each track frame intervals using a rolling window. If measured render cadence stays below 50 fps for a sustained window, step quality down; only recover one level after a longer stable window. Do not use blocking GPU queries in the frame loop.

Quality tiers should reduce internal render resolution and expensive shader detail/particle density before changing animation identity. Preserve the physical output canvas size and CSS size; render to a lower-resolution backing surface then scale cleanly. Clamp device pixel ratio and cap internal pixels. At low quality, retain the main shape, palette, and bass response. Report the active quality in the UI. Automatic fallback must be bounded and have hysteresis to prevent oscillation.

The renderer currently allocates some temporary geometry arrays and per-frame objects. Cache stable region data and reuse typed arrays/uniform buffers. Do not add a simulation texture until the simpler shader path has been profiled at 1920x1080 and 3840x2160 with many regions. Target 60 fps on a normal laptop; report measured hardware, resolution, frame-time distribution, and quality level. The target is not considered verified without a repeatable local benchmark and real GPU run.

## Lights contract

Keep Projection Lights' snapshot/restore path and provider rate limits intact. Keep target colors eased and clamp per-command RGB/brightness deltas so a palette transition cannot become strobing. Use the existing per-brand interval and latency profile. Tests must cover silence, beats/onsets, palette changes, rapid target changes, excluded devices, devices without color, dropped providers, stop/retry restore, and all three provider rate limits. Light animation remains asynchronous and cannot stall shader drawing.

## Milestones

### 1. Research and design (this commit)
- Record the audit, family inventory, migration rules, performance target, licenses, and implementation sequence in this file.
- Confirm current source anatomy and identify renderer quality/profile gaps; do not alter animation code.

### 2. Shared building blocks
- Add stable palette definitions, normalized audio-to-control mapping, and legacy ID migration helpers in `proj-core.js` or a focused shared module.
- Add deterministic tests for palette range/luminance behavior, feature response/decay/silence, aliases, old project round-trips, and rate-limited light targets.

### 3. Rebuild families
- Update current shaders family by family, keeping IDs and existing project behavior loadable. After each family, test shader inventory/migration and the shared audio contract; visually review sample captures before calling a look successful.

### 4. Add new animations and transitions
- Add Wall Tide, Ripple Choir, Ribbon Weave, Murmuration, Frame Drips, and Cell Garden; add Reaction Bloom only if its fallback and GPU cost are acceptable. Add picker preview names and animation-to-shader coverage tests.

### 5. Performance pass
- Add Low/Medium/High and adaptive fallback to both preview and projector, cache hot-path data, and benchmark at 1080p and 4K. Verify no quality oscillation, no context-loss crash, and no regression to shape mapping or lights.

Each milestone runs `npm test`, updates `STATUS.md`, `TODO.md`, `KNOWN_ISSUES.md`, and `CHANGELOG.md` (plus this file and `THIRD_PARTY.md` when appropriate), then commits and pushes to `main`. Report owner eye-checks at every milestone; never substitute a shader-presence test for visual approval.
