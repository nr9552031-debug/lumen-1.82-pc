# KNOWN ISSUES
- Mac: system-sound capture for Effects is unavailable (Windows-only loopback in src/main/main.js); Mac falls back to the microphone.
- Mac: the first build (identity null, no signature) showed "Lumen is damaged and can't be opened" on the owner's Mac (reported 2026-11-15). Workaround: `xattr -cr /Applications/Lumen.app`. Fix attempted: `mac.identity` set to "-" (ad-hoc signing) in package.json; UNVERIFIED until the next release build is tried on a Mac. Even when fixed the app is not notarized, so first launch needs right-click > Open. Windows build is unsigned too (SmartScreen may warn).
- `npm test` currently covers only the 3 WiZ tests; other test files are missing from the repo.
- The Cync relay certificate is expired and mismatched; the user must tick "Trust the Cync relay's certificate" (pinned). Documented, deliberate.
- Cync allows one relay session per account; opening the Cync phone app drops Lumen's session until the next command.
- Hubspace and Cync integrations are unofficial/reverse-engineered and can break if the vendors change their cloud.
