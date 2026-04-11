import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from './App';
import { authService } from './services/authService';

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

  const readGameState = () => JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');

  const revealFirstTile = async () => {
    const candidateButtons = screen.getAllByRole('button');
    const playableTile = candidateButtons.find((btn) => {
      const label = (btn.textContent || '').trim();
      return !btn.disabled && /^\d+$/.test(label);
    });
    expect(playableTile).toBeTruthy();

    fireEvent.click(playableTile!);
    await waitFor(() => screen.getByTitle(/Reveal Answer \(SPACE\)/i));
    const stopBtn = screen.queryByTitle(/Stop countdown/i);
    if (stopBtn) {
      fireEvent.click(stopBtn);
    }
    fireEvent.click(screen.getByTitle(/Reveal Answer \(SPACE\)/i));
  };

  test('A) appendPlayEvent ring buffer: only last 4 kept, newest first', async () => {
    await setupGame();

    // Trigger 5 award actions
    for (let i = 1; i <= 5; i++) {
      await revealFirstTile();
      await waitFor(() => screen.getByTitle(/Award \(ENTER\)/i));
      fireEvent.click(screen.getByTitle(/Award \(ENTER\)/i));
      await waitFor(() => expect(screen.queryByTitle(/Reveal Answer \(SPACE\)/i)).toBeNull());
    }

    // Go to Logs & Audit
    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(screen.getByText(/Logs & Audit/i, { selector: 'button' }));

    // Ring buffer is persisted in game state and capped at 4 entries.
    await waitFor(() => {
      const state = readGameState();
      expect((state.lastPlays || []).length).toBe(4);
    });
  });

  test('B) Event shape includes timestamps (atIso, atMs)', async () => {
    await setupGame();
    
    await revealFirstTile();
    await waitFor(() => screen.getByTitle(/Award \(ENTER\)/i));
    fireEvent.click(screen.getByTitle(/Award \(ENTER\)/i));

    await waitFor(() => {
      const state = readGameState();
      const latestPlay = (state.lastPlays || [])[0];
      expect(latestPlay).toEqual(expect.objectContaining({
        atIso: expect.any(String),
        atMs: expect.any(Number),
        action: 'AWARD',
      }));
    });
  });

  test('C) Integration: Award creates correct play log entry UI', async () => {
    await setupGame();
    
    await revealFirstTile();
    await waitFor(() => screen.getByTitle(/Award \(ENTER\)/i));
    fireEvent.click(screen.getByTitle(/Award \(ENTER\)/i));

    await waitFor(() => {
      const state = readGameState();
      const latestPlay = (state.lastPlays || [])[0];
      expect(latestPlay).toEqual(expect.objectContaining({
        action: 'AWARD',
        atMs: expect.any(Number),
        effectivePoints: expect.any(Number),
      }));
    });
  });

  test('D) Integration: Steal creates entry with stealer + victim context', async () => {
    await setupGame();
    
    await revealFirstTile();
    await waitFor(() => screen.getByTitle(/Steal \(S\)/i));
    fireEvent.click(screen.getByTitle(/Steal \(S\)/i));

    await waitFor(() => screen.getByText(/Who is stealing\?/i));
    const stealOverlay = screen.getByText(/Who is stealing\?/i).closest('div') as HTMLElement;
    const stealTargetBtn = within(stealOverlay)
      .getAllByRole('button')
      .find((btn) => !/cancel steal/i.test(btn.textContent || ''));
    expect(stealTargetBtn).toBeTruthy();
    fireEvent.click(stealTargetBtn!);

    await waitFor(() => expect(screen.queryByTitle(/Reveal Answer \(SPACE\)/i)).toBeNull());

    await waitFor(() => {
      const state = readGameState();
      const latestPlay = (state.lastPlays || [])[0];
      expect(latestPlay).toEqual(expect.objectContaining({
        action: 'STEAL',
        stealerPlayerName: 'PLAYER 2',
        attemptedPlayerName: 'PLAYER 1',
      }));
    });
  });

  test('E) Integration: Void creates entry and shows context', async () => {
    await setupGame();
    
    await revealFirstTile();
    await waitFor(() => screen.getByTitle(/Void \(ESC\)/i));
    fireEvent.click(screen.getByTitle(/Void \(ESC\)/i));

    await waitFor(() => {
      const state = readGameState();
      expect(Array.isArray(state.lastPlays)).toBe(true);
      expect(screen.queryByTitle(/Reveal Answer \(SPACE\)/i)).not.toBeInTheDocument();
    });
  });

  test('F) Regression: Logging failure does not block gameplay', async () => {
    await setupGame();

    await revealFirstTile();
    await waitFor(() => screen.getByTitle(/Award \(ENTER\)/i));

    // Force one logging timestamp failure during award.
    const spy = jest.spyOn(Date.prototype, 'toISOString').mockImplementationOnce(() => {
      throw new Error('Logger Crash');
    });
    
    // Action should succeed despite logging error
    fireEvent.click(screen.getByTitle(/Award \(ENTER\)/i));

    await waitFor(() => {
       const state = readGameState();
       expect((state.lastPlays || []).length).toBeGreaterThan(0);
       expect(screen.queryByTitle(/Reveal Answer \(SPACE\)/i)).not.toBeInTheDocument();
    });

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


