# TODO (priority order)
1. Projection Studio animation overhaul (active): milestones 1–3 complete. All 35 existing animations are rebuilt with shared palette/audio controls, and hardware-free source/profile checks pass; GLSL/GPU appearance and performance are unverified. Next add Wall Tide, Ripple Choir, Ribbon Weave, Murmuration, Frame Drips, Cell Garden, and restrained transitions; then add Low/Medium/High quality adaptation. See DESIGN.md.
2. Complete the Projection Studio real-device audit: visually check all animations, mapping/output/Esc, audio, lights and restore paths on a projector and real bulbs on Mac and PC. The code audit and hardware-free checks are in STATUS.md; the app still needs a successful interactive run.
3. Restore the missing tests (see STATUS.md "Gaps found"), verify them against current code, and restore the full `npm test`. Current WiZ fixtures also need an environment-independent loopback setup for hosts that do not expose the whole 127/8 range.
4. Owner tries the PC and Mac builds from the `latest` release and reports what's wrong.
5. Mac parity: system-sound capture on macOS for Effects (currently Windows-only loopback).
6. Verify each integration (WiZ, Cync, Hubspace) end to end and record evidence in STATUS.md.
7. Owner ideas and bugs go here or in GitHub issues.
