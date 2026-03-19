import { SoundBoardState, SoundControlState, SoundDefinition, SoundKey } from '../types';

const SOUND_BOARD_STATE_KEY = 'cruzpham_sound_board';
const SOUND_BOARD_MASTER_ENABLED_KEY = 'cruzpham_sound_enabled';
const LEGACY_VOLUME_KEY = 'cruzpham_volume';
const LEGACY_MUTE_KEY = 'cruzpham_mute';

type SoundBoardListener = (state: SoundBoardState) => void;

const clampVolume = (value: number) => Math.max(0, Math.min(1, Number(value.toFixed(2))));

export const SOUND_DEFINITIONS: SoundDefinition[] = [
  { key: 'timerTick', label: 'Timer Tick', category: 'TIMERS' },
  { key: 'timerEnd', label: 'Timer End / Alarm', category: 'TIMERS' },
  { key: 'sessionCue', label: 'Session Timer Cue', category: 'TIMERS' },
  { key: 'steal', label: 'Steal', category: 'GAMEPLAY' },
  { key: 'award', label: 'Award', category: 'GAMEPLAY' },
  { key: 'void', label: 'Void', category: 'GAMEPLAY' },
  { key: 'reveal', label: 'Reveal', category: 'GAMEPLAY' },
  { key: 'correct', label: 'Correct', category: 'GAMEPLAY' },
  { key: 'wrong', label: 'Wrong', category: 'GAMEPLAY' },
  { key: 'buzzer', label: 'Buzzer', category: 'GAMEPLAY' },
  { key: 'doubleOrNothing', label: 'Double Or Nothing', category: 'GAMEPLAY' },
  { key: 'click', label: 'UI Click', category: 'UI' },
  { key: 'select', label: 'UI Select', category: 'UI' },
  { key: 'tileOpen', label: 'Tile Open', category: 'UI' },
  { key: 'modalOpen', label: 'Modal Open', category: 'UI' },
  { key: 'toastSuccess', label: 'Toast Success', category: 'SYSTEM' },
  { key: 'toastError', label: 'Toast Error', category: 'SYSTEM' },
  { key: 'toastInfo', label: 'Toast Info', category: 'SYSTEM' }
];

const DEFAULT_SOUND_CONTROL: SoundControlState = {
  enabled: true,
  muted: false,
  volume: 1
};

const buildDefaultSoundBoardState = (): SoundBoardState => {
  const sounds = SOUND_DEFINITIONS.reduce((acc, def) => {
    acc[def.key] = { ...DEFAULT_SOUND_CONTROL };
    return acc;
  }, {} as Record<SoundKey, SoundControlState>);

  return {
    masterEnabled: true,
    masterMuted: false,
    masterVolume: 0.5,
    sounds
  };
};

class SoundService {
  private ctx: AudioContext | null = null;
  private soundBoard: SoundBoardState = buildDefaultSoundBoardState();
  private listeners = new Set<SoundBoardListener>();

  constructor() {
    try {
      this.restoreSettings();

      const AudioCtor = (window.AudioContext || (window as any).webkitAudioContext);
      if (AudioCtor) {
        this.ctx = new AudioCtor();
      }

      if (typeof window !== 'undefined') {
        window.addEventListener('storage', this.handleStorageSync);
      }
    } catch (e) {
      console.warn('Web Audio API not supported');
    }
  }

