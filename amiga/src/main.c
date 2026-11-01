// Duskwalker for the Amiga 1200: start-up, screens (intro, title, game over), HUD and the main loop.
#include "sys.h"
#include "gfx.h"
#include "game.h"
#include "audio.h"

void Unpack(const UBYTE *src, UBYTE *dst, ULONG size);
void MirrorFrames(void);
BOOL GfxReady(void);

static Layout layout;
#ifdef WATCHDOG
volatile UWORD dbgStage, dbgWatch;   // debug builds: last main-loop stage, shown by the watchdog
#define DBG(n) (dbgStage = (n))
#else
#define DBG(n) ((void)0)
#endif
static BYTE layoutDirty;
static LONG introT, overT, blinkT, flashT;
static BYTE quitRequested;
static int shownScore = -1, shownHp = -1, shownSec = -1, shownProg = -1, shownBoss = -1;

// ---------------------------------------------------------------- input
static BYTE prevJump, prevAttack, prevStart;

static Input ReadInput(void) {
	Joy j = ReadJoystick();
	Input in;
	in.left = keyDown[KEY_LEFT] || keyDown[KEY_A] || j.left;
	in.right = keyDown[KEY_RIGHT] || keyDown[KEY_D] || j.right;
	in.down = keyDown[KEY_DOWN] || keyDown[KEY_S] || j.down;
	BOOL jump = keyDown[KEY_UP] || keyDown[KEY_W] || keyDown[KEY_SPACE] || j.up || j.fire2;
	BOOL attack = keyDown[KEY_J] || keyDown[KEY_X] || keyDown[KEY_K] || keyDown[KEY_CTRL] || j.fire;
	in.jump = jump && !prevJump;
	in.attack = attack && !prevAttack;
	prevJump = (BYTE)jump; prevAttack = (BYTE)attack;
#ifdef AUTOPLAY
	{
		// scripted wanderer for unattended test runs: walk right, swing, hop now and then
		static int t;
		t++;
		in.left = in.down = 0;
		in.right = (t % 200) < 170;
		in.attack = (t % 13) == 0;
		in.jump = (t % 90) == 45;
	}
#endif
	return in;
}

// "start" = fire, return, enter, space or the left mouse button (edge triggered)
static BOOL StartPressed(void) {
	Joy j = ReadJoystick();
	BOOL s = j.fire || keyDown[KEY_RETURN] || keyDown[KEY_ENTER] || keyDown[KEY_SPACE] || MouseButton();
	BOOL edge = s && !prevStart;
	prevStart = (BYTE)s;
	return edge;
}

// ---------------------------------------------------------------- palette helpers

static void SetGrad(int base, int y0, int y1, const ULONG *stops, int n) {
	for (int y = 0; y < 256; y++) {
		int t = y <= y0 ? 0 : y >= y1 ? 256 : (y - y0) * 256 / (y1 - y0);
		int seg = t * (n - 1) / 256;
		if (seg >= n - 1) seg = n - 2;
		int lt = t * (n - 1) - seg * 256;
		pal[base + y] = MixRGB(stops[seg], stops[seg + 1], lt);
	}
}

// Zone colours of the floor and the near trees follow the camera, like zoneWeights() in world.js.
static void BlendZones(LONG camX) {
	static LONG lastKey = -1;
	int x = (int)(camX >> FX_SHIFT);
	int g = x < 300 ? 0 : x > 360 ? 256 : (x - 300) * 256 / 60;
	int c = x < 620 ? 0 : x > 680 ? 256 : (x - 620) * 256 / 60;
	LONG key = g * 1000 + c;
	if (key == lastKey) return;
	lastKey = key;
	for (int k = 0; k < ZONE_K; k++) {
		ULONG v = MixRGB(zonePal[0][k], zonePal[1][k], g);
		if (c) v = MixRGB(v, zonePal[2][k], c);
		pal[zonePalIdx[k]] = v;
	}
	PalDirty();
}

