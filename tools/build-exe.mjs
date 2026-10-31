// Builds dist/Duskwalker.exe: a small, fully self-contained Windows exe with the
// single-file game embedded. Uses the C# compiler that ships with Windows
// (.NET Framework 4.x), so no extra SDK is needed. Run tools/build-html.mjs first.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = join(root, 'dist', 'Duskwalker.html');
if (!existsSync(html)) throw new Error('dist/Duskwalker.html is missing: run "node tools/build-html.mjs" first');

const windir = process.env.SystemRoot || 'C:\\Windows';
const csc = [join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')]
  .find(existsSync);
if (!csc) throw new Error('The .NET Framework C# compiler (csc.exe) was not found; it ships with Windows 10/11.');

const out = join(root, 'dist', 'Duskwalker.exe');
execFileSync(csc, [
  '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu',
  `/out:${out}`,
  `/win32icon:${join(root, 'build', 'icon.ico')}`,
  `/resource:${html},Duskwalker.html`,
  '/reference:System.Windows.Forms.dll',
  join(root, 'launcher', 'Duskwalker.cs'),
], { stdio: 'inherit' });
console.log(`Built ${out}`);
