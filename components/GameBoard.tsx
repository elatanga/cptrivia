
import React, { useEffect } from 'react';
import { Zap, Clock } from 'lucide-react';
import { Category, BoardViewSettings } from '../types';
import { soundService } from '../services/soundService';
import { logger } from '../services/logger';
import { getCategoryTitleFontSize, getTileScaleFactor } from '../services/utils';
import { SMSOverlayDoc } from '../modules/specialMoves/firestoreTypes';

interface Props {
  categories: Category[];
  onSelectQuestion: (catId: string, qId: string) => void;
  viewSettings: BoardViewSettings;
  overlay?: SMSOverlayDoc | null;
  sessionTimerActive?: boolean;
  sessionTimeRemaining?: number;
}

export const GameBoard: React.FC<Props> = ({ categories, onSelectQuestion, viewSettings, overlay, sessionTimerActive, sessionTimeRemaining }) => {
  useEffect(() => {
    logger.info("trivia_board_theme_updated", { backgroundTheme: "luxury_light", atIso: new Date().toISOString() });
  }, []);

  const colCount = categories.length;
  const rowCount = categories[0]?.questions.length || 5; 

  const boardStyles = {
    '--cat-font-px': `${getCategoryTitleFontSize(viewSettings?.categoryTitleScale || 'M')}px`,
    '--tile-scale-factor': getTileScaleFactor(viewSettings?.tileScale || 'M'),
    '--tile-padding-scale': viewSettings?.tilePaddingScale || 1.0,
  } as React.CSSProperties;

  return (
    <div 
      className="h-full w-full flex flex-col p-2 md:p-4 font-roboto font-bold select-none min-h-[400px] lg:min-h-0 relative"
      style={boardStyles}
    >
      {/* SESSION TIMER DISPLAY */}
      {sessionTimerActive && sessionTimeRemaining !== undefined && (
        <div className="absolute top-2 right-2 md:top-4 md:right-4 z-20 flex items-center gap-3 bg-black/70 backdrop-blur-sm border border-gold-500/40 rounded-xl px-3 md:px-5 py-2 md:py-3 shadow-xl">
          <Clock className="w-4 h-4 md:w-5 md:h-5 text-gold-500 flex-shrink-0" />
          <div className="flex flex-col items-end">
            <div className="text-[8px] md:text-[9px] uppercase tracking-widest font-black text-zinc-400">Game Time</div>
            <div className="text-lg md:text-2xl font-black font-mono tabular-nums text-gold-500 drop-shadow-lg leading-none">
              {Math.floor(sessionTimeRemaining / 60)}:{String(sessionTimeRemaining % 60).padStart(2, '0')}
            </div>
          </div>
          {sessionTimeRemaining <= 60 && (
            <div className="ml-1 w-1.5 h-1.5 md:w-2 md:h-2 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
          )}
        </div>
      )}
      <div 
        className="flex-1 grid gap-1.5 md:gap-3 w-full h-full min-h-0 min-w-0"
        style={{ 
          gridTemplateColumns: `repeat(${colCount}, minmax(72px, 1fr))`,
          gridTemplateRows: `auto repeat(${rowCount}, minmax(60px, 1fr))` 
        }}
      >
        {categories.map((cat) => (
          <div 
            key={cat.id} 
            className="bg-navy-900 flex items-center justify-center p-2 md:p-3 rounded shadow-xl border-b-4 border-black/20 text-center relative overflow-hidden group min-h-[44px]"
          >
             <h3 
                className="text-white uppercase leading-tight break-words line-clamp-2 w-full tracking-wide font-black" 
                style={{ fontSize: `var(--cat-font-px)` }} 
             >
               {cat.title}
             </h3>
          </div>
        ))}

        {Array.from({ length: rowCount }).map((_, rowIdx) => (
           <React.Fragment key={rowIdx}>
             {categories.map((cat) => {
               const q = cat.questions[rowIdx];
               if (!q) return <div key={`empty-${cat.id}-${rowIdx}`} className="bg-transparent" />;
               const isPlayable = !q.isAnswered && !q.isVoided;
               const isArmed = overlay?.deploymentsByTileId?.[q.id]?.status === 'ARMED';
               
               return (
                 <button 
                   key={q.id} 
                   disabled={!isPlayable} 
                   onClick={() => {
                     soundService.playSelect();
                     onSelectQuestion(cat.id, q.id);
                   }} 
                   className={`
                      w-full h-full flex items-center justify-center rounded border transition-all duration-200 relative overflow-hidden group min-h-[60px] min-w-0 ${isArmed && isPlayable ? 'animate-pulse' : ''}
                     ${q.isVoided 
                        ? 'bg-black/80 border-black opacity-50 cursor-not-allowed grayscale' 
                        : q.isAnswered 
                          ? 'bg-zinc-800/10 border-zinc-200 opacity-20 cursor-default shadow-inner' 
                          : 'bg-zinc-900 border-gold-600/30 text-gold-400 hover:bg-gold-600 hover:text-black hover:border-gold-500 hover:scale-[1.03] shadow-xl hover:shadow-gold-500/20 hover:z-10 cursor-pointer active:scale-95'
                     }
                   `}
                   style={{
                     padding: `calc(4px * var(--tile-padding-scale))`,
                     transform: `scale(var(--tile-scale-factor))`
                   }}
                 >
                    {isArmed && isPlayable && (
                      <span className="absolute top-2 right-2 text-gold-300 drop-shadow-md pointer-events-none">
                        <Zap className="w-4 h-4 md:w-5 md:h-5" />
                      </span>
                    )}
                   {q.isVoided ? (
                     <span className="font-mono text-red-600 font-black tracking-widest rotate-[-15deg]">VOID</span>
                   ) : q.isAnswered ? (
                     <span className="font-mono font-bold text-zinc-400">---</span> 
                   ) : (
                     <span className="group-hover:scale-110 transition-transform shadow-black drop-shadow-xl font-black" style={{ fontSize: 'clamp(16px, 2.8vw, 96px)' }}>
                       {q.points}
                     </span>
                   )}
                 </button>
               );
             })}
           </React.Fragment>
        ))}
      </div>
    </div>
  );
};
