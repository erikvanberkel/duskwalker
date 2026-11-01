// Amiga hardware access: custom chips, CIAs, copper and blitter helpers.
#pragma once
#include <exec/types.h>
#include <hardware/custom.h>
#include <hardware/dmabits.h>
#include <hardware/intbits.h>
#include <hardware/cia.h>

#define CUSTOM ((volatile struct Custom *)0xdff000)
#define CIAA ((volatile struct CIA *)0xbfe001)
#define CIAB ((volatile struct CIA *)0xbfd000)

// Byte offset of a custom register, as the copper wants it.
#define CREG(r) ((UWORD)__builtin_offsetof(struct Custom, r))

#define INLINE static inline __attribute__((always_inline))

void *memcpy(void *, const void *, unsigned long);
void *memset(void *, int, unsigned long);

// ---- copper list emitters ----
#define COP_MOVE(p, reg, val) do { *(p)++ = CREG(reg); *(p)++ = (UWORD)(val); } while (0)
#define COP_MOVEO(p, off, val) do { *(p)++ = (UWORD)(off); *(p)++ = (UWORD)(val); } while (0)
// Wait for beam line v (0..255, caller handles the >255 wrap) at colour-clock h.
#define COP_WAIT(p, v, h) do { *(p)++ = (UWORD)((((v) & 0xff) << 8) | ((h) & 0xfe) | 1); *(p)++ = 0xfffe; } while (0)
#define COP_END(p) do { *(p)++ = 0xffff; *(p)++ = 0xfffe; } while (0)

// ---- display constants (PAL lowres, AGA 4x fetch) ----
#define SCREEN_W 320
#define SCREEN_H 256
#define DISP_VSTART 0x2c        // first visible beam line
#define FETCH_BYTES 48          // bytes fetched per plane per line (384 px: 320 + one 64 px block for scrolling)

// BPLCON3 base: PF2 colours start at 16, sprites lowres, border blanked
#define BPLCON3_BASE 0x1020
#define BPLCON3_LOCT 0x0200

// While the CPU has nothing to do but wait, give the blitter every free bus cycle (BLITHOG): otherwise the
// polling loop itself takes one cycle in four from it.
INLINE void WaitBlit(void) {
	(void)CUSTOM->dmaconr;
	if (CUSTOM->dmaconr & DMAF_BLTDONE) {
		CUSTOM->dmacon = DMAF_SETCLR | DMAF_BLITHOG;
		while (CUSTOM->dmaconr & DMAF_BLTDONE) {}
		CUSTOM->dmacon = DMAF_BLITHOG;
	}
}

INLINE ULONG BeamLine(void) {
	return ((*(volatile ULONG *)0xdff004) >> 8) & 0x1ff;
}

// AGA BPLCON1 scroll bits for a lowres delay of 0..63 pixels per playfield.
INLINE UWORD Bplcon1Bits(UWORD pf1, UWORD pf2) {
	return (UWORD)((pf1 & 15) | ((pf2 & 15) << 4) | (((pf1 >> 4) & 3) << 10) | (((pf2 >> 4) & 3) << 14));
}
