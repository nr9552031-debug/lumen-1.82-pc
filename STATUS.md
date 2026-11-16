# STATUS
Last updated: 2026-11-15. VERIFIED = has real test/log evidence. Everything else is UNVERIFIED.

## Session log (newest first; every agent adds an entry after every update)
### 2026-11-15 Claude
- Restructured the repo (app now at repo root), added CI and automatic PC + Mac builds to the `latest` release, added these docs and the shared engineering rules.
- Merged the engineering rules from the owner's Claude project into AGENTS.md. Replaced HANDOFF.md/TASKS.md with this STATUS.md session log and TODO.md.
- Unfinished: nothing in progress. Next: see TODO.md.

## Build / test state
- VERIFIED (GitHub Actions run on main, commit 0e06276): the 3 WiZ simulated-bulb tests (wiz-caps, wiz-errors, wiz-multi) pass on Windows, macOS and Linux.
- VERIFIED (same run): `npm run dist` and `npm run dist:mac` both produced artifacts (Windows installer + portable exe; Mac arm64/x64 dmg + zip), published to the `latest` release.
- UNVERIFIED: that either built app launches and runs. The owner has not yet tried them.
- UNVERIFIED: every light integration (WiZ, Cync, Hubspace) against real accounts/hardware in this repo's current state.

## Gaps found
- test/run.js, show.js, effects.js, av.js, ui.js, studio.js (previously run by `npm test`) are missing from this repo. An older copy of some (run.js, show.js, ui.js, shot.js) exists in the zip in the `lumennnnnnnnnnnn` repo (older source; must be checked against current code before use).
- Mac system-sound capture is not implemented (Windows-only loopback).
