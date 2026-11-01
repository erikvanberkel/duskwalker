// Display engine. See gfx.h for the overview.
//
// PF1 (odd planes) is a stack of horizontal bands, all stored in one set of four planes. The bitplane
// pointers are written once per frame; every band switch and every per-line floor scroll is done with
// BPL1MOD (jump to the next row's data) and BPLCON1 (fine scroll) from the copper.
// PF2 (even planes) is a "ribbon": eight 64 px blocks per row, so scrolling right simply walks the
// pointer forward and the block that falls off the left edge reappears one row lower on the right.
#include "gfx.h"
#include "sys.h"
#include "fixed.h"
#include <hardware/blit.h>

#define COP_WORDS 14000   // the busiest layout (title) needs about 7000
#define PF2_RB 64
#define PF2_ROWS (SCREEN_H + RIBBON_EXTRA_ROWS + 2)
#define PF2_PLANE (PF2_RB * PF2_ROWS)
#define PF2_FG_OFF PF2_PLANE         // the foreground grass strip follows the ribbon in each display plane

ULONG pal[PAL_N];
UWORD gfxBlits;

static UWORD *cop[2];
static int back;                   // copper list / PF2 buffer being prepared
static UBYTE *ribbonClean[4], *ribbon[2][4];
UBYTE *pf2TextPlanes[4];
static UBYTE *zeroLine;

// ---- copper patch slots (same layout in both lists) ----
typedef struct { UWORD *hi[2], *lo[2]; UWORD pal; } ColorSlot;
#define NO_TINT 0x8000   // flag on a slot's palette index: not affected by flashes and dimming
#define MAX_COLOR_SLOTS 2600
static ColorSlot colorSlots[MAX_COLOR_SLOTS];
static int numColorSlots;
static UWORD *con1Slot[2][SCREEN_H], *modSlot[2][SCREEN_H];
static UBYTE slotLines[2][SCREEN_H], needLines[2][SCREEN_H + 1];
static int numSlotLines[2], numNeedLines[2];
static UWORD *pf1Ptr[2][4], *pf2Ptr[2][4], *pf2Mod[2];
static UWORD *fgModSlot[2][2];
// boxes of the objects drawn on background (see DrawFrameOnBg), per display buffer
#define MAX_BG_OBJ 4
typedef struct { LONG bx; WORD ty; UWORD words, h; BYTE valid, drawn; } BgBox;
static BgBox bgBox[2][MAX_BG_OBJ];   // bpl2mod on the line before the grass strip (jump) and on its first line
static BYTE palDirtyCount;
static ULONG tintRGB;
static int tintAmt, tintDim;

static Layout layout;
static BYTE lineBand[SCREEN_H];
static UBYTE lineRow[SCREEN_H];
static ScrollState scroll;

// ---------------------------------------------------------------- palette
ULONG MixRGB(ULONG a, ULONG b, int t) {
	int ra = (a >> 16) & 255, ga = (a >> 8) & 255, ba = a & 255;
	int rb = (b >> 16) & 255, gb = (b >> 8) & 255, bb = b & 255;
	ra += ((rb - ra) * t) >> 8; ga += ((gb - ga) * t) >> 8; ba += ((bb - ba) * t) >> 8;
	return ((ULONG)ra << 16) | ((ULONG)ga << 8) | (ULONG)ba;
}

void PalDirty(void) { palDirtyCount = 2; }

void PalSetTint(ULONG rgb, int amount, int dim) {
	if (rgb == tintRGB && amount == tintAmt && dim == tintDim) return;
	tintRGB = rgb; tintAmt = amount; tintDim = dim;
	PalDirty();
}

static ULONG Tinted(ULONG c) {
	if (tintAmt) {
		// screen blend toward the tint colour, like the original's red flash
		int r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
		int tr = (tintRGB >> 16) & 255, tg = (tintRGB >> 8) & 255, tb = tintRGB & 255;
		int sr = 255 - (((255 - r) * (255 - tr)) >> 8), sg = 255 - (((255 - g) * (255 - tg)) >> 8), sb = 255 - (((255 - b) * (255 - tb)) >> 8);
		r += ((sr - r) * tintAmt) >> 8; g += ((sg - g) * tintAmt) >> 8; b += ((sb - b) * tintAmt) >> 8;
		c = ((ULONG)r << 16) | ((ULONG)g << 8) | (ULONG)b;
	}
	if (tintDim) c = MixRGB(c, 0, tintDim);
	return c;
}

#ifdef WATCHDOG
static void Guard(void *ptr, int list, ULONG tag) {
	ULONG a = (ULONG)ptr, c0 = (ULONG)cop[list];
	if (a >= c0 && a < c0 + COP_WORDS * 2) return;
	void ExcShowGuard(ULONG a, ULONG tag, ULONG c0);
	ExcShowGuard(a, tag, c0);
}
#define GUARD(p, l, t) Guard((void *)(p), l, t)
#else
#define GUARD(p, l, t)
#endif

static void PatchColors(int list) {
	for (int i = 0; i < numColorSlots; i++) {
		ColorSlot *s = &colorSlots[i];
		ULONG c = s->pal & NO_TINT ? pal[s->pal & ~NO_TINT] : Tinted(pal[s->pal]);
		GUARD(s->hi[list], list, 0xc0000000 | i); GUARD(s->lo[list], list, 0xc1000000 | i);
		*s->hi[list] = (UWORD)(((c >> 12) & 0xf00) | ((c >> 8) & 0xf0) | ((c >> 4) & 0xf));
		*s->lo[list] = (UWORD)(((c >> 8) & 0xf00) | ((c >> 4) & 0xf0) | (c & 0xf));
	}
}

// ---------------------------------------------------------------- blitter
static void BlitClear(UBYTE *dst, int words, int h, int dmod) {
	WaitBlit();
	CUSTOM->bltcon0 = DEST;
	CUSTOM->bltcon1 = 0;
	CUSTOM->bltdpt = dst;
	CUSTOM->bltdmod = (WORD)dmod;
	CUSTOM->bltsize = (UWORD)((h << 6) | words);
	gfxBlits++;
}

