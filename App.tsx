import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AppShell } from './components/AppShell';
import { ToastContainer } from './components/Toast';
import { LoginScreen } from './components/LoginScreen';
import { BootstrapScreen } from './components/BootstrapScreen';
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
import { GameState, Category, Player, ToastMessage, Question, Show, GameTemplate, UserRole, Session, BoardViewSettings, PlayEvent, AnalyticsEventType, GameAnalyticsEvent } from './types';
import { QuestionCountdownTimer, SessionGameTimer, TimerAudioSettings } from './types';
import { soundService } from './services/soundService';
import { logger } from './services/logger';
import { normalizePlayerName } from './services/utils';
import { useSpecialMovesOverlay } from './hooks/useSpecialMovesOverlay';
import { applySpecialMovesDecorator } from './modules/specialMoves/scoringDecorator';
import { getDefaultBoardViewSettings, sanitizeBoardViewSettings } from './services/boardViewSettings';
import { deriveEndGameCelebrationResult, isTriviaBoardComplete } from './services/endGameCelebration';
import { Monitor, Grid, Shield, Copy, Loader2, ExternalLink, Power } from 'lucide-react';
import { firebaseConfigError, missingKeys } from './services/firebase';

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
  const [systemStatusError, setSystemStatusError] = useState<string | null>(null);
  

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

  const [questionTimerEnabled, setQuestionTimerEnabled] = useState(true);
  const [questionTimerDurationSeconds, setQuestionTimerDurationSeconds] = useState(DEFAULT_QUESTION_TIMER_DURATION_SECONDS);

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

  const [timerAudio, setTimerAudio] = useState<TimerAudioSettings>({
    enabled: true,
    muted: soundService.getMute?.() ?? false,
    volume: soundService.getVolume?.() ?? 0.5,
    tickSoundEnabled: true,
    endSoundEnabled: true,
  });

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const specialMovesOverlay = useSpecialMovesOverlay(gameState.isGameStarted ? activeShow?.id : undefined);
  const isBoardComplete = useMemo(() => isTriviaBoardComplete(gameState.categories), [gameState.categories]);
  const celebrationResult = useMemo(() => deriveEndGameCelebrationResult(gameState.players), [gameState.players]);
  const questionTimerDurationRef = useRef(questionTimerDurationSeconds);

  useEffect(() => {
    questionTimerDurationRef.current = questionTimerDurationSeconds;
  }, [questionTimerDurationSeconds]);

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
        setQuestionTimerEnabled(payload.questionTimerEnabled !== false);
        setQuestionTimerDurationSeconds(nextDuration);
        if (payload.questionTimer) setQuestionTimer(payload.questionTimer);
        if (payload.sessionTimer) setSessionTimer(payload.sessionTimer);
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
        questionTimerDurationSeconds,
        questionTimer,
        sessionTimer,
      })
    );
  }, [questionTimerEnabled, questionTimerDurationSeconds, questionTimer, sessionTimer]);

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
    if (session?.role === 'MASTER_ADMIN') {
        const check = async () => {
            try {
              const pending = await authService.getPendingRequestCount(session.username);
              setPendingRequests(prev => {
                  if (pending > prev) {
                      soundService.playToast('info');
                      addToast('info', `New Request: ${pending} Pending`);
                  }
                  return pending;
              });
            } catch {
              setPendingRequests(0);
            }
        };
        void check(); 
        interval = window.setInterval(() => { void check(); }, 30000); 
    } else {
      setPendingRequests(0);
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

  const initializeApp = useCallback(async () => {
     setAuthChecked(false);
     setSystemStatusError(null);
     try {
       const status = await authService.getBootstrapStatus();
       setIsConfigured(status.masterReady);

       if (!status.masterReady) {
         logger.warn('bootstrap_visible_backend_uninitialized', {
           bootstrapCompleted: status.bootstrapCompleted ?? false,
           initializedAt: status.initializedAt ?? null,
         });
       } else {
         logger.info('bootstrap_suppressed_backend_initialized', {
           bootstrapCompleted: status.bootstrapCompleted ?? true,
           initializedAt: status.initializedAt ?? null,
         });

         const storedSessionId = localStorage.getItem('cruzpham_active_session_id') || (() => {
           try {
             const legacySession = localStorage.getItem('cruzpham_user_session');
             if (!legacySession) return null;
             const parsed = JSON.parse(legacySession);
             return typeof parsed?.id === 'string' ? parsed.id : null;
           } catch {
             return null;
           }
         })();
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
             localStorage.removeItem('cruzpham_user_session');
             localStorage.removeItem('cruzpham_ui_state');
           }
         }
       }
       
       const savedState = localStorage.getItem('cruzpham_gamestate');
       if (savedState) {
         const parsed = JSON.parse(savedState);
         parsed.viewSettings = sanitizeBoardViewSettings(parsed.viewSettings);
         
         if (!parsed.lastPlays) parsed.lastPlays = [];
         if (!parsed.events) parsed.events = [];
         
         setGameState(parsed);
         if (parsed.showTitle) {
            setActiveShow(prev => prev || { id: 'restored-ghost', userId: 'restored', title: parsed.showTitle, createdAt: '' });
         }
       }

       const savedTimerState = localStorage.getItem(TIMER_STATE_STORAGE_KEY);
       if (savedTimerState) {
         try {
           const timerState = JSON.parse(savedTimerState);
           const resolvedDuration = resolveQuestionCountdownDuration(timerState.questionTimerDurationSeconds);
           setQuestionTimerEnabled(timerState.questionTimerEnabled !== false);
           setQuestionTimerDurationSeconds(resolvedDuration);
           if (timerState.questionTimer) setQuestionTimer(timerState.questionTimer);
           if (timerState.sessionTimer) setSessionTimer(timerState.sessionTimer);
         } catch (error: any) {
           logger.warn('timer_state_restore_failed', { message: error?.message });
         }
       }
     } catch (e: any) {
       const bootstrapErrorMessage = String(e?.message || '');
       const isBootstrapTransportFailure = e?.code === 'ERR_NETWORK'
         || e?.name === 'TypeError'
         || /cors|cross-origin|failed to fetch|network/i.test(bootstrapErrorMessage);

       logger.error('bootstrap_error_occurred', {
         message: e?.message,
         code: e?.code,
       });
       // ERR_NETWORK = transport failure (CORS, fetch blocked, connection timeout, etc.)
       // These are NOT server initialization failures, so we allow local bootstrap to proceed
       if (isBootstrapTransportFailure) {
         logger.warn('bootstrap_network_unavailable_using_local', {
           fallbackMode: 'local_authority',
           isTransport: true,
           message: bootstrapErrorMessage,
         });
         // Don't set systemStatusError; allow Bootstrap screen to show with local mode
         // The app will complete and isConfigured will default to false,
         // which triggers the Bootstrap screen. This allows user to bootstrap locally
         // even when backend is temporarily unreachable or has CORS issues.
       } else {
         // Unexpected/unclassified error; show recovery UI
         logger.error('bootstrap_unexpected_error', { 
           code: e?.code,
           message: e?.message,
         });
         setSystemStatusError('Unable to verify system status. Please try again or contact support.');
       }
       console.error('System Initialization Error', e);
     } finally {
       setAuthChecked(true);
     }
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('view') === 'director') {
      setIsPopoutView(true);
      setViewMode('DIRECTOR');
      document.title = "Director Panel - CRUZPHAM STUDIOS";
    }

    window.addEventListener('storage', handleStorageChange);
    initializeApp();
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [handleStorageChange, initializeApp]);

  const addToast = (type: ToastMessage['type'], message: string) => {
    setToasts(prev => [...prev, { id: Math.random().toString(), type, message }]);
  };
  const removeToast = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  // --- ACTIONS ---


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
      id: crypto.randomUUID(), name: normalizePlayerName(name), score: 0, color: '#ffffff', wildcardsUsed: 0, wildcardActive: false, stealsCount: 0
    }));

    if (initPlayers.length === 0 && targetPlayerCount > 0) {
      for (let i = 0; i < targetPlayerCount; i++) {
        initPlayers.push({ id: crypto.randomUUID(), name: `PLAYER ${i + 1}`, score: 0, color: '#ffffff', wildcardsUsed: 0, wildcardActive: false, stealsCount: 0 });
      }
    }

    logger.info('template_quick_setup_applied', {
      templateId: template.id,
      quickGameMode: template.config?.quickGameMode || null,
      quickTimerMode: template.config?.quickTimerMode || null,
      playerCount: initPlayers.length,
      timerEnabled: timerEnabledFromTemplate,
    });

    setQuestionTimerEnabled(timerEnabledFromTemplate);

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

    emitGameEvent('TILE_OPENED', {
       actor: { role: 'director' },
       context: { tileId: qId, categoryName: cat?.title, points: q?.points }
    });

    if (questionTimerEnabled) {
      const selectedDuration = resolveQuestionCountdownDuration(questionTimerDurationRef.current);
      startQuestionTimer(qId, selectedDuration);
      emitGameEvent('QUESTION_COUNTDOWN_START', {
        actor: { role: 'director' },
        context: { tileId: qId, note: `Question countdown auto-started (${selectedDuration}s)` }
      });
    }

    saveGameState({ ...gameState, activeCategoryId: catId, activeQuestionId: qId });
  };

  const handleQuestionClose = (action: 'return' | 'void' | 'award' | 'steal', targetPlayerId?: string) => {
    const current = gameStateRef.current;
    const catIdx = current.categories.findIndex(c => c.id === current.activeCategoryId);
    const activeCat = current.categories[catIdx];
    const qIdx = activeCat?.questions.findIndex(q => q.id === current.activeQuestionId);
    const activeQ = activeCat?.questions[qIdx];

    if (!activeCat || !activeQ) {
       saveGameState({ ...current, activeQuestionId: null, activeCategoryId: null });
       return;
    }

    const basePoints = (activeQ.isDoubleOrNothing ? activeQ.points * 2 : activeQ.points);
    const tileMoveType = specialMovesOverlay?.deploymentsByTileId?.[activeQ.id]?.moveType;
    const points = (action === 'award' || action === 'steal')
      ? applySpecialMovesDecorator(basePoints, {
          tileId: activeQ.id,
          moveType: tileMoveType,
          outcome: action === 'award' ? 'AWARD' : 'STEAL'
        })
      : basePoints;

    // LOG ANALYTICS (CANONICAL BUS)
    const tileCtx = { tileId: activeQ.id, categoryName: activeCat.title, points: activeQ.points, categoryIndex: catIdx, rowIndex: qIdx };
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
    }

    const newCategories = current.categories.map(c => {
      if (c.id !== current.activeCategoryId) return c;
      return {
        ...c,
        questions: c.questions.map(q => {
          if (q.id !== current.activeQuestionId) return q;
          return {
            ...q,
            isRevealed: false, 
            isAnswered: action === 'award' || action === 'steal',
            isVoided: action === 'void'
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
          if (isSteal) stealerPlayerName = p.name;
          else awardedPlayerName = p.name;
          return { ...p, score: p.score + points, stealsCount: newStealsCount };
        }
        return p;
      });
    }

    // "LAST 4 PLAYS" REAL-TIME LOG (RING BUFFER)
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
    saveGameState(newState);

    if ((action === 'award' || action === 'steal') && targetPlayerId) {
      const name = newPlayers.find(p => p.id === targetPlayerId)?.name || 'Unknown';
      addToast('success', `${points} Points to ${name} ${action === 'steal' ? '(Steal!)' : ''}`);
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
    const newPlayer: Player = { id: crypto.randomUUID(), name: uniqueName, score: 0, color: '#fff', wildcardsUsed: 0, wildcardActive: false, stealsCount: 0 };
    
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

  const activeCategory = gameState.categories.find(c => c.id === gameState.activeCategoryId);
  const activeQuestion = activeCategory?.questions.find(q => q.id === gameState.activeQuestionId);
  const isMasterAdmin = session?.role === 'MASTER_ADMIN';
  const showShortcuts = viewMode === 'BOARD' && gameState.isGameStarted;

  useEffect(() => {
    if (viewMode === 'ADMIN' && !isMasterAdmin) {
      setViewMode('BOARD');
    }
  }, [viewMode, isMasterAdmin]);

  if (!authChecked) return (
    <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
      <div className="flex flex-col items-center gap-4">
         <Loader2 className="w-12 h-12 text-gold-500 animate-spin" />
         <p className="text-zinc-500 text-sm uppercase tracking-widest font-bold">Loading Studio...</p>
      </div>
    </div>
  );

  if (systemStatusError) return (
    <div className="h-screen w-screen flex items-center justify-center bg-black text-white px-4">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div className="w-full max-w-lg bg-zinc-900 border border-red-900/60 rounded-2xl p-8 shadow-2xl text-center">
        <p className="text-[10px] uppercase tracking-[0.3em] font-black text-red-400">System Initialization Error</p>
        <h2 className="mt-4 text-3xl font-serif text-white">Unable to Verify Studio Status</h2>
        <p className="mt-4 text-sm text-zinc-300 leading-relaxed">{systemStatusError}</p>
        <p className="mt-2 text-xs text-zinc-500">Bootstrap is hidden until the authoritative backend confirms that the system is uninitialized.</p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <button onClick={() => { void initializeApp(); }} className="px-5 py-3 rounded-xl bg-gold-600 hover:bg-gold-500 text-black font-black uppercase tracking-[0.2em] text-xs">
            Retry Status Check
          </button>
          <a href="mailto:support@cruzpham.com" className="px-5 py-3 rounded-xl border border-zinc-700 hover:border-zinc-500 text-zinc-300 font-black uppercase tracking-[0.2em] text-xs">
            Contact Support
          </a>
        </div>
      </div>
    </div>
  );

  if (!isConfigured) return (
    <div className="h-screen w-screen flex items-center justify-center bg-black text-white">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <BootstrapScreen onComplete={() => setIsConfigured(true)} addToast={addToast} />
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
          onQuestionTimerToggle={setQuestionTimerEnabled}
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
               {isMasterAdmin && (
                 <div className="absolute bottom-4 right-4">
                   <button onClick={() => setViewMode('ADMIN')} className="flex items-center gap-2 text-xs font-bold uppercase text-zinc-500 hover:text-gold-500 bg-zinc-900 border border-zinc-800 px-3 py-2 rounded-full relative group">
                     <Shield className="w-3 h-3" /> Admin Console
                     {pendingRequests > 0 && <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center animate-bounce shadow-lg shadow-red-500/50">{pendingRequests}</span>}
                   </button>
                 </div>
               )}
               {viewMode === 'ADMIN' && isMasterAdmin && <div className="fixed inset-0 z-50"><AdminPanel currentUser={session.username} onClose={() => setViewMode('BOARD')} addToast={addToast} /></div>}
            </>
          ) : (
            <>
               {!gameState.isGameStarted && (
                 <div className="flex justify-center mb-2 pt-2 relative z-20">
                   <div className="bg-zinc-900 border border-zinc-800 p-1 rounded-full flex gap-1">
                     <button onClick={() => setViewMode('BOARD')} className={`px-6 py-2 rounded-full text-xs font-bold uppercase flex items-center gap-2 ${viewMode === 'BOARD' ? 'bg-gold-600 text-black' : 'text-zinc-500 hover:text-white'}`}><Monitor className="w-3 h-3" /> Board</button>
                     <button onClick={() => setViewMode('DIRECTOR')} className={`px-6 py-2 rounded-full text-xs font-bold uppercase flex items-center gap-2 ${viewMode === 'DIRECTOR' ? 'bg-gold-600 text-black' : 'text-zinc-500 hover:bg-zinc-900'}`}><Grid className="w-3 h-3" /> Director</button>
                      {isMasterAdmin && <button onClick={() => setViewMode('ADMIN')} className={`px-6 py-2 rounded-full text-xs font-bold uppercase flex items-center gap-2 ${viewMode === 'ADMIN' ? 'bg-purple-600 text-white' : 'text-zinc-500 hover:text-white'}`}><Shield className="w-3 h-3" /> Admin</button>}
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
                          <div className="flex-1 relative w-full h-full lg:overflow-hidden"><GameBoard categories={gameState.categories} onSelectQuestion={handleSelectQuestion} viewSettings={gameState.viewSettings} overlay={specialMovesOverlay} sessionTimerActive={sessionTimer.isRunning || (sessionTimer.isStopped && sessionTimer.remainingSeconds > 0)} sessionTimeRemaining={sessionTimer.remainingSeconds} /></div>
                        </div>
                        <div className="order-1 md:order-2 flex-none h-auto lg:h-full w-full md:w-auto relative z-30">
                          <Scoreboard players={gameState.players} selectedPlayerId={gameState.selectedPlayerId} onAddPlayer={handleAddPlayer} onUpdateScore={handleUpdateScore} onSelectPlayer={handleSelectPlayer} gameActive={gameState.isGameStarted} viewSettings={gameState.viewSettings} />
                        </div>
                        {activeQuestion && activeCategory && (
                          <QuestionModal 
                            question={activeQuestion} 
                            categoryTitle={activeCategory.title} 
                            players={gameState.players} 
                            selectedPlayerId={gameState.selectedPlayerId} 
                            timer={gameState.timer}
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
                     onQuestionTimerToggle={setQuestionTimerEnabled}
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
                 {viewMode === 'ADMIN' && isMasterAdmin && <div className="absolute inset-0 z-50 bg-zinc-950"><AdminPanel currentUser={session.username} onClose={() => setViewMode('BOARD')} addToast={addToast} /></div>}
               </div>
            </>
          )}
        </>
      )}
    </AppShell>
  );
};

export default App;
