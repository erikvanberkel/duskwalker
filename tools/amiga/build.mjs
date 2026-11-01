// Builds the Amiga 1200 version: amiga/src -> dist/Duskwalker-A1200 (AmigaDOS executable) + dist/Duskwalker-A1200.adf
//   node tools/amiga/build.mjs [--main hwtest] [--define NAME[=VALUE]] [--no-adf]
// Needs Bartman's amiga-debug toolchain (m68k-amiga-elf-gcc, elf2hunk, exe2adf): run `npm run amiga:toolchain` once,
// or point AMIGA_TOOLCHAIN at its bin/win32 folder.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixElf } from './lib/elffix.mjs';
import { checkHunks } from './lib/hunkcheck.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const src = join(root, 'amiga', 'src');
const out = join(root, 'amiga', 'build');
const dist = join(root, 'dist');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const mainName = opt('--main', 'main');
const defines = args.flatMap((a, i) => (a === '--define' ? ['-D' + args[i + 1]] : []));
const makeAdf = !args.includes('--no-adf');
const MAINS = ['main'];

const platformDir = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
const tc = process.env.AMIGA_TOOLCHAIN || join(root, '.toolchain', 'amiga-debug', 'extension', 'bin', platformDir);
const tool = (n) => {
  for (const p of [join(tc, 'opt', 'bin', n + '.exe'), join(tc, n + '.exe'), join(tc, 'opt', 'bin', n), join(tc, n)]) if (existsSync(p)) return p;
  throw new Error(`Amiga toolchain not found (${n}). Run "npm run amiga:toolchain" or set AMIGA_TOOLCHAIN.`);
};
const gcc = tool('m68k-amiga-elf-gcc');
const sdk = join(tc, 'opt', 'm68k-amiga-elf', 'sys-include');

mkdirSync(join(out, 'obj'), { recursive: true });
mkdirSync(dist, { recursive: true });

const cflags = ['-m68020', '-msoft-float', '-O2', '-fomit-frame-pointer', '-nostdlib', '-ffreestanding', '-fno-exceptions',
  '-ffunction-sections', '-fdata-sections', '-flto', '-fno-delete-null-pointer-checks', '-Wall', '-Wextra', '-Wno-unused-parameter', '-Wno-sign-compare',
  '-Wno-volatile-register-var', '-I', src, '-I', join(out, 'gen'), ...defines];

const run = (cmd, a, label) => {
  try { return execFileSync(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }); }
  catch (e) { process.stderr.write(e.stdout || ''); process.stderr.write(e.stderr || ''); throw new Error(`${label} failed`); }
};

const objs = [];
// start.s must be linked first: the hunk executable starts at its first byte.
for (const f of ['start.s', ...readdirSync(src).filter((f) => f.endsWith('.s') && f !== 'start.s')]) {
  const o = join(out, 'obj', f.replace(/\.s$/, '.o'));
  run(gcc, ['-m68020', '-c', '-x', 'assembler-with-cpp', '-I', src, '-I', out, ...defines, '-o', o, join(src, f)], `assemble ${f}`);
  objs.push(o);
}
// generated data (bitmaps, samples) lives in amiga/build/<main>_data.s
const dataAsm = join(out, mainName === 'main' ? 'assets_data.s' : `${mainName}_data.s`);
if (existsSync(dataAsm)) {
  const o = join(out, 'obj', basename(dataAsm).replace(/\.s$/, '.o'));
  run(gcc, ['-m68020', '-c', '-x', 'assembler-with-cpp', '-o', o, dataAsm], 'assemble data');
  objs.push(o);
}
const cfiles = readdirSync(src).filter((f) => f.endsWith('.c')).map((f) => join(src, f));
if (mainName === 'main') cfiles.push(join(out, 'gen', 'assets.c'));
for (const file of cfiles) {
  const stem = basename(file).replace(/\.c$/, '');
  if (MAINS.includes(stem) && stem !== mainName) continue;
  const o = join(out, 'obj', stem + '.o');
  const w = run(gcc, [...cflags, '-c', '-o', o, file], `compile ${basename(file)}`);
  if (w) process.stdout.write(w);
  objs.push(o);
}
const elf = join(out, `${mainName}.elf`);
const exe = join(out, `${mainName}.exe`);
const lw = run(gcc, [...cflags, '-Wl,--emit-relocs,--gc-sections,-Ttext=0,-Map=' + join(out, mainName + '.map'), ...objs, '-o', elf], 'link');
if (lw) process.stdout.write(lw);
const pcrel = fixElf(elf);
run(tool('elf2hunk'), [elf, exe], 'elf2hunk');
const hunkIssues = checkHunks(exe, elf);
if (hunkIssues.length) throw new Error(['elf2hunk output does not match the linked program:', ...hunkIssues.slice(0, 10)].join('\n  '));
const size = statSync(exe).size;
console.log(`Built ${exe} (${(size / 1024).toFixed(1)} KB, ${pcrel} PC-relative relocations resolved, hunks verified)`);

const name = mainName === 'main' ? 'Duskwalker-A1200' : `Duskwalker-${mainName}`;
const distExe = join(dist, name);
copyFileSync(exe, distExe);
if (makeAdf) {
  const adf = join(dist, `${name}.adf`);
  run(tool('exe2adf'), ['-i', distExe, '-a', adf, '-l', 'Duskwalker'], 'exe2adf');
  console.log(`Built ${adf}`);
}
