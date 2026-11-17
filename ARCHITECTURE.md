# ARCHITECTURE

Electron app, plain HTML/CSS/JS renderer, no framework.

- `src/main/main.js` main process, windows, tray, IPC, audio/screen capture permissions, safeStorage wiring.
- `src/main/manager.js` device registry, rooms, groups, scenes, scan/refresh.
- `src/main/providers/` `wiz.js` (local UDP 38899), `hubspace.js` (Afero cloud HTTPS), `cync.js` (Cync cloud relay, TLS 23779, pinned cert).
- `src/main/http.js` small HTTP(S) client (fetch can't set the Host header Afero needs). `store.js` JSON data + OS-encrypted secrets. `diag.js` redacted diagnostics.
- `src/main/showplayer.js`, `fx.js`, `projlights.js`, `showapi.js`, `automation.js`, `presets.js`, `api.js`, `util.js`, `preload*.js` effects, projection light driving, show playback, automation, IPC bridge.
- `src/shared/` pure logic: `show-*.js` (analysis/core/effects), `av-*.js` (audio-visual features/scheduling/director), `proj-*.js` (projection), `proj-quality.js` (saved render tiers, canvas sizing and frame-time fallback), `audio-service.js`, `color.js`.
- `src/renderer/` UI: `index.html`, `app.js`, `core.js`, `shell.js`, `visualizer.js`, `projector.*`, `styles.css`.
- `src/main/touchdesigner.js` TouchDesigner MCP Streamable HTTP/OAuth client and Ollama tool-calling loop; `src/renderer/touchdesigner.js` is the TouchDesigner Studio workspace. TDMCP tokens use `Store`/Electron safeStorage. Renderer access is through the existing main-window-only IPC API and preload event bridge.
- `src/main/comfyui.js` validates ComfyUI API workflows, safely targets localhost or HTTPS servers, uploads user-selected PNG assets, checks installed node classes via `/object_info`, queues supplied graphs through `/prompt`, and reads `/history`. Projection Studio exposes this through the AI Pipeline tab and existing main-process API bridge. It does not synthesize model-specific graphs or install nodes/models.
- `test/` tests using simulated WiZ bulbs (each bound to its own 127.0.0.x loopback address; macOS CI adds aliases).
- `.github/workflows/` `test.yml` (Windows/macOS/Linux), `build.yml` (tests, builds PC + Mac, publishes the `latest` release).

Secrets: Electron `safeStorage` (DPAPI on Windows, Keychain on Mac). Cloud bulbs are driven at each brand's own pace from a separate process.

Projection Studio loads the same WebGL renderer in the editor preview and projector window. The shared quality helper normalizes saved Low/Medium/High settings, caps backing-buffer dimensions, and provides downgrade/recovery logic to both loops. Shape vertex buffers are cached by point geometry. Projection Lights runs in the main process, starts from a snapshot of the live bulb state, eases and caps ordinary follow-picture commands, and restores the snapshot on Stop/quit.

TouchDesigner Studio connects only to an explicitly configured TDMCP endpoint. MCP OAuth callbacks are received by a temporary IPv4 loopback HTTP listener, and credentials persist only through safeStorage. Ollama calls the local HTTP API and receives TDMCP tools discovered at runtime, plus the current project snapshot. The animation workflow asks the model to create a self-contained playable scene and inspect available previews. Read-only tools may run automatically; the user may explicitly approve routine operator edits for one run, while code execution, deletion, save, export and file operations still require separate approval. Malformed Ollama tool-call XML is retried once; unsuccessful runs are logged as incomplete instead of being reported as completed. Tool responses are bounded and logged in the Studio session. The external `.tox` component is user-installed and is not packaged with Lumen.
# Technology Optimization

The additive `src/main/technology-optimization.js` service supplies the Technology Optimization page through the existing main-process API and preload IPC request channel. The renderer module is `src/renderer/technology-optimization.js`. It inventories declared dependencies against a local package lock when available and performs user-triggered GitHub repository searches with bounded query length and request timeout. Opportunity and approval records are stored in the existing application data store. This feature does not run commands, install packages, or modify the project. Periodic monitoring and advisory integration are not implemented yet.
