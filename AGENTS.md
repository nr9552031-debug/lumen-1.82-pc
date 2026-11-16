# Agent guide (Claude, Codex, any coding agent)

Lumen: an Electron app that controls WiZ, GE Cync and Hubspace smart lights, with Effects and a Projection Studio.
It ships as TWO builds from this one repo: a Windows (PC) build and a Mac build. Both must always work.

The owner does NOT write code. They use the app, find problems, report them and pitch ideas, in chat or as GitHub issues. Agents do everything else.

## The handoff rule (most important)
Claude and Codex take turns, because each one runs out of usage. GitHub is the shared memory.

**When you start any session:**
1. `git pull` and read `HANDOFF.md` (what the last agent did and what is next) and `TASKS.md`.
2. Say in one line what you are continuing, then continue. Do not ask the owner to re-explain.

**After EVERY update you make (not just at the end):**
1. Run `npm test`.
2. Add a short dated entry to the top of the log in `HANDOFF.md`: which agent you are, what changed, what is unfinished, what to do next. Update `TASKS.md` if the plan changed.
3. `git add -A && git commit` with a clear message, then `git pull --rebase && git push` to `main`. Push even if the work is half done (say so in `HANDOFF.md`). Never leave work only on this machine or in a chat.

If you are about to run out of usage, stop and do step 2-3 first.

## Builds (both are rebuilt automatically on every push to main)
- GitHub Actions builds the Windows installer + portable exe and the Mac dmg + zip, and publishes both to the **latest** release: https://github.com/nr9552031-debug/lumen-1.82-pc/releases/tag/latest
- `npm test` also runs on Windows, macOS and Linux in CI. If CI fails after your push, fix it first.

## Where things are
- `src/main` Electron main process and providers, `src/renderer` UI, `src/shared` show/projection/audio logic, `test/` tests (mock bulbs, no hardware), `build/` icons, `scripts/` helpers.
- `README.md` documents the features and architecture.

## Commands
- `npm install`, `npm start`, `npm test` (must pass), `npm run test:ui` (needs a display), `npm run dist` (Windows build), `npm run dist:mac` (Mac build, run on a Mac).

## Windows and Mac rules
- Every change must work on both. Never add OS-specific code without a `process.platform` check and a working path (or clear message) for the other OS. Use `path`/`os`, never hard-coded separators or Windows-only commands.
- Secrets use Electron `safeStorage` (DPAPI on Windows, Keychain on Mac). Do not bypass it.
- Known Mac gap: system-sound capture ("loopback" in `src/main/main.js`) is Windows-only; Mac falls back to the microphone. Closing it is a good task; say what needs a real Mac check.
- Mac needs the Local Network permission for WiZ; keep the hint in `providers/wiz.js` accurate.
- In `HANDOFF.md`, say what was verified on each OS and what the owner still needs to try on a real machine.

## Other rules
- Cync, Hubspace and WiZ integrations are reverse-engineered. Never log passwords, emails or tokens.
- Cync certificate pinning (see README) is deliberate. Do not weaken it.
- Lights must return to their previous state when a show stops or the app closes.
- Keep the existing plain HTML/CSS/JS style. No new dependencies without a reason in `HANDOFF.md`.
- GitHub issues are an optional inbox; treat them as tasks too. Reference them in commits (`Fixes #12`).
