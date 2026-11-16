# STATUS
Last updated: 2026-11-16. VERIFIED = has real test/log evidence. Everything else is UNVERIFIED.

## Session log (newest first; every agent adds an entry after every update)
### 2026-11-16 Codex (TouchDesigner Studio and local Ollama agent)
- Added TouchDesigner Studio as a new navigation workspace. Main process now connects to the official TDMCP Streamable HTTP server via the official MCP TypeScript SDK, performs OAuth 2.1/PKCE with a loopback callback and encrypted safeStorage tokens, dynamically discovers tools, fetches project info, and supports manual reconnect/disconnect. Added local Ollama model discovery and bounded tool-calling agent loop with session context, cancellation, TDMCP tool logs, project info, embedded image preview, and per-call approval for every non-read-only operation; deletion and `execute_code` are visibly marked high risk. Added setup and license documentation; TDMCP.tox is never bundled.
- Added `@modelcontextprotocol/sdk` 1.32.2 (MIT) and its `zod` 4.6.7 peer dependency after reviewing official TDMCP, MCP SDK, and Ollama docs. `node test/touchdesigner.js` passes endpoint security, a real local MCP SDK Streamable HTTP initialize/list/call/close simulation, local agent looping, image-result plumbing, and mutation approval. `node --check` and `git diff --check` pass. `npm test` passes Projection and TouchDesigner checks, then stops at the known WiZ fixture bind (`EADDRNOTAVAIL 127.0.0.70:38899`). Windows `npm run dist` succeeds and produces installer + portable exe. Mac `npm run dist:mac` fails because existing `build/icon.png` is under the 512×512 minimum. No live TouchDesigner/Ollama test was possible; TDMCP OAuth consent, actual operator edits, image feedback, Windows runtime UI and macOS runtime UI are UNVERIFIED.
- `npm install` reported 18 advisories (4 moderate, 13 high, 1 critical). `npm audit --json` could not reach registry in sandbox; its escalated request was rejected by the automatic approval reviewer because it sends dependency metadata to npm and the user had not specifically approved that export. No audit fixes were applied. `git pull` still fails due this worktree’s protected linked gitdir; GitHub HTTPS push auth is also unavailable. Next: run with TouchDesigner 2025.33230+ and Ollama with a tool-using vision model on real Mac/PC, resolve/fix existing Mac icon asset separately, and obtain explicit authorization before sending dependency inventory to npm audit.
- Follow-up after owner approval: `npm audit --json` completed. It confirms 18 findings (4 moderate, 13 high, 1 critical); the critical finding is in transitive `tar`, with additional high findings in Electron 33 and electron-builder's build chain. Suggested remediation includes major upgrades to Electron 45.3.3 and electron-builder 26.18.0. These are existing systems and outside this feature's authorized forward-only scope, so no package versions or lock entries were changed.

### 2026-11-16 Codex (Technology Optimization foundation)
- Added an additive Technology Optimization page with local read-only direct dependency inventory, manual GitHub repository search, saved opportunities, approve/dismiss/completed states, and history. Added the permanent forward-only/open-source-first policy to AGENTS.md. No dependencies or existing lighting features were changed.
- `node --check` passes for touched JavaScript and `git diff --check` passes. `npm test` passes Projection checks then stops at the known WiZ simulator bind (`EPERM 127.0.0.70:38899`). UI runtime, GitHub search, and package inventory have not been exercised in Electron. The packaged app has no package-lock, so its dependency inventory is limited; vulnerability analysis, automatic periodic monitoring, performance/storage measurements, and detailed optimization proposals remain unimplemented. The interval selector is marked planned and does not start background work.
- `git pull` could not run because this worktree’s gitdir resolves to protected `/Users/noahrichman/Documents/GitHub/lumen-1.82-pc/.../FETCH_HEAD`. Next: complete the monitoring/audit data model and exercise the page in the app; then commit and push through an approved git path.

