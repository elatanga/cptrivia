import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Scoreboard } from './Scoreboard';
import type { BoardViewSettings, Player, Team } from '../types';

const viewSettings: BoardViewSettings = {
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
};

const players: Player[] = [
  { id: 'p1', name: 'Alice', score: 10, color: '#fff' },
  { id: 'p2', name: 'Bob', score: 20, color: '#fff' },
];

const teams: Team[] = [
  {
    id: 't1',
    name: 'Red Team',
    score: 100,
    activeMemberId: 'm1',
    members: [
      { id: 'm1', name: 'Ana', score: 40, orderIndex: 0 },
      { id: 'm2', name: 'Bev', score: 60, orderIndex: 1 },
    ],
  },
  {
    id: 't2',
    name: 'Blue Team',
    score: 80,
    activeMemberId: 'm3',
    members: [{ id: 'm3', name: 'Cal', score: 80, orderIndex: 0 }],
  },
];

describe('Scoreboard Teams Mode', () => {
  it('renders individuals mode unchanged', () => {
    render(
      <Scoreboard
        players={players}
        selectedPlayerId="p1"
        onAddPlayer={() => undefined}
        onUpdateScore={() => undefined}
        onSelectPlayer={() => undefined}
        gameActive
        viewSettings={viewSettings}
      />
    );

    expect(screen.getByText(/CONTESTANTS/i)).toBeInTheDocument();
    expect(screen.getByText('ALICE')).toBeInTheDocument();
  });

  it('renders teams in TEAM_PLAYS_AS_ONE', () => {
    render(
      <Scoreboard
        players={players}
        teams={teams}
        playMode="TEAMS"
        teamPlayStyle="TEAM_PLAYS_AS_ONE"
        selectedPlayerId="t1"
        onAddPlayer={() => undefined}
        onUpdateScore={() => undefined}
        onSelectPlayer={() => undefined}
        gameActive
        viewSettings={viewSettings}
      />
    );

    expect(screen.getByText(/TEAMS/i)).toBeInTheDocument();
    expect(screen.getByText('RED TEAM')).toBeInTheDocument();
    expect(screen.getAllByText('TEAM').length).toBeGreaterThan(0);
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('renders member scores and active marker in TEAM_MEMBERS_TAKE_TURNS', () => {
    render(
      <Scoreboard
        players={players}
        teams={teams}
        playMode="TEAMS"
        teamPlayStyle="TEAM_MEMBERS_TAKE_TURNS"
        selectedPlayerId="t1"
        onAddPlayer={() => undefined}
        onUpdateScore={() => undefined}
        onSelectPlayer={() => undefined}
        gameActive
        viewSettings={viewSettings}
      />
    );

    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Bev')).toBeInTheDocument();
    expect(screen.getAllByText('ACTIVE').length).toBeGreaterThan(0);
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
  });

  it('team click still triggers manual selection callback', () => {
    const onSelectPlayer = vi.fn();
    render(
      <Scoreboard
        players={players}
        teams={teams}
        playMode="TEAMS"
        teamPlayStyle="TEAM_PLAYS_AS_ONE"
        selectedPlayerId={null}
        onAddPlayer={() => undefined}
        onUpdateScore={() => undefined}
        onSelectPlayer={onSelectPlayer}
        gameActive
        viewSettings={viewSettings}
      />
    );

    fireEvent.click(screen.getByText('RED TEAM'));
    expect(onSelectPlayer).toHaveBeenCalledWith('t1');
  });
});

