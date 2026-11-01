// Starts dist/Duskwalker-A1200.adf in the bundled WinUAE as a stock Amiga 1200 (68EC020, 2 MB chip, AGA).
// Uses the Kickstart ROM in AMIGA_KICKSTART if set (e.g. a Kickstart 3.1 file you own), otherwise WinUAE's
// built-in AROS replacement ROM.   npm run amiga:run   (or: npm run amiga:run -- some.adf)
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const adf = process.argv[2] || join(root, 'dist', 'Duskwalker-A1200.adf');
const uae = join(process.env.AMIGA_TOOLCHAIN || join(root, '.toolchain', 'amiga-debug', 'extension', 'bin', 'win32'), 'winuae-gdb.exe');
if (process.platform !== 'win32') throw new Error('The bundled WinUAE is Windows-only; open the ADF in FS-UAE or on a real A1200.');
if (!existsSync(uae)) throw new Error('WinUAE not found. Run "npm run amiga:toolchain" first.');
if (!existsSync(adf)) throw new Error('No ADF yet. Run "npm run dist:amiga" first.');
const rom = process.env.AMIGA_KICKSTART || ':AROS';
const args = ['-s', 'use_gui=no', '-s', 'quickstart=a1200,0', '-s', `kickstart_rom_file=${rom}`, '-s', `floppy0=${adf}`,
  '-s', 'cycle_exact=true', '-s', 'cpu_cycle_exact=true', '-s', 'cpu_memory_cycle_exact=true', '-s', 'blitter_cycle_exact=true',
  '-s', 'gfx_linemode=double', '-s', 'win32.start_not_captured=false'];
spawn(uae, args, { detached: true, stdio: 'ignore' }).unref();
console.log(`WinUAE started (${rom === ':AROS' ? 'AROS ROM' : rom}). Keyboard: cursor keys + J/X/Ctrl; F12 opens WinUAE's menu.`);
