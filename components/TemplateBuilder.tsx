import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Save, X, Wand2, RefreshCw, Loader2, Download, Upload, Plus, Minus, Trash2, HelpCircle, AlertCircle, Maximize2, Minimize2, RotateCcw, Sparkles, Hash, LogOut, Edit } from 'lucide-react';
import { GameTemplate, Category, Question, Difficulty, AppError, PlayMode, Team, TeamPlayStyle } from '../types';
import { generateTriviaGame, generateSingleQuestion, generateCategoryQuestions, getGeminiConfigHealth } from '../services/geminiService';
import { dataService } from '../services/dataService';
import { soundService } from '../services/soundService';
import { logger } from '../services/logger';
import { normalizePlayerName } from '../services/utils';
import { getTeamsValidationError as getTeamsModeValidationError } from '../services/teamsMode';
import {
  SESSION_TIMER_PRESET_SECONDS,
  normalizeCustomTimerToSeconds,
  resolveSessionTimerDuration,
} from '../services/sessionTimerUtils';
import type { SessionTimerUnit } from '../services/sessionTimerUtils';

type GenerationStatus = 'IDLE' | 'GENERATING' | 'APPLYING' | 'COMPLETE' | 'FAILED' | 'CANCELED';

interface GenerationState {
  status: GenerationStatus;
  id: string | null;
  stage: string;
}

interface Props {
  showId: string;
  initialTemplate?: GameTemplate | null;
  onClose: () => void;
  onSave: () => void;
  onLogout?: () => void;
  addToast: (type: any, msg: string) => void;
}

type QuickGameMode = 'single_player' | 'two_player' | null;
type QuickTimerMode = 'timed' | 'untimed' | null;

const MAX_PLAYERS = 8;
const MIN_PLAYERS = 1;
const makeStableId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
const DEFAULT_PLAY_MODE: PlayMode = 'INDIVIDUALS';
const DEFAULT_TEAM_STYLE: TeamPlayStyle = 'TEAM_PLAYS_AS_ONE';

/** Format seconds into a compact human-readable string for the UI display. */
const formatSessionDuration = (seconds: number): string => {
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = seconds / 60;
    return Number.isInteger(mins) ? `${mins}m` : `${(seconds / 60).toFixed(1)}m`;
  }
  const hrs = seconds / 3600;
  return Number.isInteger(hrs) ? `${hrs}h` : `${(seconds / 3600).toFixed(1)}h`;
};

