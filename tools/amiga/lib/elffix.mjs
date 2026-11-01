// elf2hunk mishandles PC-relative relocations (the bra.l / bsr.l gcc emits for the 68020): it either adds the
// hunk address to the displacement or, for R_68K_NONE, zeroes the field. Inside one section the linker has
// already resolved them, so the entries are deleted outright; a PC-relative reference into another section
// cannot survive hunk splitting, so that fails loudly.
import { readFileSync, writeFileSync } from 'node:fs';

const PCREL = new Set([4, 5, 6]);   // R_68K_PC32, PC16, PC8

export function fixElf(file) {
  const b = readFileSync(file);
  const u32 = (o) => b.readUInt32BE(o), u16 = (o) => b.readUInt16BE(o);
  const shoff = u32(0x20), shentsize = u16(0x2e), shnum = u16(0x30);
  const sec = (i) => {
    const o = shoff + i * shentsize;
    return { type: u32(o + 4), offset: u32(o + 16), size: u32(o + 20), link: u32(o + 24), info: u32(o + 28), entsize: u32(o + 36) };
  };
  let fixed = 0;
  const bad = [];
  for (let i = 0; i < shnum; i++) {
    const s = sec(i);
    if (s.type !== 4) continue;               // SHT_RELA
    const symtab = sec(s.link);
    let w = s.offset;
    for (let o = s.offset; o < s.offset + s.size; o += 12) {
      const info = u32(o + 4), type = info & 0xff, sym = info >>> 8;
      if (PCREL.has(type)) {
        const shndx = u16(symtab.offset + sym * 16 + 14);
        if (shndx === s.info) { fixed++; continue; }   // drop the entry
        bad.push(`offset 0x${u32(o).toString(16)} (type ${type}) -> section ${shndx}`);
      }
      if (w !== o) b.copy(b, w, o, o + 12);
      w += 12;
    }
    b.writeUInt32BE(w - s.offset, shoff + i * shentsize + 20);   // new sh_size
  }
  if (bad.length) throw new Error(`PC-relative references across sections cannot be turned into hunks:\n  ${bad.slice(0, 10).join('\n  ')}`);
  writeFileSync(file, b);
  return fixed;
}
