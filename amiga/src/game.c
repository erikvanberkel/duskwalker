// Gameplay: the wanderer, the foes, the Bramble Titan, waves, relics, particles and the camera.
// Mirrors the logic of the 3D game at a fixed 50 Hz step in 20.12 fixed point.
#include "game.h"
#include "gfx.h"
#include "audio.h"

Game G;
ULONG rngState = 0x2545f491;

// ---------------------------------------------------------------- constants (per tick)
#define RUN PER_TICK(8.5)
#define ACCEL PER_TICK2(60)
#define GRAV PER_TICK2(44)
#define JUMP PER_TICK(15.5)
#define EGRAV PER_TICK2(40)
#define CAM_Z 14.5

static const BYTE WAVES[][6][3] = {
	// type (1 skitter, 2 stalker, 3 wisp), side, delay (tenths of a second); triggers below
	{{1, 1, 0}, {1, 1, 12}},
	{{1, -1, 0}, {1, 1, 5}},
	{{2, 1, 0}},
	{{1, 1, 0}, {1, 1, 8}, {1, -1, 16}},
	{{2, 1, 0}, {1, -1, 10}},
	{{3, 1, 0}, {3, 1, 15}},
	{{2, 1, 0}, {1, 1, 15}},
	{{1, 1, 0}, {1, -1, 4}, {1, 1, 12}, {2, 1, 25}},
	{{3, 1, 0}, {3, 1, 8}, {3, -1, 16}},
	{{2, 1, 0}, {3, 1, 15}, {3, -1, 20}},
	{{1, 1, 0}, {1, 1, 5}, {1, -1, 10}, {1, 1, 16}},
	{{2, 1, 0}, {2, -1, 14}},
	{{3, 1, 0}, {3, 1, 6}, {3, -1, 12}, {3, 1, 18}},
	{{2, 1, 0}, {1, 1, 5}, {1, -1, 10}},
	{{2, 1, 0}, {2, 1, 16}, {3, -1, 22}},
	{{2, 1, 0}, {2, -1, 10}},
	{{3, 1, 0}, {3, 1, 8}, {1, -1, 5}, {1, 1, 15}},
	{{2, 1, 0}, {2, 1, 12}, {1, -1, 20}},
	{{2, 1, 0}, {3, 1, 5}, {1, -1, 10}, {3, -1, 15}, {1, 1, 20}},
};
static const WORD WAVE_X[] = {22, 58, 92, 128, 168, 212, 250, 292, 342, 384, 432, 472, 520, 562, 612, 662, 702, 742, 785};
#define NUM_WAVES 19
static const WORD RELIC_X[] = {118, 238, 362, 498, 600, 722, 826};

// ---------------------------------------------------------------- helpers
static inline BOOL Overlap(const Box *a, const Box *b) { return a->x0 < b->x1 && a->x1 > b->x0 && a->y0 < b->y1 && a->y1 > b->y0; }
static inline Box MkBox(LONG x0, LONG x1, LONG y0, LONG y1) { Box b = {Min(x0, x1), Max(x0, x1), y0, y1}; return b; }
static void Shake(LONG a) { if (a > G.shake) G.shake = a; }
LONG HalfWidth(void) { return FX(160.0 / PX_PER_UNIT); }
int ZoneAt(LONG x) { return x >= FX(650) ? 2 : x >= FX(330) ? 1 : 0; }

static ULONG ISqrt(ULONG v) {
	ULONG r = 0, b = 1UL << 30;
	while (b > v) b >>= 2;
	while (b) { if (v >= r + b) { v -= r + b; r = (r >> 1) + b; } else r >>= 1; b >>= 2; }
	return r;
}

// ---------------------------------------------------------------- particles
static void Emit(LONG x, LONG y, LONG vx, LONG vy, int life, int color, int grav, int big) {
	Particle *p = &G.parts[G.partCursor];
	G.partCursor = (G.partCursor + 1) % MAX_PARTICLES;
	p->x = x; p->y = y; p->vx = vx; p->vy = vy; p->life = p->maxLife = (WORD)life; p->color = (UBYTE)color; p->grav = (UBYTE)grav; p->big = (UBYTE)big;
}

static void Burst(LONG x, LONG y, int n, int color) {
	for (int i = 0; i < n; i++) {
		LONG a = RandInt(1024), s = RandRange(PER_TICK(3), PER_TICK(10));
		Emit(x, y, FXMUL(Cos(a), s), FXMUL(Sin(a), s) + PER_TICK(3), TICKS(0.25) + RandInt(TICKS(0.35)), color, 14, i & 1);
	}
}

static void Dust(LONG x, LONG y, int n) {
	for (int i = 0; i < n; i++)
		Emit(x + RandRange(FX(-0.4), FX(0.4)), y, RandRange(PER_TICK(-2.5), PER_TICK(2.5)), RandRange(PER_TICK(0.5), PER_TICK(2.5)), TICKS(0.5) + RandInt(TICKS(0.6)), PF2_DUST, 2, 0);
}

static void UpdateParticles(void) {
	static const LONG drag = FX_ONE - DAMPK(2.2);
	for (int i = 0; i < MAX_PARTICLES; i++) {
		Particle *p = &G.parts[i];
		if (p->life <= 0) continue;
		p->life--;
		p->vy -= (p->grav * 105) >> 6;   // grav is in units/s^2
		p->vx = FXMUL(p->vx, drag);
		p->x += p->vx; p->y += p->vy;
		if (p->y < FX(0.02)) { p->y = FX(0.02); p->vy = -p->vy * 3 / 10; }
	}
}

