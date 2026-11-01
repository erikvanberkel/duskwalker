// Paula playback.
//   channel 0 (left):  the music bed (drone, chord pads with their echo, kick) as one seamless loop
//   channel 1 (right): the plucked melody, a random walk over A minor pentatonic like the original
//   channel 2 (right): sound effects
//   channel 3 (left):  the melody's echo 0.42 s later (or the war drum in the Titan fight); effects take it
//                      over when channel 2 is busy with something more important
// Everything is applied in the vertical blank, so the main loop only queues requests.
#include "audio.h"
#include "hw.h"
#include "fixed.h"

#define AUD(c) (&CUSTOM->aud[c])

typedef struct { BYTE pending; UWORD sample, period; UBYTE vol; } Request;
static volatile Request req[4];

// The main loop's entry points share this state with the vertical blank interrupt: hold it off while they
// change it (the barrier stops gcc moving stores across the INTENA writes).
static inline void Lock(void) { CUSTOM->intena = INTF_VERTB; __asm__ volatile("" ::: "memory"); }
static inline void Unlock(void) { __asm__ volatile("" ::: "memory"); CUSTOM->intena = INTF_SETCLR | INTF_VERTB; }
static WORD busy[4];          // frames until an effect on the channel finishes
static UBYTE busyPrio[4];
static BYTE musicOn = 1, musicRunning, bossMode;
static UWORD step, stepT, audioFrame;
static BYTE noteIdx = 4;
static ULONG musicRng = 0x1234567;

#define MAX_ECHOES 8
static struct { UWORD due, period; UBYTE vol; } echoes[MAX_ECHOES];
static UBYTE numEchoes;

static inline const UBYTE *SampleData(int s) { extern UBYTE *assetChip; return assetChip + samples[s].off; }
static int MusicRand(int n) { musicRng = musicRng * 1103515245 + 12345; return (int)((musicRng >> 16) % n); }

static WORD FramesOf(int s, UWORD period) {
	// words * 2 samples * period clocks / 3546895 Hz * 50 frames
	return (WORD)(((ULONG)samples[s].words * 2 * period) / 70938 + 1);
}

static void Queue(int ch, int s, UWORD period, int vol) {
	req[ch].sample = (UWORD)s; req[ch].period = period; req[ch].vol = (UBYTE)vol; req[ch].pending = 1;
}

static void Echo(UWORD due, UWORD period, int vol) {
	if (numEchoes < MAX_ECHOES) { echoes[numEchoes].due = due; echoes[numEchoes].period = period; echoes[numEchoes].vol = (UBYTE)vol; numEchoes++; }
}

void Sfx(int s) {
	const Sample *sm = &samples[s];
	int ch = 2;
	Lock();
	if (busy[2] > 0 && busyPrio[2] > sm->prio) {
		if (busy[3] > 0 && busyPrio[3] > sm->prio) { Unlock(); return; }
		ch = 3;
	}
	busy[ch] = FramesOf(s, sm->period);
	busyPrio[ch] = sm->prio;
	Queue(ch, s, sm->period, sm->vol);
	Unlock();
}

// quiet incidental sounds (footsteps): only on an idle effects channel, never over anything else
void SfxSoft(int s) {
	const Sample *sm = &samples[s];
	Lock();
	if (busy[2] <= 0) { busy[2] = FramesOf(s, sm->period); busyPrio[2] = 0; Queue(2, s, sm->period, sm->vol); }
	Unlock();
}

void AudioInit(void) {
	CUSTOM->dmacon = DMAF_AUDIO;
	for (int c = 0; c < 4; c++) { AUD(c)->ac_vol = 0; busy[c] = 0; }
	CUSTOM->adkcon = 0x00ff;   // no modulation
}

static void StartBed(void) {
	step = 0; stepT = 0; numEchoes = 0;
	Queue(0, MUS_BED, samples[MUS_BED].period, MUS_BED_VOL);
}

void AudioSetMusic(int on) {
	Lock();
	musicOn = (BYTE)on;
	if (!on) {
		AUD(0)->ac_vol = 0; AUD(1)->ac_vol = 0;
		if (busy[3] <= 0) AUD(3)->ac_vol = 0;
		numEchoes = 0;
	} else if (musicRunning) StartBed();
	Unlock();
}

