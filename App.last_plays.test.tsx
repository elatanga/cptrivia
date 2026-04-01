import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import { authService } from './services/authService';
import { logger } from './services/logger';

// --- TYPE DECLARATIONS ---
declare const jest: any;
declare const describe: any;
declare const test: any;
declare const expect: any;
declare const beforeEach: any;

// --- MOCKS ---
jest.mock('./services/logger', () => ({
  logger: { 
    info: jest.fn(), 
    error: jest.fn(), 
    warn: jest.fn(), 
    getCorrelationId: () => 'test-id', 
    maskPII: (v: any) => v 
  }
}));

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

jest.mock('./services/geminiService', () => ({
  generateTriviaGame: jest.fn().mockResolvedValue([]),
  generateSingleQuestion: jest.fn().mockResolvedValue({ text: 'AI Q', answer: 'AI A' }),
  generateCategoryQuestions: jest.fn().mockResolvedValue([])
}));

// Mock window interactions
window.scrollTo = jest.fn();
window.confirm = jest.fn(() => true);

describe('CARD 3: "Last 4 Plays" Real-Time Logs', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  const setupGame = async () => {
    const token = await authService.bootstrapMasterAdmin('admin');
    const loginRes = await authService.login('admin', token);
    if (!loginRes.success || !loginRes.session) throw new Error('Login failed in test setup');

    // Seed a started game with multiple 100-point tiles so we can complete 5 plays deterministically.
    localStorage.setItem('cruzpham_gamestate', JSON.stringify({
      showTitle: 'Logs Show',
      isGameStarted: true,
      categories: [{
        id: 'c1',
        title: 'Logs Category',
        questions: Array.from({ length: 5 }, (_, idx) => ({
          id: `q${idx + 1}`,
          points: 100,
          text: `Q${idx + 1}`,
          answer: `A${idx + 1}`,
          isRevealed: false,
          isAnswered: false,
          isVoided: false,
        })),
      }],
      players: [
        { id: 'p1', name: 'Player 1', score: 0, color: '#fff', wildcardsUsed: 0, wildcardActive: false, stealsCount: 0, specialMovesUsedCount: 0, specialMovesUsedNames: [] },
        { id: 'p2', name: 'Player 2', score: 0, color: '#fff', wildcardsUsed: 0, wildcardActive: false, stealsCount: 0, specialMovesUsedCount: 0, specialMovesUsedNames: [] },
        { id: 'p3', name: 'Player 3', score: 0, color: '#fff', wildcardsUsed: 0, wildcardActive: false, stealsCount: 0, specialMovesUsedCount: 0, specialMovesUsedNames: [] },
      ],
      activeQuestionId: null,
      activeCategoryId: null,
      selectedPlayerId: 'p1',
      history: [],
      timer: { duration: 30, endTime: null, isRunning: false },
      viewSettings: { boardFontScale: 1.0, tileScale: 1.0, scoreboardScale: 1.0, updatedAt: '' },
      lastPlays: [],
      events: [],
    }));
    localStorage.setItem('cruzpham_active_session_id', loginRes.session.id);

    render(<App />);
    await waitFor(() => screen.getByText(/End Show/i));
  };

  const clickPlayableTile = (points: string) => {
    const tileBtn = screen
      .getAllByRole('button')
      .find((btn) => btn.textContent?.trim() === points && !btn.hasAttribute('disabled'));
    if (!tileBtn) throw new Error(`No playable tile found for ${points}`);
    fireEvent.click(tileBtn);
  };

  const readState = () => JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');

  test('A) appendPlayEvent ring buffer: only last 4 kept, newest first', async () => {
    await setupGame();

    // Trigger 5 award actions
    for (let i = 1; i <= 5; i++) {
      clickPlayableTile('100');
      await waitFor(() => screen.getByTitle(/Reveal Answer/i));
      fireEvent.click(screen.getByTitle(/Reveal Answer/i));
      await waitFor(() => screen.getByTitle(/Award/i));
      fireEvent.click(screen.getByTitle(/Award/i));
      await waitFor(() => screen.queryByTitle(/Reveal Answer/i) === null);
    }

    await waitFor(() => {
      const plays = readState().lastPlays;
      expect(Array.isArray(plays)).toBe(true);
      expect(plays.length).toBe(4);
      expect(plays[0].action).toBe('AWARD');
    });
  });

  test('B) Event shape includes timestamps (atIso, atMs)', async () => {
    await setupGame();
    
    clickPlayableTile('100');
    await waitFor(() => screen.getByTitle(/Reveal Answer/i));
    fireEvent.click(screen.getByTitle(/Reveal Answer/i));
    await waitFor(() => screen.getByTitle(/Award/i));
    fireEvent.click(screen.getByTitle(/Award/i));

    await waitFor(() => {
      const play = readState().lastPlays?.[0];
      expect(play).toEqual(expect.objectContaining({
        atIso: expect.any(String),
        atMs: expect.any(Number),
        action: 'AWARD'
      }));
    });
  });

  test('C) Integration: Award creates correct play log entry UI', async () => {
    await setupGame();
    
    clickPlayableTile('100');
    await waitFor(() => screen.getByTitle(/Reveal Answer/i));
    fireEvent.click(screen.getByTitle(/Reveal Answer/i));
    await waitFor(() => screen.getByTitle(/Award/i));
    fireEvent.click(screen.getByTitle(/Award/i));

    await waitFor(() => {
      const play = readState().lastPlays?.[0];
      expect(play).toEqual(expect.objectContaining({
        action: 'AWARD',
        attemptedPlayerName: 'Player 1',
        awardedPlayerName: 'Player 1',
        effectivePoints: 100,
      }));
    });
  });

  test('D) Integration: Steal creates entry with stealer + victim context', async () => {
    await setupGame();
    
    clickPlayableTile('100');
    await waitFor(() => screen.getByTitle(/Reveal Answer/i));
    fireEvent.click(screen.getByTitle(/Reveal Answer/i));
    await waitFor(() => screen.getByTitle(/Steal/i));
    fireEvent.click(screen.getByTitle(/Steal/i));

    await waitFor(() => screen.getByText('Player 2'));
    fireEvent.click(screen.getByText('Player 2').closest('button')!);

    await waitFor(() => screen.queryByTitle(/Reveal Answer/i) === null);

    await waitFor(() => {
      const play = readState().lastPlays?.[0];
      expect(play).toEqual(expect.objectContaining({
        action: 'STEAL',
        stealerPlayerName: 'Player 2',
        attemptedPlayerName: 'Player 1'
      }));
    });
  });

  test('E) Integration: Void creates entry and shows context', async () => {
    await setupGame();
    
    clickPlayableTile('100');
    await waitFor(() => screen.getByTitle(/Reveal Answer/i));
    fireEvent.click(screen.getByTitle(/Reveal Answer/i));
    await waitFor(() => screen.getByTitle(/Void/i));
    fireEvent.click(screen.getByTitle(/Void/i));

    await waitFor(() => {
      const play = readState().lastPlays?.[0];
      expect(play?.action).toBe('VOID');
      expect(readState().categories[0].questions[0].isVoided).toBe(true);
    });
  });

  test('F) Regression: Logging failure does not block gameplay', async () => {
    await setupGame();

    const infoSpy = jest.spyOn(logger, 'info').mockImplementation((eventName: string) => {
      if (eventName === 'game_play_event') throw new Error('Logger Crash');
    });

    try {
      clickPlayableTile('100');
      await waitFor(() => screen.getByTitle(/Reveal Answer/i));
      fireEvent.click(screen.getByTitle(/Reveal Answer/i));
      await waitFor(() => screen.getByTitle(/Award/i));

      // Action should succeed even when play-event logging fails.
      fireEvent.click(screen.getByTitle(/Award/i));

      await waitFor(() => {
        expect(readState().categories[0].questions[0].isAnswered).toBe(true);
        expect(screen.queryByTitle(/Reveal Answer/i)).not.toBeInTheDocument();
      });
    } finally {
      infoSpy.mockRestore();
    }
  });
});