// ---------------------------------------------------------------- enemies
static Enemy *NewEnemy(int type, LONG x, LONG y) {
	for (int i = 0; i < MAX_ENEMIES; i++) {
		Enemy *e = &G.enemies[i];
		if (e->type) continue;
		memset(e, 0, sizeof(*e));
		e->type = (BYTE)type; e->x = x; e->y = y; e->facing = -1; e->t = (WORD)RandInt(500);
		e->hitSwing = 0xffff;
		return e;
	}
	return 0;
}

static Enemy *Spawn(int type, LONG x) {
	Enemy *e = 0;
	if (type == 1) {
		if ((e = NewEnemy(EN_SKITTER, x, 0))) { e->hp = 1; e->knock = PER_TICK(9); e->knockUp = PER_TICK(6); e->contact = 1; e->score = 100; e->hopT = TICKS(0.8) + RandInt(TICKS(1.2)); }
	} else if (type == 2) {
		if ((e = NewEnemy(EN_STALKER, x, 0))) { e->hp = 3; e->knock = PER_TICK(4); e->contact = 1; e->score = 300; e->state = S_WALK; }
	} else if (type == 3) {
		if ((e = NewEnemy(EN_WISP, x, FX(4)))) {
			e->hp = 1; e->knock = PER_TICK(6); e->contact = 1; e->score = 150; e->state = S_HOVER;
			e->stateT = TICKS(0.5) + RandInt(TICKS(1)); e->baseY = RandRange(FX(3.6), FX(4.6));
		}
	}
	return e;
}

static void Remove(Enemy *e) { e->type = EN_NONE; }

static void Killed(Enemy *e) {
	G.score += e->score;
	Sfx(SFX_KILL);
	Burst(e->x, e->y + FX(0.8), 26, e->type == EN_TITAN ? PF2_EMBER : PF2_LIGHT);
	if (e->type == EN_STALKER && Chance(FX(0.4))) {
		// a free slot, else the relic left furthest behind the camera (unpicked ones keep their slot otherwise)
		int slot = -1; LONG behind = 0;
		for (int i = 0; i < MAX_RELICS; i++) {
			if (!G.relics[i].alive) { slot = i; break; }
			if (G.camX - G.relics[i].x > behind) { behind = G.camX - G.relics[i].x; slot = i; }
		}
		if (slot >= 0) { Relic *r = &G.relics[slot]; r->alive = 1; r->x = e->x; r->y = FX(1.2); r->t = 0; }
	}
	if (e->type == EN_TITAN) { G.state = ST_WON; G.endT = 0; Shake(FX(1.2)); }
}

static Box HurtBox(const Enemy *e) {
	Box none = {0, -1, 0, -1};
	if (e->dying) return none;
	switch (e->type) {
	case EN_SKITTER: return MkBox(e->x - FX(0.6), e->x + FX(0.6), e->y, e->y + FX(1.0));
	case EN_STALKER: return MkBox(e->x - FX(0.6), e->x + FX(0.8), FX(0.4), FX(3.4));
	case EN_WISP: return MkBox(e->x - FX(0.55), e->x + FX(0.55), e->y - FX(0.6), e->y + FX(0.5));
	case EN_SEED: return MkBox(e->x - FX(0.45), e->x + FX(0.45), e->y - FX(0.45), e->y + FX(0.45));
	case EN_TITAN: if (e->state != S_DORMANT) return MkBox(e->x - FX(2.6), e->x + FX(2.4), 0, FX(8.5)); break;
	}
	return none;
}

static Box AttackBox(const Enemy *e) {
	Box none = {0, -1, 0, -1};
	if (e->dying) return none;
	if (e->type == EN_STALKER && e->state == S_STRIKE) return MkBox(e->x + e->facing * FX(0.3), e->x + e->facing * FX(2.6), FX(0.2), FX(2.6));
	if (e->type == EN_SHOCK) return MkBox(e->x - FX(0.45), e->x + FX(0.45), 0, FX(0.95));
	return none;
}

static BOOL HitEnemy(Enemy *e, int dmg, int dir) {
	if (e->type == EN_SHOCK) return FALSE;
	if (e->type == EN_SEED) {
		Burst(e->x, e->y, 14, PF2_EMBER); G.score += e->score; Remove(e); return TRUE;
	}
	if (e->type == EN_TITAN) {
		if (e->state == S_DORMANT) return FALSE;
		e->hp -= dmg; e->flash = TICKS(0.12);
		Burst(e->x - FX(2.2), FX(4.5), 10, PF2_EMBER);
		if (e->hp <= 0) { e->dying = 1; Killed(e); }
		return TRUE;
	}
	if (e->type == EN_STALKER && e->state == S_WINDUP && e->hp > dmg) { e->state = S_RECOVER; e->stateT = 0; }
	e->hp -= dmg; e->flash = TICKS(0.12);
	e->vx = dir * e->knock;
	if (e->y <= FX(0.01) && e->knockUp) e->vy = e->knockUp;
	if (e->hp <= 0) { e->dying = 1; Killed(e); }
	return TRUE;
}

static void BaseUpdate(Enemy *e) {
	e->t++;
	if (e->flash > 0) e->flash--;
	if (e->dying) { e->dying++; if (e->dying > TICKS(0.55)) Remove(e); }
}