// ---------------------------------------------------------------- HUD (PF1 band in front of the trees)
static UBYTE *hudPlanes[4];
#define HUD_RB 48

static void HudClear(void) {
	for (int k = 0; k < 4; k++) memset(hudPlanes[k], 0, HUD_RB * bandDefs[BAND_HUD].rows);
	shownScore = shownHp = shownSec = shownProg = -1;
}

static void HudRect(int x, int y, int w, int h, int c) {
	x += 64;
	for (int k = 0; k < 4; k++)
		for (int r = y; r < y + h; r++) {
			UBYTE *row = hudPlanes[k] + r * HUD_RB;
			for (int i = x; i < x + w; i++) {
				UBYTE bit = (UBYTE)(0x80 >> (i & 7));
				if (c & (1 << k)) row[i >> 3] |= bit; else row[i >> 3] &= (UBYTE)~bit;
			}
		}
}

static void FormatNumber(char *buf, LONG v) {
	char tmp[16];
	int n = 0, digits = 0;
	if (v < 0) v = 0;
	do { if (digits && digits % 3 == 0) tmp[n++] = ','; tmp[n++] = (char)('0' + v % 10); v /= 10; digits++; } while (v);
	for (int i = 0; i < n; i++) buf[i] = tmp[n - 1 - i];
	buf[n] = 0;
}

static void FormatTime(char *buf, LONG ticks) {
	LONG s = ticks / 50;
	int m = (int)(s / 60), ss = (int)(s % 60), n = 0;
	char tmp[8];
	int k = 0;
	do { tmp[k++] = (char)('0' + m % 10); m /= 10; } while (m);
	while (k) buf[n++] = tmp[--k];
	buf[n++] = ':'; buf[n++] = (char)('0' + ss / 10); buf[n++] = (char)('0' + ss % 10); buf[n] = 0;
}

#ifdef SHOWMEM
static ULONG freeChip;
#endif
static void HudUpdate(void) {
#ifdef SHOWMEM
	{ char b[8]; ULONG v = freeChip; for (int i = 3; i >= 0; i--) { b[i] = (char)('0' + v % 10); v /= 10; } b[4] = 0; HudRect(222, 9, 34, 8, 0); TextDraw(hudPlanes, HUD_RB, 64 + 222, 10, b, 6, -1); }
#endif
	Player *p = &G.player;
	if (p->hp != shownHp) {
		shownHp = p->hp;
		for (int i = 0; i < 10; i++) {
			int x = 10 + i * 7;
			if (i < p->hp) { HudRect(x, 4, 5, 9, 3); HudRect(x, 12, 5, 1, 4); }
			else { HudRect(x, 4, 5, 9, 0); HudRect(x, 7, 5, 4, 5); }
		}
	}
	if (G.score != shownScore) {
		shownScore = (int)G.score;
		char buf[16];
		FormatNumber(buf, G.score);
		HudRect(220, 1, 96, 9, 0);
		TextDraw(hudPlanes, HUD_RB, 64 + 312 - TextWidth(buf), 1, buf, 1, 2);
	}
	int sec = (int)(G.time / 50);
	if (sec != shownSec) {
		shownSec = sec;
		char buf[12];
		FormatTime(buf, G.time);
		HudRect(250, 10, 66, 8, 0);
		TextDraw(hudPlanes, HUD_RB, 64 + 312 - TextWidth(buf), 10, buf, 5, -1);
	}
	LONG span = LEVEL_ARENA - LEVEL_START;
	int prog = (int)Clamp((p->x - LEVEL_START) / ((span >> 7) | 1), 0, 128) * 100 / 128;
	if (prog != shownProg) {
		shownProg = prog;
		HudRect(110, 7, 100, 3, 7);
		if (prog) HudRect(110, 7, prog, 3, 6);
		if (prog > 2) HudRect(110 + prog - 2, 7, 2, 3, 8);
	}
}

