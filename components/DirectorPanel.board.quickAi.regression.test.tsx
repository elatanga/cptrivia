import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DirectorPanel } from './DirectorPanel';
import { GameState } from '../types';
import * as geminiService from '../services/geminiService';

/**
 * MOCKS
 */
vi.mock('../services/geminiService', () => ({
  generateSingleQuestion: vi.fn(),
  generateCategoryQuestions: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    getCorrelationId: () => 'test-correlation-id',
  },
}));

vi.mock('../services/soundService', () => ({
  soundService: {
    playClick: vi.fn(),
  },
}));

describe('DirectorPanel: Board Quick AI Regression', () => {
  const mockOnUpdateState = vi.fn();
  const mockEmitGameEvent = vi.fn();
  const mockAddToast = vi.fn();

  const baseGameState: GameState = {
    showTitle: 'Regression Show',
    isGameStarted: true,
    categories: [
      {
        id: 'cat-1',
        title: 'Science',
        questions: [
          { 
            id: 'q-stable-123', 
            text: 'Old Question', 
            answer: 'Old Answer', 
            points: 500, 
            isRevealed: true, 
            isAnswered: false,
            isDoubleOrNothing: true
          }
        ]
      }
    ],
    players: [],
    activeQuestionId: null,
    activeCategoryId: null,
    selectedPlayerId: null,
    history: [],
    timer: { duration: 30, endTime: null, isRunning: false },
    viewSettings: {
      categoryTitleScale: 'M',
      playerNameScale: 'M',
      tileScale: 'M',
      scoreboardScale: 1.0,
      tilePaddingScale: 1.0,
      updatedAt: '',
    },
    lastPlays: [],
    events: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Stub crypto for genId
    vi.stubGlobal('crypto', { randomUUID: () => 'gen-123' });
  });

  it('1) RENDERING: Displays "Quick AI Generate" control on each board tile', () => {
    render(
      <DirectorPanel 
        gameState={baseGameState} 
        onUpdateState={mockOnUpdateState} 
        emitGameEvent={mockEmitGameEvent} 
        addToast={mockAddToast} 
      />
    );

    // Default tab is BOARD
    const quickAiBtn = screen.getByTitle('Quick AI Generate');
    expect(quickAiBtn).toBeInTheDocument();
  });

  it('2) CONTRACT: Calls generateSingleQuestion with specific tile context', async () => {
    vi.mocked(geminiService.generateSingleQuestion).mockResolvedValue({
      text: 'AI Result Q',
      answer: 'AI Result A'
    });

    render(
      <DirectorPanel 
        gameState={baseGameState} 
        onUpdateState={mockOnUpdateState} 
        emitGameEvent={mockEmitGameEvent} 
        addToast={mockAddToast} 
      />
    );

    const quickAiBtn = screen.getByTitle('Quick AI Generate');
    fireEvent.click(quickAiBtn);

    expect(geminiService.generateSingleQuestion).toHaveBeenCalledWith(
      'Regression Show',   // Topic
      500,                 // Points
      'Science',           // Category
      'mixed',             // Difficulty
      'gen-123'            // genId
    );
  });

  it('3) SUCCESS: Updates content while strictly preserving ID, Points, and Flags', async () => {
    vi.mocked(geminiService.generateSingleQuestion).mockResolvedValue({
      text: 'NEW AI TEXT',
      answer: 'NEW AI ANSWER'
    });

    render(
      <DirectorPanel 
        gameState={baseGameState} 
        onUpdateState={mockOnUpdateState} 
        emitGameEvent={mockEmitGameEvent} 
        addToast={mockAddToast} 
      />
    );

    fireEvent.click(screen.getByTitle('Quick AI Generate'));

    await waitFor(() => {
      expect(mockOnUpdateState).toHaveBeenCalledTimes(1);
      const nextState = mockOnUpdateState.mock.calls[0][0] as GameState;
      const updatedTile = nextState.categories[0].questions[0];

      // Content changed
      expect(updatedTile.text).toBe('NEW AI TEXT');
      expect(updatedTile.answer).toBe('NEW AI ANSWER');

      // Metadata preserved (The "Lock")
      expect(updatedTile.id).toBe('q-stable-123');
      expect(updatedTile.points).toBe(500);
      expect(updatedTile.isRevealed).toBe(true);
      expect(updatedTile.isAnswered).toBe(false);
      expect(updatedTile.isDoubleOrNothing).toBe(true);
    });
  });

  it('4) FAILURE: Shows error toast and aborts state mutation on API crash', async () => {
    vi.mocked(geminiService.generateSingleQuestion).mockRejectedValue(new Error('AI_OFFLINE'));

    render(
      <DirectorPanel 
        gameState={baseGameState} 
        onUpdateState={mockOnUpdateState} 
        emitGameEvent={mockEmitGameEvent} 
        addToast={mockAddToast} 
      />
    );

    fireEvent.click(screen.getByTitle('Quick AI Generate'));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', expect.stringContaining('AI_OFFLINE'));
      expect(mockOnUpdateState).not.toHaveBeenCalled();
    });
  });

  it('5) LOCKING: Button reflects loading state and prevents concurrent requests', async () => {
    // Simulate a slow generation
    let resolveAi: any;
    const aiPromise = new Promise((resolve) => { resolveAi = resolve; });
    vi.mocked(geminiService.generateSingleQuestion).mockReturnValue(aiPromise as any);

    render(
      <DirectorPanel 
        gameState={baseGameState} 
        onUpdateState={mockOnUpdateState} 
        emitGameEvent={mockEmitGameEvent} 
        addToast={mockAddToast} 
      />
    );

    const quickAiBtn = screen.getByTitle('Quick AI Generate');
    fireEvent.click(quickAiBtn);

    // Button should be disabled
    expect(quickAiBtn).toBeDisabled();
    
    // UI should show spinner (Loader2)
    expect(quickAiBtn.querySelector('.animate-spin')).toBeInTheDocument();

    // Resolve and verify unlock
    await waitFor(() => {
        resolveAi({ text: 'Done', answer: 'Done' });
    });
    
    await waitFor(() => {
        expect(quickAiBtn).not.toBeDisabled();
    });
  });

  it('6) SNAPSHOT: Action region visual lock', () => {
    const { asFragment } = render(
      <DirectorPanel 
        gameState={baseGameState} 
        onUpdateState={mockOnUpdateState} 
        emitGameEvent={mockEmitGameEvent} 
        addToast={mockAddToast} 
      />
    );

    // Focus only on the tile that contains the AI control
    const tile = screen.getByText('500').closest('.relative.group');
    expect(tile).toMatchSnapshot();
  });

  it('7) CATEGORY MODE: active_only updates only playable tiles', async () => {
    const modeState: GameState = {
      ...baseGameState,
      categories: [
        {
          id: 'cat-1',
          title: 'Science',
          questions: [
            { id: 'q-active', text: 'Old Active', answer: 'Old A1', points: 100, isRevealed: false, isAnswered: false },
            { id: 'q-void', text: 'Old Void', answer: 'Old A2', points: 200, isRevealed: false, isAnswered: false, isVoided: true },
          ],
        },
      ],
    };

    vi.mocked(geminiService.generateCategoryQuestions).mockResolvedValue([
      { id: 'g1', text: 'New Active', answer: 'New A1', points: 100, isRevealed: false, isAnswered: false },
      { id: 'g2', text: 'New Void', answer: 'New A2', points: 200, isRevealed: false, isAnswered: false },
    ] as any);

    render(
      <DirectorPanel
        gameState={modeState}
        onUpdateState={mockOnUpdateState}
        emitGameEvent={mockEmitGameEvent}
        addToast={mockAddToast}
      />
    );

    fireEvent.click(screen.getByTitle('Regenerate this category only'));
    fireEvent.click(screen.getByText('Regenerate active tiles only'));
    fireEvent.click(screen.getByText('Run Regeneration'));

    await waitFor(() => {
      const nextState = mockOnUpdateState.mock.calls[0][0] as GameState;
      const [activeTile, voidTile] = nextState.categories[0].questions;

      expect(activeTile.text).toBe('New Active');
      expect(voidTile.text).toBe('Old Void');
      expect(voidTile.isVoided).toBe(true);
    });
  });

  it('8) CATEGORY MODE: reset_all_active regenerates and reactivates full category', async () => {
    const modeState: GameState = {
      ...baseGameState,
      categories: [
        {
          id: 'cat-1',
          title: 'Science',
          questions: [
            { id: 'q-a', text: 'Old 1', answer: 'Old A1', points: 100, isRevealed: true, isAnswered: true },
            { id: 'q-b', text: 'Old 2', answer: 'Old A2', points: 200, isRevealed: false, isAnswered: false, isVoided: true },
          ],
        },
      ],
    };

    vi.mocked(geminiService.generateCategoryQuestions).mockResolvedValue([
      { id: 'g1', text: 'Reset 1', answer: 'Reset A1', points: 100, isRevealed: false, isAnswered: false },
      { id: 'g2', text: 'Reset 2', answer: 'Reset A2', points: 200, isRevealed: false, isAnswered: false },
    ] as any);

    render(
      <DirectorPanel
        gameState={modeState}
        onUpdateState={mockOnUpdateState}
        emitGameEvent={mockEmitGameEvent}
        addToast={mockAddToast}
      />
    );

    fireEvent.click(screen.getByTitle('Regenerate this category only'));
    fireEvent.click(screen.getByText('Reset category and regenerate all tiles as active'));
    fireEvent.click(screen.getByText('Run Regeneration'));

    await waitFor(() => {
      const nextState = mockOnUpdateState.mock.calls[0][0] as GameState;
      const [firstTile, secondTile] = nextState.categories[0].questions;

      expect(firstTile.text).toBe('Reset 1');
      expect(secondTile.text).toBe('Reset 2');
      expect(firstTile.isAnswered).toBe(false);
      expect(secondTile.isVoided).toBe(false);
      expect(firstTile.isRevealed).toBe(false);
    });
  });
});
