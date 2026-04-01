import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import App from './App';
import { authService } from './services/authService';

declare const jest: any;
declare const describe: any;
declare const test: any;
declare const expect: any;
declare const beforeEach: any;

// --- MOCKS ---

// Mock Logger to suppress noise
jest.mock('./services/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), getCorrelationId: () => 'test-id', maskPII: (v:any) => v }
}));

// Mock SoundService (pure side effects)
jest.mock('./services/soundService', () => ({
  soundService: {
    playSelect: jest.fn(), playReveal: jest.fn(), playAward: jest.fn(),
    playSteal: jest.fn(), playVoid: jest.fn(), playDoubleOrNothing: jest.fn(),
    playClick: jest.fn(), playTimerTick: jest.fn(), playTimerAlarm: jest.fn(),
    playToast: jest.fn(),
    setMute: jest.fn(), getMute: jest.fn().mockReturnValue(false),
    setVolume: jest.fn(), getVolume: jest.fn().mockReturnValue(0.5)
  }
}));

// Mock Gemini (AI generation)
jest.mock('./services/geminiService', () => ({
  generateTriviaGame: jest.fn().mockResolvedValue([]),
  generateSingleQuestion: jest.fn().mockResolvedValue({ text: 'AI Q', answer: 'AI A' })
}));

