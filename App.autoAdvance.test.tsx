import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { authService } from './services/authService';

vi.mock('./services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    getCorrelationId: () => 'test-id',
    maskPII: (value: unknown) => value,
  },
}));

vi.mock('./services/soundService', () => ({
  soundService: {
    getMute: vi.fn(() => false),
    getVolume: vi.fn(() => 0.5),
    setMute: vi.fn(),
    setVolume: vi.fn(),
    playSelect: vi.fn(),
    playReveal: vi.fn(),
    playAward: vi.fn(),
    playSteal: vi.fn(),
    playVoid: vi.fn(),
    playClick: vi.fn(),
    playTimerTick: vi.fn(),
    playTimerAlarm: vi.fn(),
    playDoubleOrNothing: vi.fn(),
    playToast: vi.fn(),
  },
}));

type TestPlayer = {
  id: string;
  name: string;
  score: number;
  color: string;
  wildcardsUsed: number;
  wildcardActive: boolean;
  stealsCount: number;
  questionsAnswered: number;
  lostOrVoidedCount: number;
  specialMovesUsedCount: number;
  specialMovesUsedNames: string[];
};

type SeedOptions = {
  selectedPlayerId?: string;
  activeQuestionId?: string | null;
  activeCategoryId?: string | null;
  isRevealed?: boolean;
};

const testPlayers: TestPlayer[] = [
  {
    id: 'p1',
    name: 'Alice',
    score: 0,
    color: '#fff',
    wildcardsUsed: 0,
    wildcardActive: false,
    stealsCount: 0,
    questionsAnswered: 0,
    lostOrVoidedCount: 0,
    specialMovesUsedCount: 0,
    specialMovesUsedNames: [],
  },
  {
    id: 'p2',
    name: 'Bob',
    score: 0,
    color: '#fff',
    wildcardsUsed: 0,
    wildcardActive: false,
    stealsCount: 0,
    questionsAnswered: 0,
    lostOrVoidedCount: 0,
    specialMovesUsedCount: 0,
    specialMovesUsedNames: [],
  },
  {
    id: 'p3',
    name: 'Carol',
    score: 0,
    color: '#fff',
    wildcardsUsed: 0,
    wildcardActive: false,
    stealsCount: 0,
    questionsAnswered: 0,
    lostOrVoidedCount: 0,
    specialMovesUsedCount: 0,
    specialMovesUsedNames: [],
  },
];

const seedAuthenticatedGameState = async (options: SeedOptions = {}) => {
  const token = await authService.bootstrapMasterAdmin('admin');
  const loginResult = await authService.login('admin', token);
  localStorage.setItem('cruzpham_active_session_id', loginResult.session!.id);

  const selectedPlayerId = options.selectedPlayerId ?? 'p1';
  const isRevealed = options.isRevealed ?? true;
  const activeQuestionId = options.activeQuestionId === undefined ? 'q1' : options.activeQuestionId;
  const activeCategoryId = options.activeCategoryId === undefined ? 'c1' : options.activeCategoryId;

  const mockGameState = {
    showTitle: 'Turn Order Test Show',
    isGameStarted: true,
    categories: [
      {
        id: 'c1',
        title: 'Category 1',
        questions: [
          {
            id: 'q1',
            points: 100,
            text: 'Turn order question?',
            answer: 'Answer',
            isRevealed,
            isAnswered: false,
            isVoided: false,
            isDoubleOrNothing: false,
          },
        ],
      },
    ],
    players: testPlayers,
    playMode: 'INDIVIDUALS',
    teamPlayStyle: 'TEAM_PLAYS_AS_ONE',
    teams: [],
    activeQuestionId,
    activeCategoryId,
    selectedPlayerId,
    history: [],
    timer: { duration: 30, endTime: null, isRunning: false },
    viewSettings: { boardFontScale: 1, tileScale: 1, scoreboardScale: 1, updatedAt: '' },
    lastPlays: [],
    events: [],
  };

  localStorage.setItem('cruzpham_gamestate', JSON.stringify(mockGameState));
};

const getSelectedPlayerIdFromStorage = () => {
  const saved = localStorage.getItem('cruzpham_gamestate');
  return saved ? JSON.parse(saved).selectedPlayerId : null;
};

describe('Auto-advance turn order regression lock (VOID vs RETURN)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });


  it('VOID wraps from last player back to first', async () => {
    await seedAuthenticatedGameState({ selectedPlayerId: 'p3' });
    render(<App />);

    await screen.findByTestId('reveal-root');
    fireEvent.click(screen.getByTitle('Void (ESC)'));

    await waitFor(() => {
      expect(getSelectedPlayerIdFromStorage()).toBe('p1');
    });
  });

  it('RETURN keeps selected player unchanged', async () => {
    await seedAuthenticatedGameState({ selectedPlayerId: 'p1' });
    render(<App />);

    await screen.findByTestId('reveal-root');
    fireEvent.click(screen.getByTitle('Return (BACKSPACE)'));

    await waitFor(() => {
      expect(getSelectedPlayerIdFromStorage()).toBe('p1');
    });
  });

  it('VOID advances correctly from a pre-selected (manual) player context', async () => {
    await seedAuthenticatedGameState({ selectedPlayerId: 'p2' });
    render(<App />);

    await screen.findByTestId('reveal-root');

    fireEvent.click(screen.getByTitle('Void (ESC)'));

    await waitFor(() => {
      expect(getSelectedPlayerIdFromStorage()).toBe('p3');
    });
  });

  it('RETURN preserves a pre-selected (manual) player context', async () => {
    await seedAuthenticatedGameState({ selectedPlayerId: 'p2' });
    render(<App />);

    await screen.findByTestId('reveal-root');

    fireEvent.click(screen.getByTitle('Return (BACKSPACE)'));

    await waitFor(() => {
      expect(getSelectedPlayerIdFromStorage()).toBe('p2');
    });
  });

  it('award keeps existing auto-advance behavior', async () => {
    await seedAuthenticatedGameState({ selectedPlayerId: 'p1' });
    render(<App />);

    await screen.findByTestId('reveal-root');
    fireEvent.click(screen.getByTitle('Award (ENTER)'));

    await waitFor(() => {
      expect(getSelectedPlayerIdFromStorage()).toBe('p2');
    });
  });

  it('steal keeps existing auto-advance behavior', async () => {
    await seedAuthenticatedGameState({ selectedPlayerId: 'p1' });
    render(<App />);

    await screen.findByTestId('reveal-root');
    fireEvent.click(screen.getByTitle('Steal (S)'));
    fireEvent.click(screen.getByText('Bob').closest('button')!);

    await waitFor(() => {
      expect(getSelectedPlayerIdFromStorage()).toBe('p2');
    });
  });
});