static void BlitCopy(const UBYTE *src, UBYTE *dst, int words, int h, int smod, int dmod) {
	WaitBlit();
	CUSTOM->bltcon0 = SRCA | DEST | 0xf0;
	CUSTOM->bltcon1 = 0;
	CUSTOM->bltafwm = 0xffff;
	CUSTOM->bltalwm = 0xffff;
	CUSTOM->bltapt = (APTR)src;
	CUSTOM->bltdpt = dst;
	CUSTOM->bltamod = (WORD)smod;
	CUSTOM->bltdmod = (WORD)dmod;
	CUSTOM->bltsize = (UWORD)((h << 6) | words);
	gfxBlits++;
}

// D = A ? B : C, with A/B shifted right by `shift`.
// Cookie-cut: D = mask ? src : C. C is normally the destination itself; for objects drawn "on background"
// it is the clean ribbon, which restores the background inside the box in the same pass.
static void BlitCookieC(const UBYTE *mask, const UBYTE *src, const UBYTE *csrc, UBYTE *dst, int words, int h, int shift, UWORD lwm, int amod, int bmod, int dmod) {
	WaitBlit();
	CUSTOM->bltcon0 = (UWORD)((shift << 12) | SRCA | SRCB | SRCC | DEST | 0xca);
	CUSTOM->bltcon1 = (UWORD)(shift << 12);
	CUSTOM->bltafwm = 0xffff;
	CUSTOM->bltalwm = lwm;
	CUSTOM->bltapt = (APTR)mask;
	CUSTOM->bltbpt = (APTR)src;
	CUSTOM->bltcpt = (APTR)csrc;
	CUSTOM->bltdpt = dst;
	CUSTOM->bltamod = (WORD)amod;
	CUSTOM->bltbmod = (WORD)bmod;
	CUSTOM->bltcmod = (WORD)dmod;
	CUSTOM->bltdmod = (WORD)dmod;
	CUSTOM->bltsize = (UWORD)((h << 6) | words);
	gfxBlits++;
}
static inline void BlitCookie(const UBYTE *mask, const UBYTE *src, UBYTE *dst, int words, int h, int shift, UWORD lwm, int amod, int bmod, int dmod) {
	BlitCookieC(mask, src, dst, dst, words, h, shift, lwm, amod, bmod, dmod);
}

// D = A ? (solid colour bit) : C
static void BlitSolidLwmC(const UBYTE *mask, const UBYTE *csrc, UBYTE *dst, int words, int h, int shift, int set, UWORD lwm, int amod, int dmod) {
	WaitBlit();
	CUSTOM->bltcon0 = (UWORD)((shift << 12) | SRCA | SRCC | DEST | (set ? 0xfa : 0x0a));
	CUSTOM->bltcon1 = 0;
	CUSTOM->bltafwm = 0xffff;
	CUSTOM->bltalwm = lwm;
	CUSTOM->bltapt = (APTR)mask;
	CUSTOM->bltcpt = (APTR)csrc;
	CUSTOM->bltdpt = dst;
	CUSTOM->bltamod = (WORD)amod;
	CUSTOM->bltcmod = (WORD)dmod;
	CUSTOM->bltdmod = (WORD)dmod;
	CUSTOM->bltsize = (UWORD)((h << 6) | words);
	gfxBlits++;
}
static inline void BlitSolid(const UBYTE *mask, UBYTE *dst, int words, int h, int shift, int set, int amod, int dmod) {
	BlitSolidLwmC(mask, dst, dst, words, h, shift, set, 0, amod, dmod);
}

// ---------------------------------------------------------------- ribbon (PF2 trees)
static WORD slotBlock[8];        // block index held by each memory slot (-32768 = none)
static BYTE slotReady[8];
static LONG ribbonP;             // current fetch block
static struct { WORD block; BYTE active, stage, plane; WORD obj, count; } job;
#define JOB_MAX_OBJS 32
static WORD jobObjs[JOB_MAX_OBJS];   // trees overlapping the job's block, far to near

static inline LONG BlockOffset(LONG b) { return b * 8; }  // + y * PF2_RB for row y

static int FirstObjFor(LONG x0) {
	// treeObjs are sorted by x; return the first that could overlap x0
	int lo = 0, hi = NUM_TREE_OBJS;
	LONG from = x0 - TREE_MAX_W;
	while (lo < hi) { int m = (lo + hi) >> 1; if (treeObjs[m].x < from) lo = m + 1; else hi = m; }
	return lo;
}

// One blit of work on the current job. Returns 1 when the job finished.
static int JobStep(void) {
	LONG b = job.block;
	LONG x0 = b * 64, off = BlockOffset(b);
	if (job.stage == 0) {      // clear the block in the clean ribbon
		BlitClear(ribbonClean[job.plane] + off, 4, SCREEN_H, PF2_RB - 8);
		if (++job.plane == 4) {
			// collect the trees overlapping this block and order them far to near (by layer), so a nearer
			// tree is never covered by a farther one that starts further right
			job.plane = 0; job.stage = 1; job.obj = 0; job.count = 0;
			for (int i = FirstObjFor(x0); i < NUM_TREE_OBJS && treeObjs[i].x < x0 + 64; i++) {
				if (treeObjs[i].x + frames[treeObjs[i].frame].ww * 16 <= x0 || job.count == JOB_MAX_OBJS) continue;
				int j = job.count++;
				while (j > 0 && treeObjs[jobObjs[j - 1]].layer > treeObjs[i].layer) { jobObjs[j] = jobObjs[j - 1]; j--; }
				jobObjs[j] = (WORD)i;
			}
		}
		return 0;
	}
	if (job.stage == 1) {      // stamp each overlapping tree slice
		while (job.obj < job.count) {
			const TreeObj *o = &treeObjs[jobObjs[job.obj]];
			const Frame *f = &frames[o->frame];
			LONG ox1 = o->x + f->ww * 16;
			LONG s = Max(o->x, x0), e = Min(ox1, x0 + 64);
			int words = (int)((e - s) >> 4);
			int top = o->y, h = f->h, skip = 0;
			if (top < 0) { skip = -top; h -= skip; top = 0; }
			if (top + h > SCREEN_H) h = SCREEN_H - top;
			if (h > 0 && words > 0) {
				const UBYTE *img = assetChip + f->off;
				int srow = f->ww * 2;
				const UBYTE *mask = img + 8 * f->ww * f->h + skip * srow + ((s - o->x) >> 3);
				const UBYTE *src = img + skip * srow * 4 + job.plane * srow + ((s - o->x) >> 3);
				UBYTE *dst = ribbonClean[job.plane] + top * PF2_RB + (s >> 3);
				BlitCookie(mask, src, dst, words, h, 0, 0xffff, srow - words * 2, srow * 4 - words * 2, PF2_RB - words * 2);
			}
			if (++job.plane == 4) { job.plane = 0; job.obj++; }
			return 0;
		}
		job.stage = 2; job.plane = 0;
	}
	// copy the finished block into both display buffers
	int buf = job.plane >> 2, k = job.plane & 3;
	BlitCopy(ribbonClean[k] + off, ribbon[buf][k] + off, 4, SCREEN_H, PF2_RB - 8, PF2_RB - 8);
	if (++job.plane == 8) { job.active = 0; slotReady[b & 7] = 1; return 1; }
	return 0;
}

