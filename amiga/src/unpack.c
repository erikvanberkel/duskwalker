// Decoder for the asset blob (encoder: tools/amiga/lib/lz.mjs), and the run-time sprite mirroring.
#include "assets.h"

void Unpack(const UBYTE *src, UBYTE *dst, ULONG size) {
	UBYTE *end = dst + size;
	while (dst < end) {
		UBYTE c = *src++;
		if (c < 0x80) {
			int n = c + 1;
			while (n--) *dst++ = *src++;
		} else {
			int n = (c & 0x7f) + 3;
			const UBYTE *m = dst - (((UWORD)src[0] << 8 | src[1]) + 1);
			src += 2;
			while (n--) *dst++ = *m++;
		}
	}
}

// Left-facing frames are stored empty and filled here by reversing every row of the right-facing ones.
void MirrorFrames(void) {
	UBYTE rev[256];
	for (int i = 0; i < 256; i++) {
		UBYTE r = 0;
		for (int b = 0; b < 8; b++) if (i & (1 << b)) r |= (UBYTE)(0x80 >> b);
		rev[i] = r;
	}
	for (int m = 0; m < NUM_MIRRORS; m++) {
		const Frame *s = &frames[mirrorPairs[m][0]], *d = &frames[mirrorPairs[m][1]];
		const UBYTE *src = assetChip + s->off;
		UBYTE *dst = assetChip + d->off;
		int rb = s->ww * 2, rows = s->h * 5;   // 4 interleaved plane rows per line plus the mask rows
		for (int r = 0; r < rows; r++) {
			const UBYTE *a = src + r * rb;
			UBYTE *b = dst + r * rb;
			for (int i = 0; i < rb; i++) b[rb - 1 - i] = rev[a[i]];
		}
	}
}
