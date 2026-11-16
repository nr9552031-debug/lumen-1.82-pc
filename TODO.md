# TODO (priority order)
1. Complete the Projection Studio audit and fixes (active): finish mapping/per-shape/Play-Stop lifecycle review, then verify behavior on a projector and real bulbs on Mac and PC. Mac audio fallback logic is in place; real capture still needs verification.
2. Restore the missing tests (see STATUS.md "Gaps found"), verify them against current code, and restore the full `npm test`. Current WiZ fixtures also need an environment-independent loopback setup for hosts that do not expose the whole 127/8 range.
3. Owner tries the PC and Mac builds from the `latest` release and reports what's wrong.
4. Mac parity: system-sound capture on macOS for Effects (currently Windows-only loopback).
5. Verify each integration (WiZ, Cync, Hubspace) end to end and record evidence in STATUS.md.
6. Owner ideas and bugs go here or in GitHub issues.