static void StartJob(LONG b) {
	job.block = (WORD)b; job.stage = 0; job.plane = 0; job.obj = 0; job.active = 1;
	slotBlock[b & 7] = (WORD)b;
	slotReady[b & 7] = 0;
}

static void RibbonUpdate(int budget) {
	LONG p = ribbonP;
	// visible blocks must be ready right now
	for (LONG b = p; b <= p + 5; b++) {
		int s = b & 7;
		if (slotBlock[s] != b || !slotReady[s]) {
			if (!(job.active && job.block == b)) StartJob(b);
			while (!JobStep()) {}
		}
	}
	// then the spare blocks on either side, a little at a time
	while (budget > 0) {
		if (!job.active) {
			LONG want = -1;
			if (slotBlock[(p + 6) & 7] != p + 6 || !slotReady[(p + 6) & 7]) want = p + 6;
			else if (p - 1 >= 0 && (slotBlock[(p - 1) & 7] != p - 1 || !slotReady[(p - 1) & 7])) want = p - 1;
			if (want < 0) break;
			StartJob(want);
		} else if (job.block < p - 1 || job.block > p + 6) {
			slotBlock[job.block & 7] = -32768; job.active = 0;
			continue;
		}
		JobStep();
		budget--;
	}
}

void GfxRibbonReset(void) {
	for (int s = 0; s < 8; s++) { slotBlock[s] = -32768; slotReady[s] = 0; }
	for (int b = 0; b < 2; b++) for (int s = 0; s < MAX_BG_OBJ; s++) bgBox[b][s].valid = 0;
	job.active = 0;
	RibbonUpdate(1000);
	while (job.active) JobStep();
	RibbonUpdate(1000);
	while (job.active) JobStep();
	WaitBlit();
}

// ---------------------------------------------------------------- dirty rectangles (bobs + pixels)
#define MAX_DIRTY 96
#define MAX_DIRTY_PX 900
typedef struct { ULONG off; UWORD words, h; } Dirty;
static Dirty dirty[2][MAX_DIRTY];
static int numDirty[2];
static ULONG dirtyPx[2][MAX_DIRTY_PX];
static int numDirtyPx[2];

static void RestoreDirty(int buf) {
	for (int i = 0; i < numDirty[buf]; i++) {
		Dirty *d = &dirty[buf][i];
		for (int k = 0; k < 4; k++) BlitCopy(ribbonClean[k] + d->off, ribbon[buf][k] + d->off, d->words, d->h, PF2_RB - d->words * 2, PF2_RB - d->words * 2);
	}
	numDirty[buf] = 0;
	WaitBlit();
	for (int i = 0; i < numDirtyPx[buf]; i++) {
		ULONG o = dirtyPx[buf][i];
		for (int k = 0; k < 4; k++) ribbon[buf][k][o] = ribbonClean[k][o];
	}
	numDirtyPx[buf] = 0;
}

// ---------------------------------------------------------------- objects drawn on background
// The Titan is far too big to restore and redraw every frame. Instead each of its strips is cookie-cut with
// the clean ribbon as the background source, so the blit restores and draws its box in one pass; of the box
// it had in this buffer two frames ago only the part the new box leaves uncovered is restored.
static void RestoreRect(int buf, LONG bx, int ty, int words, int h) {
	if (words <= 0 || h <= 0) return;
	ULONG off = (ULONG)ty * PF2_RB + (ULONG)bx;
	for (int k = 0; k < 4; k++) BlitCopy(ribbonClean[k] + off, ribbon[buf][k] + off, words, h, PF2_RB - words * 2, PF2_RB - words * 2);
}

static void RestoreUncovered(int buf, const BgBox *o, LONG n0, int ny0, int nwords, int nh) {
	LONG o0 = o->bx, o1 = o->bx + o->words * 2, n1 = n0 + nwords * 2;
	int oy0 = o->ty, oy1 = o->ty + o->h, ny1 = ny0 + nh;
	if (n0 > o0) RestoreRect(buf, o0, oy0, (int)((Min(n0, o1) - o0) >> 1), o->h);
	if (n1 < o1) { LONG s = Max(n1, o0); RestoreRect(buf, s, oy0, (int)((o1 - s) >> 1), o->h); }
	LONG c0 = Max(o0, n0), c1 = Min(o1, n1);
	if (c1 > c0) {
		if (ny0 > oy0) RestoreRect(buf, c0, oy0, (int)((c1 - c0) >> 1), Min(ny0, oy1) - oy0);
		if (ny1 < oy1) { int s = Max(ny1, oy0); RestoreRect(buf, c0, s, (int)((c1 - c0) >> 1), oy1 - s); }
	}
}

// ---------------------------------------------------------------- drawing
// pf2Scroll: the tree ribbon's scroll including its share of the camera shake (trees sit at TREE_FACTOR depth);
// actors are drawn at walking-plane depth, so they move by the whole shake
static LONG pf2Scroll;
static inline LONG RibbonX(int sx) { return pf2Scroll + 64 + sx - scroll.shake; }

