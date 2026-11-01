// Tiny byte LZ77 used for the asset blob (decoder: amiga/src/unpack.c).
//   control < 0x80: (control + 1) literal bytes follow
//   control >= 0x80: copy (control & 0x7f) + 3 bytes from (2-byte big-endian offset) + 1 bytes back
export function lzPack(src) {
  const out = [];
  const head = new Int32Array(1 << 16).fill(-1), prev = new Int32Array(src.length).fill(-1);
  const hash = (i) => ((src[i] << 8) ^ (src[i + 1] << 4) ^ src[i + 2]) & 0xffff;
  let lit = [];
  const flush = () => { while (lit.length) { const n = Math.min(128, lit.length); out.push(n - 1, ...lit.splice(0, n)); } };
  const insert = (i) => { if (i + 2 < src.length) { const h = hash(i); prev[i] = head[h]; head[h] = i; } };
  let i = 0;
  while (i < src.length) {
    let bestLen = 0, bestOff = 0;
    if (i + 2 < src.length) {
      let j = head[hash(i)], tries = 48;
      while (j >= 0 && i - j <= 65536 && tries--) {
        let l = 0;
        while (l < 130 && i + l < src.length && src[j + l] === src[i + l]) l++;
        if (l > bestLen) { bestLen = l; bestOff = i - j; if (l === 130) break; }
        j = prev[j];
      }
    }
    if (bestLen >= 3) {
      flush();
      out.push(0x80 | (bestLen - 3), (bestOff - 1) >> 8, (bestOff - 1) & 255);
      for (let k = 0; k < bestLen; k++) insert(i + k);
      i += bestLen;
    } else {
      lit.push(src[i]);
      insert(i);
      i++;
    }
  }
  flush();
  return Uint8Array.from(out);
}

export function lzUnpack(src, size) {
  const dst = new Uint8Array(size);
  let s = 0, d = 0;
  while (d < size) {
    const c = src[s++];
    if (c < 0x80) for (let n = c + 1; n--;) dst[d++] = src[s++];
    else { const n = (c & 0x7f) + 3, off = ((src[s] << 8) | src[s + 1]) + 1; s += 2; for (let k = 0; k < n; k++, d++) dst[d] = dst[d - off]; }
  }
  return dst;
}
