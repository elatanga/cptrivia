import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Minus, Maximize2, Minimize2, UserPlus, ShieldAlert, Star } from 'lucide-react';
import { Player, BoardViewSettings, PlayMode, Team, TeamPlayStyle } from '../types';
import { soundService } from '../services/soundService';
import { logger } from '../services/logger';
import { getScoreboardLayoutTokens, sanitizeBoardViewSettings } from '../services/boardViewSettings';
import { useViewportWidth } from '../hooks/useViewportWidth';

interface Props {
  players: Player[];
  teams?: Team[];
  playMode?: PlayMode;
  teamPlayStyle?: TeamPlayStyle;
  sessionTimerActive?: boolean;
  sessionTimeRemaining?: number;
  selectedPlayerId: string | null;
  onAddPlayer: (name: string) => void;
  onUpdateScore: (id: string, delta: number) => void;
  onSelectPlayer: (id: string) => void;
  gameActive: boolean;
  viewSettings: BoardViewSettings;
}

export const Scoreboard: React.FC<Props> = ({ 
  players,
  teams = [],
  playMode = 'INDIVIDUALS',
  teamPlayStyle = 'TEAM_PLAYS_AS_ONE',
  sessionTimerActive = false,
  sessionTimeRemaining,
  selectedPlayerId,
  onAddPlayer,
  onUpdateScore,
  onSelectPlayer,
  gameActive,
  viewSettings
}) => {
  const [newName, setNewName] = useState('');
  const [isCondensed, setIsCondensed] = useState(false);

  const safeViewSettings = useMemo(() => sanitizeBoardViewSettings(viewSettings), [viewSettings]);
  const viewportWidth = useViewportWidth();
  const layoutTokens = useMemo(() => getScoreboardLayoutTokens(safeViewSettings, viewportWidth), [safeViewSettings, viewportWidth]);

  const playerCount = players.length;
  const teamCount = teams.length;
  const displayCount = playMode === 'TEAMS' ? teamCount : playerCount;
  const is2Col = displayCount >= 5 && !isCondensed && layoutTokens.allowTwoColumn;

  useEffect(() => {
    logger.info("scoreboard_layout", {
      ts: new Date().toISOString(),
      playerCount,
      teamCount,
      playMode,
      layoutMode: is2Col ? "grid-2col" : "list-1col",
      scoreboardScale: safeViewSettings.scoreboardScale || 1.0,
      viewport: { w: window.innerWidth, h: window.innerHeight }
    });
  }, [playerCount, teamCount, playMode, is2Col, safeViewSettings.scoreboardScale]);

  const handleAddManual = () => {
    if (newName.trim()) {
      soundService.playClick();
      onAddPlayer(newName);
      setNewName('');
    }
  };

  const getWildcardStars = (used: number = 0) => {
    if (used <= 0) return null;
    const color = used >= 4 ? '#FFD400' : '#FF8A00'; // Yellow for Max, Orange for 1-3
    return (
      <span style={{ color }} className="font-mono text-[10px] md:text-sm drop-shadow-sm tracking-tighter">
        {'★'.repeat(used)}
      </span>
    );
  };

  const scoreboardStyles = {
    '--scoreboard-scale': layoutTokens.scoreboardScale,
    '--name-font-px': `${layoutTokens.playerNameFontPx}px`,
    '--sb-score-font-px': `${layoutTokens.scoreFontPx}px`,
    '--badge-font-px': `${layoutTokens.badgeFontPx}px`,
    '--scoreboard-panel-width': layoutTokens.panelWidthCss,
  } as React.CSSProperties;

  const formattedSessionTime = `${Math.floor((sessionTimeRemaining || 0) / 60)}:${String((sessionTimeRemaining || 0) % 60).padStart(2, '0')}`;

  return (
    <div 
      className="h-auto lg:h-full grid grid-rows-[auto_1fr_auto] border-t lg:border-t-0 lg:border-l border-gold-900/30 bg-black/95 w-full lg:w-[var(--scoreboard-panel-width)] shadow-2xl z-20 font-sans font-bold select-none transition-all duration-300 overflow-hidden"
      style={scoreboardStyles}
      data-testid="scoreboard-root"
      data-layout={is2Col ? "grid-2col" : "list-1col"}
    >
      <div className="flex-none p-3 border-b border-gold-900/30 bg-zinc-900/50 z-10">
        {sessionTimerActive && sessionTimeRemaining !== undefined && (
          <div
            data-testid="scoreboard-session-timer"
            className="mb-3 rounded-xl border border-red-500/40 bg-black/50 px-3 py-2 text-center shadow-[0_0_20px_rgba(239,68,68,0.22)]"
          >
            <div className="text-[9px] md:text-[10px] uppercase tracking-[0.2em] font-black text-zinc-400">Session Timer</div>
            <div className="text-2xl md:text-3xl font-black font-mono leading-none tabular-nums text-red-400 drop-shadow-[0_0_10px_rgba(248,113,113,0.45)]">
              {formattedSessionTime}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <h3 className="text-gold-500 tracking-widest text-[10px] md:text-xs uppercase font-black">
            {playMode === 'TEAMS' ? `TEAMS (${displayCount})` : `CONTESTANTS (${displayCount})`}
          </h3>
          <button
            onClick={() => { soundService.playClick(); setIsCondensed(!isCondensed); }}
            className="lg:hidden text-zinc-500 hover:text-gold-500 p-1 rounded hover:bg-zinc-800 transition-colors"
          >
            {isCondensed ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
          </button>
        </div>
      </div>

      <div className="relative flex-1 p-2 md:p-3 overflow-hidden min-h-0">
        <div 
          className={`grid gap-2 h-full w-full items-stretch ${is2Col ? 'grid-cols-2' : 'grid-cols-1'}`}
          style={{ 
            gridTemplateRows: `repeat(${is2Col ? Math.ceil(displayCount / 2) : Math.max(1, displayCount)}, minmax(0, 1fr))`
          }}
        >
          {playMode === 'INDIVIDUALS' && players.map(p => {
            const isSelected = p.id === selectedPlayerId;
            const displayName = (p.name || "").toUpperCase();
            const stealsCount = p.stealsCount || 0;
            const specialMovesUsedCount = p.specialMovesUsedCount || 0;

            return (
              <div 
                key={p.id} 
                onClick={() => onSelectPlayer(p.id)}
                className={`relative px-3 rounded border transition-all duration-200 cursor-pointer group flex items-center justify-between min-w-0 h-full ${isSelected ? 'bg-gold-900/30 border-gold-500 shadow-[0_0_15px_rgba(255,215,0,0.2)] scale-[1.01]' : 'bg-zinc-900/40 border-zinc-800 hover:border-zinc-600'}`}
              >
                <div className="flex flex-col min-w-0 flex-1 mr-2 overflow-hidden">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span 
                      className="truncate font-roboto-bold tracking-wide uppercase transition-colors" 
                      style={{ fontSize: 'var(--name-font-px)', color: isSelected ? 'white' : 'rgb(161 161 170)' }}
                    >
                      {displayName}
                    </span>
                    {stealsCount > 0 && (
                      <span className="bg-purple-900/40 border border-purple-500/30 text-purple-400 font-black px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ fontSize: 'var(--badge-font-px)' }}>
                        S {stealsCount}
                      </span>
                    )}
                    {specialMovesUsedCount > 0 && (
                      <span className="bg-red-900/40 border border-red-500/30 text-red-300 font-black px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ fontSize: 'var(--badge-font-px)' }} title={(p.specialMovesUsedNames || []).join(', ')}>
                        SM {specialMovesUsedCount}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 h-3">
                    {getWildcardStars(p.wildcardsUsed)}
                  </div>
                </div>
                
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono font-black text-gold-400 drop-shadow-md" style={{ fontSize: 'var(--sb-score-font-px)' }}>{p.score}</span>
                </div>

                {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-gold-500 rounded-l animate-pulse" />}
              </div>
            );
          })}

          {playMode === 'TEAMS' && teams.map((team) => {
            const isSelected = team.id === selectedPlayerId;
            const displayName = (team.name || '').toUpperCase();
            const activeMemberId = team.activeMemberId;
            const members = team.members || [];

            return (
              <div
                key={team.id}
                onClick={() => onSelectPlayer(team.id)}
                className={`relative px-3 py-2 rounded border transition-all duration-200 cursor-pointer group flex flex-col justify-between min-w-0 h-full ${isSelected ? 'bg-gold-900/30 border-gold-500 shadow-[0_0_15px_rgba(255,215,0,0.2)] scale-[1.01]' : 'bg-zinc-900/40 border-zinc-800 hover:border-zinc-600'}`}
              >
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="truncate font-roboto-bold tracking-wide uppercase transition-colors"
                        style={{ fontSize: 'var(--name-font-px)', color: isSelected ? 'white' : 'rgb(161 161 170)' }}
                      >
                        {displayName}
                      </span>
                      <span className="bg-blue-900/40 border border-blue-500/30 text-blue-300 font-black px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ fontSize: 'var(--badge-font-px)' }}>
                        TEAM
                      </span>
                      {teamPlayStyle === 'TEAM_MEMBERS_TAKE_TURNS' && (
                        <span className="bg-purple-900/40 border border-purple-500/30 text-purple-300 font-black px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ fontSize: 'var(--badge-font-px)' }}>
                          TURN MODE
                        </span>
                      )}
                    </div>

                    {teamPlayStyle === 'TEAM_PLAYS_AS_ONE' && members.length > 0 && (
                      <div className="text-[10px] text-zinc-500 uppercase truncate">
                        {members.map((member) => member.name).join(' • ')}
                      </div>
                    )}

                    {teamPlayStyle === 'TEAM_MEMBERS_TAKE_TURNS' && members.length > 0 && (
                      <div className="mt-1 space-y-1">
                        {members.map((member) => {
                          const isActiveMember = member.id === activeMemberId;
                          return (
                            <div key={member.id} className={`flex items-center justify-between text-[10px] rounded px-1 py-0.5 ${isActiveMember ? 'bg-gold-900/30 border border-gold-700/30' : ''}`}>
                              <div className="truncate uppercase text-zinc-300 flex items-center gap-1">
                                <span className="truncate">{member.name}</span>
                                {isActiveMember && <span className="text-gold-400 font-black">ACTIVE</span>}
                              </div>
                              <span className="font-mono text-zinc-200">{Number(member.score || 0)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="font-mono font-black text-gold-400 drop-shadow-md" style={{ fontSize: 'var(--sb-score-font-px)' }}>{Number(team.score || 0)}</div>
                    <div className="text-[9px] text-zinc-500 uppercase">{members.length} members</div>
                  </div>
                </div>

                {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-gold-500 rounded-l animate-pulse" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};