void DrawFrameOnBg(int slot, int frame, int sx, int sy, int flash) {
	if (layout.pf2Text) return;
	const Frame *f = &frames[frame];
	int tx = sx - f->ax, ty = sy - f->ay, h = f->h, skip = 0;
	if (ty < 0) { skip = -ty; h -= skip; ty = 0; }
	if (ty + h > SCREEN_H) h = SCREEN_H - ty;
	if (h <= 0) return;
	LONG v = RibbonX(tx);
	// clip to the 8 ribbon blocks in memory, by whole destination words. A word cut on the left loses the
	// bits its left neighbour would have shifted in, but that edge is always 64+ px off screen; on the right
	// the last-word mask drops the bits that would carry into the next line.
	LONG dw0 = v >> 4, wlo = (ribbonP - 1) * 4, whi = (ribbonP + 7) * 4;
	int full = f->ww + 1, dl = dw0 < wlo ? (int)(wlo - dw0) : 0, dr = dw0 + full > whi ? (int)(dw0 + full - whi) : 0;
	int words = full - dl - dr, srow = f->ww * 2, shift = v & 15;
	if (words <= 0) return;   // not drawn: GfxBgObjectsDone() clears its old box
	UWORD lwm = dr ? (UWORD)(0xffff << shift) : 0;
	LONG bx = (dw0 + dl) << 1;
	BgBox *o = &bgBox[back][slot];
	if (o->valid) RestoreUncovered(back, o, bx, ty, words, h);
	ULONG off = (ULONG)ty * PF2_RB + (ULONG)bx;
	const UBYTE *img = assetChip + f->off + dl * 2;
	const UBYTE *mask = img + 8 * f->ww * f->h + skip * srow;
	int amod = srow - words * 2;
	for (int k = 0; k < 4; k++) {
		if (flash) BlitSolidLwmC(mask, ribbonClean[k] + off, ribbon[back][k] + off, words, h, shift, flash & (1 << k), lwm, amod, PF2_RB - words * 2);
		else BlitCookieC(mask, img + skip * srow * 4 + k * srow, ribbonClean[k] + off, ribbon[back][k] + off, words, h, shift, lwm, amod, srow * 4 - words * 2, PF2_RB - words * 2);
	}
	o->bx = bx; o->ty = (WORD)ty; o->words = (UWORD)words; o->h = (UWORD)h; o->valid = 1; o->drawn = 1;
}

void GfxBgObjectsDone(void) {
	for (int s = 0; s < MAX_BG_OBJ; s++) {
		BgBox *o = &bgBox[back][s];
		if (o->valid && !o->drawn) { RestoreRect(back, o->bx, o->ty, o->words, o->h); o->valid = 0; }
	}
}

void DrawFrame(int frame, int sx, int sy, int flash) {
	if (layout.pf2Text) return;
	const Frame *f = &frames[frame];
	int tx = sx - f->ax, ty = sy - f->ay, h = f->h, skip = 0;
	if (ty < 0) { skip = -ty; h -= skip; ty = 0; }
	if (ty + h > SCREEN_H) h = SCREEN_H - ty;
	if (h <= 0) return;
	LONG v = RibbonX(tx);
	LONG lo = (ribbonP - 1) * 64, hi = (ribbonP + 7) * 64;
	if (v < lo || v + f->ww * 16 + 16 > hi) return;   // off the drawable area
	if (numDirty[back] >= MAX_DIRTY) return;
	int words = f->ww + 1, srow = f->ww * 2;
	ULONG off = (ULONG)ty * PF2_RB + (ULONG)((v >> 4) << 1);
	const UBYTE *img = assetChip + f->off;
	const UBYTE *mask = img + 8 * f->ww * f->h + skip * srow;
	int shift = v & 15;
	for (int k = 0; k < 4; k++) {
		if (flash) BlitSolid(mask, ribbon[back][k] + off, words, h, shift, flash & (1 << k), -2, PF2_RB - words * 2);
		else BlitCookie(mask, img + skip * srow * 4 + k * srow, ribbon[back][k] + off, words, h, shift, 0, -2, srow * 4 - words * 2, PF2_RB - words * 2);
	}
	Dirty *d = &dirty[back][numDirty[back]++];
	d->off = off; d->words = (UWORD)words; d->h = (UWORD)h;
}

void PlotPixel(int sx, int sy, int c) {
	if ((unsigned)sx >= SCREEN_W || (unsigned)sy >= SCREEN_H || layout.pf2Text) return;
	int n = numDirtyPx[back];
	if (n >= MAX_DIRTY_PX) return;
	LONG v = RibbonX(sx);
	ULONG o = (ULONG)sy * PF2_RB + (ULONG)(v >> 3);
	UBYTE bit = (UBYTE)(0x80 >> (v & 7)), nbit = (UBYTE)~bit;
	UBYTE **pl = ribbon[back];
	if (c & 1) pl[0][o] |= bit; else pl[0][o] &= nbit;
	if (c & 2) pl[1][o] |= bit; else pl[1][o] &= nbit;
	if (c & 4) pl[2][o] |= bit; else pl[2][o] &= nbit;
	if (c & 8) pl[3][o] |= bit; else pl[3][o] &= nbit;
	dirtyPx[back][n] = o;
	numDirtyPx[back] = n + 1;
}

// A 2x2 block (big sparks): both pixels of a row share one byte unless they straddle a byte edge, so each row
// is a single read-modify-write per plane and one restore entry.
void PlotBlock2(int sx, int sy, int c) {
	if ((unsigned)sx >= SCREEN_W - 1 || (unsigned)sy >= SCREEN_H - 1 || layout.pf2Text) {
		PlotPixel(sx, sy, c); PlotPixel(sx + 1, sy, c); PlotPixel(sx, sy + 1, c); PlotPixel(sx + 1, sy + 1, c);
		return;
	}
	LONG v = RibbonX(sx);
	if ((v & 7) == 7) { PlotPixel(sx, sy, c); PlotPixel(sx + 1, sy, c); PlotPixel(sx, sy + 1, c); PlotPixel(sx + 1, sy + 1, c); return; }
	int n = numDirtyPx[back];
	if (n + 2 > MAX_DIRTY_PX) return;
	UBYTE bits = (UBYTE)(0xc0 >> (v & 7)), nbits = (UBYTE)~bits;
	UBYTE **pl = ribbon[back];
	ULONG o = (ULONG)sy * PF2_RB + (ULONG)(v >> 3);
	for (int r = 0; r < 2; r++, o += PF2_RB) {
		if (c & 1) pl[0][o] |= bits; else pl[0][o] &= nbits;
		if (c & 2) pl[1][o] |= bits; else pl[1][o] &= nbits;
		if (c & 4) pl[2][o] |= bits; else pl[2][o] &= nbits;
		if (c & 8) pl[3][o] |= bits; else pl[3][o] &= nbits;
		dirtyPx[back][n++] = o;
	}
	numDirtyPx[back] = n;
}

