# KNOWN ISSUES
- Mac: system-sound capture for Effects is unavailable (Windows-only loopback in src/main/main.js); Mac falls back to the microphone.
- Mac build is unsigned: first launch needs right-click > Open. Windows build is unsigned too (SmartScreen may warn).
- `npm test` currently covers only the 3 WiZ tests; other test files are missing from the repo.
- The Cync relay certificate is expired and mismatched; the user must tick "Trust the Cync relay's certificate" (pinned). Documented, deliberate.
- Cync allows one relay session per account; opening the Cync phone app drops Lumen's session until the next command.
- Hubspace and Cync integrations are unofficial/reverse-engineered and can break if the vendors change their cloud.
