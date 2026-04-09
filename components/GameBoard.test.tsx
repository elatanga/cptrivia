
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import { GameBoard } from './GameBoard';
import { Category, BoardViewSettings } from '../types';
import { SMSOverlayDoc } from '../modules/specialMoves/firestoreTypes';

// Mock sound service
vi.mock('../services/soundService', () => ({
  soundService: {
    playSelect: vi.fn(),
  },
}));

// Mock logger to avoid side-effects in tests
vi.mock('../services/logger', () => ({
  logger: { info: vi.fn() }
}));

const mockCategories: Category[] = [
  {
    id: 'c1',
    title: 'Science',
    questions: [
      { id: 'q1', text: 'Q1', answer: 'A1', points: 100, isRevealed: false, isAnswered: false, isDoubleOrNothing: true },
      { id: 'q2', text: 'Q2', answer: 'A2', points: 200, isRevealed: false, isAnswered: false, isDoubleOrNothing: false },
      { id: 'q3', text: 'Q3', answer: 'A3', points: 300, isRevealed: false, isAnswered: true, isDoubleOrNothing: false },
      { id: 'q4', text: 'Q4', answer: 'A4', points: 400, isRevealed: false, isAnswered: false, isVoided: true },
    ],
  },
];

const mockViewSettings: BoardViewSettings = {
  // Fix: Corrected property names and types to match the BoardViewSettings interface.
  categoryTitleScale: 'M',
  tileScale: 'M',
  playerNameScale: 'M',
  scoreboardScale: 1.0,
  tilePaddingScale: 1.0,
  questionModalSize: 'Medium',
  questionMaxWidthPercent: 80,
  questionFontScale: 1,
  questionContentPadding: 12,
  multipleChoiceColumns: 'auto',
  updatedAt: new Date().toISOString(),
};

const mockOverlay: SMSOverlayDoc = {
  deploymentsByTileId: {
    q1: { status: 'ARMED', moveType: 'DOUBLE_TROUBLE', updatedAt: Date.now() },
  },
  activeByTargetId: {},
  updatedAt: Date.now(),
  version: 1,
};

describe('GameBoard Component Visibility & Theme', () => {
  test('A) UI TEST: Tiles do not show "2X", "x2", or "double" markers (Regression)', () => {
    render(
      <GameBoard 
        categories={mockCategories} 
          onSelectQuestion={vi.fn()} 
        viewSettings={mockViewSettings} 
      />
    );

    // Points should be visible
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();

    // No double markers should be visible
    const bodyText = document.body.textContent || '';
    expect(bodyText).not.toContain('2X');
    expect(bodyText).not.toContain('x2');
    expect(bodyText.toLowerCase()).not.toContain('double');
  });

  test('B) STYLE TEST: Active tiles retain shadow/border separation against light background', () => {
    render(
      <GameBoard 
        categories={mockCategories} 
          onSelectQuestion={vi.fn()} 
        viewSettings={mockViewSettings} 
      />
    );

    const activeTile = screen.getByText('100').closest('button');
    // shadow-xl is required to lift tile off the light ivory floor
    expect(activeTile).toHaveClass('shadow-xl');
    expect(activeTile).toHaveClass('border-gold-600/30');
    expect(activeTile).toHaveClass('bg-zinc-900');
  });

  test('C) UI TEST: Voided tile remains disabled + visually distinguishable (Dark/Muted)', () => {
    render(
      <GameBoard 
        categories={mockCategories} 
          onSelectQuestion={vi.fn()} 
        viewSettings={mockViewSettings} 
      />
    );

    const voidedText = screen.getByText('VOID');
    const voidedTile = voidedText.closest('button');
    
    expect(voidedTile).toBeDisabled();
    expect(voidedTile).toHaveClass('opacity-50');
    expect(voidedTile).toHaveClass('bg-black/80'); // High contrast against ivory
    expect(voidedTile).toHaveClass('cursor-not-allowed');
  });

  test('D) UI TEST: Answered tile is visually recessed (Low Opacity)', () => {
    render(
      <GameBoard 
        categories={mockCategories} 
          onSelectQuestion={vi.fn()} 
        viewSettings={mockViewSettings} 
      />
    );

    // Answered tiles show "---" by current implementation
    const answeredText = screen.getByText('---');
    const answeredTile = answeredText.closest('button');
    
    expect(answeredTile).toBeDisabled();
    expect(answeredTile).toHaveClass('opacity-20');
    expect(answeredTile).toHaveClass('bg-zinc-800/10');
  });

  test('E) LOGGING TEST: Theme update is logged on mount', async () => {
    const { logger } = await import('../services/logger');
    render(
      <GameBoard 
        categories={mockCategories} 
        onSelectQuestion={vi.fn()} 
        viewSettings={mockViewSettings} 
      />
    );
    expect(logger.info).toHaveBeenCalledWith(
        "trivia_board_theme_updated", 
        expect.objectContaining({ backgroundTheme: "luxury_light" })
    );
  });

  test('F) GAME TIMER LOCATION: Board no longer renders session timer UI', () => {
    render(
      <GameBoard
        categories={mockCategories}
        onSelectQuestion={vi.fn()}
        viewSettings={mockViewSettings}
      />
    );

    expect(screen.queryByText(/Session Timer/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Game Time/i)).not.toBeInTheDocument();
  });

  test('G) SPECIAL MOVE TAG: Re-renders tile tag when only resolvedSpecialMoveTileIds changes', () => {
    const { rerender } = render(
      <GameBoard
        categories={mockCategories}
        onSelectQuestion={vi.fn()}
        viewSettings={mockViewSettings}
        overlay={mockOverlay}
        resolvedSpecialMoveTileIds={new Set<string>()}
      />
    );

    expect(screen.getByTestId('special-move-tile-tag-q1')).toHaveAttribute('data-state', 'armed');

    rerender(
      <GameBoard
        categories={mockCategories}
        onSelectQuestion={vi.fn()}
        viewSettings={mockViewSettings}
        overlay={mockOverlay}
        resolvedSpecialMoveTileIds={new Set<string>(['q1'])}
      />
    );

    expect(screen.getByTestId('special-move-tile-tag-q1')).toHaveAttribute('data-state', 'resolved');
  });
});