static void UpdateSkitter(Enemy *e, const Player *p) {
	if (!e->dying) {
		LONG dx = p->x - e->x;
		if (Abs(dx) > FX(0.4)) e->facing = (BYTE)Sign(dx);
		if (e->y <= 4) {
			e->vx = Damp(e->vx, e->facing * PER_TICK(5.6), DAMPK(4));
			if (--e->hopT <= 0 && Abs(dx) < FX(7)) { e->vy = RandRange(PER_TICK(7), PER_TICK(11)); e->hopT = TICKS(1.2) + RandInt(TICKS(1.4)); }
		}
	} else e->vx = Damp(e->vx, 0, DAMPK(5));
	e->vy -= EGRAV; e->x += e->vx; e->y += e->vy;
	if (e->y <= 0) { e->y = 0; e->vy = 0; }
	BaseUpdate(e);
}

static void UpdateStalker(Enemy *e, const Player *p) {
	e->stateT++;
	LONG dx = p->x - e->x;
	if (!e->dying) {
		if (e->state == S_WALK) {
			if (Abs(dx) > FX(0.3)) e->facing = (BYTE)Sign(dx);
			e->vx = Damp(e->vx, e->facing * PER_TICK(2.7), DAMPK(3));
			if (Abs(dx) < FX(2.5) && !p->dead) { e->state = S_WINDUP; e->stateT = 0; Sfx(SFX_WINDUP); }
		} else {
			e->vx = Damp(e->vx, 0, DAMPK(6));
			if (e->state == S_WINDUP && e->stateT > TICKS(0.5)) { e->state = S_STRIKE; e->stateT = 0; Sfx(SFX_SLASH); }
			else if (e->state == S_STRIKE && e->stateT > TICKS(0.2)) { e->state = S_RECOVER; e->stateT = 0; }
			else if (e->state == S_RECOVER && e->stateT > TICKS(0.75)) { e->state = S_WALK; e->stateT = 0; }
		}
	} else e->vx = Damp(e->vx, 0, DAMPK(5));
	e->x += e->vx;
	BaseUpdate(e);
}

static void UpdateWisp(Enemy *e, const Player *p) {
	e->stateT--;
	LONG dx = p->x - e->x;
	if (!e->dying) {
		e->facing = dx >= 0 ? 1 : -1;
		if (e->state == S_HOVER) {
			LONG want = p->x - e->facing * FX(5.5);
			e->vx = Damp(e->vx, Clamp(want - e->x, FX(-6), FX(6)) / 50, DAMPK(2));
			e->y = Damp(e->y, e->baseY + FXMUL(Sin(e->t * 13 / 2), FX(0.4)), DAMPK(3));
			if (e->stateT <= 0 && Abs(dx) < FX(8)) {
				e->state = S_DIVE; e->stateT = TICKS(1.1); e->fromX = e->x; e->fromY = e->y; e->toX = p->x + e->facing * FX(4);
				Sfx(SFX_WISP);
			}
		} else {
			LONG k = FX_ONE - e->stateT * FX_ONE / TICKS(1.1);
			e->x = e->fromX + FXMUL(e->toX - e->fromX, k);
			e->y = e->fromY - FXMUL(Sin(k >> 3), e->fromY - FX(0.9));
			e->vx = 0;
			if (e->stateT <= 0) { e->state = S_HOVER; e->stateT = TICKS(1.4) + RandInt(TICKS(1.2)); }
		}
	} else e->y -= PER_TICK(3);
	e->x += e->vx;
	BaseUpdate(e);
}

static void SpawnSeed(Enemy *t, LONG tx) {
	Enemy *e = NewEnemy(EN_SEED, t->x - FX(1.5), FX(8.2));
	if (!e) return;
	e->hp = 1; e->contact = 1; e->score = 50;
	const int T = TICKS(1.15);
	e->vx = (tx - e->x) / T;
	// vy so that y(T) = 0.6 with half gravity
	e->vy = (FX(0.6) - e->y) / T + (EGRAV / 2) * (T + 1) / 2;
}

static void UpdateSeed(Enemy *e) {
	e->vy -= EGRAV / 2; e->x += e->vx; e->y += e->vy; e->t++;
	if (e->y < FX(0.2)) { Burst(e->x, FX(0.2), 18, PF2_EMBER); Sfx(SFX_THUD); Remove(e); }
}

static void SpawnShock(Enemy *t) {
	Enemy *e = NewEnemy(EN_SHOCK, t->x - FX(3.2), 0);
	if (!e) return;
	e->facing = -1; e->contact = 2; e->hp = 99; e->life = TICKS(2.2);
}

static void UpdateShock(Enemy *e) {
	e->life--; e->t++;
	e->x += e->facing * PER_TICK(13);
	if (Chance(FX(0.6))) Dust(e->x, FX(0.1), 1);
	if (e->life <= 0) Remove(e);
}

static void TitanWake(Enemy *t) {
	if (t->state != S_DORMANT) return;
	t->state = S_IDLE; t->stateT = 0; Sfx(SFX_ROAR); Shake(FX(0.8));
}

