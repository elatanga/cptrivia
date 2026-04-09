
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Scoreboard } from './Scoreboard';
import { Player, BoardViewSettings } from '../types';

// Mock services
vi.mock('../services/soundService', () => ({
  soundService: {
    playClick: vi.fn(),
  },
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const generatePlayers = (count: number): Player[] => 
  Array.from({ length: count }).map((_, i) => ({
    id: `p${i}`, name: `Player ${i + 1}`, score: 100 * i, color: '#ffffff'
  }));

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

describe('Scoreboard: Desktop Visibility & Layout (Card 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1440 });
  });

  it('A) 8-PLAYER GRID: Renders all 8 players in a 2-column grid layout', () => {
    render(
      <Scoreboard 
        players={generatePlayers(8)}
        selectedPlayerId="p0"
        onAddPlayer={vi.fn()}
        onUpdateScore={vi.fn()}
        onSelectPlayer={vi.fn()}
        gameActive={true}
        viewSettings={mockViewSettings}
      />
    );

    const root = screen.getByTestId('scoreboard-root');
    expect(root).toHaveAttribute('data-layout', 'grid-2col');
    
    // Check all 8 player names are present
    for (let i = 1; i <= 8; i++) {
      expect(screen.getByText(`PLAYER ${i}`)).toBeInTheDocument();
    }
  });

  it('B) NO SCROLL: Enforces overflow-hidden and removes scrollbars via style audit', () => {
    const { container } = render(
      <Scoreboard 
        players={generatePlayers(8)}
        selectedPlayerId="p0"
        onAddPlayer={vi.fn()}
        onUpdateScore={vi.fn()}
        onSelectPlayer={vi.fn()}
        gameActive={true}
        viewSettings={mockViewSettings}
      />
    );

    const root = container.firstChild as HTMLElement;
    expect(root).toHaveClass('overflow-hidden');
    
    // Verify body row container is clipped
    const list = container.querySelector('.flex-1.overflow-hidden');
    expect(list).toBeInTheDocument();
  });

  it('C) LAYOUT SWITCHING: 1-column for 4 players, 2-column for 5 players', () => {
    const { rerender } = render(
      <Scoreboard 
        players={generatePlayers(4)}
        selectedPlayerId="p0"
        onAddPlayer={vi.fn()}
        onUpdateScore={vi.fn()}
        onSelectPlayer={vi.fn()}
        gameActive={true}
        viewSettings={mockViewSettings}
      />
    );

    expect(screen.getByTestId('scoreboard-root')).toHaveAttribute('data-layout', 'list-1col');

    rerender(
      <Scoreboard 
        players={generatePlayers(5)}
        selectedPlayerId="p0"
        onAddPlayer={vi.fn()}
        onUpdateScore={vi.fn()}
        onSelectPlayer={vi.fn()}
        gameActive={true}
        viewSettings={mockViewSettings}
      />
    );

    expect(screen.getByTestId('scoreboard-root')).toHaveAttribute('data-layout', 'grid-2col');
  });

  it('D) AUDIT LOGGING: Reports layout mode and viewport upon initialization', async () => {
    const { logger } = await import('../services/logger');
    render(
      <Scoreboard 
        players={generatePlayers(8)}
        selectedPlayerId="p0"
        onAddPlayer={vi.fn()}
        onUpdateScore={vi.fn()}
        onSelectPlayer={vi.fn()}
        gameActive={true}
        viewSettings={mockViewSettings}
      />
    );

    expect(logger.info).toHaveBeenCalledWith(
      "scoreboard_layout",
      expect.objectContaining({
        playerCount: 8,
        layoutMode: "grid-2col",
        viewport: expect.any(Object)
      })
    );
  });

  it('E) SESSION TIMER: Renders at top before contestants list', () => {
    render(
      <Scoreboard
        players={generatePlayers(4)}
        sessionTimerActive={true}
        sessionTimeRemaining={95}
        selectedPlayerId="p0"
        onAddPlayer={vi.fn()}
        onUpdateScore={vi.fn()}
        onSelectPlayer={vi.fn()}
        gameActive={true}
        viewSettings={mockViewSettings}
      />
    );

    const timer = screen.getByTestId('scoreboard-session-timer');
    const contestants = screen.getByText(/CONTESTANTS/i);
    expect(timer).toBeInTheDocument();
    expect(timer).toHaveTextContent('1:35');
    const timerTop = timer.getBoundingClientRect().top;
    const contestantsTop = contestants.getBoundingClientRect().top;
    expect(timerTop).toBeLessThanOrEqual(contestantsTop);
  });

  it('F) SESSION TIMER: Reflects live countdown updates from shared state props', () => {
    const { rerender } = render(
      <Scoreboard
        players={generatePlayers(4)}
        sessionTimerActive={true}
        sessionTimeRemaining={95}
        selectedPlayerId="p0"
        onAddPlayer={vi.fn()}
        onUpdateScore={vi.fn()}
        onSelectPlayer={vi.fn()}
        gameActive={true}
        viewSettings={mockViewSettings}
      />
    );

    expect(screen.getByTestId('scoreboard-session-timer')).toHaveTextContent('1:35');

    rerender(
      <Scoreboard
        players={generatePlayers(4)}
        sessionTimerActive={true}
        sessionTimeRemaining={90}
        selectedPlayerId="p0"
        onAddPlayer={vi.fn()}
        onUpdateScore={vi.fn()}
        onSelectPlayer={vi.fn()}
        gameActive={true}
        viewSettings={mockViewSettings}
      />
    );

    expect(screen.getByTestId('scoreboard-session-timer')).toHaveTextContent('1:30');
  });
});
