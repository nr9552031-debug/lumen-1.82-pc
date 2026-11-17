# CHANGELOG

## Unreleased (2026-11-16)
- Projection Studio: use Three.js official glTF/OBJ/PLY loaders for an interactive orbit/zoom 3D preview and mesh selection of imported scans. Add no custom model decoder.
- Make multi-bulb WiZ simulation portable: use `127.0.0.1` and per-bulb ephemeral ports rather than requiring 127.0.0.10–29 loopback aliases; preserve the real device default UDP port.
- Projection Studio: add opt-in phone scan intake through an expiring eight-digit local-network code, a mobile browser upload page, bounded file/count handling, format-header checks, and persisted scan manifests. Supports common exported meshes and textures without adding a phone-specific scanner dependency.
- Extend Projection Studio AI Pipeline with user-selected PNG upload and 16:9/mask-contrast validation before ComfyUI use; reject path-bearing filenames and restrict non-loopback HTTP.
- Set package version to the owner-specified 1.8.19; existing CI offset 5 produces 1.8.20 for the next workflow run (currently run 25).
- Projection Studio: add an AI Pipeline tab for importing ComfyUI API workflows, checking available node classes on the running server, queueing the exact imported graph, and checking execution history. Restrict plain HTTP to loopback and enforce the 10 MB JSON limit. No model-specific graph is fabricated.
- TouchDesigner Studio: add a persistent ComfyUI + ComfyTD setup checklist and local ComfyUI API workflow JSON validator. The checker identifies API node count and common parameters, rejects editor-layout JSON, and caps input at 10 MB; it does not run graphs or verify installed models/custom nodes.
- TouchDesigner Studio: turn the generic tool chat into a clear animation-authoring flow; ask the local agent to build a playable scene, inspect previews, and disclose missing character assets. Add one-retry recovery for malformed Ollama tool calls and explicit incomplete-run status. Let the owner approve routine operator edits for the current animation run while retaining separate approval for code, deletion, save, export and file operations.
- Add TouchDesigner Studio: connect through the official TDMCP Streamable HTTP MCP server with OAuth 2.1/PKCE, dynamically discover tools, and use local Ollama tool calling to inspect/build/iterate TouchDesigner networks. Gate all non-read-only tools behind per-call approval, flag Python execution/deletion as high risk, and support cancellation, logs, current project info and embedded output image preview. TDMCP remains user-installed and is not bundled due to its Shared Use License. Add the official MCP SDK and local policy/installation documentation.
- Add a hardware-free TouchDesigner test for endpoint security, MCP initialization/tool discovery/invocation/disconnect, Ollama agent loop, and explicit write approval.
- Add Technology Optimization foundation: read-only dependency inventory, manual GitHub search, saved proposals and explicit approval states. No dependency or existing feature changes. Periodic monitoring and security advisory checks remain planned.
- Add permanent open-source-first and forward-only development rules to AGENTS.md.
- Projection Studio: strengthen the common palette grade and saturation so animations use more vivid, psychedelic color on both preview and projector.
- Projection Studio: add saved Low/Medium/High render quality to preview and projector, 8MP backing-canvas caps, 5/4/3-octave fBm tiers, and adaptive one-step fallback with a six-second stable recovery. New geometry buffers upload only when a mapped shape changes.
- Projection Lights: initialize picture-following ramps from the saved live light state and cap each ordinary RGB/brightness command according to its provider interval; keep brand rate limits and Stop restoration.
- Projection Studio: add Wall Tide, Ripple Choir, Ribbon Weave, Murmuration, Frame Drips, and Cell Garden with per-effect audio/evolution profiles; add a saved Ripple Reveal transition. Keep all 35 previous animation IDs and their layouts intact.
- Projection Studio: rebuild the Ambient animations as a steady gradient, soft light pools, and a palette-based sunset; remove hash speckles from the ambient scenes.
- Projection Studio: make Lightning a bounded beat/onset/drop effect with a quiet idle instead of repeated random flashes during silence.
- Projection Studio: rebuild Galaxy, Nebula, Plasma, and Ink as distinct spiral, cloud veil, interference, and marbled-pigment effects.
- Projection Studio: rebuild the 11 Geometry animations with distinct portal, tunnel, ripple, kaleidoscope, synth horizon, laser, disco, honeycomb, energy, warp, and Julia forms. Cap fractal iteration work at 28 steps.
- Projection Studio: rebuild the five Particle animations as layered star drift, streaming trails, soft-focus bokeh, slow fireflies, and orbital motes/ribbons; bound their repeated shader loops.
- Projection Studio: rebuild the 11 Flow animations with distinct curtains, flame, smoke, clouds, caustic water, crossing waves, currents, magma cells, falling rain, drifting snow, and sun shafts. Existing animation IDs and saved layouts remain compatible.
- Projection Studio: add a saved shared-palette selector to Visuals and feed a reusable, seamless palette texture into the common shader. Brightness is applied after palette mapping, per-shape Colour shift offsets the palette, and context restoration retains the selected palette.
- Projection Studio: add shared palette definitions and OKLab sampling, bounded audio-feature semantics, and an animation-ID compatibility resolver with hardware-free coverage. This shared-logic step preceded the shader integration recorded above.
- Projection Studio: document the researched animation overhaul, six current visual families, saved-preset compatibility, shared visual/audio contract, performance policy, new effect concepts, and open-source research/licenses in DESIGN.md and THIRD_PARTY.md. No runtime code or dependencies changed.
- Projection Studio: keep the pre-show bulb snapshot when a light is dropped after repeated output failures, allowing Stop to restore it.
- Projection Studio: prevent a replaced projector window's close event from clearing the new window state.
- Projection Studio: explain that macOS system audio is unavailable and switch to the microphone when no system audio track is supplied.
- Projection Studio: capture debounced saves per layout so switching projects cannot redirect or discard pending shape edits; flush before deleting a layout.
- Projection Studio: wait for in-flight bulb writes before restoring, share concurrent Stop work, and hold native app quit until active lighting drivers finish.
- Projection Studio: retain snapshots for failed or unavailable bulb restores, show the reason, and allow retries from the Lights tab.
- Projection Studio: keep delayed room-photo imports attached to the layout that selected the file.
- Projection Studio: ignore beat-scheduled shape changes after switching away from their layout or removing the shape.
- Projection Studio: retry retained bulb restores during app shutdown, even when no show is active.
- Projection Studio: preserve independent RGB snapshots and zero brightness values when restoring bulbs.
- Add hardware-free checks for Projection Studio project persistence and restore after output failures.
- Check that every picker animation has a shader, each animation belongs to one group, and all page script references exist.
- Correct the README animation count to the 35 presets provided by the current code.

## 2026-11-15
- Automatic versioning: each build on main gets the next patch version (1.8.3, 1.8.4, ...); release title and file names show it. Unverified until the first build runs.
- Mac build: ad-hoc signing (`mac.identity` "-") to avoid the "damaged" error. Unverified.
- Repo restructured: app moved to the repo root; legacy zip removed.
- Added CI (tests on Windows/macOS/Linux) and automatic PC + Mac builds published to the `latest` release.
- `npm test` now runs the existing WiZ tests only.
- Added shared engineering rules (AGENTS.md) and project docs (PROJECT, ARCHITECTURE, STATUS, TODO, KNOWN_ISSUES, CHANGELOG).
