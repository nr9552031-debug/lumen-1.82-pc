# PROJECT

Lumen (also called GlowDesk) is a dark-mode desktop control center for WiZ, GE Cync and Hubspace smart lights, built with Electron. It ships as a Windows build (installer + portable exe) and a Mac build (dmg + zip) from this one repo.

Features: per-brand light control, rooms, groups, scenes, automation, music/screen-reactive Effects (Pulse, Spectrum, Party, Screen match, Aurora, Candle), Projection Studio (mapped shapes, 41 palette/audio-driven animations, adaptive render quality, phone scan intake and persisted project assets, interactive 3D previews for GLB/GLTF/OBJ/PLY, and a ComfyUI AI Pipeline for surface PNG upload and user-exported workflow queueing), and TouchDesigner Studio for local-model-assisted authoring through TDMCP. Mesh selection is object-level; semantic plant-part segmentation, automatic model-specific animation workflows and TouchDesigner 3D network configuration are still dependent on compatible external models/tools and are not automated. Details: README.md and TOUCHDESIGNER.md.

Owner workflow: the owner tests the app and reports problems/ideas; Claude and Codex do the engineering and hand off through this repo (see AGENTS.md).
