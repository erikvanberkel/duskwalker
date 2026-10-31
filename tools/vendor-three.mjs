// Copies the parts of three.js the game uses into vendor/three (run after upgrading three).
import { cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'node_modules', 'three');
const dst = join(root, 'vendor', 'three');
rmSync(dst, { recursive: true, force: true });
cpSync(join(src, 'build', 'three.module.js'), join(dst, 'build', 'three.module.js'));
for (const dir of ['postprocessing', 'shaders']) cpSync(join(src, 'examples', 'jsm', dir), join(dst, 'examples', 'jsm', dir), { recursive: true });
cpSync(join(src, 'LICENSE'), join(dst, 'LICENSE'));
console.log('three.js vendored into', dst);