// A short polyline (the scarf): every point plus the midpoint of each segment.
void DrawPolyline(const WORD *xy, int n, int c) {
	for (int i = 0; i < n; i++) {
		PlotPixel(xy[i * 2], xy[i * 2 + 1], c);
		if (i + 1 < n) PlotPixel((xy[i * 2] + xy[i * 2 + 2]) >> 1, (xy[i * 2 + 1] + xy[i * 2 + 3]) >> 1, c);
	}
}

// ---------------------------------------------------------------- text
UBYTE *Pf1BandPlane(int band, int plane) {
	return assetChip + PF1_OFFSET + (ULONG)plane * PF1_PLANE_BYTES + bandDefs[band].off;
}

void TextClear(UBYTE *planes[4], int rb, int x, int y, int w, int h) {
	for (int k = 0; k < 4; k++)
		for (int r = 0; r < h; r++) {
			UBYTE *p = planes[k] + (y + r) * rb;
			for (int i = x; i < x + w; i++) p[i >> 3] &= (UBYTE)~(0x80 >> (i & 7));
		}
}

int TextWidth(const char *s) {
	int w = 0;
	for (; *s; s++) { int c = (UBYTE)*s - 32; if (c < 0 || c >= 96) c = 0; w += fontAdvance[c]; }
	return w;
}

static void Glyph(UBYTE *planes[4], int rb, int x, int y, int ch, int color) {
	const UBYTE *g = fontBits + ch * 8;
	int sh = x & 7;
	for (int r = 0; r < 8; r++) {
		UWORD bits = (UWORD)(g[r] << 8) >> sh;
		if (!bits) continue;
		int o = (y + r) * rb + (x >> 3);
		for (int k = 0; k < 4; k++) {
			UBYTE *p = planes[k] + o;
			if (color & (1 << k)) { p[0] |= (UBYTE)(bits >> 8); p[1] |= (UBYTE)bits; }
			else { p[0] &= (UBYTE)~(bits >> 8); p[1] &= (UBYTE)~bits; }
		}
	}
}

int TextDraw(UBYTE *planes[4], int rb, int x, int y, const char *s, int color, int shadow) {
	for (; *s; s++) {
		int c = (UBYTE)*s - 32;
		if (c < 0 || c >= 96) c = 0;
		if (c) {
			if (shadow >= 0) Glyph(planes, rb, x + 1, y + 1, c, shadow);
			Glyph(planes, rb, x, y, c, color);
		}
		x += fontAdvance[c];
	}
	return x;
}

void Pf2TextClear(void) {
	for (int k = 0; k < 4; k++) memset(pf2TextPlanes[k], 0, PF2TEXT_RB * SCREEN_H);
}

void Pf2TextBlit(int frame, int x, int y) {
	const Frame *f = &frames[frame];
	int words = f->ww + 1, srow = f->ww * 2;
	int v = x + 64;
	const UBYTE *img = assetChip + f->off;
	for (int k = 0; k < 4; k++)
		BlitCookie(img + 8 * f->ww * f->h, img + k * srow, pf2TextPlanes[k] + y * PF2TEXT_RB + ((v >> 4) << 1),
			words, f->h, v & 15, 0, -2, srow * 4 - words * 2, PF2TEXT_RB - words * 2);
	WaitBlit();
}

// ---------------------------------------------------------------- copper list compiler
typedef struct { UBYTE hw; UWORD pal; } ColEv;
#define MAX_EV 24
static ColEv lineCols[SCREEN_H][MAX_EV];
static UBYTE numLineCols[SCREEN_H];
static UWORD lineCon2[SCREEN_H];   // 0 = no change

static void AddCol(int y, int hw, int palIdx) {
	if (y < 0 || y >= SCREEN_H || numLineCols[y] >= MAX_EV) return;
	// replace an earlier event for the same register on this line
	for (int i = 0; i < numLineCols[y]; i++) if (lineCols[y][i].hw == hw) { lineCols[y][i].pal = (UWORD)palIdx; return; }
	lineCols[y][numLineCols[y]].hw = (UBYTE)hw;
	lineCols[y][numLineCols[y]].pal = (UWORD)palIdx;
	numLineCols[y]++;
}

// Static colours of a band, spread over its first lines (at most 5 per line so the copper keeps up).
// Stacked bands with more than 5 start one line early (their order avoids the colours the band above
// shows on that line); overlays start on their own first line, ordered by the row that first uses them.
static void AddBandStatics(int band, int y0, int early) {
	const BandDef *b = &bandDefs[band];
	for (int i = 0; i < b->numColors; i++) {
		const BandColor *c = &bandColors[b->firstColor + i];
		int y = y0 + i / 5 - (early && b->numColors > 5 ? 1 : 0);
		// the pause strip keeps its colours while the rest of the screen is dimmed
		AddCol(y < 0 ? 0 : y, c->hw, c->pal | (band == BAND_PAUSE ? NO_TINT : 0));
	}
}

static void PlaceBand(int band, int y0, int rows) {
	for (int r = 0; r < rows; r++) {
		int y = y0 + r;
		if (y < 0 || y >= SCREEN_H) continue;
		lineBand[y] = (BYTE)band;
		lineRow[y] = (UBYTE)r;
	}
}

