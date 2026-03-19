import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Settings, Users, Grid, Edit, Save, X, RefreshCw, Wand2, MonitorOff, ExternalLink, RotateCcw, Play, Pause, Timer, Type, Layout, Star, Trash2, AlertTriangle, UserPlus, Check, BarChart3, Info, Hash, Clock, History, Copy, Trash, Download, ChevronDown, ChevronUp, Sparkles, Sliders, Loader2, Minus, Plus, ShieldAlert, Volume2 } from 'lucide-react';
import { GameState, Question, Difficulty, Category, BoardViewSettings, Player, PlayEvent, AnalyticsEventType, GameAnalyticsEvent, SpecialMoveType } from '../types';
import { QuestionCountdownTimer, SessionGameTimer, TimerAudioSettings } from '../types';
import { generateSingleQuestion, generateCategoryQuestions } from '../services/geminiService';
import { logger } from '../services/logger';
import { soundService } from '../services/soundService';
import { normalizePlayerName, applyAiCategoryPreservePoints } from '../services/utils';
import { sanitizeBoardViewSettings, sanitizeBoardViewSettingsPatch } from '../services/boardViewSettings';
import { DirectorAiRegenerator } from './DirectorAiRegenerator';
import { DirectorSettingsPanel } from './DirectorSettingsPanel';
import { DirectorSoundBoardPanel } from './DirectorSoundBoardPanel';
import { specialMovesClient, type SMSBackendMode } from '../modules/specialMoves/client/specialMovesClient';
import { SMSOverlayDoc } from '../modules/specialMoves/firestoreTypes';

interface Props {
  gameState: GameState;
  onUpdateState: (newState: GameState) => void;
  emitGameEvent: (type: AnalyticsEventType, payload: Partial<GameAnalyticsEvent>) => void;
  gameId?: string;
  specialMovesOverlay?: SMSOverlayDoc | null;
  onPopout?: () => void;
  isPoppedOut?: boolean;
  onBringBack?: () => void;
  addToast: (type: any, msg: string) => void;
  onClose?: () => void;
  questionTimer?: QuestionCountdownTimer;
  questionTimerEnabled?: boolean;
  questionTimerDurationSeconds?: number;
  onQuestionTimerToggle?: (enabled: boolean) => void;
  onQuestionTimerDurationChange?: (durationSeconds: number) => void;
  onQuestionTimerRestart?: () => void;
  onQuestionTimerStop?: () => void;
  sessionTimer?: SessionGameTimer;
  onSessionTimerStart?: (preset: '15m' | '30m' | '1h' | '1h30m' | '2h') => void;
  onSessionTimerPause?: () => void;
  onSessionTimerReset?: () => void;
  timerAudio?: TimerAudioSettings;
  onSetTimerSoundEnabled?: (enabled: boolean) => void;
  onSetTimerMuted?: (muted: boolean) => void;
  onIncreaseTimerVolume?: () => void;
  onDecreaseTimerVolume?: () => void;
}

