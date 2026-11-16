# TouchDesigner Studio

TouchDesigner Studio connects Lumen to the official [TouchDesigner TDMCP server](https://github.com/TouchDesigner/TDMCP), then uses a locally running Ollama model to plan and operate the connected project. The TDMCP component is installed by the user inside TouchDesigner; Lumen does not bundle or redistribute `TDMCP.tox`.

## Setup

1. Install TouchDesigner **2025.33230 or newer** for the TDMCP release documented upstream.
2. Download `TDMCP.tox` from the [official TDMCP releases](https://github.com/TouchDesigner/TDMCP/releases) and drop it into the TouchDesigner project you want Lumen to control.
3. In the component's MCP page, turn on **Active**. Keep **Server Address Scope** at **Localhost only**, keep **Ask for authentication** enabled, and leave the default port `13316` unless another instance uses it.
4. Install and start [Ollama](https://ollama.com/download), then download a model that supports tool calling. Use a vision capable model to let the agent inspect image outputs returned by `view_operator`.
5. Open Lumen → **TouchDesigner Studio**. The default endpoint is `http://127.0.0.1:13316/mcp`. Click **Connect / reconnect**. When TouchDesigner displays the TDMCP consent panel, allow Lumen. OAuth tokens and client registration are stored using Electron `safeStorage` (Windows DPAPI/macOS Keychain); if the OS encryption service is unavailable, tokens remain in memory only.
6. Click **Refresh models**, select an installed Ollama model, and describe the visual. The Ollama API is called at `http://127.0.0.1:11434`; prompts and project context stay on the local machine.

For a custom TDMCP port or trusted HTTPS endpoint, change the endpoint in the Studio page. Remote endpoints require HTTPS; credentials in URLs and plain HTTP to remote hosts are rejected. The official TDMCP component defaults to IPv4 loopback because its listener does not support IPv6 loopback.

## Approval and safety

- Lumen discovers available MCP tools from the connected server; it does not assume tool names or schemas.
- The agent begins with project inspection and uses TDMCP help/documentation tools when it needs operator or parameter details.
- Read only tools can run automatically. Every other tool call, including edits, saves, `execute_code`, and deletion, waits for an explicit approval in Lumen. Deletion and Python execution are marked high risk and their arguments are shown before approval.
- `execute_code` runs Python inside TouchDesigner and can make arbitrary changes. Review the full code carefully before approving it. Save a backup of important `.toe` projects before major work.
- Stop generation cancels the current local model request, pending approval, or MCP tool request. Disconnect closes the session. After unexpected network loss, reconnect manually.

The TDMCP component itself runs inside TouchDesigner and applies its own undo blocks. Lumen does not auto-save; use the `save_project` MCP tool only when you approve it.

## Limitations

- TDMCP is currently documented as public beta. Its tool surface and supported TouchDesigner build requirements can change upstream.
- This integration was not tested with a live TouchDesigner installation or live TDMCP OAuth consent in this environment.
- Lumen's renderer supports embedded PNG, JPEG and WebP tool images up to 1.5 MB each for display. When a model receives an image result, it must support vision. File-path-only captures are reported as text and cannot be previewed by Lumen.
- Ollama is local only; Lumen does not install Ollama or models. A model may fail to use tools reliably even when it advertises tool calling.
- The app has no dedicated TouchDesigner process detector. Connection status is determined by attempting MCP initialization and tool discovery.
- Linux is not a supported Lumen installer target. The MCP service itself is platform independent; user verification is still required on Windows and macOS.
