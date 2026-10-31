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
npm run dist           # build a portable Duskwalker .exe into dist/
```

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
