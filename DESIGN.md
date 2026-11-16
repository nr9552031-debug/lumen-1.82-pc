# Projection Studio animation overhaul

Status: milestones 1–4 and the milestone 5 implementation are complete. The 35 original preset IDs remain stable and six new effects bring the picker to 41; all have shared palette/audio shaders and individual music/evolution profiles. Projects now save Low/Medium/High quality and automatic fallback. CPU/source tests pass, but GLSL compilation, by-eye appearance, and 1080p/4K GPU performance still need Mac/PC hardware verification.

## What exists today

`src/shared/proj-render.js` contains 41 inline fragment shaders and compiles one WebGL program per animation. All use the same shape-masked mesh, common hash/value-noise/fBm helpers, uniforms for hue/brightness/opacity/audio/evolution, and a CPU-side transition path. The editor preview targets 60Hz and the full-screen projector uses `requestAnimationFrame`. Both read the saved quality tier, scale the canvas backing resolution while keeping CSS/mapped geometry fixed, and cap the internal canvas at 4096 pixels per edge and 8,388,608 pixels total. The shared fBm helper uses five, four, or three octaves for High, Medium, or Low. A sustained frame interval over 20ms lowers one tier after 1.2 seconds; recovery takes six stable seconds per tier and never exceeds the saved tier. The active preview tier appears in Visuals, and a projector hint briefly reports changes. Audio features include six frequency bands, RMS, centroid, flux/onset, beat/tempo/phase, energy/trend/build/drop, and silence detection.

Stable shape geometry is compared against saved point coordinates and uploaded into a per-shape WebGL buffer only when the shape changes. Stale buffers are deleted and are rebuilt after context restoration. This removes the previous per-frame JSON key creation and repeated geometry uploads. No GPU timing or performance improvement is verified in this environment.

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

Primary families are editorial groups; shared helper techniques may appear across families. No existing preset is dropped or renamed. Stable IDs remain loadable while their shader implementations receive the planned family treatments.

| Family | Current IDs | Assessment and direction |
| --- | --- | --- |
| Flow | `aurora`, `fire`, `smoke`, `clouds`, `ocean`, `waves`, `flow`, `lava`, `rain`, `snow`, `rays`, `wall-tide`, `ribbon-weave`, `frame-drips` | Rebuilt with distinct large-scale movement: layered curtain bands, rising flame, lifted smoke, broad cloud masses, crossing water caustics, traveling crests, warped current bands, slow magma cells, falling rain, drifting flakes, sun shafts, wall-wide tides, domain-warped ribbons, and gravity drips along a mapped shape's upper edge. `ocean`/`waves` remain separate water-surface and traveling-crest structures. Appearance needs a visual check. |
| Particles | `stars`, `particles`, `bokeh`, `fireflies`, `magic`, `murmuration` | Rebuilt as depth-layered star drift, directional streams, ten soft-focus bokeh lights, sixteen slow fireflies, orbital motes/ribbons, and a bounded sixteen-point boids-inspired flock. Fixed loops are bounded at sixteen or fewer; GPU cost remains unmeasured. |
| Geometry | `warp`, `portal`, `energy`, `fractal`, `kaleido`, `tunnel`, `synth`, `rings`, `laser`, `disco`, `hex`, `ripple-choir` | Rebuilt as warped current bands, a portal aperture, perimeter rails, capped Julia field, mirrored mandala, perspective tunnel, synth horizon, expanding rings, beam fans, rotating facets, honeycomb pulses, and five overlapping SDF ripple centers with softened beat echoes. |
| Noise fields | `galaxy`, `nebula`, `plasma`, `ink`, `cell-garden` | Rebuilt around spiral arms/stars, broad domain-warped veils, plasma interference, marbled pigment pools, and seven smooth-union metaball cells. Each uses the shared palette and bounded fBm sampling; GPU cost remains unmeasured. |
| Reactive | `lightning` | Rebuilt as a stable branching bolt that only blooms from bounded onset, beat, or drop controls. Silence keeps a dim palette field with no periodic strike timer. |
| Ambient | `gradient`, `glow`, `sunset` | Rebuilt as a low-contrast spatial gradient, two slowly breathing soft light pools, and a palette-based horizon/sun/reflection. These shaders contain no hash-speckle layer; GPU appearance still needs review. |

