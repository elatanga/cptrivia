import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEffectiveSoundVolume, soundService } from './soundService';
import { SoundBoardState } from '../types';

describe('soundService volume propagation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('computes effective volume from master and per-sound controls', () => {
    const state = {
      masterEnabled: true,
      masterMuted: false,
      masterVolume: 0.5,
      sounds: {
        award: { enabled: true, muted: false, volume: 0.4 },
      },
    } as unknown as SoundBoardState;

    expect(getEffectiveSoundVolume('award', state)).toBe(0.2);

    state.masterMuted = true;
    expect(getEffectiveSoundVolume('award', state)).toBe(0);
  });

  it('routes aliased sounds through their own key so per-sound volume applies', () => {
    const playSelectSpy = vi.spyOn(soundService, 'playSelect').mockImplementation(() => {});
    const playClickSpy = vi.spyOn(soundService, 'playClick').mockImplementation(() => {});
    const playAlarmSpy = vi.spyOn(soundService, 'playTimerAlarm').mockImplementation(() => {});

    soundService.playSound('tileOpen');
    soundService.playSound('modalOpen');
    soundService.playSound('sessionCue');

    expect(playSelectSpy).toHaveBeenCalledWith('tileOpen');
    expect(playClickSpy).toHaveBeenCalledWith('modalOpen');
    expect(playAlarmSpy).toHaveBeenCalledWith('sessionCue');
  });

  it('uses a lower default volume for award sound', () => {
    const snapshot = soundService.getSoundBoardState();
    expect(snapshot.sounds.award.volume).toBeLessThan(1);
  });
});

