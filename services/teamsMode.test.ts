import { describe, expect, it } from 'vitest';
import type { GameState, Team, TemplateConfig } from '../types';
import {
  DEFAULT_PLAY_MODE,
  DEFAULT_TEAM_PLAY_STYLE,
  applyScoreDeltaByMode,
  buildTeamMemberTurnSequence,
  getNextTeamTurnSelection,
  getTeamsValidationError,
  normalizeGameStateForTeams,
  normalizeTemplateConfigForTeams,
  rotateActiveMemberForTeamById,
} from './teamsMode';

const makeTeam = (overrides: Partial<Team> = {}): Team => ({
  id: overrides.id || 'team-1',
  name: overrides.name || 'TEAM 1',
  score: overrides.score ?? 0,
  activeMemberId: overrides.activeMemberId,
  members: overrides.members || [
    { id: 'm1', name: 'MEMBER 1', score: 0, orderIndex: 0 },
    { id: 'm2', name: 'MEMBER 2', score: 0, orderIndex: 1 },
  ],
});

describe('teamsMode helpers', () => {
  it('defaults mode to INDIVIDUALS when teams config is absent', () => {
    const cfg = normalizeTemplateConfigForTeams({
      playerCount: 2,
      categoryCount: 4,
      rowCount: 5,
    } as TemplateConfig);

    expect(cfg.playMode).toBe(DEFAULT_PLAY_MODE);
    expect(cfg.teamPlayStyle).toBe(DEFAULT_TEAM_PLAY_STYLE);
    expect(cfg.teams).toEqual([]);
  });

  it('applies team total update in TEAM_PLAYS_AS_ONE', () => {
    const teams = [makeTeam({ id: 't1', score: 100 }), makeTeam({ id: 't2', score: 40 })];
    const next = applyScoreDeltaByMode(teams, 't1', 50, 'TEAM_PLAYS_AS_ONE');

    expect(next.find((team) => team.id === 't1')?.score).toBe(150);
    expect(next.find((team) => team.id === 't1')?.members[0].score).toBe(0);
  });

  it('applies active member and team total update in TEAM_MEMBERS_TAKE_TURNS', () => {
    const teams = [makeTeam({ id: 't1', score: 20, activeMemberId: 'm2' })];
    const next = applyScoreDeltaByMode(teams, 't1', 30, 'TEAM_MEMBERS_TAKE_TURNS');
    const team = next[0];

    expect(team.score).toBe(50);
    expect(team.members.find((member) => member.id === 'm2')?.score).toBe(30);
    expect(team.members.find((member) => member.id === 'm1')?.score).toBe(0);
  });

  it('rotates active member in stable order with wrap-around', () => {
    const teams = [makeTeam({ id: 't1', activeMemberId: 'm2' })];
    const next = rotateActiveMemberForTeamById(teams, 't1');

    expect(next[0].activeMemberId).toBe('m1');
  });

  it('falls back to first member when active member is invalid', () => {
    const teams = [makeTeam({ id: 't1', activeMemberId: 'missing' })];
    const next = rotateActiveMemberForTeamById(teams, 't1');

    expect(next[0].activeMemberId).toBe('m2');
  });

  it('normalizes old game state with missing fields for backward compatibility', () => {
    const oldState = {
      showTitle: 'Show',
      isGameStarted: false,
      categories: [],
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
    } as unknown as GameState;

    const next = normalizeGameStateForTeams(oldState);
    expect(next.playMode).toBe('INDIVIDUALS');
    expect(next.teamPlayStyle).toBe('TEAM_PLAYS_AS_ONE');
    expect(next.teams).toEqual([]);
  });

  it('validates equal team sizes for TEAM_MEMBERS_TAKE_TURNS', () => {
    const teams = [
      makeTeam({ id: 't1', members: [{ id: 'a1', name: 'A1', score: 0, orderIndex: 0 }] }),
      makeTeam({ id: 't2', members: [{ id: 'b1', name: 'B1', score: 0, orderIndex: 0 }] }),
    ];

    expect(getTeamsValidationError('TEAMS', 'TEAM_MEMBERS_TAKE_TURNS', teams)).toBeNull();
  });

  it('fails validation for TEAM_MEMBERS_TAKE_TURNS when team sizes mismatch', () => {
    const teams = [
      makeTeam({ id: 't1', members: [{ id: 'a1', name: 'A1', score: 0, orderIndex: 0 }] }),
      makeTeam({
        id: 't2',
        members: [
          { id: 'b1', name: 'B1', score: 0, orderIndex: 0 },
          { id: 'b2', name: 'B2', score: 0, orderIndex: 1 },
        ],
      }),
    ];

    expect(getTeamsValidationError('TEAMS', 'TEAM_MEMBERS_TAKE_TURNS', teams)).toContain('same number of players');
  });

  it('allows mismatched team sizes in TEAM_PLAYS_AS_ONE', () => {
    const teams = [
      makeTeam({ id: 't1', members: [{ id: 'a1', name: 'A1', score: 0, orderIndex: 0 }] }),
      makeTeam({
        id: 't2',
        members: [
          { id: 'b1', name: 'B1', score: 0, orderIndex: 0 },
          { id: 'b2', name: 'B2', score: 0, orderIndex: 1 },
        ],
      }),
    ];

    expect(getTeamsValidationError('TEAMS', 'TEAM_PLAYS_AS_ONE', teams)).toBeNull();
  });

  it('builds round-robin team-member turn order by member index across teams', () => {
    const teams = [
      makeTeam({
        id: 'A',
        members: [
          { id: 'A1', name: 'A1', score: 0, orderIndex: 0 },
          { id: 'A2', name: 'A2', score: 0, orderIndex: 1 },
        ],
      }),
      makeTeam({
        id: 'B',
        members: [
          { id: 'B1', name: 'B1', score: 0, orderIndex: 0 },
          { id: 'B2', name: 'B2', score: 0, orderIndex: 1 },
        ],
      }),
      makeTeam({
        id: 'C',
        members: [
          { id: 'C1', name: 'C1', score: 0, orderIndex: 0 },
          { id: 'C2', name: 'C2', score: 0, orderIndex: 1 },
        ],
      }),
    ];

    const sequence = buildTeamMemberTurnSequence(teams);
    expect(sequence.map((entry) => `${entry.teamId}:${entry.memberId}`)).toEqual([
      'A:A1', 'B:B1', 'C:C1',
      'A:A2', 'B:B2', 'C:C2',
    ]);
  });

  it('wraps to first participant after last team/member in turn sequence', () => {
    const teams = [
      makeTeam({
        id: 'A',
        activeMemberId: 'A2',
        members: [
          { id: 'A1', name: 'A1', score: 0, orderIndex: 0 },
          { id: 'A2', name: 'A2', score: 0, orderIndex: 1 },
        ],
      }),
      makeTeam({
        id: 'B',
        members: [
          { id: 'B1', name: 'B1', score: 0, orderIndex: 0 },
          { id: 'B2', name: 'B2', score: 0, orderIndex: 1 },
        ],
      }),
      makeTeam({
        id: 'C',
        activeMemberId: 'C2',
        members: [
          { id: 'C1', name: 'C1', score: 0, orderIndex: 0 },
          { id: 'C2', name: 'C2', score: 0, orderIndex: 1 },
        ],
      }),
    ];

    expect(getNextTeamTurnSelection(teams, 'C')).toBe('A');
  });

  it('resumes auto-advance from manually selected participant position', () => {
    const teams = [
      makeTeam({
        id: 'A',
        members: [
          { id: 'A1', name: 'A1', score: 0, orderIndex: 0 },
          { id: 'A2', name: 'A2', score: 0, orderIndex: 1 },
        ],
      }),
      makeTeam({
        id: 'B',
        activeMemberId: 'B2',
        members: [
          { id: 'B1', name: 'B1', score: 0, orderIndex: 0 },
          { id: 'B2', name: 'B2', score: 0, orderIndex: 1 },
        ],
      }),
      makeTeam({
        id: 'C',
        members: [
          { id: 'C1', name: 'C1', score: 0, orderIndex: 0 },
          { id: 'C2', name: 'C2', score: 0, orderIndex: 1 },
        ],
      }),
    ];

    expect(getNextTeamTurnSelection(teams, 'B')).toBe('C');
  });
});