// boss panel fill
static void BossBar(void) {
	int hp = G.boss && G.boss->type == EN_TITAN ? G.boss->hp : 0;
	if (hp == shownBoss) return;
	shownBoss = hp;
	UBYTE *pl[4];
	for (int k = 0; k < 4; k++) pl[k] = Pf1BandPlane(BAND_BOSS, k);
	int rb = bandDefs[BAND_BOSS].rb, fill = hp * 214 / 26;
	for (int y = 13; y < 19; y++)
		for (int x = 0; x < 214; x++) {
			int c = x >= fill ? 6 : x < 71 ? 3 : x < 143 ? 4 : 5;
			int X = 53 + x + 64;
			for (int k = 0; k < 4; k++) {
				UBYTE *b = pl[k] + y * rb + (X >> 3), bit = (UBYTE)(0x80 >> (X & 7));
				if (c & (1 << k)) *b |= bit; else *b &= (UBYTE)~bit;
			}
		}
}

// ---------------------------------------------------------------- text screens on PF2
static UBYTE **TP(void) { return pf2TextPlanes; }
static void Centered(const char *s, int y, int color, int shadow) { TextDraw(TP(), PF2TEXT_RB, 64 + 160 - TextWidth(s) / 2, y, s, color, shadow); }

static void SetTextColors(ULONG c1, ULONG c2) {
	pal[PAL_TEXT + 1] = c1; pal[PAL_TEXT + 2] = c2;
}

static void TitleScreen(void) {
	Pf2TextClear();
	const Frame *f = &frames[FR_TXT_TITLE];
	int ty = 34;
	Pf2TextBlit(FR_TXT_TITLE, 160 - f->ww * 8, ty);
	static const ULONG grad[3] = {0xffe0a8, 0xff8a3d, 0xa33a1a};
	SetGrad(PAL_TEXTGRAD, ty + 8, ty + f->h - 6, grad, 3);
	for (int y = 0; y < 256; y++) pal[PAL_TEXTGRAD2 + y] = 0x3a1008;
	Centered("A JOURNEY ACROSS THE AMBER PLAINS", ty + f->h + 4, 4, 15);
	static const char *keys[] = {
		"JOYSTICK OR CURSORS / A D   WALK", "UP / W / SPACE   JUMP", "DOWN / S   CROUCH",
		"FIRE / J X CTRL   STRIKE", "P PAUSE    M MUSIC",
	};
	for (int i = 0; i < 5; i++) Centered(keys[i], 132 + i * 11, 3, 15);
	Centered("PRESS FIRE TO BEGIN", 202, 5, 15);
	Centered("A MIRAGE PRODUCTION", 238, 4, 15);
	PalDirty();
}

static void OverScreen(int won) {
	Pf2TextClear();
	int fr = won ? FR_TXT_VICTORY : FR_TXT_FALLEN;
	const Frame *f = &frames[fr];
	int ty = 50;
	Pf2TextBlit(fr, 160 - f->ww * 8, ty);
	static const ULONG gradWon[3] = {0xfff2c4, 0xffb35c, 0xc0501c};
	static const ULONG gradLost[3] = {0xffb0a0, 0xe0443a, 0x6a1020};
	SetGrad(PAL_TEXTGRAD, ty + 8, ty + f->h - 6, won ? gradWon : gradLost, 3);
	Centered(won ? "THE TITAN SLEEPS AND THE DUSK IS LIFTED" : "THE DUSK CLAIMS ANOTHER WANDERER", ty + f->h + 6, 4, 15);
	char buf[40], num[16];
	int n = 0;
	const char *s = "SCORE ";
	while (*s) buf[n++] = *s++;
	FormatNumber(num, G.score);
	for (s = num; *s;) buf[n++] = *s++;
	buf[n] = 0;
	Centered(buf, 150, 3, 15);
	n = 0; s = "TIME ";
	while (*s) buf[n++] = *s++;
	FormatTime(num, G.time);
	for (s = num; *s;) buf[n++] = *s++;
	buf[n] = 0;
	Centered(buf, 164, 3, 15);
	Centered("PRESS FIRE TO TRY AGAIN", 202, 5, 15);
	PalDirty();
}

