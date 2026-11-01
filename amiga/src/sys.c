// System takeover and restore, vertical blank and keyboard interrupts, input.
#include "sys.h"
#include <exec/execbase.h>
#include <exec/memory.h>
#include <graphics/gfxbase.h>
#include <proto/exec.h>
#include <proto/graphics.h>
#include <proto/dos.h>
#include <dos/dosextens.h>

struct ExecBase *SysBase;
struct GfxBase *GfxBase;
struct DosLibrary *DOSBase;

volatile ULONG vblankCount;
void (*volatile vblankHook)(void);
volatile ULONG nextCopper;
volatile UBYTE keyDown[128];

static volatile UBYTE keyQueue[16];
static volatile UBYTE keyHead, keyTail;

static UWORD oldIntena, oldDmacon, oldAdkcon;
static APTR oldLevel2, oldLevel3;
static struct View *oldView;
static volatile APTR *vbr;
static BOOL tookOver;
static struct Message *wbMsg;       // Workbench start-up message, replied on exit
static BOOL gayle;                  // A600/A1200 Gayle: its IDE/PCMCIA interrupts share level 2 with the keyboard
static UBYTE oldGayleIntena;
#define GAYLE_INTENA ((volatile UBYTE *)0xdaa000)

#define MAX_ALLOCS 24
static struct { void *p; ULONG size; } allocs[MAX_ALLOCS];
static int numAllocs;

#ifdef SHOWMEM
ULONG FreeChipKB(void) { return AvailMem(MEMF_CHIP) >> 10; }
#endif
void *ChipAlloc(ULONG bytes) {
	bytes = (bytes + 15) & ~15UL;
	if (numAllocs >= MAX_ALLOCS) return 0;
	// over-allocate so the block can be aligned to 64 bits for AGA 4x fetch
	UBYTE *p = AllocMem(bytes + 8, MEMF_CHIP | MEMF_CLEAR);
	if (!p) return 0;
	allocs[numAllocs].p = p;
	allocs[numAllocs].size = bytes + 8;
	numAllocs++;
	return (void *)(((ULONG)p + 7) & ~7UL);
}

void Level3Body(void) {
	UWORD r = CUSTOM->intreqr;
	if (r & INTF_VERTB) {
		// show the copper list the main loop finished (line 0, long before the display starts at $2c)
		ULONG c = nextCopper;
		if (c) { CUSTOM->cop1lc = c; CUSTOM->copjmp1 = 0; nextCopper = 0; }
		vblankCount++;
#ifdef WATCHDOG
		{
			// debug builds: if the main loop stops reporting in, freeze with its last stage as the colour
			extern volatile UWORD dbgStage, dbgWatch;
			if (++dbgWatch > 150) { CUSTOM->dmacon = 0x7fff; CUSTOM->bplcon3 = 0; CUSTOM->bplcon0 = 0x0200; for (;;) CUSTOM->color[0] = dbgStage; }
		}
#endif
		void (*hook)(void) = vblankHook;
		if (hook) hook();
	}
	CUSTOM->intreq = r & (INTF_VERTB | INTF_COPER | INTF_BLIT);
	CUSTOM->intreq = r & (INTF_VERTB | INTF_COPER | INTF_BLIT);
}

void Level2Body(void) {
	UWORD r = CUSTOM->intreqr;
	if (r & INTF_PORTS) {
		UBYTE icr = CIAA->ciaicr;  // reading acknowledges every CIA-A source
		if (icr & CIAICRF_SP) {
			UBYTE c = CIAA->ciasdr;
			CIAA->ciacra |= CIACRAF_SPMODE;  // start the keyboard handshake
			c = (UBYTE)~c;
			c = (UBYTE)((c >> 1) | (c << 7));
			UBYTE code = c & 0x7f;
			if (c & 0x80) keyDown[code] = 0;
			else {
				if (!keyDown[code]) {
					UBYTE next = (keyHead + 1) & 15;
					if (next != keyTail) { keyQueue[keyHead] = code; keyHead = next; }
				}
				keyDown[code] = 1;
			}
			// hold the handshake for at least 85 microseconds (two raster lines and a bit)
			UWORD start = CUSTOM->vhposr & 0xff00;
			int lines = 0;
			while (lines < 3) {
				UWORD now = CUSTOM->vhposr & 0xff00;
				if (now != start) { start = now; lines++; }
			}
			CIAA->ciacra &= (UBYTE)~CIACRAF_SPMODE;
		}
		CUSTOM->intreq = INTF_PORTS;
		CUSTOM->intreq = INTF_PORTS;
	}
}


#ifdef AUTOKEYS
// test builds: feed a key event through the same path as the keyboard interrupt
void InjectKey(int code, int down) {
	if (!down) { keyDown[code] = 0; return; }
	if (!keyDown[code]) {
		UBYTE next = (keyHead + 1) & 15;
		if (next != keyTail) { keyQueue[keyHead] = (UBYTE)code; keyHead = next; }
	}
	keyDown[code] = 1;
}
#endif