  private restoreSettings() {
    const savedStateRaw = localStorage.getItem(SOUND_BOARD_STATE_KEY);
    const savedVol = localStorage.getItem(LEGACY_VOLUME_KEY);
    const savedMute = localStorage.getItem(LEGACY_MUTE_KEY);
    const savedMasterEnabled = localStorage.getItem(SOUND_BOARD_MASTER_ENABLED_KEY);

    const nextState = buildDefaultSoundBoardState();

    if (savedStateRaw) {
      try {
        const parsed = JSON.parse(savedStateRaw) as Partial<SoundBoardState>;
        if (typeof parsed.masterEnabled === 'boolean') nextState.masterEnabled = parsed.masterEnabled;
        if (typeof parsed.masterMuted === 'boolean') nextState.masterMuted = parsed.masterMuted;
        if (typeof parsed.masterVolume === 'number') nextState.masterVolume = clampVolume(parsed.masterVolume);

        if (parsed.sounds && typeof parsed.sounds === 'object') {
          SOUND_DEFINITIONS.forEach(({ key }) => {
            const cfg = (parsed.sounds as any)[key];
            if (!cfg) return;
            nextState.sounds[key] = {
              enabled: typeof cfg.enabled === 'boolean' ? cfg.enabled : true,
              muted: typeof cfg.muted === 'boolean' ? cfg.muted : false,
              volume: typeof cfg.volume === 'number' ? clampVolume(cfg.volume) : 1
            };
          });
        }
      } catch {
        // Keep defaults on malformed JSON.
      }
    }

    if (savedVol !== null && !Number.isNaN(Number(savedVol))) {
      nextState.masterVolume = clampVolume(Number(savedVol));
    }
    if (savedMute !== null) {
      nextState.masterMuted = savedMute === 'true';
    }
    if (savedMasterEnabled !== null) {
      nextState.masterEnabled = savedMasterEnabled === 'true';
    }

    this.soundBoard = nextState;
    this.persistSettings();
  }

  private handleStorageSync = (event: StorageEvent) => {
    if (![SOUND_BOARD_STATE_KEY, LEGACY_MUTE_KEY, LEGACY_VOLUME_KEY, SOUND_BOARD_MASTER_ENABLED_KEY].includes(event.key || '')) {
      return;
    }
    this.restoreSettings();
    this.notify();
  };

  private persistSettings() {
    localStorage.setItem(SOUND_BOARD_STATE_KEY, JSON.stringify(this.soundBoard));
    localStorage.setItem(SOUND_BOARD_MASTER_ENABLED_KEY, String(this.soundBoard.masterEnabled));
    localStorage.setItem(LEGACY_MUTE_KEY, String(this.soundBoard.masterMuted));
    localStorage.setItem(LEGACY_VOLUME_KEY, String(this.soundBoard.masterVolume));
  }