describe('CRUZPHAM STUDIOS Core Logic', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  // --- 1. BOOTSTRAP LOCK TESTS ---
  
  describe('BOOTSTRAP LOCK (UNIT)', () => {
    test('UI renders Bootstrap Screen when masterReady == false', async () => {
      // Clean slate -> masterReady is false
      render(<App />);
      
      // Should find the bootstrap header
      await waitFor(() => {
        expect(screen.getByText(/SYSTEM BOOTSTRAP/i)).toBeInTheDocument();
      });
      // Should not see Login
      expect(screen.queryByText(/Studio Access/i)).not.toBeInTheDocument();
    });

    test('UI skips Bootstrap and shows Login when masterReady == true', async () => {
      // Pre-seed bootstrap state
      const bootstrapState = { masterReady: true, createdAt: new Date().toISOString() };
      localStorage.setItem('cruzpham_sys_bootstrap', JSON.stringify(bootstrapState));
      
      render(<App />);

      await waitFor(() => {
        expect(screen.queryByText(/SYSTEM BOOTSTRAP/i)).not.toBeInTheDocument();
        expect(screen.getByText(/Studio Access/i)).toBeInTheDocument();
      });
    });
  });

  // --- 2. DOUBLE OR NOTHING SCORING LOGIC ---
  
  describe('SCORING LOGIC: DOUBLE OR NOTHING', () => {
    test('Points are doubled when awarding a Double Or Nothing tile', async () => {
      // Setup authenticated state with a pre-defined game
      await authService.bootstrapMasterAdmin('admin');

      // Mock session restore so the app skips the login screen
      jest.spyOn(authService, 'restoreSession').mockResolvedValue({
        success: true,
        session: { id: 'sess-123', username: 'admin', role: 'MASTER_ADMIN', createdAt: Date.now(), userAgent: 'test' } as any
      });
      
      const mockGameState = {
        showTitle: 'Test Show',
        isGameStarted: true,
        activeQuestionId: 'q1',
        activeCategoryId: 'c1',
        selectedPlayerId: 'p1',
        categories: [
          {
            id: 'c1', title: 'Cat 1',
            questions: [{ id: 'q1', points: 100, text: 'Q', answer: 'A', isRevealed: true, isAnswered: false, isDoubleOrNothing: true }]
          }
        ],
        players: [{ id: 'p1', name: 'Alice', score: 0, color: '#fff' }],
        history: [],
        timer: { duration: 30, endTime: null, isRunning: false },
        viewSettings: { boardFontScale: 1.0, tileScale: 1.0, scoreboardScale: 1.0, updatedAt: '' }
      };
      
      localStorage.setItem('cruzpham_gamestate', JSON.stringify(mockGameState));
      localStorage.setItem('cruzpham_active_session_id', 'sess-123');
      
      render(<App />);
      
      await waitFor(() => screen.getByText(/Alice/i));
      
      // Modal should be open due to activeQuestionId
      await waitFor(() => expect(screen.getByTitle(/Award \(ENTER\)/i)).toBeInTheDocument());
      
      // Award to Alice
      fireEvent.click(screen.getByTitle(/Award \(ENTER\)/i));
      
      // Assert Alice has 200 points (100 * 2)
      await waitFor(() => {
        const score = within(screen.getByTestId('scoreboard-root')).getByText('200');
        expect(score).toBeInTheDocument();
      });
    });

    test('Points are NOT doubled when awarding a normal tile', async () => {
        await authService.bootstrapMasterAdmin('admin');

        // Mock session restore so the app skips the login screen
        jest.spyOn(authService, 'restoreSession').mockResolvedValue({
          success: true,
          session: { id: 'sess-123', username: 'admin', role: 'MASTER_ADMIN', createdAt: Date.now(), userAgent: 'test' } as any
        });
        
        const mockGameState = {
          showTitle: 'Test Show',
          isGameStarted: true,
          activeQuestionId: 'q1',
          activeCategoryId: 'c1',
          selectedPlayerId: 'p1',
          categories: [
            {
              id: 'c1', title: 'Cat 1',
              questions: [{ id: 'q1', points: 100, text: 'Q', answer: 'A', isRevealed: true, isAnswered: false, isDoubleOrNothing: false }]
            }
          ],
          players: [{ id: 'p1', name: 'Alice', score: 0, color: '#fff' }],
          history: [],
          timer: { duration: 30, endTime: null, isRunning: false },
          viewSettings: { boardFontScale: 1.0, tileScale: 1.0, scoreboardScale: 1.0, updatedAt: '' }
        };
        
        localStorage.setItem('cruzpham_gamestate', JSON.stringify(mockGameState));
        localStorage.setItem('cruzpham_active_session_id', 'sess-123');
        
        render(<App />);
        
        await waitFor(() => expect(screen.getByTitle(/Award \(ENTER\)/i)).toBeInTheDocument());
        fireEvent.click(screen.getByTitle(/Award \(ENTER\)/i));
        
        await waitFor(() => {
          const scoreboard = screen.getByTestId('scoreboard-root');
          expect(within(scoreboard).getByText('100')).toBeInTheDocument();
          expect(within(scoreboard).queryByText('200')).not.toBeInTheDocument();
        });
      });
  });

  describe('AUTO-ADVANCE SCOREBOARD SELECTION', () => {
    const makePlayers = (count: number) =>
      Array.from({ length: count }, (_, idx) => ({
        id: `p${idx + 1}`,
        name: `Player ${idx + 1}`,
        score: 0,
        color: '#fff',
        wildcardsUsed: 0,
        wildcardActive: false,
        stealsCount: 0,
        specialMovesUsedCount: 0,
        specialMovesUsedNames: [],
      }));

    const seedActiveGame = async (opts?: {
      playersCount?: number;
      selectedPlayerId?: string | null;
      categoriesCount?: number;
      reorderIds?: string[];
    }) => {
      const token = await authService.bootstrapMasterAdmin('admin');
      await authService.login('admin', token);

      const basePlayers = makePlayers(opts?.playersCount ?? 3);
      const players = opts?.reorderIds
        ? opts.reorderIds.map((id) => basePlayers.find((p) => p.id === id)!).filter(Boolean)
        : basePlayers;

      const categoryQuestions = Array.from({ length: opts?.categoriesCount ?? 3 }, (_, idx) => ({
        id: `q${idx + 1}`,
        points: (idx + 1) * 100,
        text: `Q${idx + 1}`,
        answer: `A${idx + 1}`,
        isRevealed: false,
        isAnswered: false,
        isVoided: false,
      }));

      const mockGameState = {
        showTitle: 'Auto Advance Test',
        isGameStarted: true,
        categories: [{ id: 'c1', title: 'Cat 1', questions: categoryQuestions }],
        players,
        activeQuestionId: null,
        activeCategoryId: null,
        selectedPlayerId: opts?.selectedPlayerId ?? null,
        history: [],
        timer: { duration: 30, endTime: null, isRunning: false },
        viewSettings: { boardFontScale: 1.0, tileScale: 1.0, scoreboardScale: 1.0, updatedAt: '' },
        lastPlays: [],
        events: [],
      };

      localStorage.setItem('cruzpham_gamestate', JSON.stringify(mockGameState));
      localStorage.setItem('cruzpham_active_session_id', 'sess-123');

      return mockGameState;
    };

    const getPersistedState = () => JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');

    const completePlayViaAward = async (doubleSignal = false) => {
      fireEvent.click(screen.getAllByText('100')[0]);
      await waitFor(() => screen.getByText(/Reveal Answer/i));
      fireEvent.click(screen.getByText(/Reveal Answer/i));
      await waitFor(() => screen.getByText(/^Award$/i));
      const awardBtn = screen.getByText(/^Award$/i).closest('button')!;
      fireEvent.click(awardBtn);
      if (doubleSignal) fireEvent.click(awardBtn);
      await waitFor(() => {
        expect(screen.queryByText(/Reveal Answer/i)).not.toBeInTheDocument();
      });
    };

    test('auto-selects first player when game is active and selection is missing', async () => {
      const seeded = await seedActiveGame({ selectedPlayerId: null });
      render(<App />);

      await waitFor(() => screen.getByText(/End Show/i));
      await waitFor(() => {
        expect(getPersistedState().selectedPlayerId).toBe('p1');
      });

      expect(getPersistedState().players.map((p: any) => p.score)).toEqual(seeded.players.map((p) => p.score));
      expect(getPersistedState().categories[0].questions.every((q: any) => !q.isAnswered && !q.isVoided)).toBe(true);
    });

    test('advances to next player after a completed play and wraps at end', async () => {
      await seedActiveGame({ selectedPlayerId: 'p1' });
      render(<App />);
      await waitFor(() => screen.getByText(/End Show/i));

      await completePlayViaAward();
      await waitFor(() => expect(getPersistedState().selectedPlayerId).toBe('p2'));

      fireEvent.click(screen.getByText(/PLAYER 3/i));
      await waitFor(() => expect(getPersistedState().selectedPlayerId).toBe('p3'));

      fireEvent.click(screen.getAllByText('200')[0]);
      await waitFor(() => screen.getByText(/Reveal Answer/i));
      fireEvent.click(screen.getByText(/Reveal Answer/i));
      await waitFor(() => screen.getByText(/^Award$/i));
      fireEvent.click(screen.getByText(/^Award$/i).closest('button')!);
      await waitFor(() => expect(getPersistedState().selectedPlayerId).toBe('p1'));
    });

    test('manual selection remains available and next completion advances from manual choice', async () => {
      await seedActiveGame({ selectedPlayerId: 'p1' });
      const { rerender } = render(<App />);
      await waitFor(() => screen.getByText(/End Show/i));

      fireEvent.click(screen.getByText(/PLAYER 2/i));
      await waitFor(() => expect(getPersistedState().selectedPlayerId).toBe('p2'));

      rerender(<App />);
      await waitFor(() => expect(getPersistedState().selectedPlayerId).toBe('p2'));

      await completePlayViaAward();
      await waitFor(() => expect(getPersistedState().selectedPlayerId).toBe('p3'));
    });

    test('does not double-advance on duplicate completion signal', async () => {
      await seedActiveGame({ selectedPlayerId: 'p1' });
      render(<App />);
      await waitFor(() => screen.getByText(/End Show/i));

      await completePlayViaAward(true);
      await waitFor(() => expect(getPersistedState().selectedPlayerId).toBe('p2'));
    });

    test('follows players array order exactly, including custom order', async () => {
      await seedActiveGame({ selectedPlayerId: 'p2', reorderIds: ['p2', 'p3', 'p1'] });
      render(<App />);
      await waitFor(() => screen.getByText(/End Show/i));

      await completePlayViaAward();
      await waitFor(() => expect(getPersistedState().selectedPlayerId).toBe('p3'));
    });

    test('one-player and zero-player states remain stable', async () => {
      await seedActiveGame({ playersCount: 1, selectedPlayerId: 'p1' });
      render(<App />);
      await waitFor(() => screen.getByText(/End Show/i));
      await completePlayViaAward();
      await waitFor(() => expect(getPersistedState().selectedPlayerId).toBe('p1'));

      localStorage.clear();
      await seedActiveGame({ playersCount: 0, selectedPlayerId: null });
      render(<App />);
      await waitFor(() => screen.getByText(/End Show/i));
      expect(getPersistedState().selectedPlayerId).toBeNull();
    });
  });
});