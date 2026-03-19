
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DirectorPanel } from './DirectorPanel';
import { GameState } from '../types';
import { AnalyticsEventType } from '../types';
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
  const mockStartQuestionCountdown = vi.fn();
  const mockStopQuestionCountdown = vi.fn();
  const mockStartSessionTimer = vi.fn();
  const mockPauseSessionTimer = vi.fn();
  const mockResetSessionTimer = vi.fn();

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
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:logs'),
      revokeObjectURL: vi.fn()
    });
  });

  const renderPanel = (state: GameState = baseGameState) =>
    render(
      <DirectorPanel
        gameState={state}
        onUpdateState={mockOnUpdateState}
        emitGameEvent={mockEmitGameEvent}
        addToast={mockAddToast}
        questionTimer={{
          durationSeconds: 10,
          remainingSeconds: 0,
          isRunning: false,
          isStopped: true,
          startedAt: null,
          endsAt: null,
          activeQuestionId: null,
        }}
        questionTimerEnabled={true}
        questionTimerDurationSeconds={10}
        onQuestionTimerDurationChange={mockStartQuestionCountdown}
        onQuestionTimerStop={mockStopQuestionCountdown}
        sessionTimer={{
          durationSeconds: 0,
          remainingSeconds: 0,
          isRunning: false,
          isStopped: true,
          startedAt: null,
          endsAt: null,
          selectedPreset: null,
        }}
        onSessionTimerStart={mockStartSessionTimer}
        onSessionTimerPause={mockPauseSessionTimer}
        onSessionTimerReset={mockResetSessionTimer}
      />
    );

  it('A) CATEGORY REGEN: preserves manual point adjustments', async () => {
    vi.mocked(geminiService.generateCategoryQuestions).mockResolvedValue([
      { id: 'new', text: 'New AI Q', answer: 'New AI A', points: 500, isRevealed: false, isAnswered: false }
    ]);

    renderPanel();
    
    // Trigger rewrite on first category
    const regenBtn = screen.getByTitle(/Regenerate this category/i);
    fireEvent.click(regenBtn);
    fireEvent.click(screen.getByText('Regenerate active tiles only'));
    fireEvent.click(screen.getByText('Run Regeneration'));

    await waitFor(() => {
      const updatedCat = mockOnUpdateState.mock.calls[0][0].categories[0];
      expect(updatedCat.questions[0].points).toBe(100); // Should keep '100', not '500' from AI
      expect(updatedCat.questions[0].text).toBe('New AI Q');
    });
  });

  it('B) SETTINGS: emits event on scale change', () => {
    renderPanel();
    
    fireEvent.click(screen.getByText('Settings'));
    
    // Change category title to XS
    const xsBtn = screen.getAllByText('XS')[0];
    fireEvent.click(xsBtn);

    expect(mockEmitGameEvent).toHaveBeenCalledWith('VIEW_SETTINGS_CHANGED', expect.objectContaining({
      context: expect.objectContaining({
        after: expect.objectContaining({ categoryTitleScale: 'XS' })
      })
    }));
  });

  it('C) LOGS & AUDIT: renders full history sentences, limits audit to 12 key items, and downloads logs', () => {
    const eventTs = Date.now();
    const extendedState: GameState = {
      ...baseGameState,
      events: [
        {
          id: 'evt-ai-1',
          ts: eventTs - 1,
          iso: new Date(eventTs - 1).toISOString(),
          type: 'AI_TILE_REPLACE_APPLIED' as AnalyticsEventType,
          actor: { role: 'director' },
          context: { categoryName: 'Art', points: 100, note: 'AI tile regeneration applied' }
        },
        ...Array.from({ length: 13 }, (_, i) => ({
        id: `evt-${i + 1}`,
        ts: eventTs + i,
        iso: new Date(eventTs + i).toISOString(),
        type: 'POINTS_AWARDED' as AnalyticsEventType,
        actor: { role: 'director' as const },
        context: { playerName: `Player ${i + 1}`, points: 100, delta: 100, categoryName: 'Art' }
        }))
      ]
    };

    const clickSpy = vi.fn();
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as any;
      if (tagName.toLowerCase() === 'a') {
        element.click = clickSpy;
      }
      return element;
    }) as any);

    renderPanel(extendedState);

    fireEvent.click(screen.getByRole('button', { name: /logs & audit/i }));

    expect(screen.getAllByText(/Player 13 was awarded 100 points in Art\./i).length).toBeGreaterThan(0);

    const auditList = screen.getByTestId('audit-log-list');
    expect(auditList.children.length).toBe(12);

    // Search filter narrows results
    fireEvent.change(screen.getByLabelText(/log search/i), { target: { value: 'player 13' } });
    expect(screen.getByTestId('log-filter-count')).toHaveTextContent('1 matching history logs');

    // Channel filter isolates AI entries
    fireEvent.change(screen.getByLabelText(/channel filter/i), { target: { value: 'AI' } });
    expect(screen.getByTestId('log-filter-count')).toHaveTextContent('0 matching history logs');
    fireEvent.change(screen.getByLabelText(/log search/i), { target: { value: 'ai tile' } });
    expect(screen.getByTestId('log-filter-count')).toHaveTextContent('1 matching history logs');

    // Key-only hides non-key AI event
    fireEvent.click(screen.getByLabelText(/key activities only/i));
    expect(screen.getByTestId('log-filter-count')).toHaveTextContent('0 matching history logs');

    // Clear filter restores full set
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByTestId('log-filter-count')).toHaveTextContent('14 matching history logs');

    // Sort control works without throwing
    fireEvent.change(screen.getByLabelText(/sort order filter/i), { target: { value: 'OLDEST' } });
    expect(screen.getByTestId('log-filter-count')).toHaveTextContent('14 matching history logs');

    fireEvent.click(screen.getByRole('button', { name: /download filtered logs/i }));
    expect((URL.createObjectURL as any)).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    createElementSpy.mockRestore();
  });

  it('D) COUNTER STUDIO: triggers question countdown and session timer controls', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /counter studio/i }));

    fireEvent.click(screen.getByRole('button', { name: '10s' }));
    expect(mockStartQuestionCountdown).toHaveBeenCalledWith(10);

    fireEvent.click(screen.getByRole('button', { name: '30m' }));
    expect(mockStartSessionTimer).toHaveBeenCalledWith('30m');
  });
});
