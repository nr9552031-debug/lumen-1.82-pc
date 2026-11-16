# CHANGELOG
## Unreleased (2026-11-15)
- Projection Studio: keep the pre-show bulb snapshot when a light is dropped after repeated output failures, allowing Stop to restore it.
- Projection Studio: prevent a replaced projector window's close event from clearing the new window state.
- Projection Studio: explain that macOS system audio is unavailable and switch to the microphone when no system audio track is supplied.
- Projection Studio: capture debounced saves per layout so switching projects cannot redirect or discard pending shape edits; flush before deleting a layout.
- Projection Studio: wait for in-flight bulb writes before restoring, share concurrent Stop work, and hold native app quit until active lighting drivers finish.
- Projection Studio: retain snapshots for failed or unavailable bulb restores, show the reason, and allow retries from the Lights tab.
- Projection Studio: keep delayed room-photo imports attached to the layout that selected the file.
- Projection Studio: ignore beat-scheduled shape changes after switching away from their layout or removing the shape.
- Add hardware-free checks for Projection Studio project persistence and restore after output failures.
- Check that every picker animation has a shader, each animation belongs to one group, and all page script references exist.
- Correct the README animation count to the 35 presets provided by the current code.

## 2026-11-15
- Mac build: ad-hoc signing (`mac.identity` "-") to avoid the "damaged" error. Unverified.
- Repo restructured: app moved to the repo root; legacy zip removed.
- Added CI (tests on Windows/macOS/Linux) and automatic PC + Mac builds published to the `latest` release.
- `npm test` now runs the existing WiZ tests only.
- Added shared engineering rules (AGENTS.md) and project docs (PROJECT, ARCHITECTURE, STATUS, TODO, KNOWN_ISSUES, CHANGELOG).