int KeyPop(void) {
	if (keyHead == keyTail) return -1;
	int k = keyQueue[keyTail];
	keyTail = (keyTail + 1) & 15;
	return k;
}

Joy ReadJoystick(void) {
	Joy j;
	UWORD d = CUSTOM->joy1dat;
	j.right = (d >> 1) & 1;
	j.left = (d >> 9) & 1;
	j.down = ((d >> 1) ^ d) & 1;
	j.up = ((d >> 9) ^ (d >> 8)) & 1;
	j.fire = !(CIAA->ciapra & CIAF_GAMEPORT1);
	j.fire2 = !(CUSTOM->potinp & (1 << 14));
	return j;
}

BOOL MouseButton(void) {
	return !(CIAA->ciapra & CIAF_GAMEPORT0);
}

ULONG ReadVbr(void);  // start.s, runs in supervisor mode

static APTR GetVbr(void) {
	if (!(SysBase->AttnFlags & AFF_68010)) return 0;
	return (APTR)Supervisor((ULONG (*)())ReadVbr);
}

const char *SysInit(void) {
	SysBase = *((struct ExecBase **)4UL);
	DOSBase = (struct DosLibrary *)OpenLibrary((CONST_STRPTR) "dos.library", 0);
	GfxBase = (struct GfxBase *)OpenLibrary((CONST_STRPTR) "graphics.library", 0);
	{
		// started from a Workbench icon: take the start-up message (replied in SysShutdown)
		struct Process *me = (struct Process *)FindTask(0);
		if (!me->pr_CLI) { WaitPort(&me->pr_MsgPort); wbMsg = GetMsg(&me->pr_MsgPort); }
	}
	if (!GfxBase) return "Duskwalker: could not open graphics.library\n";
	if (!(SysBase->AttnFlags & AFF_68020)) return "Duskwalker needs a 68020 or better (Amiga 1200).\n";
	// AGA Lisa answers 0xf8 in DENISEID (AROS' graphics.library does not report the AA flag)
	BOOL lisa = (*(volatile UWORD *)0xdff07c & 0xff) == 0xf8;
	if (!lisa && !(GfxBase->ChipRevBits0 & GFXF_AA_ALICE)) return "Duskwalker needs the AGA chipset (Amiga 1200 / 4000 / CD32).\n";
	// everything runs from chip RAM on a stock A1200: the 68020 instruction cache matters a lot
	if (SysBase->LibNode.lib_Version >= 37) CacheControl(CACRF_EnableI | CACRF_IBE, CACRF_EnableI | CACRF_IBE);
	return 0;
}

void SysTakeOver(void) {
	oldView = GfxBase->ActiView;
	LoadView(0);
	WaitTOF();
	WaitTOF();
	OwnBlitter();
	WaitBlit();
	gayle = OpenResource((CONST_STRPTR) "card.resource") != 0;   // only the A600/A1200 have it
	Forbid();
	Disable();

	oldIntena = CUSTOM->intenar;
	oldDmacon = CUSTOM->dmaconr;
	oldAdkcon = CUSTOM->adkconr;

	CUSTOM->intena = 0x7fff;
	CUSTOM->intreq = 0x7fff;
	CUSTOM->intreq = 0x7fff;
	while (!(CUSTOM->intreqr & INTF_VERTB)) {}   // vertical blank (any beam: works on NTSC too)
	CUSTOM->dmacon = 0x7fff;
	CUSTOM->adkcon = 0x7fff;
	for (int i = 0; i < 8; i++) CUSTOM->spr[i].ctl = 0;   // no sprite left armed
	CUSTOM->beamcon0 = 0x0020;   // PAL: the game is laid out for 256 lines at 50 Hz
	if (gayle) { oldGayleIntena = *GAYLE_INTENA; *GAYLE_INTENA = 0; }
	{
		// the floppy the game loaded from would spin for the whole game (the OS motor timer cannot run):
		// motor-off is latched by each drive when it is selected with the MTR line high
		volatile UBYTE *prb = &CIAB->ciaprb;
		*prb = 0xff;
		for (int d = 0; d < 4; d++) { *prb = (UBYTE)~(0x08 << d); *prb = 0xff; }
	}

	vbr = (volatile APTR *)GetVbr();
	{
		// the instruction cache matters a lot when everything runs from chip RAM (stock A1200)
		ULONG EnableICache(void);
		Supervisor((ULONG (*)())EnableICache);
	}
	oldLevel2 = vbr[0x68 / 4];
	oldLevel3 = vbr[0x6c / 4];
	extern void Level2Stub(void), Level3Stub(void);
	vbr[0x68 / 4] = (APTR)Level2Stub;
	vbr[0x6c / 4] = (APTR)Level3Stub;
#ifdef WATCHDOG
	{
		extern void ExcGeneric(void);
		for (int i = 2; i < 64; i++) if (i != 26 && i != 27) vbr[i] = (APTR)ExcGeneric;
		extern void ExcBus(void), ExcAddr(void), ExcIllegal(void), ExcZeroDiv(void), ExcLineA(void), ExcLineF(void), ExcPriv(void), ExcTrap(void), ExcChk(void);
		vbr[2] = (APTR)ExcBus; vbr[3] = (APTR)ExcAddr; vbr[4] = (APTR)ExcIllegal; vbr[5] = (APTR)ExcZeroDiv;
		vbr[6] = (APTR)ExcChk; vbr[8] = (APTR)ExcPriv; vbr[10] = (APTR)ExcLineA; vbr[11] = (APTR)ExcLineF;
		for (int i = 32; i < 48; i++) vbr[i] = (APTR)ExcTrap;
	}
#endif

	CUSTOM->dmacon = DMAF_SETCLR | DMAF_MASTER | DMAF_BLITTER;   // the blitter is needed before the display starts
	CUSTOM->potgo = 0xff00;  // second fire buttons readable
	tookOver = TRUE;
	CUSTOM->intena = INTF_SETCLR | INTF_INTEN | INTF_VERTB | INTF_PORTS;
}

