import React from 'react';
import { Crown, Sparkles, Trophy, X } from 'lucide-react';
import { soundService } from '../services/soundService';
import { EndGameCelebrationResult } from '../services/endGameCelebration';

interface Props {
  isOpen: boolean;
  result: EndGameCelebrationResult;
  onClose: () => void;
}

const iconByMode = {
  'single-player': Sparkles,
  winner: Trophy,
  tie: Crown,
  'no-players': Sparkles,
} as const;

export const EndGameCelebrationModal: React.FC<Props> = ({ isOpen, result, onClose }) => {
  if (!isOpen) return null;

  const Icon = iconByMode[result.mode];

  return (
    <div className="fixed inset-0 z-[100000] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="w-full max-w-2xl relative overflow-hidden rounded-2xl border border-gold-500/40 bg-gradient-to-b from-zinc-950 via-zinc-900 to-black shadow-[0_0_50px_rgba(255,193,7,0.2)] animate-in zoom-in-95 duration-300">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,215,0,0.16),_transparent_55%)]" />
        <button
          onClick={() => {
            soundService.playClick();
            onClose();
          }}
          className="absolute right-4 top-4 z-20 rounded-full border border-zinc-700 bg-black/40 p-2 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
          aria-label="Close celebration modal"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="relative z-10 p-6 md:p-10 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-gold-500/50 bg-gold-500/10">
            <Icon className="w-7 h-7 text-gold-400" />
          </div>

          <p className="text-[10px] tracking-[0.25em] uppercase font-black text-gold-500/80">{result.subtitle}</p>
          <h2 className="mt-2 text-2xl md:text-4xl font-black tracking-wide text-gold-300">{result.title}</h2>

          {result.mode === 'no-players' ? (
            <p className="mt-5 text-zinc-300">All board tiles are resolved.</p>
          ) : (
            <div className="mt-6 space-y-4">
              <div className="grid gap-3">
                {result.winners.map((winner) => (
                  <div
                    key={winner.id}
                    className="rounded-xl border border-gold-500/35 bg-black/45 p-4 md:p-5 shadow-[inset_0_0_25px_rgba(255,193,7,0.08)]"
                  >
                    <div className="text-lg md:text-3xl font-black text-white tracking-wider break-words">{winner.name}</div>
                    <div className="mt-2 text-gold-400 font-mono font-black text-base md:text-xl">
                      {result.scoreLabel}: {winner.score}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => {
              soundService.playClick();
              onClose();
            }}
            className="mt-8 w-full md:w-auto md:min-w-48 rounded-xl bg-gold-600 hover:bg-gold-500 text-black font-black uppercase tracking-wider text-xs px-6 py-3 shadow-xl shadow-gold-900/30 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

