// Verifies an AmigaDOS hunk executable against the linked ELF: both are "loaded" at made-up hunk addresses,
// relocated, and compared word by word. Reports every difference (a broken relocation shows up here).
import { readFileSync } from 'node:fs';

function readHunks(file) {
  const b = readFileSync(file);
  let p = 0;
  const l = () => { const v = b.readUInt32BE(p); p += 4; return v; };
  if (l() !== 0x3f3) throw new Error('not a hunk executable');
  while (l()) {}   // resident library names
  const n = l(), first = l(), last = l();
  const sizes = [];
  for (let i = first; i <= last; i++) sizes.push((l() & 0x3fffffff) * 4);
  const hunks = sizes.map((s) => ({ size: s, data: Buffer.alloc(s), relocs: [] }));
  let h = -1;
  while (p < b.length) {
    const id = l() & 0x3fffffff;
    if (id === 0x3e9 || id === 0x3ea) { h++; const nl = l(); b.copy(hunks[h].data, 0, p, p + nl * 4); hunks[h].type = id; p += nl * 4; }
    else if (id === 0x3eb) { h++; l(); hunks[h].type = id; }
    else if (id === 0x3ec) { for (let c = l(); c; c = l()) { const t = l(); for (let i = 0; i < c; i++) hunks[h].relocs.push([t, l()]); } }
    else if (id === 0x3f2) { /* end */ }
    else if (id === 0x3f0) { for (let c = l(); c; c = l()) p += c * 4 + 4; }
    else if (id === 0x3f1) { p += l() * 4; }
    else throw new Error(`unknown hunk id 0x${id.toString(16)} at ${p - 4}`);
  }
  return hunks;
}

export function checkHunks(exeFile, elfFile) {
  const hunks = readHunks(exeFile);
  const bases = hunks.map((_, i) => 0x100000 * (i + 1) + 0x1230 * i);
  for (const [i, hk] of hunks.entries())
    for (const [t, off] of hk.relocs) hk.data.writeUInt32BE((hk.data.readUInt32BE(off) + bases[t]) >>> 0, off);
  // ELF: sections that occupy memory, in order; map them to hunks by order of appearance
  const e = readFileSync(elfFile);
  const shoff = e.readUInt32BE(0x20), shentsize = e.readUInt16BE(0x2e), shnum = e.readUInt16BE(0x30);
  const secs = [];
  for (let i = 0; i < shnum; i++) {
    const o = shoff + i * shentsize;
    secs.push({ type: e.readUInt32BE(o + 4), flags: e.readUInt32BE(o + 8), addr: e.readUInt32BE(o + 12), offset: e.readUInt32BE(o + 16), size: e.readUInt32BE(o + 20) });
  }
  const alloc = secs.map((s, i) => ({ ...s, i })).filter((s) => s.flags & 2 && s.size > 0);
  if (alloc.length !== hunks.length) return [`${alloc.length} ELF sections vs ${hunks.length} hunks`];
  const issues = [];
  // relocate the ELF image: every absolute address pointing into section k moves by bases[k] - addr_k
  const findSec = (a) => { const i = alloc.findIndex((s) => a >= s.addr && a < s.addr + Math.max(s.size, 1)); return i >= 0 ? i : alloc.findIndex((s) => a === s.addr + s.size); };
  alloc.forEach((s, k) => {
    if (s.type === 8) return;
    const hk = hunks[k];
    // compare raw bytes ignoring 32-bit words that the hunk relocates
    const relocated = new Set(hk.relocs.map(([, off]) => off));
    for (let off = 0; off + 4 <= s.size; off += 2) {
      if (!relocated.has(off) && !relocated.has(off - 2) && off % 2 === 0) {
        const want = e.readUInt16BE(s.offset + off), got = hk.data.readUInt16BE(off);
        if (want !== got && !relocated.has(off - 2)) issues.push(`hunk ${k} +0x${off.toString(16)}: byte mismatch 0x${got.toString(16)} vs ELF 0x${want.toString(16)}`);
      }
      if (relocated.has(off)) {
        const want = e.readUInt32BE(s.offset + off), got = hk.data.readUInt32BE(off);
        const ks = findSec(want);
        if (ks < 0) { issues.push(`hunk ${k} +0x${off.toString(16)}: relocated word 0x${want.toString(16)} points outside all sections`); continue; }
        const exp = (want - alloc[ks].addr + bases[ks]) >>> 0;
        if (exp !== got) issues.push(`hunk ${k} +0x${off.toString(16)}: got 0x${got.toString(16)} expected 0x${exp.toString(16)}`);
      }
    }
  });
  // every absolute ELF relocation must have a matching hunk relocation
  secs.forEach((rs) => {
    if (rs.type !== 4) return;
  });
  for (let i = 0; i < shnum; i++) {
    const o = shoff + i * shentsize;
    if (e.readUInt32BE(o + 4) !== 4) continue;
    const off0 = e.readUInt32BE(o + 16), size = e.readUInt32BE(o + 20), info = e.readUInt32BE(o + 28);
    const k = alloc.findIndex((s) => s.i === info);
    if (k < 0) continue;
    const have = new Set(hunks[k].relocs.map(([, off]) => off));
    for (let r = off0; r < off0 + size; r += 12) {
      const type = e.readUInt32BE(r + 4) & 0xff;
      if (type !== 1) continue;   // R_68K_32
      const at = e.readUInt32BE(r) - alloc[k].addr;
      if (!have.has(at)) issues.push(`missing relocation: section ${alloc[k].i} +0x${at.toString(16)}`);
    }
  }
  return issues;
}
