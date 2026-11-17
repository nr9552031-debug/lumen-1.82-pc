# TouchDesigner Studio

TouchDesigner Studio connects Lumen to the official [TouchDesigner TDMCP server](https://github.com/TouchDesigner/TDMCP), then uses a locally running Ollama model to plan and operate the connected project. The TDMCP component is installed by the user inside TouchDesigner; Lumen does not bundle or redistribute `TDMCP.tox`.

## Setup

1. Install TouchDesigner **2025.33230 or newer** for the TDMCP release documented upstream.
2. Download `TDMCP.tox` from the [official TDMCP releases](https://github.com/TouchDesigner/TDMCP/releases) and drop it into the TouchDesigner project you want Lumen to control.
3. In the component's MCP page, turn on **Active**. Keep **Server Address Scope** at **Localhost only**, keep **Ask for authentication** enabled, and leave the default port `13316` unless another instance uses it. On the **Tune** page, enable **Inline Images** so Lumen can inspect visual previews.
4. Install and start [Ollama](https://ollama.com/download), then download a model that supports tool calling. Use a vision capable model to let the agent inspect image outputs returned by `view_operator`.
5. Open Lumen → **TouchDesigner Studio**. The default endpoint is `http://127.0.0.1:13316/mcp`. Click **Connect / reconnect**. When TouchDesigner displays the TDMCP consent panel, allow Lumen. OAuth tokens and client registration are stored using Electron `safeStorage` (Windows DPAPI/macOS Keychain); if the OS encryption service is unavailable, tokens remain in memory only.
6. Click **Refresh models**, select an installed Ollama model, describe the animation, and click **Make animation**. The Ollama API is called at `http://127.0.0.1:11434`; prompts and project context stay on the local machine. The connected status means the bridge is ready; it does not mean Lumen has already built anything.

For a custom TDMCP port or trusted HTTPS endpoint, change the endpoint in the Studio page. Remote endpoints require HTTPS; credentials in URLs and plain HTTP to remote hosts are rejected. The official TDMCP component defaults to IPv4 loopback because its listener does not support IPv6 loopback.

## Approval and safety

- Lumen discovers available MCP tools from the connected server; it does not assume tool names or schemas.
- The agent begins with project inspection and uses TDMCP help/documentation tools when it needs operator or parameter details. It is prompted to create a self-contained playable scene, inspect preview images when available, and report missing character assets plainly.
- Read-only tools can run automatically. Routine operator creation, wiring, and parameter changes still require an explicit approval; the user can approve them one at a time or approve routine edits for the current animation run. Code execution, deletion, saving, exports and file operations always require separate approval.
- `execute_code` runs Python inside TouchDesigner and can make arbitrary changes. Review the full code carefully before approving it. Save a backup of important `.toe` projects before major work.
- Stop generation cancels the current local model request, pending approval, or MCP tool request. Disconnect closes the session. After unexpected network loss, reconnect manually.

The TDMCP component itself runs inside TouchDesigner and applies its own undo blocks. Lumen does not auto-save; use the `save_project` MCP tool only when you approve it.

## Limitations

- TDMCP is currently documented as public beta. Its tool surface and supported TouchDesigner build requirements can change upstream.
- TDMCP OAuth consent has been observed on the owner's Mac, and a later read-only check confirmed that TouchDesigner was listening on the configured local port. A successful live model-to-tool mutation, preview review, Windows run, and export have not yet been verified.
- Lumen's renderer supports embedded PNG, JPEG and WebP tool images up to 1.5 MB each for display. When a model receives an image result, it must support vision. File-path-only captures are reported as text and cannot be previewed by Lumen.
- Ollama is local only; Lumen does not install Ollama or models. A model may fail to use tools reliably even when it advertises tool calling. Lumen retries one malformed XML tool response, but live recovery has not yet been verified.
- This is not yet a guaranteed "type anything and get a finished animation" engine. It can ask the model to build a playable TouchDesigner network from the current project's operators, but it does not automatically download licensed characters/rigs, generate a realistic character asset, or export a finished MP4. Character prompts may produce a clearly labeled stylized approximation if no suitable model/rig is already present. Preview feedback depends on TDMCP returning inline images.
- The app has no dedicated TouchDesigner process detector. Connection status is determined by attempting MCP initialization and tool discovery.
- Linux is not a supported Lumen installer target. The MCP service itself is platform independent; user verification is still required on Windows and macOS.

## ComfyUI workflow guide

Projection Studio's AI Pipeline tab accepts base-photo and surface-mask PNGs at 1280×720 or 1920×1080; the mask must be predominantly near-black/near-white and contain both classes. It uploads selected assets to the user's ComfyUI server, accepts an API workflow JSON, checks node classes against `/object_info`, queues it through `/prompt`, and retrieves `/history`. The default is local ComfyUI at `127.0.0.1:8188`; non-loopback plain HTTP is rejected. The imported workflow must reference the uploaded filenames and define its model-specific steps; Lumen does not synthesize model-specific graphs or install models/nodes. Automatic generated-output saving and TouchDesigner Multiply/Window/Stoner network construction are not implemented yet. TouchDesigner Studio also has a four-step ComfyTD checklist and structural API JSON checker. ComfyTD, Stoner, and Kantan Mapper remain user-installed.

## Open-source assessment for prompt-to-animation

- **Ollama + Qwen3.5-4B** — retained as the owner's local agent. The Qwen model card lists Apache-2.0 and tool/vision capabilities. The current local model did return malformed tool-call XML once; Lumen now retries once and reports incomplete work, but a successful recovery still needs live verification. No larger model was downloaded.
- **Official TouchDesigner TDMCP** — retained as the native TouchDesigner bridge because it discovers the current tool surface and can create/wire operators, inspect errors, and return operator captures. Its Shared Use License allows use for projects but prohibits redistributing TDMCP as part of a product, so Lumen never bundles `TDMCP.tox`.
- **givemotion** — evaluated as an MIT-licensed, maintained local code-to-video engine with preview and MP4 rendering. Its documented runtime needs Node.js 20+, FFmpeg, and Chrome; it authors HTML/CSS motion graphics, not native TouchDesigner networks, generated footage, or character rigs. It does not meet the native TouchDesigner character-animation need and would add another runtime, so it is not integrated.
- **SlopCamera** — not selected because its repository now marks it retired and unmaintained.

These choices add no Lumen dependency or model download. No storage or performance savings are claimed. Links: [Qwen3.5-4B model card](https://huggingface.co/Qwen/Qwen3.5-4B), [official TDMCP](https://github.com/TouchDesigner/TDMCP), [givemotion](https://github.com/givemotion/givemotion), [SlopCamera status](https://github.com/hraness/slopcamera).