void AudioStartMusic(void) {
	if (musicRunning) return;
	Lock();
	musicRunning = 1;
	if (musicOn) StartBed();
	Unlock();
}

void AudioSetBoss(int on) {
	Lock();
	bossMode = (BYTE)on;
	if (on) numEchoes = 0;
	Unlock();
}

void AudioStop(void) {
	CUSTOM->dmacon = DMAF_AUDIO;
	for (int c = 0; c < 4; c++) AUD(c)->ac_vol = 0;
	musicRunning = 0;
}

static void MusicStep(void) {
	int bar = step & 15;
	BOOL strong = bar == 0 || bar == 3 || bar == 4 || bar == 6 || bar == 8 || bar == 10 || bar == 11 || bar == 14;
	// the Titan fight: a busier melody over the war drum instead of the echo
	if (MusicRand(100) < (strong ? (bossMode ? 95 : 85) : (bossMode ? 30 : 15))) {
		static const BYTE walk[7] = {-2, -1, -1, 0, 1, 1, 2};
		noteIdx = (BYTE)Clamp(noteIdx + walk[MusicRand(7)], 0, 9);
		UWORD per = pluckPeriods[(int)noteIdx];
		Queue(1, MUS_PLUCK, per, bar == 0 ? MUS_PLUCK_VOL_STRONG : MUS_PLUCK_VOL);
		if (!bossMode) {
			int v = bar == 0 ? MUS_ECHO_VOL_STRONG : MUS_ECHO_VOL;
			Echo((UWORD)(audioFrame + ECHO_FRAMES), per, v);
			Echo((UWORD)(audioFrame + 2 * ECHO_FRAMES), per, v * 38 / 100);
		}
	}
	if (bossMode && ((DRUM_PATTERN >> bar) & 1) && busy[3] <= 0)
		Queue(3, MUS_DRUM, samples[MUS_DRUM].period, (bar & 7) == 0 ? MUS_DRUM_VOL_ACCENT : MUS_DRUM_VOL);
	step++;
}

void AudioVBlank(void) {
	audioFrame++;
	// sequencer: a step every 18 frames (the bed loop is exactly 64 steps long, so they stay together)
	if (musicRunning && musicOn) {
		if (++stepT >= 18) { stepT = 0; MusicStep(); }
		for (int i = 0; i < numEchoes;) {
			if (echoes[i].due == audioFrame) {
				if (busy[3] <= 0) Queue(3, MUS_ECHO, echoes[i].period, echoes[i].vol);
				echoes[i] = echoes[--numEchoes];
			} else i++;
		}
	}
	for (int c = 0; c < 4; c++) if (busy[c] > 0) busy[c]--;

	// apply queued (re)starts: DMA off, set registers, short wait, DMA on, then loop the tail
	UWORD mask = 0;
	for (int c = 0; c < 4; c++) if (req[c].pending) mask |= (UWORD)(1 << c);
	if (!mask) return;
	CUSTOM->dmacon = mask;
	for (int c = 0; c < 4; c++) {
		if (!(mask & (1 << c))) continue;
		const Sample *s = &samples[req[c].sample];
		AUD(c)->ac_ptr = (UWORD *)SampleData(req[c].sample);
		AUD(c)->ac_len = s->words;
		AUD(c)->ac_per = req[c].period;
		AUD(c)->ac_vol = req[c].vol;
	}
	// give Paula a few raster lines to notice the DMA stop
	UWORD start = CUSTOM->vhposr & 0xff00;
	int lines = 0;
	while (lines < 4) { UWORD now = CUSTOM->vhposr & 0xff00; if (now != start) { start = now; lines++; } }
	CUSTOM->dmacon = DMAF_SETCLR | mask;
	lines = 0;
	while (lines < 2) { UWORD now = CUSTOM->vhposr & 0xff00; if (now != start) { start = now; lines++; } }
	for (int c = 0; c < 4; c++) {
		if (!(mask & (1 << c))) continue;
		const Sample *s = &samples[req[c].sample];
		if (s->loopWords) {
			AUD(c)->ac_ptr = (UWORD *)(SampleData(req[c].sample) + s->loopStart * 2);
			AUD(c)->ac_len = s->loopWords;
		} else {
			AUD(c)->ac_ptr = (UWORD *)SampleData(SILENCE);
			AUD(c)->ac_len = 2;
		}
		req[c].pending = 0;
	}
}
