# Lumen / GlowDesk — Agent Execution Rules

These rules apply to Claude, Codex, and any coding agent working in this repository.

## Mission

Deliver working Lumen features and fixes. The owner uses the application and reports problems or ideas; agents do the engineering. Optimize for verified product progress, not project administration.

## Task-first execution

1. Start from the task the owner actually assigned. Identify its concrete, testable outcome.
2. Inspect only the files and call paths needed to understand and implement that task. Expand scope only when the implementation proves it necessary.
3. Begin implementation promptly. Do not spend a session producing plans, audits, inventories, proposals, or status summaries instead of code.
4. Make the smallest complete change that solves the root cause. Preserve existing APIs, saved-project compatibility, and working behavior.
5. Run focused tests and relevant syntax/static checks. Run the full suite when the change is cross-cutting, before a release, or when targeted tests are insufficient.
6. Fix failures caused by the change. Clearly distinguish failures that pre-date the change or are blocked by the environment.
7. Finish with a concise factual handoff: changed files, behavior delivered, checks actually run, and any remaining blocker.

## Do not do administrative work by default

- Do not read STATUS.md, TODO.md, KNOWN_ISSUES.md, or other project documents at the start of every session.
- Do not create or update status logs, TODO lists, continuation/handoff documents, plans, architecture write-ups, changelogs, or other Markdown documentation unless the assigned task explicitly requires documentation or the owner asks for it.
- Do not create task trackers, resume scripts, project-management systems, agent orchestration, or progress-reporting infrastructure unless explicitly requested.
- Do not perform repository-wide audits, broad dependency inventories, web research, benchmark projects, or architecture reviews for a narrowly scoped implementation task.
- Do not turn a feature request into a multi-stage roadmap. Do not invent follow-up work.
- Do not repeatedly inspect the same files or run unrelated terminal/Git commands.
- Do not claim work is complete based on analysis, planning, documentation, or source-presence checks alone.

Existing documentation remains available as reference material when it is directly relevant. It is not a mandatory session checklist and does not need to be synchronized after every code change.

## Research and dependencies

Use existing project patterns first. Research external projects only when the task genuinely depends on an external API, protocol, library, asset, or implementation reference, or when the owner specifically asks for research. Keep research proportional to the task.

Do not add dependencies unless they materially improve the requested implementation. Before importing third-party code or assets, verify compatibility and license obligations and preserve required attribution. Never copy code merely because it appears useful.

## Engineering and product constraints

- Inspect the relevant existing implementation before changing it; identify the root cause rather than treating symptoms.
- Preserve compatibility across Windows and macOS. Use platform-aware APIs and paths; do not introduce an OS-specific dead end.
- Keep the existing plain HTML/CSS/JavaScript/Electron architecture unless the task requires a justified change.
- Handle errors, timeouts, disconnections, cleanup, and recovery for asynchronous/device operations.
- WiZ, GE Cync, and Hubspace integrations are reverse-engineered. Never log passwords, emails, tokens, or other credentials.
- Cync certificate pinning is deliberate; do not weaken it.
- Store secrets with Electron safeStorage. Do not bypass it.
- Lights must return to their previous state when a show stops or the app closes. Preserve retryable restoration behavior.
- TouchDesigner Studio must discover official TDMCP tools and schemas at runtime. Treat execute_code as arbitrary code execution and require explicit approval for mutating calls. Never bundle TDMCP.tox.
- AI prompts use the owner-selected local Ollama provider unless the owner requests another provider.
- Never fabricate test results or claim real-hardware, GPU, visual, or cross-platform verification that was not performed.

## Git workflow

- Work on the task's current feature branch, or create a focused branch from the latest main when needed. Do not overwrite unrelated user changes.
- Do not push directly to main. Commit the completed focused change on its branch and open a pull request when repository access permits.
- Do not commit half-finished work merely to create an activity trail. If blocked, preserve the work on the branch and report the specific blocker.
- Do not change version numbers manually; CI computes patch versions. Follow the existing release workflow for intentional minor/major version changes.
- Do not alter CI, release, signing, or publishing configuration unless the task requires it.

## Testing

- Select tests that exercise the behavior changed, not merely the presence of source strings.
- Run the narrowest useful test first. Expand only as needed.
- If the full test suite is blocked by an environment-specific issue, report the exact command, failure, and which targeted checks passed.
- For UI, WebGL, audio, device, and hardware-dependent behavior, distinguish automated checks from actual runtime/device verification.

## Completion standard

A task is complete when the requested behavior is implemented, relevant checks have passed, and known limitations are stated honestly. Product code and working behavior take priority over process artifacts.
