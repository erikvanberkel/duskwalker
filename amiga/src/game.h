// Game state and logic (a fixed-point port of src/main.js, src/player.js and src/enemies.js).
#pragma once
#include "fixed.h"
#include "assets.h"

enum { ST_INTRO, ST_TITLE, ST_PLAY, ST_PAUSED, ST_WON, ST_OVER, ST_WONSCREEN };

typedef struct { BYTE left, right, down, jump, attack; } Input;
typedef struct { LONG x0, x1, y0, y1; } Box;

#define TICKS(s) ((WORD)((s) * 50 + 0.5))
#define ATTACK_TICKS 17

typedef struct {
	LONG x, y, vx, vy;
	BYTE facing, onGround, crouch, dead, attackSide;
	WORD hp, maxHp, invuln, hurtT, attackT, deadT;
	LONG phase;                 // animation phase, 1024 = full cycle
	UWORD swing;                // id of the current swing (enemies remember what hit them)
	LONG scarfX[8], scarfY[8], scarfQX[8], scarfQY[8];
	BYTE scarfInit;
	BYTE jumpBuf, attackBuf;    // ticks a press stays valid (pressed just before landing / before a swing ends)
} Player;

enum { EN_NONE, EN_SKITTER, EN_STALKER, EN_WISP, EN_SEED, EN_SHOCK, EN_TITAN };
enum { S_WALK, S_WINDUP, S_STRIKE, S_RECOVER, S_HOVER, S_DIVE, S_DORMANT, S_IDLE, S_SEEDS, S_SLAM, S_SUMMON };

typedef struct {
	BYTE type, state, facing, fired;
	LONG x, y, vx, vy;
	WORD hp, maxHp, contact, score;
	LONG knock, knockUp;
	WORD t, stateT, flash, dying, hopT, life, cycle, delayShock;
	LONG baseY, fromX, fromY, toX;
	UWORD hitSwing;
} Enemy;

typedef struct { BYTE alive; LONG x, y; WORD t; } Relic;

typedef struct { LONG x, y, vx, vy; WORD life, maxLife; UBYTE color, grav, big; } Particle;

#define MAX_ENEMIES 24
#define MAX_RELICS 16
#define MAX_PARTICLES 96

typedef struct {
	BYTE state;
	LONG time;                  // ticks of play
	LONG score;
	Player player;
	Enemy enemies[MAX_ENEMIES];
	Relic relics[MAX_RELICS];
	Particle parts[MAX_PARTICLES];
	int partCursor;
	BYTE triggerFired[24];
	struct { BYTE type, side; LONG at; } pending[32];
	int numPending;
	Enemy *boss;
	LONG camX;                  // FX world x of the screen centre
	LONG shake;                 // FX (screen shake amount, squared on use)
	WORD hitstop, zone, endT, trickle, flashT;
	BYTE arena;
	LONG attractT;
	WORD bannerT;               // ticks the zone banner has been up (-1 = hidden)
	UBYTE musicOn;
} Game;

extern Game G;

// level
#define LEVEL_START FX(4)
#define LEVEL_END FX(905)
#define LEVEL_ARENA FX(838)

void GameReset(void);
void GameUpdatePlay(const Input *in);
void GameUpdateIdle(void);         // title / game over: the world keeps breathing
void GameUpdateCamera(LONG targetX, LONG lead);
void GameDraw(void);               // bobs, particles and scarf into the back buffer
int ZoneAt(LONG x);
LONG HalfWidth(void);

// hooks into main.c
void OnGameOver(int won);
void OnZoneChange(int zone);
void OnArena(void);
void OnPlayerHurt(void);
