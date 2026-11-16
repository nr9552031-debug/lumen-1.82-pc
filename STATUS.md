# STATUS
Last updated: 2026-11-15. VERIFIED = has real test/log evidence. Everything else is UNVERIFIED.

## Session log (newest first; every agent adds an entry after every update)
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
- UNVERIFIED: app launch; after `npm ci`, `npm start` exits with `SIGABRT` before the Studio UI is visible. The stack trace did not identify the cause.
- VERIFIED (GitHub Actions run on main, commit 0e06276): the 3 WiZ simulated-bulb tests (wiz-caps, wiz-errors, wiz-multi) pass on Windows, macOS and Linux.
- VERIFIED (same run): `npm run dist` and `npm run dist:mac` both produced artifacts (Windows installer + portable exe; Mac arm64/x64 dmg + zip), published to the `latest` release.
- UNVERIFIED: that either built app launches and runs. The owner has not yet tried them.
- UNVERIFIED: every light integration (WiZ, Cync, Hubspace) against real accounts/hardware in this repo's current state.

## Gaps found
- Projection Studio has not yet had a full interactive run. Multi-display/fullscreen behavior, Esc close, WebGL rendering, and real bulb state restoration still need hands-on verification.
- Projection Studio cannot guarantee a failed provider restore until the bulb is reachable again. The snapshot is now retained and a retry is exposed; real reconnect and retry behavior is unverified here.
- Native app quit and window-close restoration paths have code changes and hardware-free ordering coverage, but Electron's local SIGABRT prevents runtime verification of the actual app shutdown sequence.
- macOS still does not provide system sound capture. Projection Studio now switches to Microphone if its system source produces no audio track; actual microphone capture and permission handling need a real-Mac check. Effects still requires the user to choose Microphone manually.
- test/run.js, show.js, effects.js, av.js, ui.js, studio.js (previously run by `npm test`) are missing from this repo. An older copy of some (run.js, show.js, ui.js, shot.js) exists in the zip in the `lumennnnnnnnnnnn` repo (older source; must be checked against current code before use).
- Mac system-sound capture is not implemented (Windows-only loopback).