static void UpdateTitan(Enemy *t, const Player *p) {
	t->t++; t->stateT++;
	if (t->flash > 0) t->flash--;
	BOOL enraged = t->hp < t->maxHp / 2;
	LONG k = t->stateT * FX_ONE / 50;           // seconds in state
	if (enraged) k = k * 145 / 100;
	if (t->delayShock > 0 && --t->delayShock == 0) SpawnShock(t);
	if (t->dying) {
		t->dying++;
		if (Chance(FX(0.5))) Burst(t->x + RandRange(FX(-2), FX(2)), RandRange(FX(1), FX(7)), 4, PF2_EMBER);
		if (t->dying > TICKS(2.4)) Remove(t);
		return;
	}
	switch (t->state) {
	case S_IDLE:
		if (k > FX(1.4)) {
			static const BYTE cycle[5] = {S_SEEDS, S_SLAM, S_SEEDS, S_SUMMON, S_SLAM};
			t->state = cycle[t->cycle++ % 5]; t->stateT = 0; t->fired = 0;
		}
		break;
	case S_SEEDS: {
		int shots = enraged ? 5 : 3;
		if (k > FX(0.5) && t->fired < shots && k > FX(0.5) + t->fired * FX(0.28)) {
			t->fired++;
			SpawnSeed(t, p->x + RandRange(FX(-2.5), FX(1.5)));
			Sfx(SFX_SPIT);
		}
		if (k > FX(0.6) + shots * FX(0.28) + FX(0.4)) { t->state = S_IDLE; t->stateT = 0; }
		break;
	}
	case S_SLAM:
		if (k >= FX(0.92) && !t->fired) {
			t->fired = 1;
			SpawnShock(t);
			if (enraged) t->delayShock = TICKS(0.65);
			Sfx(SFX_SLAM); Shake(FX(0.6));
			Dust(t->x - FX(3.5), FX(0.2), 30);
		}
		if (k > FX(1.7)) { t->state = S_IDLE; t->stateT = 0; }
		break;
	case S_SUMMON:
		if (k > FX(0.7) && !t->fired) {
			t->fired = 1; Sfx(SFX_ROAR);
			Spawn(1, p->x - FX(14));
			Spawn(enraged ? 3 : 1, t->x - FX(4));
		}
		if (k > FX(1.6)) { t->state = S_IDLE; t->stateT = 0; }
		break;
	}
}

static void UpdateEnemy(Enemy *e, const Player *p) {
	switch (e->type) {
	case EN_SKITTER: UpdateSkitter(e, p); break;
	case EN_STALKER: UpdateStalker(e, p); break;
	case EN_WISP: UpdateWisp(e, p); break;
	case EN_SEED: UpdateSeed(e); break;
	case EN_SHOCK: UpdateShock(e); break;
	case EN_TITAN: UpdateTitan(e, p); break;
	}
}

// ---------------------------------------------------------------- the wanderer
static void PlayerReset(Player *p, LONG x) {
	memset(p, 0, sizeof(*p));
	p->x = x; p->facing = 1; p->hp = p->maxHp = 10; p->attackT = -1; p->onGround = 1;
	p->scarfInit = 0;
}

static Box PlayerAttackBox(const Player *p) {
	Box none = {0, -1, 0, -1};
	if (p->attackT < 0 || p->attackT < 4 || p->attackT > 9) return none;
	return MkBox(p->x + p->facing * FX(0.2), p->x + p->facing * FX(1.9), p->crouch ? 0 : p->y + FX(0.6), p->crouch ? FX(1.1) : p->y + FX(2.0));
}

static Box PlayerHurtBox(const Player *p) {
	return MkBox(p->x - FX(0.32), p->x + FX(0.32), p->y, p->y + (p->crouch ? FX(1.15) : FX(1.9)));
}

static BOOL PlayerDamage(Player *p, int n, LONG fromX) {
	if (p->invuln > 0 || p->dead) return FALSE;
	p->hp = (WORD)Max(0, p->hp - n);
	p->invuln = TICKS(1.3); p->hurtT = TICKS(0.32); p->attackT = -1;
	LONG dir = Sign(p->x - fromX);
	if (!dir) dir = -p->facing;
	p->vx = dir * PER_TICK(9); p->vy = PER_TICK(7); p->onGround = 0;
	if (p->hp <= 0) { p->dead = 1; p->deadT = 0; }
	return TRUE;
}

static void UpdateScarf(Player *p) {
	// anchor at the back of the neck
	LONG ax = p->x - p->facing * FX(0.16), ay = p->y + (p->crouch ? FX(1.15) : FX(1.62));
	if (p->dead) ay = p->y + FX(0.6);
	if (!p->scarfInit || Abs(p->scarfX[0] - ax) > FX(1.5)) {
		for (int i = 0; i < 8; i++) { p->scarfX[i] = p->scarfQX[i] = ax - i * FX(0.15) * p->facing; p->scarfY[i] = p->scarfQY[i] = ay; }
		p->scarfInit = 1;
	}
	p->scarfX[0] = p->scarfQX[0] = ax; p->scarfY[0] = p->scarfQY[0] = ay;
	LONG wind = FXMUL(-p->vx * 50, FX(0.6)) - FX(2.5);          // units per second
	LONG windStep = wind * 6 / 2500;                             // * step^2 * 6
	for (int i = 1; i < 8; i++) {
		LONG vx = (p->scarfX[i] - p->scarfQX[i]) * 96 / 100, vy = (p->scarfY[i] - p->scarfQY[i]) * 96 / 100;
		p->scarfQX[i] = p->scarfX[i]; p->scarfQY[i] = p->scarfY[i];
		p->scarfX[i] += vx + windStep;
		p->scarfY[i] += vy - FX(9) / 2500 + FXMUL(Sin((p->phase * 17 / 10 >> 0) + i * 163), FX(0.004));
		if (p->scarfY[i] < FX(0.05)) p->scarfY[i] = FX(0.05);
	}
	const LONG seg = FX(0.16);
	for (int it = 0; it < 4; it++)
		for (int i = 1; i < 8; i++) {
			LONG dx = p->scarfX[i] - p->scarfX[i - 1], dy = p->scarfY[i] - p->scarfY[i - 1];
			LONG ax = Abs(dx), ay = Abs(dy);
			LONG d = ax > ay ? (ax * 123 + ay * 51) >> 7 : (ay * 123 + ax * 51) >> 7;   // 0.96 max + 0.4 min: |(dx,dy)| within 4 %
			if (d < 1) d = 1;
			LONG f = ((d - seg) << 12) / d;
			if (i == 1) { p->scarfX[i] -= FXMUL(dx, f); p->scarfY[i] -= FXMUL(dy, f); }
			else {
				p->scarfX[i] -= FXMUL(dx, f) / 2; p->scarfY[i] -= FXMUL(dy, f) / 2;
				p->scarfX[i - 1] += FXMUL(dx, f) / 2; p->scarfY[i - 1] += FXMUL(dy, f) / 2;
			}
		}
}