static void BuildLayout(void) {
	for (int y = 0; y < SCREEN_H; y++) { numLineCols[y] = 0; lineCon2[y] = 0; }
	if (layout.pf1Off) {
		for (int y = 0; y < SCREEN_H; y++) { lineBand[y] = -1; lineRow[y] = 0; }
	} else {
		// the main stack
		for (int b = 0; b < NUM_STACK_BANDS; b++) {
			const BandDef *d = &bandDefs[b];
			PlaceBand(b, d->y0, d->rows);
			AddBandStatics(b, d->y0, 1);
			for (int i = 0; i < d->numGrad; i++) {
				const BandGrad *g = &bandGrads[d->firstGrad + i];
				AddCol(d->y0 + g->row, g->hw, g->pal);
			}
		}
		// overlays (drawn over the stack with PF1 in front of PF2)
		int overlays[2], n = 0;
		if (layout.paused) overlays[n++] = BAND_PAUSE;
		if (layout.boss) overlays[n++] = BAND_BOSS;
		for (int i = 0; i < n; i++) {
			int b = overlays[i];
			const BandDef *d = &bandDefs[b];
			PlaceBand(b, d->y0, d->rows);
			// the bands underneath keep changing their colours per line (ridge gradients); none of that
			// may touch the colours this overlay uses while it is on screen
			UWORD used = 0;
			for (int c = 0; c < d->numColors; c++) used |= (UWORD)(1 << bandColors[d->firstColor + c].hw);
			for (int y = d->y0; y < Min(d->y0 + d->rows, SCREEN_H); y++) {
				int k = 0;
				for (int e = 0; e < numLineCols[y]; e++) if (!(used & (1 << lineCols[y][e].hw))) lineCols[y][k++] = lineCols[y][e];
				numLineCols[y] = (UBYTE)k;
			}
			AddBandStatics(b, d->y0, 0);
			lineCon2[d->y0] = 0x0024 | 0x8000;              // PF1 in front
			int end = d->y0 + d->rows;
			if (end < SCREEN_H) {
				lineCon2[end] = 0x0064 | 0x8000;              // back to PF2 in front
				int under = lineBand[end];
				if (under >= 0 && under < NUM_STACK_BANDS) AddBandStatics(under, end, 0);
				// ...and the per-line colours of the band underneath resume on the next lines
				const BandDef *u = under >= 0 ? &bandDefs[under] : 0;
				if (u) for (int g = 0; g < u->numGrad; g++) {
					const BandGrad *gr = &bandGrads[u->firstGrad + g];
					int gy = u->y0 + gr->row;
					if (gy >= end && gy < end + 2 && (used & (1 << gr->hw))) AddCol(gy, gr->hw, gr->pal);
				}
			}
		}
		lineCon2[0] = 0x0024 | 0x8000;                      // HUD rows: PF1 in front
		lineCon2[bandDefs[BAND_HUD].rows] = 0x0064 | 0x8000;
	}
	// colour 0 (sky) gradient: one entry per line
	for (int y = 0; y < SCREEN_H; y++) {
		int pi = layout.pf1Off ? PAL_INTRO_C0 + y : c0Pal[y];
		if (y == 0 || pi != (layout.pf1Off ? PAL_INTRO_C0 + y - 1 : c0Pal[y - 1])) AddCol(y, 0, pi);
	}
	// PF2 palette: static, plus per-line text gradients on the title screens
	for (int i = 1; i < 16; i++) AddCol(0, 16 + i, layout.pf2Text ? PAL_TEXT + i : PAL_PF2 + i);
	if (layout.pf2Text)
		for (int y = 1; y < SCREEN_H; y++) {
			if (pal[PAL_TEXTGRAD + y] != pal[PAL_TEXTGRAD + y - 1]) AddCol(y, 17, PAL_TEXTGRAD + y);
			if (pal[PAL_TEXTGRAD2 + y] != pal[PAL_TEXTGRAD2 + y - 1]) AddCol(y, 18, PAL_TEXTGRAD2 + y);
		}
	if (layout.pf2Text) { AddCol(0, 17, PAL_TEXTGRAD); AddCol(0, 18, PAL_TEXTGRAD2); }
}

static UWORD *EmitColors(UWORD *p, int list, ColEv *ev, int n) {
	if (!n) return p;
	if (numColorSlots + n > MAX_COLOR_SLOTS) n = MAX_COLOR_SLOTS - numColorSlots;
	if (n <= 0) return p;
	COP_MOVE(p, bplcon3, BPLCON3_BASE);
	for (int i = 0; i < n; i++) {
		if (list == 0) { colorSlots[numColorSlots].pal = ev[i].pal; }
		colorSlots[numColorSlots + i].hi[list] = p + 1;
		COP_MOVEO(p, 0x180 + ev[i].hw * 2, 0);
	}
	COP_MOVE(p, bplcon3, BPLCON3_BASE | BPLCON3_LOCT);
	for (int i = 0; i < n; i++) {
		colorSlots[numColorSlots + i].lo[list] = p + 1;
		colorSlots[numColorSlots + i].pal = ev[i].pal;
		COP_MOVEO(p, 0x180 + ev[i].hw * 2, 0);
	}
	COP_MOVE(p, bplcon3, BPLCON3_BASE);
	numColorSlots += n;
	return p;
}

static void CompileList(int list) {
	UWORD *p = cop[list];
	COP_MOVE(p, fmode, 0x0003);
	COP_MOVE(p, bplcon0, 0x0611);
	COP_MOVE(p, bplcon2, 0x0024);
	COP_MOVE(p, bplcon3, BPLCON3_BASE);
	COP_MOVE(p, bplcon4, 0x0000);
	COP_MOVE(p, diwstrt, 0x2c81);
	COP_MOVE(p, diwstop, 0x2cc1);
	COP_MOVE(p, ddfstrt, 0x0018);
	COP_MOVE(p, ddfstop, 0x00b8);
	pf2Mod[list] = p + 1; COP_MOVE(p, bpl2mod, 0);
	modSlot[list][0] = p + 1; COP_MOVE(p, bpl1mod, 0);
	con1Slot[list][0] = p + 1; COP_MOVE(p, bplcon1, 0);
	for (int k = 0; k < 4; k++) {
		pf1Ptr[list][k] = p + 1;
		COP_MOVEO(p, 0xe0 + k * 8, 0); COP_MOVEO(p, 0xe2 + k * 8, 0);
		pf2Ptr[list][k] = p + 1;
		COP_MOVEO(p, 0xe4 + k * 8, 0); COP_MOVEO(p, 0xe6 + k * 8, 0);
	}
	p = EmitColors(p, list, lineCols[0], numLineCols[0]);

	int wrapped = 0;
	fgModSlot[list][0] = fgModSlot[list][1] = 0;
	for (int y = 1; y < SCREEN_H; y++) {
		int band = lineBand[y], prev = lineBand[y - 1], next = y + 1 < SCREEN_H ? lineBand[y + 1] : -2;
		int ground = band == BAND_GROUND;
		int needMod = ground || band != prev || band != next;
		int needCon1 = ground || band != prev;
		con1Slot[list][y] = modSlot[list][y] = 0;
		if (!needMod && !needCon1 && !lineCon2[y] && !numLineCols[y]) continue;
		if (p - cop[list] > COP_WORDS - 200) break;   // never overrun the list
		int v = DISP_VSTART + y - 1;
		if (v >= 255 && !wrapped) { COP_WAIT(p, 255, 0xdf); wrapped = 1; }
		else COP_WAIT(p, v & 0xff, 0xdf);
		if (needMod) { modSlot[list][y] = p + 1; COP_MOVE(p, bpl1mod, 0); }
		if (!layout.pf2Text && (y == FG_Y - 1 || y == FG_Y)) { fgModSlot[list][y - (FG_Y - 1)] = p + 1; COP_MOVE(p, bpl2mod, 0); }
		if (needCon1) { con1Slot[list][y] = p + 1; COP_MOVE(p, bplcon1, 0); }
		if (lineCon2[y]) COP_MOVE(p, bplcon2, lineCon2[y] & 0x7fff);
		p = EmitColors(p, list, lineCols[y], numLineCols[y]);
	}
	COP_END(p);
	// lines whose scroll data the per-frame patch needs (a slot on y needs start[y] and start[y + 1])
	numSlotLines[list] = numNeedLines[list] = 0;
	static UBYTE need[SCREEN_H + 1];
	for (int y = 0; y <= SCREEN_H; y++) need[y] = 0;
	need[0] = 1;
	for (int y = 0; y < SCREEN_H; y++)
		if (modSlot[list][y] || con1Slot[list][y]) { slotLines[list][numSlotLines[list]++] = (UBYTE)y; need[y] = 1; if (y + 1 < SCREEN_H) need[y + 1] = 1; }
	for (int y = 0; y < SCREEN_H; y++) if (need[y]) needLines[list][numNeedLines[list]++] = (UBYTE)y;
}

