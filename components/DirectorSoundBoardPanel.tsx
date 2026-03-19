import React, { useEffect, useMemo, useState } from 'react';
import { Volume2, VolumeX, Play, Minus, Plus, Power } from 'lucide-react';
import { SoundBoardState, SoundCategory } from '../types';
import { soundService } from '../services/soundService';

const FALLBACK_STATE: SoundBoardState = {
  masterEnabled: true,
  masterMuted: false,
  masterVolume: 0.5,
  sounds: {} as SoundBoardState['sounds']
};

const getSnapshot = (): SoundBoardState => {
  const svc = soundService as any;
  if (typeof svc.getSoundBoardState === 'function') {
    return svc.getSoundBoardState();
  }
  return FALLBACK_STATE;
};

const CATEGORY_LABELS: Record<SoundCategory, string> = {
  TIMERS: 'Timer Sounds',
  GAMEPLAY: 'Gameplay Sounds',
  UI: 'Board & UI Sounds',
  SYSTEM: 'System Sounds'
};

const ORDERED_CATEGORIES: SoundCategory[] = ['TIMERS', 'GAMEPLAY', 'UI', 'SYSTEM'];

const percent = (value: number) => `${Math.round(value * 100)}%`;

const statusLabel = (state: SoundBoardState) => {
  if (!state.masterEnabled) return 'MASTER OFF';
  if (state.masterMuted || state.masterVolume <= 0) return 'MASTER MUTED';
  return `LIVE ${percent(state.masterVolume)}`;
};

export const DirectorSoundBoardPanel: React.FC = () => {
  const svc = soundService as any;
  const [state, setState] = useState<SoundBoardState>(() => getSnapshot());

  useEffect(() => {
    if (typeof svc.subscribe !== 'function') {
      setState(getSnapshot());
      return;
    }
    const unsubscribe = svc.subscribe((next: SoundBoardState) => setState(next));
    setState(getSnapshot());
    return unsubscribe;
  }, [svc]);

  const definitions = useMemo(() => {
    if (typeof svc.getSoundDefinitions === 'function') {
      return svc.getSoundDefinitions();
    }
    return [];
  }, [svc]);

  const grouped = useMemo(() => {
    const byCategory = new Map<SoundCategory, typeof definitions>();
    ORDERED_CATEGORIES.forEach((category) => byCategory.set(category, []));
    definitions.forEach((definition: any) => {
      const bucket = byCategory.get(definition.category);
      if (bucket) bucket.push(definition);
    });
    return byCategory;
  }, [definitions]);

  const audioReady = typeof svc.isSoundAvailable === 'function' ? svc.isSoundAvailable() : false;

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-7xl mx-auto">
      <div className="bg-zinc-900/40 p-5 rounded-2xl border border-zinc-800 shadow-lg">
        <h3 className="text-gold-500 font-black uppercase tracking-widest text-xs flex items-center gap-2">
          <Volume2 className="w-4 h-4" /> Sound Board
        </h3>
        <p className="text-[10px] text-zinc-500 uppercase font-bold mt-1 tracking-wider">Global production-safe audio controls for all gameplay and UI sounds.</p>
      </div>

      <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[10px] uppercase tracking-widest font-black text-gold-300">Master Sound</div>
          <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${state.masterEnabled && !state.masterMuted ? 'border-green-600/40 text-green-300 bg-green-900/20' : 'border-zinc-700 text-zinc-300 bg-black/40'}`}>
            {statusLabel(state)}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[auto_auto_1fr_auto_auto] items-center">
          <button
            onClick={() => svc.setMasterSoundEnabled?.(!state.masterEnabled)}
            className={`px-3 py-2 rounded-lg text-[11px] font-black uppercase ${state.masterEnabled ? 'bg-gold-600 text-black' : 'bg-zinc-700 text-zinc-200'}`}
          >
            <span className="inline-flex items-center gap-2"><Power className="w-3 h-3" /> {state.masterEnabled ? 'Master On' : 'Master Off'}</span>
          </button>

          <button
            onClick={() => svc.setMasterMuted?.(!state.masterMuted)}
            className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[11px] font-black uppercase"
          >
            {state.masterMuted ? 'Unmute Master' : 'Mute Master'}
          </button>

          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.masterVolume}
            onChange={(e) => svc.setMasterVolume?.(parseFloat(e.target.value))}
            className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-gold-500"
            aria-label="Master volume"
          />

          <button onClick={() => svc.decreaseMasterVolume?.()} className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[11px] font-black uppercase">Volume -</button>
          <button onClick={() => svc.increaseMasterVolume?.()} className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[11px] font-black uppercase">Volume +</button>
        </div>

        <div className="text-[11px] text-zinc-300 font-black uppercase tracking-wide">
          Master Volume: {percent(state.masterVolume)}
          <span className="ml-3 text-zinc-500">Audio Engine: {audioReady ? 'Ready' : 'Unavailable'}</span>
        </div>
      </div>

      {ORDERED_CATEGORIES.map((category) => {
        const defs = grouped.get(category) || [];
        if (defs.length === 0) return null;

        return (
          <div key={category} className="bg-black/40 border border-zinc-800 rounded-2xl p-5">
            <h4 className="text-[10px] uppercase tracking-widest font-black text-zinc-400 mb-4">{CATEGORY_LABELS[category]}</h4>
            <div className="space-y-3">
              {defs.map((def) => {
                const sound = state.sounds[def.key];
                if (!sound) return null;

                return (
                  <div key={def.key} className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-3 grid gap-2 lg:grid-cols-[minmax(170px,1fr)_auto_auto_1fr_auto_auto_auto] lg:items-center">
                    <div className="text-sm font-black text-zinc-100 uppercase tracking-wide">{def.label}</div>

                    <button
                      onClick={() => svc.setSoundEnabled?.(def.key, !sound.enabled)}
                      className={`px-3 py-1.5 rounded text-[10px] font-black uppercase ${sound.enabled ? 'bg-cyan-600 text-black' : 'bg-zinc-700 text-zinc-200'}`}
                    >
                      {sound.enabled ? 'Enabled' : 'Disabled'}
                    </button>

                    <button
                      onClick={() => svc.setSoundMuted?.(def.key, !sound.muted)}
                      className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[10px] font-black uppercase inline-flex items-center justify-center gap-1"
                    >
                      {sound.muted ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                      {sound.muted ? 'Unmute' : 'Mute'}
                    </button>

                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={sound.volume}
                      onChange={(e) => svc.setSoundVolume?.(def.key, parseFloat(e.target.value))}
                      className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                      aria-label={`${def.label} volume`}
                    />

                    <button onClick={() => svc.decreaseSoundVolume?.(def.key)} className="px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[10px] font-black uppercase inline-flex items-center gap-1"><Minus className="w-3 h-3" /> Vol</button>
                    <button onClick={() => svc.increaseSoundVolume?.(def.key)} className="px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[10px] font-black uppercase inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Vol</button>

                    <button
                      onClick={() => svc.previewSound?.(def.key)}
                      className="px-3 py-1.5 rounded bg-gold-600/90 hover:bg-gold-500 text-black text-[10px] font-black uppercase inline-flex items-center justify-center gap-1"
                      title={`Preview ${def.label}`}
                    >
                      <Play className="w-3 h-3" /> Test
                    </button>

                    <div className="lg:col-span-7 text-[10px] uppercase tracking-wider font-black text-zinc-500">
                      {sound.enabled ? 'ON' : 'OFF'} / {sound.muted ? 'MUTED' : 'LIVE'} / Volume {percent(sound.volume)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

