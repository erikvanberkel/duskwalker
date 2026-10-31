// Duskwalker desktop shell (Windows).
// WebGL in Chromium on Windows runs through ANGLE; we pin ANGLE to Direct3D 11
// so every frame of the game is rendered by DirectX.
const { app, BrowserWindow, protocol, net, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

app.commandLine.appendSwitch('use-angle', 'd3d11');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force_high_performance_gpu');

const ROOT = path.join(__dirname, '..');

// A privileged custom scheme so ES modules + import maps load from disk like a web server.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#000000',
    title: 'Duskwalker',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  Menu.setApplicationMenu(null);
  win.loadURL('app://game/index.html');
  if (process.env.DUSK_LOG) {
    win.webContents.on('console-message', (_e, level, message, line, src) => console.log(`[renderer:${level}] ${message} (${src}:${line})`));
    app.getGPUInfo('basic').then((i) => console.log('[gpu]', JSON.stringify(i.gpuDevice?.map((d) => d.deviceString || d.vendorId))));
  }

  if (process.env.DUSK_SHOT) shoot(win, process.env.DUSK_SHOT);

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'F12') {
      win.webContents.toggleDevTools();
    }
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!file.startsWith(ROOT)) return new Response('Forbidden', { status: 403 });
    if (!fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());

// Dev aid: DUSK_SHOT=<dir> drives the game through key scenes and saves screenshots.
async function shoot(win, dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(code);
  const snap = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
    console.log('[shot]', name);
  };
  const shots = (process.env.DUSK_SHOT_LIST || 'intro,title,plains,giants,grove,causeway,arena').split(',');
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await wait(2500);
  if (shots.includes('intro')) await snap('intro');
  await js("dispatchEvent(new KeyboardEvent('keydown',{code:'KeyQ'}))");
  await wait(3500);
  if (shots.includes('title')) await snap('title');
  await js("dispatchEvent(new KeyboardEvent('keydown',{code:'Enter'})); dispatchEvent(new KeyboardEvent('keyup',{code:'Enter'}))");
  const at = { plains: 30, giants: 150, grove: 450, causeway: 700, arena: 860 };
  for (const name of shots) {
    if (!(name in at)) continue;
    await js(`(() => { const G = window.__game; G.player.x = ${at[name]}; G.camX = ${at[name]} + 2.5; G.player.hp = 10; })()`);
    await js("dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowRight'}))");
    await wait(name === 'arena' ? 2600 : 1800);
    await js("dispatchEvent(new KeyboardEvent('keydown',{code:'KeyJ'}))");
    await wait(130);
    await snap(name);
    await js("dispatchEvent(new KeyboardEvent('keyup',{code:'ArrowRight'})); dispatchEvent(new KeyboardEvent('keyup',{code:'KeyJ'}))");
  }
  const fps = await js(`new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); })`);
  console.log('[fps]', fps);
  app.quit();
}
