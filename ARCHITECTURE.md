# ARCHITECTURE

Electron app, plain HTML/CSS/JS renderer, no framework.

- `src/main/main.js` main process, windows, tray, IPC, audio/screen capture permissions, safeStorage wiring.
- `src/main/manager.js` device registry, rooms, groups, scenes, scan/refresh.
- `src/main/providers/` `wiz.js` (local UDP 38899), `hubspace.js` (Afero cloud HTTPS), `cync.js` (Cync cloud relay, TLS 23779, pinned cert).
- `src/main/http.js` small HTTP(S) client (fetch can't set the Host header Afero needs). `store.js` JSON data + OS-encrypted secrets. `diag.js` redacted diagnostics.
- `src/main/showplayer.js`, `fx.js`, `projlights.js`, `showapi.js`, `automation.js`, `presets.js`, `api.js`, `util.js`, `preload*.js` effects, projection light driving, show playback, automation, IPC bridge.
- `src/shared/` pure logic: `show-*.js` (analysis/core/effects), `av-*.js` (audio-visual features/scheduling/director), `proj-*.js` (projection), `proj-quality.js` (saved render tiers, canvas sizing and frame-time fallback), `audio-service.js`, `color.js`.
- `src/renderer/` UI: `index.html`, `app.js`, `core.js`, `shell.js`, `visualizer.js`, `projector.*`, `styles.css`.
- `test/` tests using simulated WiZ bulbs (each bound to its own 127.0.0.x loopback address; macOS CI adds aliases).
- `.github/workflows/` `test.yml` (Windows/macOS/Linux), `build.yml` (tests, builds PC + Mac, publishes the `latest` release).

Secrets: Electron `safeStorage` (DPAPI on Windows, Keychain on Mac). Cloud bulbs are driven at each brand's own pace from a separate process.

Projection Studio loads the same WebGL renderer in the editor preview and projector window. The shared quality helper normalizes saved Low/Medium/High settings, caps backing-buffer dimensions, and provides downgrade/recovery logic to both loops. Shape vertex buffers are cached by point geometry. Projection Lights runs in the main process, starts from a snapshot of the live bulb state, eases and caps ordinary follow-picture commands, and restores the snapshot on Stop/quit.