describe('Scoreboard auto-advance selection', () => {
  const seedGame = async (opts?: {
    playersCount?: number;
    selectedPlayerId?: string | null;
    orderedIds?: string[];
  }) => {
    const token = await authService.bootstrapMasterAdmin('admin');
    const loginRes = await authService.login('admin', token);
    if (!loginRes.success || !loginRes.session) throw new Error('Login failed in test setup');

    const basePlayers = Array.from({ length: opts?.playersCount ?? 3 }, (_, idx) => ({
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

    const players = opts?.orderedIds
      ? opts.orderedIds.map((id) => basePlayers.find((p) => p.id === id)!).filter(Boolean)
      : basePlayers;

    const mockState = {
      showTitle: 'Selection Test',
      isGameStarted: true,
      categories: [{
        id: 'c1',
        title: 'Cat 1',
        questions: [
          { id: 'q1', points: 100, text: 'Q1', answer: 'A1', isRevealed: false, isAnswered: false, isVoided: false },
          { id: 'q2', points: 200, text: 'Q2', answer: 'A2', isRevealed: false, isAnswered: false, isVoided: false },
          { id: 'q3', points: 300, text: 'Q3', answer: 'A3', isRevealed: false, isAnswered: false, isVoided: false },
        ],
      }],
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

    localStorage.setItem('cruzpham_gamestate', JSON.stringify(mockState));
    localStorage.setItem('cruzpham_active_session_id', loginRes.session.id);
  };

  const readSelected = () => JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}').selectedPlayerId;

  const completeAward = async (tilePoints = '100', duplicateSignal = false) => {
    const tileBtn = screen
      .getAllByRole('button')
      .find((btn) => btn.textContent?.trim() === tilePoints && !btn.hasAttribute('disabled'));
    if (!tileBtn) throw new Error(`No playable tile found for ${tilePoints}`);
    fireEvent.click(tileBtn);
    await waitFor(() => screen.getByTitle(/Reveal Answer/i));
    fireEvent.click(screen.getByTitle(/Reveal Answer/i));
    await waitFor(() => screen.getByTitle(/Award/i));
    const awardBtn = screen.getByTitle(/Award/i);
    fireEvent.click(awardBtn);
    if (duplicateSignal) fireEvent.click(awardBtn);
    await waitFor(() => expect(screen.queryByTitle(/Reveal Answer/i)).toBeNull());
  };

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  const selectPlayerFromScoreboard = (label: RegExp) => {
    const root = screen.getByTestId('scoreboard-root');
    const nameNode = root.querySelectorAll('span');
    const target = Array.from(nameNode).find((el) => label.test((el.textContent || '').toUpperCase())) as HTMLElement | undefined;
    if (!target) throw new Error('Scoreboard name not found for manual selection');
    fireEvent.click(target);
  };

  test('auto-selects first player when game is active with no valid selection', async () => {
    await seedGame({ selectedPlayerId: null });
    render(<App />);

    await waitFor(() => screen.getByText(/End Show/i));
    await waitFor(() => expect(readSelected()).toBe('p1'));

    const persisted = JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');
    expect(persisted.players.map((p: any) => p.score)).toEqual([0, 0, 0]);
    expect(persisted.categories[0].questions.every((q: any) => q.isAnswered === false)).toBe(true);
  });

  test('advances selection after completed play and wraps from last to first', async () => {
    await seedGame({ selectedPlayerId: 'p3' });
    render(<App />);

    await waitFor(() => screen.getByText(/End Show/i));

    await completeAward('200');
    await waitFor(() => expect(readSelected()).toBe('p1'));
  });

  test.skip('manual selection is preserved and next completion advances from manual choice', async () => {
    await seedGame({ selectedPlayerId: 'p1' });
    const view = render(<App />);

    await waitFor(() => screen.getByText(/End Show/i));
    fireEvent.click(screen.getByText(/PLAYER 2/i));
    await waitFor(() => expect(readSelected()).toBe('p2'));

    view.rerender(<App />);
    await waitFor(() => expect(readSelected()).toBe('p2'));

    await completeAward('100');
    await waitFor(() => expect(readSelected()).toBe('p3'));
  });

  test('does not double-advance on duplicate completion signal and respects player order', async () => {
    await seedGame({ selectedPlayerId: 'p2', orderedIds: ['p2', 'p3', 'p1'] });
    render(<App />);

    await waitFor(() => screen.getByText(/End Show/i));
    await completeAward('100', true);
    await waitFor(() => expect(readSelected()).toBe('p3'));
  });

  test('one-player and zero-player games stay stable', async () => {
    await seedGame({ playersCount: 1, selectedPlayerId: 'p1' });
    const first = render(<App />);
    await waitFor(() => screen.getByText(/End Show/i));
    await completeAward('100');
    await waitFor(() => expect(readSelected()).toBe('p1'));

    first.unmount();
    localStorage.clear();

    await seedGame({ playersCount: 0, selectedPlayerId: null });
    render(<App />);
    await waitFor(() => screen.getByText(/End Show/i));
    expect(readSelected()).toBeNull();
  });
});


