// Renders the game's own three.js models (wanderer, foes, Titan, trees, ruins) and title lettering into
// PNG frames for the Amiga build:  npx electron tools/amiga/bake/main.cjs  ->  amiga/build/bake/*.png + bake.json
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

app.commandLine.appendSwitch('use-angle', 'd3d11');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
const ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(ROOT, 'amiga', 'build', 'bake');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

app.whenReady().then(async () => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 640, height: 480, webPreferences: { backgroundThrottling: false, offscreen: false } });
  win.webContents.on('console-message', (_e, level, message) => console.log('[bake]', message));
  await win.loadURL('app://game/tools/amiga/bake/bake.html');
  const t0 = Date.now();
  let status;
  while (!(status = await win.webContents.executeJavaScript('window.__bakeStatus'))) {
    if (Date.now() - t0 > 180000) throw new Error('bake timed out');
    await new Promise((r) => setTimeout(r, 200));
  }
  if (status !== 'done') { console.error('bake failed:', status); app.exit(1); return; }
  const names = await win.webContents.executeJavaScript('Object.keys(window.__bakeImages)');
  for (const n of names) {
    const url = await win.webContents.executeJavaScript(`window.__bakeImages[${JSON.stringify(n)}]`);
    fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(url.split(',')[1], 'base64'));
  }
  const meta = await win.webContents.executeJavaScript('JSON.stringify(window.__bakeMeta)');
  fs.writeFileSync(path.join(OUT, 'bake.json'), meta);
  console.log(`baked ${names.length} images into ${OUT}`);
  app.exit(0);
});
