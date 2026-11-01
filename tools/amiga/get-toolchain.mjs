// Downloads the Amiga cross toolchain used by tools/amiga/build.mjs into .toolchain/ (git-ignored):
// Bartman's "amiga-debug" VS Code extension (GPL-3.0, github.com/BartmanAbyss/vscode-amiga-debug), which bundles
// m68k-amiga-elf-gcc, elf2hunk, exe2adf and a WinUAE build. Only the tools are used; nothing is installed.
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.8.2';
const root = fileURLToPath(new URL('../..', import.meta.url));
const base = join(root, '.toolchain');
const dl = join(base, 'dl');
const dest = join(base, 'amiga-debug');
const vsix = join(dl, `amiga-debug-${VERSION}.vsix`);
const url = `https://github.com/BartmanAbyss/vscode-amiga-debug/releases/download/${VERSION}/amiga-debug-${VERSION}.vsix`;

mkdirSync(dl, { recursive: true });
if (!existsSync(vsix)) {
  console.log(`Downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  writeFileSync(vsix, Buffer.from(await res.arrayBuffer()));
}
console.log('Unpacking ...');
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
// a .vsix is a zip: Windows 10+ ships bsdtar, elsewhere use unzip
if (process.platform === 'win32') execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', vsix, '-C', dest], { stdio: 'inherit' });
else execFileSync('unzip', ['-q', vsix, '-d', dest], { stdio: 'inherit' });
const bin = join(dest, 'extension', 'bin', process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux');
if (process.platform !== 'win32') execFileSync('chmod', ['-R', 'u+x', bin]);
console.log(`Toolchain ready in ${bin}`);