// Never rewrite the copper list that is on screen: the copper would run half-written instructions.
// The hidden list is compiled now, the other one right after the next swap (GfxWaitSwap).
static BYTE pendingCompile = -1;
static BYTE started;

static void Compile(int list) {
	numColorSlots = 0;
	CompileList(list);
	PatchColors(list);
}

void GfxSetLayout(const Layout *l) {
	layout = *l;
	BuildLayout();
	WaitBlit();
	if (!started) { Compile(0); Compile(1); pendingCompile = -1; }
	else { Compile(back); pendingCompile = (BYTE)(back ^ 1); }
	palDirtyCount = started ? 1 : 0;
}

// ---------------------------------------------------------------- per-frame patching
static LONG BandScroll(int band, LONG camPx, int row) {
	const BandDef *b = &bandDefs[band];
	LONG f = band == BAND_GROUND ? groundFactor[row] : b->factor;
	LONG s = (LONG)(((long long)camPx * f) >> 16);
	if (band == BAND_SKY) s += scroll.skyDrift;
	if (b->period) { s %= b->period; if (s < 0) s += b->period; }
	else s = Clamp(s, 0, b->maxScroll);
	return s;
}

static void PatchScroll(int list) {
	static LONG start[SCREEN_H + 1];
	static UBYTE fine[SCREEN_H];
	static LONG bandStart0[NUM_BANDS];
	static UBYTE bandFine[NUM_BANDS];
	static LONG gStart[128];
	static UBYTE gFine[128];
	LONG cam = scroll.camPx + scroll.shake;
	if (cam < 0) cam = 0;
	// one scroll value per band
	for (int b = 0; b < NUM_BANDS; b++) {
		if (b == BAND_GROUND) continue;
		const BandDef *d = &bandDefs[b];
		LONG s = (d->factor || d->period) ? BandScroll(b, cam, 0) : 0;
		bandStart0[b] = d->off + (((s + 127) >> 6) - 1) * 8;
		bandFine[b] = (UBYTE)((-s) & 63);
	}
	// the floor: each row moves a little faster than the one above; computed incrementally
	{
		const BandDef *g = &bandDefs[BAND_GROUND];
		ULONG acc = (ULONG)cam * (ULONG)groundFactor[0];
		ULONG step = (ULONG)cam * (ULONG)(groundFactor[1] - groundFactor[0]);
		LONG prev = (LONG)(acc >> 16);
		LONG sm = prev % g->period;
		LONG off = g->off;
		for (int r = 0; r < g->rows; r++) {
			LONG s = (LONG)(acc >> 16);
			sm += s - prev;
			while (sm >= g->period) sm -= g->period;
			prev = s;
			gStart[r] = off + (((sm + 127) >> 6) - 1) * 8;
			gFine[r] = (UBYTE)((-sm) & 63);
			off += g->rb;
			acc += step;
		}
	}
	for (int i = 0; i < numNeedLines[list]; i++) {
		int y = needLines[list][i];
		int band = lineBand[y];
		if (band < 0) { start[y] = -1; fine[y] = 0; }
		else if (band == BAND_GROUND) { start[y] = gStart[lineRow[y]]; fine[y] = gFine[lineRow[y]]; }
		else { start[y] = bandStart0[band] + (LONG)lineRow[y] * bandDefs[band].rb; fine[y] = bandFine[band]; }
	}
	// PF2
	LONG s2 = pf2Scroll;
	UWORD fine2 = (UWORD)((-s2) & 63);
	if (layout.pf2Text) fine2 = 0;

	ULONG pf1Base = (ULONG)(assetChip + PF1_OFFSET);
	GUARD(pf2Mod[list], list, 0xf0000000);
	for (int k = 0; k < 4; k++) {
		GUARD(pf1Ptr[list][k], list, 0xf1000000 | k); GUARD(pf2Ptr[list][k], list, 0xf2000000 | k);
		ULONG a = start[0] < 0 ? (ULONG)zeroLine : pf1Base + (ULONG)k * PF1_PLANE_BYTES + (ULONG)start[0];
		pf1Ptr[list][k][0] = (UWORD)(a >> 16);
		pf1Ptr[list][k][2] = (UWORD)a;
		ULONG a2 = layout.pf2Text ? (ULONG)pf2TextPlanes[k] : (ULONG)ribbon[list][k] + (ULONG)ribbonP * 8;
		pf2Ptr[list][k][0] = (UWORD)(a2 >> 16);
		pf2Ptr[list][k][2] = (UWORD)a2;
	}
	*pf2Mod[list] = layout.pf2Text ? (UWORD)(PF2TEXT_RB - FETCH_BYTES) : (UWORD)(PF2_RB - FETCH_BYTES);
	// foreground grass: after line FG_Y - 1 the PF2 pointers jump from the ribbon to the strip
	UWORD fineFg = fine2;
	if (fgModSlot[list][0] && fgModSlot[list][1]) {
		LONG sf = (LONG)(((long long)cam * FG_FACTOR_16) >> 16) % FG_PERIOD;
		LONG fgStart = PF2_FG_OFF + (((sf + 127) >> 6) - 1) * 8;
		LONG rowEnd = ribbonP * 8 + (FG_Y - 1) * PF2_RB + FETCH_BYTES;
		fineFg = (UWORD)((-sf) & 63);
		*fgModSlot[list][0] = (UWORD)(fgStart - rowEnd);
		*fgModSlot[list][1] = (UWORD)(FG_RB - FETCH_BYTES);
	}
	UWORD **ms = modSlot[list], **cs = con1Slot[list];
	for (int i = 0; i < numSlotLines[list]; i++) {
		int y = slotLines[list][i];
		if (ms[y]) {
			LONG m;
			if (start[y] < 0) m = -FETCH_BYTES;
			else if (y + 1 < SCREEN_H && start[y + 1] >= 0) m = start[y + 1] - start[y] - FETCH_BYTES;
			else m = bandDefs[lineBand[y]].rb - FETCH_BYTES;
			GUARD(ms[y], list, 0xd0000000 | y);
			*ms[y] = (UWORD)m;
		}
		if (cs[y]) { GUARD(cs[y], list, 0xe0000000 | y); *cs[y] = Bplcon1Bits(fine[y], y >= FG_Y ? fineFg : fine2); }
	}
}