static void PlayerUpdate(Player *p, const Input *in, LONG minX, LONG maxX, BOOL events) {
	// input buffering (new on the Amiga): a jump pressed up to 120 ms before landing, or a strike pressed in
	// the last 160 ms of a swing, still happens instead of being lost
	if (in->jump) p->jumpBuf = 6; else if (p->jumpBuf > 0) p->jumpBuf--;
	if (in->attack) p->attackBuf = 8; else if (p->attackBuf > 0) p->attackBuf--;
	if (p->dead) {
		p->deadT++;
		p->vx = Damp(p->vx, 0, DAMPK(4));
	} else if (p->hurtT > 0) {
		p->hurtT--;
	} else {
		p->crouch = in->down && p->onGround;
		int dir = (in->right ? 1 : 0) - (in->left ? 1 : 0);
		BOOL attacking = p->attackT >= 0;
		if (dir && !(attacking && p->onGround)) p->facing = (BYTE)dir;
		LONG target = p->crouch ? 0 : dir * RUN;
		if (attacking && p->onGround) target = target * 15 / 100;
		LONG a = p->onGround ? ACCEL : ACCEL / 2;
		p->vx += Clamp(target - p->vx, -a, a);
		if (p->jumpBuf && p->onGround && !p->crouch) { p->jumpBuf = 0; p->vy = JUMP; p->onGround = 0; if (events) { Sfx(SFX_JUMP); Dust(p->x, FX(0.1), 8); } }
		if (p->attackBuf && !attacking) { p->attackBuf = 0; p->attackT = 0; p->attackSide ^= 1; p->swing++; if (events) Sfx(SFX_SWING); }
	}
	if (p->attackT >= 0 && ++p->attackT > ATTACK_TICKS) p->attackT = -1;
	if (p->invuln > 0) p->invuln--;
	p->vy -= GRAV;
	p->x += p->vx;
	p->y += p->vy;
	if (p->y <= 0) {
		if (!p->onGround && p->vy < PER_TICK(-8) && events) { Sfx(SFX_LAND); Dust(p->x, FX(0.1), 8); }
		p->y = 0; p->vy = 0; p->onGround = 1;
	}
	p->x = Clamp(p->x, minX, maxX);
	LONG speed = Abs(p->vx);
	LONG before = p->phase;
	p->phase += 10 + speed * 47 / 1024;   // dt * (3 + speed * 1.15) radians, 1024 per turn
	// a soft footfall twice per stride while running (only when the effects channel is idle)
	if (events && p->onGround && speed > PER_TICK(2) && (before >> 9) != (p->phase >> 9)) SfxSoft(SFX_STEP);
	UpdateScarf(p);
}

// ---------------------------------------------------------------- level flow
void GameReset(void) {
	memset(G.enemies, 0, sizeof(G.enemies));
	memset(G.relics, 0, sizeof(G.relics));
	memset(G.parts, 0, sizeof(G.parts));
	for (int i = 0; i < 7; i++) { G.relics[i].alive = 1; G.relics[i].x = FX(RELIC_X[i]); G.relics[i].y = FX(1.2); G.relics[i].t = (WORD)RandInt(300); }
	memset(G.triggerFired, 0, sizeof(G.triggerFired));
	G.numPending = 0;
	G.boss = NewEnemy(EN_TITAN, LEVEL_END - FX(14), 0);
	G.boss->hp = G.boss->maxHp = 26; G.boss->contact = 1; G.boss->score = 5000; G.boss->state = S_DORMANT;
	G.score = 0; G.time = 0; G.zone = -1; G.bannerT = -1; G.trickle = TICKS(5); G.endT = 0; G.arena = 0; G.hitstop = 0; G.shake = 0;
#ifdef AUTOX
	PlayerReset(&G.player, G.state == ST_PLAY ? FX(AUTOX) : LEVEL_START);
	for (int w = 0; w < NUM_WAVES; w++) if (WAVE_X[w] < AUTOX - 30) G.triggerFired[w] = 1;
#else
	PlayerReset(&G.player, LEVEL_START);
#endif
	G.camX = G.player.x + FX(4);
}

