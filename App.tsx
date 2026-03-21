import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AppShell } from './components/AppShell';
import { ToastContainer } from './components/Toast';
import { LoginScreen } from './components/LoginScreen';
import { ShowSelection } from './components/ShowSelection';
import { TemplateDashboard } from './components/TemplateDashboard';
import { GameBoard } from './components/GameBoard';
import { Scoreboard } from './components/Scoreboard';
import { QuestionModal } from './components/QuestionModal';
import { ShortcutsPanel } from './components/ShortcutsPanel';
import { DirectorPanel } from './components/DirectorPanel';
import { AdminPanel } from './components/AdminPanel';
import { ConfirmationModal } from './components/ConfirmationModal';
import { EndGameCelebrationModal } from './components/EndGameCelebrationModal';
import { authService } from './services/authService';
import { dataService } from './services/dataService';
import { GameState, Category, Player, ToastMessage, Question, Show, GameTemplate, UserRole, Session, BoardViewSettings, PlayEvent, AnalyticsEventType, GameAnalyticsEvent, SpecialMoveType } from './types';
import { QuestionCountdownTimer, SessionGameTimer, TimerAudioSettings } from './types';
import { soundService } from './services/soundService';
import { logger } from './services/logger';
import { normalizePlayerName } from './services/utils';
import { useSpecialMovesOverlay } from './hooks/useSpecialMovesOverlay';
import { applySpecialMovesDecorator } from './modules/specialMoves/scoringDecorator';
import { doesReturnResolveAsFail, isStealBlockedForMove, normalizeSpecialMoveType } from './modules/specialMoves/logic';
import { getQuestionModalSpecialMoveModel, getSpecialMoveDisplayName } from './modules/specialMoves/modalSummary';
import { deriveResolvedSpecialMoveTileIds } from './modules/specialMoves/tileTagState';
import { getDefaultBoardViewSettings, sanitizeBoardViewSettings } from './services/boardViewSettings';
import { deriveEndGameCelebrationResult, isTriviaBoardComplete } from './services/endGameCelebration';
import { Monitor, Grid, Shield, Copy, Loader2, ExternalLink, Power } from 'lucide-react';

const QUESTION_TIMER_DURATION_OPTIONS = [5, 7, 8, 10, 15] as const;
const DEFAULT_QUESTION_TIMER_DURATION_SECONDS = 10;
const TIMER_STATE_STORAGE_KEY = 'cruzpham_timer_state';

const resolveQuestionCountdownDuration = (raw: unknown) => {
  const value = Number(raw);
  if (QUESTION_TIMER_DURATION_OPTIONS.includes(value as (typeof QUESTION_TIMER_DURATION_OPTIONS)[number])) {
    return value;
  }
  return DEFAULT_QUESTION_TIMER_DURATION_SECONDS;
};

const resolveTemplatePlayerCount = (template: GameTemplate) => {
  const quickMode = template.config?.quickGameMode;
  if (quickMode === 'single_player') return 1;
  if (quickMode === 'two_player') return 2;
  return Math.max(0, Number(template.config.playerCount || 0));
};

const resolveTemplateTimerEnabled = (
  template: GameTemplate,
  currentEnabled: boolean,
) => {
  const quickTimerMode = template.config?.quickTimerMode;
  if (quickTimerMode === 'timed') return true;
  if (quickTimerMode === 'untimed') return false;
  return currentEnabled;
};