  private notify() {
    const snapshot = this.getSoundBoardState();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private mutateState(mutator: (draft: SoundBoardState) => SoundBoardState) {
    this.soundBoard = mutator(this.getSoundBoardState());
    this.persistSettings();
    this.notify();
  }

  subscribe(listener: SoundBoardListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSoundBoardState(): SoundBoardState {
    return {
      ...this.soundBoard,
      sounds: { ...this.soundBoard.sounds }
    };
  }

  getSoundDefinitions(): SoundDefinition[] {
    return [...SOUND_DEFINITIONS];
  }

  isSoundAvailable(_key?: SoundKey): boolean {
    return !!this.ctx;
  }

  setMasterSoundEnabled(enabled: boolean) {
    this.mutateState((draft) => ({ ...draft, masterEnabled: enabled }));
  }

  setMasterMuted(muted: boolean) {
    this.mutateState((draft) => ({ ...draft, masterMuted: muted }));
  }

  setMasterVolume(volume: number) {
    this.mutateState((draft) => ({ ...draft, masterVolume: clampVolume(volume) }));
  }

  increaseMasterVolume(step = 0.1) {
    this.setMasterVolume(this.soundBoard.masterVolume + step);
  }

  decreaseMasterVolume(step = 0.1) {
    this.setMasterVolume(this.soundBoard.masterVolume - step);
  }

  setSoundEnabled(soundKey: SoundKey, enabled: boolean) {
    this.mutateState((draft) => ({
      ...draft,
      sounds: {
        ...draft.sounds,
        [soundKey]: {
          ...draft.sounds[soundKey],
          enabled
        }
      }
    }));
  }

  setSoundMuted(soundKey: SoundKey, muted: boolean) {
    this.mutateState((draft) => ({
      ...draft,
      sounds: {
        ...draft.sounds,
        [soundKey]: {
          ...draft.sounds[soundKey],
          muted
        }
      }
    }));
  }

  setSoundVolume(soundKey: SoundKey, volume: number) {
    this.mutateState((draft) => ({
      ...draft,
      sounds: {
        ...draft.sounds,
        [soundKey]: {
          ...draft.sounds[soundKey],
          volume: clampVolume(volume)
        }
      }
    }));
  }

  increaseSoundVolume(soundKey: SoundKey, step = 0.1) {
    this.setSoundVolume(soundKey, (this.soundBoard.sounds[soundKey]?.volume || 0) + step);
  }

  decreaseSoundVolume(soundKey: SoundKey, step = 0.1) {
    this.setSoundVolume(soundKey, (this.soundBoard.sounds[soundKey]?.volume || 0) - step);
  }

  private getCtx() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private getPlaybackContext(soundKey: SoundKey): { ctx: AudioContext; volume: number } | null {
    const cfg = this.soundBoard.sounds[soundKey];
    if (!this.soundBoard.masterEnabled || this.soundBoard.masterMuted) return null;
    if (!cfg || !cfg.enabled || cfg.muted) return null;

    const volume = this.soundBoard.masterVolume * cfg.volume;
    if (volume <= 0) return null;

    const ctx = this.getCtx();
    if (!ctx) return null;
    return { ctx, volume };
  }

  // Backward compatibility for existing AppShell and App code.
  getVolume() { return this.soundBoard.masterVolume; }
  getMute() { return this.soundBoard.masterMuted; }
  setMute(mute: boolean) { this.setMasterMuted(mute); }
  setVolume(vol: number) {
    this.setMasterVolume(vol);
    if (!this.soundBoard.masterMuted && Math.random() > 0.8) this.playClick();
  }

  vibrate(pattern: number | number[] = 10) {
    if (this.soundBoard.masterMuted || !this.soundBoard.masterEnabled || typeof navigator === 'undefined' || !navigator.vibrate) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignore browser-restricted vibration APIs.
    }
  }

  playSound(soundKey: SoundKey) {
    switch (soundKey) {
      case 'timerTick': this.playTimerTick(); break;
      case 'timerEnd': this.playTimerAlarm(); break;
      case 'sessionCue': this.playTimerAlarm(); break;
      case 'steal': this.playSteal(); break;
      case 'award': this.playAward(); break;
      case 'void': this.playVoid(); break;
      case 'reveal': this.playReveal(); break;
      case 'correct': this.playCorrect(); break;
      case 'wrong': this.playWrong(); break;
      case 'buzzer': this.playBuzzer(); break;
      case 'doubleOrNothing': this.playDoubleOrNothing(); break;
      case 'click': this.playClick(); break;
      case 'select': this.playSelect(); break;
      case 'tileOpen': this.playSelect(); break;
      case 'modalOpen': this.playClick(); break;
      case 'toastSuccess': this.playToast('success'); break;
      case 'toastError': this.playToast('error'); break;
      case 'toastInfo': this.playToast('info'); break;
      default: break;
    }
  }

  stopSound(_soundKey: SoundKey) {
    // One-shot synthesized sounds self-terminate; stop is a reserved API for future streamed assets.
  }

  previewSound(soundKey: SoundKey) {
    this.playSound(soundKey);
  }

  playClick() {
    const playback = this.getPlaybackContext('click');
    if (!playback) return;
    this.vibrate(5);

    const { ctx, volume } = playback;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.05);
    gain.gain.setValueAtTime(volume * 0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  playSelect() {
    const playback = this.getPlaybackContext('select');
    if (!playback) return;
    this.vibrate(10);

    const { ctx, volume } = playback;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.linearRampToValueAtTime(300, t + 0.1);
    filter.type = 'lowpass';
    filter.frequency.value = 1500;

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume * 0.15, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  playReveal() {
    const playback = this.getPlaybackContext('reveal');
    if (!playback) return;
    this.vibrate([10, 30, 10]);

    const { ctx, volume } = playback;
    const t = ctx.currentTime;
    const freqs = [523.25, 783.99, 1046.5, 1318.51];

    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume * 0.08, t + 0.1 + (i * 0.05));
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1.0);
    });

    const bufferSize = ctx.sampleRate * 0.5;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();

