# Handoff log (newest first). Every agent adds an entry after every update.

## 2026-11-15 Claude (later)
- CI: Windows and Linux tests pass. macOS failed only because the simulated WiZ bulbs bind 127.0.0.x and macOS has just 127.0.0.1; test.yml now adds loopback aliases on macOS. Not an app bug.
- Waiting on: first full build run (PC + Mac) to publish to the `latest` release.

## 2026-11-15 Claude
- Restructured the repo: app is now at the repo root (was in a nested folder). Old zip removed (still in git history).
- Added auto builds for Windows and Mac to the `latest` release on every push to main, and CI tests on Windows/macOS/Linux.
- Not yet verified: first CI run and first Mac build. Check the Actions tab.
- FOUND: the uploaded source is missing test files that `package.json` used to run (`test/run.js`, `show.js`, `effects.js`, `av.js`, `ui.js`, `studio.js`). `npm test` now runs only the 3 WiZ tests that exist (all pass locally). If the owner has the full test folder on their machine, add it back and restore the old test script.
- Next: confirm CI is green, then start on Mac sound capture (see TASKS.md).
