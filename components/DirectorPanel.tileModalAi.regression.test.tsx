import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DirectorPanel } from './DirectorPanel';
import { GameState } from '../types';
import * as geminiService from '../services/geminiService';

vi.mock('../services/geminiService', () => ({
  generateSingleQuestion: vi.fn(),
  generateCategoryQuestions: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), getCorrelationId: () => 'test' },
}));

vi.mock('../services/soundService', () => ({
  soundService: { playClick: vi.fn() },
}));

describe('Director Panel: Tile Modal AI Regression', () => {
  const mockOnUpdateState = vi.fn();
  const mockEmitGameEvent = vi.fn();
  const mockAddToast = vi.fn();

  const baseGameState: GameState = {
    showTitle: 'Regression Show',
    isGameStarted: true,
    categories: [
      {
        id: 'cat-1', title: 'Science',
        questions: [{ id: 'q-lock-id', text: 'Old Q', answer: 'Old A', points: 100, isRevealed: false, isAnswered: true }]
      }
    ],
    players: [],
    activeQuestionId: null,
    activeCategoryId: null,
    selectedPlayerId: null,
    history: [],
    timer: { duration: 30, endTime: null, isRunning: false },
    viewSettings: { categoryTitleScale: 'M', playerNameScale: 'M', tileScale: 'M', scoreboardScale: 1.0, tilePaddingScale: 1.0, updatedAt: '' },
    lastPlays: [],
    events: []
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('crypto', { randomUUID: () => 'gen-id' });
  });

  const getEditTileModal = () => {
    const heading = screen.getByRole('heading', { name: /Science \/\/ 100/i });
    return heading.closest('.max-w-lg') as HTMLElement;
  };

  it('1) RENDERING: Tile modal includes the "AI Regen Tile" section', () => {
    render(<DirectorPanel gameState={baseGameState} onUpdateState={mockOnUpdateState} emitGameEvent={mockEmitGameEvent} addToast={mockAddToast} />);
    
    // Open modal
    const tile = screen.getByText('100');
    fireEvent.click(tile.closest('.cursor-pointer')!);

    expect(screen.getByText(/AI Regen Tile/i)).toBeInTheDocument();
    // Get all easy/hard buttons and verify at least one exists in the modal
    const allEasy = screen.getAllByText('easy');
    const allHard = screen.getAllByText('hard');
    expect(allEasy.length).toBeGreaterThan(0);
    expect(allHard.length).toBeGreaterThan(0);
  });

  it('2) FUNCTIONAL: Regen button calls generateSingleQuestion with selected difficulty', async () => {
    vi.mocked(geminiService.generateSingleQuestion).mockResolvedValue({ text: 'New AI Q', answer: 'New AI A' });

    render(<DirectorPanel gameState={baseGameState} onUpdateState={mockOnUpdateState} emitGameEvent={mockEmitGameEvent} addToast={mockAddToast} />);
    
    const tile = screen.getByText('100');
    fireEvent.click(tile.closest('.cursor-pointer')!);

    // Use getAllByText to get all hard buttons, then select the first one (in the modal)
    const hardBtns = screen.getAllByText('hard');
    fireEvent.click(hardBtns[0]);

    // Click the Regen button - use getAllByRole to find the specific one in the modal
    const regenBtns = screen.getAllByRole('button', { name: /regen/i });
    fireEvent.click(regenBtns[regenBtns.length - 1]); // Last regen button is in the modal

    expect(geminiService.generateSingleQuestion).toHaveBeenCalledWith(
      'Regression Show',
      100,
      'Science',
      'hard',
      'gen-id'
    );
  });

  it('3) INTEGRITY: AI regen preserves metadata (id, points, flags)', async () => {
    vi.mocked(geminiService.generateSingleQuestion).mockResolvedValue({ text: 'New Q', answer: 'New A' });

    render(<DirectorPanel gameState={baseGameState} onUpdateState={mockOnUpdateState} emitGameEvent={mockEmitGameEvent} addToast={mockAddToast} />);
    
    fireEvent.click(screen.getByText('100').closest('.cursor-pointer')!);
    const regenBtns = screen.getAllByRole('button', { name: /regen/i });
    fireEvent.click(regenBtns[regenBtns.length - 1]); // Modal regen button

    await waitFor(() => {
      expect(mockOnUpdateState).toHaveBeenCalled();
      const nextState = mockOnUpdateState.mock.calls[0][0] as GameState;
      const q = nextState.categories[0].questions[0];

      expect(q.id).toBe('q-lock-id');
      expect(q.points).toBe(100);
      expect(q.isAnswered).toBe(true);
    });
  });

  it('4) UI SYNC: Textareas refresh their content after AI regeneration', async () => {
    vi.mocked(geminiService.generateSingleQuestion).mockResolvedValue({ text: 'AI TEXT UPDATED', answer: 'AI ANSWER UPDATED' });

    const { rerender } = render(<DirectorPanel gameState={baseGameState} onUpdateState={mockOnUpdateState} emitGameEvent={mockEmitGameEvent} addToast={mockAddToast} />);
    
    fireEvent.click(screen.getByText('100').closest('.cursor-pointer')!);
    const regenBtns = screen.getAllByRole('button', { name: /regen/i });
    fireEvent.click(regenBtns[regenBtns.length - 1]); // Modal regen button

    await waitFor(() => expect(mockOnUpdateState).toHaveBeenCalled());

    const updatedState = mockOnUpdateState.mock.calls[0][0];
    rerender(<DirectorPanel gameState={updatedState} onUpdateState={mockOnUpdateState} emitGameEvent={mockEmitGameEvent} addToast={mockAddToast} />);

    expect(screen.getByDisplayValue('AI TEXT UPDATED')).toBeInTheDocument();
    expect(screen.getByDisplayValue('AI ANSWER UPDATED')).toBeInTheDocument();
  });
});