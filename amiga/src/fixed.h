// Fixed-point maths (the A1200's 68EC020 has no FPU).
#pragma once
#include <exec/types.h>

// World units carry 12 fractional bits: 1.0 unit = 4096. Logic runs at a fixed 50 Hz.
#define FX_SHIFT 12
#define FX_ONE (1 << FX_SHIFT)
#define FX(v) ((LONG)((v) * FX_ONE))
#define FXI(v) ((v) >> FX_SHIFT)
#define FXMUL(a, b) ((LONG)(((a) * (b)) >> FX_SHIFT))
// per-second quantities converted to per-tick (1/50 s)
#define PER_TICK(v) ((LONG)((v) * FX_ONE / 50.0))
#define PER_TICK2(v) ((LONG)((v) * FX_ONE / 2500.0))
// 1 - exp(-lambda / 50) in FX, the per-tick factor of the original damp()
#define DAMPK(l) ((LONG)((1.0 - __builtin_exp(-(l) / 50.0)) * FX_ONE + 0.5))

#define PX_PER_UNIT 18   // screen pixels per world unit on the walking plane

static inline LONG Damp(LONG a, LONG b, LONG k) { return a + (((b - a) * k) >> FX_SHIFT); }
static inline LONG Clamp(LONG v, LONG lo, LONG hi) { return v < lo ? lo : v > hi ? hi : v; }
static inline LONG Abs(LONG v) { return v < 0 ? -v : v; }
static inline LONG Sign(LONG v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
static inline LONG Min(LONG a, LONG b) { return a < b ? a : b; }
static inline LONG Max(LONG a, LONG b) { return a > b ? a : b; }

// 1024-step sine table, values in FX (-4096..4096). Angle: 1024 = full turn.
extern const WORD sinTab[1024];
static inline LONG Sin(LONG a) { return sinTab[a & 1023]; }
static inline LONG Cos(LONG a) { return sinTab[(a + 256) & 1023]; }

// xorshift random numbers
extern ULONG rngState;
static inline ULONG Rand(void) {
	ULONG x = rngState;
	x ^= x << 13; x ^= x >> 17; x ^= x << 5;
	return rngState = x;
}
// uniform in [a, b) for FX values
static inline LONG RandRange(LONG a, LONG b) { return a + (LONG)(((unsigned long long)(Rand() >> 8) * (ULONG)(b - a)) >> 24); }
static inline LONG RandInt(LONG n) { return (LONG)(((Rand() >> 16) * (ULONG)n) >> 16); }
static inline BOOL Chance(LONG fxProb) { return (LONG)(Rand() >> 20) < fxProb; }