void GfxSetScroll(const ScrollState *s) {
	scroll = *s;
	LONG s2 = scroll.pf2Px + ((scroll.shake * TREE_FACTOR_16) >> 16);
	if (s2 < 0) s2 = 0;
	pf2Scroll = s2;
	ribbonP = ((s2 + 127) >> 6) - 1;
}

void GfxBeginFrame(void) {
	gfxBlits = 0;
	RestoreDirty(back);
	for (int s = 0; s < MAX_BG_OBJ; s++) bgBox[back][s].drawn = 0;
	if (!layout.pf2Text) RibbonUpdate(3);
}


void GfxEndFrame(void) {
	WaitBlit();
	PatchScroll(back);
	if (palDirtyCount) { PatchColors(back); palDirtyCount--; }
	nextCopper = (ULONG)cop[back];   // the vblank interrupt switches to it (sys.c Level3Body)
	back ^= 1;
}

void GfxWaitSwap(void) {
	while (nextCopper) {}
	if (pendingCompile == back) { Compile(back); PatchScroll(back); pendingCompile = -1; }
	// after the switch, the other list may still lag one colour patch behind
	if (palDirtyCount) { PatchColors(back); palDirtyCount--; }
}

// ---------------------------------------------------------------- init
void GfxInit(void) {
	for (int i = 0; i < 2; i++) cop[i] = ChipAlloc(COP_WORDS * 2);
	for (int k = 0; k < 4; k++) {
		ribbonClean[k] = ChipAlloc(PF2_PLANE);
		for (int b = 0; b < 2; b++) {
			ribbon[b][k] = ChipAlloc(PF2_PLANE + FG_PLANE_BYTES);
			if (ribbon[b][k]) memcpy(ribbon[b][k] + PF2_FG_OFF, assetChip + FG_OFFSET + k * FG_PLANE_BYTES, FG_PLANE_BYTES);
		}
		pf2TextPlanes[k] = ChipAlloc(PF2TEXT_RB * SCREEN_H);
	}
	zeroLine = ChipAlloc(64);
	for (int i = 0; i < PAL_N; i++) pal[i] = palInit[i];
	for (int s = 0; s < 8; s++) slotBlock[s] = -32768;
}

void GfxStart(void) {
	started = 1;
	PatchScroll(0); PatchScroll(1);   // valid bitplane pointers in both lists before the first frame shows
	CUSTOM->copcon = 0;   // no copper access to the blitter
	CUSTOM->cop1lc = (ULONG)cop[back ^ 1];
	CUSTOM->copjmp1 = 0;
	CUSTOM->dmacon = DMAF_SETCLR | DMAF_MASTER | DMAF_RASTER | DMAF_COPPER | DMAF_BLITTER;
}

BOOL GfxReady(void) { return cop[1] && ribbonClean[3] && ribbon[1][3] && pf2TextPlanes[3] && zeroLine; }

#ifdef WATCHDOG
// debug: first colour slot pointing outside its copper list, or -1
LONG DbgBadSlot(ULONG *what) {
	for (int i = 0; i < numColorSlots; i++)
		for (int l = 0; l < 2; l++) {
			ULONG a = (ULONG)colorSlots[i].hi[l], b = (ULONG)colorSlots[i].lo[l], c0 = (ULONG)cop[l], c1 = c0 + COP_WORDS * 2;
			if (a < c0 || a >= c1 || b < c0 || b >= c1) { what[0] = a; what[1] = c0; return i | (l << 16); }
		}
	for (int l = 0; l < 2; l++) {
		ULONG c0 = (ULONG)cop[l], c1 = c0 + COP_WORDS * 2;
		for (int y = 0; y < SCREEN_H; y++) {
			ULONG a = (ULONG)modSlot[l][y], b = (ULONG)con1Slot[l][y];
			if (a && (a < c0 || a >= c1)) { what[0] = a; what[1] = c0; return 0x100000 | y | (l << 16); }
			if (b && (b < c0 || b >= c1)) { what[0] = b; what[1] = c0; return 0x200000 | y | (l << 16); }
		}
		for (int k = 0; k < 4; k++) {
			ULONG a = (ULONG)pf1Ptr[l][k], b = (ULONG)pf2Ptr[l][k];
			if (a < c0 || a >= c1 || b < c0 || b >= c1) { what[0] = a; what[1] = b; return 0x300000 | k | (l << 16); }
		}
	}
	what[0] = (ULONG)cop[0]; what[1] = (ULONG)cop[1];
	return -1;
}
#endif
