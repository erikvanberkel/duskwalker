// System takeover, interrupts, memory and input.
#pragma once
#include "hw.h"

extern volatile ULONG vblankCount;
extern void (*volatile vblankHook)(void);
extern volatile ULONG nextCopper;   // copper list to show from the next vertical blank (0 = none pending)

// Returns 0 on success, otherwise an error message for the CLI.
const char *SysInit(void);
void SysTakeOver(void);
void SysRestore(void);
void SysShutdown(const char *message);

void *ChipAlloc(ULONG bytes);   // cleared chip RAM, freed by SysShutdown

// Calls fn(arg) with every register preserved (ROM routines may trash more than the ABI allows).
ULONG SafeCall(void *fn, ULONG arg);
#define SAFE0(f) SafeCall((void *)(f), 0)
#define SAFE1(f, a) SafeCall((void *)(f), (ULONG)(a))

// Raw keyboard state, indexed by Amiga raw key code.
extern volatile UBYTE keyDown[128];
// Ring buffer of key-down events (raw codes) for menus and toggles.
int KeyPop(void);           // -1 when empty

enum {
	KEY_ESC = 0x45, KEY_RETURN = 0x44, KEY_ENTER = 0x43, KEY_SPACE = 0x40,
	KEY_UP = 0x4c, KEY_DOWN = 0x4d, KEY_RIGHT = 0x4e, KEY_LEFT = 0x4f,
	KEY_A = 0x20, KEY_D = 0x22, KEY_W = 0x11, KEY_S = 0x21, KEY_J = 0x26, KEY_K = 0x27,
	KEY_X = 0x32, KEY_P = 0x19, KEY_M = 0x37, KEY_CTRL = 0x63, KEY_HELP = 0x5f,
	KEY_F1 = 0x50, KEY_F10 = 0x59,
};

// Joystick in port 2 (and the mouse/second stick buttons).
typedef struct {
	UBYTE left, right, up, down, fire, fire2;
} Joy;
Joy ReadJoystick(void);
BOOL MouseButton(void);