void GameUpdatePlay(const Input *input) {
	static BYTE heldJump, heldAttack;   // presses made during hitstop (the original still reads input then)
	Player *p = &G.player;
	Input cur = *input, *in = &cur;
	if (G.hitstop > 0) { G.hitstop--; heldJump |= cur.jump; heldAttack |= cur.attack; return; }
	cur.jump |= heldJump; cur.attack |= heldAttack;
	heldJump = heldAttack = 0;
	G.time++;
	LONG minX = G.arena ? LEVEL_ARENA - FX(2) : LEVEL_START - FX(2);
	PlayerUpdate(p, in, minX, LEVEL_END - FX(2), TRUE);
	if (Abs(p->vx) > PER_TICK(6) && p->onGround && Chance(FX(0.25))) Dust(p->x - p->facing * FX(0.3), FX(0.05), 1);

	// waves
	LONG hw = HalfWidth();
	for (int w = 0; w < NUM_WAVES; w++) {
		if (G.triggerFired[w] || p->x <= FX(WAVE_X[w])) continue;
		G.triggerFired[w] = 1;
		for (int i = 0; i < 6 && WAVES[w][i][0]; i++) {
			if (G.numPending >= 32) break;
			G.pending[G.numPending].type = WAVES[w][i][0];
			G.pending[G.numPending].side = WAVES[w][i][1];
			G.pending[G.numPending].at = G.time + WAVES[w][i][2] * 5;
			G.numPending++;
		}
	}
	for (int i = 0; i < G.numPending;) {
		if (G.time < G.pending[i].at) { i++; continue; }
		Spawn(G.pending[i].type, Clamp(G.camX + G.pending[i].side * (hw + FX(3)), minX, LEVEL_ARENA - FX(4)));
		G.pending[i] = G.pending[--G.numPending];
	}
	// ambient trickle of foes
	if (G.trickle > 0) G.trickle--;
	int live = 0;
	for (int i = 0; i < MAX_ENEMIES; i++) { Enemy *e = &G.enemies[i]; if (e->type && e->type != EN_TITAN && !e->dying) live++; }
	if (!G.arena && G.trickle <= 0 && live < 3) {
		G.trickle = TICKS(4) + RandInt(TICKS(3));
		int z = ZoneAt(p->x);
		int type = z == 0 ? 1 : z == 1 ? (Chance(FX(0.6)) ? 3 : 1) : (Chance(FX(0.5)) ? 2 : 1);
		Spawn(type, G.camX + (Chance(FX(0.75)) ? 1 : -1) * (hw + FX(3)));
	}

	// zones and the arena
	int z = ZoneAt(p->x);
	if (z != G.zone) { G.zone = (WORD)z; OnZoneChange(z); }
	if (!G.arena && p->x > LEVEL_ARENA) { G.arena = 1; OnArena(); }
	if (G.arena && p->x > LEVEL_ARENA + FX(6) && G.boss->type == EN_TITAN) TitanWake(G.boss);

	// foes and combat
	Box atk = PlayerAttackBox(p), hb = PlayerHurtBox(p);
	BOOL atkOn = atk.x1 >= atk.x0;
	for (int i = 0; i < MAX_ENEMIES; i++) {
		Enemy *e = &G.enemies[i];
		if (!e->type) continue;
		UpdateEnemy(e, p);
		if (!e->type || e->dying) continue;
		Box ehb = HurtBox(e);
		BOOL ehbOn = ehb.x1 >= ehb.x0;
		if (atkOn && ehbOn && Overlap(&atk, &ehb) && e->hitSwing != p->swing) {
			e->hitSwing = p->swing;
			if (HitEnemy(e, 1, p->facing)) {
				Sfx(SFX_HIT);
				Burst((Max(atk.x0, ehb.x0) + Min(atk.x1, ehb.x1)) / 2, (Max(atk.y0, ehb.y0) + Min(atk.y1, ehb.y1)) / 2, 12, PF2_LIGHT);
				G.hitstop = 3; Shake(FX(0.18));
			}
			if (!e->type || e->dying) continue;
		}
		if (p->dead) continue;
		Box eab = AttackBox(e);
		int dmg = 0;
		if (eab.x1 >= eab.x0 && Overlap(&eab, &hb)) dmg = e->contact > 1 ? e->contact : 2;
		else if (e->contact && ehbOn && e->type != EN_TITAN && Overlap(&ehb, &hb)) dmg = e->contact;
		if (dmg && PlayerDamage(p, dmg, e->x)) { Sfx(SFX_HURT); Shake(FX(0.35)); OnPlayerHurt(); }
	}
	// the Titan's bulk blocks the way
	Enemy *b = G.boss;
	if (b && b->type == EN_TITAN && !b->dying && p->x > b->x - FX(2.9)) { p->x = b->x - FX(2.9); if (p->vx > 0) p->vx = PER_TICK(-4); }
	for (int i = 0; i < MAX_ENEMIES; i++) {
		Enemy *e = &G.enemies[i];
		if (e->type && e->type != EN_TITAN && (e->x < G.camX - hw - FX(30) || e->x > G.camX + hw + FX(30))) Remove(e);
	}

	// relics
	for (int i = 0; i < MAX_RELICS; i++) {
		Relic *r = &G.relics[i];
		if (!r->alive) continue;
		r->t++;
		Box rb = MkBox(r->x - FX(0.5), r->x + FX(0.5), r->y - FX(1.2), r->y + FX(0.8));
		if (!p->dead && p->hp < p->maxHp && Overlap(&rb, &hb)) {
			p->hp = (WORD)Min(p->maxHp, p->hp + 3); r->alive = 0; Sfx(SFX_PICKUP);
			Burst(r->x, r->y, 20, PF2_RED); G.score += 50;
		}
	}
	UpdateParticles();
	if (p->dead && ++G.endT > TICKS(2.2)) OnGameOver(0);
}

