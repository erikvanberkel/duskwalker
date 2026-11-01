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

## Amiga 1200 version

`amiga/` holds a native port for the **Amiga 1200** (AGA chipset, 68EC020, 2 MB chip RAM, Kickstart 3.x),
written in C against the bare hardware. three.js cannot run on a 68020, so the scene is rebuilt the way
Amiga games did parallax:

- **Playfield 1** is a stack of copper-split bands: the dusk sky (a 24-bit copper gradient with translucent
  clouds, moon halo and sun glow done by recolouring per line) with the far ridge and the setting sun, the
  middle layer of forest standing on the horizon (hazy acacias, lantern trees, pines or dead trees by zone,
  in front of the nearer hills, scrolling with the floor beneath it) and a perspective floor where every line
  scrolls at its own speed.
- **Playfield 2** is a scrolling ribbon of the near trees and causeway ruins, with the wanderer, the foes, the
  Bramble Titan, relics, sparks, fireflies and soft ground shadows drawn on it by the blitter. Its bottom lines
  switch (by a copper modulo jump) to a strip of foreground grass blades that scrolls faster than the path.
- The sprites are the game's own three.js models (wanderer, skitter, stalker, wisp, Titan, seeds, relics,
  trees, ruins) rendered frame by frame and reduced to the Amiga palettes, so both versions look alike.
- Sound effects and music are the same Web Audio recipes rendered offline to 8-bit samples. The drone, the
  slow chord pads with their echo and the kick are one seamless 23-second loop; a sequencer plays the random
  plucked melody over it with its 0.42 s echo on the other side of the stereo picture, and a war drum in the
  Titan fight. `amiga/build/preview/audio/` gets WAVs of every sample and of the music as the Amiga plays it.
- Game logic is a fixed-point port of `main.js`, `player.js` and `enemies.js` at a fixed 50 Hz.

| File | Size | What it is |
| --- | --- | --- |
| `dist/Duskwalker-A1200.adf` | 880 KB | Bootable floppy image: write it to a disk (or put it on a Gotek) and power on. |
| `dist/Duskwalker-A1200` | ~360 KB | The program alone: copy it to a hard disk and start it from the Shell. Esc on the title returns to the OS. |

On a stock A1200 it draws 40–50 frames per second while walking and fighting, and 20–25 in the Titan fight
(the Titan is drawn together with its background in a single blitter pass); the game logic always runs at
50 Hz, so the speed of play stays the same.

Controls: joystick in port 2 (left/right walk, up or second button jump, down crouch, fire strike) or the
keyboard keys of the PC version. **P** pauses, **M** toggles the music. A jump pressed just before landing and
a strike pressed near the end of a swing are remembered for a moment instead of being lost.

### Building it

```bash
npm run amiga:toolchain   # once: downloads the m68k gcc toolchain + WinUAE into .toolchain/ (git-ignored)
npm run dist:amiga        # bake the 3D frames, build the Amiga data, compile, make the ADF
npm run amiga:run         # play the ADF in WinUAE as a stock A1200 (Windows)
```

`dist:amiga` runs three steps you can also run alone: `amiga:bake` (Electron renders the models to
`amiga/build/bake/`), `amiga:assets` (palettes, bitplanes, copper tables, samples; previews of every playfield
and WAVs of every sound land in `amiga/build/preview/`) and `amiga:build` (compiles `amiga/src`).
`amiga:run` uses WinUAE's built-in AROS Kickstart replacement unless `AMIGA_KICKSTART` points at a Kickstart
3.x ROM file of your own.

The toolchain is [Bartman's amiga-debug](https://github.com/BartmanAbyss/vscode-amiga-debug) (gcc 15 for
m68k, elf2hunk, exe2adf). Its elf2hunk mishandles the PC-relative branches gcc emits for the 68020, so
`tools/amiga/lib/elffix.mjs` removes those relocations first, and every build is checked word by word
against the linked program (`tools/amiga/lib/hunkcheck.mjs`).

Debug builds: `node tools/amiga/build.mjs --define AUTOPLAY` (the wanderer walks and fights by itself),
`--define AUTOX=840` (start further along), `--define SHOWFPS` (frame rate and per-phase raster time in the
HUD; add `SHOWDRAW` for the drawing phases), `--define SHOWMEM` (free chip RAM in the HUD) and `--define WATCHDOG` (a stalled main loop or a CPU exception freezes the screen with a coded report;
`tools/amiga/dev/hexbands.ps1` decodes a screenshot of it).

| File | What it holds |
| --- | --- |
| `amiga/src/main.c` | Start-up, intro (copper bars), title and game-over screens, HUD, main loop |
| `amiga/src/game.c` | Wanderer, scarf, foes, Titan, waves, relics, particles, camera (fixed point) |
| `amiga/src/gfx.c` | Copper list compiler, playfield bands, tree ribbon, blitter objects, palettes |
| `amiga/src/audio.c` | Paula playback and the music sequencer |
| `amiga/src/sys.c` | Taking over and restoring the system, interrupts, keyboard and joystick |
| `tools/amiga/bake/` | Electron page that poses and renders the three.js models |
| `tools/amiga/assets.mjs` | Builds every bitmap, palette, band table and sample (`lib/` has the parts) |
| `tools/amiga/build.mjs` | Compiles, links, converts to an AmigaDOS executable and writes the ADF |
