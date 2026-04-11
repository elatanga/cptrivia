import React, { useEffect, useMemo, useRef } from 'react';
import { Zap } from 'lucide-react';
import { Category, BoardViewSettings } from '../types';
import { soundService } from '../services/soundService';
import { logger } from '../services/logger';
import { getTriviaBoardLayoutTokens, sanitizeBoardViewSettings } from '../services/boardViewSettings';
import { SMSOverlayDoc } from '../modules/specialMoves/firestoreTypes';
import { useViewportWidth } from '../hooks/useViewportWidth';
import { getTileSpecialMoveTagState, getTileSpecialMoveTagText } from '../modules/specialMoves/tileTagState';

interface Props {
  categories: Category[];
  onSelectQuestion: (catId: string, qId: string) => void;
  viewSettings: BoardViewSettings;
  overlay?: SMSOverlayDoc | null;
  resolvedSpecialMoveTileIds?: Set<string>;
  resolvedSpecialMoveLabelsByTileId?: Record<string, string>;
}

export const GameBoard: React.FC<Props> = ({ categories, onSelectQuestion, viewSettings, overlay, resolvedSpecialMoveTileIds, resolvedSpecialMoveLabelsByTileId }) => {
  const onSelectQuestionRef = useRef(onSelectQuestion);

  useEffect(() => {
    logger.info("trivia_board_theme_updated", { backgroundTheme: "luxury_light", atIso: new Date().toISOString() });
  }, []);

  useEffect(() => {
    onSelectQuestionRef.current = onSelectQuestion;
  }, [onSelectQuestion]);

  const safeViewSettings = useMemo(() => sanitizeBoardViewSettings(viewSettings), [viewSettings]);
  const viewportWidth = useViewportWidth();

  const colCount = categories.length;
  const rowCount = categories[0]?.questions.length || 5;

  const layoutTokens = useMemo(() => getTriviaBoardLayoutTokens(safeViewSettings, viewportWidth, rowCount), [safeViewSettings, viewportWidth, rowCount]);

  const boardStyles = {
    '--cat-font-px': `${layoutTokens.categoryTitleFontPx}px`,
    '--tile-scale-factor': layoutTokens.tileScaleFactor,
    '--tile-padding-scale': layoutTokens.tilePaddingScale,
    '--board-gap-px': `${layoutTokens.boardGapPx}px`,
    '--tile-min-w-px': `${layoutTokens.tileMinWidthPx}px`,
    '--tile-min-h-px': `${layoutTokens.tileMinHeightPx}px`,
    '--tile-point-font-px': `${layoutTokens.tilePointFontPx}px`,
    '--cat-min-h-px': `${layoutTokens.categoryMinHeightPx}px`,
    '--cat-line-height': layoutTokens.categoryTitleLineHeight,
    '--cat-padding-px': `${layoutTokens.categoryPaddingPx}px`,
    '--tile-inner-padding-px': `${layoutTokens.tileInnerPaddingPx}px`,
  } as React.CSSProperties;

  const boardGrid = useMemo(() => (
    <div 
      className="flex-1 grid w-full h-full min-h-0 min-w-0"
      style={{ 
        gap: 'var(--board-gap-px)',
        gridTemplateColumns: `repeat(${colCount}, minmax(var(--tile-min-w-px), 1fr))`,
        gridTemplateRows: `auto repeat(${rowCount}, minmax(var(--tile-min-h-px), 1fr))`
      }}
    >
      {categories.map((cat) => (
        <div 
          key={cat.id} 
          className="bg-navy-900 flex items-center justify-center rounded shadow-xl border-b-4 border-black/20 text-center relative overflow-hidden group"
          style={{ minHeight: 'var(--cat-min-h-px)' }}
        >
            <h3 
              className="text-white uppercase break-words w-full tracking-wide font-black"
              style={{
                fontSize: 'var(--cat-font-px)',
                lineHeight: 'var(--cat-line-height)',
                padding: 'var(--cat-padding-px)',
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: layoutTokens.categoryLineClamp,
                overflow: 'hidden',
              }}
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
              const overlayDeployment = overlay?.deploymentsByTileId?.[q.id];
              const moveType = (overlayDeployment?.status === 'ARMED' ? overlayDeployment.moveType : undefined) || q.specialMoveType;
              const isArmed = !!moveType;
              const isResolved = !!resolvedSpecialMoveTileIds?.has(q.id);
              const specialMoveTagState = getTileSpecialMoveTagState(!!isArmed, isResolved);
              const specialMoveTagText = getTileSpecialMoveTagText(moveType, specialMoveTagState, resolvedSpecialMoveLabelsByTileId?.[q.id]);

              return (
                <button 
                  key={q.id} 
                  disabled={!isPlayable} 
                  onClick={() => {
                    soundService.playSelect();
                    onSelectQuestionRef.current(cat.id, q.id);
                  }} 
                  className={`
                    w-full h-full flex items-center justify-center rounded border transition-all duration-200 relative overflow-hidden group min-w-0 ${isArmed && isPlayable ? 'animate-pulse' : ''}
                    ${q.isVoided 
                      ? 'bg-black/80 border-black opacity-50 cursor-not-allowed grayscale' 
                      : q.isAnswered 
                        ? 'bg-zinc-800/10 border-zinc-200 opacity-20 cursor-default shadow-inner' 
                        : 'bg-zinc-900 border-gold-600/30 text-gold-400 hover:bg-gold-600 hover:text-black hover:border-gold-500 hover:scale-[1.03] shadow-xl hover:shadow-gold-500/20 hover:z-10 cursor-pointer active:scale-95'
                    }
                  `}
                  style={{
                    minHeight: 'var(--tile-min-h-px)',
                    padding: 'var(--tile-inner-padding-px)'
                  }}
                >
                    {specialMoveBadge.showTag && (
                      <span
                        data-testid={`special-move-tile-tag-${q.id}`}
                        data-state={specialMoveTagState}
                        title={specialMoveTagText}
                        className={`absolute top-2 left-2 pointer-events-none rounded-md px-2 py-1 text-[9px] md:text-[10px] font-black uppercase tracking-[0.12em] border shadow-lg max-w-[85%] truncate ${specialMoveTagState === 'armed'
                          ? 'bg-red-600/95 text-white border-red-300/80'
                          : 'bg-zinc-800/90 text-zinc-300 border-zinc-500/60 grayscale'}`}
                      >
                        {specialMoveTagText}
                      </span>
                    )}
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
                    <span className="group-hover:scale-110 transition-transform shadow-black drop-shadow-xl font-black" style={{ fontSize: 'clamp(16px, var(--tile-point-font-px), 82px)' }}>
                      {q.points}
                    </span>
                  )}
                </button>
              );
            })}
          </React.Fragment>
      ))}
    </div>
  ), [categories, colCount, rowCount, overlay, resolvedSpecialMoveTileIds, resolvedSpecialMoveLabelsByTileId, layoutTokens.categoryLineClamp]);

  return (
    <div 
      className="h-full w-full flex flex-col p-2 md:p-4 font-roboto font-bold select-none min-h-[400px] lg:min-h-0 relative"
      style={boardStyles}
    >
      {boardGrid}
    </div>
  );
};
