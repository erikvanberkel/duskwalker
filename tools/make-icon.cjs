// Renders build/icon.png (512x512) with a canvas in a hidden Electron window.
// Usage: npx electron tools/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const draw = `
const c = document.createElement('canvas'); c.width = c.height = 512;
const x = c.getContext('2d');
// rounded tile with dusk sky
x.beginPath(); x.roundRect(8, 8, 496, 496, 96); x.clip();
const sky = x.createLinearGradient(0, 0, 0, 512);
sky.addColorStop(0, '#1a0c38'); sky.addColorStop(0.45, '#5a2876'); sky.addColorStop(0.75, '#e0776a'); sky.addColorStop(1, '#f6b073');
x.fillStyle = sky; x.fillRect(0, 0, 512, 512);
// moon with halo
const halo = x.createRadialGradient(350, 150, 40, 350, 150, 170);
halo.addColorStop(0, 'rgba(255,230,255,.55)'); halo.addColorStop(1, 'rgba(255,200,255,0)');
x.fillStyle = halo; x.fillRect(0, 0, 512, 512);
x.fillStyle = '#f6e8ff'; x.beginPath(); x.arc(350, 150, 62, 0, Math.PI * 2); x.fill();
// distant ridge
x.fillStyle = '#3e1f4e'; x.beginPath(); x.moveTo(0, 400);
for (let i = 0; i <= 512; i += 16) x.lineTo(i, 372 - Math.abs(Math.sin(i * 0.021) * 46) - Math.sin(i * 0.07) * 9);
x.lineTo(512, 512); x.lineTo(0, 512); x.fill();
// giant tree silhouette
x.fillStyle = '#120a14';
x.beginPath(); x.moveTo(118, 512); x.bezierCurveTo(150, 420, 160, 330, 150, 230); x.lineTo(196, 230);
x.bezierCurveTo(190, 330, 200, 420, 250, 512); x.fill();
x.lineWidth = 16; x.strokeStyle = '#120a14'; x.lineCap = 'round';
for (const [a, b, c2, d] of [[170, 250, 80, 170], [175, 245, 260, 160], [172, 260, 30, 230], [175, 255, 300, 230]]) { x.beginPath(); x.moveTo(a, b); x.quadraticCurveTo((a + c2) / 2, b - 50, c2, d); x.stroke(); }
for (const [cx, cy, r] of [[60, 160, 60], [130, 120, 74], [215, 130, 70], [285, 175, 54], [20, 215, 46], [170, 190, 60], [95, 205, 50], [250, 220, 40]]) { x.beginPath(); x.ellipse(cx, cy, r * 1.15, r * 0.62, 0, 0, Math.PI * 2); x.fill(); }
// ground
x.fillStyle = '#160c12'; x.fillRect(0, 470, 512, 42);
// hooded wanderer
x.fillStyle = '#0b0710';
x.beginPath(); x.moveTo(360, 470); x.lineTo(372, 380); x.quadraticCurveTo(372, 330, 398, 318);
x.quadraticCurveTo(436, 300, 446, 344); x.lineTo(452, 380); x.lineTo(464, 470); x.fill();
x.beginPath(); x.moveTo(400, 318); x.quadraticCurveTo(380, 300, 362, 316); x.quadraticCurveTo(384, 312, 398, 330); x.fill();
// scarf
x.strokeStyle = '#c2302c'; x.lineWidth = 9; x.beginPath(); x.moveTo(380, 386); x.quadraticCurveTo(410, 396, 444, 386); x.stroke(); x.beginPath(); x.moveTo(444, 386); x.bezierCurveTo(470, 380, 486, 396, 508, 384); x.stroke();
// glowing eyes
for (const ex of [412, 432]) {
  const g = x.createRadialGradient(ex, 346, 0, ex, 346, 16);
  g.addColorStop(0, 'rgba(255,220,140,1)'); g.addColorStop(0.3, 'rgba(255,150,40,.9)'); g.addColorStop(1, 'rgba(255,120,20,0)');
  x.fillStyle = g; x.fillRect(ex - 16, 330, 32, 32);
}
c.toDataURL('image/png');
`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<body></body>');
  const url = await win.webContents.executeJavaScript(draw);
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', out);
  app.quit();
});
