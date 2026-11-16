# CHANGELOG

## Unreleased (2026-11-16)
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
