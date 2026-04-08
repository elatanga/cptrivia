
import React, { useRef, useState } from 'react';
import { Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { GameState, Difficulty, Category } from '../types';
import { generateTriviaGame } from '../services/geminiService';
import { logger } from '../services/logger';
import { soundService } from '../services/soundService';
import { applyBoardMasterRegeneration } from '../services/boardRegenerationService';

interface Props {
  gameState: GameState;
  onUpdateState: (newState: GameState) => void;
  addToast: (type: 'success' | 'error' | 'info', msg: string) => void;
  emitGameEvent?: (type: any, payload: any) => void;
  onTransformSuccessfulState?: (nextState: GameState) => GameState;
}

export const DirectorAiRegenerator: React.FC<Props> = ({ gameState, onUpdateState, addToast, emitGameEvent, onTransformSuccessfulState }) => {
  const [prompt, setPrompt] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('mixed');
  const [isLoading, setIsLoading] = useState(false);
  const inFlightGenIdRef = useRef<string | null>(null);

  const handleRegenerate = async () => {
    if (isLoading || !prompt.trim()) return;
    
    // 1. Prepare Metadata & Snapshot
    const genId = crypto.randomUUID();
    const catCount = gameState.categories.length;
    const rowCount = gameState.categories[0]?.questions.length || 5;
    
    // Mask prompt for logging
    const maskedSnippet = prompt.substring(0, 20) + (prompt.length > 20 ? "..." : "");
    
    inFlightGenIdRef.current = genId;
    setIsLoading(true);
    soundService.playClick();
    
    logger.info('board_regen_master_start', {
      genId, 
      promptLen: prompt.length,
      promptSnippet: maskedSnippet, 
      difficulty, 
      dimensions: `${catCount}x${rowCount}`,
      categories: catCount,
      tiles: catCount * rowCount,
    });

    emitGameEvent?.('AI_BOARD_REGEN_START', {
      actor: { role: 'director' },
      context: { note: 'Board master regeneration requested', categories: catCount, rows: rowCount, difficulty }
    });

    try {
      // 2. Fetch new content from Gemini
      const aiCats = await generateTriviaGame(
        prompt,
        difficulty,
        catCount,
        rowCount,
        100, // Points are overridden by existing ones anyway
        genId
      );

      if (inFlightGenIdRef.current !== genId) {
        logger.warn('board_regen_master_stale_result', { genId, current: inFlightGenIdRef.current });
        return;
      }

      // Full-board reset: regenerate all categories and clear progress flags to active/playable defaults.
      const nextCats: Category[] = applyBoardMasterRegeneration(gameState.categories, aiCats);

      const regeneratedState: GameState = {
        ...gameState,
        showTitle: prompt,
        categories: nextCats,
        activeCategoryId: null,
        activeQuestionId: null,
      };

      // 4. Single atomic state update to prevent UI drift
      const finalState = onTransformSuccessfulState
        ? onTransformSuccessfulState(regeneratedState)
        : regeneratedState;
      onUpdateState(finalState);

      logger.info('board_regen_master_complete', { genId, categories: catCount, tiles: catCount * rowCount, resetToActive: true });
      emitGameEvent?.('AI_BOARD_REGEN_APPLIED', {
        actor: { role: 'director' },
        context: { note: 'Board master regeneration applied', categories: catCount, rows: rowCount }
      });
      addToast('success', 'Board reset and regenerated. All tiles are active.');
      setPrompt(''); 
    } catch (e: any) {
      // 5. ROLLBACK / FAIL-SAFE
      // We don't call onUpdateState, which effectively reverts to the existing gameState
      logger.error('board_regen_master_failed', {
        genId, 
        error: e.message,
      });
      emitGameEvent?.('AI_BOARD_REGEN_FAILED', {
        actor: { role: 'director' },
        context: { note: 'Board master regeneration failed', message: e.message }
      });
      
      addToast('error', `Regeneration failed: ${e.message}`);
    } finally {
      if (inFlightGenIdRef.current === genId) {
        setIsLoading(false);
        inFlightGenIdRef.current = null;
      }
    }
  };

  return (
    <div className="bg-purple-950/20 border border-purple-500/30 p-5 rounded-xl space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-purple-400 font-black uppercase tracking-widest text-xs flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5" /> Board Master Regeneration
        </h3>
        {isLoading && <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />}
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex-1">
          <label className="block text-[9px] uppercase font-black text-purple-300/40 mb-1.5 tracking-wider">New Global Topic</label>
          <input 
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            disabled={isLoading}
            placeholder="e.g. 1990s Pop Culture & Technology"
            className="w-full bg-black/40 border border-purple-500/20 p-2.5 rounded-lg text-white text-sm focus:border-purple-500 outline-none font-bold placeholder:text-zinc-800 transition-colors"
          />
        </div>

        <div className="w-full md:w-56 shrink-0">
          <label className="block text-[9px] uppercase font-black text-purple-300/40 mb-1.5 tracking-wider">Target Difficulty</label>
          <div className="grid grid-cols-2 gap-1">
            {(['easy', 'medium', 'hard', 'mixed'] as Difficulty[]).map(d => (
              <button 
                key={d} 
                type="button"
                onClick={() => setDifficulty(d)}
                disabled={isLoading}
                className={`py-1.5 rounded text-[9px] font-black uppercase border transition-all ${
                  difficulty === d 
                    ? 'bg-purple-600 border-purple-400 text-white shadow-lg shadow-purple-900/20' 
                    : 'bg-black/20 border-purple-500/10 text-purple-300/30 hover:border-purple-500/30'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-end">
          <button 
            onClick={handleRegenerate}
            disabled={isLoading || !prompt.trim()}
            className="w-full md:w-auto h-[38px] px-6 bg-purple-600 hover:bg-purple-500 text-white font-black uppercase text-[10px] tracking-[0.2em] rounded-lg transition-all shadow-xl disabled:opacity-30 disabled:grayscale active:scale-95"
          >
            Regenerate All
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[9px] text-purple-400/50 font-bold italic">
        <AlertCircle className="w-3 h-3" />
        <span>Resets all categories to active/playable and regenerates all content while keeping board structure and points.</span>
      </div>
    </div>
  );
};
