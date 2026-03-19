
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DirectorPanel } from './DirectorPanel';
import { GameState } from '../types';
import * as geminiService from '../services/geminiService';

vi.mock('../services/geminiService', () => ({
  generateCategoryQuestions: vi.fn(),
  generateTriviaGame: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), getCorrelationId: () => 'test' },
}));

vi.mock('../services/soundService', () => ({
  soundService: { playClick: vi.fn() },
}));

describe('DirectorPanel: Settings & Category Regen', () => {
  const mockOnUpdateState = vi.fn();
  const mockEmitGameEvent = vi.fn();
  const mockAddToast = vi.fn();

  const baseGameState: GameState = {
    showTitle: 'Studio Show',
    isGameStarted: true,
    categories: [
      {
        id: 'c1', title: 'Art',
        questions: [{ id: 'q1', text: 'Old Q', answer: 'Old A', points: 100, isRevealed: false, isAnswered: false }]
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
      updatedAt: ''
    },
    lastPlays: [],
    events: []
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Stub crypto
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-123' });
  });

  it('A) CATEGORY REGEN: preserves manual point adjustments', async () => {
    vi.mocked(geminiService.generateCategoryQuestions).mockResolvedValue([
      { id: 'new', text: 'New AI Q', answer: 'New AI A', points: 500, isRevealed: false, isAnswered: false }
    ]);

    render(<DirectorPanel gameState={baseGameState} onUpdateState={mockOnUpdateState} emitGameEvent={mockEmitGameEvent} addToast={mockAddToast} />);
    
    // Trigger rewrite on first category
    const regenBtn = screen.getByTitle(/Regenerate this category/i);
    fireEvent.click(regenBtn);

    await waitFor(() => {
      const updatedCat = mockOnUpdateState.mock.calls[0][0].categories[0];
      expect(updatedCat.questions[0].points).toBe(100); // Should keep '100', not '500' from AI
      expect(updatedCat.questions[0].text).toBe('New AI Q');
    });
  });

  it('B) SETTINGS: emits event on scale change', () => {
    render(<DirectorPanel gameState={baseGameState} onUpdateState={mockOnUpdateState} emitGameEvent={mockEmitGameEvent} addToast={mockAddToast} />);
    
    fireEvent.click(screen.getByText('Settings'));
    
    // Change category title to XS
    const xsBtn = screen.getAllByText('XS')[0];
    fireEvent.click(xsBtn);

    expect(mockEmitGameEvent).toHaveBeenCalledWith('VIEW_SETTINGS_CHANGED', expect.objectContaining({
      context: { after: { categoryTitleScale: 'XS' } }
    }));
  });
});