export const TemplateBuilder: React.FC<Props> = ({ showId, initialTemplate, onClose, onSave, onLogout, addToast }) => {
  // --- STATE MACHINE ---
  const [genState, setGenState] = useState<GenerationState>({ status: 'IDLE', id: null, stage: '' });
  const [step, setStep] = useState<'CONFIG' | 'BUILDER'>(initialTemplate ? 'BUILDER' : 'CONFIG');
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoFit, setIsAutoFit] = useState(true);
  
  // Snapshots for rollback
  const snapshotRef = useRef<Category[] | null>(null);
  const currentGenId = useRef<string | null>(null);

  // Layout Measurement Refs
  const headerRef = useRef<HTMLDivElement>(null);
  const saveBtnRef = useRef<HTMLButtonElement>(null);

  // Config & AI State
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiDifficulty, setAiDifficulty] = useState<Difficulty>('mixed');
  const [quickGameMode, setQuickGameMode] = useState<QuickGameMode>(
    initialTemplate?.config?.playMode === 'TEAMS'
      ? null
      : (initialTemplate?.config?.quickGameMode ?? null)
  );
  const [quickTimerMode, setQuickTimerMode] = useState<QuickTimerMode>(initialTemplate?.config?.quickTimerMode ?? null);
  const [quickTimerDurationSeconds, setQuickTimerDurationSeconds] = useState<number>(
    resolveSessionTimerDuration(initialTemplate?.config?.quickTimerDurationSeconds, 10)
  );
  // Custom manual session timer input state
  const [customTimerValue, setCustomTimerValue] = useState('');
  const [customTimerUnit, setCustomTimerUnit] = useState<SessionTimerUnit>('seconds');
  const [customTimerError, setCustomTimerError] = useState<string | null>(null);
  const [playMode, setPlayMode] = useState<PlayMode>(initialTemplate?.config?.playMode || DEFAULT_PLAY_MODE);
  const [teamPlayStyle, setTeamPlayStyle] = useState<TeamPlayStyle>(initialTemplate?.config?.teamPlayStyle || DEFAULT_TEAM_STYLE);
  const [teamConfigs, setTeamConfigs] = useState<Team[]>(() => {
    const source = initialTemplate?.config?.teams;
    if (!Array.isArray(source) || source.length === 0) return [];
    return source.map((team, teamIndex) => ({
      id: team.id || makeStableId(),
      name: team.name || `TEAM ${teamIndex + 1}`,
      score: Number(team.score || 0),
      activeMemberId: team.activeMemberId,
      members: (team.members || []).map((member, memberIndex) => ({
        id: member.id || makeStableId(),
        name: member.name || `MEMBER ${memberIndex + 1}`,
        score: Number(member.score || 0),
        orderIndex: Number.isFinite(Number(member.orderIndex)) ? Number(member.orderIndex) : memberIndex,
      })),
    }));
  });

  const getSafePointScale = (val?: number) => {
    const allowed = [10, 20, 25, 50, 100];
    if (val && allowed.includes(val)) return val;
    return 100;
  };

  const [config, setConfig] = useState({
    title: initialTemplate?.topic || '',
    catCount: initialTemplate?.categories.length || 4,
    rowCount: initialTemplate?.config?.rowCount || 5,
    pointScale: getSafePointScale(initialTemplate?.config?.pointScale)
  });

  // --- PLAYER CONFIGURATION WITH STABLE IDS & CLAMPING ---
  const [playerConfigs, setPlayerConfigs] = useState<{id: string, name: string}[]>(() => {
    const names = initialTemplate?.config?.playerNames || [];
    const count = initialTemplate?.config?.playerCount || 4;
    
    let initialList = names.map(n => ({ id: crypto.randomUUID(), name: normalizePlayerName(n) }));
    if (initialList.length === 0 && count > 0) {
      initialList = Array.from({ length: count }).map((_, i) => ({ 
        id: crypto.randomUUID(), 
        name: `PLAYER ${i + 1}` 
      }));
    } else if (initialList.length === 0) {
      initialList = Array.from({ length: 4 }).map((_, i) => ({ 
        id: crypto.randomUUID(), 
        name: `PLAYER ${i + 1}` 
      }));
    }

    // Defensive clamping on init (Card 1 constraint)
    if (initialList.length > MAX_PLAYERS) {
      logger.error("template_players_over_max_clamped", { 
        ts: new Date().toISOString(), 
        originalCount: initialList.length, 
        clampedTo: MAX_PLAYERS 
      });
      initialList = initialList.slice(0, MAX_PLAYERS);
    }
    
    return initialList;
  });

  const syncBuilderCategories = (nextCatCount: number, nextRowCount: number, nextPointScale: number) => {
    if (step !== 'BUILDER') return;

    setCategories((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return prev;

      const nextCategories: Category[] = Array.from({ length: nextCatCount }).map((_, cIdx) => {
        const existingCategory = prev[cIdx];

        if (!existingCategory) {
          const luckyIndex = Math.floor(Math.random() * Math.max(1, nextRowCount));
          return {
            id: makeStableId(),
            title: `Category ${cIdx + 1}`,
            questions: Array.from({ length: nextRowCount }).map((__, qIdx) => ({
              id: makeStableId(),
              text: 'Enter question text...',
              answer: 'Enter answer...',
              points: (qIdx + 1) * nextPointScale,
              isRevealed: false,
              isAnswered: false,
              isDoubleOrNothing: qIdx === luckyIndex,
            })),
          };
        }

        const resizedQuestions: Question[] = Array.from({ length: nextRowCount }).map((__, qIdx) => {
          const existingQuestion = existingCategory.questions[qIdx];
          if (existingQuestion) {
            return {
              ...existingQuestion,
              points: (qIdx + 1) * nextPointScale,
            };
          }

          return {
            id: makeStableId(),
            text: 'Enter question text...',
            answer: 'Enter answer...',
            points: (qIdx + 1) * nextPointScale,
            isRevealed: false,
            isAnswered: false,
            isDoubleOrNothing: false,
          };
        });

        if (!resizedQuestions.some((q) => q.isDoubleOrNothing) && resizedQuestions.length > 0) {
          resizedQuestions[0] = { ...resizedQuestions[0], isDoubleOrNothing: true };
        }

        return {
          ...existingCategory,
          title: existingCategory.title || `Category ${cIdx + 1}`,
          questions: resizedQuestions,
        };
      });

      return nextCategories;
    });
  };

  const applyQuickGameMode = (mode: Exclude<QuickGameMode, null>) => {
    if (isLocked) return;

    const targetCount = mode === 'single_player' ? 1 : 2;
    setPlayerConfigs((prev) => {
      const base = [...prev];
      const normalized = base.map((p) => ({ ...p, name: normalizePlayerName(p.name) }));

      while (normalized.length < targetCount) {
        normalized.push({ id: crypto.randomUUID(), name: `PLAYER ${normalized.length + 1}` });
      }

      const next = normalized.slice(0, targetCount).map((p, idx) => ({
        ...p,
        name: normalizePlayerName(p.name) || `PLAYER ${idx + 1}`,
      }));

      return next;
    });

    const nextCatCount = mode === 'single_player' ? 1 : 2;
    const nextRowCount = 10;
    const nextPointScale = 10;

    setConfig((prev) => ({
      ...prev,
      catCount: nextCatCount,
      rowCount: nextRowCount,
      pointScale: nextPointScale,
    }));

    syncBuilderCategories(nextCatCount, nextRowCount, nextPointScale);

    setQuickTimerMode('timed');
    setQuickTimerDurationSeconds(10);
    setPlayMode('INDIVIDUALS');

    setQuickGameMode(mode);
    logger.info('template_quick_game_mode_selected', { showId, mode, targetCount });
  };

  const handlePlayModeSelect = (mode: PlayMode) => {
    if (isLocked) return;

    if (mode === 'TEAMS') {
      if (quickGameMode !== null) {
        setQuickGameMode(null);
      }
      setPlayMode('TEAMS');
      logger.info('template_play_mode_selected', { showId, mode, clearedQuickGameMode: quickGameMode !== null });
      return;
    }

    setPlayMode('INDIVIDUALS');
    if (quickGameMode !== null) {
      setQuickGameMode(null);
      logger.info('template_quick_game_mode_cleared', { showId, source: 'play_mode_individuals' });
    }
    logger.info('template_play_mode_selected', { showId, mode: 'INDIVIDUALS' });
  };

  const handleQuickTimerModeSelect = (mode: Exclude<QuickTimerMode, null>) => {
    if (isLocked) return;
    setQuickTimerMode(mode);
    logger.info('template_quick_timer_mode_selected', { showId, mode });
  };

  const commitSessionTimerDuration = (rawSeconds: number) => {
    const resolved = resolveSessionTimerDuration(rawSeconds, 10);
    // Custom/preset duration selection always targets the timed session-timer path.
    setQuickTimerMode('timed');
    setQuickTimerDurationSeconds(resolved);
    setCustomTimerError(null);
    return resolved;
  };

  const handleApplyCustomTimer = () => {
    if (isLocked || quickTimerMode !== 'timed') return;
    const resolved = normalizeCustomTimerToSeconds(customTimerValue, customTimerUnit);
    if (resolved === null) {
      setCustomTimerError('Enter a valid positive duration (max 24 h).');
      return;
    }
    commitSessionTimerDuration(resolved);
    setCustomTimerValue('');
    logger.info('template_custom_session_timer_applied', { showId, value: customTimerValue, unit: customTimerUnit, resolved });
  };

  const [categories, setCategories] = useState<Category[]>(initialTemplate?.categories || []);
  const [editCell, setEditCell] = useState<{cIdx: number, qIdx: number} | null>(null);
  
  const isLocked = genState.status === 'GENERATING' || genState.status === 'APPLYING' || isSaving;
  const aiConfigHealth = getGeminiConfigHealth();

  // --- LOGGING & LAYOUT INSTRUMENTATION ---
  useEffect(() => {
    if (step === 'CONFIG') {
      logger.info("template_modal_render", { 
        ts: new Date().toISOString(), 
        playersCount: playerConfigs.length, 
        viewport: { w: window.innerWidth, h: window.innerHeight } 
      });
    }
  }, [step, playerConfigs.length]);

  // --- HANDLERS ---

  const handleAddPlayer = () => {
    if (isLocked) return;
    if (playerConfigs.length >= MAX_PLAYERS) {
      logger.warn("template_players_add_blocked_max", { ts: new Date().toISOString(), count: playerConfigs.length });
      addToast('error', `Max ${MAX_PLAYERS} contestants allowed.`);
      return;
    }
    soundService.playClick();
    setPlayerConfigs([...playerConfigs, { id: crypto.randomUUID(), name: `PLAYER ${playerConfigs.length + 1}` }]);
  };

  const handleDeletePlayer = (id: string) => {
    if (isLocked) return;
    if (playerConfigs.length <= MIN_PLAYERS) {
      logger.warn("template_player_delete_blocked_min", { ts: new Date().toISOString() });
      addToast('error', `At least ${MIN_PLAYERS} contestant required.`);
      return;
    }
    soundService.playClick();
    const updated = playerConfigs.filter(p => p.id !== id);
    setPlayerConfigs(updated);
    logger.info("template_player_deleted", { ts: new Date().toISOString(), playerId: id, remainingCount: updated.length });
  };

  const handlePlayerNameChange = (id: string, value: string) => {
    setPlayerConfigs(prev => prev.map(p => p.id === id ? { ...p, name: normalizePlayerName(value) } : p));
  };

  const handleAddTeam = () => {
    if (isLocked) return;
    setTeamConfigs((prev) => [
      ...prev,
      {
        id: makeStableId(),
        name: `TEAM ${prev.length + 1}`,
        score: 0,
        activeMemberId: undefined,
        members: [{ id: makeStableId(), name: 'MEMBER 1', score: 0, orderIndex: 0 }],
      },
    ]);
  };

  const handleRemoveTeam = (teamId: string) => {
    if (isLocked) return;
    setTeamConfigs((prev) => prev.filter((team) => team.id !== teamId));
  };

  const handleTeamNameChange = (teamId: string, name: string) => {
    setTeamConfigs((prev) => prev.map((team) => (team.id === teamId ? { ...team, name: normalizePlayerName(name) } : team)));
  };

  const handleAddTeamMember = (teamId: string) => {
    if (isLocked) return;
    setTeamConfigs((prev) => prev.map((team) => {
      if (team.id !== teamId) return team;
      const members = [
        ...team.members,
        { id: makeStableId(), name: `MEMBER ${team.members.length + 1}`, score: 0, orderIndex: team.members.length },
      ];
      return {
        ...team,
        members,
        activeMemberId: team.activeMemberId || members[0]?.id,
      };
    }));
  };

  const handleRemoveTeamMember = (teamId: string, memberId: string) => {
    if (isLocked) return;
    setTeamConfigs((prev) => prev.map((team) => {
      if (team.id !== teamId) return team;
      const members = team.members.filter((member) => member.id !== memberId).map((member, index) => ({ ...member, orderIndex: index }));
      return {
        ...team,
        members,
        activeMemberId: members.some((member) => member.id === team.activeMemberId) ? team.activeMemberId : members[0]?.id,
      };
    }));
  };

  const handleTeamMemberNameChange = (teamId: string, memberId: string, value: string) => {
    setTeamConfigs((prev) => prev.map((team) => {
      if (team.id !== teamId) return team;
      return {
        ...team,
        members: team.members.map((member) => member.id === memberId ? { ...member, name: normalizePlayerName(value) } : member),
      };
    }));
  };

  const getTeamsValidationError = (): string | null => getTeamsModeValidationError(playMode, teamPlayStyle, teamConfigs);

  const teamValidationError = getTeamsValidationError();
  const canSaveTemplate = !isLocked && !isSaving && !(playMode === 'TEAMS' && !!teamValidationError);

  const handleSave = async () => {
    if (isLocked || isSaving) return;
    soundService.playClick();

    const teamsValidationError = getTeamsValidationError();
    if (teamsValidationError) {
      logger.warn('template_team_validation_failed', {
        source: 'save',
        playMode,
        reason: teamsValidationError,
      });
      addToast('error', teamsValidationError);
      return;
    }

    const atIso = new Date().toISOString();
    logger.info("template_save_click", { templateId: initialTemplate?.id || 'new', showId, ts: atIso });

    setIsSaving(true);
    try {
      await new Promise(r => setTimeout(r, 400));
      const validatedCategories = categories.map(cat => {
        if (cat.questions.some(q => q.isDoubleOrNothing)) return cat;
        const lucky = Math.floor(Math.random() * cat.questions.length);
        return {
          ...cat,
          questions: cat.questions.map((q, i) => ({...q, isDoubleOrNothing: i === lucky}))
        };
      });

      const finalPlayerNames = playerConfigs.map(p => p.name).filter(n => !!n);
      const sanitizedTeams = teamConfigs.map((team) => ({
        ...team,
        name: normalizePlayerName(team.name) || 'TEAM',
        score: Number(team.score || 0),
        members: (team.members || []).map((member, index) => ({
          ...member,
          name: normalizePlayerName(member.name) || `MEMBER ${index + 1}`,
          score: Number(member.score || 0),
          orderIndex: index,
        })),
      }));
      const normalizedQuickMode: QuickGameMode = playMode === 'TEAMS' ? null : quickGameMode;
      const normalizedTimerMode: QuickTimerMode = normalizedQuickMode
        ? (quickTimerMode || 'timed')
        : quickTimerMode;
      const normalizedTimerDurationSeconds = resolveSessionTimerDuration(quickTimerDurationSeconds, 10);

      if (quickGameMode && !quickTimerMode) {
        logger.warn('template_quick_timer_mode_defaulted', {
          showId,
          templateId: initialTemplate?.id || 'new',
          defaultedTo: 'timed',
        });
      }

      logger.info('template_quick_setup_resolved', {
        showId,
        templateId: initialTemplate?.id || 'new',
        quickGameMode: normalizedQuickMode,
        quickTimerMode: normalizedTimerMode,
        quickTimerDurationSeconds: normalizedTimerDurationSeconds,
        playerCount: finalPlayerNames.length,
        categories: validatedCategories.length,
        rowCount: validatedCategories[0]?.questions.length || config.rowCount,
      });

      if (initialTemplate) {
        dataService.updateTemplate({
          ...initialTemplate,
          topic: config.title,
          categories: validatedCategories,
          config: {
            playerCount: finalPlayerNames.length,
            playerNames: finalPlayerNames,
            categoryCount: validatedCategories.length,
            rowCount: validatedCategories[0]?.questions.length || config.rowCount,
            pointScale: config.pointScale,
            quickGameMode: normalizedQuickMode,
            quickTimerMode: normalizedTimerMode,
            quickTimerDurationSeconds: normalizedTimerDurationSeconds,
            playMode,
            teamPlayStyle,
            teams: playMode === 'TEAMS' ? sanitizedTeams : [],
          }
        });
      } else {
        dataService.createTemplate(showId, config.title, {
          playerCount: finalPlayerNames.length,
          playerNames: finalPlayerNames,
          categoryCount: validatedCategories.length,
          rowCount: validatedCategories[0]?.questions.length || config.rowCount,
          pointScale: config.pointScale,
          quickGameMode: normalizedQuickMode,
          quickTimerMode: normalizedTimerMode,
          quickTimerDurationSeconds: normalizedTimerDurationSeconds,
          playMode,
          teamPlayStyle,
          teams: playMode === 'TEAMS' ? sanitizedTeams : [],
        }, validatedCategories);
      }
      
      logger.info("template_save_success", { templateId: initialTemplate?.id || 'new', ts: new Date().toISOString() });
      addToast('success', 'Template saved successfully.');
      onSave();
    } catch (e: any) {
      logger.error("template_save_failed", { message: e.message, ts: new Date().toISOString() });
      addToast('error', 'Save failed — please retry');
    } finally {
      setIsSaving(false);
    }
  };

  const startAiGeneration = (stage: string) => {
    const genId = crypto.randomUUID();
    currentGenId.current = genId;
    snapshotRef.current = [...categories];
    setGenState({ status: 'GENERATING', id: genId, stage });
    return genId;
  };

  const handleAiFillBoard = async (prompt: string, difficulty: Difficulty) => {
    if (!prompt.trim() || isLocked) return;
    const genId = startAiGeneration('Populating entire board...');
    try {
      const generatedCats = await generateTriviaGame(prompt, difficulty, config.catCount, config.rowCount, config.pointScale, genId);
      if (currentGenId.current !== genId) return;
      setGenState(prev => ({ ...prev, status: 'APPLYING' }));
      setCategories(generatedCats);
      setConfig(prev => ({...prev, title: prompt}));
      setGenState({ status: 'COMPLETE', id: null, stage: '' });
      addToast('success', 'Board populated by AI.');
    } catch (e: any) {
      if (currentGenId.current === genId) {
        setGenState({ status: 'FAILED', id: null, stage: '' });
        if (snapshotRef.current) setCategories(snapshotRef.current);
        addToast('error', getAiToastMessage(e, 'AI Generation failed.'));
      }
    }
  };

  const handleAiRewriteCategory = async (cIdx: number) => {
    if (isLocked) return;
    soundService.playClick();
    const genId = startAiGeneration(`Rewriting category: ${categories[cIdx].title}`);
    try {
      const cat = categories[cIdx];
      const newQs = await generateCategoryQuestions(config.title, cat.title, cat.questions.length, aiDifficulty, config.pointScale, genId);
      if (currentGenId.current !== genId) return;
      setGenState(prev => ({ ...prev, status: 'APPLYING' }));
      const newCats = [...categories];
      newCats[cIdx] = {
        ...cat,
        questions: newQs.map((nq, i) => ({ ...nq, points: (i + 1) * config.pointScale, id: cat.questions[i]?.id || nq.id }))
      };
      setCategories(newCats);
      setGenState({ status: 'COMPLETE', id: null, stage: '' });
      addToast('success', `Category rewritten.`);
    } catch (e: any) {
      if (currentGenId.current === genId) {
        setGenState({ status: 'FAILED', id: null, stage: '' });
        addToast('error', getAiToastMessage(e, 'AI Failed to rewrite category.'));
      }
    }
  };

  const handleMagicCell = async (cIdx: number, qIdx: number) => {
    if (isLocked) return;
    soundService.playClick();
    const genId = startAiGeneration('Generating question...');
    try {
      const cat = categories[cIdx];
      const q = cat.questions[qIdx];
      const result = await generateSingleQuestion(config.title, q.points, cat.title, aiDifficulty, genId);
      if (currentGenId.current !== genId) return;
      setGenState(prev => ({ ...prev, status: 'APPLYING' }));
      const newCats = [...categories];
      newCats[cIdx] = { ...newCats[cIdx], questions: [...newCats[cIdx].questions] };
      newCats[cIdx].questions[qIdx] = { ...q, text: result.text, answer: result.answer };
      setCategories(newCats);
      setGenState({ status: 'COMPLETE', id: null, stage: '' });
      addToast('success', 'Question generated.');
    } catch (e: any) {
      if (currentGenId.current === genId) {
        setGenState({ status: 'FAILED', id: null, stage: '' });
        addToast('error', getAiToastMessage(e, 'Failed to generate question.'));
      }
    }
  };

  const initBoard = () => {
    if (isLocked) return;
    soundService.playClick();
    if (!config.title.trim()) {
      addToast('error', 'Title is required');
      return;
    }
    const teamsValidationError = getTeamsValidationError();
    if (teamsValidationError) {
      logger.warn('template_team_validation_failed', {
        source: 'manual_builder_start',
        playMode,
        reason: teamsValidationError,
      });
      addToast('error', teamsValidationError);
      return;
    }
      const newCats: Category[] = Array.from({ length: config.catCount }).map((_, cI) => {
      const luckyIndex = Math.floor(Math.random() * config.rowCount);
      return {
        id: makeStableId(),
        title: `Category ${cI + 1}`,
        questions: Array.from({ length: config.rowCount }).map((_, qI) => ({
          id: makeStableId(),
          text: 'Enter question text...',
          answer: 'Enter answer...',
          points: (qI + 1) * config.pointScale,
          isRevealed: false,
          isAnswered: false,
          isDoubleOrNothing: qI === luckyIndex
        }))
      };
    });
    setCategories(newCats);
    setStep('BUILDER');
  };

  const handleResetBuilder = () => {
    if (isLocked) return;
    if (confirm('Reset entire builder? Manual changes will be lost.')) {
      soundService.playClick();
      setCategories([]);
      setStep('CONFIG');
    }
  };

  const handlePointScaleChange = (val: number) => {
    soundService.playClick();
    setConfig(p => ({ ...p, pointScale: val }));
    setCategories(prev => prev.map(cat => ({
      ...cat,
      questions: cat.questions.map((q, qIdx) => ({
        ...q,
        points: (qIdx + 1) * val
      }))
    })));
  };

  const handleBuilderCategoryCountChange = (nextCatCount: number) => {
    const safeCatCount = Math.max(1, Math.min(8, nextCatCount));
    setConfig((prev) => ({ ...prev, catCount: safeCatCount }));
    syncBuilderCategories(safeCatCount, config.rowCount, config.pointScale);
  };

  const handleBuilderRowCountChange = (nextRowCount: number) => {
    const safeRowCount = Math.max(1, Math.min(10, nextRowCount));
    setConfig((prev) => ({ ...prev, rowCount: safeRowCount }));
    syncBuilderCategories(config.catCount, safeRowCount, config.pointScale);
  };

  const updateCell = (text: string, answer: string) => {
    if (!editCell || isLocked) return;
    const { cIdx, qIdx } = editCell;
    const newCats = [...categories];
    newCats[cIdx] = { ...newCats[cIdx], questions: [...newCats[cIdx].questions] };
    newCats[cIdx].questions[qIdx] = { ...newCats[cIdx].questions[qIdx], text, answer };
    setCategories(newCats);
    setEditCell(null);
  };

  const updateCatTitle = (cIdx: number, val: string) => {
    if (isLocked) return;
    const newCats = [...categories];
    newCats[cIdx] = { ...newCats[cIdx], title: val };
    setCategories(newCats);
  };

  const getAiToastMessage = (error: any, fallback: string) => {
    if (error instanceof AppError) {
      if (error.code === 'ERR_FORBIDDEN') return 'AI is not configured. Set GEMINI_API_KEY and reload.';
      if (error.code === 'ERR_NETWORK') return 'Network offline. Reconnect and try AI generation again.';
      return error.message || fallback;
    }
    return fallback;
  };

  if (step === 'CONFIG') {
    // Overhauled Config View for Card 1: Viewport-fit grid layout with zero scroll on desktop
    return (
      <div className="template-builder font-roboto font-bold fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-0 md:p-4 overflow-y-auto lg:overflow-hidden">
        <div className="w-full h-full md:h-auto md:max-h-[100dvh] md:max-w-6xl bg-zinc-900 border-0 md:border md:border-gold-600 md:rounded-xl shadow-2xl grid grid-rows-[auto_1fr_auto] overflow-hidden">
          
          {/* HEADER */}
          <div className="flex-none p-4 md:p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-950/50">
             <div className="flex flex-col">
               <h2 className="text-xl md:text-2xl font-serif text-white uppercase tracking-tight">New Template Configuration</h2>
               <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-black mt-0.5">Production Setup Stage</p>
             </div>
             <button onClick={onClose} className="text-zinc-500 hover:text-white p-2 transition-colors"><X className="w-6 h-6" /></button>
          </div>

          {/* BODY: Viewport fit non-scrollable grid on desktop */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_340px] min-h-0 overflow-y-auto lg:overflow-hidden p-4 md:p-5 lg:p-4 gap-5 md:gap-6 lg:gap-5">

            {/* LEFT COLUMN: Main Config */}
            <div className="flex flex-col gap-5 md:gap-5 lg:gap-4 min-h-0 overflow-y-auto lg:overflow-hidden pr-1 lg:pr-0 custom-scrollbar">
                <div className="shrink-0">
                  <label className="block text-[10px] uppercase text-gold-500 font-black mb-1.5 tracking-widest">Show or Game Topic</label>
                  <input 
                    disabled={isLocked}
                    value={config.title} onChange={e => setConfig(p => ({...p, title: e.target.value}))}
                    className="w-full bg-black border border-zinc-700 p-3 md:p-4 rounded text-white focus:border-gold-500 outline-none disabled:opacity-50 text-base md:text-lg font-roboto font-bold placeholder:text-zinc-800"
                    placeholder="e.g. Science Night 2024" autoFocus
                  />
                </div>
                
                <div className="flex-1 flex flex-col gap-4 md:gap-5 lg:gap-4 min-h-0">

                  {/* Dimensions & Scale */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 lg:gap-4 shrink-0">
                    <div className="space-y-3">
                      <h3 className="text-[10px] uppercase text-zinc-400 font-black border-b border-zinc-800 pb-1 tracking-widest">Board Dimensions</h3>
                      <div className="flex justify-between items-center text-xs text-zinc-300 font-bold">
                          <label>Categories (Max 8)</label>
                          <div className="flex items-center gap-2 bg-black p-1 rounded border border-zinc-800">
                            <button disabled={isLocked} onClick={() => setConfig(p => ({...p, catCount: Math.max(1, p.catCount - 1)}))} className="p-1 hover:text-gold-500 transition-colors"><Minus className="w-3 h-3 text-gold-500" /></button>
                            <span data-testid="template-cat-count" className="w-4 text-center text-white font-mono">{config.catCount}</span>
                            <button disabled={isLocked} onClick={() => setConfig(p => ({...p, catCount: Math.min(8, p.catCount + 1)}))} className="p-1 hover:text-gold-500 transition-colors"><Plus className="w-3 h-3 text-gold-500" /></button>
                          </div>
                      </div>
                      <div className="flex justify-between items-center text-xs text-zinc-300 font-bold">
                          <label>Rows (Max 10)</label>
                          <div className="flex items-center gap-2 bg-black p-1 rounded border border-zinc-800">
                            <button disabled={isLocked} onClick={() => setConfig(p => ({...p, rowCount: Math.max(1, p.rowCount - 1)}))} className="p-1 hover:text-gold-500 transition-colors"><Minus className="w-3 h-3 text-gold-500" /></button>
                            <span data-testid="template-row-count" className="w-4 text-center text-white font-mono">{config.rowCount}</span>
                            <button disabled={isLocked} onClick={() => setConfig(p => ({...p, rowCount: Math.min(10, p.rowCount + 1)}))} className="p-1 hover:text-gold-500 transition-colors"><Plus className="w-3 h-3 text-gold-500" /></button>
                          </div>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                       <label className="text-[10px] uppercase text-zinc-500 font-black tracking-widest block">Points Increment</label>
                       <div className="flex flex-wrap gap-1">
                          {[10, 20, 25, 50, 100].map(val => (
                             <button key={val} type="button" disabled={isLocked} onClick={() => handlePointScaleChange(val)} className={`flex-1 min-w-[40px] py-1.5 md:py-2 rounded text-[10px] font-bold border transition-all ${config.pointScale === val ? 'bg-gold-600 border-gold-500 text-black' : 'bg-black border-zinc-800 text-zinc-500 hover:border-zinc-600'}`}>{val}</button>
                          ))}
                       </div>
                       <p className="text-[9px] text-zinc-500 font-mono italic">Range: {config.pointScale} - {config.pointScale * config.rowCount} pts</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-4 lg:gap-3 shrink-0">
                    <div className="space-y-2">
                      <h3 className="text-[10px] uppercase text-zinc-400 font-black border-b border-zinc-800 pb-1 tracking-widest">Play Mode</h3>
                      <p className="text-[10px] text-zinc-500">Choose individual contestants or team-based play.</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={() => handlePlayModeSelect('INDIVIDUALS')}
                          className={`py-2 rounded text-[10px] font-bold border transition-all ${playMode === 'INDIVIDUALS' ? 'bg-gold-600 border-gold-500 text-black' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
                        >
                          Individuals
                        </button>
                        <button
                          type="button"
                          disabled={isLocked || quickGameMode !== null}
                          onClick={() => handlePlayModeSelect('TEAMS')}
                          className={`py-2 rounded text-[10px] font-bold border transition-all ${playMode === 'TEAMS' ? 'bg-gold-600 border-gold-500 text-black' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'} disabled:opacity-40`}
                        >
                          Teams
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-[10px] uppercase text-zinc-400 font-black border-b border-zinc-800 pb-1 tracking-widest">Quick Game Setup</h3>
                      <p className="text-[10px] text-zinc-500">Fast setup for one-person or head-to-head play.</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={isLocked || playMode === 'TEAMS'}
                          onClick={() => applyQuickGameMode('single_player')}
                          className={`py-2 rounded text-[10px] font-bold border transition-all ${quickGameMode === 'single_player' ? 'bg-gold-600 border-gold-500 text-black' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'} disabled:opacity-40`}
                        >
                          1 Player
                        </button>
                        <button
                          type="button"
                          disabled={isLocked || playMode === 'TEAMS'}
                          onClick={() => applyQuickGameMode('two_player')}
                          className={`py-2 rounded text-[10px] font-bold border transition-all ${quickGameMode === 'two_player' ? 'bg-gold-600 border-gold-500 text-black' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'} disabled:opacity-40`}
                        >
                          2 Players
                        </button>
                      </div>
                      {playMode === 'TEAMS' && (
                        <p className="text-[9px] text-zinc-500 uppercase tracking-wide">Quick setup is available only for Individuals mode.</p>
                      )}
                      {quickGameMode !== null && (
                        <p className="text-[9px] text-zinc-500 uppercase tracking-wide">Quick setup is active. Switch to Individuals to return to standard mode.</p>
                      )}
                    </div>
                    <div className="space-y-2" data-testid="template-session-timer-section">
                      <h3 className="text-[10px] uppercase text-zinc-400 font-black border-b border-zinc-800 pb-1 tracking-widest">Session Timer</h3>
                      <p className="text-[10px] text-zinc-500">Sets the session-wide countdown for quick game modes. Preset in seconds — or enter a custom duration below.</p>
                      {/* Timed / No Timer toggle */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={() => handleQuickTimerModeSelect('timed')}
                          className={`py-2 rounded text-[10px] font-bold border transition-all ${quickTimerMode === 'timed' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
                        >
                          Timed
                        </button>
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={() => handleQuickTimerModeSelect('untimed')}
                          className={`py-2 rounded text-[10px] font-bold border transition-all ${quickTimerMode === 'untimed' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
                        >
                          No Timer
                        </button>
                      </div>
                      {/* Quick preset buttons (expanded: 5s–60s) */}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {SESSION_TIMER_PRESET_SECONDS.map((secs) => (
                          <button
                            key={secs}
                            type="button"
                            disabled={isLocked || quickTimerMode !== 'timed'}
                            onClick={() => { commitSessionTimerDuration(secs); }}
                            className={`px-2 py-1 rounded text-[9px] font-bold border transition-all ${quickTimerDurationSeconds === secs && quickTimerMode === 'timed' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'} disabled:opacity-40`}
                          >
                            {secs}s
                          </button>
                        ))}
                      </div>
                      {/* Custom duration input */}
                      <div className={`mt-2 space-y-1 ${quickTimerMode !== 'timed' ? 'opacity-40 pointer-events-none' : ''}`}>
                        <p className="text-[9px] text-zinc-500 uppercase tracking-wide font-bold">Custom duration</p>
                        <div className="flex flex-wrap gap-1 items-center">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={customTimerValue}
                            disabled={isLocked || quickTimerMode !== 'timed'}
                            onChange={(e) => { setCustomTimerValue(e.target.value); setCustomTimerError(null); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleApplyCustomTimer(); }}
                            placeholder="e.g. 5"
                            className="w-20 bg-black border border-zinc-700 text-white text-[10px] font-mono px-2 py-1 rounded outline-none focus:border-purple-500 disabled:opacity-40"
                            data-testid="custom-session-timer-input"
                          />
                          <select
                            value={customTimerUnit}
                            disabled={isLocked || quickTimerMode !== 'timed'}
                            onChange={(e) => setCustomTimerUnit(e.target.value as SessionTimerUnit)}
                            className="bg-black border border-zinc-700 text-zinc-300 text-[10px] px-2 py-1 rounded outline-none focus:border-purple-500 disabled:opacity-40"
                            data-testid="custom-session-timer-unit"
                          >
                            <option value="seconds">sec</option>
                            <option value="minutes">min</option>
                            <option value="hours">hr</option>
                          </select>
                          <button
                            type="button"
                            disabled={isLocked || quickTimerMode !== 'timed' || !customTimerValue}
                            onClick={handleApplyCustomTimer}
                            className="px-2 py-1 rounded text-[9px] font-black uppercase border border-purple-700 text-purple-300 hover:bg-purple-900/30 disabled:opacity-40 transition-all"
                            data-testid="custom-session-timer-apply"
                          >
                            Apply
                          </button>
                        </div>
                        {customTimerError && (
                          <p className="text-[9px] text-red-400 font-bold">{customTimerError}</p>
                        )}
                      </div>
                      {/* Current duration readout */}
                      <p className="text-[9px] text-zinc-500 font-mono mt-1">
                        Session timer:{' '}
                        <span data-testid="template-session-timer-duration" className="text-purple-300 font-bold">
                          {quickTimerMode === 'timed'
                            ? `${quickTimerDurationSeconds}s (${formatSessionDuration(quickTimerDurationSeconds)})`
                            : 'off'}
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Contestants (Card 1 Fix: Always visible 2-column grid, no scroll) */}
                  {playMode === 'INDIVIDUALS' && (
                  <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex justify-between items-center border-b border-zinc-800 pb-1 mb-3">
                       <h3 className="text-[10px] uppercase text-zinc-400 font-black tracking-widest">Contestants (Max 8)</h3>
                       <button 
                         disabled={playerConfigs.length >= MAX_PLAYERS || isLocked} 
                         onClick={handleAddPlayer} 
                         className="text-[10px] text-gold-500 hover:text-white font-bold disabled:opacity-30 transition-all flex items-center gap-1"
                       >
                         <Plus className="w-3 h-3" /> {playerConfigs.length >= MAX_PLAYERS ? 'MAX 8 REACHED' : 'ADD PLAYER'}
                       </button>
                    </div>
                    
                    {/* Deterministic 2-column grid ensures all 8 visible without scroll on desktop */}
                    <div className="grid grid-cols-2 gap-2 overflow-visible auto-rows-[clamp(36px,4vh,48px)]">
                       {playerConfigs.map((p) => (
                         <div key={p.id} className="flex gap-2 items-center bg-black/40 border border-zinc-800/50 p-1 px-3 rounded-lg h-full group transition-colors hover:border-zinc-700">
                            <input 
                              value={p.name.toUpperCase()} 
                              onChange={(e) => handlePlayerNameChange(p.id, e.target.value)} 
                              className="flex-1 bg-transparent text-white text-[11px] md:text-xs font-roboto-bold outline-none placeholder:text-zinc-800 uppercase tracking-tight" 
                              placeholder="ENTER NAME"
                            />
                            <button onClick={() => handleDeletePlayer(p.id)} className="text-zinc-700 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1.5" title="Remove Player"><Trash2 className="w-3.5 h-3.5" /></button>
                         </div>
                       ))}
                    </div>
                  </div>
                  )}

                  {playMode === 'TEAMS' && (
                    <div className="flex-1 flex flex-col min-h-0">
                      <div className="flex justify-between items-center border-b border-zinc-800 pb-1 mb-3">
                        <div>
                          <h3 className="text-[10px] uppercase text-zinc-400 font-black tracking-widest">Teams Setup</h3>
                          <p className="text-[9px] text-zinc-500 mt-1">Configure team rosters and team play style.</p>
                        </div>
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={handleAddTeam}
                          data-testid="template-add-team-button"
                          className="text-[10px] text-gold-500 hover:text-white font-bold transition-all flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" /> ADD TEAM
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={() => setTeamPlayStyle('TEAM_PLAYS_AS_ONE')}
                          className={`py-2 rounded text-[10px] font-bold border transition-all ${teamPlayStyle === 'TEAM_PLAYS_AS_ONE' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
                        >
                          Team plays as one
                        </button>
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={() => setTeamPlayStyle('TEAM_MEMBERS_TAKE_TURNS')}
                          className={`py-2 rounded text-[10px] font-bold border transition-all ${teamPlayStyle === 'TEAM_MEMBERS_TAKE_TURNS' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
                        >
                          Team members take turns
                        </button>
                      </div>
                      <div className="text-[9px] text-zinc-500 mb-3 uppercase tracking-wide">
                        {teamPlayStyle === 'TEAM_PLAYS_AS_ONE'
                          ? 'Team plays as one: teams can have different numbers of players and score is tracked at the team level.'
                          : 'Team members take turns: individual points display under the team, team total is shown, and all teams must have the same number of players.'}
                      </div>

                      <div className="space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                        {teamConfigs.map((team, teamIndex) => (
                          <div key={team.id} className="border border-zinc-800 rounded-lg p-3 bg-black/30">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              <input
                                value={team.name}
                                onChange={(e) => handleTeamNameChange(team.id, e.target.value)}
                                className="flex-1 bg-black border border-zinc-800 rounded px-2 py-1 text-[11px] uppercase text-white min-w-[140px]"
                                placeholder={`TEAM ${teamIndex + 1}`}
                              />
                              <button type="button" onClick={() => handleAddTeamMember(team.id)} className="text-[10px] text-gold-500 hover:text-white font-bold px-2 py-1 border border-zinc-800 rounded">+ MEMBER</button>
                              <button type="button" onClick={() => handleRemoveTeam(team.id)} className="text-[10px] text-red-400 hover:text-red-300 font-bold px-2 py-1 border border-zinc-800 rounded">REMOVE</button>
                            </div>
                            <div className="space-y-1">
                              {team.members.map((member, memberIndex) => (
                                <div key={member.id} className="flex items-center gap-2 flex-wrap">
                                  <input
                                    value={member.name}
                                    onChange={(e) => handleTeamMemberNameChange(team.id, member.id, e.target.value)}
                                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[9px] uppercase text-zinc-200 min-w-[120px]"
                                    placeholder={`MEMBER ${memberIndex + 1}`}
                                  />
                                  <button type="button" onClick={() => handleRemoveTeamMember(team.id, member.id)} className="text-[10px] text-zinc-500 hover:text-red-400 px-1">X</button>
                                </div>
                              ))}
                            </div>
                            <div className="mt-2 text-[9px] text-zinc-500 uppercase">{team.name || `TEAM ${teamIndex + 1}`} ({team.members.length} members)</div>
                          </div>
                        ))}
                        {teamConfigs.length === 0 && (
                          <div className="text-[10px] text-zinc-500 uppercase border border-dashed border-zinc-800 rounded-lg p-3 text-center">
                            No teams configured yet.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Transition to board */}
                <div className="shrink-0 pt-4 border-t border-zinc-800/30">
                   <button onClick={initBoard} disabled={isLocked} className="w-full py-4 rounded bg-zinc-800 border border-zinc-700 text-gold-500 font-roboto font-bold hover:bg-zinc-700 hover:text-white transition-all uppercase tracking-[0.2em] text-xs flex items-center justify-center gap-3 shadow-xl shadow-black/40 active:scale-95 disabled:opacity-50">
                     <Edit className="w-4 h-4" /> Start Manual Studio Building
                   </button>
                </div>
            </div>

            {/* RIGHT COLUMN: AI Magic Studio */}
            <div className="hidden lg:flex flex-col bg-black/40 border border-purple-500/20 rounded-xl p-4 space-y-4 relative overflow-hidden group">
                 <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none">
                    <Sparkles className="w-32 h-32 text-purple-500" />
                 </div>
                 <div className="relative z-10">
                    <h3 className="text-sm uppercase text-purple-400 font-roboto font-bold flex items-center gap-2 tracking-widest mb-2"><Sparkles className="w-4 h-4" /> AI Magic Studio</h3>
                    <p className="text-[11px] text-zinc-500 leading-relaxed font-bold">Automate the entire production. Enter a topic and let Gemini generate all categories and questions instantly.</p>
                    <div data-testid="ai-config-health" className={`mt-3 text-[10px] uppercase tracking-wider font-black px-2 py-1 rounded inline-block ${aiConfigHealth.ready ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-700/40' : 'bg-amber-900/30 text-amber-300 border border-amber-700/40'}`}>
                      {aiConfigHealth.ready ? 'AI Ready' : 'AI Not Configured'}
                    </div>
                    {!aiConfigHealth.ready && (
                      <p className="mt-2 text-[10px] text-amber-300/90 font-bold">
                        Set <code>GEMINI_API_KEY</code> (or <code>API_KEY</code>) and reload.
                      </p>
                    )}
                 </div>
                 <div className="space-y-5 relative z-10 flex-1 min-h-0">
                    <div>
                       <label className="block text-[10px] uppercase text-zinc-500 font-black mb-2 tracking-widest">Topic for AI Board</label>
                       <input 
                         value={aiPrompt}
                         onChange={e => setAiPrompt(e.target.value)}
                         placeholder="e.g. 90s Pop Culture"
                         className="w-full bg-zinc-900 border border-zinc-800 p-3 rounded text-white text-sm outline-none focus:border-purple-500 font-roboto font-bold placeholder:text-zinc-700"
                       />
                    </div>
                    <div>
                       <label className="block text-[10px] uppercase text-zinc-500 font-black mb-2 tracking-widest">Game Difficulty</label>
                       <div className="grid grid-cols-2 gap-2">
                          {(['easy', 'medium', 'hard', 'mixed'] as Difficulty[]).map(d => (
                             <button key={d} type="button" onClick={() => setAiDifficulty(d)} className={`py-2 rounded text-[10px] font-roboto font-bold uppercase border transition-all ${aiDifficulty === d ? 'bg-purple-600 border-purple-400 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-600 hover:border-zinc-700'}`}>{d}</button>
                          ))}
                       </div>
                    </div>
                 </div>
                 <div className="relative z-10 pt-4">
                    <button 
                      onClick={() => {
                        if (aiPrompt) {
                           const teamsValidationError = getTeamsValidationError();
                           if (teamsValidationError) {
                             logger.warn('template_team_validation_failed', {
                               source: 'ai_board_generation',
                               playMode,
                               reason: teamsValidationError,
                             });
                             addToast('error', teamsValidationError);
                             return;
                           }
                          soundService.playClick();
                          const newCats = Array.from({ length: config.catCount }).map((_, cI) => ({
                            id: makeStableId(), title: `AI Generating...`,
                            questions: Array.from({ length: config.rowCount }).map((_, qI) => ({ id: makeStableId(), text: '', answer: '', points: (qI + 1) * config.pointScale, isRevealed: false, isAnswered: false, isDoubleOrNothing: false }))
                          }));
                          setCategories(newCats);
                          setStep('BUILDER');
                          handleAiFillBoard(aiPrompt, aiDifficulty);
                        }
                      }}
                       disabled={!aiPrompt || isLocked || (playMode === 'TEAMS' && !!teamValidationError)}
                      className="w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-roboto font-bold rounded shadow-xl flex items-center justify-center gap-3 transition-all disabled:opacity-30 uppercase tracking-[0.15em] text-xs active:scale-95"
                    >
                      <Sparkles className="w-5 h-5" /> Generate Complete Board
                    </button>
                     {playMode === 'TEAMS' && teamValidationError && (
                       <p className="mt-2 text-[10px] text-amber-300/90 font-bold uppercase tracking-wide">
                         {teamValidationError}
                       </p>
                     )}
                 </div>
            </div>
          </div>

          {/* FOOTER: Static row at the bottom, no overlap */}
          <div className="flex-none p-4 md:p-6 border-t border-zinc-800 bg-zinc-950/50 flex gap-4">
             <button onClick={onClose} className="flex-1 py-3 md:py-4 rounded border border-zinc-800 text-zinc-500 font-roboto font-bold uppercase tracking-widest text-[10px] hover:bg-zinc-900 hover:text-white transition-colors">Cancel Production Setup</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="template-builder font-roboto font-bold fixed inset-0 z-[200] bg-black flex flex-col animate-in fade-in duration-200 overflow-hidden">
      {/* HEADER: Builder-specific context */}
      <header 
        ref={headerRef}
        className="flex-none h-auto min-h-[4rem] bg-zinc-900 border-b border-gold-900/30 flex items-center px-4 md:px-6 shadow-lg z-50 pointer-events-auto"
      >
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <button disabled={isLocked} onClick={onClose} className="text-zinc-500 hover:text-white shrink-0"><X className="w-6 h-6" /></button>
          
          <div className="flex flex-col min-w-0 flex-1 max-w-2xl">
            <span className="text-[9px] uppercase text-gold-600 font-black tracking-widest mb-0.5">Template Title</span>
            <input 
              disabled={isLocked}
              value={config.title} 
              onChange={e => setConfig(p => ({...p, title: e.target.value}))}
              className="bg-transparent text-sm md:text-lg text-white font-roboto font-bold outline-none border-b border-transparent focus:border-gold-500 placeholder:text-zinc-700 disabled:opacity-50 truncate"
              placeholder="Enter Template Title..."
            />
          </div>
        </div>

        {/* Builder High-Priority Actions Stacking */}
        <div data-testid="builder-actions-row" className="flex flex-col items-end gap-1 ml-4 z-[60]">
           {onLogout && (
             <button 
               onClick={() => { soundService.playClick(); onClose(); onLogout(); }}
               className="text-[9px] uppercase font-black text-red-500 hover:text-red-400 items-center gap-1 transition-colors px-1 flex"
             >
               <LogOut className="w-2.5 h-2.5" /> Logout
             </button>
           )}
           <button 
             ref={saveBtnRef}
             disabled={!canSaveTemplate} 
             onClick={handleSave} 
             data-testid="save-template-button"
             className="bg-gold-600 hover:bg-gold-500 text-black font-roboto font-bold px-4 md:px-6 py-2 rounded-lg flex items-center gap-2 shadow-xl transition-all active:scale-95 border-b-2 border-gold-800"
           >
             {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
             <span className="uppercase text-[10px] tracking-wider font-black">Save Template</span>
           </button>
        </div>
      </header>

      {/* BODY: Responsive stacking */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        
        {/* ASIDE: Visible on all devices, stacks on mobile */}
        <aside className="flex-none w-full lg:w-72 bg-zinc-950 border-r border-zinc-800 p-4 shrink-0 space-y-6 overflow-y-auto custom-scrollbar lg:h-full">
           <div className="bg-purple-950/10 border border-purple-500/20 p-4 rounded-xl space-y-4">
              <h4 className="text-[11px] text-purple-400 uppercase font-roboto font-bold tracking-widest flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" /> Magic Studio</h4>
              <div data-testid="ai-config-health-inline" className={`text-[9px] uppercase tracking-wider font-black px-2 py-1 rounded inline-block ${aiConfigHealth.ready ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-700/40' : 'bg-amber-900/30 text-amber-300 border border-amber-700/40'}`}>
                {aiConfigHealth.ready ? 'AI Ready' : 'AI Not Configured'}
              </div>
              {!aiConfigHealth.ready && (
                <p className="text-[9px] text-amber-300/90 font-bold">
                  Set <code>GEMINI_API_KEY</code> (or <code>API_KEY</code>) and reload.
                </p>
              )}
              <div className="space-y-1.5">
                 <label className="text-[9px] uppercase text-zinc-500 font-black">AI Topic</label>
                 <input disabled={isLocked} value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} placeholder="Enter board topic..." className="w-full bg-black border border-zinc-800 p-2 rounded text-xs text-white outline-none focus:border-purple-500 font-roboto font-bold" />
              </div>
              <div className="space-y-1.5">
                 <label className="text-[9px] uppercase text-zinc-500 font-black">Difficulty</label>
                 <div className="grid grid-cols-2 gap-1.5">
                    {(['easy', 'medium', 'hard', 'mixed'] as Difficulty[]).map(d => (
                       <button key={d} onClick={() => setAiDifficulty(d)} className={`py-1.5 rounded text-[9px] font-roboto font-bold uppercase border ${aiDifficulty === d ? 'bg-purple-600 border-purple-400 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}>{d}</button>
                    ))}
                 </div>
              </div>
              <button onClick={() => handleAiFillBoard(aiPrompt, aiDifficulty)} disabled={!aiPrompt || isLocked} className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-roboto font-bold rounded text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95"><Wand2 className="w-4 h-4" /> Re-populate All</button>
           </div>
           
           <div className="space-y-4" data-testid="builder-parity-controls">
              <h4 className="text-[10px] text-zinc-500 uppercase tracking-widest border-b border-zinc-900 pb-1 font-roboto font-bold">Parameters</h4>
              <div className="space-y-2">
                 <div className="flex justify-between items-center text-xs text-zinc-400 font-bold">
                    <span>Categories</span>
                    <div className="flex items-center gap-2 bg-black p-1 rounded border border-zinc-800">
                      <button disabled={isLocked} onClick={() => handleBuilderCategoryCountChange(config.catCount - 1)} className="p-1 hover:text-gold-500 transition-colors"><Minus className="w-3 h-3 text-gold-500" /></button>
                      <span className="w-4 text-center text-white font-mono">{config.catCount}</span>
                      <button disabled={isLocked} onClick={() => handleBuilderCategoryCountChange(config.catCount + 1)} className="p-1 hover:text-gold-500 transition-colors"><Plus className="w-3 h-3 text-gold-500" /></button>
                    </div>
                 </div>
                 <div className="flex justify-between items-center text-xs text-zinc-400 font-bold">
                    <span>Rows</span>
                    <div className="flex items-center gap-2 bg-black p-1 rounded border border-zinc-800">
                      <button disabled={isLocked} onClick={() => handleBuilderRowCountChange(config.rowCount - 1)} className="p-1 hover:text-gold-500 transition-colors"><Minus className="w-3 h-3 text-gold-500" /></button>
                      <span className="w-4 text-center text-white font-mono">{config.rowCount}</span>
                      <button disabled={isLocked} onClick={() => handleBuilderRowCountChange(config.rowCount + 1)} className="p-1 hover:text-gold-500 transition-colors"><Plus className="w-3 h-3 text-gold-500" /></button>
                    </div>
                 </div>
              </div>
              <div className="flex justify-between items-center text-xs text-zinc-400 font-bold">
                 <span>Point Increment</span>
                 <select value={config.pointScale} onChange={e => handlePointScaleChange(parseInt(e.target.value))} className="bg-black border border-zinc-800 rounded p-1 text-gold-500 outline-none font-roboto font-bold">
                    {[10, 20, 25, 50, 100].map(v => <option key={v} value={v}>{v}</option>)}
                 </select>
              </div>
              <div className="flex items-center justify-between">
                 <span className="text-xs text-zinc-400 font-bold">Auto-fit Grid</span>
                 <button onClick={() => setIsAutoFit(!isAutoFit)} className={`p-1 rounded ${isAutoFit ? 'text-gold-500 bg-gold-950/30' : 'text-zinc-600 bg-zinc-900'}`}>{isAutoFit ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}</button>
              </div>

              <div className="space-y-2 border-t border-zinc-900 pt-3">
                <h4 className="text-[10px] text-zinc-500 uppercase tracking-widest font-roboto font-bold">Play Mode</h4>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => handlePlayModeSelect('INDIVIDUALS')}
                    className={`py-2 rounded text-[10px] font-bold border transition-all ${playMode === 'INDIVIDUALS' ? 'bg-gold-600 border-gold-500 text-black' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
                  >
                    Individuals
                  </button>
                  <button
                    type="button"
                    disabled={isLocked || quickGameMode !== null}
                    onClick={() => handlePlayModeSelect('TEAMS')}
                    className={`py-2 rounded text-[10px] font-bold border transition-all ${playMode === 'TEAMS' ? 'bg-gold-600 border-gold-500 text-black' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'} disabled:opacity-40`}
                  >
                    Teams
                  </button>
                </div>
              </div>

              <div className="space-y-2 border-t border-zinc-900 pt-3">
                <h4 className="text-[10px] text-zinc-500 uppercase tracking-widest font-roboto font-bold">Quick Game Setup</h4>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isLocked || playMode === 'TEAMS'}
                    onClick={() => applyQuickGameMode('single_player')}
                    className={`py-2 rounded text-[10px] font-bold border transition-all ${quickGameMode === 'single_player' ? 'bg-gold-600 border-gold-500 text-black' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'} disabled:opacity-40`}
                  >
                    1 Player
                  </button>
                  <button
                    type="button"
                    disabled={isLocked || playMode === 'TEAMS'}
                    onClick={() => applyQuickGameMode('two_player')}
                    className={`py-2 rounded text-[10px] font-bold border transition-all ${quickGameMode === 'two_player' ? 'bg-gold-600 border-gold-500 text-black' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'} disabled:opacity-40`}
                  >
                    2 Players
                  </button>
                </div>
              </div>

              <div className="space-y-2 border-t border-zinc-900 pt-3" data-testid="builder-session-timer-section">
                <h4 className="text-[10px] text-zinc-500 uppercase tracking-widest font-roboto font-bold">Session Timer</h4>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => handleQuickTimerModeSelect('timed')}
                    className={`py-2 rounded text-[10px] font-bold border transition-all ${quickTimerMode === 'timed' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
                  >
                    Timed
                  </button>
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => handleQuickTimerModeSelect('untimed')}
                    className={`py-2 rounded text-[10px] font-bold border transition-all ${quickTimerMode === 'untimed' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'}`}
                  >
                    No Timer
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {SESSION_TIMER_PRESET_SECONDS.map((secs) => (
                    <button
                      key={`builder-${secs}`}
                      type="button"
                      disabled={isLocked || quickTimerMode !== 'timed'}
                      onClick={() => { commitSessionTimerDuration(secs); }}
                      className={`px-2 py-1 rounded text-[9px] font-bold border transition-all ${quickTimerDurationSeconds === secs && quickTimerMode === 'timed' ? 'bg-purple-600 border-purple-500 text-white' : 'bg-black border-zinc-800 text-zinc-400 hover:border-zinc-700'} disabled:opacity-40`}
                    >
                      {secs}s
                    </button>
                  ))}
                </div>
                <div className={`space-y-1 ${quickTimerMode !== 'timed' ? 'opacity-40 pointer-events-none' : ''}`}>
                  <div className="flex flex-wrap gap-1 items-center">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={customTimerValue}
                      disabled={isLocked || quickTimerMode !== 'timed'}
                      onChange={(e) => { setCustomTimerValue(e.target.value); setCustomTimerError(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleApplyCustomTimer(); }}
                      placeholder="5"
                      className="w-16 bg-black border border-zinc-700 text-white text-[10px] font-mono px-2 py-1 rounded outline-none focus:border-purple-500 disabled:opacity-40"
                      data-testid="builder-custom-session-timer-input"
                    />
                    <select
                      value={customTimerUnit}
                      disabled={isLocked || quickTimerMode !== 'timed'}
                      onChange={(e) => setCustomTimerUnit(e.target.value as SessionTimerUnit)}
                      className="bg-black border border-zinc-700 text-zinc-300 text-[10px] px-2 py-1 rounded outline-none focus:border-purple-500 disabled:opacity-40"
                      data-testid="builder-custom-session-timer-unit"
                    >
                      <option value="seconds">sec</option>
                      <option value="minutes">min</option>
                      <option value="hours">hr</option>
                    </select>
                    <button
                      type="button"
                      disabled={isLocked || quickTimerMode !== 'timed' || !customTimerValue}
                      onClick={handleApplyCustomTimer}
                      className="px-2 py-1 rounded text-[9px] font-black uppercase border border-purple-700 text-purple-300 hover:bg-purple-900/30 disabled:opacity-40 transition-all"
                    >
                      Apply
                    </button>
                  </div>
                  {customTimerError && <p className="text-[9px] text-red-400 font-bold">{customTimerError}</p>}
                </div>
                <p className="text-[9px] text-zinc-500 font-mono">
                  {quickTimerMode === 'timed' ? `${quickTimerDurationSeconds}s` : 'off'}
                </p>
              </div>

              {playMode === 'INDIVIDUALS' && (
                <div className="space-y-2 border-t border-zinc-900 pt-3" data-testid="builder-contestants-section">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-[10px] text-zinc-500 uppercase tracking-widest font-roboto font-bold">Contestants</h4>
                    <button
                      type="button"
                      disabled={playerConfigs.length >= MAX_PLAYERS || isLocked}
                      onClick={handleAddPlayer}
                      className="text-[9px] text-gold-500 hover:text-white font-black border border-zinc-700 rounded px-2 py-1 disabled:opacity-40"
                    >
                      + PLAYER
                    </button>
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                    {playerConfigs.map((player) => (
                      <div key={player.id} className="flex items-center gap-2">
                        <input
                          value={player.name}
                          onChange={(e) => handlePlayerNameChange(player.id, e.target.value)}
                          className="flex-1 bg-black border border-zinc-800 rounded px-2 py-1 text-[10px] uppercase text-white"
                          placeholder="ENTER NAME"
                        />
                        <button
                          type="button"
                          onClick={() => handleDeletePlayer(player.id)}
                          disabled={isLocked}
                          className="text-[9px] text-zinc-500 hover:text-red-400 px-1"
                        >
                          X
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
           </div>

           {playMode === 'TEAMS' && (
             <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-3 space-y-3" data-testid="builder-teams-setup">
               <div className="flex items-center justify-between gap-2">
                 <h4 className="text-[10px] text-zinc-400 uppercase tracking-widest font-black">Teams Setup</h4>
                 <button
                   type="button"
                   disabled={isLocked}
                   onClick={handleAddTeam}
                   data-testid="builder-add-team-button"
                   className="text-[10px] text-gold-500 hover:text-white font-black border border-zinc-700 rounded px-2 py-1 disabled:opacity-40"
                 >
                   + TEAM
                 </button>
               </div>
               <p className="text-[9px] text-zinc-500 uppercase tracking-wide">
                 Add players to each team before continuing.
               </p>
               <p className="text-[9px] text-zinc-500 uppercase tracking-wide">
                 {teamPlayStyle === 'TEAM_MEMBERS_TAKE_TURNS'
                   ? 'Players Take Turns requires matching player counts across teams.'
                   : 'Team Plays As One allows different player counts.'}
               </p>
               {teamValidationError && (
                 <p className="text-[9px] text-amber-300 uppercase tracking-wide font-black border border-amber-600/30 bg-amber-950/20 rounded px-2 py-1">
                   {teamValidationError}
                 </p>
               )}

               <div className="space-y-2 max-h-52 overflow-y-auto pr-1 custom-scrollbar">
                 {teamConfigs.map((team, teamIndex) => (
                   <div key={team.id} className="border border-zinc-800 rounded p-2 bg-black/20 space-y-1.5">
                     <div className="flex items-center gap-2 flex-wrap">
                       <input
                         value={team.name}
                         onChange={(e) => handleTeamNameChange(team.id, e.target.value)}
                         className="flex-1 bg-black border border-zinc-800 rounded px-2 py-1 text-[10px] uppercase text-white min-w-[140px]"
                         placeholder={`TEAM ${teamIndex + 1}`}
                       />
                       <button type="button" onClick={() => handleAddTeamMember(team.id)} className="text-[9px] text-gold-400 border border-zinc-700 rounded px-2 py-1">+ PLAYER</button>
                       <button type="button" onClick={() => handleRemoveTeam(team.id)} className="text-[9px] text-red-400 border border-zinc-700 rounded px-2 py-1">DEL</button>
                     </div>
                     <div className="space-y-1">
                       {team.members.map((member, memberIndex) => (
                         <div key={member.id} className="flex items-center gap-2 flex-wrap">
                           <input
                             value={member.name}
                             onChange={(e) => handleTeamMemberNameChange(team.id, member.id, e.target.value)}
                             className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[9px] uppercase text-zinc-200 min-w-[120px]"
                             placeholder={`PLAYER ${memberIndex + 1}`}
                           />
                           <button type="button" onClick={() => handleRemoveTeamMember(team.id, member.id)} className="text-[10px] text-zinc-500 hover:text-red-400 px-1">X</button>
                         </div>
                       ))}
                     </div>
                     <div className="mt-2 text-[9px] text-zinc-500 uppercase">{team.name || `TEAM ${teamIndex + 1}`} ({(team.members || []).length} players)</div>
                   </div>
                 ))}
               </div>
             </div>
           )}

           <div className="pt-4 border-t border-zinc-900">
              <button onClick={handleResetBuilder} className="w-full text-left p-2.5 rounded hover:bg-red-950/20 text-[10px] font-roboto font-bold uppercase text-zinc-300 flex items-center gap-2 transition-colors"><RotateCcw className="w-3.5 h-3.5 text-red-500" /> Reset Board</button>
           </div>
        </aside>

        {/* MAIN PREVIEW AREA: Local Toolbar + Grid */}
        <main className="flex-1 overflow-auto bg-zinc-950/50 flex flex-col relative custom-scrollbar">
          
          {/* LOCAL TOOLBAR: Fixed within builder scroll, provides context & save action */}
          <div className="sticky top-0 z-30 bg-zinc-900/90 backdrop-blur-md border-b border-zinc-800 p-4 flex items-center justify-between shadow-md">
            <div className="flex items-center gap-3">
               <Sparkles className="w-4 h-4 text-gold-500 animate-pulse" />
               <h3 className="text-sm font-roboto font-bold text-white uppercase tracking-widest">Live Builder Preview</h3>
            </div>
          </div>

          <div className="p-4 md:p-8">
            <div className={`grid gap-2 mx-auto transition-transform duration-300 ${isAutoFit ? 'max-w-6xl' : ''}`} style={{ gridTemplateColumns: `repeat(${categories.length}, minmax(100px, 1fr))`, transformOrigin: 'top center' }}>
              {categories.map((cat, cIdx) => (
                <div key={cat.id} className="flex flex-col gap-2">
                  <div className="relative group/header">
                    <input disabled={isLocked} value={cat.title} onChange={(e) => updateCatTitle(cIdx, e.target.value)} className="w-full bg-gold-700 text-black font-roboto font-bold text-center p-2 rounded uppercase text-[clamp(10px,1vw,13px)] border-b-2 border-gold-900 outline-none focus:bg-gold-600 transition-colors" />
                    {!isLocked && <button onClick={() => handleAiRewriteCategory(cIdx)} className="absolute -top-1 -right-1 p-1 bg-purple-600 rounded-full text-white opacity-0 group-hover/header:opacity-100 transition-opacity shadow-lg z-10" title="AI Regenerate Category"><Sparkles className="w-3.5 h-3.5" /></button>}
                  </div>
                  {cat.questions.map((q, qIdx) => (
                    <div key={q.id} onClick={() => { if(!isLocked) { soundService.playSelect(); setEditCell({cIdx, qIdx}); } }} className={`bg-zinc-900 border border-zinc-800 hover:border-gold-500 text-gold-400 font-roboto-bold flex-1 flex flex-col items-center justify-center rounded min-h-[48px] md:min-h-[52px] relative group transition-all ${isLocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer active:scale-95 shadow-md hover:shadow-gold-500/10'}`}>
                      <span className={`text-[clamp(12px,1.5vw,16px)] font-roboto-bold ${q.isDoubleOrNothing ? 'text-red-500' : ''}`}>{q.points}</span>
                      {q.isDoubleOrNothing && <div className="absolute top-0.5 right-0.5 text-[7px] bg-red-900 text-white px-0.5 rounded font-roboto-bold">2X</div>}
                      {(q.text && q.text !== 'Enter question text...') && <div className="absolute bottom-1 right-1 w-1.5 h-1.5 bg-green-500 rounded-full" />}
                      {!isLocked && <button onClick={(e) => { e.stopPropagation(); handleMagicCell(cIdx, qIdx); }} className="absolute bottom-1 left-1 p-0.5 bg-purple-900/50 rounded text-purple-200 opacity-0 group-hover:opacity-100 transition-opacity" title="Quick AI Generate"><Sparkles className="w-2.5 h-2.5" /></button>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>

      {isLocked && genState.status === 'GENERATING' && (
        <div className="absolute inset-0 z-[150] bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center p-8 animate-in fade-in">
           <div className="bg-zinc-900 border border-gold-600/50 p-8 rounded-2xl shadow-2xl max-w-sm w-full text-center">
              <Loader2 className="w-10 h-10 text-gold-500 animate-spin mx-auto mb-4" />
              <h3 className="text-white text-lg mb-2 uppercase font-roboto font-bold tracking-widest">AI Studio Working</h3>
              <p className="text-zinc-400 text-[10px] mb-6 uppercase tracking-widest font-roboto font-bold">{genState.stage}</p>
           </div>
        </div>
      )}

      {editCell && !isLocked && (() => {
         const { cIdx, qIdx } = editCell;
         const q = categories[cIdx].questions[qIdx];
         return (
           <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
             <div className="w-full max-w-lg bg-zinc-900 border border-gold-500/50 rounded-xl p-6 shadow-2xl">
               <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-gold-500 font-roboto font-bold uppercase text-sm tracking-widest">{categories[cIdx].title}</h3>
                    <p className="text-zinc-500 text-[10px] font-roboto font-bold uppercase mt-0.5">{q.points} Points // Index {qIdx+1}</p>
                  </div>
                  <button onClick={() => setEditCell(null)} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
               </div>
               <div className="space-y-4">
                 <div><label className="text-[10px] uppercase text-zinc-500 font-roboto font-bold mb-1 block">Question Prompt</label><textarea id="edit-q-text" defaultValue={q.text} className="w-full bg-black border border-zinc-700 text-white p-3 rounded focus:border-gold-500 outline-none min-h-[100px] text-sm font-roboto font-bold" /></div>
                 <div><label className="text-[10px] uppercase text-zinc-500 font-roboto font-bold mb-1 block">Revealed Answer</label><textarea id="edit-q-answer" defaultValue={q.answer} className="w-full bg-black border border-zinc-700 text-white p-3 rounded focus:border-gold-500 outline-none min-h-[60px] text-sm font-roboto font-bold" /></div>
                 <div className="flex items-center gap-2 p-3 bg-zinc-950 rounded border border-zinc-800">
                    <input type="checkbox" id="edit-q-double" defaultChecked={q.isDoubleOrNothing} onChange={(e) => { const n = [...categories]; n[cIdx].questions[qIdx] = { ...n[cIdx].questions[qIdx], isDoubleOrNothing: e.target.checked }; setCategories(n); }} className="accent-gold-600 w-4 h-4" />
                    <label htmlFor="edit-q-double" className="text-xs text-red-500 font-roboto font-bold uppercase">Double Or Nothing Tile</label>
                 </div>
               </div>
               <div className="flex justify-between items-center mt-8 pt-4 border-t border-zinc-800">
                 <button onClick={() => handleMagicCell(cIdx, qIdx)} className="text-purple-400 hover:text-purple-300 flex items-center gap-2 text-[10px] uppercase font-roboto font-bold group"><Sparkles className="w-4 h-4 group-hover:scale-110 transition-transform" /> AI Regen Tile</button>
                 <button onClick={() => { const txt = (document.getElementById('edit-q-text') as HTMLTextAreaElement).value; const ans = (document.getElementById('edit-q-answer') as HTMLTextAreaElement).value; updateCell(txt, ans); }} className="bg-gold-600 hover:bg-gold-500 text-black font-roboto font-bold px-6 py-2 rounded text-xs uppercase tracking-widest shadow-lg shadow-gold-900/20">Update Tile</button>
               </div>
             </div>
           </div>
         );
      })()}
      <style>{`
        .template-builder .grid-item { min-height: 52px; }
        .template-builder input, .template-builder textarea, .template-builder select, .template-builder button { font-family: "Roboto", system-ui, sans-serif; font-weight: 700; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #FFD700; }
      `}</style>
    </div>
  );
};
