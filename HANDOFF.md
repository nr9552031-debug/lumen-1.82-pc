# Handoff log (newest first). Every agent adds an entry after every update.

## 2026-11-15 Codex
- Confirmed the latest pre-change Actions run passed Windows, macOS and Linux tests, Windows and Mac builds, and release publishing. Earlier macOS test failure was fixed by the loopback-alias setup.
- Mac system-audio capture now uses Electron's native screen picker on macOS 15+; updated Electron from 33.2.1 to 45.3.2 (CoreAudio Tap system capture) and CI Node from 20 to 22 (required by this Electron release). Windows continues to receive loopback audio. Mac permission/no-track errors now explain the Screen & System Audio Recording setting and microphone fallback. Mac 14 and older remain microphone-only.
- `npm test` was run after the change but cannot complete on this Mac: its test simulator binds `127.0.0.70`, which this machine does not have; adding the loopback aliases requires an admin password unavailable to this session. `git diff --check` passes. CI must verify this commit on Windows/macOS/Linux and rebuild both packages.
- Real-machine checks still needed: launch the new Mac build; on macOS 15+, grant Screen & System Audio Recording, start an audio-reactive effect and Projection Studio with system sound selected, confirm the meter responds to speaker/headphone output, then stop and confirm it is silent; on an older Mac confirm the microphone fallback and error guidance. Also launch/test the Windows build and confirm Windows system loopback still responds.
- Next: verify Actions and the published release after push; fix any failures. Then get owner confirmation from real Mac/Windows checks.

## 2026-11-15 Claude (later)
- CI: Windows and Linux tests pass. macOS failed only because the simulated WiZ bulbs bind 127.0.0.x and macOS has just 127.0.0.1; test.yml now adds loopback aliases on macOS. Not an app bug.
- Waiting on: first full build run (PC + Mac) to publish to the `latest` release.

## 2026-11-15 Claude
- Restructured the repo: app is now at the repo root (was in a nested folder). Old zip removed (still in git history).
- Added auto builds for Windows and Mac to the `latest` release on every push to main, and CI tests on Windows/macOS/Linux.
- Not yet verified: first CI run and first Mac build. Check the Actions tab.
- FOUND: the uploaded source is missing test files that `package.json` used to run (`test/run.js`, `show.js`, `effects.js`, `av.js`, `ui.js`, `studio.js`). `npm test` now runs only the 3 WiZ tests that exist (all pass locally). If the owner has the full test folder on their machine, add it back and restore the old test script.
- Next: confirm CI is green, then start on Mac sound capture (see TASKS.md).