static void IntroScreen(void) {
	Pf2TextClear();
	const Frame *f = &frames[FR_TXT_MIRAGE];
	int ty = 92;
	Pf2TextBlit(FR_TXT_MIRAGE, 160 - f->ww * 8, ty);
	static const ULONG chrome[6] = {0xffffff, 0x9fd8ff, 0x1d4fa8, 0xffd59a, 0xff7a2a, 0xfff2c4};
	SetGrad(PAL_TEXTGRAD, ty + 10, ty + f->h - 8, chrome, 6);
	for (int y = 0; y < 256; y++) pal[PAL_TEXTGRAD2 + y] = 0x10082a;
	Centered("P R E S E N T S", ty + f->h + 10, 6, -1);
	pal[PAL_TEXT + 6] = 0;
	PalDirty();
}

// copper bars behind the logo: seven bars with hues 200..332, as in the original intro
static ULONG Hsl(int h, int s, int l) {   // h 0..359, s,l 0..100
	int c = (100 - Abs(2 * l - 100)) * s / 100;   // chroma in percent
	int hp = h % 360, x = c * (60 - Abs(hp % 120 - 60)) / 60, m = l - c / 2;
	int r, g, b;
	if (hp < 60) { r = c; g = x; b = 0; } else if (hp < 120) { r = x; g = c; b = 0; } else if (hp < 180) { r = 0; g = c; b = x; }
	else if (hp < 240) { r = 0; g = x; b = c; } else if (hp < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
	return ((ULONG)((r + m) * 255 / 100) << 16) | ((ULONG)((g + m) * 255 / 100) << 8) | (ULONG)((b + m) * 255 / 100);
}

static void IntroBars(LONG t) {
	for (int y = 0; y < 256; y++) pal[PAL_INTRO_C0 + y] = 0;
	for (int i = 0; i < 7; i++) {
		int hue = 200 + i * 22;
		int centre = 128 + (int)((Sin(t * 1024 * 16 / 500 / 10 + i * 73) * 97) >> FX_SHIFT);
		for (int d = -9; d <= 9; d++) {
			int y = centre + d;
			if (y < 0 || y > 255) continue;
			int l = 70 - Abs(d) * 55 / 9;
			pal[PAL_INTRO_C0 + y] = Hsl(hue, 95, l);
		}
	}
	PalDirty();
}

// ---------------------------------------------------------------- layout changes
static void SetLayout(int pf2Text, int pf1Off) {
	layout.pf2Text = (BYTE)pf2Text; layout.pf1Off = (BYTE)pf1Off;
	layoutDirty = 1;
}

static int bannerZone = -1;
static WORD screenShake;     // this frame's camera shake; screen-fixed PF2 objects add it back
void OnZoneChange(int zone) {
	bannerZone = zone;
	G.bannerT = 0;
}

void OnArena(void) { layout.boss = 1; shownBoss = -1; layoutDirty = 1; AudioSetBoss(1); }
void OnPlayerHurt(void) { flashT = 5; }

void OnGameOver(int won) {
	G.state = won ? ST_WONSCREEN : ST_OVER;
	G.endT = 0; overT = 0;
	Sfx(won ? SFX_WIN : SFX_DIE);
	layout.boss = 0; G.bannerT = -1;
	AudioSetBoss(0);
	HudClear();
	OverScreen(won);
	SetLayout(1, 0);
}

// zone name: a PF2 object faded in and out with ordered dithering (25 %, 50 %, full), shown for 2.8 s like the
// original's CSS banner plus its fade-out
static void UpdateBanner(void) {
	if (G.bannerT >= 0 && ++G.bannerT > TICKS(4.0)) G.bannerT = -1;
}

static void DrawBanner(void) {
	int t = G.bannerT;
	if (t < 0 || bannerZone < 0) return;
	int level = t < TICKS(0.4) ? 0 : t < TICKS(0.8) ? 1 : t < TICKS(3.0) ? 2 : t < TICKS(3.5) ? 1 : 0;
	DrawFrame(FR_BANNER + bannerZone * 3 + level, 160 + screenShake, 56, 0);
}

// ---------------------------------------------------------------- frame
static void SetScrollFromCamera(void) {
	ScrollState s;
	LONG camPx = ((G.camX * PX_PER_UNIT) >> FX_SHIFT) - 160 + CAM_OFS;
	if (camPx < 0) camPx = 0;
	// the original offsets the camera by (rand - 0.5) * shake^2 units
	LONG s2 = (G.shake >> 6) * (G.shake >> 6);           // shake^2 * 4096
	LONG sh = s2 * (PX_PER_UNIT / 2) >> 12;               // half of it, in pixels
	s.shake = sh ? (WORD)(RandInt(sh * 2 + 1) - sh) : 0;
	screenShake = s.shake;
	s.camPx = camPx;
	s.skyDrift = 0;
	s.pf2Px = (LONG)(((long long)camPx * TREE_FACTOR_16) >> 16);
	GfxSetScroll(&s);
}

static void StartPlay(void) {
	G.state = ST_PLAY;
	AudioSetBoss(0);
	GameReset();
	HudClear();
	layout.boss = 0; layout.paused = 0;
	SetLayout(0, 0);
	G.state = ST_PLAY;
	shownBoss = -1;
	SetScrollFromCamera();
	GfxRibbonReset();
}

static void ToTitle(void) {
	G.state = ST_TITLE;
	AudioSetBoss(0);
	G.attractT = 0;
	GameReset();
	TitleScreen();
	HudClear();
	layout.boss = layout.paused = 0;
	SetLayout(1, 0);
}

#ifdef AUTOKEYS
// scripted keyboard for unattended tests: {seconds*10 after start, raw key, down}
static const UWORD keyScript[][3] = {
	{20, KEY_RETURN, 1}, {22, KEY_RETURN, 0},             // skip the intro
	{40, KEY_SPACE, 1}, {42, KEY_SPACE, 0},               // start
	{60, KEY_RIGHT, 1}, {90, KEY_J, 1}, {91, KEY_J, 0}, {100, KEY_UP, 1}, {102, KEY_UP, 0},
	{120, KEY_P, 1}, {121, KEY_P, 0},                     // pause (screenshot ~14 s)
	{170, KEY_P, 1}, {171, KEY_P, 0},                     // resume
	{180, KEY_M, 1}, {181, KEY_M, 0},                     // music off
	{190, KEY_DOWN, 1}, {195, KEY_X, 1}, {196, KEY_X, 0}, {205, KEY_DOWN, 0},
	{230, KEY_ESC, 1}, {231, KEY_ESC, 0},                 // escape pauses during play
};
static void RunKeyScript(void) {
	void InjectKey(int code, int down);
	static ULONG t0;
	static int next;
	if (!t0) t0 = vblankCount;
	ULONG t = (vblankCount - t0) / 5;
	while (next < (int)(sizeof(keyScript) / sizeof(keyScript[0])) && keyScript[next][0] <= t) { InjectKey(keyScript[next][1], keyScript[next][2]); next++; }
}
#endif

static void HandleKeys(void) {
#ifdef AUTOKEYS
	RunKeyScript();
#endif
	int k;
	while ((k = KeyPop()) >= 0) {
		if (k == KEY_M) { G.musicOn ^= 1; AudioSetMusic(G.musicOn); }
		if (k == KEY_P || (k == KEY_ESC && G.state != ST_TITLE)) {
			if (G.state == ST_PLAY) { G.state = ST_PAUSED; layout.paused = 1; layoutDirty = 1; PalSetTint(0, 0, 110); }
			else if (G.state == ST_PAUSED) { G.state = ST_PLAY; layout.paused = 0; layoutDirty = 1; PalSetTint(0, 0, 0); }
			else if (G.state == ST_OVER || G.state == ST_WONSCREEN) ToTitle();
		}
		if (k == KEY_ESC && G.state == ST_TITLE) quitRequested = 1;
	}
}

static void Tick(void) {
	switch (G.state) {
	case ST_INTRO:
		introT++;
		IntroBars(introT);
		if (introT > 60) pal[PAL_TEXT + 6] = MixRGB(0, 0xcfe6ff, (int)Min(256, (introT - 60) * 256 / 50));
		if (StartPressed() || introT > TICKS(5)) { AudioStartMusic(); ToTitle(); }
		break;
	case ST_TITLE: {
		G.attractT++;
		LONG x = FX(30) + ((G.attractT % 2500) * FX(6) / 50) % FX(300);   // % 2500: no overflow on a long wait
		if (x < G.camX - FX(50)) G.camX = x;
		ReadInput();
		GameUpdateIdle();
		GameUpdateCamera(x, 0);
		blinkT++;
		pal[PAL_TEXT + 5] = MixRGB(0xffd9a0, 0x3a2030, Abs((int)(blinkT % 80) - 40) * 5);
		PalDirty();
#ifdef AUTOPLAY
		if (G.attractT == 100) { StartPlay(); break; }
#endif
#ifdef AUTOQUIT
		if (G.attractT == 150) quitRequested = 1;
#endif
		if (StartPressed()) StartPlay();
		break;
	}
	case ST_PLAY:
	case ST_WON: {
		Input in = ReadInput();
		GameUpdatePlay(&in);
		if (G.state == ST_WON && ++G.endT > TICKS(2.8)) OnGameOver(1);
		GameUpdateCamera(G.player.x, G.player.facing * FX(2.5));
		UpdateBanner();
		break;
	}
	case ST_PAUSED:
		ReadInput();
		break;
	case ST_OVER:
	case ST_WONSCREEN:
		overT++;
		ReadInput();
		GameUpdateIdle();
		GameUpdateCamera(G.player.x, 0);
		blinkT++;
		pal[PAL_TEXT + 5] = MixRGB(0xffd9a0, 0x3a2030, Abs((int)(blinkT % 80) - 40) * 5);
		PalDirty();
		if (overT > 50 && StartPressed()) StartPlay();
#ifdef AUTOPLAY
		if (overT == 150) StartPlay();
#endif
		break;
	}
	BlendZones(G.camX);
	if (flashT > 0) { flashT--; PalSetTint(0xff2a1a, flashT ? 115 : 0, G.state == ST_PAUSED ? 110 : 0); }
}

#ifdef SHOWFPS
static ULONG Beam(void) { return vblankCount * 313 + BeamLine(); }
ULONG BeamNow(void) { return Beam(); }
ULONG profDraw[6];
static ULONG prof[6];
static int fpsFrames, fpsShown = -1;
static ULONG fpsStart;
static void ShowFps(void) {
	fpsFrames++;
	if (vblankCount - fpsStart >= 50) {
		int fps = fpsFrames * 50 / (int)(vblankCount - fpsStart);
		fpsFrames = 0; fpsStart = vblankCount;
		{
			fpsShown = fps;
			char b[32];
			int n = 0;
			b[n++] = (char)('0' + fps / 10); b[n++] = (char)('0' + fps % 10);
			// main-loop phases in raster lines: logic per tick, restore + ribbon, drawing, copper patch, and the
			// Titan's share of the drawing
			prof[4] = profDraw[1] - profDraw[0];
#ifdef SHOWDRAW
			// draw phases instead: Titan, relics/flies/shadows/enemies, scarf, wanderer, particles
			for (int i = 0; i < 5; i++) prof[i] = profDraw[i + 1] - profDraw[i];
#endif
			for (int i = 0; i < 5; i++) { ULONG v = prof[i] > 999 ? 999 : prof[i]; b[n++] = ' '; b[n++] = (char)('0' + v / 100); b[n++] = (char)('0' + v / 10 % 10); b[n++] = (char)('0' + v % 10); }
			b[n] = 0;
			HudRect(96, 9, 150, 8, 0);
			TextDraw(hudPlanes, HUD_RB, 64 + 96, 10, b, 6, -1);
		}
	}
}
#endif

static void Render(void) {
#ifdef SHOWFPS
	ULONG t0 = Beam();
#endif
	SetScrollFromCamera();
	if (layoutDirty) {
		DBG(4);
		layoutDirty = 0;
		GfxSetLayout(&layout);   // the tree ribbon stays valid: StartPlay() rebuilt it when play began
	}
	DBG(5); GfxBeginFrame();
#ifdef SHOWFPS
	ULONG t1 = Beam();
#endif
	DBG(6);
	if (G.state == ST_PLAY || G.state == ST_WON || G.state == ST_PAUSED) {
		GameDraw();
		DrawBanner();
#ifdef SHOWFPS
		prof[2] = Beam() - t1;
#endif
		HudUpdate();
		if (layout.boss) BossBar();
#ifdef SHOWFPS
		ShowFps();
#endif
	}
#ifdef SHOWFPS
	ULONG t3 = Beam();
#endif
	DBG(7); GfxEndFrame();
#ifdef SHOWFPS
	prof[1] = t1 - t0; prof[3] = Beam() - t3;
#endif
}


int main(void) {
	static const char noMem[] = "Duskwalker: not enough chip memory (needs 2 MB).\n";
	const char *err = (const char *)SAFE0(SysInit);
	if (err) { SAFE1(SysShutdown, err); return 20; }
	assetChip = (UBYTE *)SAFE1(ChipAlloc, ASSET_CHIP_BYTES);
	if (!assetChip) { SAFE1(SysShutdown, noMem); return 20; }
	Unpack(assetPacked, assetChip, ASSET_CHIP_BYTES);
	MirrorFrames();
	SAFE0(GfxInit);
	if (!GfxReady()) { SAFE1(SysShutdown, noMem); return 20; }
	for (int k = 0; k < 4; k++) hudPlanes[k] = Pf1BandPlane(BAND_HUD, k);
	rngState ^= *(volatile UWORD *)0xdff006;
	G.musicOn = 1;

#ifdef SHOWMEM
	{ ULONG FreeChipKB(void); freeChip = (ULONG)SAFE0(FreeChipKB); }
#endif
	SAFE0(SysTakeOver);
	AudioInit();
	vblankHook = AudioVBlank;
	G.state = ST_INTRO;
	GameReset();
	IntroScreen();
	SetLayout(1, 1);
	GfxSetLayout(&layout);
	layoutDirty = 0;
	SetScrollFromCamera();
	GfxStart();
#if defined(AUTOPLAY) && !defined(AUTOMUSIC)
	AudioSetMusic(0);
#endif

	ULONG last = vblankCount;
	while (!quitRequested) {
		ULONG now = vblankCount;
		int steps = (int)(now - last);
		if (steps > 4) steps = 4;
		if (steps < 1) steps = 1;
		last = now;
#ifdef WATCHDOG
		dbgWatch = 0;
#endif
		DBG(1); HandleKeys();
#ifdef SHOWFPS
		ULONG tl = Beam();
#endif
		DBG(2); for (int i = 0; i < steps && !quitRequested; i++) Tick();
#ifdef SHOWFPS
		prof[0] = (Beam() - tl) / steps;
#endif
		// the game logic above ran while the frame drawn last time waited for its vertical blank; only now
		// is its buffer free (logic never touches the display, it only raises flags Render() applies)
		DBG(8); GfxWaitSwap();
		DBG(3); Render();
	}
	vblankHook = 0;
	AudioStop();
	SAFE1(SysShutdown, 0);
	return 0;
}