### 2026-11-16 Codex (vivid Projection Studio color grade)
- Owner reported washed-out animation colors and asked for intense psychedelic colors. Increased the common shader's shared-palette influence from 32% to 72%, added a stronger chroma grade, and kept the change in the common renderer used by preview and projector. Added a source assertion for the grade.
- `node test/projection.js` passes, including the new common-shader vivid-grade assertion. `npm test` passes Projection checks then stops at the known local WiZ simulator bind (`EPERM 127.0.0.70:38899`). Shader appearance still needs an owner eye-check on Mac and PC because this host cannot launch the Electron UI or compile/render GLSL.

### 2026-11-16 Codex (animation overhaul milestone 5 quality, performance, and light output)
- Added project-saved Low/Medium/High quality (Medium for old layouts), per-frame automatic downgrade after 1.2 seconds below 50fps, one-tier recovery after six stable seconds, and a 4096-edge/8MP backing-buffer cap in preview and projector. Quality also selects 3/4/5 fBm octaves. Preview now targets a 16ms loop. Visuals shows the preview tier; projector briefly reports tier changes.
- Cached each unchanged shape's WebGL vertex buffer and point coordinates, avoiding per-frame JSON key construction and repeated geometry upload. Buffers are deleted when stale and rebuilt after context restore. Projection Lights now starts its ramp from saved RGB or Kelvin-derived white and caps normal picture-following RGB/brightness changes based on the actual provider interval; Stop still restores the original snapshot.
- `node test/projection.js` passes saved quality round-trip/defaulting, timing hysteresis, resolution caps, source/cache checks, and command-step/rate-limit/restore simulations for WiZ, Cync, and Hubspace. All touched JavaScript passes `node --check`; `git diff --check` passes. `npm test` passes Projection checks but stops at the known WiZ fixture bind (`EPERM 127.0.0.70:38899`). `npm start` still exits with Electron `SIGABRT` before a window appears.
- The milestone 4 commit `3180542` passed GitHub Actions on Windows, macOS, and Linux. Next: publish this performance implementation, then have the owner inspect every animation and transition and measure 1080p/4K frame times on real Mac and PC hardware. The GPU target and looks remain unverified here.

### 2026-11-16 Codex (animation overhaul milestone 4 new effects and Ripple Reveal)
- Added Wall Tide, Ripple Choir, Ribbon Weave, Murmuration, Frame Drips, and Cell Garden as six new stable animation IDs with per-effect audio/evolution profiles. Kept all 35 previous IDs and added Ripple Reveal as a project-saveable transition without changing the existing transition order. Updated the picker groups and README count to 41.
- `node test/projection.js` passes the 41-ID inventory, per-profile bounds and silence checks, per-shader palette/audio source and loop bounds, and save/load round-tripping for Frame Drips and Ripple Reveal. `node --check` for the touched JavaScript and `git diff --check` pass. `npm test` passes the Projection test, then stops at the known WiZ fixture bind (`EPERM 127.0.0.70:38899`). No GLSL compiler/GPU or visible app is available here, so compile, appearance, and frame-rate behavior are unverified.
- Next: milestone 5 quality tiers, adaptive fallback with hysteresis, and render-path performance improvements. Owner should try all six new effects, Ripple Reveal, saved layouts, and room-scale appearance on Mac and PC.

### 2026-11-16 Codex (animation overhaul milestone 3 Ambient family)
- Rebuilt Gradient as a steady spatial wash, Glow as two slowly breathing soft pools, and Sunset as a palette-based sky, sun, cloud band, and water reflection. The ambient shaders no longer add random-looking hash speckles. All 35 existing preset IDs now have family rebuilds; no preset or saved layout field was removed.
- `node --check src/shared/proj-render.js` and `node --check test/projection.js` pass. `node test/projection.js` verifies palette/audio wiring and no hash speckles in these three ambient shaders, plus source/profile checks from the other families. `npm test` passes Projection checks, then fails at the known WiZ fixture bind (`EPERM 127.0.0.70:38899`). Shader compile, GPU performance, and appearance remain unverified.
- Next: add new animations and transition treatments (milestone 4). Keep all by-eye review and Windows/Mac GPU checks on the owner’s list.

