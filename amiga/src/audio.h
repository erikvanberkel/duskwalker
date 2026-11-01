// Paula sound: sampled effects plus the generative music (a looped bed, a random-walk melody and its echo).
#pragma once
#include <exec/types.h>
#include "assets.h"

void AudioInit(void);
void AudioStartMusic(void);
void AudioStop(void);
void AudioSetMusic(int on);
void AudioSetBoss(int on);   // Titan fight: war drum and a busier melody
void Sfx(int sample);
void SfxSoft(int sample);   // only if the effects channel is idle (footsteps)
void AudioVBlank(void);
