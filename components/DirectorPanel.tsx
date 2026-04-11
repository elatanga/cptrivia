import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Settings, Users, Grid, Edit, Save, X, RefreshCw, Wand2, MonitorOff, ExternalLink, RotateCcw, Play, Pause, Timer, Type, Layout, Star, Trash2, AlertTriangle, UserPlus, Check, BarChart3, Info, Hash, Clock, History, Copy, Trash, Download, ChevronDown, ChevronUp, Sparkles, Sliders, Loader2, Minus, Plus, ShieldAlert, Volume2 } from 'lucide-react';
import { GameState, Question, Difficulty, Category, BoardViewSettings, Player, PlayEvent, AnalyticsEventType, GameAnalyticsEvent, SpecialMoveType, Team, TeamPlayStyle } from '../types';
import { QuestionCountdownTimer, SessionGameTimer, TimerAudioSettings } from '../types';
import { generateSingleQuestion, generateCategoryQuestions } from '../services/geminiService';
import { logger } from '../services/logger';
import { soundService } from '../services/soundService';
import { normalizePlayerName } from '../services/utils';
import { sanitizeBoardViewSettings, sanitizeBoardViewSettingsPatch } from '../services/boardViewSettings';
import { CategoryRegenerationMode, isTileActive, preserveTileStateOnRegenerate, regenerateCategoryWithMode, resetTileToActive } from '../services/boardRegenerationService';
import { DirectorAiRegenerator } from './DirectorAiRegenerator';
import { DirectorSettingsPanel } from './DirectorSettingsPanel';
import { DirectorSoundBoardPanel } from './DirectorSoundBoardPanel';
import { getTeamsValidationError as getTeamsModeValidationError, resetLiveScoresByMode } from '../services/teamsMode';
import { specialMovesClient, type SMSBackendMode } from '../modules/specialMoves/client/specialMovesClient';
import { SMSOverlayDoc } from '../modules/specialMoves/firestoreTypes';
import { getBoardPointColumns, getGiftMoveGlobalDisabledReason, getGiftMoveTileDisabledReason, getTileColumnIndex, isGiftActivatedMove } from '../modules/specialMoves/eligibility';
import { BUILD_GATED_SPECIAL_MOVES, GIFT_SPECIAL_MOVE_TYPES, SPECIAL_MOVE_CATALOG, STANDARD_SPECIAL_MOVE_TYPES } from '../modules/specialMoves/catalog';
import { deriveResolvedSpecialMoveLabelsByTileId, deriveResolvedSpecialMoveTileIds, getTileSpecialMoveTagState, getTileSpecialMoveTagText } from '../modules/specialMoves/tileTagState';
import { normalizeHmsToSeconds, secondsToHms } from '../services/sessionTimerUtils';

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
  sessionTimerEnabled?: boolean;
  onSessionTimerToggle?: (enabled: boolean) => void;
  onSessionTimerStart?: (preset: '15m' | '30m' | '1h' | '1h30m' | '2h') => void;
  onSessionTimerStartWithDuration?: (durationSeconds: number) => void;
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
  sessionTimerEnabled,
  onSessionTimerToggle,
  onSessionTimerStart,
  onSessionTimerStartWithDuration,
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
  type EndgameChallenge = {
    id: string;
    moveType: 'DOUBLE_WINS_OR_NOTHING' | 'TRIPLE_WINS_OR_NOTHING';
    playerId: string;
    categoryId: string;
    questionText: string;
    answerText: string;
    status: 'PENDING' | 'RESOLVED' | 'CANCELED';
  };

  type AuditEntry = {
    id: string;
    ts: number;
    iso: string;
    type: AnalyticsEventType;
    channel: LogChannel;
    event: GameAnalyticsEvent;
    sentence: string;
    badgeLabel: 'AWARDED' | 'STOLEN' | 'VOIDED' | 'RETURNED' | 'PLAY';
    badgeClasses: string;
    detail: string;
  };

  type HistoryEntry = {
    id: string;
    iso: string;
    type: AnalyticsEventType;
    channel: LogChannel;
    event: GameAnalyticsEvent;
    sentence: string;
    headline: string;
    description: string;
    metadataLine: string;
    actorLabel: string;
    outcomeLabel: string;
    specialMoveLabel: string;
    searchText: string;
  };

  const [activeTab, setActiveTab] = useState<'GAME' | 'PLAYERS' | 'TEAMS' | 'BOARD' | 'MOVES' | 'MOVES_HELP' | 'COUNTER_STUDIO' | 'SOUND_BOARD' | 'LOGS_AUDIT' | 'STATS' | 'SETTINGS'>('BOARD');
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
  const [selectedEndgameCategoryId, setSelectedEndgameCategoryId] = useState<string>('');
  const [isPreparingEndgameChallenge, setIsPreparingEndgameChallenge] = useState(false);
  const [activeEndgameChallenge, setActiveEndgameChallenge] = useState<EndgameChallenge | null>(null);
  const [selectedAuditDetail, setSelectedAuditDetail] = useState<AuditEntry | null>(null);

  // Per-tile AI state
  const [tileAiDifficulty, setTileAiDifficulty] = useState<Difficulty>("mixed");
  const [tileAiLoading, setTileAiLoading] = useState(false);
  const tileAiGenIdRef = useRef<string | null>(null);
  const tileSnapshotRef = useRef<Category[] | null>(null);
  const categoryAiGenIdRef = useRef<string | null>(null);
  const categorySnapshotRef = useRef<Category[] | null>(null);
  const [categoryRegenDialog, setCategoryRegenDialog] = useState<{ cIdx: number } | null>(null);
  const [categoryRegenMode, setCategoryRegenMode] = useState<CategoryRegenerationMode>('active_only');
  
  const [processingWildcards, setProcessingWildcards] = useState<Set<string>>(new Set());
  const [isAddingPlayer, setIsAddingPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [confirmResetAll, setConfirmResetAll] = useState(false);

  const moveLabels: Record<SpecialMoveType, string> = useMemo(
    () => Object.fromEntries(
      Object.entries(SPECIAL_MOVE_CATALOG).map(([moveType, details]) => [moveType, details.displayTitle])
    ) as Record<SpecialMoveType, string>,
    []
  );

  const standardMoveTypes: SpecialMoveType[] = STANDARD_SPECIAL_MOVE_TYPES;

  const giftMoveTypes: SpecialMoveType[] = GIFT_SPECIAL_MOVE_TYPES;

  const moveDescriptions: Record<SpecialMoveType, string> = useMemo(
    () => Object.fromEntries(
      Object.entries(SPECIAL_MOVE_CATALOG).map(([moveType, details]) => [moveType, details.description])
    ) as Record<SpecialMoveType, string>,
    []
  );

  const buildGatedMoveCards = BUILD_GATED_SPECIAL_MOVES;

  const backendModeLabels: Record<SMSBackendMode, string> = {
    FUNCTIONS: 'Functions',
    FIRESTORE_FALLBACK: 'Firestore Fallback',
    MEMORY_FALLBACK: 'In-Memory Fallback'
  };

  const refreshBackendMode = () => setBackendMode(specialMovesClient.getBackendMode());

  const getSpecialMoveErrorMessage = (error: unknown, fallback: string) => {
    const e = error as { code?: string; message?: string; details?: any };
    const raw = (e?.message || '').trim();
    const detailsMessage = typeof e?.details?.message === 'string' ? e.details.message.trim() : '';
    const normalizedCode = (e?.code || '').toLowerCase();

    if (detailsMessage) return detailsMessage;

    if (raw) {
      const prefixed = raw.match(/^[A-Z_]+:\s*(.+)$/);
      if (prefixed?.[1]) return prefixed[1];
      if (!/internal/i.test(raw)) return raw;
    }

    if (normalizedCode.includes('already-exists')) return 'Tile is already affected by an active move.';
    if (normalizedCode.includes('invalid-argument')) return 'Special move request is missing required data.';
    if (normalizedCode.includes('failed-precondition')) return 'Special move request is not in a valid state.';
    if (normalizedCode.includes('not-found')) return 'Requested special move data was not found.';

    return fallback;
  };

  const sentenceCase = (value: string) => value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
  const pointsLabel = (value?: number) => {
    const safePoints = Number.isFinite(value) ? Number(value) : 0;
    return `${safePoints} point${safePoints === 1 ? '' : 's'}`;
  };
  const normalizeName = (value?: string) => {
    const trimmed = (value || '').trim();
    return trimmed || 'A player';
  };
  const formatPlayedPrefix = (playerName?: string, categoryName?: string, points?: number) => {
    const safeCategory = (categoryName || '').trim() || 'Unknown Category';
    return `${normalizeName(playerName)} played ${safeCategory} for ${pointsLabel(points)}`;
  };
  const extractStealVictim = (note?: string) => {
    if (!note) return '';
    const match = note.match(/^stolen from\s+(.+)$/i);
    return match?.[1]?.trim() || '';
  };
  const maskSafeText = (value: unknown) => {
    const raw = value === null || value === undefined ? '' : String(value);
    const masked = typeof (logger as any).maskPII === 'function' ? (logger as any).maskPII(raw) : raw;
    return typeof masked === 'string' ? masked.replace(/\s+/g, ' ').trim() : String(masked || '');
  };
  const firstNonEmpty = (...values: unknown[]) => {
    for (const value of values) {
      const next = maskSafeText(value);
      if (next) return next;
    }
    return '';
  };
  const includesDoubleOrNothing = (value: unknown) => typeof value === 'string' && /double\s*or\s*nothing/i.test(value);
  const isDoubleOrNothingEvent = (event: GameAnalyticsEvent) => {
    const c = event.context || {};
    return [c.note, c.message, c.before, c.after].some(includesDoubleOrNothing);
  };

  type PendingPlayContext = {
    tileId: string;
    categoryName?: string;
    points?: number;
    openerName?: string;
    ts: number;
  };

  const isFinalOutcomeEvent = (event: GameAnalyticsEvent) => (
    event.type === 'POINTS_AWARDED'
    || event.type === 'POINTS_STOLEN'
    || event.type === 'TILE_VOIDED'
    || event.type === 'QUESTION_RETURNED'
  );

  const formatFinalOutcomeSentence = (event: GameAnalyticsEvent, pendingPlay?: PendingPlayContext): string => {
    const c = event.context || {};
    const points = typeof c.points === 'number' ? c.points : pendingPlay?.points;
    const categoryName = c.categoryName || pendingPlay?.categoryName;
    const openerName = pendingPlay?.openerName;
    const awardedOrStealerName = c.playerName || event.actor?.playerName;
    const prefix = formatPlayedPrefix(openerName || awardedOrStealerName, categoryName, points);
    const isDoN = isDoubleOrNothingEvent(event);

    if (event.type === 'POINTS_STOLEN') {
      return `${prefix} -> ${normalizeName(awardedOrStealerName)} stole it.`;
    }
    if (event.type === 'POINTS_AWARDED') {
      if (isDoN) {
        return `${prefix} -> Double or Nothing won.`;
      }
      return `${prefix} -> points awarded${awardedOrStealerName ? ` to ${awardedOrStealerName}` : ''}.`;
    }
    if (event.type === 'TILE_VOIDED') {
      return `${prefix} -> points voided.`;
    }
    if (event.type === 'QUESTION_RETURNED') {
      if (isDoN) {
        return `${prefix} -> Double or Nothing lost.`;
      }
      return `${prefix} -> no points awarded.`;
    }
    return formatEventSentence(event);
  };

  const isKeyActivityEvent = (event: GameAnalyticsEvent) => {
    if (isFinalOutcomeEvent(event)) {
      return true;
    }
    return false;
  };

  const isGameplayAuditEvent = (event: GameAnalyticsEvent) => [
    'TILE_OPENED',
    'POINTS_AWARDED',
    'POINTS_STOLEN',
    'TILE_VOIDED',
    'QUESTION_RETURNED',
  ].includes(event.type);

  const getAuditBadge = (event: GameAnalyticsEvent): { label: AuditEntry['badgeLabel']; classes: string } => {
    if (event.type === 'POINTS_AWARDED') return { label: 'AWARDED', classes: 'text-emerald-200 border-emerald-500/40 bg-emerald-900/30' };
    if (event.type === 'POINTS_STOLEN') return { label: 'STOLEN', classes: 'text-violet-200 border-violet-500/40 bg-violet-900/30' };
    if (event.type === 'TILE_VOIDED') return { label: 'VOIDED', classes: 'text-amber-200 border-amber-500/40 bg-amber-900/30' };
    if (event.type === 'QUESTION_RETURNED') return { label: 'RETURNED', classes: 'text-rose-200 border-rose-500/40 bg-rose-900/30' };
    return { label: 'PLAY', classes: 'text-zinc-200 border-zinc-600 bg-zinc-800/60' };
  };

  const formatAuditPlaySentence = (event: GameAnalyticsEvent, pendingPlay?: PendingPlayContext) => {
    const c = event.context || {};
    const player = normalizeName(c.playerName || event.actor?.playerName || pendingPlay?.openerName);
    const category = c.categoryName || pendingPlay?.categoryName || 'Unknown Category';
    const points = typeof c.points === 'number' ? c.points : pendingPlay?.points;
    const moveType = firstNonEmpty(c.specialMoveName, c.specialMoveType,
      typeof c.note === 'string' && /double|triple|safe bet|lockout|super save|golden gamble|shield boost|final shot/i.test(c.note) ? c.note : ''
    );

    if (event.type === 'TILE_OPENED') {
      return `${player} stepped up for ${category} at ${pointsLabel(points)}.`;
    }
    if (event.type === 'POINTS_AWARDED') {
      const delta = typeof c.delta === 'number' ? c.delta : points;
      return `${player} answered ${category} for ${pointsLabel(points)} and was awarded ${pointsLabel(delta)}${moveType ? ` under ${moveType}` : ''}.`;
    }
    if (event.type === 'POINTS_STOLEN') {
      const victim = extractStealVictim(c.note);
      return `${player} stole ${category} for ${pointsLabel(points)}${victim ? ` from ${victim}` : ''}.`;
    }
    if (event.type === 'TILE_VOIDED') {
      return `${player} missed ${category} for ${pointsLabel(points)}. The tile was voided.`;
    }
    if (event.type === 'QUESTION_RETURNED') {
      return `${player}'s play on ${category} for ${pointsLabel(points)} was returned to the board.`;
    }
    return formatFinalOutcomeSentence(event, pendingPlay);
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

  const getSafeHistoryContext = (event: GameAnalyticsEvent) => {
    const c = event.context || {};
    const playerName = firstNonEmpty(c.playerName, event.actor?.playerName, 'Host');
    const categoryName = firstNonEmpty(c.categoryName, 'Board');
    const points = typeof c.points === 'number' ? c.points : undefined;
    const delta = typeof c.delta === 'number' ? c.delta : undefined;
    const note = firstNonEmpty(c.note);
    const message = firstNonEmpty(c.message);
    const outcome = event.type === 'POINTS_AWARDED'
      ? 'AWARDED'
      : event.type === 'POINTS_STOLEN'
        ? 'STOLEN'
        : event.type === 'TILE_VOIDED'
          ? 'VOIDED'
          : event.type === 'QUESTION_RETURNED'
            ? 'RETURNED'
            : event.type.includes('FAILED')
              ? 'FAILED'
              : event.type.includes('START')
                ? 'STARTED'
                : event.type.includes('STOP') || event.type.includes('PAUSE')
                  ? 'STOPPED'
                  : 'UPDATED';

    const specialMove = firstNonEmpty(
      c.specialMoveName,
      c.specialMoveType,
      c.note && /double|triple|safe bet|lockout|super save|golden gamble|shield boost|final shot/i.test(String(c.note)) ? c.note : '',
      c.after && typeof c.after === 'object' ? (c.after as any).moveType : '',
      c.before && typeof c.before === 'object' ? (c.before as any).moveType : ''
    );

    return {
      actorLabel: firstNonEmpty(event.actor?.role, 'system').toUpperCase(),
      playerName,
      categoryName,
      points,
      delta,
      outcome,
      specialMove,
      note,
      message,
    };
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
        return `${playerName} stepped up for ${categoryName} at ${pointsLabel(points)}. Let the spotlight roll.`;
      case 'ANSWER_REVEALED':
        return `Answer reveal is up for ${categoryName} (${pointsLabel(points)}).`;
      case 'POINTS_AWARDED':
        return `${playerName} hit ${categoryName} for ${pointsLabel(delta || points)}${c.specialMoveName ? ` using ${c.specialMoveName}` : ''}. Crowd goes wild.`;
      case 'POINTS_STOLEN':
        return `${playerName} stole ${pointsLabel(delta || points)} in ${categoryName}${extractStealVictim(c.note) ? ` from ${extractStealVictim(c.note)}` : ''}${c.specialMoveName ? ` using ${c.specialMoveName}` : ''}. Huge swing.`;
      case 'TILE_VOIDED':
        return `${categoryName} for ${pointsLabel(points)} was ruled void. Next play.`;
      case 'QUESTION_RETURNED':
        return `${categoryName} for ${pointsLabel(points)} was sent back to the board${c.specialMoveName ? ` under ${c.specialMoveName}` : ''}.`;
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
        return `${playerName} armed ${sentenceCase(c.note || 'special move')} on ${categoryName} (${pointsLabel(points)}).`;
      case 'SPECIAL_MOVE_ARMORY_CLEARED':
        return 'All armed special moves were cleared from the board.';
      default:
        return `${sentenceCase(event.type)} occurred.`;
    }
  };

  const fullHistoryLogs = useMemo<HistoryEntry[]>(() => {
    const events = [...(gameState.events || [])].sort((a, b) => a.ts - b.ts);
    return events.map((event) => ({
      id: event.id || `${event.type}_${event.ts}`,
      iso: event.iso,
      type: event.type,
      channel: getEventChannel(event),
      event,
      sentence: formatEventSentence(event),
      headline: (() => {
        const safe = getSafeHistoryContext(event);
        if (event.type === 'POINTS_AWARDED') return `${safe.playerName} was awarded points`;
        if (event.type === 'POINTS_STOLEN') return `${safe.playerName} stole the tile`;
        if (event.type === 'TILE_VOIDED') return `Tile in ${safe.categoryName} was voided`;
        if (event.type === 'QUESTION_RETURNED') return `Tile in ${safe.categoryName} returned to board`;
        if (event.type === 'SPECIAL_MOVE_ARMED') return `Special move armed on ${safe.categoryName}`;
        return `${sentenceCase(event.type)} event`;
      })(),
      description: (() => {
        const safe = getSafeHistoryContext(event);
        const pointDetail = typeof safe.points === 'number' ? ` (${pointsLabel(safe.points)})` : '';
        const deltaDetail = typeof safe.delta === 'number' ? ` Score impact: ${safe.delta >= 0 ? '+' : ''}${safe.delta}.` : '';
        const moveDetail = safe.specialMove ? ` Special move: ${safe.specialMove}.` : '';
        const noteDetail = safe.note ? ` Note: ${safe.note}.` : '';
        return `${maskSafeText(formatEventSentence(event))}${pointDetail}.${deltaDetail}${moveDetail}${noteDetail}`.replace(/\.+/g, '.').trim();
      })(),
      metadataLine: (() => {
        const safe = getSafeHistoryContext(event);
        return [
          safe.actorLabel,
          safe.playerName,
          safe.categoryName,
          typeof safe.points === 'number' ? pointsLabel(safe.points).toUpperCase() : '',
          safe.outcome,
          safe.specialMove ? `MOVE: ${safe.specialMove.toUpperCase()}` : '',
        ].filter(Boolean).join(' • ');
      })(),
      actorLabel: getSafeHistoryContext(event).actorLabel,
      outcomeLabel: getSafeHistoryContext(event).outcome,
      specialMoveLabel: getSafeHistoryContext(event).specialMove,
      searchText: [
        maskSafeText(formatEventSentence(event)),
        maskSafeText(getSafeHistoryContext(event).playerName),
        maskSafeText(getSafeHistoryContext(event).categoryName),
        maskSafeText(getSafeHistoryContext(event).note),
        maskSafeText(getSafeHistoryContext(event).message),
        maskSafeText(getSafeHistoryContext(event).specialMove),
      ].join(' ').toLowerCase(),
    }));
  }, [gameState.events]);

  const auditEvents = useMemo<AuditEntry[]>(() => {
    const ordered = [...(gameState.events || [])]
      .filter((event): event is GameAnalyticsEvent => !!event && typeof event.type === 'string')
      .sort((a, b) => {
        if (a.ts !== b.ts) return a.ts - b.ts;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });
    const pendingByTileId = new Map<string, PendingPlayContext>();
    const dedupe = new Set<string>();
    let selectedPlayerName: string | undefined;
    const summaries: AuditEntry[] = [];

    ordered.forEach((event) => {
      const c = event.context || {};

      if (event.type === 'PLAYER_SELECTED') {
        selectedPlayerName = c.playerName || selectedPlayerName;
      }

      if (event.type === 'TILE_OPENED' && c.tileId) {
        pendingByTileId.set(c.tileId, {
          tileId: c.tileId,
          categoryName: c.categoryName,
          points: typeof c.points === 'number' ? c.points : undefined,
          openerName: c.playerName || selectedPlayerName,
          ts: event.ts,
        });
      }

      if (!isGameplayAuditEvent(event)) return;

      const dedupeKey = event.id || `${event.type}_${event.ts}_${c.tileId || ''}_${c.playerId || ''}_${c.playerName || ''}_${c.categoryName || ''}`;
      if (dedupe.has(dedupeKey)) return;
      dedupe.add(dedupeKey);

      const pendingPlay = c.tileId ? pendingByTileId.get(c.tileId) : undefined;
      const badge = getAuditBadge(event);
      const safePlayer = normalizeName(c.playerName || event.actor?.playerName || pendingPlay?.openerName);
      const safeCategory = c.categoryName || pendingPlay?.categoryName || 'Unknown Category';
      const safePoints = typeof c.points === 'number' ? c.points : pendingPlay?.points;
      const delta = typeof c.delta === 'number' ? c.delta : undefined;
      summaries.push({
        id: event.id || dedupeKey,
        ts: Number.isFinite(event.ts) ? event.ts : Date.parse(event.iso || '') || 0,
        iso: event.iso,
        type: event.type,
        channel: getEventChannel(event),
        event,
        sentence: formatAuditPlaySentence(event, pendingPlay),
        badgeLabel: badge.label,
        badgeClasses: badge.classes,
        detail: `${safePlayer} • ${safeCategory}${typeof safePoints === 'number' ? ` • ${pointsLabel(safePoints)}` : ''}${typeof delta === 'number' ? ` • ${delta >= 0 ? '+' : ''}${delta} points` : ''}`,
      });

      if (c.tileId && isFinalOutcomeEvent(event)) {
        pendingByTileId.delete(c.tileId);
      }
    });

    const latestTwelve = [...summaries]
      .sort((a, b) => {
        if (a.ts !== b.ts) return b.ts - a.ts;
        return b.id.localeCompare(a.id);
      })
      .slice(0, 12);

    return latestTwelve.map((event) => ({
      id: event.id,
      iso: event.iso,
      ts: event.ts,
      type: event.type,
      channel: event.channel,
      event: event.event,
      sentence: event.sentence,
      badgeLabel: event.badgeLabel,
      badgeClasses: event.badgeClasses,
      detail: event.detail,
    }));
  }, [gameState.events]);

  const filterLogEntries = <T extends { sentence: string; type: AnalyticsEventType; channel: LogChannel; event: GameAnalyticsEvent; searchText?: string }>(entries: T[]) => {
    const normalizedQuery = logQuery.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      if (eventTypeFilter !== 'ALL' && entry.type !== eventTypeFilter) return false;
      if (channelFilter !== 'ALL' && entry.channel !== channelFilter) return false;
      if (keyOnlyFilter && !isKeyActivityEvent(entry.event)) return false;
      if (!normalizedQuery) return true;

      const haystack = entry.searchText || [
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

  const clearLogFilters = () => {
    setLogQuery('');
    setEventTypeFilter('ALL');
    setChannelFilter('ALL');
    setKeyOnlyFilter(false);
    setSortOrder('NEWEST');
  };

  const downloadLogs = (entries: HistoryEntry[], filenamePrefix: string) => {
    try {
      const snapshot = [...entries];
      const escapeCsv = (value: unknown) => {
        const text = maskSafeText(value).replace(/\r?\n|\r/g, ' ');
        return `"${text.replace(/"/g, '""')}"`;
      };
      const headers = [
        'timestamp',
        'event_type',
        'channel',
        'actor',
        'headline',
        'description',
        'metadata',
        'outcome',
        'special_move',
      ];
      const rows = snapshot.map((entry) => [
        entry.iso,
        entry.type,
        entry.channel,
        entry.actorLabel,
        entry.headline,
        entry.description,
        entry.metadataLine,
        entry.outcomeLabel,
        entry.specialMoveLabel,
      ].map(escapeCsv).join(','));

      const csv = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 16);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${filenamePrefix}-${stamp}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
      addToast('success', snapshot.length ? 'Logs exported as CSV.' : 'No logs to export.');
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
  const resolvedSpecialMoveTileIds = useMemo(() => deriveResolvedSpecialMoveTileIds(gameState.events), [gameState.events]);
  const resolvedSpecialMoveLabelsByTileId = useMemo(() => deriveResolvedSpecialMoveLabelsByTileId(gameState.events), [gameState.events]);

  const isEndgameMove = (moveType: SpecialMoveType) => moveType === 'DOUBLE_WINS_OR_NOTHING' || moveType === 'TRIPLE_WINS_OR_NOTHING';
  const isTileMove = (moveType: SpecialMoveType) => !isEndgameMove(moveType);
  const boardColumnCount = useMemo(() => getBoardPointColumns(gameState.categories), [gameState.categories]);
  const giftGlobalDisabledReasons = useMemo(() => {
    const result: Partial<Record<SpecialMoveType, string | null>> = {};
    giftMoveTypes.forEach((moveType) => {
      result[moveType] = getGiftMoveGlobalDisabledReason(moveType, gameState.categories);
    });
    return result;
  }, [giftMoveTypes, gameState.categories]);

  const isBoardExhausted = useMemo(
    () => gameState.categories.every((category) => category.questions.every((question) => question.isAnswered || question.isVoided)),
    [gameState.categories]
  );
  const hasActiveTile = !!gameState.activeCategoryId && !!gameState.activeQuestionId;
  const isSessionTimerFeatureEnabled = sessionTimerEnabled ?? true;

  const [questionManualHms, setQuestionManualHms] = useState(() => {
    const initial = secondsToHms(questionTimerDurationSeconds || 0);
    return {
      hours: String(initial.hours),
      minutes: String(initial.minutes),
      seconds: String(initial.seconds),
    };
  });

  const [sessionManualHms, setSessionManualHms] = useState(() => {
    const initial = secondsToHms(sessionTimer?.durationSeconds || 0);
    return {
      hours: String(initial.hours),
      minutes: String(initial.minutes),
      seconds: String(initial.seconds),
    };
  });

  useEffect(() => {
    const next = secondsToHms(questionTimerDurationSeconds || 0);
    setQuestionManualHms({
      hours: String(next.hours),
      minutes: String(next.minutes),
      seconds: String(next.seconds),
    });
  }, [questionTimerDurationSeconds]);

  useEffect(() => {
    const next = secondsToHms(sessionTimer?.durationSeconds || 0);
    setSessionManualHms({
      hours: String(next.hours),
      minutes: String(next.minutes),
      seconds: String(next.seconds),
    });
  }, [sessionTimer?.durationSeconds]);

  const updateHmsField = (
    setter: React.Dispatch<React.SetStateAction<{ hours: string; minutes: string; seconds: string }>>,
    key: 'hours' | 'minutes' | 'seconds',
    raw: string,
  ) => {
    if (!/^\d*$/.test(raw)) return;
    setter((prev) => ({ ...prev, [key]: raw }));
  };

  const rankedPlayers = useMemo(
    () => [...gameState.players].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return gameState.players.findIndex((p) => p.id === a.id) - gameState.players.findIndex((p) => p.id === b.id);
    }),
    [gameState.players]
  );
  const topTwoPlayerIds = useMemo(() => new Set(rankedPlayers.slice(0, 2).map((p) => p.id)), [rankedPlayers]);
  const selectedPlayerEligibleForEndgame = !!gameState.selectedPlayerId && topTwoPlayerIds.has(gameState.selectedPlayerId);
  const canUseEndgameMoves = isBoardExhausted && !hasActiveTile;
  const endgameDisabledReason = !isBoardExhausted
    ? 'Available only after all tiles are played.'
    : hasActiveTile
      ? 'Finish the currently active tile first.'
      : !selectedPlayerEligibleForEndgame
        ? 'Select one of the top two players first.'
        : '';

  const resolveEndgameChallenge = (outcome: 'SUCCESS' | 'FAIL') => {
    if (!activeEndgameChallenge || activeEndgameChallenge.status !== 'PENDING') return;
    const challengedPlayer = gameState.players.find((player) => player.id === activeEndgameChallenge.playerId);
    if (!challengedPlayer) {
      addToast('error', 'Challenge player no longer available.');
      return;
    }

    const multiplier = activeEndgameChallenge.moveType === 'TRIPLE_WINS_OR_NOTHING' ? 3 : 2;
    const newScore = outcome === 'SUCCESS' ? Math.round(challengedPlayer.score * multiplier) : 0;
    const delta = newScore - challengedPlayer.score;

    onUpdateState({
      ...gameState,
      players: gameState.players.map((player) => (
        player.id === challengedPlayer.id ? { ...player, score: newScore } : player
      ))
    });

    emitGameEvent('SCORE_ADJUSTED', {
      actor: { role: 'director' },
      context: {
        playerId: challengedPlayer.id,
        playerName: challengedPlayer.name,
        delta,
        note: `${activeEndgameChallenge.moveType}:${outcome}`,
      }
    });

    setActiveEndgameChallenge({ ...activeEndgameChallenge, status: 'RESOLVED' });
    addToast(outcome === 'SUCCESS' ? 'success' : 'error', outcome === 'SUCCESS' ? `${challengedPlayer.name} wins ${multiplier}x total score!` : `${challengedPlayer.name} reset to 0.`);
  };

  const startEndgameChallenge = async () => {
    if (!isEndgameMove(selectedMoveType)) return;
    if (!canUseEndgameMoves || !selectedPlayerEligibleForEndgame) {
      addToast('error', endgameDisabledReason || 'Move unavailable right now.');
      return;
    }
    if (!selectedEndgameCategoryId) {
      addToast('error', 'Select a category first.');
      return;
    }
    if (isPreparingEndgameChallenge || activeEndgameChallenge?.status === 'PENDING') return;

    const selectedCategory = gameState.categories.find((category) => category.id === selectedEndgameCategoryId);
    const selectedPlayer = gameState.players.find((player) => player.id === gameState.selectedPlayerId);
    if (!selectedCategory || !selectedPlayer) {
      addToast('error', 'Unable to prepare challenge.');
      return;
    }

    setIsPreparingEndgameChallenge(true);
    try {
      const challenge = await generateSingleQuestion(
        gameState.showTitle || 'General Trivia',
        500,
        selectedCategory.title,
        'hard',
        crypto.randomUUID()
      );

      const nextChallenge: EndgameChallenge = {
        id: crypto.randomUUID(),
        moveType: selectedMoveType,
        playerId: selectedPlayer.id,
        categoryId: selectedCategory.id,
        questionText: challenge.text,
        answerText: challenge.answer,
        status: 'PENDING'
      };
      setActiveEndgameChallenge(nextChallenge);
      emitGameEvent('SPECIAL_MOVE_ARMED', {
        actor: { role: 'director' },
        context: {
          playerId: selectedPlayer.id,
          playerName: selectedPlayer.name,
          categoryName: selectedCategory.title,
          note: `${selectedMoveType}:challenge_prepared`
        }
      });
      addToast('info', 'Endgame challenge generated. Ask the question and resolve outcome.');
    } catch (e: any) {
      logger.error('director_endgame_challenge_prepare_failed', { moveType: selectedMoveType, error: e.message });
      addToast('error', 'Failed to generate endgame challenge.');
    } finally {
      setIsPreparingEndgameChallenge(false);
    }
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
      try {
        soundService.playClick();
        logger.info('director_player_update', { playerId: id, field: 'removed' });
        const nextPlayers = gameState.players.filter(x => x.id !== id);
        const nextSelection = gameState.selectedPlayerId === id ? (nextPlayers[0]?.id || null) : gameState.selectedPlayerId;
        onUpdateState({ ...gameState, players: nextPlayers, selectedPlayerId: nextSelection });
        addToast('info', `Removed ${p.name}`);
      } catch (error) {
        logger.error('director_player_removal_failed', { playerId: id, error: String(error) });
        addToast('error', `Failed to update: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
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
      stealsCount: 0,
      specialMovesUsedCount: 0,
      specialMovesUsedNames: []
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

  const isTeamsMode = (gameState.playMode || 'INDIVIDUALS') === 'TEAMS';
  const activeTeamPlayStyle = gameState.teamPlayStyle || 'TEAM_PLAYS_AS_ONE';
  const teamPlayStyleLabel = activeTeamPlayStyle === 'TEAM_MEMBERS_TAKE_TURNS' ? 'TAKE TURNS' : 'PLAYS AS ONE';
  const canEditTeams = !gameState.isGameStarted;
  const teamsValidationError = isTeamsMode
    ? getTeamsModeValidationError('TEAMS', gameState.teamPlayStyle || 'TEAM_PLAYS_AS_ONE', gameState.teams || [])
    : null;

  const setTeamsState = (teams: Team[], teamPlayStyle?: TeamPlayStyle) => {
    const normalizedTeams = teams.map((team, teamIndex) => ({
      ...team,
      name: normalizePlayerName(team.name) || `TEAM ${teamIndex + 1}`,
      score: Number(team.score || 0),
      members: (team.members || []).map((member, memberIndex) => ({
        ...member,
        name: normalizePlayerName(member.name) || `MEMBER ${memberIndex + 1}`,
        score: Number(member.score || 0),
        orderIndex: memberIndex,
      })),
      activeMemberId: team.members?.some((member) => member.id === team.activeMemberId)
        ? team.activeMemberId
        : team.members?.[0]?.id,
    }));

    // Preserve live player stats (score, wildcards, steals, etc.) for teams that
    // already exist in the current player list. Only create a fresh entry for
    // brand-new teams that have no matching player yet.
    const existingPlayersById: Record<string, Player> = {};
    (gameState.players || []).forEach((p) => { existingPlayersById[p.id] = p; });

    const contestants = normalizedTeams.map((team) => {
      const existing = existingPlayersById[team.id];
      if (existing) {
        return {
          ...existing,
          name: team.name,
          score: Number(team.score || 0),
        };
      }
      return {
        id: team.id,
        name: team.name,
        score: Number(team.score || 0),
        color: '#ffffff',
        wildcardsUsed: 0,
        wildcardActive: false,
        stealsCount: 0,
        questionsAnswered: 0,
        lostOrVoidedCount: 0,
        specialMovesUsedCount: 0,
        specialMovesUsedNames: [],
      };
    });

    onUpdateState({
      ...gameState,
      playMode: 'TEAMS',
      teamPlayStyle: teamPlayStyle || gameState.teamPlayStyle || 'TEAM_PLAYS_AS_ONE',
      teams: normalizedTeams,
      players: contestants,
      selectedPlayerId: contestants.some((player) => player.id === gameState.selectedPlayerId)
        ? gameState.selectedPlayerId
        : contestants[0]?.id || null,
    });
  };

  const handleToggleTeamsMode = (enabled: boolean) => {
    if (!canEditTeams) {
      addToast('error', 'Teams setup is locked once gameplay starts.');
      return;
    }

    if (!enabled) {
      onUpdateState({
        ...gameState,
        playMode: 'INDIVIDUALS',
        teamPlayStyle: gameState.teamPlayStyle || 'TEAM_PLAYS_AS_ONE',
        teams: gameState.teams || [],
      });
      return;
    }

    const seedTeams = (gameState.teams && gameState.teams.length > 0)
      ? gameState.teams
      : [
          {
            id: crypto.randomUUID(),
            name: 'TEAM 1',
            score: 0,
            members: [{ id: crypto.randomUUID(), name: 'MEMBER 1', score: 0, orderIndex: 0 }],
            activeMemberId: undefined,
          },
          {
            id: crypto.randomUUID(),
            name: 'TEAM 2',
            score: 0,
            members: [{ id: crypto.randomUUID(), name: 'MEMBER 1', score: 0, orderIndex: 0 }],
            activeMemberId: undefined,
          },
        ];

    setTeamsState(seedTeams, gameState.teamPlayStyle || 'TEAM_PLAYS_AS_ONE');
  };

  const handleUpdateTeamPlayStyle = (teamPlayStyle: TeamPlayStyle) => {
    if (!canEditTeams) {
      addToast('error', 'Team play style cannot change during active gameplay.');
      return;
    }

    if (teamPlayStyle === 'TEAM_MEMBERS_TAKE_TURNS') {
      const nextError = getTeamsModeValidationError('TEAMS', teamPlayStyle, gameState.teams || []);
      if (nextError) {
        addToast('error', nextError);
        return;
      }
    }

    setTeamsState(gameState.teams || [], teamPlayStyle);
  };

  const handleAddTeamConfig = () => {
    const nextTeams = [
      ...(gameState.teams || []),
      {
        id: crypto.randomUUID(),
        name: `TEAM ${(gameState.teams || []).length + 1}`,
        score: 0,
        members: [{ id: crypto.randomUUID(), name: 'MEMBER 1', score: 0, orderIndex: 0 }],
        activeMemberId: undefined,
      },
    ];
    setTeamsState(nextTeams);
  };

  const handleRemoveTeamConfig = (teamId: string) => {
    if (!canEditTeams) return;
    setTeamsState((gameState.teams || []).filter((team) => team.id !== teamId));
  };

  const handleUpdateTeamName = (teamId: string, name: string) => {
    setTeamsState((gameState.teams || []).map((team) => team.id === teamId ? { ...team, name } : team));
  };

  const handleAddTeamMemberConfig = (teamId: string) => {
    setTeamsState((gameState.teams || []).map((team) => {
      if (team.id !== teamId) return team;
      const members = [
        ...(team.members || []),
        { id: crypto.randomUUID(), name: `MEMBER ${(team.members || []).length + 1}`, score: 0, orderIndex: (team.members || []).length },
      ];
      return { ...team, members, activeMemberId: team.activeMemberId || members[0]?.id };
    }));
  };

  const handleUpdateTeamMemberConfig = (teamId: string, memberId: string, name: string) => {
    setTeamsState((gameState.teams || []).map((team) => {
      if (team.id !== teamId) return team;
      return {
        ...team,
        members: (team.members || []).map((member) => member.id === memberId ? { ...member, name } : member),
      };
    }));
  };

  const handleRemoveTeamMemberConfig = (teamId: string, memberId: string) => {
    if (!canEditTeams) return;
    setTeamsState((gameState.teams || []).map((team) => {
      if (team.id !== teamId) return team;
      const members = (team.members || []).filter((member) => member.id !== memberId);
      return {
        ...team,
        members,
        activeMemberId: members.some((member) => member.id === team.activeMemberId) ? team.activeMemberId : members[0]?.id,
      };
    }));
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

  const safeConfirm = (message: string): boolean => {
    try {
      return typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(message)
        : false;
    } catch {
      return false;
    }
  };

  const buildStateWithResetLiveScores = (state: GameState): GameState => {
    const mode = state.playMode || 'INDIVIDUALS';
    const { players, teams } = resetLiveScoresByMode(state.players || [], state.teams || [], mode);
    return {
      ...state,
      players,
      teams,
    };
  };

  const handleResetLiveScores = () => {
    if (!safeConfirm('Reset all live scores to zero?')) return;
    onUpdateState(buildStateWithResetLiveScores(gameState));
    emitGameEvent('SCORE_ADJUSTED', {
      actor: { role: 'director' },
      context: { note: 'Reset all live scores to zero from Players tab', delta: 0 },
    });
    addToast('info', 'Live scores reset to zero.');
  };

  const transformStateAfterBoardRegen = (nextState: GameState): GameState => {
    if (!safeConfirm('Do you also want to reset live scores to zero?')) {
      return nextState;
    }
    emitGameEvent('SCORE_ADJUSTED', {
      actor: { role: 'director' },
      context: { note: 'Reset all live scores to zero after AI board regeneration', delta: 0 },
    });
    addToast('info', 'Board regenerated and live scores reset to zero.');
    return buildStateWithResetLiveScores(nextState);
  };

  const handleArmMove = async (tileId: string) => {
    if (!gameId || armingTileId) {
      if (!gameId) addToast('error', 'Special moves unavailable until a show is active.');
      return;
    }

    if (!isTileMove(selectedMoveType)) {
      addToast('error', 'This move targets a player challenge, not a tile.');
      return;
    }

    const tile = gameState.categories
      .flatMap((category) => category.questions.map((question) => ({ category, question })))
      .find((entry) => entry.question.id === tileId);

    if (!tile) {
      addToast('error', 'Unable to find that tile. Please try again.');
      return;
    }

    if (!isTileActive(tile.question)) {
      addToast('error', 'Special moves can only be armed on active tiles.');
      return;
    }

    const existingDeployment = currentOverlay.deploymentsByTileId?.[tileId];
    if (existingDeployment?.status === 'ARMED') {
      addToast('error', 'Tile already armed with a special move.');
      return;
    }

    if (isGiftActivatedMove(selectedMoveType)) {
      const giftDisabledReason = getGiftMoveTileDisabledReason(selectedMoveType, gameState.categories, tileId);
      if (giftDisabledReason) {
        addToast('error', giftDisabledReason);
        return;
      }
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

      onUpdateState({
        ...gameState,
        categories: gameState.categories.map((category) => ({
          ...category,
          questions: category.questions.map((question) => (
            question.id === tileId
              ? { ...question, specialMoveType: selectedMoveType }
              : question
          ))
        }))
      });

      logger.info('director_special_move_armed', { gameId, tileId, moveType: selectedMoveType });
      emitGameEvent('SPECIAL_MOVE_ARMED', {
        actor: { role: 'director' },
        context: {
          tileId,
          categoryName: tile?.category.title,
          points: tile?.question.points,
          note: selectedMoveType,
          message: `Armed ${selectedMoveType}`,
          after: {
            activationSource: isGiftActivatedMove(selectedMoveType) ? 'gift' : 'standard',
            giftRequired: isGiftActivatedMove(selectedMoveType)
          }
        }
      });
      addToast('success', 'MOVE DEPLOYED');
    } catch (e: any) {
      logger.error('director_special_move_arm_failed', { gameId, tileId, moveType: selectedMoveType, error: e.message });
      addToast('error', getSpecialMoveErrorMessage(e, 'Failed to deploy move.'));
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

      onUpdateState({
        ...gameState,
        categories: gameState.categories.map((category) => ({
          ...category,
          questions: category.questions.map((question) => {
            if (!question.specialMoveType) return question;
            return { ...question, specialMoveType: undefined };
          })
        }))
      });

      logger.info('director_special_move_armory_cleared', { gameId });
      emitGameEvent('SPECIAL_MOVE_ARMORY_CLEARED', {
        actor: { role: 'director' },
        context: { note: 'All active special move deployments cleared' }
      });
      addToast('info', 'ARMORY CLEARED');
    } catch (e: any) {
      logger.error('director_special_move_clear_failed', { gameId, error: e.message });
      addToast('error', getSpecialMoveErrorMessage(e, 'Failed to clear armory.'));
    } finally {
      refreshBackendMode();
      setIsClearingArmory(false);
    }
  };

  const getTileStateSnapshot = (question: Question) => {
    const tile = question as Question & { isDisabled?: boolean; isPlayable?: boolean; isActive?: boolean };
    return {
      isAnswered: !!tile.isAnswered,
      isVoided: !!tile.isVoided,
      isRevealed: !!tile.isRevealed,
      isDisabled: typeof tile.isDisabled === 'boolean' ? tile.isDisabled : undefined,
      isPlayable: typeof tile.isPlayable === 'boolean' ? tile.isPlayable : undefined,
      isActive: typeof tile.isActive === 'boolean' ? tile.isActive : undefined,
      derivedActive: isTileActive(tile),
    };
  };

  const regenerateTileContent = async (
    cIdx: number,
    qIdx: number,
    difficulty: Difficulty,
    source: 'quick' | 'modal'
  ) => {
    if (aiLoading || tileAiLoading) return;

    const cat = gameState.categories[cIdx];
    const q = cat?.questions[qIdx];
    if (!cat || !q) return;

    const genId = crypto.randomUUID();
    tileAiGenIdRef.current = genId;
    tileSnapshotRef.current = [...gameState.categories];

    const beforeState = getTileStateSnapshot(q);
    logger.info('board_regen_tile_start', {
      genId,
      categoryId: cat.id,
      categoryName: cat.title,
      tileId: q.id,
      points: q.points,
      difficulty,
      source,
      beforeState,
    });

    emitGameEvent('AI_TILE_REPLACE_START', {
      actor: { role: 'director' },
      context: {
        tileId: q.id,
        categoryName: cat.title,
        points: q.points,
        note: `Tile regeneration requested (${source})`,
      },
    });

    if (source === 'modal') setTileAiLoading(true);
    else setAiLoading(true);

    soundService.playClick();

    try {
      const result = await generateSingleQuestion(
        gameState.showTitle || 'General Trivia',
        q.points,
        cat.title,
        difficulty,
        genId
      );

      if (tileAiGenIdRef.current !== genId) {
        logger.warn('board_regen_tile_stale_result', { genId, current: tileAiGenIdRef.current, tileId: q.id });
        return;
      }

      const nextCategories = [...gameState.categories];
      const nextQuestions = [...nextCategories[cIdx].questions];
      const existingQuestion = nextQuestions[qIdx];
      const generatedQuestion = {
        ...existingQuestion,
        text: result.text,
        answer: result.answer,
      };
      const shouldReactivateQuickTile = source === 'quick' && !isTileActive(existingQuestion);

      nextQuestions[qIdx] = shouldReactivateQuickTile
        ? resetTileToActive(existingQuestion, generatedQuestion)
        : preserveTileStateOnRegenerate(existingQuestion, generatedQuestion);
      nextCategories[cIdx] = { ...nextCategories[cIdx], questions: nextQuestions };

      const afterState = getTileStateSnapshot(nextQuestions[qIdx]);

      onUpdateState({ ...gameState, categories: nextCategories });

      logger.info('board_regen_tile_applied', {
        genId,
        categoryId: cat.id,
        tileId: q.id,
        source,
        beforeState,
        afterState,
      });

      emitGameEvent('AI_TILE_REPLACE_APPLIED', {
        actor: { role: 'director' },
        context: {
          tileId: q.id,
          categoryName: cat.title,
          points: q.points,
          note: `Tile regeneration applied (${source})`,
          beforeState,
          afterState,
        },
      });

      addToast('success', shouldReactivateQuickTile ? 'Tile content regenerated and reactivated.' : 'Tile content regenerated.');
    } catch (e: any) {
      logger.error('board_regen_tile_failed', {
        genId,
        categoryId: cat.id,
        tileId: q.id,
        source,
        error: e.message,
        snapshotCategories: tileSnapshotRef.current?.length,
      });
      emitGameEvent('AI_TILE_REPLACE_FAILED', {
        actor: { role: 'director' },
        context: {
          tileId: q.id,
          categoryName: cat.title,
          points: q.points,
          message: e.message,
          note: `Tile regeneration failed (${source})`,
        },
      });
      addToast('error', `AI Failed: ${e.message}`);
    } finally {
      if (tileAiGenIdRef.current === genId) tileAiGenIdRef.current = null;
      setAiLoading(false);
      setTileAiLoading(false);
    }
  };

  const handleTileAiRegen = async (cIdx: number, qIdx: number, difficulty: Difficulty) => {
    await regenerateTileContent(cIdx, qIdx, difficulty, 'modal');
  };

  const handleAiRegenTile = async (cIdx: number, qIdx: number, difficulty: Difficulty = 'mixed') => {
    await regenerateTileContent(cIdx, qIdx, difficulty, 'quick');
  };

  const openCategoryRegenDialog = (cIdx: number) => {
    setCategoryRegenMode('active_only');
    setCategoryRegenDialog({ cIdx });
  };

  const runCategoryRegeneration = async (cIdx: number, mode: CategoryRegenerationMode) => {
    if (aiLoading) return;

    const cat = gameState.categories[cIdx];
    if (!cat) return;

    const genId = crypto.randomUUID();
    categoryAiGenIdRef.current = genId;
    categorySnapshotRef.current = [...gameState.categories];
    const prompt = gameState.showTitle || 'General Trivia';

    logger.info('board_regen_category_start', {
      genId,
      categoryId: cat.id,
      categoryName: cat.title,
      mode,
      questionCount: cat.questions.length,
      promptLength: prompt.length,
    });

    emitGameEvent('AI_CATEGORY_REPLACE_START', {
      actor: { role: 'director' },
      context: {
        categoryIndex: cIdx,
        categoryName: cat.title,
        note: `Category regeneration requested (${mode})`,
      },
    });

    setAiLoading(true);
    soundService.playClick();

    try {
      const generatedQuestions = await generateCategoryQuestions(
        prompt,
        cat.title,
        cat.questions.length,
        'mixed',
        100,
        genId
      );

      if (categoryAiGenIdRef.current !== genId) {
        logger.warn('board_regen_category_stale_result', { genId, current: categoryAiGenIdRef.current, categoryId: cat.id });
        return;
      }

      const result = regenerateCategoryWithMode(cat, generatedQuestions, mode);
      const nextCategories = [...gameState.categories];
      nextCategories[cIdx] = result.category;

      onUpdateState({
        ...gameState,
        categories: nextCategories,
        activeCategoryId: mode === 'reset_all_active' ? null : gameState.activeCategoryId,
        activeQuestionId: mode === 'reset_all_active' ? null : gameState.activeQuestionId,
      });

      logger.info('board_regen_category_applied', {
        genId,
        categoryId: cat.id,
        mode,
        targetedTiles: result.targetedTiles,
        updatedTiles: result.updatedTiles,
      });

      emitGameEvent('AI_CATEGORY_REPLACE_APPLIED', {
        actor: { role: 'director' },
        context: {
          categoryIndex: cIdx,
          categoryName: cat.title,
          note: `Category regeneration applied (${mode})`,
          targetedTiles: result.targetedTiles,
          updatedTiles: result.updatedTiles,
        },
      });

      addToast('success', `${cat.title} updated (${result.updatedTiles} tiles).`);
    } catch (e: any) {
      logger.error('board_regen_category_failed', {
        genId,
        categoryId: cat.id,
        mode,
        error: e.message,
        snapshotCategories: categorySnapshotRef.current?.length,
      });
      emitGameEvent('AI_CATEGORY_REPLACE_FAILED', {
        actor: { role: 'director' },
        context: {
          categoryIndex: cIdx,
          categoryName: cat.title,
          message: e.message,
          note: `Category regeneration failed (${mode})`,
        },
      });
      addToast('error', `AI rewrite failed: ${e.message}`);
    } finally {
      if (categoryAiGenIdRef.current === genId) categoryAiGenIdRef.current = null;
      setAiLoading(false);
      setCategoryRegenDialog(null);
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
          <button onClick={() => setActiveTab('TEAMS')} className={`px-4 py-2 text-xs font-bold uppercase rounded flex items-center gap-2 ${activeTab === 'TEAMS' ? 'bg-gold-600 text-black' : 'text-zinc-500 hover:bg-zinc-900'}`}>
            <Users className="w-4 h-4" /> Teams
          </button>
          <button aria-label="Moves Tab" onClick={() => setActiveTab('MOVES')} className={`px-4 py-2 text-xs font-bold uppercase rounded flex items-center gap-2 ${activeTab === 'MOVES' ? 'bg-gold-600 text-black' : 'text-zinc-500 hover:bg-zinc-900'}`}>
            <ShieldAlert className="w-4 h-4" /> Special Moves
          </button>
          <button onClick={() => setActiveTab('MOVES_HELP')} className={`px-4 py-2 text-xs font-bold uppercase rounded flex items-center gap-2 ${activeTab === 'MOVES_HELP' ? 'bg-gold-600 text-black' : 'text-zinc-500 hover:bg-zinc-900'}`}>
            <Info className="w-4 h-4" /> Special Moves Guide
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
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Live roster overrides for game session</span>
                  {isTeamsMode && (
                    <>
                      <span className="inline-flex items-center rounded-full border border-blue-500/40 bg-blue-950/40 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-blue-200">Teams Mode</span>
                      <span className="inline-flex items-center rounded-full border border-purple-500/40 bg-purple-950/40 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-purple-200">{teamPlayStyleLabel}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleResetLiveScores}
                  className="bg-red-700/90 hover:bg-red-600 text-white font-black px-4 py-2.5 rounded-xl text-[10px] flex items-center gap-2 uppercase transition-all shadow-lg shadow-red-950/20"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reset Live Scores
                </button>
                {!isTeamsMode && (
                  <>
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
                  </>
                )}
              </div>
            </div>

            {!isTeamsMode && isAddingPlayer && (
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

            {!isTeamsMode && (
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-sm">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-black/60 text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">
                    <tr>
                      <th className="p-5 border-b border-zinc-800">Contestant Name</th>
                      <th className="p-5 border-b border-zinc-800">Live Score</th>
                      <th className="p-5 border-b border-zinc-800">Wildcards</th>
                      <th className="p-5 border-b border-zinc-800">Steals</th>
                      <th className="p-5 border-b border-zinc-800">Special Moves</th>
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
                        <td className="p-5">
                          <div className="flex items-center gap-2 text-red-400" title={(p.specialMovesUsedNames || []).join(', ')}>
                            <Sparkles className="w-4 h-4" />
                            <span className="font-mono font-black text-sm">{p.specialMovesUsedCount || 0}</span>
                          </div>
                        </td>
                        <td className="p-5 text-right">
                          <button 
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
                        <td colSpan={6} className="p-16 text-center text-zinc-700 italic text-[11px] uppercase font-black tracking-[0.3em] bg-black/20">
                          No contestants registered for this session
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {isTeamsMode && (
              <div className="space-y-4">
                <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-[10px] uppercase tracking-wider font-black text-zinc-400">
                    {`${(gameState.teams || []).length} team${(gameState.teams || []).length === 1 ? '' : 's'} • ${gameState.players.length} total contestants`}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider font-black text-zinc-500">
                    {activeTeamPlayStyle === 'TEAM_MEMBERS_TAKE_TURNS'
                      ? 'Active member badge reflects current turn state'
                      : 'Team totals drive scoring while member list stays visible for context'}
                  </div>
                </div>

                {(gameState.teams || []).length === 0 ? (
                  <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-14 text-center text-zinc-500 text-[11px] uppercase font-black tracking-[0.2em]">
                    No teams configured yet. Open the Teams tab to set up rosters.
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {(gameState.teams || []).map((team) => {
                      const members = team.members || [];
                      const isSelected = gameState.selectedPlayerId === team.id;
                      return (
                        <div key={team.id} className={`rounded-2xl border p-4 bg-zinc-900/30 ${isSelected ? 'border-gold-500/70 shadow-lg shadow-gold-900/20' : 'border-zinc-800'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-white font-black uppercase tracking-wide truncate">{team.name}</h4>
                                <span className="inline-flex items-center rounded-full border border-blue-500/40 bg-blue-950/40 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-blue-200">Team</span>
                                <span className="inline-flex items-center rounded-full border border-purple-500/40 bg-purple-950/40 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-purple-200">{teamPlayStyleLabel}</span>
                              </div>
                              <div className="mt-1 text-[10px] uppercase tracking-wider font-bold text-zinc-500">
                                {members.length} player{members.length === 1 ? '' : 's'}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[9px] uppercase tracking-widest text-zinc-500 font-black">Team Score</div>
                              <div className="font-mono text-2xl text-gold-500 font-black leading-none">{Number(team.score || 0)}</div>
                            </div>
                          </div>

                          {activeTeamPlayStyle === 'TEAM_PLAYS_AS_ONE' && (
                            <div className="mt-3 rounded-xl border border-zinc-800 bg-black/40 p-2 text-[11px] text-zinc-300 uppercase tracking-wide">
                              {members.map((member) => member.name).join(' • ') || 'No members'}
                            </div>
                          )}

                          {activeTeamPlayStyle === 'TEAM_MEMBERS_TAKE_TURNS' && (
                            <div className="mt-3 space-y-1.5">
                              {members.map((member) => {
                                const isActive = team.activeMemberId === member.id;
                                return (
                                  <div key={member.id} className={`rounded-lg border px-2.5 py-2 flex items-center justify-between gap-2 ${isActive ? 'border-gold-500/40 bg-gold-900/20' : 'border-zinc-800 bg-black/30'}`}>
                                    <div className="min-w-0 flex items-center gap-2">
                                      <span className="text-[11px] font-bold uppercase text-zinc-200 truncate">{member.name}</span>
                                      {isActive && <span className="inline-flex items-center rounded-full border border-gold-500/50 bg-gold-900/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-gold-300">Active</span>}
                                    </div>
                                    <span className="font-mono text-sm font-black text-zinc-200">{Number(member.score || 0)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'TEAMS' && (
          <div className="space-y-6 animate-in fade-in duration-300 max-w-7xl mx-auto">
            <div className="bg-zinc-900/40 p-5 rounded-2xl border border-zinc-800 shadow-lg">
              <h3 className="text-gold-500 font-black uppercase tracking-widest text-xs flex items-center gap-2">
                <Users className="w-4 h-4" /> Teams Mode
              </h3>
              <p className="text-[10px] text-zinc-500 uppercase font-bold mt-1 tracking-wider">Configure teams and team play style.</p>
              {!canEditTeams && (
                <p className="text-[10px] text-amber-300 uppercase font-bold mt-2">Play style and mode are locked after gameplay starts. Team names and roster can still be edited.</p>
              )}
            </div>

            <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-3 bg-black/40 border border-zinc-800 rounded-lg px-3 py-2">
                <span className="text-[11px] uppercase tracking-wider font-black text-zinc-300">Teams mode enabled</span>
                <button
                  onClick={() => handleToggleTeamsMode(!isTeamsMode)}
                  className={`px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest ${isTeamsMode ? 'bg-cyan-600 text-black' : 'bg-zinc-700 text-zinc-200'}`}
                >
                  {isTeamsMode ? 'On' : 'Off'}
                </button>
              </div>

              {isTeamsMode && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      disabled={!canEditTeams}
                      onClick={() => handleUpdateTeamPlayStyle('TEAM_PLAYS_AS_ONE')}
                      className={`py-2 rounded text-[10px] font-bold border transition-all ${gameState.teamPlayStyle === 'TEAM_PLAYS_AS_ONE' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
                    >
                      Team plays as one
                    </button>
                    <button
                      disabled={!canEditTeams}
                      onClick={() => handleUpdateTeamPlayStyle('TEAM_MEMBERS_TAKE_TURNS')}
                      className={`py-2 rounded text-[10px] font-bold border transition-all ${gameState.teamPlayStyle === 'TEAM_MEMBERS_TAKE_TURNS' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
                    >
                      Team members take turns
                    </button>
                  </div>

                  <div className="text-[10px] text-zinc-500 uppercase">
                    {gameState.teamPlayStyle === 'TEAM_MEMBERS_TAKE_TURNS'
                      ? 'Team members take turns: all teams must have the same number of players and rotate by member index across teams.'
                      : 'Team plays as one: teams can have different numbers of players and score is tracked at the team level.'}
                  </div>

                  {teamsValidationError && (
                    <div className="text-[10px] text-amber-300 uppercase font-bold tracking-wide border border-amber-500/30 bg-amber-950/20 rounded-lg px-3 py-2">
                      {teamsValidationError}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      onClick={handleAddTeamConfig}
                      className="bg-gold-600 hover:bg-gold-500 text-black font-black px-4 py-2 rounded-xl text-[10px] flex items-center gap-2 uppercase"
                    >
                      <Plus className="w-3 h-3" /> Add Team
                    </button>
                  </div>

                  <div className="space-y-3">
                    {(gameState.teams || []).map((team) => (
                      <div key={team.id} className="bg-black/40 border border-zinc-800 rounded-xl p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <input
                            value={team.name}
                            onChange={(e) => handleUpdateTeamName(team.id, e.target.value)}
                            className="flex-1 bg-black border border-zinc-800 rounded px-2 py-1 text-[11px] uppercase text-white"
                            placeholder="TEAM NAME"
                          />
                          <span className="text-[10px] px-2 py-1 rounded border border-blue-700/40 bg-blue-900/20 text-blue-300 uppercase font-black">
                            {gameState.teamPlayStyle === 'TEAM_MEMBERS_TAKE_TURNS' ? 'TURN MODE' : 'PLAYS AS ONE'}
                          </span>
                          <button onClick={() => handleAddTeamMemberConfig(team.id)} className="text-[10px] text-gold-500 hover:text-white font-bold px-2 py-1 border border-zinc-800 rounded">+ MEMBER</button>
                          <button disabled={!canEditTeams} onClick={() => handleRemoveTeamConfig(team.id)} className="text-[10px] text-red-400 hover:text-red-300 font-bold px-2 py-1 border border-zinc-800 rounded disabled:opacity-40">REMOVE</button>
                        </div>

                        <div className="space-y-1">
                          {(team.members || []).map((member) => (
                            <div key={member.id} className="flex items-center gap-2">
                              <input
                                value={member.name}
                                onChange={(e) => handleUpdateTeamMemberConfig(team.id, member.id, e.target.value)}
                                className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] uppercase text-zinc-200"
                                placeholder="MEMBER NAME"
                              />
                              <button disabled={!canEditTeams} onClick={() => handleRemoveTeamMemberConfig(team.id, member.id)} className="text-[10px] text-zinc-500 hover:text-red-400 px-2 py-1 disabled:opacity-40">X</button>
                            </div>
                          ))}
                        </div>

                        <div className="mt-2 text-[9px] text-zinc-500 uppercase">{team.name || 'TEAM'} ({(team.members || []).length} members)</div>
                      </div>
                    ))}
                    {(gameState.teams || []).length === 0 && (
                      <div className="text-[10px] text-zinc-500 uppercase border border-dashed border-zinc-800 rounded-lg p-3 text-center">
                        No teams configured.
                      </div>
                    )}
                  </div>
                </>
              )}
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
                    <span className="text-[11px] uppercase tracking-wider font-black text-zinc-300">Question countdown enabled</span>
                    <button
                      data-testid="question-countdown-toggle"
                      onClick={() => onQuestionTimerToggle && onQuestionTimerToggle(!questionTimerEnabled)}
                      className={`px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest ${questionTimerEnabled ? 'bg-cyan-600 text-black' : 'bg-zinc-700 text-zinc-200'}`}
                    >
                      {questionTimerEnabled ? 'On' : 'Off'}
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Countdown is opt-in and stays off until manually enabled.</p>
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
                  <div className="bg-black/30 border border-zinc-800 rounded-lg p-3 space-y-3" data-testid="question-timer-manual-hms">
                    <div className="text-[10px] uppercase tracking-widest font-black text-cyan-200">Manual Duration (H/M/S)</div>
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        aria-label="Question timer hours"
                        value={questionManualHms.hours}
                        onChange={(e) => updateHmsField(setQuestionManualHms, 'hours', e.target.value)}
                        inputMode="numeric"
                        className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
                        placeholder="H"
                      />
                      <input
                        aria-label="Question timer minutes"
                        value={questionManualHms.minutes}
                        onChange={(e) => updateHmsField(setQuestionManualHms, 'minutes', e.target.value)}
                        inputMode="numeric"
                        className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
                        placeholder="M"
                      />
                      <input
                        aria-label="Question timer seconds"
                        value={questionManualHms.seconds}
                        onChange={(e) => updateHmsField(setQuestionManualHms, 'seconds', e.target.value)}
                        inputMode="numeric"
                        className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
                        placeholder="S"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const totalSeconds = normalizeHmsToSeconds(
                          questionManualHms.hours,
                          questionManualHms.minutes,
                          questionManualHms.seconds,
                        );
                        if (!totalSeconds) {
                          addToast('error', 'Enter a valid non-zero Question timer duration.');
                          return;
                        }
                        onQuestionTimerDurationChange?.(totalSeconds);
                        addToast('info', `Question timer set to ${totalSeconds}s`);
                      }}
                      className="w-full px-3 py-2 rounded-lg bg-cyan-700/80 hover:bg-cyan-600 text-white text-[10px] font-black uppercase tracking-widest"
                    >
                      Apply Question Timer
                    </button>
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
                  <div className="flex items-center justify-between gap-3 bg-black/40 border border-zinc-800 rounded-lg px-3 py-2">
                    <span className="text-[11px] uppercase tracking-wider font-black text-zinc-300">Session timer enabled</span>
                    <button
                      data-testid="session-game-timer-toggle"
                      onClick={() => onSessionTimerToggle && onSessionTimerToggle(!isSessionTimerFeatureEnabled)}
                      className={`px-3 py-1.5 rounded text-[10px] font-black uppercase tracking-widest ${isSessionTimerFeatureEnabled ? 'bg-purple-600 text-white' : 'bg-zinc-700 text-zinc-200'}`}
                    >
                      {isSessionTimerFeatureEnabled ? 'On' : 'Off'}
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Session timer controls stay idle while disabled.</p>
                  {!sessionTimer?.remainingSeconds ? (
                    <div className="space-y-3">
                      <div className="flex gap-2 flex-wrap">
                        {(['15m', '30m', '1h', '1h30m', '2h'] as const).map((preset) => (
                          <button
                            key={preset}
                            onClick={() => {
                              if (onSessionTimerStart) onSessionTimerStart(preset);
                              addToast('success', `Game timer started: ${preset}`);
                            }}
                            disabled={!isSessionTimerFeatureEnabled}
                            className="px-4 py-2 rounded-lg font-black text-[11px] uppercase tracking-widest transition-all bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
                          >
                            {preset}
                          </button>
                        ))}
                      </div>

                      <div className="bg-black/30 border border-zinc-800 rounded-lg p-3 space-y-3" data-testid="session-timer-manual-hms">
                        <div className="text-[10px] uppercase tracking-widest font-black text-purple-200">Manual Duration (H/M/S)</div>
                        <div className="grid grid-cols-3 gap-2">
                          <input
                            aria-label="Session timer hours"
                            value={sessionManualHms.hours}
                            onChange={(e) => updateHmsField(setSessionManualHms, 'hours', e.target.value)}
                            inputMode="numeric"
                            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-purple-500"
                            placeholder="H"
                          />
                          <input
                            aria-label="Session timer minutes"
                            value={sessionManualHms.minutes}
                            onChange={(e) => updateHmsField(setSessionManualHms, 'minutes', e.target.value)}
                            inputMode="numeric"
                            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-purple-500"
                            placeholder="M"
                          />
                          <input
                            aria-label="Session timer seconds"
                            value={sessionManualHms.seconds}
                            onChange={(e) => updateHmsField(setSessionManualHms, 'seconds', e.target.value)}
                            inputMode="numeric"
                            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-purple-500"
                            placeholder="S"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={!isSessionTimerFeatureEnabled}
                          onClick={() => {
                            const totalSeconds = normalizeHmsToSeconds(
                              sessionManualHms.hours,
                              sessionManualHms.minutes,
                              sessionManualHms.seconds,
                            );
                            if (!totalSeconds) {
                              addToast('error', 'Enter a valid non-zero Session timer duration.');
                              return;
                            }
                            if (onSessionTimerStartWithDuration) {
                              onSessionTimerStartWithDuration(totalSeconds);
                            } else {
                              addToast('error', 'Custom session timer start is unavailable.');
                              return;
                            }
                            addToast('success', `Game timer started: ${totalSeconds}s`);
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-purple-700/80 hover:bg-purple-600 disabled:opacity-50 text-white text-[10px] font-black uppercase tracking-widest"
                        >
                          Apply Session Timer
                        </button>
                      </div>
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
                          disabled={!isSessionTimerFeatureEnabled}
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
                          disabled={!isSessionTimerFeatureEnabled}
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
                  <ShieldAlert className="w-4 h-4" /> SPECIAL MOVES
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

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/25 p-4">
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400 font-black mb-3">Standard Special Moves</div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {standardMoveTypes.map((moveType) => {
                  const disabled = isEndgameMove(moveType) ? !canUseEndgameMoves : false;
                  const disabledReason = isEndgameMove(moveType) ? endgameDisabledReason : '';

                  return (
                    <button
                      key={moveType}
                      disabled={disabled}
                      onClick={() => setSelectedMoveType(moveType)}
                      className={`rounded-2xl border p-4 text-left transition-all ${disabled ? 'opacity-50 cursor-not-allowed border-zinc-800 bg-zinc-900/20 text-zinc-500' : selectedMoveType === moveType ? 'border-gold-500 bg-gold-500/10 text-gold-400 shadow-lg shadow-gold-900/10' : 'border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-900/70'}`}
                    >
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Special Move</div>
                      <div className="mt-2 text-sm font-black uppercase tracking-wide">{moveLabels[moveType]}</div>
                      <div className="mt-2 text-[10px] text-zinc-400 leading-relaxed">{moveDescriptions[moveType]}</div>
                      {disabledReason && <div className="mt-2 text-[10px] font-black text-red-300">{disabledReason}</div>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-purple-700/40 bg-purple-950/20 p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-purple-200 font-black">Gift Activated Special Moves</div>
                  <p className="text-[11px] text-zinc-300 mt-1">Host gift activation required. Gift moves enforce stricter tile eligibility and include no-steal safety.</p>
                </div>
                <span className="inline-flex items-center rounded-full border border-purple-400/40 bg-purple-800/30 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-purple-100">Gift Required</span>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {giftMoveTypes.map((moveType) => {
                  const disabledReason = giftGlobalDisabledReasons[moveType] || '';
                  const disabled = !!disabledReason;
                  const selected = selectedMoveType === moveType;

                  return (
                    <button
                      key={moveType}
                      disabled={disabled}
                      onClick={() => setSelectedMoveType(moveType)}
                      className={`rounded-2xl border p-4 text-left transition-all ${disabled ? 'opacity-55 cursor-not-allowed border-zinc-800 bg-zinc-900/25 text-zinc-500' : selected ? 'border-purple-400 bg-purple-500/10 text-purple-100 shadow-lg shadow-purple-900/20' : 'border-zinc-800 bg-zinc-900/40 text-zinc-200 hover:border-purple-500 hover:bg-zinc-900/70'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Gift Move</div>
                        <span className="inline-flex items-center rounded-full border border-amber-400/50 bg-amber-800/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-200">Gift Required</span>
                      </div>
                      <div className="mt-2 text-sm font-black uppercase tracking-wide">{moveLabels[moveType]}</div>
                      <div className="mt-2 text-[10px] text-zinc-400 leading-relaxed">{moveDescriptions[moveType]}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded border border-zinc-700/80 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-zinc-300">No Steal</span>
                        {moveType === 'SUPER_SAVE' && <span className="rounded border border-zinc-700/80 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-zinc-300">Early Columns Only</span>}
                        {moveType === 'FINAL_SHOT' && <span className="rounded border border-zinc-700/80 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-zinc-300">Late Columns Only</span>}
                        {(moveType === 'SUPER_SAVE' || moveType === 'FINAL_SHOT') && <span className="rounded border border-zinc-700/80 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-zinc-300">Board Min 6 Columns</span>}
                      </div>
                      {disabledReason && <div className="mt-2 text-[10px] font-black text-red-300">{disabledReason}</div>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-700/60 bg-zinc-900/20 p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-200 font-black">Build-gated Guide Moves</div>
                  <p className="text-[11px] text-zinc-400 mt-1">Visible for production parity with the reference guide. These remain disabled unless their gameplay systems are enabled.</p>
                </div>
                <span className="inline-flex items-center rounded-full border border-zinc-500/50 bg-zinc-800/50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-200">Guide Listed</span>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {buildGatedMoveCards.map((move) => (
                  <button
                    key={move.id}
                    type="button"
                    disabled
                    aria-label={`${move.displayTitle} build-gated`}
                    className="rounded-2xl border border-zinc-800 bg-black/35 p-4 text-left opacity-60 cursor-not-allowed"
                  >
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Guide Move</div>
                    <div className="mt-2 text-sm font-black uppercase tracking-wide text-zinc-200">{move.displayTitle}</div>
                    <div className="mt-2 text-[10px] text-zinc-400 leading-relaxed">{move.description}</div>
                    <div className="mt-2 text-[10px] font-black text-amber-300">{move.disabledReason}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-black/30 px-4 py-3 text-[11px] text-zinc-300">
              <span className="font-black text-gold-400 uppercase">Active move: {moveLabels[selectedMoveType]}</span>
              {isGiftActivatedMove(selectedMoveType) && <span className="ml-2 inline-flex items-center rounded-full border border-amber-400/50 bg-amber-900/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-200">Gift Required</span>}
              <span className="ml-2 text-zinc-500 normal-case font-normal tracking-normal">Board columns: {boardColumnCount}</span>
            </div>

            {isEndgameMove(selectedMoveType) && (
              <div className="rounded-2xl border border-amber-600/40 bg-amber-950/20 p-4 space-y-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-amber-300 font-black">Endgame Challenge Setup</div>
                <p className="text-[11px] text-zinc-300">Board must be fully exhausted, no active tile can be open, and selected player must be top 2 by score.</p>
                {!canUseEndgameMoves && <p className="text-[11px] text-red-300 font-bold">{endgameDisabledReason}</p>}
                {canUseEndgameMoves && !selectedPlayerEligibleForEndgame && <p className="text-[11px] text-red-300 font-bold">{endgameDisabledReason}</p>}
                <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
                  <select
                    value={selectedEndgameCategoryId}
                    onChange={(e) => setSelectedEndgameCategoryId(e.target.value)}
                    className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-[12px] text-white outline-none focus:border-gold-500"
                  >
                    <option value="">Select category</option>
                    {gameState.categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.title}</option>
                    ))}
                  </select>
                  <button
                    onClick={startEndgameChallenge}
                    disabled={!canUseEndgameMoves || !selectedPlayerEligibleForEndgame || !selectedEndgameCategoryId || isPreparingEndgameChallenge || activeEndgameChallenge?.status === 'PENDING'}
                    className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-black px-4 py-2 rounded-lg text-[11px] uppercase"
                  >
                    {isPreparingEndgameChallenge ? 'Generating...' : 'Generate Challenge'}
                  </button>
                </div>

                {activeEndgameChallenge && (
                  <div className="rounded-xl border border-zinc-700 bg-black/40 p-4 space-y-3">
                    <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-black">Live Challenge</div>
                    <div className="text-sm text-zinc-100 font-bold">{activeEndgameChallenge.questionText}</div>
                    <div className="text-[11px] text-zinc-400">Answer: {activeEndgameChallenge.answerText}</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => resolveEndgameChallenge('SUCCESS')}
                        disabled={activeEndgameChallenge.status !== 'PENDING'}
                        className="px-3 py-2 rounded bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-[10px] font-black uppercase"
                      >
                        Resolve Success
                      </button>
                      <button
                        onClick={() => resolveEndgameChallenge('FAIL')}
                        disabled={activeEndgameChallenge.status !== 'PENDING'}
                        className="px-3 py-2 rounded bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-[10px] font-black uppercase"
                      >
                        Resolve Fail (Reset to 0)
                      </button>
                      <button
                        onClick={() => setActiveEndgameChallenge((prev) => prev ? { ...prev, status: 'CANCELED' } : prev)}
                        disabled={activeEndgameChallenge.status !== 'PENDING'}
                        className="px-3 py-2 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-[10px] font-black uppercase"
                      >
                        Cancel Challenge
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-4">
              {gameState.categories.map((cat) => (
                <div key={cat.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
                  <div className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-gold-500">{cat.title}</div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {cat.questions.map((q) => {
                      const deployment = currentOverlay.deploymentsByTileId[q.id];
                      const isArmed = deployment?.status === 'ARMED';
                      const specialMoveTagState = getTileSpecialMoveTagState(!!isArmed, resolvedSpecialMoveTileIds.has(q.id));
                      const specialMoveTagText = getTileSpecialMoveTagText(deployment?.moveType, specialMoveTagState, resolvedSpecialMoveLabelsByTileId[q.id]);
                      const isPlayable = !q.isAnswered && !q.isVoided;
                      const giftTileDisabledReason = isGiftActivatedMove(selectedMoveType)
                        ? getGiftMoveTileDisabledReason(selectedMoveType, gameState.categories, q.id)
                        : null;
                      const giftBlocked = !!giftTileDisabledReason;
                      const tileColumnIndex = getTileColumnIndex(gameState.categories, q.id);

                      return (
                        <button
                          key={q.id}
                          aria-label={`Arm ${moveLabels[selectedMoveType]} on ${cat.title} for ${q.points}`}
                          disabled={!isPlayable || armingTileId === q.id || !isTileMove(selectedMoveType) || giftBlocked}
                          onClick={() => handleArmMove(q.id)}
                          className={`rounded-xl border p-4 text-left transition-all ${!isPlayable || !isTileMove(selectedMoveType) || giftBlocked ? 'cursor-not-allowed border-zinc-800 bg-black/30 text-zinc-600 opacity-50' : isArmed ? 'border-gold-500 bg-gold-500/10 text-gold-400 shadow-lg shadow-gold-900/10' : 'border-zinc-700 bg-zinc-900 text-white hover:border-gold-500 hover:bg-zinc-800'}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-lg font-black">{q.points}</span>
                            {armingTileId === q.id && <Loader2 className="w-4 h-4 animate-spin text-gold-500" />}
                          </div>
                          <div className="mt-1 text-[9px] uppercase tracking-widest text-zinc-500">Col {tileColumnIndex >= 0 ? tileColumnIndex + 1 : '?'}</div>
                          {specialMoveBadge.showTag && (
                            <div
                              data-testid={`special-move-director-tag-${q.id}`}
                              data-state={specialMoveBadge.visualState}
                              className={`mt-2 inline-flex items-center rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${specialMoveBadge.tone === 'red'
                                ? 'bg-red-700/90 border-red-400/70 text-red-100'
                                : 'bg-zinc-800/90 border-zinc-500/60 text-zinc-300 grayscale'}`}
                            >
                              {specialMoveTagText}
                            </div>
                          )}
                          <div className="mt-3 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                            {isArmed ? moveLabels[deployment.moveType!] : 'Ready to Arm'}
                          </div>
                          {isArmed && isGiftActivatedMove(deployment.moveType as SpecialMoveType) && (
                            <div className="mt-1 inline-flex items-center rounded-full border border-amber-400/50 bg-amber-900/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-200">Gift Required</div>
                          )}
                          {giftBlocked && <div className="mt-2 text-[10px] font-black text-red-300">{giftTileDisabledReason}</div>}
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
                  <Info className="w-4 h-4" /> Special Moves Guide
              </h3>
              <p className="text-[11px] text-zinc-300 mt-3 leading-relaxed">
                  This guide explains what each special move does, when it is available, and how directors should resolve outcomes safely.
              </p>
            </div>

            <div className="bg-black/40 border border-zinc-800 rounded-2xl p-5 space-y-3">
              <h4 className="text-[11px] uppercase tracking-widest font-black text-zinc-400">Activation Flow</h4>
              <ol className="list-decimal ml-5 space-y-2 text-[12px] text-zinc-200 leading-relaxed">
                <li>Open the <span className="font-black text-gold-500">Special Moves</span> tab.</li>
                <li>Select one move type.</li>
                <li>For tile moves: click a live tile (not answered/voided) to arm it.</li>
                <li>For wins-or-nothing moves: select an eligible top-2 player, choose category, generate challenge, then resolve outcome once.</li>
                <li>On the public board, armed tiles show a Zap icon and pulse.</li>
                <li>Run the question normally; score effects apply automatically on award/return based on move rules.</li>
                <li>Use <span className="font-black text-red-400">Wipe All Armed Tiles</span> to reset at any time.</li>
              </ol>
            </div>

            <div className="space-y-3">
              <h4 className="text-[11px] uppercase tracking-widest font-black text-zinc-400">Standard Moves</h4>
              <div className="grid gap-3 md:grid-cols-2">
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-cyan-300 font-black">Double or Lose</div>
                <p className="text-[11px] text-zinc-300 mt-2">Eligibility: any active tile. Correct + award = 2x tile points. Wrong/failed return = subtract tile value. No steal allowed.</p>
              </div>
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-gold-300 font-black">Triple or Lose</div>
                <p className="text-[11px] text-zinc-300 mt-2">Eligibility: any active tile. Correct + award = 3x tile points. Wrong/failed return = subtract 130% of tile value (rounded). No steal allowed.</p>
              </div>
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-amber-300 font-black">Double Your Wins or Nothing</div>
                <p className="text-[11px] text-zinc-300 mt-2">Endgame-only. Board exhausted, no active tile, top-2 player only. AI challenge: correct doubles total score, wrong resets to 0.</p>
              </div>
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-rose-300 font-black">Triple Your Wins or Nothing</div>
                <p className="text-[11px] text-zinc-300 mt-2">Endgame-only. Board exhausted, no active tile, top-2 player only. AI challenge: correct triples total score, wrong resets to 0.</p>
              </div>
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-black">Safe Bet</div>
                <p className="text-[11px] text-zinc-300 mt-2">Eligibility: any active tile. Correct + award = +50% tile value. Wrong = no penalty. No steal allowed.</p>
              </div>
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-violet-300 font-black">Lockout</div>
                <p className="text-[11px] text-zinc-300 mt-2">Eligibility: any active tile. Correct + award = standard tile value. Wrong = no extra penalty. No steal allowed.</p>
              </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h4 className="text-[11px] uppercase tracking-widest font-black text-zinc-400">Gift Activated Special Moves</h4>
                <span className="inline-flex items-center rounded-full border border-amber-400/50 bg-amber-900/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-200">Gift Required</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-sky-300 font-black">Super Save</div>
                <p className="text-[11px] text-zinc-300 mt-2">Gift required. Board min 6 columns and min 6 active tiles. Use only in first 3 columns (never last 3). Correct + award = 3x tile points. No steal allowed.</p>
              </div>
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-amber-300 font-black">Golden Gamble</div>
                <p className="text-[11px] text-zinc-300 mt-2">Gift required. Board min 5 columns and min 5 active tiles. Middle columns only. Correct + award = 225% tile value. Wrong = -50% tile value. No steal allowed.</p>
              </div>
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-black">Shield Boost</div>
                <p className="text-[11px] text-zinc-300 mt-2">Gift required. Any active non-final-column tile. Correct + award = 2x tile value. Wrong = no penalty and tile resolves closed. No steal allowed.</p>
              </div>
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-rose-300 font-black">Final Shot</div>
                <p className="text-[11px] text-zinc-300 mt-2">Gift required. Board min 6 columns and min 4 active tiles. Last 2 columns only. Correct + award = 3x tile value. Wrong = subtract tile value. No steal allowed.</p>
              </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-zinc-300 font-black">Second Chance</div>
                <p className="text-[11px] text-zinc-300 mt-2">Concept guide: one retry after first miss, then fail closes the tile with no steal. Use only if enabled in this build.</p>
              </div>
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4">
                <div className="text-[10px] uppercase tracking-widest text-zinc-300 font-black">Category Freeze</div>
                <p className="text-[11px] text-zinc-300 mt-2">Concept guide: category cannot be selected for the next turn/round. Use only if your current show rules enable turn-based restrictions.</p>
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
                <div className="text-[10px] uppercase tracking-widest font-black text-cyan-300 mb-3">Audit (Last 12 Gameplay Highlights)</div>
                <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-2 custom-scrollbar" data-testid="audit-log-list">
                  {auditEvents.length === 0 && <div className="text-[11px] text-zinc-500">No gameplay highlights yet. Play a tile to start the reel.</div>}
                  {auditEvents.map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-zinc-800 bg-black/30 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] text-zinc-500 font-mono">{new Date(entry.iso || entry.ts).toLocaleTimeString()}</div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${entry.badgeClasses}`}>{entry.badgeLabel}</span>
                          <button
                            aria-label="Open play details"
                            onClick={() => setSelectedAuditDetail(entry)}
                            className="inline-flex items-center rounded-full border border-cyan-500/50 bg-cyan-900/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-cyan-200 hover:bg-cyan-800/40"
                          >
                            PLAY
                          </button>
                        </div>
                      </div>
                      <div className="text-[12px] text-zinc-200 mt-1 leading-relaxed">{entry.sentence}</div>
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mt-1">{entry.detail}</div>
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
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] text-zinc-500 font-mono">{entry.iso}</div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-zinc-300">{sentenceCase(entry.type)}</span>
                          <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-zinc-300">{entry.channel}</span>
                        </div>
                      </div>
                      <div className="text-[12px] text-zinc-100 mt-1 font-bold">{entry.headline}</div>
                      <div className="text-[12px] text-zinc-200 mt-1 leading-relaxed">{entry.description}</div>
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mt-1">{entry.metadataLine}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {selectedAuditDetail && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => setSelectedAuditDetail(null)}>
                <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="audit-detail-modal">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest font-black text-cyan-300">Play Event Details</div>
                      <div className="mt-1 text-sm text-zinc-100 leading-relaxed">{selectedAuditDetail.sentence}</div>
                    </div>
                    <button
                      aria-label="Close play details"
                      onClick={() => setSelectedAuditDetail(null)}
                      className="rounded-lg border border-zinc-700 px-2 py-1 text-[10px] font-bold uppercase text-zinc-300 hover:text-white"
                    >
                      Close
                    </button>
                  </div>

                  <div className="mt-4 space-y-2 text-[11px] text-zinc-300">
                    <div><span className="text-zinc-500 uppercase tracking-wide">Time:</span> {new Date(selectedAuditDetail.iso || selectedAuditDetail.ts).toLocaleTimeString()}</div>
                    <div><span className="text-zinc-500 uppercase tracking-wide">Outcome:</span> {selectedAuditDetail.badgeLabel}</div>
                    <div><span className="text-zinc-500 uppercase tracking-wide">Type:</span> {sentenceCase(selectedAuditDetail.type)}</div>
                    <div><span className="text-zinc-500 uppercase tracking-wide">Summary:</span> {selectedAuditDetail.detail}</div>
                    {selectedAuditDetail.event.context?.note && (
                      <div><span className="text-zinc-500 uppercase tracking-wide">Notes:</span> {selectedAuditDetail.event.context.note}</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'BOARD' && (
          <div className="space-y-8 animate-in fade-in duration-300">
            <DirectorAiRegenerator gameState={gameState} onUpdateState={onUpdateState} addToast={addToast} emitGameEvent={emitGameEvent} onTransformSuccessfulState={transformStateAfterBoardRegen} />
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${gameState.categories.length}, minmax(180px, 1fr))` }}>
              {gameState.categories.map((cat, cIdx) => (
                <div key={cat.id} className="space-y-3">
                  <div className="group relative">
                    <input value={cat.title} onChange={e => onUpdateState({...gameState, categories: gameState.categories.map((c, i) => i === cIdx ? {...c, title: e.target.value} : c)})} className="bg-zinc-900 text-gold-400 font-bold text-xs p-2 rounded w-full border border-transparent focus:border-gold-500 outline-none pr-8" />
                    <button onClick={() => openCategoryRegenDialog(cIdx)} className="absolute right-1 top-1 p-1 text-zinc-600 hover:text-purple-400 transition-colors" title="Regenerate this category only"><Wand2 className="w-3.5 h-3.5" /></button>
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

      {categoryRegenDialog && (() => {
        const cat = gameState.categories[categoryRegenDialog.cIdx];
        if (!cat) return null;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-xl bg-zinc-900 border border-purple-500/40 rounded-xl p-6 shadow-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-purple-300 font-black uppercase tracking-widest text-xs">Category Regeneration Mode</h3>
                  <p className="text-zinc-400 text-sm mt-2">
                    Choose how <span className="text-gold-400 font-black">{cat.title}</span> should regenerate.
                  </p>
                </div>
                <button onClick={() => setCategoryRegenDialog(null)} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
              </div>

              <div className="mt-5 space-y-3">
                <button
                  onClick={() => setCategoryRegenMode('active_only')}
                  className={`w-full rounded-xl border p-4 text-left transition-all ${categoryRegenMode === 'active_only' ? 'border-purple-400 bg-purple-500/10 text-white' : 'border-zinc-700 bg-black/30 text-zinc-300 hover:border-zinc-500'}`}
                >
                  <div className="text-[11px] font-black uppercase tracking-wider">Regenerate active tiles only</div>
                  <div className="text-[11px] text-zinc-400 mt-1">Updates content for currently playable tiles and leaves inactive tiles untouched.</div>
                </button>

                <button
                  onClick={() => setCategoryRegenMode('inactive_only')}
                  className={`w-full rounded-xl border p-4 text-left transition-all ${categoryRegenMode === 'inactive_only' ? 'border-purple-400 bg-purple-500/10 text-white' : 'border-zinc-700 bg-black/30 text-zinc-300 hover:border-zinc-500'}`}
                >
                  <div className="text-[11px] font-black uppercase tracking-wider">Regenerate voided/disabled/inactive tiles only</div>
                  <div className="text-[11px] text-zinc-400 mt-1">Updates non-playable tiles while preserving their inactive state.</div>
                </button>

                <button
                  onClick={() => setCategoryRegenMode('reset_all_active')}
                  className={`w-full rounded-xl border p-4 text-left transition-all ${categoryRegenMode === 'reset_all_active' ? 'border-gold-500 bg-gold-500/10 text-white' : 'border-zinc-700 bg-black/30 text-zinc-300 hover:border-zinc-500'}`}
                >
                  <div className="text-[11px] font-black uppercase tracking-wider">Reset category and regenerate all tiles as active</div>
                  <div className="text-[11px] text-zinc-400 mt-1">Regenerates every tile in this category and clears answered/voided/disabled state.</div>
                </button>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button onClick={() => setCategoryRegenDialog(null)} className="px-4 py-2 text-zinc-400 hover:text-white text-sm">Cancel</button>
                <button
                  onClick={() => runCategoryRegeneration(categoryRegenDialog.cIdx, categoryRegenMode)}
                  disabled={aiLoading}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-[10px] font-black uppercase tracking-widest"
                >
                  {aiLoading ? 'Regenerating...' : 'Run Regeneration'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
