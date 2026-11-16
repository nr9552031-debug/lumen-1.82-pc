# STATUS
Last updated: 2026-11-15. VERIFIED = has real test/log evidence. Everything else is UNVERIFIED.

## Session log (newest first; every agent adds an entry after every update)
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
- UNVERIFIED: the full `npm test` suite cannot complete on this host. Its projection test passes, but the WiZ fixture cannot bind `127.0.0.70:38899` (`EPERM` in the sandbox and `EADDRNOTAVAIL` outside it).
- UNVERIFIED: app launch; `npm start` reports `electron: command not found` because dependencies are not installed in this checkout.
- VERIFIED (GitHub Actions run on main, commit 0e06276): the 3 WiZ simulated-bulb tests (wiz-caps, wiz-errors, wiz-multi) pass on Windows, macOS and Linux.
- VERIFIED (same run): `npm run dist` and `npm run dist:mac` both produced artifacts (Windows installer + portable exe; Mac arm64/x64 dmg + zip), published to the `latest` release.
- UNVERIFIED: that either built app launches and runs. The owner has not yet tried them.
- UNVERIFIED: every light integration (WiZ, Cync, Hubspace) against real accounts/hardware in this repo's current state.

## Gaps found
- Projection Studio has not yet had a full interactive run. Multi-display/fullscreen behavior, Esc close, WebGL rendering, and real bulb state restoration still need hands-on verification.
- Projection Studio's Audio tab offers system capture on Mac even though the app's capture handler only provides loopback audio on Windows; the Mac system source yields no audio track and requires choosing Microphone manually.
- test/run.js, show.js, effects.js, av.js, ui.js, studio.js (previously run by `npm test`) are missing from this repo. An older copy of some (run.js, show.js, ui.js, shot.js) exists in the zip in the `lumennnnnnnnnnnn` repo (older source; must be checked against current code before use).
- Mac system-sound capture is not implemented (Windows-only loopback).