The original 35 IDs remain unchanged; six effects are additive, for 41 total. Wall Tide carries long bass-led crests across a mapped region; Ripple Choir overlays five softly cycling SDF centers; Ribbon Weave carries three highlights through a warped field; Murmuration uses a bounded orbital flock approximation; Frame Drips draws gravity-led drops from the region's top edge; and Cell Garden blends seven moving metaball fields. **Reaction Bloom** remains a research candidate, deferred until the lower-resolution quality path can be measured because it requires stateful GPU passes. The picker grouping and saved IDs have source and round-trip checks; visual review is still outstanding.

## Shared visual contract

Every shader receives the same normalized input contract: palette ID and phase, shape hue offset, speed-scaled time, brightness, opacity, and audio controls. Per-shape settings and the saved project palette remain separate. Missing fields in older layouts receive defaults through `Proj.project()` and `Proj.region()`.

- Add a compact palette set designed for wall projection (for example: ember, tide, aurora, dusk, monochrome). Use a small number of clear stops and luminance-aware interpolation; do not interpolate unrelated saturated RGB endpoints into gray/mud.
- Make noise helpers deterministic and shared: smooth hash/value noise first; consider simplex/flow noise only after a shader cost comparison. Keep fBm octave count bounded by quality level. Use SDFs for stable circles, bands, edges, and smooth unions where they simplify masks.
- Map low bands/sub-bass to broad movement and scale; bass/beat to a soft pulse or ripple; mids to advection/rotation; high-mid/treble to sparse detail; onset/flux to short transients; build to gradual complexity; drop to one capped bloom; silence to a calm, continuing animation with no random bursts. Preserve attack/release smoothing and never turn audio noise into rapid full-screen flashes.
- Share movement design, not a single look: each shader needs an obvious main form at low quality and on a large wall. Keep projected geometry clipped to the mapped region.
- Transitions remain shape-local. Improve the current crossfade with smooth dissolve/noise masks and a small, authored family of wipes; event timing may follow a confident beat, but transitions must still complete on silence or tempo loss.

## Compatibility and migration

- Keep the saved JSON shape and project fields compatible. New fields are optional and normalized on load.
- Keep all 35 original preset IDs and every added ID stable. If a picker label changes, the saved ID continues to resolve. If an implementation is retired, add an explicit `PRESET_ALIASES` entry from the old ID to its replacement; apply aliases in one shared normalization path used by editor, projector, API, and tests.
- Do not rename region IDs or alter shape points while migrating. Verify a fixture containing all existing preset IDs, all starter layouts, unknown future fields, and missing new palette/quality fields.
- Keep the app's WebGL 1 path working on Windows and macOS. WebGL 2-only transforms/compute are out of scope unless an equivalent WebGL 1 path is supplied and tested. Handle context loss and shader compilation errors without crashing the UI.

## Performance and quality policy

Low / Medium / High quality is saved in the project; older layouts normalize to Medium with automatic fallback enabled. The projector and preview observe frame intervals without blocking GPU queries. If cadence stays below 50fps for 1.2 seconds, the tier steps down. Recovery takes six stable seconds and raises only one tier at a time. The user-selected tier is the ceiling, and disabling automatic fallback holds it.

Quality tiers reduce internal render resolution and fBm detail before changing animation identity. Preserve the physical output canvas size and CSS size; render to a lower-resolution backing surface then scale cleanly. Clamp device pixel ratio and cap internal pixels. At low quality, retain the main shape, palette, and bass response. Report the active preview quality in Visuals and briefly report projector tier changes. The hardware-free tests exercise downgrade/recovery timing, the saved ceiling, disabled fallback, and large-canvas caps; actual frame cadence is not verified.

The geometry cache now avoids per-frame string construction and reuses one static WebGL buffer per unchanged shape. Some temporary arrays remain on shape edits and project changes. Do not add a simulation texture until the simpler shader path has been profiled at 1920x1080 and 3840x2160 with many regions. Target 60fps on a normal laptop; report measured hardware, resolution, frame-time distribution, and quality level. The target is not verified without a repeatable local benchmark and real GPU run.

## Lights contract