    noise.buffer = buffer;
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(200, t);
    noiseFilter.frequency.linearRampToValueAtTime(1200, t + 0.4);
    noiseGain.gain.setValueAtTime(volume * 0.05, t);
    noiseGain.gain.linearRampToValueAtTime(0, t + 0.4);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(t);
  }

  playAward() {
    const playback = this.getPlaybackContext('award');
    if (!playback) return;
    this.vibrate(20);

    const { ctx, volume } = playback;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'triangle';
      osc.frequency.value = freq;
      filter.type = 'lowpass';
      filter.frequency.value = 2000;

      gain.gain.setValueAtTime(0, t + (i * 0.06));
      gain.gain.linearRampToValueAtTime(volume * 0.1, t + (i * 0.06) + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + (i * 0.06) + 0.4);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1.5);
    });
  }

  playSteal() {
    const playback = this.getPlaybackContext('steal');
    if (!playback) return;
    this.vibrate([15, 5, 15]);

    const { ctx, volume } = playback;
    const t = ctx.currentTime;
    [300, 360, 420].forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.linearRampToValueAtTime(freq - 20, t + 0.5);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, t);
      filter.frequency.linearRampToValueAtTime(100, t + 0.5);

      gain.gain.setValueAtTime(volume * 0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  }

  playVoid() {
    const playback = this.getPlaybackContext('void');
    if (!playback) return;
    this.vibrate(30);

    const { ctx, volume } = playback;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'square';
    osc.frequency.setValueAtTime(100, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    filter.type = 'lowpass';
    filter.frequency.value = 200;

    gain.gain.setValueAtTime(volume * 0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  playDoubleOrNothing() {
    const playback = this.getPlaybackContext('doubleOrNothing');
    if (!playback) return;
    this.vibrate([10, 10, 10, 10, 10]);

    const { ctx, volume } = playback;
    const t = ctx.currentTime;
    [523.25, 698.46, 783.99, 1046.5].forEach((freq, i) => {
      const startTime = t + (i * 0.08);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(volume * 0.15, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.4);
    });
  }

  playTimerTick() {
    const playback = this.getPlaybackContext('timerTick');
    if (!playback) return;

    const { ctx, volume } = playback;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(800, t);
    gain.gain.setValueAtTime(volume * 0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  playTimerAlarm() {
    const playback = this.getPlaybackContext('timerEnd');
    if (!playback) return;
    this.vibrate([100, 50, 100]);

    const { ctx, volume } = playback;
    const t = ctx.currentTime;
    [0, 0.2].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, t + offset);
      osc.frequency.linearRampToValueAtTime(300, t + offset + 0.15);
      gain.gain.setValueAtTime(volume * 0.2, t + offset);
      gain.gain.linearRampToValueAtTime(0, t + offset + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + offset);
      osc.stop(t + offset + 0.2);
    });
  }

  playCorrect() {
    const playback = this.getPlaybackContext('correct');
    if (!playback) return;

    const { ctx, volume } = playback;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046.5, t);
    osc.frequency.linearRampToValueAtTime(1318.5, t + 0.1);
    gain.gain.setValueAtTime(volume * 0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  playWrong() {
    const playback = this.getPlaybackContext('wrong');
    if (!playback) return;

    const { ctx, volume } = playback;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.linearRampToValueAtTime(110, t + 0.25);
    gain.gain.setValueAtTime(volume * 0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.35);
  }

  playBuzzer() {
    const playback = this.getPlaybackContext('buzzer');
    if (!playback) return;

    const { ctx, volume } = playback;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    gain.gain.setValueAtTime(volume * 0.12, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  playToast(type: 'success' | 'error' | 'info') {
    const keyByType: Record<typeof type, SoundKey> = {
      success: 'toastSuccess',
      error: 'toastError',
      info: 'toastInfo'
    };
    const playback = this.getPlaybackContext(keyByType[type]);
    if (!playback) return;

    const { ctx, volume } = playback;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (type === 'success') {
      this.vibrate(5);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume * 0.05, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(gain);
    } else if (type === 'error') {
      this.vibrate(20);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 500;

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.linearRampToValueAtTime(100, t + 0.3);
      gain.gain.setValueAtTime(volume * 0.1, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.3);

      osc.connect(filter);
      filter.connect(gain);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, t);
      osc.frequency.linearRampToValueAtTime(800, t + 0.1);
      gain.gain.setValueAtTime(volume * 0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.connect(gain);
    }

    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  }
}

export const soundService = new SoundService();