### 2026-11-16 Codex (animation overhaul milestone 3 Reactive family)
- Rebuilt Lightning as a deterministic branching bolt that appears only on beat, onset, or drop signals. Removed the old time-driven strike timer that flashed even during silence; intensity is clamped and the quiet background remains palette-driven.
- `node --check src/shared/proj-render.js` and `node --check test/projection.js` pass. `node test/projection.js` verifies onset/beat/drop profile values and confirms Lightning has no periodic idle flash timer. `npm test` passes Projection checks, then fails at the known WiZ fixture bind (`EPERM 127.0.0.70:38899`). No GPU appearance check is available.
- Next: rebuild Ambient. Still need visual checks on Mac and PC and frame-time measurements.

### 2026-11-16 Codex (animation overhaul milestone 3 Noise Fields family)
- Rebuilt Galaxy as spiral-arm dust and stars, Nebula as broad warped veils, Plasma as slow interference, and Ink as marbled pigment pools. Preset IDs remain the same; all four use the shared palette and common controls.
- `node --check src/shared/proj-render.js` and `node --check test/projection.js` pass; `node test/projection.js` verifies each Noise Field shader source includes palette and audio controls. `npm test` passes Projection checks and then fails at the known WiZ fixture bind (`EPERM 127.0.0.70:38899`). No GLSL compiler/GPU appearance run is available.
- Next: rebuild Reactive and Ambient. Still need Windows/Mac shader compilation, projector eye-check, and performance measurements.

### 2026-11-16 Codex (animation overhaul milestone 3 Geometry family)
- Rebuilt all 11 Geometry shaders: warped currents, portal aperture, energy rails, Julia fractal, kaleidoscope, perspective tunnel, synth horizon, centered rings, laser beams, disco facets, and honeycomb. The fractal loop cap drops from 40 to 28. Existing preset IDs remain unchanged.
- `node --check src/shared/proj-render.js` and `node --check test/projection.js` pass; `node test/projection.js` verifies palette/audio controls in each Geometry shader and constant loop bounds. `npm test` passes Projection checks, then fails at the known WiZ fixture bind (`EPERM 127.0.0.70:38899`). No shader compiler or GPU rendering is available.
- Next: rebuild Noise Fields. Need Mac/PC compilation, wall appearance, and 1080p/4K performance evidence.

### 2026-11-16 Codex (animation overhaul milestone 3 Particles family)
- Rebuilt the 5 Particle shaders as drifting depth-layered stars, directional streams, ten soft-focus bokeh lights, sixteen slowly breathing fireflies, and orbiting motes/ribbons. Fixed constant loop counts keep these effects deterministic and cap repeated particle work.
- `node --check src/shared/proj-render.js` and `node --check test/projection.js` pass; `node test/projection.js` passes palette/audio wiring and verifies each particle shader loop has a constant bound no greater than 16. `npm test` passes Projection tests, then fails at the known WiZ fixture bind (`EPERM 127.0.0.70:38899`). No GLSL compiler/GPU run is available.
- Next: rebuild Geometry. Still need Mac/PC shader compilation, by-eye review, and large-canvas benchmarks.

### 2026-11-16 Codex (animation overhaul milestone 3 Flow family)
- Rebuilt the 11 Flow shaders with separate forms for curtains, flame, smoke, clouds, caustic water, traveling waves, currents, magma cells, falling rain, drifting snow, and sun shafts. All keep their old preset IDs and receive the shared palette, per-shape controls, and common audio controls.
- `node --check src/shared/proj-render.js` and `node --check test/projection.js` pass. `node test/projection.js` passes checks that all 11 flow shader sources use the shared palette/audio controls and all 35 animation profiles stay bounded, react to music energy, and suppress hit/drop bursts in silence. `npm test` again fails after the Projection test at the known WiZ fixture bind (`EPERM 127.0.0.70:38899`). No GLSL compiler or GPU run is available; no look or frame-rate claim is verified.
- Next: rebuild particles, then geometry/noise/reactive/ambient families. Need an owner eye-check on Mac and PC.

