import { beforeEach, describe, expect, it } from 'vitest';
import { dataService } from './dataService';
import type { Category } from '../types';

const categories: Category[] = [
  {
    id: 'cat-1',
    title: 'Science',
    questions: [
      {
        id: 'q1',
        text: 'Question 1',
        answer: 'Answer 1',
        points: 100,
        isRevealed: false,
        isAnswered: false,
        isDoubleOrNothing: false,
      },
    ],
  },
];

describe('dataService Team Mode template persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('serializes and returns Team Mode template config correctly', () => {
    dataService.createTemplate(
      'show-1',
      'Team Template',
      {
        playerCount: 0,
        playerNames: [],
        categoryCount: 1,
        rowCount: 1,
        playMode: 'TEAMS',
        teamPlayStyle: 'TEAM_MEMBERS_TAKE_TURNS',
        teams: [
          {
            id: 't1',
            name: 'RED TEAM',
            score: 0,
            activeMemberId: 'm1',
            members: [{ id: 'm1', name: 'ANA', score: 0, orderIndex: 0 }],
          },
        ],
      },
      categories
    );

    const templates = dataService.getTemplatesForShow('show-1');
    expect(templates).toHaveLength(1);
    expect(templates[0].config.playMode).toBe('TEAMS');
    expect(templates[0].config.teamPlayStyle).toBe('TEAM_MEMBERS_TAKE_TURNS');
    expect(templates[0].config.teams?.[0].name).toBe('RED TEAM');
    expect(templates[0].categories[0].title).toBe('Science');
  });

  it('hydrates old templates without team fields safely as Individuals', () => {
    localStorage.setItem('cruzpham_db_templates', JSON.stringify([
      {
        id: 'legacy-1',
        showId: 'show-1',
        topic: 'Legacy',
        config: {
          playerCount: 2,
          playerNames: ['A', 'B'],
          categoryCount: 1,
          rowCount: 1,
        },
        categories,
        createdAt: new Date().toISOString(),
      },
    ]));

    const templates = dataService.getTemplatesForShow('show-1');
    expect(templates[0].config.playMode).toBe('INDIVIDUALS');
    expect(templates[0].config.teamPlayStyle).toBe('TEAM_PLAYS_AS_ONE');
    expect(templates[0].config.teams).toEqual([]);
  });
});

