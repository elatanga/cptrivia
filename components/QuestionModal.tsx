
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ShieldAlert, ArrowLeft, Trash2, Trophy, Eye } from 'lucide-react';
import { Question, Player, GameTimer, BoardViewSettings } from '../types';
import { QuestionModalSpecialMoveModel } from '../modules/specialMoves/modalSummary';
import { soundService } from '../services/soundService';
import { logger } from '../services/logger';
import { CountdownOverlay } from './CountdownOverlay';
import { AutoFitText } from './AutoFitText';
import { getQuestionDisplayLayoutTokens } from '../services/boardViewSettings';

const LegacyQuestionTimerBadge: React.FC<{ timer: GameTimer; onTimerEnd?: () => void }> = React.memo(({ timer, onTimerEnd }) => {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const prevTimeLeft = useRef<number | null>(null);
  // Ref tracks current timeLeft so the paused-state branch can read it
  // without `timeLeft` being a useEffect dependency (which caused the
  // interval to be torn-down and re-created on every tick).
  const timeLeftRef = useRef<number | null>(null);

  useEffect(() => {
    let interval: number;
    const updateTimer = () => {
      if (timer.endTime && timer.isRunning) {
        const remaining = Math.max(0, Math.ceil((timer.endTime - Date.now()) / 1000));
        setTimeLeft(remaining);
        timeLeftRef.current = remaining;
        if (remaining > 0 && remaining <= 5 && remaining !== prevTimeLeft.current) {
          soundService.playTimerTick();
        }
        if (remaining === 0 && prevTimeLeft.current !== 0 && prevTimeLeft.current !== null) {
          soundService.playTimerAlarm();
          if (onTimerEnd) onTimerEnd();
        }
        prevTimeLeft.current = remaining;
      } else if (timer.endTime && !timer.isRunning && timeLeftRef.current === null) {
        // Paused with an endTime set but no value yet — show the snapshot.
        const remaining = Math.max(0, Math.ceil((timer.endTime - Date.now()) / 1000));
        setTimeLeft(remaining);
        timeLeftRef.current = remaining;
      } else if (!timer.endTime) {
        setTimeLeft(null);
        timeLeftRef.current = null;
        prevTimeLeft.current = null;
      }
    };

    updateTimer();
    interval = window.setInterval(updateTimer, 200);
    return () => clearInterval(interval);
  // Removed `timeLeft` from deps: it was causing the interval to restart on
  // every tick. `timeLeftRef` provides the current value without the dep.
  }, [timer, onTimerEnd]);

  if (timeLeft === null) return null;

  return (
    <div
      className={`absolute top-6 right-6 md:top-10 md:right-10 p-2 md:p-4 rounded-full border-2 md:border-4 font-mono text-xl md:text-4xl font-black flex items-center justify-center w-12 h-12 md:w-24 md:h-24 transition-colors duration-300 bg-black/60 z-30 shadow-xl ${timeLeft <= 5 ? 'border-red-500 text-red-500 animate-pulse' : 'border-gold-500 text-gold-500'}`}
    >
      {timeLeft}
    </div>
  );
});

interface Props {
  question: Question;
  categoryTitle: string;
  players: Player[];
  selectedPlayerId: string | null;
  timer: GameTimer;
  viewSettings?: Partial<BoardViewSettings> | null;
  specialMoveSummary?: QuestionModalSpecialMoveModel | null;
  allowSteal?: boolean;
  stealDisabledReason?: string;
  questionCountdownRemainingSeconds?: number;
  questionCountdownDurationSeconds?: number;
  isQuestionCountdownRunning?: boolean;
  onQuestionCountdownRestart?: () => void;
  onQuestionCountdownStop?: () => void;
  onClose: (action: 'return' | 'void' | 'award' | 'steal', playerId?: string) => void;
  onReveal: () => void;
  onTimerEnd?: () => void;
}

