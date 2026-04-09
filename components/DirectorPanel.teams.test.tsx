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

// ─────────────────────────────────────────────────────────────────────────────
// POST-TEMPLATE-APPLY: Teams tab must remain editable when isGameStarted=true
// ─────────────────────────────────────────────────────────────────────────────

/** A game state that mimics what handlePlayTemplate produces for a Teams template */
const gameStartedWithTeams: typeof baseGameState = {
  ...baseGameState,
  isGameStarted: true,
  playMode: 'TEAMS',
  teamPlayStyle: 'TEAM_PLAYS_AS_ONE',
  teams: [
    {
      id: 'team-alpha',
      name: 'ALPHA',
      score: 200,
      members: [
        { id: 'm-a1', name: 'Alice', score: 0, orderIndex: 0 },
        { id: 'm-a2', name: 'Bob', score: 0, orderIndex: 1 },
      ],
      activeMemberId: 'm-a1',
    },
    {
      id: 'team-beta',
      name: 'BETA',
      score: 100,
      members: [{ id: 'm-b1', name: 'Carol', score: 0, orderIndex: 0 }],
      activeMemberId: 'm-b1',
    },
  ],
  players: [
    { id: 'team-alpha', name: 'ALPHA', score: 200, color: '#fff', wildcardsUsed: 2, wildcardActive: false, stealsCount: 1, specialMovesUsedCount: 0, specialMovesUsedNames: [] },
    { id: 'team-beta', name: 'BETA', score: 100, color: '#fff', wildcardsUsed: 0, wildcardActive: false, stealsCount: 0, specialMovesUsedCount: 0, specialMovesUsedNames: [] },
  ],
  selectedPlayerId: 'team-alpha',
};