void GameUpdateIdle(void) {
	static const Input none = {0, 0, 0, 0, 0};
	for (int i = 0; i < MAX_ENEMIES; i++) if (G.enemies[i].type) UpdateEnemy(&G.enemies[i], &G.player);
	PlayerUpdate(&G.player, &none, LEVEL_START - FX(2), LEVEL_END, FALSE);
	UpdateParticles();
}

void GameUpdateCamera(LONG targetX, LONG lead) {
	LONG want = targetX + lead;
	if (G.arena) want = Clamp(want, LEVEL_ARENA + FX(12), LEVEL_END - FX(12));
	G.camX = Damp(G.camX, want, DAMPK(3.2));
	G.shake = Max(0, G.shake - FX(1.8) / 50);
}

// ---------------------------------------------------------------- drawing
static inline int ScreenX(LONG x) { return (int)(((x - G.camX) * PX_PER_UNIT) >> FX_SHIFT) + 160; }
static inline int ScreenY(LONG y) { return PATH_Y - (int)((y * PX_PER_UNIT) >> FX_SHIFT); }

static int PlayerFrame(const Player *p) {
	int f;
	if (p->dead) { int k = p->deadT / TICKS(0.15); f = 26 + (k > 3 ? 3 : k); }
	else if (p->hurtT > 0) f = 25;
	else if (p->attackT >= 0) {
		int t = p->attackT;
		if (p->crouch) f = 21 + p->attackSide * 2 + (t < 6 ? 0 : 1);
		else f = 13 + p->attackSide * 4 + (t < 3 ? 0 : t < 6 ? 1 : t < 9 ? 2 : 3);
	} else if (!p->onGround) f = p->vy > 0 ? 10 : 11;
	else if (p->crouch) f = 12;
	else if (Abs(p->vx) > PER_TICK(0.6)) f = 2 + ((p->phase * 8 >> 10) & 7);
	else f = (p->phase >> 10) & 1;
	return FR_PLAYER + f + (p->facing < 0 ? FR_PLAYER_MIRROR : 0);
}

static int EnemyFrame(const Enemy *e) {
	int mir;
	switch (e->type) {
	case EN_SKITTER: mir = e->facing < 0 ? FR_SKITTER_MIRROR : 0; return FR_SKITTER + ((e->t * 22 * 4 / 314) & 3) + mir;
	case EN_STALKER: {
		mir = e->facing < 0 ? FR_STALKER_MIRROR : 0;
		if (e->state == S_WINDUP) return FR_STALKER + (e->stateT < TICKS(0.25) ? 6 : 7) + mir;
		if (e->state == S_STRIKE) return FR_STALKER + 8 + mir;
		if (e->state == S_RECOVER) return FR_STALKER + 9 + mir;
		return FR_STALKER + ((e->t * 52 * 6 / 3142) % 6) + mir;
	}
	case EN_WISP: mir = e->facing < 0 ? FR_WISP_MIRROR : 0; return FR_WISP + (e->state == S_DIVE ? 4 : (e->t / 20) & 3) + mir;
	case EN_SEED: return FR_SEED + ((e->t / 3) & 3);
	case EN_SHOCK: return FR_SHOCK + ((e->t / 2) & 1);
	}
	return -1;
}

static void DrawTitan(const Enemy *t) {
	int pose = 1;
	LONG k = t->stateT * FX_ONE / 50;
	if (t->hp < t->maxHp / 2) k = k * 145 / 100;   // enraged: poses follow the faster attack timing
	if (t->state == S_DORMANT) pose = 0;
	else if (t->state == S_SEEDS) pose = k > FX(0.25) ? 3 : 1;
	else if (t->state == S_SLAM) pose = k < FX(0.8) ? 4 : 5;
	else if (t->state == S_SUMMON) pose = 6;
	else pose = (Sin(t->t * 5) > 0) ? 1 : 2;
	int sx = ScreenX(t->x), sy = PATH_Y;
	if (t->dying) sy += (t->dying * t->dying) * 3 * PX_PER_UNIT / (TICKS(2.4) * TICKS(2.4));
	int flash = t->flash > 0 ? PF2_LIGHT : 0;
	for (int s = 0; s < TITAN_STRIPS; s++) if (titanStrips[pose][s] >= 0) DrawFrameOnBg(s, titanStrips[pose][s], sx, sy, flash);
}

#ifdef SHOWFPS
extern ULONG profDraw[6];
ULONG BeamNow(void);
#define PT(i) profDraw[i] = BeamNow()
#else
#define PT(i)
#endif
// soft shadow on the path under someone at height y (shrinks as they rise)
static void Shadow(LONG x, LONG y, int size) {
	int sx = ScreenX(x);
	if (sx < -60 || sx > SCREEN_W + 60) return;
	if (y > FX(2.5)) size -= 2; else if (y > FX(1)) size -= 1;
	if (size >= 0) DrawFrame(FR_SHADOW + size, sx, PATH_Y + 1, 0);
}

