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
    const players: Player[] = [{ id: 'p1', name: 'Alex', score: 1200, color: '#fff' }];
    const result = deriveEndGameCelebrationResult(players);

    expect(result.mode).toBe('single-player');
    expect(result.title).toBe('CONGRATULATIONS');
    expect(result.winners[0].name).toBe('ALEX');
    expect(result.topScore).toBe(1200);
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
});