describe('DirectorPanel Teams Tab — post-template-apply (isGameStarted=true)', () => {
  it('renders Teams tab correctly when game is started with teams from template', () => {
    render(
      <DirectorPanel
        gameState={gameStartedWithTeams}
        onUpdateState={() => undefined}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    expect(screen.getByText(/ALPHA/i)).toBeInTheDocument();
    expect(screen.getByText(/BETA/i)).toBeInTheDocument();
  });

  it('shows a helpful lock message (not a full lock) when game is started', () => {
    render(
      <DirectorPanel
        gameState={gameStartedWithTeams}
        onUpdateState={() => undefined}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    expect(screen.getByText(/play style.*locked/i)).toBeInTheDocument();
    expect(screen.getByText(/names and roster can still be edited/i)).toBeInTheDocument();
  });

  it('ADD TEAM button is enabled and fires onUpdateState after game starts', () => {
    const onUpdateState = vi.fn();

    render(
      <DirectorPanel
        gameState={gameStartedWithTeams}
        onUpdateState={onUpdateState}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    const addTeamBtn = screen.getByRole('button', { name: /Add Team/i });
    expect(addTeamBtn).not.toBeDisabled();
    fireEvent.click(addTeamBtn);
    expect(onUpdateState).toHaveBeenCalled();
    const nextState = onUpdateState.mock.calls[0][0];
    expect(nextState.teams).toHaveLength(3);
  });

  it('Add Team preserves existing player live stats (wildcards, steals) after game starts', () => {
    const onUpdateState = vi.fn();

    render(
      <DirectorPanel
        gameState={gameStartedWithTeams}
        onUpdateState={onUpdateState}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    fireEvent.click(screen.getByRole('button', { name: /Add Team/i }));

    const nextState = onUpdateState.mock.calls[0][0];
    const alphaPlayer = nextState.players.find((p: { id: string }) => p.id === 'team-alpha');
    expect(alphaPlayer).toBeDefined();
    expect(alphaPlayer.wildcardsUsed).toBe(2);
    expect(alphaPlayer.stealsCount).toBe(1);
    expect(alphaPlayer.score).toBe(200);
  });

  it('team name input is NOT disabled when game is started', () => {
    render(
      <DirectorPanel
        gameState={gameStartedWithTeams}
        onUpdateState={() => undefined}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    const teamNameInputs = screen.getAllByPlaceholderText(/TEAM NAME/i);
    teamNameInputs.forEach((input) => {
      expect(input).not.toBeDisabled();
    });
  });

  it('editing a team name calls onUpdateState with the updated name', () => {
    const onUpdateState = vi.fn();

    render(
      <DirectorPanel
        gameState={gameStartedWithTeams}
        onUpdateState={onUpdateState}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    const teamNameInputs = screen.getAllByPlaceholderText(/TEAM NAME/i);
    fireEvent.change(teamNameInputs[0], { target: { value: 'CHAMPIONS' } });

    expect(onUpdateState).toHaveBeenCalled();
    const nextState = onUpdateState.mock.calls[0][0];
    const renamedTeam = nextState.teams.find((t: { id: string }) => t.id === 'team-alpha');
    expect(renamedTeam).toBeDefined();
    expect(renamedTeam.name).toContain('CHAMPIONS');
  });

  it('editing a team name preserves live player stats (wildcards, steals)', () => {
    const onUpdateState = vi.fn();

    render(
      <DirectorPanel
        gameState={gameStartedWithTeams}
        onUpdateState={onUpdateState}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    const teamNameInputs = screen.getAllByPlaceholderText(/TEAM NAME/i);
    fireEvent.change(teamNameInputs[0], { target: { value: 'CHAMPIONS' } });

    const nextState = onUpdateState.mock.calls[0][0];
    const alphaPlayer = nextState.players.find((p: { id: string }) => p.id === 'team-alpha');
    expect(alphaPlayer).toBeDefined();
    expect(alphaPlayer.wildcardsUsed).toBe(2);
    expect(alphaPlayer.stealsCount).toBe(1);
    expect(alphaPlayer.score).toBe(200);
  });

  it('member name inputs are NOT disabled when game is started', () => {
    render(
      <DirectorPanel
        gameState={gameStartedWithTeams}
        onUpdateState={() => undefined}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    const memberInputs = screen.getAllByPlaceholderText(/MEMBER NAME/i);
    expect(memberInputs.length).toBeGreaterThan(0);
    memberInputs.forEach((input) => {
      expect(input).not.toBeDisabled();
    });
  });

  it('editing a member name calls onUpdateState with the updated member name', () => {
    const onUpdateState = vi.fn();

    render(
      <DirectorPanel
        gameState={gameStartedWithTeams}
        onUpdateState={onUpdateState}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    const memberInputs = screen.getAllByPlaceholderText(/MEMBER NAME/i);
    fireEvent.change(memberInputs[0], { target: { value: 'ALICE RENAMED' } });

    expect(onUpdateState).toHaveBeenCalled();
    const nextState = onUpdateState.mock.calls[0][0];
    const alphaTeam = nextState.teams.find((t: { id: string }) => t.id === 'team-alpha');
    expect(alphaTeam).toBeDefined();
    const alice = alphaTeam.members.find((m: { id: string }) => m.id === 'm-a1');
    expect(alice).toBeDefined();
    expect(alice.name).toContain('ALICE RENAMED');
  });

  it('+ MEMBER button is enabled and adds a member when game is started', () => {
    const onUpdateState = vi.fn();

    render(
      <DirectorPanel
        gameState={gameStartedWithTeams}
        onUpdateState={onUpdateState}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    const addMemberBtns = screen.getAllByRole('button', { name: /\+ MEMBER/i });
    expect(addMemberBtns[0]).not.toBeDisabled();
    fireEvent.click(addMemberBtns[0]);

    expect(onUpdateState).toHaveBeenCalled();
    const nextState = onUpdateState.mock.calls[0][0];
    const alphaTeam = nextState.teams.find((t: { id: string }) => t.id === 'team-alpha');
    expect(alphaTeam.members).toHaveLength(3);
  });

  it('play style buttons remain DISABLED when game is started (structural lock preserved)', () => {
    render(
      <DirectorPanel
        gameState={gameStartedWithTeams}
        onUpdateState={() => undefined}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    const playAsOneBtn = screen.getByRole('button', { name: /Team plays as one/i });
    const takeTurnsBtn = screen.getByRole('button', { name: /Team members take turns/i });
    expect(playAsOneBtn).toBeDisabled();
    expect(takeTurnsBtn).toBeDisabled();
  });

  it('REMOVE team button remains DISABLED when game is started', () => {
    render(
      <DirectorPanel
        gameState={gameStartedWithTeams}
        onUpdateState={() => undefined}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    const removeBtns = screen.getAllByRole('button', { name: /^REMOVE$/i });
    removeBtns.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it('TEAM_MEMBERS_TAKE_TURNS: member names are editable after template setup', () => {
    const onUpdateState = vi.fn();
    const takeTurnsState: typeof baseGameState = {
      ...gameStartedWithTeams,
      teamPlayStyle: 'TEAM_MEMBERS_TAKE_TURNS',
      teams: [
        {
          id: 'team-alpha',
          name: 'ALPHA',
          score: 200,
          members: [{ id: 'm-a1', name: 'Alice', score: 0, orderIndex: 0 }],
          activeMemberId: 'm-a1',
        },
        {
          id: 'team-beta',
          name: 'BETA',
          score: 100,
          members: [{ id: 'm-b1', name: 'Carol', score: 0, orderIndex: 0 }],
          activeMemberId: 'm-b1',
        },
      ],
    };

    render(
      <DirectorPanel
        gameState={takeTurnsState}
        onUpdateState={onUpdateState}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    const memberInputs = screen.getAllByPlaceholderText(/MEMBER NAME/i);
    expect(memberInputs[0]).not.toBeDisabled();
    fireEvent.change(memberInputs[0], { target: { value: 'ALICE V2' } });
    expect(onUpdateState).toHaveBeenCalled();
  });

  it('Individuals mode: Teams tab shows mode toggle as Off (unchanged behavior)', () => {
    render(
      <DirectorPanel
        gameState={{ ...baseGameState, isGameStarted: false, playMode: 'INDIVIDUALS' }}
        onUpdateState={() => undefined}
        emitGameEvent={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Teams/i }));
    expect(screen.getByRole('button', { name: /Off/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/TEAM NAME/i)).not.toBeInTheDocument();
  });
});

