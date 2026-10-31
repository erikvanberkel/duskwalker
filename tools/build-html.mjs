// Builds the whole game into ONE self-contained HTML file: dist/Duskwalker.html
// (double-click to play, works straight from disk) plus dist/Duskwalker-itch.zip
// (the same file as index.html, ready to upload to itch.io as an HTML game).
import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const vendor = join(root, 'vendor', 'three');
mkdirSync(dist, { recursive: true });

// Resolve the import-map names to the vendored three.js files.
const threeVendor = {
  name: 'three-vendor',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: join(vendor, 'build', 'three.module.js') }));
    b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: join(vendor, 'examples', 'jsm', a.path.slice('three/addons/'.length)) }));
  },
};

const result = await build({
  entryPoints: [join(root, 'src', 'main.js')],
  bundle: true, format: 'esm', target: 'es2020', minify: true,
  legalComments: 'eof', write: false, logLevel: 'warning', plugins: [threeVendor],
});
let js = result.outputFiles[0].text;

const dataUri = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;
const logo = join(root, 'assets', 'mirage-logo.png');
if (existsSync(logo)) js = js.replaceAll('assets/mirage-logo.png', dataUri(logo, 'image/png'));
js = js.replace(/<\/script/gi, '<\\/script');

let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\r?\n?/, '')
  .replace(/<script type="importmap">[\s\S]*?<\/script>\r?\n?/, '')
  .replace('<title>Duskwalker</title>', () => `<title>Duskwalker</title>\n<link rel="icon" href="${dataUri(join(root, 'build', 'icon.png'), 'image/png')}">`)
  .replace('<script type="module" src="./src/main.js"></script>', () => `<script type="module">\n${js}\n</script>`);
if (html.includes('src="./src/main.js"')) throw new Error('index.html changed: could not inline the game script');

const out = join(dist, 'Duskwalker.html');
writeFileSync(out, html);
console.log(`Built ${out} (${(html.length / 1024).toFixed(0)} KB)`);

// itch.io wants a zip with index.html at its root.
const stage = join(dist, '.itch');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage);
writeFileSync(join(stage, 'index.html'), html);
const zip = join(dist, 'Duskwalker-itch.zip');
rmSync(zip, { force: true });
try {
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'zip';
  const args = process.platform === 'win32' ? ['-a', '-c', '-f', zip, 'index.html'] : ['-q', zip, 'index.html'];
  execFileSync(tar, args, { cwd: stage });
  console.log(`Built ${zip}`);
} catch (e) {
  console.warn('Could not create the itch.io zip:', e.message);
}
rmSync(stage, { recursive: true, force: true });
