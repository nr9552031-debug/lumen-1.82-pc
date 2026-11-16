# TODO (priority order)
1. Projection Studio animation overhaul (active): all implementation milestones are in. The 35 original IDs remain, six effects and Ripple Reveal are added, and Low/Medium/High with adaptive fallback and geometry caching are implemented. Hardware-free checks cover all 41 IDs, profiles, layout migration, frame timing, canvas caps, and bulb output limits. Next verify GLSL/appearance and measure 1080p/4K performance on Mac and PC; no visual or 60fps claim is verified. See DESIGN.md.
2. Complete the Projection Studio real-device audit: visually check all animations, mapping/output/Esc, audio, lights and restore paths on a projector and real bulbs on Mac and PC. The code audit and hardware-free checks are in STATUS.md; the app still needs a successful interactive run.
3. Restore the missing tests (see STATUS.md "Gaps found"), verify them against current code, and restore the full `npm test`. Current WiZ fixtures also need an environment-independent loopback setup for hosts that do not expose the whole 127/8 range.
4. Owner tries the PC and Mac builds from the `latest` release and reports what's wrong.
5. Mac parity: system-sound capture on macOS for Effects (currently Windows-only loopback).
6. Verify each integration (WiZ, Cync, Hubspace) end to end and record evidence in STATUS.md.
7. Owner ideas and bugs go here or in GitHub issues.