### 2026-11-16 Codex (animation overhaul milestone 3 palette integration)
- Connected the saved project palette to a selector in Visuals and a reusable 256×1 texture in the shared WebGL shader. All shader output now receives the selected palette before brightness; the per-shape Colour shift offsets it, and context restoration retains the selected palette. Existing layout IDs and shape settings are unchanged.
- `node test/projection.js` and syntax checks for the touched JavaScript pass. Tests cover bounded RGBA texture creation, opaque samples, seamless palette endpoints, all animation IDs, and palette UI/renderer source wiring. `npm test` passes the Projection test and then fails at the known WiZ fixture bind (`EPERM 127.0.0.70:38899`). `npm start` exits with Electron `SIGABRT` before showing a window. These checks do not compile GLSL or verify appearance on a GPU.
- Next: rebuild the animation families and add new looks. Still need Windows/Mac GPU, projector appearance, 1080p/4K performance, and light-rate checks.

### 2026-11-15 Codex (animation overhaul milestone 2)
- Added five curated shared palettes with bounded OKLab interpolation, optional saved project palette normalization, a central animation-ID resolver, and allocation-free bounded feature reads for shader control profiles. Existing saves keep their preset IDs and receive the `aurora` palette default.
- `node test/projection.js` passes palette range/fallback, old-ID resolution, project default/round-trip, and bass/body/air/hit/drop/silence mapping checks; `node --check src/shared/proj-core.js` passes. `npm test` then fails at the known WiZ fixture bind (`EPERM 127.0.0.70:38899`).
- Next: connect palettes and rebuild animation families. Still need Windows/Mac GPU, projector appearance, 1080p/4K performance, and light-rate checks.

### 2026-11-15 Codex (animation overhaul milestone 1)
- Pulled latest `main`, read the required instructions/status docs, inspected current `proj-core.js`, `proj-render.js`, projector page, and audio feature contract. Researched MilkDrop/projectM, Butterchurn, procedural SDF/noise/palettes, flow noise, boids, and Gray-Scott.
- Added DESIGN.md with the current 35-animation family inventory, weak-overlap assessment, saved-ID migration rules, common palette/audio contract, Windows/Mac compatibility, adaptive quality plan, milestones 2–5, and visual verification requirements. Added THIRD_PARTY.md; no code/assets/dependencies were imported.
- `npm test` runs and passes `test/projection.js`, then fails before WiZ tests can run because this host rejects binding `127.0.0.70:38899` (`EPERM`). `git diff --check` passes. This milestone contains no runtime code changes.
- Unfinished: implementation has not started. Next: push this design milestone, then milestone 2 shared palette, normalized audio mapping and migration helpers with deterministic tests. Cross-platform tests and visual GPU checks remain necessary.

### 2026-11-15 Claude (versions)
- Added scripts/ci-version.js and build.yml steps so every build on main is versioned automatically (next build should be 1.8.3). UNVERIFIED until the build finishes; check the release title and file names.
### 2026-11-15 Codex (merged audit)
- Merged `codex/projection-studio-audit` as PR #4 into `main` after the latest commit passed GitHub Actions on Ubuntu, macOS, and Windows. The merge is `75e1f1815c9050f09ff1c6282aa7ded210add857`.
- `node test/projection.js`, syntax checks, and `git diff --check` pass locally. `npm test` locally is blocked by the WiZ fixture bind to `127.0.0.70:38899` (`EPERM`); GitHub CI passed the full workflow on all three OSes.
- Next: owner hands-on verification of projector/preview/Esc, saved layouts and shape settings, Mac microphone fallback, PC system audio, and bulbs restoring after Stop, disconnection/retry, and app quit. Interactive verification is still unavailable here because Electron aborts before opening.