Keep Projection Lights' snapshot/restore path and provider rate limits intact. Target colours start from the saved live state, ease toward the picture, and cap each normal follow-picture command at 12–80 RGB values and 10–60 brightness values according to that brand's command interval. `node test/projection.js` simulates each brand's configured interval, verifies per-command caps, and confirms Stop restores the original state. Real bulbs, white-only devices, cue timing, and visual smoothness remain hardware checks. Light animation stays asynchronous and cannot stall shader drawing.

## Milestones

### 1. Research and design (this commit)
- Record the audit, family inventory, migration rules, performance target, licenses, and implementation sequence in this file.
- Confirm current source anatomy and identify renderer quality/profile gaps; do not alter animation code.

### 2. Shared building blocks
- [x] Add stable palette definitions/OKLab sampling, bounded audio feature semantics, and a central preset ID resolver in `proj-core.js`.
- [x] Add deterministic tests for palette range/defaulting, feature mapping/silence, legacy ID resolution, and project palette round-trips.
- Remaining: exercise profile attack/release and rate-limited light behavior with the existing light service tests. Palette consumption is an initial milestone 3 integration; the visual family rebuild is still outstanding.

### 3. Rebuild families
- [x] Add the saved shared-palette selector to Visuals and upload one reusable palette texture to the shared shader. Hardware-free tests cover texture bytes, cyclic endpoints, project selection persistence, and source wiring; this does not verify GLSL compilation or appearance.
- [x] Rebuild the 11 original Flow shaders while keeping their saved IDs. Hardware-free tests confirm each shader source uses the shared palette/audio controls and profile checks cover bounded audio response and quiet transients. GLSL compilation and appearance are still unverified.
- [x] Rebuild the 5 Particle shaders with deterministic, bounded loops and distinct motion forms. Hardware-free tests check palette/audio wiring and constant loop bounds; GLSL compilation and appearance are still unverified.
- [x] Rebuild the 11 Geometry shaders with distinct SDF/polar/tile structures. The fractal iteration cap is reduced from 40 to 28; hardware-free tests check palette/audio wiring and loop bounds, not GLSL compilation or appearance.
- [x] Rebuild the 4 Noise Field shaders with spiral, cloud, interference, and pigment structures. Hardware-free tests check shared palette/audio source wiring; GLSL compilation and appearance are still unverified.
- [x] Rebuild Lightning as an event-triggered bolt with a quiet idle. Hardware-free tests check beat/onset/drop feature mapping and confirm the shader no longer has a periodic flash timer; appearance is still unverified.
- [x] Rebuild the 3 Ambient shaders as slow, restrained room scenes using the shared palette.
- [x] Rebuild all 35 original preset IDs family by family while keeping their saved IDs and project data compatible. Source/audio checks pass; visual captures and GPU verification remain outstanding.

### 4. Add new animations and transitions
- [x] Add six new effects, individual profiles, stable picker IDs, and a shape-local Ripple Reveal transition. Tests cover all 41 IDs, bounded shader loop sizes, source wiring, and save/load of a new animation and transition. No visual or GPU claim is made.
- [x] Keep all previous IDs and transition values compatible; append `ripple` after the existing transition values. Reaction Bloom stays deferred until a measured low-resolution multipass path is available.

### 5. Performance pass
- [x] Add saved Low/Medium/High, automatic frame-time fallback with six-second recovery, resolution/pixel caps, and fewer fBm octaves for both preview and projector. Hardware-free timing and canvas-size tests pass.
- [x] Cache stable per-shape geometry in WebGL buffers and avoid rebuilding geometry keys or uploading unchanged vertices every frame. Source checks pass; GPU-time benefit is not measured.
- [x] Seed picture-following bulb ramps from saved live RGB/white state and cap each output command while keeping provider intervals and Stop restoration. Simulated tests pass for WiZ, Cync, and Hubspace timing.
- [ ] Benchmark at 1080p and 4K on Mac and PC, verify actual GLSL compile/context-loss behavior, inspect quality transitions for oscillation, and check all 41 looks on a real wall/projector. No visual or frame-rate target is yet verified.

Each milestone runs `npm test`, updates `STATUS.md`, `TODO.md`, `KNOWN_ISSUES.md`, and `CHANGELOG.md` (plus this file and `THIRD_PARTY.md` when appropriate), then commits and pushes to `main`. Report owner eye-checks at every milestone; never substitute a shader-presence test for visual approval.
