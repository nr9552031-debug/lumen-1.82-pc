# PROJECT

Lumen (also called GlowDesk) is a dark-mode desktop control center for WiZ, GE Cync and Hubspace smart lights, built with Electron. It ships as a Windows build (installer + portable exe) and a Mac build (dmg + zip) from this one repo.

Features: per-brand light control, rooms, groups, scenes, automation, music/screen-reactive Effects (Pulse, Spectrum, Party, Screen match, Aurora, Candle), Projection Studio (mapped shapes, 41 palette/audio-driven animations, Low/Medium/High render quality with adaptive fallback, lights following with restore-on-stop, and an AI Pipeline tab for surface PNG validation/upload and user-exported ComfyUI API workflow queueing), and TouchDesigner Studio for local-model-assisted authoring through TDMCP. The ComfyUI path does not create model-specific graphs or yet route generated outputs into TouchDesigner automatically. Details: README.md and TOUCHDESIGNER.md.

Owner workflow: the owner tests the app and reports problems/ideas; Claude and Codex do the engineering and hand off through this repo (see AGENTS.md).
