# DUSKWALKER — a Mirage production

A side-scrolling parallax action game rendered in real-time 3D. Walk the Amber Plains beneath
giant trees, through the Whispering Grove and across the Sunken Causeway to face the Bramble Titan.

Built with HTML, CSS and JavaScript (three.js). On Windows the desktop build runs in Electron with
WebGL pinned to **ANGLE → Direct3D 11**, so every frame is rendered through DirectX.

## Run

```bash
npm install            # first time only
npm start              # Windows desktop app (DirectX 11)
npm run web            # or play in a browser at http://localhost:8080
```

## Sharing it with friends

```bash
npm run dist           # dist/Duskwalker.exe + dist/Duskwalker.html + dist/Duskwalker-itch.zip
npm run dist:electron  # optional: 80 MB Electron installer and portable exe
```

| File | Size | Best for |
| --- | --- | --- |
| `Duskwalker.exe` | ~0.75 MB | **Windows.** One self-contained file: double-click to play. It opens the game in its own Microsoft Edge app window (Edge ships with Windows 10/11) with WebGL pinned to Direct3D 11. |
| `Duskwalker.html` | ~0.7 MB | **Any computer.** The whole game in one file: double-click to play in the browser (Edge, Chrome, Firefox, Safari). |
| `Duskwalker-itch.zip` | ~0.25 MB | Upload to itch.io as an HTML game so friends can play from a link. |
| Electron builds | ~80 MB | Only if a PC has no Edge; they carry their own browser engine. |

`Duskwalker.exe` is built with the C# compiler that comes with Windows (no SDK needed); its source is
`launcher/Duskwalker.cs`. It is not code-signed, so Windows SmartScreen may show "Windows protected
your PC" the first time; friends click **More info → Run anyway**.

Bump `version` in `package.json` before each Electron release so the file names change.

If `npm run dist:electron` fails with "Cannot create symbolic link" while unpacking `winCodeSign`, either
enable Windows Developer Mode once or unpack that archive into
`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0` with its `darwin` folder excluded.

three.js is vendored in `vendor/three` (only the parts the game uses). After upgrading the `three`
package run `npm run vendor`.

In the desktop app: **F11** / **Alt+Enter** toggles fullscreen, **F12** opens dev tools.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Walk | ← → / A D | Left stick / D-pad |
| Jump | ↑ / W / Space | A |
| Crouch | ↓ / S | Down |
| Strike | J / X / Ctrl | X / B |
| Pause · Music · Bloom | P · M · B | Start |

## Mirage logo

Drop your logo at `assets/mirage-logo.png` (transparent PNG works best). The intro picks it up
automatically; until then it shows the chrome "MIRAGE" wordmark over copper bars.

## Layout

| File | What it holds |
| --- | --- |
| `src/main.js` | Renderer, bloom, lighting, camera, input, waves, combat, HUD, intro |
| `src/trees.js` | Procedural 3D tree generator (giant, broad, spire, dead, lantern) and instancing |
| `src/world.js` | Terrain, grass, stones and ruins, tree placement across parallax depths, fireflies |
| `src/sky.js` | Sky dome, sun, moons, stars, clouds, mountain ridge layers |
| `src/airship.js` | The airship model and its animation |
| `src/player.js` | The hooded wanderer: model, procedural animation, verlet scarf |
| `src/enemies.js` | Skitter, Stalker, Wisp, the Bramble Titan, projectiles, health relics |
| `src/audio.js` | Procedural sound effects and generative music (Web Audio, no samples) |
| `electron/main.cjs` | Windows shell (D3D11 backend, `app://` protocol) |

## Dev screenshots

`DUSK_SHOT=<dir> npm start` drives the game through the intro, title and each zone, saves PNGs into
`<dir>` and prints the frame rate. Add `DUSK_LOG=1` to mirror the renderer console (including the GPU
backend string) to the terminal.