### 2026-11-15 Codex (snapshot fidelity)
- Made Projection Lights snapshots clone their RGB state and retain brightness `0` during restore; previously the saved colour could alias device state and a zero value was omitted from the restore patch.
- `node test/projection.js` passes a zero-brightness and mutated-device-colour restore check; syntax passes. `npm test` continues past Projection checks and hits the WiZ fixture bind restriction.
- Next: review CI and continue projector/output and mode lifecycle checks; actual provider state recovery remains hardware-dependent.

### 2026-11-15 Codex (shutdown retry)
- Updated native quit/close cleanup to retry Projection Lights restoration whenever saved bulb snapshots remain, including after an earlier failed Stop.
- `node --check src/main/main.js` and `node test/projection.js` pass; `npm test` still passes Projection tests and stops at the WiZ fixture bind restriction.
- Next: continue checking remaining renderer and driver lifecycle cases; actual shutdown restore still requires real app and bulbs.

### 2026-11-15 Codex (asynchronous layout ownership)
- Fixed two layout-switch races: delayed Room photo decoding now updates the project that selected the file, and beat-scheduled animation changes are discarded if the user has switched projects or removed the shape before the beat. Added hardware-free checks for both ownership guards.
- `node test/projection.js` and syntax checks pass. `npm test` again passes Projection checks and stops at the WiZ fixture bind (`EPERM`, `127.0.0.70:38899`).
- Next: continue tracing Studio mode transitions and output/no-display behavior; UI/runtime verification still needs Electron to launch.

### 2026-11-15 Codex (retryable light restoration)
- Fixed a restore failure path: manager.apply reports per-device failures in its result instead of throwing, while Projection Lights previously discarded every saved snapshot regardless. Failed or temporarily unavailable bulbs now remain in the snapshot, are reported in Studio status, and can be retried from Lights.
- `node test/projection.js` passes the failure-then-retry case (snapshot retained after first failure and cleared after success); `node --check` passes for the changed main and renderer files. `npm test` passes the Projection tests and remains blocked at the WiZ fixture bind (`EPERM` on `127.0.0.70:38899`).
- Next: continue auditing tab controls and projector/output edge cases; actual retry against a disconnected bulb needs real hardware/provider access.

### 2026-11-15 Codex (restore lifecycle)
- Fixed two restore-ordering risks: Projection Lights now waits for its in-flight cloud command before sending the saved state, and concurrent Stop calls share one restoration operation. Native app quit now intercepts `before-quit` and waits for active drivers; window close no longer destroys the app after a fixed four-second race.
- `node test/projection.js` passes an in-flight command ordering check with concurrent Stop calls; syntax checks and `git diff --check` pass. `npm test` still stops at the WiZ fixture bind restriction. The Electron app cannot run here (SIGABRT), so native quit and real-bulb restoration remain runtime-unverified.
- Next: inspect per-shape controls and lights membership changes; continue with remaining error/recovery cases.

### 2026-11-15 Codex (layout persistence)
- Fixed a debounce race that could redirect a pending shape/layout save to the newly selected project. Saves now capture per-project snapshots, coalesce edits for the same project, and flush before deletion.
- `node test/projection.js` passes the edit-coalescing and cross-layout save checks as well as the existing projection cases. `npm test` still stops after that test at the WiZ fixture bind error; syntax checks and `git diff --check` pass.
- Next: continue reviewing per-shape settings and Play/Stop restore lifecycle; interactive UI is still unavailable because Electron aborts before opening.

