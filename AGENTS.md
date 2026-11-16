# Agent guide (Claude, Codex, any coding agent)

Lumen is an Electron app that controls WiZ, GE Cync and Hubspace smart lights, with effects and a Projection Studio.
The owner does NOT write code. They use the app, report problems and pitch ideas as GitHub issues. Agents do everything else.

## Where things are
- App root: `Lumen-1.8.2-source-for-PC/Lumen-1.8.2/` (run all npm commands there)
- Code: `src/main` (Electron main, providers), `src/renderer` (UI), `src/shared` (show/projection/audio logic)
- Tests: `test/` (mock bulbs and cloud servers, no hardware needed)
- Docs for users and architecture: that folder's `README.md`

## Commands (from the app root)
- `npm install`
- `npm test` must pass before any PR. It runs `test/run.js`, `show.js`, `effects.js`, `av.js`.
- `npm run test:ui` needs a display. Run it if you touched the renderer and a display exists.

## Workflow
1. Take work from open GitHub issues (oldest first, label `bug` before `idea`). Also read `TASKS.md`.
2. Work on a branch named `issue-<number>-<short-slug>`. Never push straight to `main`.
3. Reproduce the problem or write down the expected behaviour first. Add or update a test where the code is testable without hardware.
4. Make the smallest change that fixes the issue. Keep the existing plain HTML/CSS/JS style. Do not add dependencies without a reason in the PR.
5. Run `npm test`. Open a PR that says what changed, how it was checked, and `Closes #<number>`.
6. Update `TASKS.md` (status and next steps) so the next agent, possibly a different tool, can pick up with no other context.

## Rules
- Cync, Hubspace and WiZ integrations are reverse-engineered. Never log passwords, emails or tokens.
- Cync certificate pinning behaviour in the README is deliberate. Do not weaken it.
- Lights must return to their previous state when a show stops or the app closes.
- If a request is unclear, comment on the issue with one specific question and move to the next issue.
- The owner cannot test hardware-specific changes quickly: say clearly in the PR what still needs a real-bulb check.
