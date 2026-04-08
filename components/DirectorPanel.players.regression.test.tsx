
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DirectorPanel } from './DirectorPanel';
import { GameState, Player } from '../types';
import { logger } from '../services/logger';

/**
 * MOCKS
 */
vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    getCorrelationId: () => 'test-id',
  },
}));

vi.mock('../services/soundService', () => ({
  soundService: {
    playClick: vi.fn(),
  },
}));

// Mocking geminiService as DirectorPanel imports it for other tabs
vi.mock('../services/geminiService', () => ({
  generateSingleQuestion: vi.fn(),
  generateCategoryQuestions: vi.fn(),
}));

describe('DirectorPanel: Players Tab Regression Lock', () => {
  const mockOnUpdateState = vi.fn();
  const mockEmitGameEvent = vi.fn();
  const mockAddToast = vi.fn();

  const createMockPlayers = (): Player[] => [
    { id: 'p1', name: 'ALICE', score: 1000, color: '#fff' },
    { id: 'p2', name: 'BOB', score: 500, color: '#fff' },
  ];

  const baseState: GameState = {
    showTitle: 'Regression Show',
    isGameStarted: true,
    categories: [],
    players: createMockPlayers(),
    activeQuestionId: null,
    activeCategoryId: null,
    selectedPlayerId: 'p1',
    history: [],
    timer: { duration: 30, endTime: null, isRunning: false },
    viewSettings: {
      categoryTitleScale: 'M',
      playerNameScale: 'M',
      tileScale: 'M',
      scoreboardScale: 1.0,
      tilePaddingScale: 1.0,
      questionModalSize: 'Medium',
      questionMaxWidthPercent: 80,
      questionFontScale: 1,
      questionContentPadding: 12,
      multipleChoiceColumns: 'auto',
      updatedAt: '',
    },
    lastPlays: [],
    events: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const switchToPlayersTab = () => {
    const playersBtn = screen.getByRole('button', { name: /players/i });
    fireEvent.click(playersBtn);
  };

  it('1) RENDERING: Players tab displays contestant names and scores', () => {
    render(
      <DirectorPanel 
        gameState={baseState} 
        onUpdateState={mockOnUpdateState} 
        emitGameEvent={mockEmitGameEvent} 
        addToast={mockAddToast} 
      />
    );

    switchToPlayersTab();

    // Verify UI is not blank
    expect(screen.getByText(/Contestant Management/i)).toBeInTheDocument();
    
    // Verify specific data presence
    expect(screen.getByDisplayValue('ALICE')).toBeInTheDocument();
    expect(screen.getByText('1000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('BOB')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
  });

  it('2) EDIT NAME: Normalizes input and preserves other players', () => {
    render(
      <DirectorPanel 
        gameState={baseState} 
        onUpdateState={mockOnUpdateState} 
        emitGameEvent={mockEmitGameEvent} 
        addToast={mockAddToast} 
      />
    );

    switchToPlayersTab();

    const aliceInput = screen.getByDisplayValue('ALICE');
    fireEvent.change(aliceInput, { target: { value: '  alicia  ' } });

    expect(mockOnUpdateState).toHaveBeenCalledTimes(1);
    const updatedState = mockOnUpdateState.mock.calls[0][0] as GameState;
    
    // Normalized check
    const alice = updatedState.players.find(p => p.id === 'p1');
    expect(alice?.name).toBe('ALICIA');

    // Preservation check
    const bob = updatedState.players.find(p => p.id === 'p2');
    expect(bob?.name).toBe('BOB');
    expect(bob?.score).toBe(500);
  });

  it('3) EDIT SCORE: Updates numeric value via increment buttons', () => {
    render(
      <DirectorPanel 
        gameState={baseState} 
        onUpdateState={mockOnUpdateState} 
        emitGameEvent={mockEmitGameEvent} 
        addToast={mockAddToast} 
      />
    );

    switchToPlayersTab();

    // Find "Add 100" button for the first player (Alice)
    const addBtns = screen.getAllByTitle(/Add 100/i);
    fireEvent.click(addBtns[0]);

    expect(mockOnUpdateState).toHaveBeenCalledTimes(1);
    const updatedState = mockOnUpdateState.mock.calls[0][0] as GameState;
    
    const alice = updatedState.players.find(p => p.id === 'p1');
    expect(alice?.score).toBe(1100); // 1000 + 100
    expect(alice?.name).toBe('ALICE'); // Name preserved
  });

  it('4) DEFENSIVE: Handles missing players gracefully and logs warning', () => {
    const emptyState = { ...baseState, players: [] };
    
    render(
      <DirectorPanel 
        gameState={emptyState} 
        onUpdateState={mockOnUpdateState} 
        emitGameEvent={mockEmitGameEvent} 
        addToast={mockAddToast} 
      />
    );

    switchToPlayersTab();

    // Check for fallback UI
    expect(screen.getByText(/No contestants registered/i)).toBeInTheDocument();
    
    // Check audit log
    expect(logger.warn).toHaveBeenCalledWith('director_players_missing', expect.any(Object));
  });

  it('5) LOCK: Snapshot verification of the Players Tab structure', () => {
    render(
      <DirectorPanel 
        gameState={baseState} 
        onUpdateState={mockOnUpdateState} 
        emitGameEvent={mockEmitGameEvent} 
        addToast={mockAddToast} 
      />
    );

    switchToPlayersTab();

    // Capture only the main content area (where the tab content lives)
    // In our implementation, this is the scrollable container after the tab bar.
    const content = screen.getByText(/Contestant Management/i).closest('.animate-in');
    expect(content).toMatchSnapshot();
  });

  it('6) TEAMS MODE: Players tab renders team cards, members, and active turn details', () => {
    const teamState: GameState = {
      ...baseState,
      playMode: 'TEAMS',
      teamPlayStyle: 'TEAM_MEMBERS_TAKE_TURNS',
      players: [
        { id: 't1', name: 'TEAM ALPHA', score: 700, color: '#fff' },
        { id: 't2', name: 'TEAM BETA', score: 400, color: '#fff' },
      ],
      teams: [
        {
          id: 't1',
          name: 'TEAM ALPHA',
          score: 700,
          activeMemberId: 'm2',
          members: [
            { id: 'm1', name: 'ALICE', score: 300, orderIndex: 0 },
            { id: 'm2', name: 'AARON', score: 400, orderIndex: 1 },
          ],
        },
        {
          id: 't2',
          name: 'TEAM BETA',
          score: 400,
          activeMemberId: 'm3',
          members: [
            { id: 'm3', name: 'BOB', score: 250, orderIndex: 0 },
            { id: 'm4', name: 'BILL', score: 150, orderIndex: 1 },
          ],
        },
      ],
      selectedPlayerId: 't1',
    };

    render(
      <DirectorPanel
        gameState={teamState}
        onUpdateState={mockOnUpdateState}
        emitGameEvent={mockEmitGameEvent}
        addToast={mockAddToast}
      />
    );

    switchToPlayersTab();

    expect(screen.getByText(/Teams Mode/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Take Turns/i).length).toBeGreaterThan(0);
    expect(screen.getByText('TEAM ALPHA')).toBeInTheDocument();
    expect(screen.getByText('TEAM BETA')).toBeInTheDocument();
    expect(screen.getByText('AARON')).toBeInTheDocument();
    expect(screen.getAllByText(/Active/i).length).toBeGreaterThan(0);
  });

  it('7) LIVE SCORE RESET: confirms and resets individual scores only', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <DirectorPanel
        gameState={baseState}
        onUpdateState={mockOnUpdateState}
        emitGameEvent={mockEmitGameEvent}
        addToast={mockAddToast}
      />
    );

    switchToPlayersTab();
    fireEvent.click(screen.getByRole('button', { name: /Reset Live Scores/i }));

    expect(window.confirm).toHaveBeenCalledWith('Reset all live scores to zero?');
    const nextState = mockOnUpdateState.mock.calls[0][0] as GameState;
    expect(nextState.players.map((player) => player.score)).toEqual([0, 0]);
  });

  it('8) LIVE SCORE RESET: teams mode reset clears team totals and member scores', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const teamState: GameState = {
      ...baseState,
      playMode: 'TEAMS',
      teamPlayStyle: 'TEAM_MEMBERS_TAKE_TURNS',
      players: [{ id: 't1', name: 'TEAM ALPHA', score: 500, color: '#fff' }],
      teams: [{
        id: 't1',
        name: 'TEAM ALPHA',
        score: 500,
        activeMemberId: 'm1',
        members: [
          { id: 'm1', name: 'ALICE', score: 200, orderIndex: 0 },
          { id: 'm2', name: 'AARON', score: 300, orderIndex: 1 },
        ],
      }],
      selectedPlayerId: 't1',
    };

    render(
      <DirectorPanel
        gameState={teamState}
        onUpdateState={mockOnUpdateState}
        emitGameEvent={mockEmitGameEvent}
        addToast={mockAddToast}
      />
    );

    switchToPlayersTab();
    fireEvent.click(screen.getByRole('button', { name: /Reset Live Scores/i }));

    const nextState = mockOnUpdateState.mock.calls[0][0] as GameState;
    expect(nextState.players[0].score).toBe(0);
    expect(nextState.teams?.[0].score).toBe(0);
    expect(nextState.teams?.[0].members.map((member) => member.score)).toEqual([0, 0]);
    expect(nextState.teams?.[0].activeMemberId).toBe('m1');
  });

  it('9) LIVE SCORE RESET: cancel confirmation keeps scores unchanged', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <DirectorPanel
        gameState={baseState}
        onUpdateState={mockOnUpdateState}
        emitGameEvent={mockEmitGameEvent}
        addToast={mockAddToast}
      />
    );

    switchToPlayersTab();
    fireEvent.click(screen.getByRole('button', { name: /Reset Live Scores/i }));

    expect(mockOnUpdateState).not.toHaveBeenCalled();
  });
});
