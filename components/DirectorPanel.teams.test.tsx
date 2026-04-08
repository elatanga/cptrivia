import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DirectorPanel } from './DirectorPanel';
import type { GameState } from '../types';

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    getCorrelationId: vi.fn(() => 'test-correlation-id'),
  },
}));

vi.mock('../services/soundService', () => ({
  soundService: {
    playClick: vi.fn(),
    playSelect: vi.fn(),
  },
}));

vi.mock('../modules/specialMoves/client/specialMovesClient', () => ({
  specialMovesClient: {
    getBackendMode: () => 'MEMORY_FALLBACK',
    subscribeBackendMode: () => () => undefined,
    list: vi.fn(async () => ({ deploymentsByTileId: {}, updatedAt: Date.now(), version: 'test' })),
    subscribe: vi.fn(() => () => undefined),
    arm: vi.fn(async () => ({ ok: true })),
    clearArmory: vi.fn(async () => ({ ok: true })),
  },
}));

const baseGameState: GameState = {
  showTitle: 'Teams Test',
  isGameStarted: false,
  categories: [],
  players: [],
  playMode: 'INDIVIDUALS',
  teamPlayStyle: 'TEAM_PLAYS_AS_ONE',
  teams: [],
  activeQuestionId: null,
  activeCategoryId: null,
  selectedPlayerId: null,
  history: [],
  timer: { duration: 30, endTime: null, isRunning: false },
  viewSettings: {
    categoryTitleScale: 'M',
    playerNameScale: 'M',
    tileScale: 'M',
    scoreboardScale: 1,
    tilePaddingScale: 1,
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

describe('DirectorPanel Teams Mode Setup', () => {
  it('renders Teams tab and allows enabling Teams mode pre-game', () => {
    const onUpdateState = vi.fn();

    render(
      <DirectorPanel
        gameState={baseGameState}
        onUpdateState={onUpdateState}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    expect(screen.getByText(/Teams mode enabled/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Off/i }));
    expect(onUpdateState).toHaveBeenCalled();
  });

  it('shows team play style controls when Teams mode is enabled', () => {
    render(
      <DirectorPanel
        gameState={{ ...baseGameState, playMode: 'TEAMS', teams: [{ id: 't1', name: 'Team A', score: 0, members: [{ id: 'm1', name: 'A1', score: 0, orderIndex: 0 }], activeMemberId: 'm1' }] }}
        onUpdateState={() => undefined}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    expect(screen.getByRole('button', { name: /Team plays as one/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Team members take turns/i })).toBeInTheDocument();
    expect(screen.getByText(/Team A/i)).toBeInTheDocument();
  });

  it('blocks switching to TEAM_MEMBERS_TAKE_TURNS when team sizes mismatch', () => {
    const onUpdateState = vi.fn();
    const addToast = vi.fn();
    render(
      <DirectorPanel
        gameState={{
          ...baseGameState,
          playMode: 'TEAMS',
          teamPlayStyle: 'TEAM_PLAYS_AS_ONE',
          teams: [
            {
              id: 't1',
              name: 'Team A',
              score: 0,
              members: [{ id: 'a1', name: 'A1', score: 0, orderIndex: 0 }],
              activeMemberId: 'a1'
            },
            {
              id: 't2',
              name: 'Team B',
              score: 0,
              members: [
                { id: 'b1', name: 'B1', score: 0, orderIndex: 0 },
                { id: 'b2', name: 'B2', score: 0, orderIndex: 1 }
              ],
              activeMemberId: 'b1'
            }
          ]
        }}
        onUpdateState={onUpdateState}
        emitGameEvent={() => undefined}
        addToast={addToast}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    fireEvent.click(screen.getByRole('button', { name: /Team members take turns/i }));

    expect(addToast).toHaveBeenCalled();
    expect(onUpdateState).not.toHaveBeenCalled();
    expect(addToast.mock.calls.some((call) => String(call[1] || '').includes('same number of players'))).toBe(true);
  });

  it('allows TEAM_PLAYS_AS_ONE helper messaging with mismatched team sizes', () => {
    render(
      <DirectorPanel
        gameState={{
          ...baseGameState,
          playMode: 'TEAMS',
          teamPlayStyle: 'TEAM_PLAYS_AS_ONE',
          teams: [
            {
              id: 't1',
              name: 'Team A',
              score: 0,
              members: [{ id: 'a1', name: 'A1', score: 0, orderIndex: 0 }],
              activeMemberId: 'a1'
            },
            {
              id: 't2',
              name: 'Team B',
              score: 0,
              members: [
                { id: 'b1', name: 'B1', score: 0, orderIndex: 0 },
                { id: 'b2', name: 'B2', score: 0, orderIndex: 1 }
              ],
              activeMemberId: 'b1'
            }
          ]
        }}
        onUpdateState={() => undefined}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    expect(screen.getByText(/teams can have different numbers of players/i)).toBeInTheDocument();
  });
});