const App: React.FC = () => {
  // App Boot State
  const [isConfigured, setIsConfigured] = useState(false);
  const [authChecked, setAuthChecked] = useState(false); 
  
  const [bootstrapToken, setBootstrapToken] = useState<string | null>(null);

  const [session, setSession] = useState<{ id: string; username: string; role: UserRole } | null>(null);
  const [activeShow, setActiveShow] = useState<Show | null>(null);

  // --- VIEW STATE ---
  const [viewMode, setViewMode] = useState<'BOARD' | 'DIRECTOR' | 'ADMIN'>('BOARD');
  const [isPopoutView, setIsPopoutView] = useState(false); 
  const [isDirectorPoppedOut, setIsDirectorPoppedOut] = useState(false); 
  const directorWindowRef = useRef<Window | null>(null);

  // --- MODALS ---
  const [showEndGameConfirm, setShowEndGameConfirm] = useState(false);
  const [editingTemplateStatus, setEditingTemplateStatus] = useState(false); // Track if builder is open
  const [showTimerExpiredPrompt, setShowTimerExpiredPrompt] = useState(false);
  const [isEndGameCelebrationOpen, setIsEndGameCelebrationOpen] = useState(false);
  const [hasShownEndGameCelebration, setHasShownEndGameCelebration] = useState(false);

  // --- ADMIN NOTIFICATIONS ---
  const [pendingRequests, setPendingRequests] = useState(0);

  // --- GAME STATE ---
  const [gameState, setGameState] = useState<GameState>({
    showTitle: '',
    isGameStarted: false,
    categories: [],
    players: [],
    activeQuestionId: null,
    activeCategoryId: null,
    selectedPlayerId: null,
    history: [],
    timer: {
      duration: 30,
      endTime: null,
      isRunning: false
    },
    // Fix: Updated initial viewSettings to align with the BoardViewSettings interface and use SizeScale strings ('M') instead of numbers.
    viewSettings: getDefaultBoardViewSettings(),
    lastPlays: [],
    events: []
  });

  const [questionTimerEnabled, setQuestionTimerEnabled] = useState(false);
  const [questionTimerDurationSeconds, setQuestionTimerDurationSeconds] = useState(DEFAULT_QUESTION_TIMER_DURATION_SECONDS);
  const [sessionTimerEnabled, setSessionTimerEnabled] = useState(false);

  const [questionTimer, setQuestionTimer] = useState<QuestionCountdownTimer>({
    durationSeconds: DEFAULT_QUESTION_TIMER_DURATION_SECONDS,
    remainingSeconds: 0,
    isRunning: false,
    isStopped: true,
    startedAt: null,
    endsAt: null,
    activeQuestionId: null,
  });

  const [sessionTimer, setSessionTimer] = useState<SessionGameTimer>({
    durationSeconds: 0,
    remainingSeconds: 0,
    isRunning: false,
    isStopped: true,
    startedAt: null,
    endsAt: null,
    selectedPreset: null,
  });
  const [activeTileMoveType, setActiveTileMoveType] = useState<SpecialMoveType | undefined>(undefined);

  const [timerAudio, setTimerAudio] = useState<TimerAudioSettings>({
    enabled: true,
    muted: soundService.getMute?.() ?? false,
    volume: soundService.getVolume?.() ?? 0.5,
    tickSoundEnabled: true,
    endSoundEnabled: true,
  });

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const specialMovesOverlay = useSpecialMovesOverlay(gameState.isGameStarted ? activeShow?.id : undefined);
  const resolvedSpecialMoveTileIds = useMemo(() => deriveResolvedSpecialMoveTileIds(gameState.events), [gameState.events]);
  // Ref keeps the overlay current inside stable callbacks without being a dep.
  const specialMovesOverlayRef = useRef(specialMovesOverlay);
  useEffect(() => {
    specialMovesOverlayRef.current = specialMovesOverlay;
  }, [specialMovesOverlay]);
  const isBoardComplete = useMemo(() => isTriviaBoardComplete(gameState.categories), [gameState.categories]);
  const celebrationResult = useMemo(() => deriveEndGameCelebrationResult(gameState.players), [gameState.players]);
  const questionTimerDurationRef = useRef(questionTimerDurationSeconds);
  const questionTimerEnabledRef = useRef(questionTimerEnabled);
  const sessionTimerEnabledRef = useRef(sessionTimerEnabled);
  const activeTileMoveTypeRef = useRef<SpecialMoveType | undefined>(activeTileMoveType);

  useEffect(() => {
    questionTimerDurationRef.current = questionTimerDurationSeconds;
  }, [questionTimerDurationSeconds]);

  useEffect(() => {
    questionTimerEnabledRef.current = questionTimerEnabled;
  }, [questionTimerEnabled]);

  useEffect(() => {
    sessionTimerEnabledRef.current = sessionTimerEnabled;
  }, [sessionTimerEnabled]);

  useEffect(() => {
    activeTileMoveTypeRef.current = activeTileMoveType;
  }, [activeTileMoveType]);

  useEffect(() => {
    const activeTileId = gameState.activeQuestionId;
    if (!activeTileId) {
      if (activeTileMoveTypeRef.current) setActiveTileMoveType(undefined);
      return;
    }
    if (activeTileMoveTypeRef.current) return;
    const deployment = specialMovesOverlay?.deploymentsByTileId?.[activeTileId];
    if (deployment?.status === 'ARMED') {
      setActiveTileMoveType(normalizeSpecialMoveType(deployment.moveType));
    }
  }, [gameState.activeQuestionId, specialMovesOverlay]);

  // Tracks remainingSeconds via ref so stopQuestionTimer can log it
  // without capturing questionTimer.remainingSeconds as a dep (which
  // would create a new callback reference every second while running).
  const questionTimerRemainingRef = useRef(questionTimer.remainingSeconds);
  const resolvingQuestionIdRef = useRef<string | null>(null);
  useEffect(() => {
    questionTimerRemainingRef.current = questionTimer.remainingSeconds;
  }, [questionTimer.remainingSeconds]);

  const handleSetQuestionTimerDuration = useCallback((seconds: number) => {
    const resolvedSeconds = resolveQuestionCountdownDuration(seconds);
    if (resolvedSeconds !== Number(seconds)) {
      logger.warn('question_timer_duration_invalid_fallback', {
        selected: seconds,
        fallback: resolvedSeconds,
      });
    }

    logger.info('counter_studio_question_duration_selected', { seconds: resolvedSeconds });
    setQuestionTimerDurationSeconds(resolvedSeconds);
  }, []);

  useEffect(() => {
    if (!gameState.isGameStarted) {
      if (isEndGameCelebrationOpen) setIsEndGameCelebrationOpen(false);
      if (hasShownEndGameCelebration) setHasShownEndGameCelebration(false);
      return;
    }

    if (!isBoardComplete) return;
    if (hasShownEndGameCelebration) return;
    if (gameState.activeQuestionId || gameState.activeCategoryId) return;
    if (showTimerExpiredPrompt || showEndGameConfirm) return;

    setIsEndGameCelebrationOpen(true);
    setHasShownEndGameCelebration(true);
  }, [
    gameState.isGameStarted,
    gameState.activeQuestionId,
    gameState.activeCategoryId,
    hasShownEndGameCelebration,
    isBoardComplete,
    isEndGameCelebrationOpen,
    showTimerExpiredPrompt,
    showEndGameConfirm,
  ]);

  // Layout Logging
  useEffect(() => {
    const logLayout = () => {
      const isCompact = window.innerWidth < 1024;
      logger.info("layout_mode", { compact: isCompact, width: window.innerWidth, height: window.innerHeight });
    };
    logLayout();
    window.addEventListener('resize', logLayout);
    return () => window.removeEventListener('resize', logLayout);
  }, []);

  // --- PERSISTENCE & SYNC ---
  const saveGameState = (state: GameState) => {
    const safeState: GameState = {
      ...state,
      viewSettings: sanitizeBoardViewSettings(state.viewSettings)
    };
    localStorage.setItem('cruzpham_gamestate', JSON.stringify(safeState));
    setGameState(safeState);
  };

  const getPresetDuration = (preset: string): number => {
    switch (preset) {
      case '15m': return 15 * 60;
      case '30m': return 30 * 60;
      case '1h': return 60 * 60;
      case '1h30m': return 90 * 60;
      case '2h': return 120 * 60;
      default: return 0;
    }
  };

  const handleSessionTimerExpired = () => {
    emitGameEvent('SESSION_TIMER_EXPIRED', {
      actor: { role: 'system' },
      context: {
        message: 'Game timer expired. Game over.'
      }
    });

    addToast('info', 'Game time expired. Continue or end the game.');
    setShowTimerExpiredPrompt(true);
  };

  const handleQuestionCountdownComplete = () => {
    logger.info('question_countdown_completed', { tileId: gameState.activeQuestionId });
    addToast('info', 'Question countdown finished. Ready for resolution.');
  };

  const handleContinueAfterTimerExpired = () => {
    setShowTimerExpiredPrompt(false);
    setSessionTimer({
      durationSeconds: 0,
      remainingSeconds: 0,
      isRunning: false,
      isStopped: true,
      startedAt: null,
      endsAt: null,
      selectedPreset: null,
    });
  };

  const handleEndGameAfterTimerExpired = () => {
    const voidedCategories = gameState.categories.map((cat) => ({
      ...cat,
      questions: cat.questions.map((q) =>
        !q.isAnswered && !q.isVoided ? { ...q, isVoided: true } : q
      )
    }));

    saveGameState({
      ...gameState,
      categories: voidedCategories,
      isGameStarted: false,
      activeQuestionId: null,
      activeCategoryId: null,
      timer: { ...gameState.timer, endTime: null, isRunning: false },
      lastPlays: []
    });

    emitGameEvent('SESSION_ENDED', {
      actor: { role: 'director' },
      context: { note: 'Game ended after session timer expiration' }
    });

    setShowTimerExpiredPrompt(false);
    setIsEndGameCelebrationOpen(false);
    setHasShownEndGameCelebration(false);
    setQuestionTimer({
      durationSeconds: resolveQuestionCountdownDuration(questionTimerDurationRef.current),
      remainingSeconds: 0,
      isRunning: false,
      isStopped: true,
      startedAt: null,
      endsAt: null,
      activeQuestionId: null,
    });
    setSessionTimer({
      durationSeconds: 0,
      remainingSeconds: 0,
      isRunning: false,
      isStopped: true,
      startedAt: null,
      endsAt: null,
      selectedPreset: null,
    });
    setViewMode('BOARD');
  };

  const getSoundSnapshot = useCallback(() => {
    const svc = soundService as any;
    const fallbackMuted = typeof svc.getMute === 'function' ? !!svc.getMute() : false;
    const fallbackVolume = typeof svc.getVolume === 'function' ? Number(svc.getVolume()) : 0.5;
    if (typeof svc.getSoundBoardState === 'function') {
      return svc.getSoundBoardState();
    }
    return {
      masterEnabled: true,
      masterMuted: fallbackMuted,
      masterVolume: fallbackVolume,
      sounds: {
        timerTick: { enabled: true, muted: false, volume: 1 },
        timerEnd: { enabled: true, muted: false, volume: 1 }
      }
    };
  }, []);

  const deriveTimerAudio = useCallback((): TimerAudioSettings => {
    const snapshot = getSoundSnapshot();
    const tick = snapshot.sounds?.timerTick;
    const end = snapshot.sounds?.timerEnd;
    return {
      enabled: snapshot.masterEnabled,
      muted: snapshot.masterMuted,
      volume: snapshot.masterVolume,
      tickSoundEnabled: (tick?.enabled ?? true) && !(tick?.muted ?? false),
      endSoundEnabled: (end?.enabled ?? true) && !(end?.muted ?? false)
    };
  }, [getSoundSnapshot]);

  const canPlayTimerAudio = useCallback(() => {
    const snapshot = getSoundSnapshot();
    return snapshot.masterEnabled && !snapshot.masterMuted && snapshot.masterVolume > 0;
  }, [getSoundSnapshot]);

  useEffect(() => {
    const svc = soundService as any;
    if (typeof svc.subscribe !== 'function') {
      setTimerAudio(deriveTimerAudio());
      return;
    }
    const unsubscribe = svc.subscribe(() => {
      setTimerAudio(deriveTimerAudio());
    });
    setTimerAudio(deriveTimerAudio());
    return unsubscribe;
  }, [deriveTimerAudio]);

  const startQuestionTimer = useCallback((questionId: string, durationSeconds?: number) => {
    if (!questionTimerEnabledRef.current) {
      logger.info('question_timer_start_blocked_disabled', { questionId });
      return;
    }

    const selectedDuration = durationSeconds ?? questionTimerDurationRef.current;
    const resolvedDuration = resolveQuestionCountdownDuration(selectedDuration);
    if (resolvedDuration !== Number(selectedDuration)) {
      logger.warn('question_timer_start_fallback_duration', {
        requestedDuration: selectedDuration,
        fallbackDuration: resolvedDuration,
        questionId,
      });
    }

    const now = Date.now();
    logger.info('question_timer_start', {
      questionId,
      durationSeconds: resolvedDuration,
      selectedDuration: questionTimerDurationRef.current,
    });

    setQuestionTimer({
      durationSeconds: resolvedDuration,
      remainingSeconds: resolvedDuration,
      isRunning: true,
      isStopped: false,
      startedAt: now,
      endsAt: now + resolvedDuration * 1000,
      activeQuestionId: questionId,
    });
  }, []);

  const restartQuestionTimer = useCallback(() => {
    if (!questionTimerEnabledRef.current) {
      logger.info('question_timer_restart_blocked_disabled');
      return;
    }
    const questionId = gameStateRef.current.activeQuestionId;
    if (!questionId) return;
    logger.info('question_timer_restart', {
      questionId,
      durationSeconds: questionTimerDurationRef.current,
    });
    startQuestionTimer(questionId, questionTimerDurationRef.current);
  }, [startQuestionTimer]);

  const stopQuestionTimer = useCallback(() => {
    logger.info('question_timer_stop', {
      questionId: gameStateRef.current.activeQuestionId,
      remainingSeconds: questionTimer.remainingSeconds,
    });
    setQuestionTimer((prev) => ({
      ...prev,
      isRunning: false,
      isStopped: true,
      endsAt: null,
    }));
  }, [questionTimer.remainingSeconds]);

  const handleToggleQuestionTimerEnabled = useCallback((enabled: boolean) => {
    const safeEnabled = enabled === true;
    setQuestionTimerEnabled(safeEnabled);
    if (!safeEnabled) {
      setQuestionTimer((prev) => ({
        ...prev,
        remainingSeconds: 0,
        isRunning: false,
        isStopped: true,
        startedAt: null,
        endsAt: null,
        activeQuestionId: null,
      }));
    }
  }, []);

  const handleToggleSessionTimerEnabled = useCallback((enabled: boolean) => {
    const safeEnabled = enabled === true;
    setSessionTimerEnabled(safeEnabled);
    if (!safeEnabled) {
      setSessionTimer((prev) => ({
        ...prev,
        remainingSeconds: 0,
        isRunning: false,
        isStopped: true,
        startedAt: null,
        endsAt: null,
      }));
    }
  }, []);

  const setTimerSoundEnabled = useCallback((enabled: boolean) => {
    const svc = soundService as any;
    if (typeof svc.setMasterSoundEnabled === 'function') {
      svc.setMasterSoundEnabled(enabled);
    }
    setTimerAudio((prev) => ({ ...prev, enabled }));
  }, []);

  const setTimerMuted = useCallback((muted: boolean) => {
    const svc = soundService as any;
    if (typeof svc.setMasterMuted === 'function') {
      svc.setMasterMuted(muted);
    } else {
      soundService.setMute(muted);
    }
    setTimerAudio((prev) => ({ ...prev, muted }));
  }, []);

  const increaseTimerVolume = useCallback(() => {
    const svc = soundService as any;
    if (typeof svc.increaseMasterVolume === 'function') {
      svc.increaseMasterVolume();
    } else {
      const nextVol = Math.min(1, Number(((soundService.getVolume?.() || 0) + 0.1).toFixed(2)));
      soundService.setVolume(nextVol);
    }
    setTimerAudio(deriveTimerAudio());
  }, [deriveTimerAudio]);

  const decreaseTimerVolume = useCallback(() => {
    const svc = soundService as any;
    if (typeof svc.decreaseMasterVolume === 'function') {
      svc.decreaseMasterVolume();
    } else {
      const nextVol = Math.max(0, Number(((soundService.getVolume?.() || 0) - 0.1).toFixed(2)));
      soundService.setVolume(nextVol);
    }
    setTimerAudio(deriveTimerAudio());
  }, [deriveTimerAudio]);

  // --- ANALYTICS EVENT EMITTER (CANONICAL LOG BUS) ---
  const emitGameEvent = useCallback((type: AnalyticsEventType, payload: Partial<GameAnalyticsEvent>) => {
    try {
      const ts = Date.now();
      const iso = new Date(ts).toISOString();
      const id = crypto.randomUUID();
      
      const newEvent: GameAnalyticsEvent = {
        id,
        ts,
        iso,
        type,
        actor: payload.actor || { role: 'system' },
        context: payload.context || {}
      };

      // Ensure names in context are normalized for the log
      if (newEvent.context.playerName) {
        newEvent.context.playerName = normalizePlayerName(newEvent.context.playerName);
      }

      logger.info("log_event_append", { type, ts: iso });

      setGameState(prev => {
        const updatedEvents = [...(prev.events || []), newEvent];
        // Retain last 1000 events in memory
        const cappedEvents = updatedEvents.slice(-1000);
        const newState = { ...prev, events: cappedEvents };
        localStorage.setItem('cruzpham_gamestate', JSON.stringify(newState));
        return newState;
      });
    } catch (e: any) {
      logger.error("log_event_failed", { type, message: e.message, ts: new Date().toISOString() });
    }
  }, []);

  const handleStorageChange = useCallback((e: StorageEvent) => {
    if (e.key === 'cruzpham_gamestate' && e.newValue) {
      setGameState(JSON.parse(e.newValue));
      return;
    }

    if (e.key === TIMER_STATE_STORAGE_KEY && e.newValue) {
      try {
        const payload = JSON.parse(e.newValue);
        const nextDuration = resolveQuestionCountdownDuration(payload.questionTimerDurationSeconds);
        const nextQuestionEnabled = payload.questionTimerEnabled === true;
        const nextSessionEnabled = payload.sessionTimerEnabled === true;
        setQuestionTimerEnabled(nextQuestionEnabled);
        setSessionTimerEnabled(nextSessionEnabled);
        setQuestionTimerDurationSeconds(nextDuration);
        if (payload.questionTimer) {
          setQuestionTimer(nextQuestionEnabled ? payload.questionTimer : {
            ...payload.questionTimer,
            remainingSeconds: 0,
            isRunning: false,
            isStopped: true,
            startedAt: null,
            endsAt: null,
            activeQuestionId: null,
          });
        }
        if (payload.sessionTimer) {
          setSessionTimer(nextSessionEnabled ? payload.sessionTimer : {
            ...payload.sessionTimer,
            remainingSeconds: 0,
            isRunning: false,
            isStopped: true,
            startedAt: null,
            endsAt: null,
          });
        }
      } catch (error: any) {
        logger.warn('timer_state_hydration_failed', { message: error?.message });
      }
    }
  }, []);

  // Use Ref to access latest state in event listeners without re-binding
  const gameStateRef = useRef(gameState);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  useEffect(() => {
    localStorage.setItem(
      TIMER_STATE_STORAGE_KEY,
      JSON.stringify({
        questionTimerEnabled,
        sessionTimerEnabled,
        questionTimerDurationSeconds,
        questionTimer,
        sessionTimer,
      })
    );
  }, [questionTimerEnabled, sessionTimerEnabled, questionTimerDurationSeconds, questionTimer, sessionTimer]);

  // UI State Persistence Effect
  useEffect(() => {
    if (session) {
      const uiState = {
        activeShowId: activeShow?.id || null,
        viewMode: viewMode
      };
      localStorage.setItem('cruzpham_ui_state', JSON.stringify(uiState));
    }
  }, [activeShow, viewMode, session]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const tagName = active?.tagName.toLowerCase();
      const isInput = tagName === 'input' || tagName === 'textarea' || (active as HTMLElement)?.isContentEditable;
      if (isInput) return;

      const state = gameStateRef.current;

      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault(); 
        if (state.players.length === 0) return;
        const currentIdx = state.players.findIndex(p => p.id === state.selectedPlayerId);
        let newIdx = currentIdx === -1 ? 0 : currentIdx;
        if (e.code === 'ArrowUp') {
          newIdx = currentIdx - 1;
          if (newIdx < 0) newIdx = state.players.length - 1;
        } else {
          newIdx = currentIdx + 1;
          if (newIdx >= state.players.length) newIdx = 0;
        }
        const newId = state.players[newIdx].id;
        if (newId !== state.selectedPlayerId) {
          soundService.playSelect();
          const targetPlayer = state.players[newIdx];
          emitGameEvent('PLAYER_SELECTED', {
             actor: { role: 'director' },
             context: { playerId: targetPlayer.id, playerName: targetPlayer.name }
          });
          saveGameState({ ...state, selectedPlayerId: newId });
        }
        return;
      }

      if (['=', '+', '-', '_'].includes(e.key)) {
         if (!state.selectedPlayerId) return;
         const delta = (e.key === '=' || e.key === '+') ? 100 : -100;
         soundService.playClick();
         const targetPlayer = state.players.find(p => p.id === state.selectedPlayerId);
         if (targetPlayer) {
           emitGameEvent('SCORE_ADJUSTED', {
              actor: { role: 'director' },
              context: { playerName: targetPlayer.name, playerId: targetPlayer.id, delta, note: 'shortcut adjustment' }
           });
         }
         saveGameState({
           ...state,
           players: state.players.map(p => p.id === state.selectedPlayerId ? { ...p, score: p.score + delta } : p)
         });
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [emitGameEvent]);

  // Admin Polling
  useEffect(() => {
    let interval: number;
    if (session?.role === 'ADMIN' || session?.role === 'MASTER_ADMIN') {
        const check = () => {
            const reqs = authService.getRequests();
            const pending = reqs.filter(r => r.status === 'PENDING').length;
            setPendingRequests(prev => {
                if (pending > prev) {
                    soundService.playToast('info');
                    addToast('info', `New Request: ${pending} Pending`);
                }
                return pending;
            });
        };
        check(); 
        interval = window.setInterval(check, 30000); 
    }
    return () => clearInterval(interval);
  }, [session]);

  // AUTHORITATIVE TIMER ENGINE
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      let questionCompleted = false;
      let sessionExpired = false;

      setQuestionTimer((prev) => {
        if (!questionTimerEnabledRef.current) {
          if (!prev.isRunning && prev.isStopped && !prev.endsAt && prev.remainingSeconds === 0) return prev;
          return {
            ...prev,
            remainingSeconds: 0,
            isRunning: false,
            isStopped: true,
            startedAt: null,
            endsAt: null,
            activeQuestionId: null,
          };
        }
        if (!prev.isRunning || !prev.endsAt) return prev;
        const nextRemaining = Math.max(0, Math.ceil((prev.endsAt - now) / 1000));
        if (nextRemaining === prev.remainingSeconds) return prev;

        if (nextRemaining > 0 && nextRemaining <= 5 && canPlayTimerAudio() && timerAudio.tickSoundEnabled) {
          soundService.playSound?.('timerTick');
        }

        if (nextRemaining === 0) {
          if (canPlayTimerAudio() && timerAudio.endSoundEnabled) {
            soundService.playSound?.('timerEnd');
          }
          questionCompleted = true;
          return { ...prev, remainingSeconds: 0, isRunning: false, isStopped: true, endsAt: null };
        }

        return { ...prev, remainingSeconds: nextRemaining };
      });

      setSessionTimer((prev) => {
        if (!sessionTimerEnabledRef.current) {
          if (!prev.isRunning && prev.isStopped && !prev.endsAt && prev.remainingSeconds === 0) return prev;
          return {
            ...prev,
            remainingSeconds: 0,
            isRunning: false,
            isStopped: true,
            startedAt: null,
            endsAt: null,
          };
        }
        if (!prev.isRunning || prev.isStopped || !prev.endsAt || !gameStateRef.current.isGameStarted) return prev;
        const nextRemaining = Math.max(0, Math.ceil((prev.endsAt - now) / 1000));
        if (nextRemaining === prev.remainingSeconds) return prev;

        if (nextRemaining > 0 && nextRemaining <= 10 && canPlayTimerAudio() && timerAudio.tickSoundEnabled) {
          soundService.playSound?.('sessionCue');
        }

        if (nextRemaining === 0) {
          if (canPlayTimerAudio() && timerAudio.endSoundEnabled) {
            soundService.playSound?.('timerEnd');
          }
          sessionExpired = true;
          return { ...prev, remainingSeconds: 0, isRunning: false, isStopped: true, endsAt: null };
        }

        return { ...prev, remainingSeconds: nextRemaining };
      });

      if (questionCompleted) handleQuestionCountdownComplete();
      if (sessionExpired) handleSessionTimerExpired();
    }, 250);

    return () => clearInterval(interval);
  }, [canPlayTimerAudio, timerAudio.tickSoundEnabled, timerAudio.endSoundEnabled]);

  const handleStartSessionTimer = (preset: '15m' | '30m' | '1h' | '1h30m' | '2h') => {
    if (!sessionTimerEnabledRef.current) {
      logger.info('session_timer_start_blocked_disabled', { preset });
      addToast('info', 'Enable Session Game Timer first.');
      return;
    }

    const duration = getPresetDuration(preset);
    const now = Date.now();
    const newTimer: SessionGameTimer = {
      durationSeconds: duration,
      remainingSeconds: duration,
      isRunning: true,
      isStopped: false,
      startedAt: now,
      endsAt: now + duration * 1000,
      selectedPreset: preset
    };
    setSessionTimer(newTimer);
    logger.info('session_timer_start', { preset, durationSeconds: duration });

    emitGameEvent('SESSION_TIMER_START', {
      actor: { role: 'director' },
      context: { note: `Game timer started: ${preset}` }
    });
  };

  const handlePauseSessionTimer = () => {
    if (!sessionTimerEnabledRef.current) return;

    setSessionTimer((prev) => {
      if (!prev.remainingSeconds) return prev;
      if (prev.isRunning) {
        logger.info('session_timer_pause', { remainingSeconds: prev.remainingSeconds, preset: prev.selectedPreset });
        emitGameEvent('SESSION_TIMER_PAUSED', { actor: { role: 'director' }, context: {} });
        return { ...prev, isRunning: false, isStopped: true, endsAt: null };
      }

      const now = Date.now();
      logger.info('session_timer_resume', { remainingSeconds: prev.remainingSeconds, preset: prev.selectedPreset });
      emitGameEvent('SESSION_TIMER_RESUMED', { actor: { role: 'director' }, context: {} });
      return {
        ...prev,
        isRunning: true,
        isStopped: false,
        startedAt: now,
        endsAt: now + prev.remainingSeconds * 1000,
      };
    });
  };

  const handleResetSessionTimer = () => {
    logger.info('session_timer_reset');
    setSessionTimer({
      durationSeconds: 0,
      remainingSeconds: 0,
      isRunning: false,
      isStopped: true,
      startedAt: null,
      endsAt: null,
      selectedPreset: null,
    });
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('view') === 'director') {
      setIsPopoutView(true);
      setViewMode('DIRECTOR');
      document.title = "Director Panel - CRUZPHAM STUDIOS";
    }

    window.addEventListener('storage', handleStorageChange);

    const initializeApp = async () => {
       try {
         const status = await authService.getBootstrapStatus();
         setIsConfigured(status.masterReady);

         if (status.masterReady) {
            const storedSessionId = localStorage.getItem('cruzpham_active_session_id');
            if (storedSessionId) {
               const result = await authService.restoreSession(storedSessionId);
               if (result.success && result.session) {
                  setSession({ id: result.session.id, username: result.session.username, role: result.session.role });
                  try {
                    const uiStateRaw = localStorage.getItem('cruzpham_ui_state');
                    if (uiStateRaw) {
                      const uiState = JSON.parse(uiStateRaw);
                      if (uiState.activeShowId) {
                        const restoredShow = dataService.getShowById(uiState.activeShowId);
                        if (restoredShow) setActiveShow(restoredShow);
                      }
                      if (uiState.viewMode) setViewMode(uiState.viewMode);
                    }
                  } catch (e) { logger.warn('hydrateUIStateFailed'); }
               } else {
                 localStorage.removeItem('cruzpham_active_session_id');
                 localStorage.removeItem('cruzpham_ui_state');
               }
            }
         }
         
         const savedState = localStorage.getItem('cruzpham_gamestate');
         if (savedState) {
           const parsed = JSON.parse(savedState);
           parsed.viewSettings = sanitizeBoardViewSettings(parsed.viewSettings);
           parsed.players = (parsed.players || []).map((p: Player) => ({
             ...p,
             stealsCount: Number(p?.stealsCount || 0),
             specialMovesUsedCount: Number(p?.specialMovesUsedCount || 0),
             specialMovesUsedNames: Array.isArray(p?.specialMovesUsedNames) ? p.specialMovesUsedNames : [],
           }));
           
           if (!parsed.lastPlays) parsed.lastPlays = [];
           if (!parsed.events) parsed.events = [];
           
           setGameState(parsed);
           if (parsed.showTitle && !activeShow) {
              setActiveShow(prev => prev || { id: 'restored-ghost', userId: 'restored', title: parsed.showTitle, createdAt: '' });
           }
         }

         const savedTimerState = localStorage.getItem(TIMER_STATE_STORAGE_KEY);
         if (savedTimerState) {
           try {
             const timerState = JSON.parse(savedTimerState);
             const resolvedDuration = resolveQuestionCountdownDuration(timerState.questionTimerDurationSeconds);
             const nextQuestionEnabled = timerState.questionTimerEnabled === true;
             const nextSessionEnabled = timerState.sessionTimerEnabled === true;
             setQuestionTimerEnabled(nextQuestionEnabled);
             setSessionTimerEnabled(nextSessionEnabled);
             setQuestionTimerDurationSeconds(resolvedDuration);
             if (timerState.questionTimer) {
               setQuestionTimer(nextQuestionEnabled ? timerState.questionTimer : {
                 ...timerState.questionTimer,
                 remainingSeconds: 0,
                 isRunning: false,
                 isStopped: true,
                 startedAt: null,
                 endsAt: null,
                 activeQuestionId: null,
               });
             }
             if (timerState.sessionTimer) {
               setSessionTimer(nextSessionEnabled ? timerState.sessionTimer : {
                 ...timerState.sessionTimer,
                 remainingSeconds: 0,
                 isRunning: false,
                 isStopped: true,
                 startedAt: null,
                 endsAt: null,
               });
             }
           } catch (error: any) {
             logger.warn('timer_state_restore_failed', { message: error?.message });
           }
         }
       } catch (e) {
         console.error("System Initialization Failed", e);
       } finally { setAuthChecked(true); }
    };
    initializeApp();
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const addToast = (type: ToastMessage['type'], message: string) => {
    setToasts(prev => [...prev, { id: Math.random().toString(), type, message }]);
  };
  const removeToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  // --- ACTIONS ---

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = await authService.bootstrapMasterAdmin('admin');
      setBootstrapToken(token);
      setIsConfigured(true);
      addToast('success', 'Master Admin Created Successfully');
    } catch (e: any) {
      addToast('error', e.message);
      if (e.code === 'ERR_BOOTSTRAP_COMPLETE') setTimeout(() => window.location.reload(), 2000);
    }
  };

  const handlePopout = () => {
    const width = 1024;
    const height = 800;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;
    const win = window.open(window.location.href + (window.location.href.includes('?') ? '&' : '?') + 'view=director', 'CruzPhamDirector', `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`);
    if (win) {
      directorWindowRef.current = win;
      setIsDirectorPoppedOut(true);
      addToast('info', 'Director Panel detached.');
    } else {
      addToast('error', 'Popout blocked. Please allow popups.');
    }
  };

  const handleBringBack = () => {
    if (directorWindowRef.current) {
        directorWindowRef.current.close();
        directorWindowRef.current = null;
    }
    setIsDirectorPoppedOut(false);
  };

  const handleLoginSuccess = (newSession: Session) => {
    setSession({ id: newSession.id, username: newSession.username, role: newSession.role });
    localStorage.setItem('cruzpham_active_session_id', newSession.id);
    addToast('success', 'Welcome to CruzPham Trivia Studios!');
  };

  const handleLogout = () => {
    if (session) {
      authService.logout(session.id);
      setSession(null);
      setActiveShow(null);
      localStorage.removeItem('cruzpham_active_session_id');
      localStorage.removeItem('cruzpham_ui_state');
      localStorage.removeItem('cruzpham_gamestate');
      localStorage.removeItem(TIMER_STATE_STORAGE_KEY);
      setViewMode('BOARD');
      setIsEndGameCelebrationOpen(false);
      setHasShownEndGameCelebration(false);
    }
  };

  // --- GAME LOGIC ---

  const handlePlayTemplate = (template: GameTemplate) => {
    setIsEndGameCelebrationOpen(false);
    setHasShownEndGameCelebration(false);

    const initCategories = template.categories.map(cat => {
      const hasDouble = cat.questions.some(q => q.isDoubleOrNothing);
      const luckyIndex = !hasDouble ? Math.floor(Math.random() * cat.questions.length) : -1;
      return {
        ...cat,
        questions: cat.questions.map((q, idx) => ({
          ...q,
          isAnswered: false,
          isRevealed: false,
          isVoided: false,
          isDoubleOrNothing: hasDouble ? (q.isDoubleOrNothing || false) : (idx === luckyIndex)
        }))
      };
    });

    const targetPlayerCount = resolveTemplatePlayerCount(template);
    const timerEnabledFromTemplate = resolveTemplateTimerEnabled(template, questionTimerEnabled);

    const initPlayers: Player[] = (template.config.playerNames || []).slice(0, Math.max(0, targetPlayerCount)).map(name => ({
      id: crypto.randomUUID(), name: normalizePlayerName(name), score: 0, color: '#ffffff', wildcardsUsed: 0, wildcardActive: false, stealsCount: 0, specialMovesUsedCount: 0, specialMovesUsedNames: []
    }));

    if (initPlayers.length === 0 && targetPlayerCount > 0) {
      for (let i = 0; i < targetPlayerCount; i++) {
        initPlayers.push({ id: crypto.randomUUID(), name: `PLAYER ${i + 1}`, score: 0, color: '#ffffff', wildcardsUsed: 0, wildcardActive: false, stealsCount: 0, specialMovesUsedCount: 0, specialMovesUsedNames: [] });
      }
    }

    logger.info('template_quick_setup_applied', {
      templateId: template.id,
      quickGameMode: template.config?.quickGameMode || null,
      quickTimerMode: template.config?.quickTimerMode || null,
      playerCount: initPlayers.length,
      timerEnabled: timerEnabledFromTemplate,
    });

    handleToggleQuestionTimerEnabled(timerEnabledFromTemplate);

    const newState: GameState = {
      ...gameState,
      showTitle: activeShow?.title || '',
      isGameStarted: true,
      categories: initCategories,
      players: initPlayers,
      activeQuestionId: null,
      activeCategoryId: null,
      selectedPlayerId: initPlayers.length > 0 ? initPlayers[0].id : null,
      history: [`Started: ${template.topic}`],
      timer: { duration: 30, endTime: null, isRunning: false },
      // Fix: Ensured fallback viewSettings matches the interface and uses SizeScale strings ('M').
      viewSettings: sanitizeBoardViewSettings(gameState.viewSettings),
      lastPlays: [],
      events: [] // Reset events for new session
    };

    saveGameState(newState);

    emitGameEvent('SESSION_STARTED', { 
       actor: { role: 'director' },
       context: { showId: activeShow?.id, templateId: template.id, note: `Game started: ${template.topic}` }
    });

    if (viewMode !== 'BOARD') setViewMode('BOARD');
  };

  const handleEndGame = () => {
    if (isDirectorPoppedOut) handleBringBack();
    
    emitGameEvent('SESSION_ENDED', { 
      actor: { role: 'director' },
      context: { note: 'Game session closed manually' }
    });

    const newState: GameState = {
      ...gameState,
      isGameStarted: false,
      activeQuestionId: null,
      activeCategoryId: null,
      timer: { ...gameState.timer, endTime: null, isRunning: false },
      lastPlays: []
    };
    saveGameState(newState);
    setQuestionTimer({
      durationSeconds: resolveQuestionCountdownDuration(questionTimerDurationRef.current),
      remainingSeconds: 0,
      isRunning: false,
      isStopped: true,
      startedAt: null,
      endsAt: null,
      activeQuestionId: null,
    });
    setSessionTimer({
      durationSeconds: 0,
      remainingSeconds: 0,
      isRunning: false,
      isStopped: true,
      startedAt: null,
      endsAt: null,
      selectedPreset: null,
    });
    setActiveTileMoveType(undefined);
    setViewMode('BOARD');
    setShowEndGameConfirm(false);
    setIsEndGameCelebrationOpen(false);
    setHasShownEndGameCelebration(false);
    addToast('info', 'Game Session Ended');
  };

  const handleSelectQuestion = (catId: string, qId: string) => {
    const cat = gameState.categories.find(c => c.id === catId);
    const q = cat?.questions.find(qu => qu.id === qId);

    soundService.playSound?.('tileOpen');

    const deployment = specialMovesOverlayRef.current?.deploymentsByTileId?.[qId];
    setActiveTileMoveType(deployment?.status === 'ARMED' ? normalizeSpecialMoveType(deployment.moveType) : undefined);

    if (questionTimerEnabled) {
      const selectedDuration = resolveQuestionCountdownDuration(questionTimerDurationRef.current);
      startQuestionTimer(qId, selectedDuration);
    }

    // saveGameState FIRST (direct update) so the subsequent emitGameEvent
    // functional updater receives the correct activeQuestionId in its `prev`.
    saveGameState({ ...gameState, activeCategoryId: catId, activeQuestionId: qId });

    emitGameEvent('TILE_OPENED', {
       actor: { role: 'director' },
       context: { tileId: qId, categoryName: cat?.title, points: q?.points }
    });

    if (questionTimerEnabled) {
      const selectedDuration = resolveQuestionCountdownDuration(questionTimerDurationRef.current);
      emitGameEvent('QUESTION_COUNTDOWN_START', {
        actor: { role: 'director' },
        context: { tileId: qId, note: `Question countdown auto-started (${selectedDuration}s)` }
      });
    }
  };

  const handleQuestionClose = (action: 'return' | 'void' | 'award' | 'steal', targetPlayerId?: string) => {
    const current = gameStateRef.current;
    const catIdx = current.categories.findIndex(c => c.id === current.activeCategoryId);
    const activeCat = current.categories[catIdx];
    const qIdx = activeCat?.questions.findIndex(q => q.id === current.activeQuestionId);
    const activeQ = activeCat?.questions[qIdx];

    if (current.activeQuestionId && resolvingQuestionIdRef.current === current.activeQuestionId) {
      logger.warn('question_close_deduped', { action, tileId: current.activeQuestionId });
      return;
    }

    if (!activeCat || !activeQ) {
       setActiveTileMoveType(undefined);
       saveGameState({ ...current, activeQuestionId: null, activeCategoryId: null });
       return;
    }

    resolvingQuestionIdRef.current = activeQ.id;

    const basePoints = (activeQ.isDoubleOrNothing ? activeQ.points * 2 : activeQ.points);
    const tileMoveType = normalizeSpecialMoveType(
      activeTileMoveTypeRef.current || specialMovesOverlayRef.current?.deploymentsByTileId?.[activeQ.id]?.moveType
    );
    const stealBlocked = isStealBlockedForMove(tileMoveType);
    const resolvesAsFail = action === 'return' && doesReturnResolveAsFail(tileMoveType);

    if (action === 'steal' && stealBlocked) {
      logger.warn('special_move_steal_blocked', { tileId: activeQ.id, moveType: tileMoveType });
      addToast('error', 'Steal is disabled for this special move.');
      resolvingQuestionIdRef.current = null;
      return;
    }

    const points = (action === 'award' || action === 'steal' || resolvesAsFail)
      ? applySpecialMovesDecorator(basePoints, {
          tileId: activeQ.id,
          moveType: tileMoveType,
          outcome: action === 'award' ? 'AWARD' : action === 'steal' ? 'STEAL' : 'FAIL'
        })
      : basePoints;
    const specialMoveName = getSpecialMoveDisplayName(tileMoveType);
    const shouldTrackSpecialMoveUsage = Boolean(tileMoveType) && (action === 'award' || action === 'steal' || resolvesAsFail);

    // "LAST 4 PLAYS" REAL-TIME LOG (RING BUFFER)
    const newCategories = current.categories.map(c => {
      if (c.id !== current.activeCategoryId) return c;
      return {
        ...c,
        questions: c.questions.map(q => {
          if (q.id !== current.activeQuestionId) return q;
          return {
            ...q,
            isRevealed: false,
            isAnswered: action === 'award' || action === 'steal' || resolvesAsFail,
            isVoided: action === 'void' || resolvesAsFail
          };
        })
      };
    });

    let newPlayers = [...current.players];
    let awardedPlayerName = '';
    let stealerPlayerName = '';
    const attemptedPlayer = current.players.find(p => p.id === current.selectedPlayerId);

    if ((action === 'award' || action === 'steal') && targetPlayerId) {
      newPlayers = newPlayers.map(p => {
        if (p.id === targetPlayerId) {
          const isSteal = action === 'steal';
          const newStealsCount = isSteal ? (p.stealsCount || 0) + 1 : (p.stealsCount || 0);
          const nextSpecialMovesUsedCount = shouldTrackSpecialMoveUsage ? (p.specialMovesUsedCount || 0) + 1 : (p.specialMovesUsedCount || 0);
          const nextSpecialMovesUsedNames = shouldTrackSpecialMoveUsage && specialMoveName
            ? [...(Array.isArray(p.specialMovesUsedNames) ? p.specialMovesUsedNames : []), specialMoveName]
            : (Array.isArray(p.specialMovesUsedNames) ? p.specialMovesUsedNames : []);
          if (isSteal) stealerPlayerName = p.name;
          else awardedPlayerName = p.name;
          return {
            ...p,
            score: p.score + points,
            stealsCount: newStealsCount,
            specialMovesUsedCount: nextSpecialMovesUsedCount,
            specialMovesUsedNames: nextSpecialMovesUsedNames,
          };
        }
        return p;
      });
    } else if (resolvesAsFail && current.selectedPlayerId) {
      newPlayers = newPlayers.map((p) => {
        if (p.id !== current.selectedPlayerId) return p;
        const nextSpecialMovesUsedCount = shouldTrackSpecialMoveUsage ? (p.specialMovesUsedCount || 0) + 1 : (p.specialMovesUsedCount || 0);
        const nextSpecialMovesUsedNames = shouldTrackSpecialMoveUsage && specialMoveName
          ? [...(Array.isArray(p.specialMovesUsedNames) ? p.specialMovesUsedNames : []), specialMoveName]
          : (Array.isArray(p.specialMovesUsedNames) ? p.specialMovesUsedNames : []);
        return {
          ...p,
          score: p.score + points,
          specialMovesUsedCount: nextSpecialMovesUsedCount,
          specialMovesUsedNames: nextSpecialMovesUsedNames,
        };
      });
    }

    let updatedPlays = current.lastPlays || [];
    try {
      const playEvent: PlayEvent = {
        id: `${Date.now()}-${activeQ.id}-${action}`,
        atIso: new Date().toISOString(),
        atMs: Date.now(),
        action: action.toUpperCase() as any,
        tileId: activeQ.id,
        categoryIndex: catIdx !== -1 ? catIdx : undefined,
        categoryName: activeCat.title || 'Unknown Category',
        rowIndex: qIdx !== -1 ? qIdx : undefined,
        basePoints: activeQ.points,
        effectivePoints: (action === 'award' || action === 'steal') ? points : undefined,
        attemptedPlayerId: attemptedPlayer?.id,
        attemptedPlayerName: attemptedPlayer?.name || 'Unknown Player',
        awardedPlayerId: action === 'award' ? targetPlayerId : undefined,
        awardedPlayerName: action === 'award' ? (awardedPlayerName || 'Unknown Player') : undefined,
        stealerPlayerId: action === 'steal' ? targetPlayerId : undefined,
        stealerPlayerName: action === 'steal' ? (stealerPlayerName || 'Unknown Player') : undefined,
        notes: activeQ.isDoubleOrNothing ? 'Double or Nothing Applied' : undefined
      };

      updatedPlays = [playEvent, ...updatedPlays].slice(0, 4);

      logger.info("game_play_event", {
        atIso: playEvent.atIso,
        atMs: playEvent.atMs,
        action: playEvent.action,
        tileId: playEvent.tileId,
        categoryName: playEvent.categoryName,
        basePoints: playEvent.basePoints,
        effectivePoints: playEvent.effectivePoints,
        attemptedPlayerName: playEvent.attemptedPlayerName,
        awardedPlayerName: playEvent.awardedPlayerName,
        stealerPlayerName: playEvent.stealerPlayerName
      });
    } catch (err: any) {
      logger.error("game_play_event_failed", { 
        atIso: new Date().toISOString(), 
        action, 
        tileId: activeQ.id, 
        message: err.message 
      });
    }

    const newState: GameState = {
      ...current,
      categories: newCategories,
      players: newPlayers,
      activeQuestionId: null,
      activeCategoryId: null,
      timer: { ...current.timer, endTime: null, isRunning: false },
      lastPlays: updatedPlays
    };
    stopQuestionTimer();
    setActiveTileMoveType(undefined);

    // saveGameState FIRST (direct update, synchronous localStorage write) so the
    // subsequent emitGameEvent functional updaters receive the correct closed/scored
    // state in their `prev` argument, preventing stale-prev localStorage overwrites.
    saveGameState(newState);
    resolvingQuestionIdRef.current = null;

    // LOG ANALYTICS (CANONICAL BUS) — after saveGameState so prev is fresh
    const tileCtx = {
      tileId: activeQ.id,
      categoryName: activeCat.title,
      points: activeQ.points,
      categoryIndex: catIdx,
      rowIndex: qIdx,
      specialMoveType: tileMoveType,
      specialMoveName,
    };
    if (action === 'award' && targetPlayerId) {
       const p = current.players.find(pl => pl.id === targetPlayerId);
       emitGameEvent('POINTS_AWARDED', { actor: { role: 'director' }, context: { ...tileCtx, playerName: p?.name, delta: points } });
    } else if (action === 'steal' && targetPlayerId) {
       const stealer = current.players.find(pl => pl.id === targetPlayerId);
       const victim = current.players.find(pl => pl.id === current.selectedPlayerId);
       emitGameEvent('POINTS_STOLEN', { actor: { role: 'director' }, context: { ...tileCtx, playerName: stealer?.name, delta: points, note: `Stolen from ${victim?.name}` } });
    } else if (action === 'void') {
       emitGameEvent('TILE_VOIDED', { actor: { role: 'director' }, context: { ...tileCtx, note: 'Question voided by producer' } });
    } else if (action === 'return') {
       emitGameEvent('QUESTION_RETURNED', { actor: { role: 'director' }, context: { ...tileCtx } });
      if (resolvesAsFail) {
        const failedPlayer = current.players.find((p) => p.id === current.selectedPlayerId);
        emitGameEvent('SCORE_ADJUSTED', {
          actor: { role: 'director' },
          context: {
            ...tileCtx,
            playerName: failedPlayer?.name,
            playerId: failedPlayer?.id,
            delta: points,
            note: `Special move failure (${tileMoveType || 'UNKNOWN_MOVE'})`
          }
        });
      }
    }

    if ((action === 'award' || action === 'steal') && targetPlayerId) {
      const name = newPlayers.find(p => p.id === targetPlayerId)?.name || 'Unknown';
      addToast('success', `${points} Points to ${name} ${action === 'steal' ? '(Steal!)' : ''}`);
    } else if (resolvesAsFail) {
      const attemptedName = attemptedPlayer?.name || 'Unknown';
      addToast('error', `${Math.abs(points)} points lost by ${attemptedName}`);
    }
  };

  const handleAddPlayer = (name: string) => {
    const finalName = normalizePlayerName(name);
    if (!finalName || finalName.length < 2) {
      addToast('error', 'ENTER PLAYER NAME');
      logger.warn('player_add_skipped_empty_name', { input: name });
      return;
    }

    if (gameState.players.length >= 8) {
      addToast('error', 'Maximum 8 players allowed.');
      return;
    }

    let uniqueName = finalName;
    let count = 2;
    const existingNames = gameState.players.map(p => p.name.toUpperCase());
    while (existingNames.includes(uniqueName)) {
      uniqueName = `${finalName} ${count}`;
      count++;
    }
    const newPlayer: Player = {
      id: crypto.randomUUID(),
      name: uniqueName,
      score: 0,
      color: '#fff',
      wildcardsUsed: 0,
      wildcardActive: false,
      stealsCount: 0,
      specialMovesUsedCount: 0,
      specialMovesUsedNames: [],
    };
    
    emitGameEvent('PLAYER_ADDED', {
      actor: { role: 'director' },
      context: { playerName: uniqueName, playerId: newPlayer.id, note: 'Contestant joined via Quick Entry' }
    });

    saveGameState({ ...gameState, players: [...gameState.players, newPlayer], selectedPlayerId: gameState.selectedPlayerId || newPlayer.id });
  };

  const handleUpdateScore = (playerId: string, delta: number) => {
    const p = gameState.players.find(pl => pl.id === playerId);
    if (p) {
      emitGameEvent('SCORE_ADJUSTED', {
         actor: { role: 'director' },
         context: { playerName: p.name, playerId, delta, note: 'Manual score adjustment' }
      });
    }
    saveGameState({ ...gameState, players: gameState.players.map(p => p.id === playerId ? { ...p, score: p.score + delta } : p) });
  };

  const handleSelectPlayer = (id: string) => {
    const p = gameState.players.find(pl => pl.id === id);
    soundService.playSelect();
    emitGameEvent('PLAYER_SELECTED', {
       actor: { role: 'director' },
       context: { playerId: id, playerName: p?.name }
    });
    saveGameState({ ...gameState, selectedPlayerId: id });
  };

  if (!authChecked) return (
    <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
      <div className="flex flex-col items-center gap-4">
         <Loader2 className="w-12 h-12 text-gold-500 animate-spin" />
         <p className="text-zinc-500 text-sm uppercase tracking-widest font-bold">Loading Studio...</p>
      </div>
    </div>
  );

  if (!isConfigured) return (
    <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div className="max-w-md w-full p-8 border border-gold-600 rounded-2xl bg-zinc-900 text-center relative overflow-hidden">
        <h1 className="text-3xl font-serif text-gold-500 mb-4">SYSTEM BOOTSTRAP</h1>
        <button onClick={handleBootstrap} className="w-full bg-gold-600 text-black font-bold py-3 rounded uppercase tracking-wider hover:bg-gold-500">Create Master Admin</button>
      </div>
    </div>
  );

  if (bootstrapToken) return (
    <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
      <div className="max-w-md w-full p-8 border border-red-600 rounded-2xl bg-zinc-900 text-center">
         <h1 className="text-3xl font-serif text-red-500 mb-4">MASTER TOKEN GENERATED</h1>
         <div className="bg-black p-4 rounded border border-zinc-700 flex items-center justify-between mb-8">
           <code className="text-gold-500 font-mono text-lg">{bootstrapToken}</code>
           <button onClick={() => navigator.clipboard.writeText(bootstrapToken)} className="text-zinc-500 hover:text-white"><Copy className="w-5 h-5"/></button>
         </div>
         <button onClick={() => setBootstrapToken(null)} className="w-full bg-zinc-800 text-white font-bold py-3 rounded uppercase tracking-wider">I have saved it safely</button>
      </div>
    </div>
  );

  if (isPopoutView) {
    if (!session) return <div className="p-8 text-center text-white">Authentication required.</div>;
    return (
      <div className="h-screen w-screen bg-zinc-950 text-white overflow-hidden">
        <DirectorPanel
          gameState={gameState}
          onUpdateState={saveGameState}
          emitGameEvent={emitGameEvent}
          addToast={addToast}
          gameId={activeShow?.id}
          specialMovesOverlay={specialMovesOverlay}
          questionTimer={questionTimer}
          questionTimerEnabled={questionTimerEnabled}
          questionTimerDurationSeconds={questionTimerDurationSeconds}
          onQuestionTimerToggle={handleToggleQuestionTimerEnabled}
          onQuestionTimerDurationChange={handleSetQuestionTimerDuration}
          onQuestionTimerRestart={() => {
            restartQuestionTimer();
            emitGameEvent('QUESTION_COUNTDOWN_START', { actor: { role: 'director' }, context: { note: `Question countdown restarted (${questionTimerDurationSeconds}s)` } });
          }}
          onQuestionTimerStop={() => {
            stopQuestionTimer();
            emitGameEvent('QUESTION_COUNTDOWN_STOPPED', { actor: { role: 'director' }, context: { note: 'Question countdown stopped' } });
          }}
          sessionTimer={sessionTimer}
          sessionTimerEnabled={sessionTimerEnabled}
          onSessionTimerToggle={handleToggleSessionTimerEnabled}
          onSessionTimerStart={handleStartSessionTimer}
          onSessionTimerPause={handlePauseSessionTimer}
          onSessionTimerReset={handleResetSessionTimer}
          timerAudio={timerAudio}
          onSetTimerSoundEnabled={setTimerSoundEnabled}
          onSetTimerMuted={setTimerMuted}
          onIncreaseTimerVolume={increaseTimerVolume}
          onDecreaseTimerVolume={decreaseTimerVolume}
        />
        <ToastContainer toasts={toasts} removeToast={removeToast} />
      </div>
    );
  }

  const activeCategory = gameState.categories.find(c => c.id === gameState.activeCategoryId);
  const activeQuestion = activeCategory?.questions.find(q => q.id === gameState.activeQuestionId);
  const isAdmin = session?.role === 'ADMIN' || session?.role === 'MASTER_ADMIN';
  const showShortcuts = viewMode === 'BOARD' && gameState.isGameStarted;

  return (
    <AppShell activeShowTitle={gameState.showTitle || (activeShow ? activeShow.title : undefined)} username={session?.username} onLogout={handleLogout} shortcuts={showShortcuts ? <ShortcutsPanel /> : null}>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <ConfirmationModal isOpen={showEndGameConfirm} title="End Game?" message="This will close the current game session and return to the template library." confirmLabel="End Game" isDanger={true} onConfirm={handleEndGame} onCancel={() => setShowEndGameConfirm(false)} />
      <EndGameCelebrationModal
        isOpen={isEndGameCelebrationOpen}
        result={celebrationResult}
        onClose={() => setIsEndGameCelebrationOpen(false)}
      />
      {showTimerExpiredPrompt && (
        <div className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-zinc-950 border border-gold-500/40 rounded-2xl p-6">
            <h3 className="text-gold-500 text-lg font-black uppercase tracking-wider">Game Timer Complete</h3>
            <p className="text-zinc-300 text-sm mt-2">Time is up. Continue playing or end now and lock all unopened tiles.</p>
            <div className="mt-4 bg-black/50 border border-zinc-800 rounded-xl p-4 max-h-64 overflow-y-auto">
              <div className="text-[11px] uppercase tracking-widest text-zinc-500 font-bold mb-3">Current Standings</div>
              <div className="space-y-2">
                {[...gameState.players].sort((a, b) => b.score - a.score).map((p) => (
                  <div key={p.id} className="flex justify-between text-sm text-zinc-200">
                    <span>{p.name}</span>
                    <span className="font-mono text-gold-400">{p.score}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
              <button onClick={handleContinueAfterTimerExpired} className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-black uppercase text-xs">Continue Game</button>
              <button onClick={handleEndGameAfterTimerExpired} className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black uppercase text-xs">End Game Now</button>
            </div>
          </div>
        </div>
      )}
      {!session ? (
        <LoginScreen onLoginSuccess={handleLoginSuccess} addToast={addToast} />
      ) : (
        <>
          {!activeShow ? (
            <>
               <ShowSelection username={session.username} onSelectShow={setActiveShow} />
               {isAdmin && (
                 <div className="absolute bottom-4 right-4">
                   <button onClick={() => setViewMode('ADMIN')} className="flex items-center gap-2 text-xs font-bold uppercase text-zinc-500 hover:text-gold-500 bg-zinc-900 border border-zinc-800 px-3 py-2 rounded-full relative group">
                     <Shield className="w-3 h-3" /> Admin Console
                     {pendingRequests > 0 && <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center animate-bounce shadow-lg shadow-red-500/50">{pendingRequests}</span>}
                   </button>
                 </div>
               )}
               {viewMode === 'ADMIN' && <div className="fixed inset-0 z-50"><AdminPanel currentUser={session.username} onClose={() => setViewMode('BOARD')} addToast={addToast} /></div>}
            </>
          ) : (
            <>
               {!gameState.isGameStarted && (
                 <div className="flex justify-center mb-2 pt-2 relative z-20">
                   <div className="bg-zinc-900 border border-zinc-800 p-1 rounded-full flex gap-1">
                     <button onClick={() => setViewMode('BOARD')} className={`px-6 py-2 rounded-full text-xs font-bold uppercase flex items-center gap-2 ${viewMode === 'BOARD' ? 'bg-gold-600 text-black' : 'text-zinc-500 hover:text-white'}`}><Monitor className="w-3 h-3" /> Board</button>
                     <button onClick={() => setViewMode('DIRECTOR')} className={`px-6 py-2 rounded-full text-xs font-bold uppercase flex items-center gap-2 ${viewMode === 'DIRECTOR' ? 'bg-gold-600 text-black' : 'text-zinc-500 hover:bg-zinc-900'}`}><Grid className="w-3 h-3" /> Director</button>
                     {isAdmin && <button onClick={() => setViewMode('ADMIN')} className={`px-6 py-2 rounded-full text-xs font-bold uppercase flex items-center gap-2 ${viewMode === 'ADMIN' ? 'bg-purple-600 text-white' : 'text-zinc-500 hover:text-white'}`}><Shield className="w-3 h-3" /> Admin</button>}
                   </div>
                 </div>
               )}
               <div className={`flex-1 relative overflow-hidden lg:h-full transition-all duration-300 ${editingTemplateStatus ? 'z-[100]' : ''}`}>
                 <div className={`absolute inset-0 transition-opacity duration-300 ${viewMode === 'BOARD' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                    {!gameState.isGameStarted ? (
                      <TemplateDashboard 
                        show={activeShow} 
                        onSwitchShow={() => setActiveShow(null)} 
                        onPlayTemplate={handlePlayTemplate} 
                        addToast={addToast} 
                        onLogout={handleLogout}
                        onBuilderToggle={(isOpen: boolean) => setEditingTemplateStatus(isOpen)}
                      />
                    ) : (
                      <div className="flex flex-col md:flex-row h-full w-full overflow-y-auto lg:overflow-hidden lg:h-full bg-gradient-to-b from-[#F7F3EA] to-[#EFE7D8]">
                        <div className="flex-1 order-2 md:order-1 h-full lg:overflow-hidden relative flex flex-col min-w-0">
                          <div className="flex-none h-12 px-4 flex items-center justify-between border-b border-zinc-800/20 bg-white/40 backdrop-blur-md z-20">
                            <button onClick={() => { soundService.playClick(); setShowEndGameConfirm(true); }} type="button" className="text-[10px] md:text-xs uppercase text-red-500 hover:text-red-600 font-bold tracking-wider flex items-center gap-2"><Power className="w-3 h-3" /> End Show</button>
                            <button onClick={() => setViewMode('DIRECTOR')} className="text-[10px] md:text-xs uppercase font-bold text-zinc-500 hover:text-zinc-800 flex items-center gap-2 px-3 py-1.5 rounded transition-colors"><Grid className="w-3 h-3" /> Director</button>
                          </div>
                          <div className="flex-1 relative w-full h-full lg:overflow-hidden"><GameBoard categories={gameState.categories} onSelectQuestion={handleSelectQuestion} viewSettings={gameState.viewSettings} overlay={specialMovesOverlay} resolvedSpecialMoveTileIds={resolvedSpecialMoveTileIds} sessionTimerActive={sessionTimer.isRunning || (sessionTimer.isStopped && sessionTimer.remainingSeconds > 0)} sessionTimeRemaining={sessionTimer.remainingSeconds} /></div>
                        </div>
                        <div className="order-1 md:order-2 flex-none h-auto lg:h-full w-full md:w-auto relative z-30">
                          <Scoreboard players={gameState.players} selectedPlayerId={gameState.selectedPlayerId} onAddPlayer={handleAddPlayer} onUpdateScore={handleUpdateScore} onSelectPlayer={handleSelectPlayer} gameActive={gameState.isGameStarted} viewSettings={gameState.viewSettings} />
                        </div>
                        {activeQuestion && activeCategory && (
                          (() => {
                            const modalSpecialMove = getQuestionModalSpecialMoveModel(activeTileMoveType);
                            const allowSteal = !isStealBlockedForMove(activeTileMoveType);
                            return (
                          <QuestionModal 
                            question={activeQuestion} 
                            categoryTitle={activeCategory.title} 
                            players={gameState.players} 
                            selectedPlayerId={gameState.selectedPlayerId} 
                            timer={gameState.timer}
                            viewSettings={gameState.viewSettings}
                            allowSteal={allowSteal}
                            stealDisabledReason={allowSteal ? undefined : 'Steal disabled by active special move'}
                            specialMoveSummary={modalSpecialMove}
                            questionCountdownRemainingSeconds={questionTimer.remainingSeconds}
                            questionCountdownDurationSeconds={questionTimer.durationSeconds}
                            isQuestionCountdownRunning={questionTimer.isRunning && questionTimer.activeQuestionId === activeQuestion.id}
                            onQuestionCountdownRestart={() => {
                              restartQuestionTimer();
                              emitGameEvent('QUESTION_COUNTDOWN_START', { actor: { role: 'director' }, context: { tileId: activeQuestion.id, note: `Question countdown restarted (${questionTimerDurationSeconds}s)` } });
                            }}
                            onQuestionCountdownStop={() => {
                              stopQuestionTimer();
                              emitGameEvent('QUESTION_COUNTDOWN_STOPPED', { actor: { role: 'director' }, context: { tileId: activeQuestion.id, note: 'Question countdown stopped from question screen' } });
                            }}
                            onClose={handleQuestionClose}
                            onReveal={() => {
                              emitGameEvent('ANSWER_REVEALED', {
                                actor: { role: 'director' },
                                context: { tileId: activeQuestion.id, points: activeQuestion.points, categoryName: activeCategory.title }
                              });
                              const newState = { ...gameState, categories: gameState.categories.map(c => c.id === gameState.activeCategoryId ? { ...c, questions: c.questions.map(q => q.id === gameState.activeQuestionId ? { ...q, isRevealed: true } : q) } : c) };
                              saveGameState(newState);
                            }}
                            onTimerEnd={() => {
                              emitGameEvent('TIMER_FINISHED', { actor: { role: 'system' }, context: { tileId: activeQuestion.id, points: activeQuestion.points } });
                            }}
                          />
                            );
                          })()
                        )}
                      </div>
                    )}
                 </div>
                 <div className={`absolute inset-0 transition-opacity duration-300 bg-zinc-950 ${viewMode === 'DIRECTOR' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
                   <DirectorPanel
                     gameState={gameState}
                     onUpdateState={saveGameState}
                     emitGameEvent={emitGameEvent}
                     onPopout={handlePopout}
                     isPoppedOut={isDirectorPoppedOut}
                     onBringBack={handleBringBack}
                     addToast={addToast}
                     onClose={() => setViewMode('BOARD')}
                     gameId={activeShow?.id}
                     specialMovesOverlay={specialMovesOverlay}
                     questionTimer={questionTimer}
                     questionTimerEnabled={questionTimerEnabled}
                     questionTimerDurationSeconds={questionTimerDurationSeconds}
                     onQuestionTimerToggle={handleToggleQuestionTimerEnabled}
                     onQuestionTimerDurationChange={handleSetQuestionTimerDuration}
                     onQuestionTimerRestart={() => {
                       restartQuestionTimer();
                       emitGameEvent('QUESTION_COUNTDOWN_START', { actor: { role: 'director' }, context: { note: `Question countdown restarted (${questionTimerDurationSeconds}s)` } });
                     }}
                     onQuestionTimerStop={() => {
                       stopQuestionTimer();
                       emitGameEvent('QUESTION_COUNTDOWN_STOPPED', { actor: { role: 'director' }, context: { note: 'Question countdown stopped' } });
                     }}
                     sessionTimer={sessionTimer}
                     sessionTimerEnabled={sessionTimerEnabled}
                     onSessionTimerToggle={handleToggleSessionTimerEnabled}
                     onSessionTimerStart={handleStartSessionTimer}
                     onSessionTimerPause={handlePauseSessionTimer}
                     onSessionTimerReset={handleResetSessionTimer}
                     timerAudio={timerAudio}
                     onSetTimerSoundEnabled={setTimerSoundEnabled}
                     onSetTimerMuted={setTimerMuted}
                     onIncreaseTimerVolume={increaseTimerVolume}
                     onDecreaseTimerVolume={decreaseTimerVolume}
                   />
                 </div>
                 {viewMode === 'ADMIN' && <div className="absolute inset-0 z-50 bg-zinc-950"><AdminPanel currentUser={session.username} onClose={() => setViewMode('BOARD')} addToast={addToast} /></div>}
               </div>
            </>
          )}
        </>
      )}
    </AppShell>
  );
};

export default App;
