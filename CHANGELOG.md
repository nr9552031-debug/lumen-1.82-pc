# CHANGELOG
## Unreleased (2026-11-15)
- Projection Studio: keep the pre-show bulb snapshot when a light is dropped after repeated output failures, allowing Stop to restore it.
- Projection Studio: prevent a replaced projector window's close event from clearing the new window state.
- Add hardware-free checks for Projection Studio project persistence and restore after output failures.
- Correct the README animation count to the 35 presets provided by the current code.

## 2026-11-15
- Mac build: ad-hoc signing (`mac.identity` "-") to avoid the "damaged" error. Unverified.
- Repo restructured: app moved to the repo root; legacy zip removed.
- Added CI (tests on Windows/macOS/Linux) and automatic PC + Mac builds published to the `latest` release.
- `npm test` now runs the existing WiZ tests only.
- Added shared engineering rules (AGENTS.md) and project docs (PROJECT, ARCHITECTURE, STATUS, TODO, KNOWN_ISSUES, CHANGELOG).