export const QuestionModal: React.FC<Props> = React.memo(function QuestionModalInner({ 
  question,
  categoryTitle,
  players,
  selectedPlayerId,
  timer,
  viewSettings,
  specialMoveSummary,
  allowSteal = true,
  stealDisabledReason,
  questionCountdownRemainingSeconds,
  questionCountdownDurationSeconds,
  isQuestionCountdownRunning,
  onQuestionCountdownRestart,
  onQuestionCountdownStop,
  onClose,
  onReveal,
  onTimerEnd
}) {
  const [showStealSelect, setShowStealSelect] = useState(false);
  const loggedQuestionIdRef = useRef<string | null>(null);
  const loggedDoubleQuestionIdRef = useRef<string | null>(null);
  const playedDoubleQuestionIdRef = useRef<string | null>(null);

  const isRevealed = question.isRevealed;
  const isDouble = question.isDoubleOrNothing || false;
  const bannerTitles = useMemo(() => {
    const titles = [specialMoveSummary?.displayTitle, isDouble ? 'DOUBLE OR NOTHING' : null]
      .filter((title): title is string => Boolean(title));
    return Array.from(new Set(titles));
  }, [specialMoveSummary?.displayTitle, isDouble]);

  const answerOptions = useMemo(() => {
    const q = question as Question & { options?: string[] };
    if (!Array.isArray(q.options)) return [];
    return q.options.filter((option) => typeof option === 'string' && option.trim().length > 0).slice(0, 4);
  }, [question]);

  const displayTokens = useMemo(
    () => getQuestionDisplayLayoutTokens(viewSettings, answerOptions.length),
    [viewSettings, answerOptions.length]
  );

  const contentRegionStyle = useMemo(
    () => ({
      maxWidth: `${displayTokens.contentMaxWidthPercent}%`,
      paddingLeft: `${displayTokens.contentPaddingPx}px`,
      paddingRight: `${displayTokens.contentPaddingPx}px`,
    }),
    [displayTokens.contentMaxWidthPercent, displayTokens.contentPaddingPx]
  );

  // LOGGING & SCROLL LOCK
  useEffect(() => {
    if (loggedQuestionIdRef.current !== question.id) {
      logger.info("reveal_ui_rendered", { tileId: question.id, isDoubleOrNothing: isDouble, ts: new Date().toISOString() });
      loggedQuestionIdRef.current = question.id;
    }

    if (isDouble && loggedDoubleQuestionIdRef.current !== question.id) {
      logger.info("double_or_nothing_displayed", { tileId: question.id, ts: new Date().toISOString() });
      loggedDoubleQuestionIdRef.current = question.id;
    }

    const originalStyle = {
      overflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
    };
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    return () => {
      document.documentElement.style.overflow = originalStyle.overflow;
      document.body.style.overflow = originalStyle.bodyOverflow;
    };
  }, [question.id, isDouble]);

  useEffect(() => {
    if (isDouble && !isRevealed && playedDoubleQuestionIdRef.current !== question.id) {
      soundService.playDoubleOrNothing();
      playedDoubleQuestionIdRef.current = question.id;
    }
  }, [isDouble, isRevealed]);

  const questionContent = useMemo(() => (
    <div
      data-testid="question-viewport"
      className="w-full overflow-hidden min-h-0 flex items-center justify-center mx-auto"
      style={contentRegionStyle}
    >
      <AutoFitText
        testId="question-text"
        text={question.text}
        minFontSizePx={displayTokens.questionMinFontPx}
        maxFontSizePx={displayTokens.questionMaxFontPx}
        clampVw={displayTokens.questionClampVw}
        className={`font-roboto-bold text-center transition-[opacity,transform,filter] duration-500 max-h-full ${isRevealed ? 'opacity-40 scale-90 blur-[1px]' : 'opacity-100 scale-100'}`}
        containerClassName="w-full h-full flex items-center justify-center"
      />
    </div>
  ), [question.text, isRevealed, contentRegionStyle, displayTokens.questionMinFontPx, displayTokens.questionMaxFontPx, displayTokens.questionClampVw]);

  const answerContent = useMemo(() => (
    <div className="w-full flex flex-col items-center gap-2 md:gap-4 min-h-[3.5rem] md:min-h-[5rem] mx-auto" style={contentRegionStyle}>
      {!isRevealed && answerOptions.length > 0 && (
        <div data-testid="answer-options-grid" className={`w-full grid ${displayTokens.optionGridClass} gap-2 md:gap-3`}>
          {answerOptions.map((option, idx) => (
            <div
              key={`${option}-${idx}`}
              className="min-h-[56px] md:min-h-[74px] rounded-xl border border-zinc-700/70 bg-black/35 px-3 py-2 md:px-4 md:py-3 shadow-lg"
            >
              <AutoFitText
                testId={`answer-option-${idx}`}
                text={option}
                minFontSizePx={displayTokens.optionMinFontPx}
                maxFontSizePx={displayTokens.optionMaxFontPx}
                clampVw={displayTokens.optionClampVw}
                className="font-roboto-bold text-zinc-100 text-left"
                containerClassName="w-full h-full flex items-center"
              />
            </div>
          ))}
        </div>
      )}

      {isRevealed ? (
        <div 
          data-testid="answer-text"
          className="w-full text-center py-3 md:py-6 bg-gold-950/20 border-y border-gold-500/20 animate-in zoom-in slide-in-from-bottom duration-500 min-h-0"
        >
          <AutoFitText
            testId="answer-text-value"
            text={question.answer}
            minFontSizePx={displayTokens.answerMinFontPx}
            maxFontSizePx={displayTokens.answerMaxFontPx}
            clampVw={displayTokens.answerClampVw}
            className="text-gold-400 font-roboto-bold text-center drop-shadow-2xl"
            containerClassName="w-full"
          />
        </div>
      ) : (
        <div className="h-2 w-32 bg-zinc-800/50 rounded-full flex-none" />
      )}
    </div>
  ), [
    isRevealed,
    answerOptions,
    question.answer,
    contentRegionStyle,
    displayTokens.optionGridClass,
    displayTokens.optionMinFontPx,
    displayTokens.optionMaxFontPx,
    displayTokens.optionClampVw,
    displayTokens.answerMinFontPx,
    displayTokens.answerMaxFontPx,
    displayTokens.answerClampVw,
  ]);

  const handleAction = useCallback((action: 'reveal' | 'award' | 'steal' | 'void' | 'return', event?: React.MouseEvent | React.KeyboardEvent) => {
    if (event) {
      if ('preventDefault' in event) event.preventDefault();
      if ('stopPropagation' in event) event.stopPropagation();
    }

    if (isQuestionCountdownRunning && action !== 'return') {
      return;
    }

    if (!isRevealed && action !== 'reveal' && action !== 'return') return;
    if (showStealSelect && action !== 'return') return; 

    switch (action) {
      case 'reveal':
        if (!isRevealed) {
          onReveal();
          soundService.playReveal();
        }
        break;
      case 'award':
        if (isRevealed && selectedPlayerId) {
          soundService.playAward();
          onClose('award', selectedPlayerId);
        }
        break;
      case 'steal':
        if (isRevealed && allowSteal) {
          soundService.playSteal();
          setShowStealSelect(true);
        }
        break;
      case 'void':
        if (isRevealed) {
          if (window.confirm('Mark this question as VOID?\n\nThis will lock the tile and close the view.')) {
            soundService.playVoid();
            onClose('void');
          }
        }
        break;
      case 'return':
        if (showStealSelect) {
          setShowStealSelect(false);
        } else {
          onClose('return');
        }
        break;
    }
  }, [isRevealed, selectedPlayerId, showStealSelect, onClose, onReveal, isQuestionCountdownRunning, allowSteal]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          handleAction('reveal');
          break;
        case 'Enter':
          e.preventDefault();
          handleAction('award');
          break;
        case 'KeyS':
          e.preventDefault();
          handleAction('steal');
          break;
        case 'Escape':
          e.preventDefault();
          handleAction('void');
          break;
        case 'Backspace':
          e.preventDefault();
          handleAction('return');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAction]);

  return (
    <div 
      data-testid="reveal-root"
      className="fixed inset-0 z-[9999] bg-black text-white font-roboto overflow-hidden flex flex-col items-center justify-center p-2 md:p-4"
      style={{ height: '100dvh', maxHeight: '100dvh', overflow: 'hidden', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* QUESTION COUNTDOWN OVERLAY */}
      {isQuestionCountdownRunning && questionCountdownDurationSeconds && questionCountdownRemainingSeconds !== undefined && (
        <CountdownOverlay
          durationSeconds={questionCountdownDurationSeconds}
          remainingSeconds={questionCountdownRemainingSeconds}
          isRunning={isQuestionCountdownRunning}
          onRestart={() => onQuestionCountdownRestart && onQuestionCountdownRestart()}
          onStop={() => onQuestionCountdownStop && onQuestionCountdownStop()}
        />
      )}

      {/* Dynamic Ambient Background */}
      <div className={`absolute inset-0 opacity-20 transition-colors duration-700 pointer-events-none ${isRevealed ? (isDouble ? 'bg-red-900' : 'bg-gold-900') : 'bg-blue-900'}`} />

      {/* TOP FLOATING CONTEXT BAR (Category/Points) */}
      <div className="absolute top-0 left-0 right-0 h-16 md:h-20 flex justify-between items-center px-6 md:px-12 z-20 pointer-events-none">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest opacity-50 font-black">Category</span>
          <h3 className="font-black uppercase tracking-wider text-xs md:text-xl text-gold-500">{categoryTitle}</h3>
        </div>
        <div className="text-right">
          <span className="text-[10px] uppercase tracking-widest opacity-50 font-black">Points</span>
          <div className="text-lg md:text-3xl font-black text-white">{question.points}</div>
        </div>
      </div>

      {/* SINGLE LUXURY CENTERED CONTAINER */}
      <div 
        data-testid="luxury-container"
        className="relative z-10 w-full max-w-7xl h-[min(94dvh,920px)] max-h-[94dvh] bg-zinc-900/40 backdrop-blur-2xl border border-white/10 rounded-[2rem] md:rounded-[2.5rem] p-3 md:p-8 shadow-[0_0_100px_rgba(0,0,0,0.8)] overflow-hidden grid grid-rows-[auto_minmax(0,1fr)_auto_auto] gap-2 md:gap-4"
        style={{
          maxWidth: `${displayTokens.modalMaxWidthPx}px`,
          height: `min(94dvh, ${displayTokens.modalMaxHeightPx}px)`,
          maxHeight: '94dvh',
        }}
      >
        {/* Legacy per-question timer badge isolated from modal rendering flow */}
        <LegacyQuestionTimerBadge timer={timer} onTimerEnd={onTimerEnd} />

        {/* 1. TOP RISK/MODIFIER LABELS */}
        {bannerTitles.length > 0 && (
          <div className="flex flex-col items-center justify-center gap-2 md:gap-3 pb-1 md:pb-2">
            <div
              data-testid="special-move-banner"
              className="w-full max-w-5xl rounded-2xl border border-red-500/45 bg-gradient-to-r from-red-950/45 via-black/35 to-red-950/45 px-4 py-3 md:px-6 md:py-4 text-center shadow-[0_0_30px_rgba(239,68,68,0.18)] backdrop-blur-sm"
            >
              <div className="flex flex-col items-center justify-center gap-1.5 md:gap-2">
                {bannerTitles.map((title) => (
                  <div
                    key={title}
                    data-testid={title === 'DOUBLE OR NOTHING' ? 'double-label' : undefined}
                    className="font-black uppercase text-red-400 tracking-[0.22em] drop-shadow-[0_0_14px_rgba(248,113,113,0.55)]"
                    style={{ fontSize: 'clamp(20px, 2.6vw, 34px)', lineHeight: 1.05 }}
                  >
                    {title}
                  </div>
                ))}

                {specialMoveSummary && (
                  <div className="mt-1 flex flex-wrap justify-center gap-1.5 text-[9px] md:text-[10px] uppercase tracking-[0.18em] font-black text-zinc-100">
                    <span className="rounded-full border border-red-400/25 bg-black/45 px-2.5 py-1">{specialMoveSummary.pointsEffect}</span>
                    {specialMoveSummary.penaltyEffect && (
                      <span className="rounded-full border border-red-400/25 bg-black/45 px-2.5 py-1">{specialMoveSummary.penaltyEffect}</span>
                    )}
                    <span className="rounded-full border border-red-400/25 bg-black/45 px-2.5 py-1">{specialMoveSummary.stealPolicy}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 2. QUESTION AREA */}
        {questionContent}

        {/* 3. ANSWER AREA */}
        {answerContent}

        {/* 4. ACTION ICONS ROW */}
        <div data-testid="reveal-actions-rail" className="w-full border-t border-zinc-800/60 pt-2 md:pt-3 flex-none">
          <div 
            data-testid="reveal-actions"
            className="flex flex-wrap items-center justify-center gap-3 md:gap-8 w-full"
          >
            {/* RETURN */}
            <button 
              type="button"
              onClick={(e) => handleAction('return', e)}
              className="flex flex-col items-center gap-2 text-zinc-500 hover:text-white transition-all group min-w-[64px]"
              title="Return (BACKSPACE)"
            >
              <div className="p-3 md:p-5 bg-zinc-900/80 rounded-full border border-zinc-700 shadow-lg group-hover:bg-zinc-800 transition-colors">
                <ArrowLeft className="w-5 h-5 md:w-8 md:h-8" />
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest">Return</span>
            </button>

            {/* VOID */}
            <button 
              type="button"
              disabled={!isRevealed}
              onClick={(e) => handleAction('void', e)}
              className={`flex flex-col items-center gap-2 transition-all group min-w-[64px] ${isRevealed && !isQuestionCountdownRunning ? 'text-zinc-500 hover:text-red-500' : 'opacity-10 cursor-not-allowed grayscale'}`}
              title="Void (ESC)"
            >
              <div className="p-3 md:p-5 bg-zinc-900/80 rounded-full border border-zinc-700 shadow-lg group-hover:border-red-900/30 transition-all">
                <Trash2 className="w-5 h-5 md:w-8 md:h-8" />
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest">Void</span>
            </button>

            {/* MAIN REVEAL / SEPARATOR */}
            <div className="mx-2 md:mx-6 flex items-center justify-center min-w-[80px]">
              {!isRevealed ? (
                <button 
                  type="button"
                  disabled={!!isQuestionCountdownRunning}
                  onClick={(e) => handleAction('reveal', e)}
                  className={`text-black p-4 md:p-8 rounded-full shadow-[0_0_50px_rgba(255,215,0,0.3)] transition-all flex items-center justify-center border-4 border-black/20 ${isQuestionCountdownRunning ? 'bg-zinc-700 cursor-not-allowed opacity-50' : 'bg-gold-600 hover:bg-gold-500 hover:scale-110 active:scale-95'}`}
                  title="Reveal Answer (SPACE)"
                >
                  <Eye className="w-8 h-8 md:w-14 md:h-14" />
                </button>
              ) : (
                <div className="w-px h-16 bg-zinc-800/50" />
              )}
            </div>

            {/* STEAL */}
            <button 
              type="button"
              disabled={!isRevealed || !allowSteal}
              onClick={(e) => handleAction('steal', e)}
              className={`flex flex-col items-center gap-2 transition-all group min-w-[64px] ${isRevealed && allowSteal && !isQuestionCountdownRunning ? 'text-purple-500 hover:text-purple-300' : 'opacity-10 cursor-not-allowed grayscale'}`}
              title={stealDisabledReason || 'Steal (S)'}
            >
              <div className="p-3 md:p-5 bg-purple-950/20 border-2 border-purple-500/50 rounded-full shadow-xl group-hover:bg-purple-900/40 transition-all">
                <ShieldAlert className="w-5 h-5 md:w-8 md:h-8" />
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest">Steal</span>
            </button>

            {/* AWARD */}
            <button 
              type="button"
              disabled={!isRevealed || !selectedPlayerId}
              onClick={(e) => handleAction('award', e)}
              className={`flex flex-col items-center gap-2 transition-all group min-w-[64px] ${isRevealed && selectedPlayerId && !isQuestionCountdownRunning ? 'text-green-500 hover:text-green-300' : 'opacity-10 cursor-not-allowed grayscale'}`}
              title="Award (ENTER)"
            >
              <div className="p-3 md:p-5 bg-green-950/20 border-2 border-green-500/50 rounded-full shadow-xl group-hover:bg-green-900/40 transition-all">
                <Trophy className="w-5 h-5 md:w-8 md:h-8" />
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest">Award</span>
            </button>
          </div>
        </div>
      </div>

      {/* STEAL SELECTION OVERLAY */}
      {showStealSelect && (
        <div
          data-testid="steal-overlay"
          className="fixed inset-0 bg-black/95 backdrop-blur-sm z-[10000] flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-300"
        >
          {/* Inner luxury panel */}
          <div
            data-testid="steal-panel"
            className="relative w-full max-w-5xl bg-zinc-900 border border-purple-500/40 rounded-[2.5rem] shadow-[0_0_80px_rgba(168,85,247,0.25),0_32px_80px_rgba(0,0,0,0.9)] p-8 md:p-14 flex flex-col items-center gap-8 md:gap-12 overflow-hidden"
          >
            {/* Luxury top glow accent line */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2/3 h-px bg-gradient-to-r from-transparent via-purple-400/70 to-transparent pointer-events-none" aria-hidden="true" />
            {/* Inner ambient gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-b from-purple-950/20 via-transparent to-transparent pointer-events-none rounded-[2.5rem]" aria-hidden="true" />

            {/* Title */}
            <h3 className="relative z-10 text-purple-300 font-black text-3xl md:text-6xl uppercase tracking-[0.2em] text-center drop-shadow-[0_0_28px_rgba(168,85,247,0.65)]">
              Who is stealing?
            </h3>

            {/* Player selection grid */}
            <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 w-full">
              {players.filter(p => p.id !== selectedPlayerId).map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onClose('steal', p.id); }}
                  className="bg-zinc-800 border-2 border-purple-500/50 hover:border-purple-400 hover:bg-purple-900/40 p-8 md:p-12 rounded-2xl text-xl md:text-4xl font-black text-white transition-all transform hover:scale-105 active:scale-95 shadow-[0_4px_24px_rgba(0,0,0,0.6)] hover:shadow-[0_4px_40px_rgba(168,85,247,0.4)] uppercase tracking-tighter"
                >
                  {p.name}
                </button>
              ))}
            </div>

            {/* Cancel button */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowStealSelect(false); }}
              className="relative z-10 text-zinc-400 hover:text-white uppercase text-sm md:text-lg font-black tracking-widest transition-all border border-zinc-700 hover:border-zinc-400 rounded-full px-8 py-3 hover:bg-zinc-800/60"
            >
              Cancel Steal
            </button>
          </div>
        </div>
      )}
    </div>
  );
// React.memo: prevents re-renders driven purely by countdown ticks in the parent.
// question/answer content is further stabilised internally by useMemo.
});