export const DirectorPanel: React.FC<Props> = ({ 
  gameState,
  onUpdateState,
  emitGameEvent,
  gameId,
  specialMovesOverlay,
  onPopout,
  isPoppedOut,
  onBringBack,
  addToast,
  onClose,
  questionTimer,
  questionTimerEnabled,
  questionTimerDurationSeconds,
  onQuestionTimerToggle,
  onQuestionTimerDurationChange,
  onQuestionTimerRestart,
  onQuestionTimerStop,
  sessionTimer,
  onSessionTimerStart,
  onSessionTimerPause,
  onSessionTimerReset,
  timerAudio,
  onSetTimerSoundEnabled,
  onSetTimerMuted,
  onIncreaseTimerVolume,
  onDecreaseTimerVolume
}) => {
  type LogChannel = 'ALL' | 'BOARD' | 'SCOREBOARD' | 'AI' | 'SPECIAL_MOVES' | 'SYSTEM';
  type SortOrder = 'NEWEST' | 'OLDEST';

  const [activeTab, setActiveTab] = useState<'GAME' | 'PLAYERS' | 'BOARD' | 'MOVES' | 'MOVES_HELP' | 'COUNTER_STUDIO' | 'SOUND_BOARD' | 'LOGS_AUDIT' | 'STATS' | 'SETTINGS'>('BOARD');
  const [editingQuestion, setEditingQuestion] = useState<{cIdx: number, qIdx: number} | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedMoveType, setSelectedMoveType] = useState<SpecialMoveType>('DOUBLE_TROUBLE');
  const [armingTileId, setArmingTileId] = useState<string | null>(null);
  const [isClearingArmory, setIsClearingArmory] = useState(false);
  const [backendMode, setBackendMode] = useState<SMSBackendMode>(specialMovesClient.getBackendMode());
  const [logQuery, setLogQuery] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState<'ALL' | AnalyticsEventType>('ALL');
  const [channelFilter, setChannelFilter] = useState<LogChannel>('ALL');
  const [keyOnlyFilter, setKeyOnlyFilter] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>('NEWEST');
  
  // Per-tile AI state
  const [tileAiDifficulty, setTileAiDifficulty] = useState<Difficulty>("mixed");
  const [tileAiLoading, setTileAiLoading] = useState(false);
  const tileAiGenIdRef = useRef<string | null>(null);
  const tileSnapshotRef = useRef<Category[] | null>(null);
  
  const [processingWildcards, setProcessingWildcards] = useState<Set<string>>(new Set());
  const [isAddingPlayer, setIsAddingPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [confirmResetAll, setConfirmResetAll] = useState(false);

  const moveLabels: Record<SpecialMoveType, string> = {
    DOUBLE_TROUBLE: 'DOUBLE TROUBLE',
    TRIPLE_THREAT: 'TRIPLE THREAT',
    SABOTAGE: 'SABOTAGE',
    MEGA_STEAL: 'MEGA STEAL'
  };

  const backendModeLabels: Record<SMSBackendMode, string> = {
    FUNCTIONS: 'Functions',
    FIRESTORE_FALLBACK: 'Firestore Fallback',
    MEMORY_FALLBACK: 'In-Memory Fallback'
  };

  const refreshBackendMode = () => setBackendMode(specialMovesClient.getBackendMode());

  const sentenceCase = (value: string) => value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

  const isKeyActivityEvent = (event: GameAnalyticsEvent) => {
    if (event.type === 'POINTS_AWARDED' || event.type === 'POINTS_STOLEN' || event.type === 'TILE_VOIDED' || event.type === 'SPECIAL_MOVE_ARMED' || event.type === 'PLAYER_ADDED') {
      return true;
    }
    return event.type === 'PLAYER_EDITED' && event.context?.note === 'name-changed';
  };

  const getEventChannel = (event: GameAnalyticsEvent): LogChannel => {
    if (event.type.startsWith('AI_')) return 'AI';
    if (event.type.startsWith('SPECIAL_MOVE')) return 'SPECIAL_MOVES';
    if (event.type === 'POINTS_AWARDED' || event.type === 'POINTS_STOLEN' || event.type === 'SCORE_ADJUSTED' || event.type === 'PLAYER_ADDED' || event.type === 'PLAYER_REMOVED' || event.type === 'PLAYER_EDITED' || event.type === 'PLAYER_SELECTED' || event.type === 'WILDCARD_USED' || event.type === 'WILDCARD_RESET') {
      return 'SCOREBOARD';
    }
    if (event.type === 'TILE_OPENED' || event.type === 'ANSWER_REVEALED' || event.type === 'TILE_VOIDED' || event.type === 'QUESTION_RETURNED' || event.type === 'QUESTION_EDITED' || event.type === 'CATEGORY_RENAMED' || event.type === 'VIEW_SETTINGS_CHANGED') {
      return 'BOARD';
    }
    return 'SYSTEM';
  };

  const formatEventSentence = (event: GameAnalyticsEvent): string => {
    const c = event.context || {};
    const points = typeof c.points === 'number' ? c.points : undefined;
    const delta = typeof c.delta === 'number' ? c.delta : undefined;
    const playerName = c.playerName || event.actor?.playerName || 'A player';
    const categoryName = c.categoryName || 'the board';

    switch (event.type) {
      case 'SESSION_STARTED':
        return `The game session started for ${c.note || 'the selected template'}.`;
      case 'SESSION_ENDED':
        return 'The game session ended.';
      case 'TILE_OPENED':
        return `A ${points || 0}-point tile was opened in ${categoryName}.`;
      case 'ANSWER_REVEALED':
        return `The answer was revealed for the ${points || 0}-point tile in ${categoryName}.`;
      case 'POINTS_AWARDED':
        return `${playerName} was awarded ${delta || points || 0} points in ${categoryName}.`;
      case 'POINTS_STOLEN':
        return `${playerName} stole ${delta || points || 0} points${c.note ? ` (${c.note})` : ''}.`;
      case 'TILE_VOIDED':
        return `The ${points || 0}-point tile in ${categoryName} was voided.`;
      case 'QUESTION_RETURNED':
        return `The ${points || 0}-point tile in ${categoryName} was returned to the board.`;
      case 'QUESTION_EDITED':
        return `A board tile was edited in ${categoryName}.`;
      case 'AI_TILE_REPLACE_START':
        return 'AI question regeneration started for a tile.';
      case 'AI_TILE_REPLACE_APPLIED':
        return 'AI question regeneration completed and the tile was updated.';
      case 'AI_TILE_REPLACE_FAILED':
        return `AI question regeneration failed${c.message ? `: ${c.message}` : ''}.`;
      case 'AI_CATEGORY_REPLACE_START':
        return `AI category regeneration started for ${categoryName}.`;
      case 'AI_CATEGORY_REPLACE_APPLIED':
        return `AI category regeneration completed for ${categoryName}.`;
      case 'AI_CATEGORY_REPLACE_FAILED':
        return `AI category regeneration failed for ${categoryName}${c.message ? `: ${c.message}` : ''}.`;
      case 'AI_BOARD_REGEN_START':
        return 'AI board regeneration started.';
      case 'AI_BOARD_REGEN_APPLIED':
        return 'AI board regeneration completed.';
      case 'AI_BOARD_REGEN_FAILED':
        return `AI board regeneration failed${c.message ? `: ${c.message}` : ''}.`;
      case 'PLAYER_ADDED':
        return `${playerName} was added to the scoreboard.`;
      case 'PLAYER_REMOVED':
        return `${playerName} was removed from the scoreboard.`;
      case 'PLAYER_EDITED':
        if (c.note === 'name-changed') {
          return `${c.before || 'A player'} changed name to ${c.after || playerName}.`;
        }
        return `${playerName}'s profile was updated.`;
      case 'PLAYER_SELECTED':
        return `${playerName} was selected as the active player.`;
      case 'SCORE_ADJUSTED':
        return `${playerName}'s score was ${delta && delta >= 0 ? 'increased' : 'decreased'} by ${Math.abs(delta || 0)} points${c.note ? ` (${c.note})` : ''}.`;
      case 'WILDCARD_USED':
        return `${playerName} used a wildcard.`;
      case 'WILDCARD_RESET':
        return `${playerName} had wildcards reset${c.note ? ` (${c.note})` : ''}.`;
      case 'TIMER_CONFIG_CHANGED':
        return 'The question timer configuration was changed.';
      case 'TIMER_STARTED':
        return 'The question timer started.';
      case 'TIMER_STOPPED':
        return 'The question timer was paused.';
      case 'TIMER_RESET':
        return 'The question timer was reset.';
      case 'TIMER_FINISHED':
        return 'The question timer finished.';
      case 'VIEW_SETTINGS_CHANGED':
        return 'Board view settings were updated.';
      case 'CATEGORY_RENAMED':
        return `A category was renamed to ${c.after || categoryName}.`;
      case 'SPECIAL_MOVE_ARMED':
        return `${playerName} armed ${sentenceCase(c.note || 'special move')} on a ${points || 0}-point tile in ${categoryName}.`;
      case 'SPECIAL_MOVE_ARMORY_CLEARED':
        return 'All armed special moves were cleared from the board.';
      default:
        return `${sentenceCase(event.type)} occurred.`;
    }
  };

  const fullHistoryLogs = useMemo(() => {
    const events = [...(gameState.events || [])].sort((a, b) => a.ts - b.ts);
    return events.map((event) => ({
      id: event.id,
      iso: event.iso,
      type: event.type,
      channel: getEventChannel(event),
      event,
      sentence: formatEventSentence(event)
    }));
  }, [gameState.events]);

  const auditEvents = useMemo(() => {
    const selected = [...(gameState.events || [])].filter((event) => isKeyActivityEvent(event));

    const latestTwelve = selected.slice(-12).reverse();
    return latestTwelve.map((event) => ({
      id: event.id,
      iso: event.iso,
      type: event.type,
      channel: getEventChannel(event),
      event,
      sentence: formatEventSentence(event)
    }));
  }, [gameState.events]);

  const filterLogEntries = <T extends { sentence: string; type: AnalyticsEventType; channel: LogChannel; event: GameAnalyticsEvent }>(entries: T[]) => {
    const normalizedQuery = logQuery.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      if (eventTypeFilter !== 'ALL' && entry.type !== eventTypeFilter) return false;
      if (channelFilter !== 'ALL' && entry.channel !== channelFilter) return false;
      if (keyOnlyFilter && !isKeyActivityEvent(entry.event)) return false;
      if (!normalizedQuery) return true;

      const haystack = [
        entry.sentence,
        sentenceCase(entry.type),
        entry.event.context?.playerName || '',
        entry.event.context?.categoryName || '',
        entry.event.context?.note || ''
      ].join(' ').toLowerCase();

      return haystack.includes(normalizedQuery);
    });

    return sortOrder === 'NEWEST' ? [...filtered].reverse() : filtered;
  };

  const filteredHistoryLogs = useMemo(() => filterLogEntries(fullHistoryLogs), [fullHistoryLogs, logQuery, eventTypeFilter, channelFilter, keyOnlyFilter, sortOrder]);
  const filteredAuditEvents = useMemo(() => filterLogEntries(auditEvents), [auditEvents, logQuery, eventTypeFilter, channelFilter, keyOnlyFilter, sortOrder]);

  const clearLogFilters = () => {
    setLogQuery('');
    setEventTypeFilter('ALL');
    setChannelFilter('ALL');
    setKeyOnlyFilter(false);
    setSortOrder('NEWEST');
  };

  const downloadLogs = (entries: Array<{ iso: string; sentence: string }>, filenamePrefix: string) => {
    try {
      const lines = entries.map((entry) => `[${entry.iso}] ${entry.sentence}`);
      const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${filenamePrefix}-${stamp}.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
      addToast('success', 'Logs downloaded.');
    } catch (e: any) {
      logger.error('director_log_download_failed', { error: e.message });
      addToast('error', 'Failed to download logs.');
    }
  };

  const currentOverlay = specialMovesOverlay || {
    deploymentsByTileId: {},
    activeByTargetId: {},
    updatedAt: Date.now(),
    version: 1
  };

  // --- CLEANUP ON MODAL CLOSE ---
  useEffect(() => {
    if (editingQuestion === null) {
      setTileAiLoading(false);
      tileAiGenIdRef.current = null;
      tileSnapshotRef.current = null;
    }
  }, [editingQuestion]);

  // --- AUDIT LOGS ---
  useEffect(() => {
    if (activeTab === 'PLAYERS') {
      const count = gameState.players?.length || 0;
      logger.info('director_players_render', { count });
      if (count === 0) {
        logger.warn('director_players_missing', { count: 0 });
      }
    }
  }, [activeTab, gameState.players?.length]);

  useEffect(() => {
    if (activeTab === 'MOVES') refreshBackendMode();
  }, [activeTab]);

  // --- ACTIONS ---

  const handleUpdatePlayer = (id: string, field: keyof Player, value: any) => {
    try {
      logger.info('director_player_update', { playerId: id, field });
      const currentPlayer = gameState.players.find(p => p.id === id);
      const nextPlayers = gameState.players.map(p => p.id === id ? { ...p, [field]: value } : p);

      if (currentPlayer && field === 'name') {
        const beforeName = normalizePlayerName(String(currentPlayer.name || ''));
        const afterName = normalizePlayerName(String(value || ''));
        if (beforeName && afterName && beforeName !== afterName) {
          emitGameEvent('PLAYER_EDITED', {
            actor: { role: 'director' },
            context: { playerId: id, playerName: afterName, before: beforeName, after: afterName, note: 'name-changed' }
          });
        }
      }

      if (currentPlayer && field === 'score') {
        const delta = Number(value) - Number(currentPlayer.score || 0);
        if (delta !== 0) {
          emitGameEvent('SCORE_ADJUSTED', {
            actor: { role: 'director' },
            context: { playerId: id, playerName: currentPlayer.name, delta, note: 'Manual score adjustment from Director panel' }
          });
        }
      }

      onUpdateState({ ...gameState, players: nextPlayers });
    } catch (e: any) {
      logger.error('director_player_update_failed', { error: e.message, playerId: id });
      addToast('error', 'Failed to update contestant');
    }
  };

  const handleUseWildcard = (id: string) => {
    const p = gameState.players.find(x => x.id === id);
    if (!p) return;
    
    const used = p.wildcardsUsed || 0;
    if (used >= 4) {
      addToast('error', 'Player reached maximum wildcards');
      return;
    }

    soundService.playClick();
    const nextUsed = used + 1;
    logger.info('director_wildcard_use', { playerId: id, count: nextUsed });
    
    emitGameEvent('WILDCARD_USED', { 
      actor: { role: 'director' }, 
      context: { playerId: id, playerName: p.name, after: nextUsed } 
    });

    handleUpdatePlayer(id, 'wildcardsUsed', nextUsed);
  };

  const handleResetWildcards = (id: string) => {
    const p = gameState.players.find(x => x.id === id);
    if (!p) return;

    soundService.playClick();
    logger.info('director_wildcard_reset', { playerId: id });
    
    emitGameEvent('WILDCARD_RESET', { 
      actor: { role: 'director' }, 
      context: { playerId: id, playerName: p.name } 
    });

    handleUpdatePlayer(id, 'wildcardsUsed', 0);
  };

  const handleResetAllWildcards = () => {
    soundService.playClick();
    logger.info('director_wildcard_reset_all');
    
    const nextPlayers = gameState.players.map(p => ({ ...p, wildcardsUsed: 0 }));
    onUpdateState({ ...gameState, players: nextPlayers });
    
    emitGameEvent('WILDCARD_RESET', { actor: { role: 'director' }, context: { note: 'Reset All Players' } });
    setConfirmResetAll(false);
    addToast('info', 'All Wildcards Reset');
  };

  const handleRemovePlayer = (id: string) => {
    const p = gameState.players.find(x => x.id === id);
    if (p && confirm(`Permanently remove ${p.name}?`)) {
      soundService.playClick();
      logger.info('director_player_update', { playerId: id, field: 'removed' });
      const nextPlayers = gameState.players.filter(x => x.id !== id);
      const nextSelection = gameState.selectedPlayerId === id ? (nextPlayers[0]?.id || null) : gameState.selectedPlayerId;
      onUpdateState({ ...gameState, players: nextPlayers, selectedPlayerId: nextSelection });
      addToast('info', `Removed ${p.name}`);
    }
  };

  const handleCreatePlayer = () => {
    const name = normalizePlayerName(newPlayerName);
    if (!name) {
      addToast('error', 'Enter a valid name');
      return;
    }
    if (gameState.players.length >= 8) {
      addToast('error', 'Production limit: 8 Contestants max');
      return;
    }

    soundService.playClick();
    logger.info('director_player_update', { playerId: 'new', field: 'added' });
    
    const newP: Player = { 
      id: crypto.randomUUID(), 
      name, 
      score: 0, 
      color: '#fff',
      wildcardsUsed: 0,
      wildcardActive: false,
      stealsCount: 0
    };
    
    onUpdateState({ 
      ...gameState, 
      players: [...gameState.players, newP],
      selectedPlayerId: gameState.selectedPlayerId || newP.id
    });

    emitGameEvent('PLAYER_ADDED', {
      actor: { role: 'director' },
      context: { playerId: newP.id, playerName: newP.name, note: 'Contestant added from Director panel' }
    });
    
    setNewPlayerName('');
    setIsAddingPlayer(false);
    addToast('success', `Added ${name}`);
  };

  const handleUpdateViewSettings = (updates: Partial<BoardViewSettings>) => {
    const currentSettings = sanitizeBoardViewSettings(gameState.viewSettings);
    const sanitizedPatch = sanitizeBoardViewSettingsPatch(updates);
    const changedEntries = Object.entries(sanitizedPatch).filter(([key, value]) => {
      if (key === 'updatedAt') return false;
      return currentSettings[key as keyof BoardViewSettings] !== value;
    });

    if (changedEntries.length === 0) return;

    const safeUpdates: Partial<BoardViewSettings> = {
      ...Object.fromEntries(changedEntries),
      updatedAt: new Date().toISOString()
    };

    // Audit Settings Change
    logger.info('director_view_settings_changed', { 
      changedKeys: Object.keys(safeUpdates),
      genId: crypto.randomUUID()
    });

    onUpdateState({
      ...gameState,
      viewSettings: {
        ...gameState.viewSettings,
        ...safeUpdates
      }
    });

    emitGameEvent('VIEW_SETTINGS_CHANGED', { 
      actor: { role: 'director' }, 
      context: { after: safeUpdates } 
    });
  };

  const handleArmMove = async (tileId: string) => {
    if (!gameId || armingTileId) {
      if (!gameId) addToast('error', 'Special moves unavailable until a show is active.');
      return;
    }

    setArmingTileId(tileId);
    soundService.playClick();

    try {
      await specialMovesClient.requestArmTile({
        gameId,
        tileId,
        moveType: selectedMoveType,
        actorId: 'director',
        idempotencyKey: crypto.randomUUID(),
        correlationId: crypto.randomUUID()
      });

      logger.info('director_special_move_armed', { gameId, tileId, moveType: selectedMoveType });
      const tile = gameState.categories.flatMap((category) => category.questions.map((question) => ({ category, question }))).find((entry) => entry.question.id === tileId);
      emitGameEvent('SPECIAL_MOVE_ARMED', {
        actor: { role: 'director' },
        context: {
          tileId,
          categoryName: tile?.category.title,
          points: tile?.question.points,
          note: selectedMoveType,
          message: `Armed ${selectedMoveType}`
        }
      });
      addToast('success', 'MOVE DEPLOYED');
    } catch (e: any) {
      logger.error('director_special_move_arm_failed', { gameId, tileId, moveType: selectedMoveType, error: e.message });
      addToast('error', e.message || 'Failed to deploy move.');
    } finally {
      refreshBackendMode();
      setArmingTileId(null);
    }
  };

  const handleClearArmory = async () => {
    if (!gameId || isClearingArmory) {
      if (!gameId) addToast('error', 'Special moves unavailable until a show is active.');
      return;
    }

    setIsClearingArmory(true);
    soundService.playClick();

    try {
      await specialMovesClient.clearArmory({
        gameId,
        actorId: 'director',
        idempotencyKey: crypto.randomUUID(),
        correlationId: crypto.randomUUID()
      });

      logger.info('director_special_move_armory_cleared', { gameId });
      emitGameEvent('SPECIAL_MOVE_ARMORY_CLEARED', {
        actor: { role: 'director' },
        context: { note: 'All active special move deployments cleared' }
      });
      addToast('info', 'ARMORY CLEARED');
    } catch (e: any) {
      logger.error('director_special_move_clear_failed', { gameId, error: e.message });
      addToast('error', e.message || 'Failed to clear armory.');
    } finally {
      refreshBackendMode();
      setIsClearingArmory(false);
    }
  };

  /**
   * REFINED TILE AI REGEN HANDLER
   * - Preserves metadata flags (id, points, state)
   * - Provides snapshot rollback (effectively no commit on fail)
   * - PII-safe structured logging
   * - Race rule enforcement via tileAiGenIdRef
   */
  const handleTileAiRegen = async (cIdx: number, qIdx: number, difficulty: Difficulty) => {
    if (tileAiLoading) return;

    const genId = crypto.randomUUID();
    tileAiGenIdRef.current = genId;
    tileSnapshotRef.current = [...gameState.categories];

    const tsStart = new Date().toISOString();
    const cat = gameState.categories[cIdx];
    const q = cat.questions[qIdx];

    logger.info('director_tile_ai_regen_start', {
      ts: tsStart,
      genId,
      catId: cat.id,
      tileId: q.id,
      points: q.points,
      difficulty
    });

    setTileAiLoading(true);
    soundService.playClick();

    try {
      const result = await generateSingleQuestion(
        gameState.showTitle || "General Trivia",
        q.points,
        cat.title,
        difficulty,
        genId
      );

      // RACE CONDITION CHECK
      if (tileAiGenIdRef.current !== genId) {
        logger.warn('director_tile_ai_regen_stale', { genId, current: tileAiGenIdRef.current });
        return;
      }

      const nextCategories = [...gameState.categories];
      const nextQs = [...nextCategories[cIdx].questions];

      // PRESERVATION LOCK: Updates text/answer but keeps existing object metadata/id
      nextQs[qIdx] = {
        ...q, 
        text: result.text,
        answer: result.answer
      };

      nextCategories[cIdx] = { ...cat, questions: nextQs };

      onUpdateState({ ...gameState, categories: nextCategories });

      emitGameEvent('AI_TILE_REPLACE_APPLIED', {
        actor: { role: 'director' },
        context: {
          tileId: q.id,
          categoryName: cat.title,
          points: q.points,
          note: 'AI tile regeneration applied'
        }
      });

      logger.info('director_tile_ai_regen_success', { 
        ts: new Date().toISOString(), 
        genId, 
        tileId: q.id 
      });
      addToast('success', 'Question generated.');
    } catch (e: any) {
      // Rollback: No updateState call preserves existing board
      emitGameEvent('AI_TILE_REPLACE_FAILED', {
        actor: { role: 'director' },
        context: {
          tileId: q.id,
          categoryName: cat.title,
          points: q.points,
          message: e.message,
          note: 'AI tile regeneration failed'
        }
      });
      logger.error('director_tile_ai_regen_failed', {
        ts: new Date().toISOString(),
        genId,
        tileId: q.id,
        message: e.message
      });
      addToast('error', 'Failed to generate question.');
    } finally {
      if (tileAiGenIdRef.current === genId) {
        setTileAiLoading(false);
      }
    }
  };

  const handleAiRegenTile = async (cIdx: number, qIdx: number, difficulty: Difficulty = 'mixed') => {
    if (aiLoading) return;
    
    const cat = gameState.categories[cIdx];
    const q = cat.questions[qIdx];
    const genId = crypto.randomUUID();
    
    logger.info('director_tile_ai_regen_start', { 
      tileId: q.id, 
      catId: cat.id, 
      points: q.points, 
      difficulty: difficulty
    });

    setAiLoading(true);
    soundService.playClick();

    emitGameEvent('AI_TILE_REPLACE_START', {
      actor: { role: 'director' },
      context: {
        tileId: q.id,
        categoryName: cat.title,
        points: q.points,
        note: 'Quick AI tile regeneration requested'
      }
    });

    try {
      const result = await generateSingleQuestion(
        gameState.showTitle || "General Trivia",
        q.points,
        cat.title,
        difficulty,
        genId
      );

      const nextCategories = [...gameState.categories];
      const nextQs = [...nextCategories[cIdx].questions];
      
      // Preserve ID, Points, and State Flags strictly
      nextQs[qIdx] = { 
        ...nextQs[qIdx], 
        text: result.text, 
        answer: result.answer 
      };
      
      nextCategories[cIdx] = { ...nextCategories[cIdx], questions: nextQs };

      onUpdateState({ ...gameState, categories: nextCategories });

      emitGameEvent('AI_TILE_REPLACE_APPLIED', {
        actor: { role: 'director' },
        context: {
          tileId: q.id,
          categoryName: cat.title,
          points: q.points,
          note: 'Quick AI tile regeneration applied'
        }
      });
      
      logger.info('director_tile_ai_regen_success', { tileId: q.id, genId });
      addToast('success', 'Tile updated via AI.');
    } catch (e: any) {
      emitGameEvent('AI_TILE_REPLACE_FAILED', {
        actor: { role: 'director' },
        context: {
          tileId: q.id,
          categoryName: cat.title,
          points: q.points,
          message: e.message,
          note: 'Quick AI tile regeneration failed'
        }
      });
      logger.error('director_tile_ai_regen_failed', { tileId: q.id, error: e.message, genId });
      addToast('error', `AI Failed: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiRewriteCategory = async (cIdx: number) => {
    if (aiLoading) return;
    
    const genId = crypto.randomUUID();
    const cat = gameState.categories[cIdx];
    
    // Log masked prompt data
    const promptSnippet = (gameState.showTitle || "General Trivia").substring(0, 20) + "...";
    logger.info('ai_category_regen_start', { 
      genId, 
      categoryId: cat.id, 
      promptLen: (gameState.showTitle || "").length, 
      promptSnippet,
      difficulty: 'mixed'
    });

    setAiLoading(true);
    soundService.playClick();
    
    emitGameEvent('AI_CATEGORY_REPLACE_START', { actor: { role: 'director' }, context: { categoryIndex: cIdx, categoryName: cat.title } });

    try {
      const newQs = await generateCategoryQuestions(
        gameState.showTitle || "General Trivia", 
        cat.title, 
        cat.questions.length, 
        'mixed', 
        100, 
        genId
      );

      const nextCategories = [...gameState.categories];
      nextCategories[cIdx] = applyAiCategoryPreservePoints(cat, newQs);

      onUpdateState({ ...gameState, categories: nextCategories });
      emitGameEvent('AI_CATEGORY_REPLACE_APPLIED', {
        actor: { role: 'director' },
        context: { categoryIndex: cIdx, categoryName: cat.title, note: 'AI category regeneration applied' }
      });
      
      logger.info('ai_category_regen_success', { 
        genId, 
        categoryId: cat.id, 
        preservedPoints: true 
      });
      addToast('success', `${cat.title} updated.`);
    } catch (e: any) {
      // ROLLBACK ON FAILURE
      emitGameEvent('AI_CATEGORY_REPLACE_FAILED', {
        actor: { role: 'director' },
        context: { categoryIndex: cIdx, categoryName: cat.title, message: e.message, note: 'AI category regeneration failed' }
      });
      logger.error('ai_category_regen_failed', { 
        genId, 
        categoryId: cat.id, 
        error: e.message 
      });
      
      addToast('error', `AI rewrite failed: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  // --- RENDERING ---

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-white relative">
      <div className="flex-none h-14 border-b border-zinc-800 flex items-center px-4 justify-between bg-black">
        <div className="flex items-center gap-1">
          <button onClick={() => setActiveTab('BOARD')} className={`px-4 py-2 text-xs font-bold uppercase rounded flex items-center gap-2 ${activeTab === 'BOARD' ? 'bg-gold-600 text-black' : 'text-zinc-500 hover:bg-zinc-900'}`}>
            <Grid className="w-4 h-4" /> Board
          </button>
          <button onClick={() => setActiveTab('PLAYERS')} className={`px-4 py-2 text-xs font-bold uppercase rounded flex items-center gap-2 ${activeTab === 'PLAYERS' ? 'bg-gold-600 text-black' : 'text-zinc-500 hover:bg-zinc-900'}`}>
            <Users className="w-4 h-4" /> Players
          </button>
          <button aria-label="Moves Tab" onClick={() => setActiveTab('MOVES')} className={`px-4 py-2 text-xs font-bold uppercase rounded flex items-center gap-2 ${activeTab === 'MOVES' ? 'bg-gold-600 text-black' : 'text-zinc-500 hover:bg-zinc-900'}`}>
            <ShieldAlert className="w-4 h-4" /> Moves
          </button>
          <button onClick={() => setActiveTab('MOVES_HELP')} className={`px-4 py-2 text-xs font-bold uppercase rounded flex items-center gap-2 ${activeTab === 'MOVES_HELP' ? 'bg-gold-600 text-black' : 'text-zinc-500 hover:bg-zinc-900'}`}>
            <Info className="w-4 h-4" /> Moves Help
          </button>
          <button onClick={() => setActiveTab('LOGS_AUDIT')} className={`px-4 py-2 text-xs font-bold uppercase rounded flex items-center gap-2 ${activeTab === 'LOGS_AUDIT' ? 'bg-gold-600 text-black' : 'text-zinc-500 hover:bg-zinc-900'}`}>
            <History className="w-4 h-4" /> Logs & Audit
          </button>
              <button onClick={() => setActiveTab('COUNTER_STUDIO')} className={`px-4 py-2 text-xs font-bold uppercase rounded flex items-center gap-2 ${activeTab === 'COUNTER_STUDIO' ? 'bg-gold-600 text-black' : 'text-zinc-500 hover:bg-zinc-900'}`}>
                <Timer className="w-4 h-4" /> Counter Studio
              </button>
          <button onClick={() => setActiveTab('SOUND_BOARD')} className={`px-4 py-2 text-xs font-bold uppercase rounded flex items-center gap-2 ${activeTab === 'SOUND_BOARD' ? 'bg-gold-600 text-black' : 'text-zinc-500 hover:bg-zinc-900'}`}>
            <Volume2 className="w-4 h-4" /> Sound Board
          </button>
          <button onClick={() => setActiveTab('SETTINGS')} className={`px-4 py-2 text-xs font-bold uppercase rounded flex items-center gap-2 ${activeTab === 'SETTINGS' ? 'bg-gold-600 text-black' : 'text-zinc-500 hover:bg-zinc-900'}`}>
            <Sliders className="w-4 h-4" /> Settings
          </button>
        </div>
        <div className="flex items-center gap-2">
          {onPopout && <button onClick={onPopout} className="hidden md:flex items-center gap-2 text-xs font-bold uppercase text-gold-500 border border-gold-900/50 px-3 py-1.5 rounded hover:bg-gold-900/20"><ExternalLink className="w-3 h-3" /> Detach</button>}
          {onClose && <button onClick={onClose} className="flex items-center gap-2 text-xs font-bold uppercase text-zinc-400 hover:text-red-400 px-3 py-1.5 rounded hover:bg-zinc-900 transition-colors"><X className="w-4 h-4" /> Close</button>}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 custom-scrollbar">
        {activeTab === 'SETTINGS' && (
          <DirectorSettingsPanel 
            settings={gameState.viewSettings} 
            onUpdateSettings={handleUpdateViewSettings} 
          />
        )}

        {activeTab === 'PLAYERS' && (
          <div className="space-y-6 animate-in fade-in duration-300 max-w-7xl mx-auto">
            <div className="flex justify-between items-center bg-zinc-900/40 p-5 rounded-2xl border border-zinc-800 shadow-lg">
              <div>
                <h3 className="text-gold-500 font-black uppercase tracking-widest text-xs flex items-center gap-2">
                  <Users className="w-4 h-4" /> Contestant Management
                </h3>
                <p className="text-[10px] text-zinc-500 uppercase font-bold mt-1 tracking-wider">Live roster overrides for game session</p>
              </div>
              <div className="flex gap-2">
                {!confirmResetAll ? (
                  <button 
                    onClick={() => setConfirmResetAll(true)}
                    className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-black px-4 py-2.5 rounded-xl text-[10px] flex items-center gap-2 uppercase transition-all"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Reset All Wildcards
                  </button>
                ) : (
                  <button 
                    onClick={handleResetAllWildcards}
                    className="bg-red-600 hover:bg-red-500 text-white font-black px-4 py-2.5 rounded-xl text-[10px] flex items-center gap-2 uppercase animate-pulse shadow-lg shadow-red-900/20"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" /> Click to Confirm Reset All
                  </button>
                )}
                <button 
                  onClick={() => setIsAddingPlayer(true)}
                  disabled={(gameState.players || []).length >= 8}
                  className="bg-gold-600 hover:bg-gold-500 text-black font-black px-5 py-2.5 rounded-xl text-[10px] flex items-center gap-2 uppercase disabled:opacity-30 transition-all shadow-xl shadow-gold-900/10 active:scale-95"
                >
                  <UserPlus className="w-4 h-4" /> Add Player
                </button>
              </div>
            </div>

            {isAddingPlayer && (
              <div className="bg-zinc-900 p-5 rounded-2xl border border-gold-500/30 flex gap-3 animate-in slide-in-from-top-2 shadow-2xl">
                <input 
                  autoFocus
                  value={newPlayerName}
                  onChange={e => setNewPlayerName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreatePlayer()}
                  placeholder="ENTER PLAYER NAME"
                  className="flex-1 bg-black border border-zinc-700 p-3 rounded-xl text-sm text-white outline-none focus:border-gold-500 font-black uppercase placeholder:text-zinc-800 tracking-tight"
                />
                <button onClick={handleCreatePlayer} className="bg-green-600 hover:bg-green-500 px-4 rounded-xl text-white transition-colors shadow-lg shadow-green-900/20"><Check className="check-icon w-5 h-5"/></button>
                <button onClick={() => setIsAddingPlayer(false)} className="bg-zinc-800 hover:bg-zinc-700 px-4 rounded-xl text-zinc-400 transition-colors border border-zinc-700"><X className="w-5 h-5"/></button>
              </div>
            )}

            <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-sm">
              <table className="w-full text-left border-collapse">
                <thead className="bg-black/60 text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">
                  <tr>
                    <th className="p-5 border-b border-zinc-800">Contestant Name</th>
                    <th className="p-5 border-b border-zinc-800">Live Score</th>
                    <th className="p-5 border-b border-zinc-800">Wildcards</th>
                    <th className="p-5 border-b border-zinc-800">Steals</th>
                    <th className="p-5 border-b border-zinc-800 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {(gameState.players || []).map(p => (
                    <tr key={p.id} className="hover:bg-white/[0.02] transition-colors group">
                      <td className="p-5">
                        <input 
                          value={p.name}
                          onChange={e => handleUpdatePlayer(p.id, 'name', normalizePlayerName(e.target.value))}
                          className="bg-transparent border-b border-transparent focus:border-gold-500 outline-none font-black text-sm text-white w-full uppercase tracking-tight transition-all py-1"
                          placeholder="NAME REQUIRED"
                        />
                      </td>
                      <td className="p-5">
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={() => handleUpdatePlayer(p.id, 'score', p.score - 100)}
                            className="p-2 bg-black rounded-lg hover:text-red-500 text-zinc-600 transition-colors border border-zinc-800 active:scale-90"
                            title="Subtract 100"
                          ><Minus className="w-4 h-4"/></button>
                          <span className="font-mono text-gold-500 font-black min-w-[5rem] text-center text-xl drop-shadow-md select-none">{p.score}</span>
                          <button 
                            onClick={() => handleUpdatePlayer(p.id, 'score', p.score + 100)}
                            className="p-2 bg-black rounded-lg hover:text-green-500 text-zinc-600 transition-colors border border-zinc-800 active:scale-90"
                            title="Add 100"
                          ><Plus className="w-4 h-4"/></button>
                        </div>
                      </td>
                      <td className="p-5">
                        <div className="flex items-center gap-2">
                           <button 
                             disabled={(p.wildcardsUsed || 0) >= 4}
                             onClick={() => handleUseWildcard(p.id)}
                             title="Increment Wildcard Usage"
                             className={`px-3 py-1.5 rounded-lg border text-[10px] font-black uppercase flex items-center gap-2 transition-all ${(p.wildcardsUsed || 0) >= 4 ? 'bg-zinc-800 border-zinc-700 text-zinc-600 cursor-not-allowed' : 'bg-gold-600/10 border-gold-600/30 text-gold-500 hover:bg-gold-600 hover:text-black'}`}
                           >
                             <Star className={`w-3 h-3 ${(p.wildcardsUsed || 0) > 0 ? 'fill-current' : ''}`} /> 
                             {(p.wildcardsUsed || 0) >= 4 ? 'MAX 4 USED' : `${p.wildcardsUsed || 0}/4`}
                           </button>
                           <button 
                             disabled={(p.wildcardsUsed || 0) === 0}
                             onClick={() => handleResetWildcards(p.id)}
                             title="Reset Wildcards"
                             className="p-2 text-zinc-600 hover:text-red-500 disabled:opacity-0 transition-all"
                           >
                             <RotateCcw className="w-4 h-4" />
                           </button>
                        </div>
                      </td>
                      <td className="p-5">
                        <div className="flex items-center gap-2 text-purple-400">
                          <ShieldAlert className="w-4 h-4" />
                          <span className="font-mono font-black text-sm">{p.stealsCount || 0}</span>
                        </div>
                      </td>
                      <td className="p-5 text-right">
                        <button 
                          /* Fix: Replace undefined 'id' with 'p.id' */
                          onClick={() => handleRemovePlayer(p.id)}
                          className="p-3 text-zinc-800 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500/10 rounded-xl"
                          title="Delete Contestant"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!gameState.players || gameState.players.length === 0) && (
                    <tr>
                      <td colSpan={5} className="p-16 text-center text-zinc-700 italic text-[11px] uppercase font-black tracking-[0.3em] bg-black/20">
                        No contestants registered for this session
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'COUNTER_STUDIO' && (
          <div className="space-y-6 animate-in fade-in duration-300 max-w-7xl mx-auto">
            <div className="bg-zinc-900/40 p-5 rounded-2xl border border-zinc-800 shadow-lg">
              <h3 className="text-gold-500 font-black uppercase tracking-widest text-xs flex items-center gap-2">
                <Timer className="w-4 h-4" /> Counter Studio & Game Timer
              </h3>
              <p className="text-[10px] text-zinc-500 uppercase font-bold mt-1 tracking-wider">Per-question countdown and session-level game timer controls.</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* QUESTION COUNTDOWN TIMER */}
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-5">
                <div className="text-[10px] uppercase tracking-widest font-black text-cyan-300 mb-4">Question Countdown Timer</div>
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3 bg-black/40 border border-zinc-800 rounded-lg px-3 py-2">
                    <span className="text-[11px] uppercase tracking-wider font-black text-zinc-300">Auto-start on tile open</span>
                    <button
                      onClick={() => onQuestionTimerToggle && onQuestionTimerToggle(!questionTimerEnabled)}
                      className={`px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest ${questionTimerEnabled ? 'bg-cyan-600 text-black' : 'bg-zinc-700 text-zinc-200'}`}
                    >
                      {questionTimerEnabled ? 'On' : 'Off'}
                    </button>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {[5, 7, 8, 10, 15].map((duration) => (
                      <button
                        key={duration}
                        onClick={() => {
                          if (onQuestionTimerDurationChange) onQuestionTimerDurationChange(duration);
                          addToast('info', `Question timer set to ${duration}s`);
                        }}
                        className={`px-4 py-2 rounded-lg font-black text-[11px] uppercase tracking-widest transition-all ${
                          questionTimerDurationSeconds === duration
                            ? 'bg-cyan-600 text-black border-cyan-400 border-2'
                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700'
                        }`}
                      >
                        {duration}s
                      </button>
                    ))}
                  </div>
                  {questionTimer?.isRunning && (
                    <div className="bg-black/40 border border-cyan-500/30 rounded-lg p-3">
                      <div className="text-[12px] text-cyan-300 font-bold mb-2">
                        Live Countdown: {questionTimer.remainingSeconds}s
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => onQuestionTimerRestart && onQuestionTimerRestart()}
                          className="px-3 py-2 bg-gold-600 hover:bg-gold-500 text-black text-[11px] font-black rounded-lg uppercase transition-colors"
                        >
                          Restart Countdown
                        </button>
                        <button
                          onClick={() => {
                            if (onQuestionTimerStop) onQuestionTimerStop();
                            addToast('info', 'Question countdown stopped.');
                          }}
                          className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-[11px] font-black rounded-lg uppercase transition-colors"
                        >
                          Stop Countdown
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* SESSION GAME TIMER */}
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-5">
                <div className="text-[10px] uppercase tracking-widest font-black text-purple-300 mb-4">Session Game Timer</div>
                <div className="space-y-4">
                  {!sessionTimer?.isRunning ? (
                    <div className="flex gap-2 flex-wrap">
                      {(['15m', '30m', '1h', '1h30m', '2h'] as const).map((preset) => (
                        <button
                          key={preset}
                          onClick={() => {
                            if (onSessionTimerStart) onSessionTimerStart(preset);
                            addToast('success', `Game timer started: ${preset}`);
                          }}
                          className="px-4 py-2 rounded-lg font-black text-[11px] uppercase tracking-widest transition-all bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-black/40 border border-purple-500/30 rounded-lg p-4">
                      <div className="text-[12px] text-purple-300 font-bold mb-3 flex items-center justify-between">
                        <span>Game Timer: {sessionTimer.selectedPreset}</span>
                        <span className="text-lg font-mono tabular-nums">
                          {Math.floor(sessionTimer.remainingSeconds / 60)}:{String(sessionTimer.remainingSeconds % 60).padStart(2, '0')}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            if (onSessionTimerPause) onSessionTimerPause();
                            addToast('info', `Game timer ${sessionTimer.isStopped ? 'resumed' : 'paused'}.`);
                          }}
                          className="flex-1 px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-black rounded-lg uppercase transition-colors flex items-center justify-center gap-2"
                        >
                          {sessionTimer.isStopped ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                          {sessionTimer.isStopped ? 'Resume' : 'Pause'}
                        </button>
                        <button
                          onClick={() => {
                            if (onSessionTimerReset) onSessionTimerReset();
                            addToast('info', 'Game timer reset.');
                          }}
                          className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-[11px] font-black rounded-lg uppercase transition-colors flex items-center justify-center gap-2"
                        >
                          <RotateCcw className="w-3 h-3" /> Reset
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest font-black text-gold-300">Timer Sound Routing</div>
                <p className="text-[11px] text-zinc-400 mt-1">Timer audio is managed from the global Sound Board for live-safe centralized control.</p>
              </div>
              <button
                onClick={() => setActiveTab('SOUND_BOARD')}
                className="px-4 py-2 rounded-lg bg-gold-600 hover:bg-gold-500 text-black font-black text-[11px] uppercase tracking-wider"
              >
                Open Sound Board
              </button>
            </div>

            <div className="bg-black/40 border border-zinc-800 rounded-2xl p-5">
              <h4 className="text-[10px] uppercase tracking-widest font-black text-zinc-400 mb-3">Usage Notes</h4>
              <ul className="text-[11px] text-zinc-300 space-y-2 list-disc list-inside">
                <li><span className="font-bold">Question Countdown:</span> Triggered when a tile is opened. Director can stop it anytime. Blocks award/steal/void until countdown finishes or is stopped.</li>
                <li><span className="font-bold">Game Timer:</span> Counts down for the entire game session. Can be paused/resumed. When it expires, director is prompted to continue or end the game.</li>
                <li><span className="font-bold">Sound Cues:</span> Both timers emit tick sounds for final 3-10 seconds and an alarm when finished.</li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'SOUND_BOARD' && (
          <DirectorSoundBoardPanel />
        )}

        {activeTab === 'MOVES' && (
          <div className="space-y-6 animate-in fade-in duration-300 max-w-7xl mx-auto">
            <div className="bg-zinc-900/40 p-5 rounded-2xl border border-zinc-800 shadow-lg flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-gold-500 font-black uppercase tracking-widest text-xs flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" /> MOVES
                </h3>
                <p className="text-[10px] text-zinc-500 uppercase font-bold mt-1 tracking-wider">Select a move, then arm any live tile on the board.</p>
                <div className="mt-2">
                  <span
                    aria-label="Special Moves Backend Mode"
                    className="inline-flex items-center rounded-full border border-cyan-700/40 bg-cyan-900/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-cyan-300"
                  >
                    Backend: {backendModeLabels[backendMode]}
                  </span>
                </div>
              </div>
              <button
                aria-label="Wipe All Armed Tiles"
                onClick={handleClearArmory}
                disabled={isClearingArmory}
                className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-black px-4 py-2.5 rounded-xl text-[10px] flex items-center gap-2 uppercase shadow-lg shadow-red-900/20"
              >
                {isClearingArmory ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Wipe All Armed Tiles
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {(Object.keys(moveLabels) as SpecialMoveType[]).map((moveType) => (
                <button
                  key={moveType}
                  onClick={() => setSelectedMoveType(moveType)}
                  className={`rounded-2xl border p-4 text-left transition-all ${selectedMoveType === moveType ? 'border-gold-500 bg-gold-500/10 text-gold-400 shadow-lg shadow-gold-900/10' : 'border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-900/70'}`}
                >
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Special Move</div>
                  <div className="mt-2 text-sm font-black uppercase tracking-wide">{moveLabels[moveType]}</div>
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {gameState.categories.map((cat) => (
                <div key={cat.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
                  <div className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-gold-500">{cat.title}</div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {cat.questions.map((q) => {
                      const deployment = currentOverlay.deploymentsByTileId[q.id];
                      const isArmed = deployment?.status === 'ARMED';
                      const isPlayable = !q.isAnswered && !q.isVoided;

                      return (
                        <button
                          key={q.id}
                          aria-label={`Arm ${moveLabels[selectedMoveType]} on ${cat.title} for ${q.points}`}
                          disabled={!isPlayable || armingTileId === q.id}
                          onClick={() => handleArmMove(q.id)}
                          className={`rounded-xl border p-4 text-left transition-all ${!isPlayable ? 'cursor-not-allowed border-zinc-800 bg-black/30 text-zinc-600 opacity-50' : isArmed ? 'border-gold-500 bg-gold-500/10 text-gold-400 shadow-lg shadow-gold-900/10' : 'border-zinc-700 bg-zinc-900 text-white hover:border-gold-500 hover:bg-zinc-800'}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-lg font-black">{q.points}</span>
                            {armingTileId === q.id && <Loader2 className="w-4 h-4 animate-spin text-gold-500" />}
                          </div>
                          <div className="mt-3 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                            {isArmed ? moveLabels[deployment.moveType!] : 'Ready to Arm'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}


        {activeTab === 'MOVES_HELP' && (
          <div className="space-y-6 animate-in fade-in duration-300 max-w-4xl mx-auto">
            <div className="bg-zinc-900/40 p-5 rounded-2xl border border-zinc-800 shadow-lg">
              <h3 className="text-gold-500 font-black uppercase tracking-widest text-xs flex items-center gap-2">
                <Info className="w-4 h-4" /> How To Play Special Moves
              </h3>
              <p className="text-[11px] text-zinc-300 mt-3 leading-relaxed">
                Use this flow every round to arm tactical modifiers on question tiles before contestants answer.
              </p>
            </div>

            <div className="bg-black/40 border border-zinc-800 rounded-2xl p-5 space-y-3">
              <h4 className="text-[11px] uppercase tracking-widest font-black text-zinc-400">Step-by-step</h4>
              <ol className="list-decimal ml-5 space-y-2 text-[12px] text-zinc-200 leading-relaxed">
                <li>Open the <span className="font-black text-gold-500">Moves</span> tab.</li>
                <li>Select one move type (Double Trouble, Triple Threat, Sabotage, or Mega Steal).</li>
                <li>Click a live tile (not answered/voided) to arm it.</li>
                <li>On the public board, armed tiles show a Zap icon and pulse.</li>
                <li>Run the question normally; score effects apply automatically on award/steal.</li>
                <li>Use <span className="font-black text-red-400">Wipe All Armed Tiles</span> to reset at any time.</li>
              </ol>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-cyan-300 font-black">Double Trouble</div>
                <p className="text-[11px] text-zinc-300 mt-2">Award/steal resolves at 2x value; fail applies standard penalty path.</p>
              </div>
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-gold-300 font-black">Triple Threat</div>
                <p className="text-[11px] text-zinc-300 mt-2">Award/steal resolves at 3x value; fail carries stronger downside.</p>
              </div>
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-red-300 font-black">Sabotage</div>
                <p className="text-[11px] text-zinc-300 mt-2">Normal upside on success; reduced-value penalty on failure.</p>
              </div>
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-purple-300 font-black">Mega Steal</div>
                <p className="text-[11px] text-zinc-300 mt-2">Steal resolves at 2x; direct award is blocked.</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'LOGS_AUDIT' && (
          <div className="space-y-6 animate-in fade-in duration-300 max-w-7xl mx-auto">
            <div className="bg-zinc-900/40 p-5 rounded-2xl border border-zinc-800 shadow-lg flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-gold-500 font-black uppercase tracking-widest text-xs flex items-center gap-2">
                  <History className="w-4 h-4" /> Logs & Audit
                </h3>
                <p className="text-[10px] text-zinc-500 uppercase font-bold mt-1 tracking-wider">Live board and scoreboard activity in complete sentences.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => downloadLogs(filteredHistoryLogs, 'cruzpham-trivia-logs-filtered')}
                  title="Download filtered logs"
                  className="bg-cyan-600 hover:bg-cyan-500 text-black font-black px-4 py-2.5 rounded-xl text-[10px] flex items-center gap-2 uppercase shadow-lg shadow-cyan-900/20"
                >
                  <Download className="w-3.5 h-3.5" /> Download Filtered Logs
                </button>
                <button
                  onClick={() => downloadLogs(fullHistoryLogs, 'cruzpham-trivia-logs')}
                  title="Download full session script"
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-black px-4 py-2.5 rounded-xl text-[10px] flex items-center gap-2 uppercase border border-zinc-700"
                >
                  <Download className="w-3.5 h-3.5" /> Download Full Logs
                </button>
              </div>
            </div>

            <div className="bg-black/40 border border-zinc-800 rounded-2xl p-4">
              <div className="text-[10px] uppercase tracking-widest font-black text-zinc-400 mb-3">Filter Box</div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <input
                  aria-label="Log search"
                  value={logQuery}
                  onChange={(e) => setLogQuery(e.target.value)}
                  placeholder="Search player, category, note..."
                  className="xl:col-span-2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-gold-500"
                />
                <select
                  aria-label="Event type filter"
                  value={eventTypeFilter}
                  onChange={(e) => setEventTypeFilter(e.target.value as 'ALL' | AnalyticsEventType)}
                  className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-gold-500"
                >
                  <option value="ALL">All event types</option>
                  {Array.from(new Set((gameState.events || []).map((event) => event.type as string))).sort().map((type) => (
                    <option key={type} value={type}>{sentenceCase(String(type))}</option>
                  ))}
                </select>
                <select
                  aria-label="Channel filter"
                  value={channelFilter}
                  onChange={(e) => setChannelFilter(e.target.value as LogChannel)}
                  className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-gold-500"
                >
                  <option value="ALL">All channels</option>
                  <option value="BOARD">Board</option>
                  <option value="SCOREBOARD">Scoreboard</option>
                  <option value="AI">AI</option>
                  <option value="SPECIAL_MOVES">Special Moves</option>
                  <option value="SYSTEM">System</option>
                </select>
                <select
                  aria-label="Sort order filter"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                  className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-gold-500"
                >
                  <option value="NEWEST">Newest first</option>
                  <option value="OLDEST">Oldest first</option>
                </select>
                <div className="flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2">
                  <label htmlFor="keyOnlyFilter" className="text-[11px] text-zinc-300 font-bold uppercase tracking-wide">Key only</label>
                  <input
                    id="keyOnlyFilter"
                    aria-label="Key activities only"
                    type="checkbox"
                    checked={keyOnlyFilter}
                    onChange={(e) => setKeyOnlyFilter(e.target.checked)}
                    className="h-4 w-4"
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3 text-[11px] text-zinc-500">
                <button
                  onClick={clearLogFilters}
                  className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 hover:text-zinc-300 uppercase font-bold tracking-wide"
                >
                  Clear Filters
                </button>
                <span data-testid="log-filter-count">{filteredHistoryLogs.length} matching history logs</span>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4">
                <div className="text-[10px] uppercase tracking-widest font-black text-cyan-300 mb-3">Audit (Last 12 Key Activities)</div>
                <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-2 custom-scrollbar" data-testid="audit-log-list">
                  {filteredAuditEvents.length === 0 && <div className="text-[11px] text-zinc-500">No key activity logged yet.</div>}
                  {filteredAuditEvents.map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-zinc-800 bg-black/30 p-3">
                      <div className="text-[10px] text-zinc-500 font-mono">{new Date(entry.iso).toLocaleTimeString()}</div>
                      <div className="text-[12px] text-zinc-200 mt-1 leading-relaxed">{entry.sentence}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4">
                <div className="text-[10px] uppercase tracking-widest font-black text-gold-400 mb-3">Logs (Complete History)</div>
                <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-2 custom-scrollbar" data-testid="full-history-log-list">
                  {filteredHistoryLogs.length === 0 && <div className="text-[11px] text-zinc-500">No events captured yet.</div>}
                  {filteredHistoryLogs.map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-zinc-800 bg-black/30 p-3">
                      <div className="text-[10px] text-zinc-500 font-mono">{entry.iso} • {sentenceCase(entry.type)}</div>
                      <div className="text-[12px] text-zinc-100 mt-1 leading-relaxed">{entry.sentence}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'BOARD' && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <DirectorAiRegenerator gameState={gameState} onUpdateState={onUpdateState} addToast={addToast} />
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${gameState.categories.length}, minmax(180px, 1fr))` }}>
              {gameState.categories.map((cat, cIdx) => (
                <div key={cat.id} className="space-y-3">
                  <div className="group relative">
                    <input value={cat.title} onChange={e => onUpdateState({...gameState, categories: gameState.categories.map((c, i) => i === cIdx ? {...c, title: e.target.value} : c)})} className="bg-zinc-900 text-gold-400 font-bold text-xs p-2 rounded w-full border border-transparent focus:border-gold-500 outline-none pr-8" />
                    <button onClick={() => handleAiRewriteCategory(cIdx)} className="absolute right-1 top-1 p-1 text-zinc-600 hover:text-purple-400 transition-colors" title="Regenerate this category only"><Wand2 className="w-3.5 h-3.5" /></button>
                  </div>
                  {cat.questions.map((q, qIdx) => (
                    <div key={q.id} onClick={() => setEditingQuestion({cIdx, qIdx})} className={`p-3 rounded border flex flex-col gap-1 cursor-pointer transition-all hover:brightness-110 relative group ${q.isVoided ? 'bg-red-900/20 border-red-800' : q.isAnswered ? 'bg-zinc-900 border-zinc-800 opacity-60' : 'bg-zinc-800 border-zinc-700'}`}>
                      <div className="flex justify-between items-center text-[10px] font-mono text-zinc-500">
                        <span>{q.points}</span>
                        {q.isDoubleOrNothing && <span className="text-gold-500 font-bold">2x</span>}
                      </div>

                      {/* QUICK AI REGEN BUTTON */}
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleAiRegenTile(cIdx, qIdx); }}
                        disabled={aiLoading}
                        className="absolute top-1 right-1 p-1 text-zinc-600 hover:text-purple-400 transition-all opacity-0 group-hover:opacity-100 disabled:opacity-0 active:scale-90"
                        title="Quick AI Generate"
                      >
                        {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      </button>

                      <p className="text-xs text-zinc-300 line-clamp-2 leading-tight font-bold">{q.text}</p>
                      <div className="mt-2 pt-2 border-t border-zinc-700/40">
                        <span className="text-[9px] text-zinc-500 uppercase font-black block tracking-widest leading-none mb-1">Answer</span>
                        <p className={`text-[10px] leading-tight font-roboto-bold ${q.answer ? 'text-gold-400' : 'text-zinc-600 italic'}`}>{q.answer || '(MISSING)'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {editingQuestion && (() => {
        const { cIdx, qIdx } = editingQuestion;
        const cat = gameState.categories[cIdx];
        const q = cat.questions[qIdx];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-lg bg-zinc-900 border border-gold-500/50 rounded-xl p-6 shadow-2xl flex flex-col max-h-[90vh]">
              <div className="flex justify-between items-center mb-4 border-b border-zinc-800 pb-2"><div><h3 className="text-gold-500 font-bold">{cat.title} // {q.points}</h3></div><button onClick={() => setEditingQuestion(null)} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button></div>
              <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                
                {/* COMPACT AI REGEN SECTION */}
                <div className="p-4 bg-purple-900/10 border border-purple-500/20 rounded-xl mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-[10px] uppercase text-purple-400 font-black tracking-widest flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5" /> AI Regen Tile
                    </h4>
                    {tileAiLoading && <Loader2 className="w-3 h-3 text-purple-500 animate-spin" />}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 grid grid-cols-4 gap-1 bg-black/40 p-1 rounded-lg border border-zinc-800">
                      {(['easy', 'medium', 'hard', 'mixed'] as Difficulty[]).map(d => (
                        <button 
                          key={d}
                          onClick={() => setTileAiDifficulty(d)}
                          className={`py-1.5 text-[8px] font-black rounded uppercase transition-all ${tileAiDifficulty === d ? 'bg-purple-600 text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                    <button 
                      onClick={() => handleTileAiRegen(cIdx, qIdx, tileAiDifficulty)}
                      disabled={tileAiLoading}
                      className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-[9px] font-black uppercase flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-purple-900/20"
                    >
                      Regen
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs uppercase text-zinc-500 font-bold">Question</label>
                  <textarea 
                    key={`text-${q.text}`}
                    id="dir-q-text" 
                    defaultValue={q.text} 
                    className="w-full bg-black border border-zinc-700 text-white p-3 rounded mt-1 h-24 focus:border-gold-500 outline-none font-bold" 
                  />
                </div>
                <div>
                  <label className="text-xs uppercase text-zinc-500 font-bold">Answer</label>
                  <textarea 
                    key={`ans-${q.answer}`}
                    id="dir-q-answer" 
                    defaultValue={q.answer} 
                    className="w-full bg-black border border-zinc-700 text-white p-3 rounded mt-1 h-16 focus:border-gold-500 outline-none font-bold" 
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-800">
                <button onClick={() => setEditingQuestion(null)} className="px-4 py-2 text-zinc-400 hover:text-white text-sm">Cancel</button>
                <button onClick={() => { 
                   const txt = (document.getElementById('dir-q-text') as HTMLTextAreaElement).value; 
                   const ans = (document.getElementById('dir-q-answer') as HTMLTextAreaElement).value; 
                   
                   const nextCategories = [...gameState.categories];
                   const nCat = nextCategories[cIdx];
                   const nQs = [...nCat.questions];
                   nQs[qIdx] = { ...nQs[qIdx], text: txt, answer: ans, isVoided: false };
                   nextCategories[cIdx] = { ...nCat, questions: nQs };
                   
                   onUpdateState({ ...gameState, categories: nextCategories });
                   emitGameEvent('QUESTION_EDITED', {
                     actor: { role: 'director' },
                     context: {
                       tileId: q.id,
                       categoryIndex: cIdx,
                       rowIndex: qIdx,
                       categoryName: cat.title,
                       points: q.points,
                       note: 'Manual tile edit from Director panel'
                     }
                   });
                   setEditingQuestion(null);
                   addToast('success', 'Tile updated.');
                }} className="bg-gold-600 hover:bg-gold-500 text-black font-bold px-6 py-2 rounded flex items-center gap-2"><Save className="w-4 h-4" />Save Changes</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
