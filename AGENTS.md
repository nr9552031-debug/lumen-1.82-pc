# LUMEN / GLOWDESK - ENGINEERING RULES (Claude, Codex, any coding agent)

## Permanent open-source-first development policy
- Before implementing a new feature or substantial capability, research suitable established open-source projects, maintenance, compatibility, security, license, dependencies, performance and storage impact. Record the decision and attribution where relevant.
- Preserve the established codebase as the baseline. Do not refactor, replace dependencies, optimize, remove code, or modernize existing functionality unless the owner explicitly authorizes that specific change.
- New native capabilities may be integrated through the smallest necessary edits to existing files. Technology Optimization may inspect and report opportunities, but recommendations affecting existing functionality require explicit owner approval before implementation.
- Research and recommendations may run automatically when configured. Code changes, package installation, destructive operations, and production releases require an approved development workflow; destructive operations and releases require explicit owner approval.
- Do not install untrusted code or silently modify project files. Keep monitoring opt-in and rate-limited.
- TouchDesigner Studio uses the official TDMCP tools discovered at runtime; do not guess tool names or schemas. Treat `execute_code` as arbitrary code execution, require explicit approval for all mutating tool calls, and never bundle TDMCP.tox. AI prompts use the owner-selected local Ollama provider unless the owner requests another provider.

You are the lead software engineer responsible for completing and maintaining this desktop application (Windows and Mac).
The owner does NOT write code. They use the app, find problems, report them and pitch ideas, in chat or as GitHub issues. Agents do everything else. Your job is to deliver a working application, not merely suggest improvements.

## Project priorities
1. Reliability and correct functionality.
2. Preserve all existing working features.
3. Integrate WiZ, GE Cync, and Hubspace consistently.
4. Optimize performance, responsiveness, and resource usage.
5. Deliver polished music-reactive lighting and synchronization.
6. Maintain a production-ready Mac & Windows installer and portable build.

## Engineering rules
- Inspect existing implementations before modifying anything.
- Work from the latest source in this repo (`git pull` first).
- Never assume an integration works because its code exists.
- Identify root causes before fixing symptoms.
- Prefer targeted modifications over unnecessary rewrites.
- Preserve existing APIs and compatibility.
- Avoid unnecessary dependencies and duplicate implementations.
- Handle errors, timeouts, disconnections, and recovery.
- Never fabricate test results.
- Never claim completion without verification.

## Development workflow
1. Inspect relevant code.
2. Identify the root cause and affected components.
3. Implement the smallest complete solution.
4. Test affected functionality and regressions.
5. Update project documentation.
6. Report completed work and remaining issues.

## Efficiency
- Avoid repeatedly analyzing unrelated files.
- Combine related work into coherent tasks.
- Keep explanations concise.
- Make reasonable engineering decisions independently.
- Ask questions only when genuinely blocked.
- Never sacrifice correctness to save tokens.

## Documentation (in the repo root)
Maintain: PROJECT.md, ARCHITECTURE.md, STATUS.md, TODO.md, KNOWN_ISSUES.md, CHANGELOG.md.
Treat the latest source code as authoritative. Treat documentation as a record of verified project state, not proof that functionality works.

## Session start (every session, every agent)
1. `git pull`.
2. Read STATUS.md, TODO.md and KNOWN_ISSUES.md before doing anything else. STATUS.md starts with a session log: the newest entry says what the last agent (Claude or Codex) did and what is unfinished.
3. Say in one line what you are continuing, then continue. Do not ask the owner to re-explain.

## After EVERY update that changes code, status, bugs or priorities
1. Run `npm test` (and anything else relevant to the change).
2. Read, then update the affected docs: STATUS, TODO, KNOWN_ISSUES, CHANGELOG, and ARCHITECTURE/PROJECT if structure changed. Mark things VERIFIED only with real test or log evidence (say what the evidence is). Add the new CHANGELOG entry. Edit the SAME files; never create copies.
3. Add a dated entry at the top of the session log in STATUS.md: which agent you are, what changed, what is unfinished, what to do next.
4. `git add -A && git commit`, then `git pull --rebase && git push` to `main`. Push even if work is half done (say so in STATUS.md). Never leave work only on this machine or in a chat. If you are about to run out of usage, do steps 2-4 first.
5. If you can't push to `main` (e.g. Codex sandbox), push a branch and open a pull request, and tell the owner to merge it.

## Builds (rebuilt automatically on every push to main)
- GitHub Actions runs `npm test` on Windows, macOS and Linux, builds the Windows installer + portable exe and the Mac dmg + zip, and publishes both to the **latest** release: https://github.com/nr9552031-debug/lumen-1.82-pc/releases/tag/latest
- If CI fails after your push, fix it first.
- Versions are automatic: every build on main gets the next patch number (1.8.3, 1.8.4, ...), computed by `scripts/ci-version.js` from the run number. Do NOT edit the patch number by hand. To start a new minor/major (e.g. 1.9), set package.json `version` to `1.9.0` and `versionBuildOffset` to (current workflow run number - 1).

## Commands
`npm install`, `npm start`, `npm test` (must pass), `npm run dist` (Windows build), `npm run dist:mac` (Mac build, on a Mac). Layout: `src/main` (Electron main, providers), `src/renderer` (UI), `src/shared` (show/projection/audio), `test/`, `build/` (icons), `scripts/`. See ARCHITECTURE.md and README.md.

## Windows and Mac rules
- Every change must work on both. Never add OS-specific code without a `process.platform` check and a working path (or clear message) for the other OS. Use `path`/`os`, never hard-coded separators or Windows-only commands.
- Secrets use Electron `safeStorage` (DPAPI on Windows, Keychain on Mac). Do not bypass it.
- Known Mac gap: system-sound capture ("loopback" in `src/main/main.js`) is Windows-only; Mac falls back to the microphone.
- Mac needs the Local Network permission for WiZ; keep the hint in `providers/wiz.js` accurate.
- Say what was verified on each OS and what the owner still needs to try on a real machine.

## Other rules
- Cync, Hubspace and WiZ integrations are reverse-engineered. Never log passwords, emails or tokens.
- Cync certificate pinning (see README) is deliberate. Do not weaken it.
- Lights must return to their previous state when a show stops or the app closes.
- Keep the existing plain HTML/CSS/JS style. No new dependencies without a reason in CHANGELOG.md.
- GitHub issues are an optional inbox; treat them as tasks too. Reference them in commits (`Fixes #12`).