void SysRestore(void) {
	if (!tookOver) return;
	tookOver = FALSE;
	WaitBlit();
	CUSTOM->intena = 0x7fff;
	CUSTOM->intreq = 0x7fff;
	while (!(CUSTOM->intreqr & INTF_VERTB)) {}
	CUSTOM->dmacon = 0x7fff;
	nextCopper = 0;
	for (int i = 0; i < 4; i++) CUSTOM->aud[i].ac_vol = 0;
	if (gayle) *GAYLE_INTENA = oldGayleIntena;
	if (!(GfxBase->DisplayFlags & PAL)) CUSTOM->beamcon0 = 0;   // NTSC machine: back to its own beam
	CUSTOM->fmode = 0;
	vbr[0x68 / 4] = oldLevel2;
	vbr[0x6c / 4] = oldLevel3;

	CUSTOM->cop1lc = (ULONG)GfxBase->copinit;
	CUSTOM->copjmp1 = 0;
	CUSTOM->adkcon = 0x8000 | oldAdkcon;
	CUSTOM->dmacon = 0x8000 | oldDmacon;
	CUSTOM->intena = 0x8000 | oldIntena;

	Enable();
	Permit();
	WaitBlit();
	DisownBlitter();
	LoadView(oldView);
	WaitTOF();
	WaitTOF();
}

void SysShutdown(const char *message) {
	SysRestore();
	for (int i = numAllocs - 1; i >= 0; i--) FreeMem(allocs[i].p, allocs[i].size);
	numAllocs = 0;
	if (message && DOSBase) {
		BPTR out = Output();
		if (out) {
			LONG n = 0;
			while (message[n]) n++;
			Write(out, (APTR)message, n);
		}
	}
	if (GfxBase) CloseLibrary((struct Library *)GfxBase);
	if (DOSBase) CloseLibrary((struct Library *)DOSBase);
	if (wbMsg) { Forbid(); ReplyMsg(wbMsg); wbMsg = 0; }   // Workbench unloads us once this task ends
}

#ifdef WATCHDOG
// Debug builds: CPU exceptions end here and are shown as grey bands, one hex digit per band (6 lines each,
// from line 36): a5a5a5a5 marker, PC, fault code/address, top of user stack, a2, a3.
// tools/amiga/dev/hexbands.ps1 decodes a WinUAE screenshot of it.
extern ULONG excPC, excFault, excSP, excRegs[15];
void ExcShow(void) {
	CUSTOM->dmacon = 0x7fff;
	CUSTOM->bplcon3 = 0;
	CUSTOM->bplcon0 = 0x0200;
	ULONG *u = (ULONG *)excSP;
	ULONG v[6] = {0xa5a5a5a5, excPC, excFault, u[0], excRegs[10], excRegs[11]};
	for (;;) {
		while (BeamLine() != 30) {}
		for (int i = 0; i < 48; i++) {
			int nib = (v[i / 8] >> (28 - 4 * (i % 8))) & 15;
			CUSTOM->color[0] = (UWORD)(nib * 0x111);
			ULONG target = 36 + i * 5 + 5;
			while (BeamLine() < target) {}
		}
		CUSTOM->color[0] = (UWORD)(excFault & 0xfff);
		while (BeamLine() < 280) {}
	}
}

// Called by the copper patch guards in gfx.c when a pointer leaves its copper list.
void ExcShowGuard(ULONG a, ULONG tag, ULONG c0) {
	static ULONG fake[2];
	excPC = 0x600d600d; excFault = tag; excRegs[10] = a; excRegs[11] = c0;
	excSP = (ULONG)fake;
	CUSTOM->intena = 0x7fff;
	ExcShow();
}
#endif
