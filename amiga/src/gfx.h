// Display engine: AGA dual playfield with copper-split parallax bands (PF1), a scrolling tree ribbon with
// blitter objects (PF2), 24-bit palette management and simple particle plotting.
#pragma once
#include "hw.h"
#include "assets.h"

// ---- palette ----
extern ULONG pal[PAL_N];          // working 24-bit colours, referenced by the copper lists
void PalDirty(void);              // repatch all colour slots next frame
void PalSetTint(ULONG rgb, int amount, int dim);   // amount 0..256 blend toward rgb, dim 0..256 darken
ULONG MixRGB(ULONG a, ULONG b, int t);             // t 0..256

// ---- layout (which bands occupy which screen rows) ----
enum { LAYOUT_PLAY, LAYOUT_TITLE, LAYOUT_INTRO };
typedef struct {
	BYTE boss;        // boss panel band visible
	BYTE paused;      // pause band visible
	BYTE pf2Text;     // PF2 shows the text screen instead of the tree ribbon
	BYTE pf1Off;      // intro: no PF1 at all
} Layout;
void GfxSetLayout(const Layout *l);   // rebuilds both copper lists

// ---- per-frame scroll state ----
typedef struct {
	LONG camPx;       // camera x in walking-plane pixels (left edge of screen)
	LONG skyDrift;    // extra sky band drift in pixels
	LONG pf2Px;       // tree ribbon scroll (pixels, >= 0)
	WORD shake;       // horizontal camera shake in walking-plane pixels (each layer moves by its parallax share)
} ScrollState;

void GfxInit(void);
void GfxStart(void);
void GfxSetScroll(const ScrollState *s);
void GfxBeginFrame(void);         // restore dirty areas in the back buffer, advance ribbon jobs
void GfxEndFrame(void);           // patch the back copper list and queue it for the next vblank
void GfxWaitSwap(void);           // wait until the queued frame is on screen
void GfxRibbonReset(void);        // re-render the whole visible ribbon (after jumps)

// ---- drawing into the back PF2 buffer (screen coordinates) ----
void PlotBlock2(int sx, int sy, int c);   // 2x2 block of pixels (restored like PlotPixel's)
void DrawFrame(int frame, int sx, int sy, int flash);   // sx,sy = anchor position; flash: 0 normal, else solid colour index
// Big objects (the Titan's strips): drawn over the clean background in one pass, no restore next frame.
// slot 0..3 identifies the object; call GfxBgObjectsDone() once all of them are drawn for the frame.
void DrawFrameOnBg(int slot, int frame, int sx, int sy, int flash);
void GfxBgObjectsDone(void);
void PlotPixel(int sx, int sy, int c);
void DrawPolyline(const WORD *xy, int n, int c);

// ---- text ----
void TextClear(UBYTE *planes[4], int rb, int x, int y, int w, int h);
int TextDraw(UBYTE *planes[4], int rb, int x, int y, const char *s, int color, int shadow);  // returns end x
int TextWidth(const char *s);
UBYTE *Pf1BandPlane(int band, int plane);   // writable PF1 band memory (HUD, boss, pause)
extern UBYTE *pf2TextPlanes[4];             // 320x256 text screen (rb 48... see gfx.c)
#define PF2TEXT_RB 48
void Pf2TextClear(void);
void Pf2TextBlit(int frame, int x, int y);  // copy a text image into the text screen

// stats for the debug overlay
extern UWORD gfxBlits;