### 2026-11-15 Codex (Projection Studio follow-up)
- Fixed the macOS Projection Studio audio path: the Audio tab now identifies system audio as unavailable on Mac and automatically switches to Microphone when macOS supplies no system audio track. The fallback decision is covered for Mac, Windows, explicit microphone selection, and permission refusal in `test/projection.js`.
- `node test/projection.js`, syntax checks, and `git diff --check` pass. Full `npm test` still stops at the WiZ fixture bind error; real microphone permission/capture on Mac remains unverified.
- Installed locked dependencies with `npm ci`; `npm start` then aborted with `SIGABRT` before the Studio UI became inspectable. `node test/projection.js` now also checks all 35 picker animations have shaders, every animation appears exactly once, and both page script references resolve.
- Next: continue mapping, per-shape, Play/Stop and output lifecycle review; keep real projector/bulb and Windows/macOS checks explicit.

### 2026-11-15 Codex
- Started the Projection Studio end-to-end audit. Confirmed all editor/projector script references resolve, the preload bridges and IPC channel names line up, and the audited JavaScript files pass `node --check`.
- Fixed a bulb restore defect: a bulb dropped after repeated provider failures now stays in the saved pre-show snapshot. `node test/projection.js` passed its project round-trip and dropped-bulb restoration checks.
- Fixed projector-window replacement bookkeeping so a destroyed old window cannot clear the new window's state. Updated the README animation count from 21 to 35, matching the 35 current presets.
- `npm test` reaches and passes the new projection test, then fails before WiZ assertions because this host denies binding `127.0.0.70:38899` (`EPERM` in the sandbox, `EADDRNOTAVAIL` outside it). `npm start` could not launch because `electron` is not installed in this checkout.
- Unfinished: continue the renderer/audio/mapping/lifecycle audit; add reproducible tests for remaining pure logic; attempt app launch after restoring dependencies if feasible; record what still requires a real projector, bulbs, Mac, or PC.

### 2026-11-15 Claude (later)
- Owner tried the Mac build: macOS said "Lumen is damaged and can't be opened" (unsigned app with download quarantine). Set `build.mac.identity` to "-" (ad-hoc signing) in package.json so the next Mac build is signed. UNVERIFIED until the owner tries the new build from the `latest` release.
- Codex has an unmerged branch `codex/mac-system-audio` (commit "Add macOS system audio capture support", based on an older main). Needs review before merging: it changes package-lock.json heavily.
- Next: owner retests Mac build; then review/merge the Codex branch; then restore missing tests.
### 2026-11-15 Claude
- Restructured the repo (app now at repo root), added CI and automatic PC + Mac builds to the `latest` release, added these docs and the shared engineering rules.
- Merged the engineering rules from the owner's Claude project into AGENTS.md. Replaced HANDOFF.md/TASKS.md with this STATUS.md session log and TODO.md.
- Unfinished: nothing in progress. Next: see TODO.md.

