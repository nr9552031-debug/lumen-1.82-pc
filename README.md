# Lumen

One dark-mode control center for **WiZ**, **GE Cync** and **Hubspace** smart lights (Windows, Electron).

## Run / build

```bash
npm install
npm start          # run the app
npm test           # protocol + manager tests (mock devices and cloud servers, no hardware needed)
npm run dist       # Windows installer + portable exe -> dist/   (run on Windows)
```

## How each brand is controlled

| Brand | Transport | Notes |
|---|---|---|
| WiZ | Local UDP (port 38899) | No account. Bulbs must be on the same network. If one isn't auto-found, add its IP under *Accounts & setup*. |
| Hubspace | Afero cloud (HTTPS) | Sign in once. Hubspace may email a verification code; enter it in the box that appears. Only a refresh token is stored (encrypted with Windows DPAPI), never the password. |
| Cync | Cync cloud relay `cm-sec.gelighting.com` (TLS, port 23779; packet format as in pycync) | Sign in once; Cync emails a code. Commands are re-sent until the relay acknowledges them, and bulb state comes from what the relay reports. Anything not acknowledged is shown as *unconfirmed*. Bluetooth-only bulbs need a Wi-Fi Cync device in the same Cync home. |

## Effects

*Effects* in the sidebar makes lights react to whatever this PC is playing or showing.

| Mode | What it does |
|---|---|
| Pulse | Brightness rides the bass; colours step through the palette |
| Spectrum | Lights split the sound between them: bass, mids, highs |
| Party | Every beat throws each light to a new colour |
| Screen match | Lights follow the main colour on the primary screen |
| Aurora / Candle | Ambient effects, no sound needed |

* Sound is captured with Windows loopback (the PC's output, not the microphone) and only measured in the app; nothing is recorded or sent anywhere.
* How closely a light follows depends on how it is controlled: WiZ about 11 changes a second (local), Cync about 2 a second (cloud relay), Hubspace about one every 2.5 seconds (cloud), so cloud lights get a slower, smoothed version.
* Colour jumps are capped at 3 a second and lights never strobe on and off. Stopping the show, or closing the app, gives every light its previous state back.
* A light whose commands keep failing is dropped from the show.

## Troubleshooting

* **Diagnostics file:** the same redacted log is written to `lumen-diagnostics.log` next to the portable exe (or in the project folder with `npm start`, or the app data folder when installed).
* **Something fails:** open *Accounts & setup* → *Diagnostics* → **Copy diagnostics**. It lists what each service answered (HTTP status, which step). Passwords, emails and tokens are never recorded.
* **Cync relay certificate:** the relay's certificate is expired and names a different host, so normal verification always fails (pycync notes the same). Lumen will not connect until you tick *Trust the Cync relay's certificate* (Control Panel → Accounts → GE Cync). It then pins that exact certificate (SHA-256) and refuses any other; untick to forget it.
* **Cync code:** type the code from the NEWEST email and click Verify (or press Enter). Clicking Connect again emails a new code and cancels the old one, so Lumen asks first.
* **Cync stops responding when you open the Cync phone app.** Cync allows one relay session per account; whichever signs in last wins. Close the app and send another command (Lumen reconnects on demand).
* **Cync finds no lights.** Cync's cloud only lists a home if at least one Wi-Fi Cync device is in it.
* **"sign-in expired"** for Hubspace or Cync: *Disconnect*, then connect again.
* Errors from a brand show as a red banner above your lights and in full under *Accounts & setup*.

## Layout

```
src/main/        Electron main process
  manager.js       device registry, rooms, groups, scenes, scan/refresh
  providers/       wiz.js  hubspace.js  cync.js
  http.js          small http(s) client (fetch can't set the Host header Afero needs)
  store.js         JSON data + DPAPI-encrypted secrets
src/renderer/    UI (plain HTML/CSS/JS)
test/show.js     lightshow analysis, generation, latency scheduling and playback tests
test/run.js      integration tests with mock bulbs / Keycloak / Afero / Cync servers
test/shot.js     Electron UI smoke test (screenshots to /tmp)
```

The Hubspace and Cync integrations are unofficial and reverse-engineered; they can break if the vendors change their cloud.

## Projection Studio

*Tools → Projection Studio* maps animations onto shapes that fit real things in the room and shows them through a projector, with the smart lights following.

1. Choose the projector under the display list and click **Project** (Esc closes it) or **Preview window**.
2. On **Mapping**, tick the calibration grid, add shapes and drag their corners onto walls, frames, doors and furniture. Every shape is independent; a wall can hold as many as you like.
3. On **Visuals**, click a shape and pick one of the 21 animations. Each shape has its own speed, colour shift, brightness, opacity and blending.
4. On **Lights**, choose what the bulbs do (Projection Only, Match Colours, Ambient, Music Sync, Immersive, Custom), then press **Play**. **Stop** puts every bulb back how it was.
5. On **Audio**, listen to the PC's sound or a microphone; each shape has its own reaction amount and band.

Bulbs are driven from a separate process at each brand's own pace, so a slow cloud bulb never slows the picture. Not included: mesh warping, edge blending between projectors, and video files as visuals.
