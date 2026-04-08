import { describe, expect, it } from 'vitest';
import type { GameState, Team, TemplateConfig } from '../types';
import {
  DEFAULT_PLAY_MODE,
  DEFAULT_TEAM_PLAY_STYLE,
  applyScoreDeltaByMode,
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
});