## Build / test state
- VERIFIED (local, 2026-11-15): `node test/projection.js` passed the saved-project normalization/round-trip and restore-after-provider-failure checks.
- VERIFIED (local, 2026-11-15): `node test/projection.js` passed the platform fallback policy checks for macOS no-track fallback, Windows unchanged behavior, explicit microphone selection, and permission refusal.
- VERIFIED (local, 2026-11-15): `node test/projection.js` passed layout-save coalescing and cross-layout snapshot checks, covering the renderer's save-queue policy.
- VERIFIED (local, 2026-11-15): `node test/projection.js` confirmed Stop waits for an in-flight simulated cloud update before restoring the original bulb state, including concurrent Stop calls.
- UNVERIFIED: the full `npm test` suite cannot complete on this host. Its projection test passes, but the WiZ fixture cannot bind `127.0.0.70:38899` (`EPERM` in the sandbox and `EADDRNOTAVAIL` outside it).
- VERIFIED (local, 2026-11-16): `node test/projection.js` checked all 35 preset profile outputs for bounded controls, increased speed under music energy, and zero hit/drop events in silence; it also checked the 11 rebuilt Flow shader sources for shared palette/audio-control wiring. These are CPU/source checks, not GLSL compilation or appearance evidence.
- VERIFIED (local, 2026-11-16): `node test/projection.js` checks shared palette/audio wiring and fixed loop bounds (≤16) for the 5 rebuilt Particle shaders; this does not compile or render the shaders.
- VERIFIED (local, 2026-11-16): `node test/projection.js` checks palette/audio wiring and constant loop bounds for all 11 rebuilt Geometry shaders, including the 28-iteration fractal cap; this does not compile or render them.
- VERIFIED (local, 2026-11-16): `node test/projection.js` checks shared palette/audio source wiring for the 4 rebuilt Noise Field shaders; this is not GLSL compilation or rendered appearance.
- VERIFIED (local, 2026-11-16): `node test/projection.js` verifies the Lightning feature profile receives beat/onset/drop events and the shader has no time-based flash timer; it does not render the shader.
- VERIFIED (local, 2026-11-16): `node test/projection.js` checks palette/audio source wiring and absence of hash-speckle code in the 3 rebuilt Ambient shaders. It does not compile or render GLSL.
- VERIFIED (local, 2026-11-16): `node test/projection.js` confirms 41 picker IDs (the original 35 plus six additions), unique group membership, shader/profile/evolver coverage, bounded loop sizes in the new effects, and save/load of Frame Drips and Ripple Reveal. Syntax and `git diff --check` also pass. These tests do not compile GLSL or show how the effects look.
- VERIFIED (local, 2026-11-16): `node test/projection.js` exercises quality fallback timing and recovery, quality save/load/defaults, large backing-canvas caps, and source checks for cached geometry buffers. It simulates picture-following commands at the configured WiZ/Cync/Hubspace rates, checks bounded color/brightness steps, and confirms Stop restores each original state. This does not measure GPU frame rate or real bulbs.
- UNVERIFIED: app launch; after `npm ci`, `npm start` exits with `SIGABRT` before the Studio UI is visible. The stack trace did not identify the cause.
- VERIFIED (GitHub Actions run on main, commit 0e06276): the 3 WiZ simulated-bulb tests (wiz-caps, wiz-errors, wiz-multi) pass on Windows, macOS and Linux.
- VERIFIED (same run): `npm run dist` and `npm run dist:mac` both produced artifacts (Windows installer + portable exe; Mac arm64/x64 dmg + zip), published to the `latest` release.
- UNVERIFIED: that either built app launches and runs. The owner has not yet tried them.
- UNVERIFIED: every light integration (WiZ, Cync, Hubspace) against real accounts/hardware in this repo's current state.

## Gaps found
- Projection Studio has not yet had a full interactive run. Multi-display/fullscreen behavior, Esc close, WebGL rendering, and real bulb state restoration still need hands-on verification.
- The shared palette/audio controls, six new effects, Ripple Reveal, and Low/Medium/High fallback are connected in both renderers. Hardware-free checks cover timing, resolution caps, and geometry reuse. GLSL compilation, appearance, real-bulb smoothness, and 1080p/4K performance remain unverified.
- Projection Studio cannot guarantee a failed provider restore until the bulb is reachable again. The snapshot is now retained and a retry is exposed; real reconnect and retry behavior is unverified here.
- Native app quit and window-close restoration paths have code changes and hardware-free ordering coverage, but Electron's local SIGABRT prevents runtime verification of the actual app shutdown sequence.
- macOS still does not provide system sound capture. Projection Studio now switches to Microphone if its system source produces no audio track; actual microphone capture and permission handling need a real-Mac check. Effects still requires the user to choose Microphone manually.
- test/run.js, show.js, effects.js, av.js, ui.js, studio.js (previously run by `npm test`) are missing from this repo. An older copy of some (run.js, show.js, ui.js, shot.js) exists in the zip in the `lumennnnnnnnnnnn` repo (older source; must be checked against current code before use).
- Mac system-sound capture is not implemented (Windows-only loopback).