// fireflies drifting between the trees: plenty in the grove, a few elsewhere; each sits at its own depth
#define NUM_FLIES 26
static struct { WORD x, y; UWORD depth; UBYTE phase, speed; } flies[NUM_FLIES];
static void InitFlies(void) {
	for (int i = 0; i < NUM_FLIES; i++) {
		flies[i].x = (WORD)RandInt(384); flies[i].y = (WORD)(104 + RandInt(104));
		flies[i].depth = (UWORD)(20000 + RandInt(50000)); flies[i].phase = (UBYTE)RandInt(256); flies[i].speed = (UBYTE)(2 + RandInt(4));
	}
}
static void DrawFlies(void) {
	int n = G.zone == 1 ? NUM_FLIES : G.zone == 0 ? 9 : 6;
	LONG camPx = (G.camX * PX_PER_UNIT) >> FX_SHIFT, t = G.time;
	for (int i = 0; i < n; i++) {
		LONG ph = t * flies[i].speed + flies[i].phase * 4;
		int x = (int)((flies[i].x - ((camPx * flies[i].depth) >> 16) + (Sin(ph) * 10 >> FX_SHIFT)) % 384);
		if (x < 0) x += 384;
		x -= 32;
		int y = flies[i].y + (Sin(ph * 3 / 2 + 300) * 7 >> FX_SHIFT);
		LONG glow = Sin(t * 5 + flies[i].phase * 4);
		if (glow > FX(0.35)) {   // bright: a little cross of light
			PlotPixel(x, y, PF2_LIGHT);
			PlotPixel(x - 1, y, PF2_EMBER); PlotPixel(x + 1, y, PF2_EMBER); PlotPixel(x, y - 1, PF2_EMBER); PlotPixel(x, y + 1, PF2_EMBER);
		} else if (glow > FX(-0.4)) PlotPixel(x, y, PF2_EMBER);
	}
}

void GameDraw(void) {
	Player *p = &G.player;
	static BYTE fliesReady;
	if (!fliesReady) { InitFlies(); fliesReady = 1; }
	PT(0);
	// the Titan first: its strips are drawn together with their background (see DrawFrameOnBg)
	if (G.boss && G.boss->type == EN_TITAN) {
		int sx = ScreenX(G.boss->x);
		if (sx > -100 && sx < SCREEN_W + 100) DrawTitan(G.boss);
	}
	GfxBgObjectsDone();
	PT(1);
	// relics behind everything else
	for (int i = 0; i < MAX_RELICS; i++) {
		Relic *r = &G.relics[i];
		if (!r->alive) continue;
		int sx = ScreenX(r->x);
		if (sx < -32 || sx > SCREEN_W + 32) continue;
		LONG bob = FXMUL(Sin(r->t * 8), FX(0.18));   // sin(t * 2.5): 2.5 / 50 Hz * 1024 / 2pi = 8.1 steps per tick
		DrawFrame(FR_RELIC + ((r->t / 10) & 3), sx, ScreenY(r->y + bob), 0);
	}
	DrawFlies();
	// shadows first, so nobody stands on someone else's
	BOOL blinkNow = p->invuln > 0 && !p->dead && ((p->invuln * 14 / 50) & 1) == 0;
	if (!blinkNow && !p->dead) Shadow(p->x, p->y, 2);
	for (int i = 0; i < MAX_ENEMIES; i++) {
		const Enemy *e = &G.enemies[i];
		int size = e->type == EN_SKITTER ? 1 : e->type == EN_STALKER ? 2 : e->type == EN_WISP ? 1 : e->type == EN_TITAN ? 4 : -1;
		if (size >= 0 && !(e->dying && e->type != EN_TITAN)) Shadow(e->x, e->type == EN_TITAN ? 0 : e->y, size);
	}
	for (int i = 0; i < MAX_ENEMIES; i++) {
		Enemy *e = &G.enemies[i];
		if (!e->type || e->type == EN_TITAN) continue;
		int sx = ScreenX(e->x);
		if (sx < -64 || sx > SCREEN_W + 64) continue;
		int f = EnemyFrame(e);
		if (f < 0) continue;
		int sy = ScreenY(e->y);
		if (e->dying) {
			// topple and shrink: sink the sprite and blink it out
			if ((e->dying >> 1) & 1) continue;
			sy += e->dying / 2;
		}
		DrawFrame(f, sx, sy, e->flash > 0 ? PF2_LIGHT : 0);
	}
	PT(2);
	// the wanderer and the scarf
	BOOL blink = p->invuln > 0 && !p->dead && ((p->invuln * 14 / 50) & 1) == 0;
	if (!blink) {
		WORD xy[16];
		for (int i = 0; i < 8; i++) { xy[i * 2] = (WORD)ScreenX(p->scarfX[i]); xy[i * 2 + 1] = (WORD)ScreenY(p->scarfY[i]); }
		DrawPolyline(xy, 8, PF2_RED);
		PT(3);
		DrawFrame(PlayerFrame(p), ScreenX(p->x), ScreenY(p->y), 0);
	}
	PT(4);
	// sparks and dust
	for (int i = 0; i < MAX_PARTICLES; i++) {
		Particle *q = &G.parts[i];
		if (q->life <= 0) continue;
		int x = ScreenX(q->x), y = ScreenY(q->y);
		if (q->big && q->life > q->maxLife / 2) PlotBlock2(x, y, q->color);
		else PlotPixel(x, y, q->color);
	}
	PT(5);
}
