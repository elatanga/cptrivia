import { describe, expect, it } from 'vitest';
import { deriveEndGameCelebrationResult, isTriviaBoardComplete } from './endGameCelebration';
import { Category, Player } from '../types';

describe('endGameCelebration', () => {
  it('detects board completion only when every question is resolved', () => {
    const categories: Category[] = [
      {
        id: 'c1',
        title: 'A',
        questions: [
          { id: 'q1', text: 'Q1', answer: 'A1', points: 100, isRevealed: true, isAnswered: true },
          { id: 'q2', text: 'Q2', answer: 'A2', points: 200, isRevealed: false, isAnswered: false, isVoided: true },
        ],
      },
    ];

    expect(isTriviaBoardComplete(categories)).toBe(true);

    categories[0].questions[1].isVoided = false;
    categories[0].questions[1].isAnswered = false;
    expect(isTriviaBoardComplete(categories)).toBe(false);
  });

  it('returns single-player celebration for a solo game', () => {
    const players: Player[] = [{ id: 'p1', name: 'Alex', score: 1200, color: '#fff', questionsAnswered: 10, lostOrVoidedCount: 2 }];
    const result = deriveEndGameCelebrationResult(players);

    expect(result.mode).toBe('single-player');
    expect(result.title).toBe('CONGRATULATIONS');
    expect(result.winners[0].name).toBe('ALEX');
    expect(result.topScore).toBe(1200);
    expect(result.placements[0].rank).toBe(1);
  });

  it('applies single-player quick mode threshold: 8/10 is victory', () => {
    const players: Player[] = [{ id: 'p1', name: 'Alex', score: 800, color: '#fff', questionsAnswered: 10, lostOrVoidedCount: 2 }];
    const result = deriveEndGameCelebrationResult(players, { singlePlayerQuickMode: true });

    expect(result.mode).toBe('single-player');
    expect(result.title).toBe('VICTORY');
    expect(result.singlePlayerOutcome).toBe('victory');
    expect(result.singlePlayerCorrectAnswers).toBe(8);
  });

  it('applies single-player quick mode threshold: 7/10 is loss', () => {
    const players: Player[] = [{ id: 'p1', name: 'Alex', score: 700, color: '#fff', questionsAnswered: 10, lostOrVoidedCount: 3 }];
    const result = deriveEndGameCelebrationResult(players, { singlePlayerQuickMode: true });

    expect(result.mode).toBe('single-player');
    expect(result.title).toBe('FAILED CHALLENGE');
    expect(result.singlePlayerOutcome).toBe('loss');
    expect(result.singlePlayerCorrectAnswers).toBe(7);
  });

  it('returns tie mode for co-winners', () => {
    const players: Player[] = [
      { id: 'p1', name: 'Beta', score: 900, color: '#fff' },
      { id: 'p2', name: 'Alpha', score: 900, color: '#fff' },
      { id: 'p3', name: 'Gamma', score: 500, color: '#fff' },
    ];
    const result = deriveEndGameCelebrationResult(players);

    expect(result.mode).toBe('tie');
    expect(result.winners).toHaveLength(2);
    expect(result.winners.map((winner) => winner.name)).toEqual(['ALPHA', 'BETA']);
    expect(result.scoreLabel).toBe('Shared Score');
  });

  it('returns top 3 placements with stats', () => {
    const players: Player[] = [
      { id: 'p1', name: 'Alpha', score: 1400, color: '#fff', questionsAnswered: 7, stealsCount: 1, specialMovesUsedCount: 2, lostOrVoidedCount: 1 },
      { id: 'p2', name: 'Beta', score: 1200, color: '#fff', questionsAnswered: 6, stealsCount: 0, specialMovesUsedCount: 1, lostOrVoidedCount: 2 },
      { id: 'p3', name: 'Gamma', score: 1000, color: '#fff', questionsAnswered: 5, stealsCount: 2, specialMovesUsedCount: 0, lostOrVoidedCount: 1 },
      { id: 'p4', name: 'Delta', score: 800, color: '#fff', questionsAnswered: 4, stealsCount: 0, specialMovesUsedCount: 0, lostOrVoidedCount: 3 },
    ];
    const result = deriveEndGameCelebrationResult(players);

    expect(result.placements).toHaveLength(3);
    expect(result.placements[0].name).toBe('ALPHA');
    expect(result.placements[1].name).toBe('BETA');
    expect(result.placements[2].name).toBe('GAMMA');
    expect(result.placements[0].stats.questionsAnswered).toBe(7);
    expect(result.placements[2].stats.stealsMade).toBe(2);
  });

  it('returns team placements and member stats in team mode', () => {
    const players: Player[] = [
      { id: 't1', name: 'Team One', score: 2000, color: '#fff', questionsAnswered: 8, stealsCount: 1, specialMovesUsedCount: 2, lostOrVoidedCount: 1 },
      { id: 't2', name: 'Team Two', score: 1500, color: '#fff', questionsAnswered: 6, stealsCount: 0, specialMovesUsedCount: 1, lostOrVoidedCount: 2 },
    ];

    const result = deriveEndGameCelebrationResult(players, {
      playMode: 'TEAMS',
      teams: [
        {
          id: 't1',
          name: 'Team One',
          score: 2000,
          members: [
            { id: 'm1', name: 'A', score: 1000, questionsAnswered: 4, stealsCount: 1, specialMovesUsedCount: 1, lostOrVoidedCount: 1 },
            { id: 'm2', name: 'B', score: 1000, questionsAnswered: 4, stealsCount: 0, specialMovesUsedCount: 1, lostOrVoidedCount: 0 },
          ],
        },
        {
          id: 't2',
          name: 'Team Two',
          score: 1500,
          members: [
            { id: 'm3', name: 'C', score: 750, questionsAnswered: 3, stealsCount: 0, specialMovesUsedCount: 1, lostOrVoidedCount: 1 },
            { id: 'm4', name: 'D', score: 750, questionsAnswered: 3, stealsCount: 0, specialMovesUsedCount: 0, lostOrVoidedCount: 1 },
          ],
        },
      ],
    });

    expect(result.teamPlacements).toHaveLength(2);
    expect(result.teamPlacements[0].name).toContain('TEAM ONE');
    expect(result.teamPlacements[0].members).toHaveLength(2);
    expect(result.teamPlacements[0].members[0].stats.questionsAnswered).toBe(4);
  });
});

