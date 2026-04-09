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
  const topPlacements = result.placements || [];
  const winnerPlacement = topPlacements[0];
  const secondaryPlacements = topPlacements.slice(1, 3);

  const renderStats = (stats: {
    questionsAnswered: number;
    stealsMade: number;
    bonusMovesGot: number;
    lostOrVoided: number;
  }) => (
    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] uppercase tracking-wider font-black">
      <div className="rounded border border-zinc-700 bg-zinc-900/70 px-2 py-1 text-zinc-300">Questions: <span className="text-gold-400">{stats.questionsAnswered}</span></div>
      <div className="rounded border border-zinc-700 bg-zinc-900/70 px-2 py-1 text-zinc-300">Steals: <span className="text-gold-400">{stats.stealsMade}</span></div>
      <div className="rounded border border-zinc-700 bg-zinc-900/70 px-2 py-1 text-zinc-300">Bonus: <span className="text-gold-400">{stats.bonusMovesGot}</span></div>
      <div className="rounded border border-zinc-700 bg-zinc-900/70 px-2 py-1 text-zinc-300">Lost/Voided: <span className="text-gold-400">{stats.lostOrVoided}</span></div>
    </div>
  );

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
              {winnerPlacement && (
                <div className="rounded-xl border border-gold-500/35 bg-black/45 p-4 md:p-5 shadow-[inset_0_0_25px_rgba(255,193,7,0.08)] text-left">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-gold-500/80 font-black">Winner</div>
                  <div className="mt-1 text-lg md:text-3xl font-black text-white tracking-wider break-words">{winnerPlacement.name}</div>
                  <div className="mt-2 text-gold-400 font-mono font-black text-base md:text-xl">
                    {result.scoreLabel}: {winnerPlacement.score}
                  </div>
                  {renderStats(winnerPlacement.stats)}
                </div>
              )}

              {secondaryPlacements.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2 text-left">
                  {secondaryPlacements.map((placement) => (
                    <div
                      key={placement.id}
                      className="rounded-xl border border-zinc-700 bg-black/35 p-4"
                    >
                      <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400 font-black">
                        {placement.rank === 2 ? '2nd Place' : '3rd Place'}
                      </div>
                      <div className="mt-1 text-sm md:text-xl font-black text-zinc-100 break-words">{placement.name}</div>
                      <div className="mt-1 text-gold-400 font-mono font-black">{result.scoreLabel}: {placement.score}</div>
                      {renderStats(placement.stats)}
                    </div>
                  ))}
                </div>
              )}

              {result.mode === 'single-player' && result.singlePlayerOutcome && (
                <div className={`rounded-xl border px-4 py-3 text-xs uppercase tracking-widest font-black ${result.singlePlayerOutcome === 'victory' ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300' : 'border-red-500/40 bg-red-950/30 text-red-300'}`}>
                  {result.singlePlayerOutcome === 'victory' ? 'Quick Mode Result: Victory (8 of 10 minimum reached)' : 'Quick Mode Result: Loss (below 8 of 10 correct)'}
                </div>
              )}

              {result.teamPlacements.length > 0 && (
                <div className="rounded-xl border border-zinc-700 bg-black/30 p-4 text-left">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400 font-black mb-3">Team Mode Standings</div>
                  <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                    {result.teamPlacements.map((team) => (
                      <div key={team.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs md:text-sm font-black text-white uppercase">#{team.rank} {team.name}</div>
                          <div className="font-mono font-black text-gold-400">{team.score}</div>
                        </div>
                        {renderStats(team.stats)}
                        <div className="mt-2 space-y-1">
                          {team.members.map((member) => (
                            <div key={member.id} className="rounded border border-zinc-800 bg-black/40 px-2 py-1">
                              <div className="flex items-center justify-between text-[10px] uppercase font-black text-zinc-300">
                                <span>{member.name}</span>
                                <span className="font-mono text-gold-400">{member.score}</span>
                              </div>
                              {renderStats(member.stats)}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-3">
                {result.winners.length > 1 && result.winners.map((winner) => (
                  <div key={winner.id} className="rounded-lg border border-gold-500/25 bg-black/35 p-3 text-left">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-gold-500/80 font-black">Co-Winner</div>
                    <div className="text-sm md:text-lg font-black text-white break-words">{winner.name}</div>
                    <div className="text-gold-400 font-mono font-black text-sm">{result.scoreLabel}: {winner.score}</div>
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

