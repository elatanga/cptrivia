import { describe, expect, it } from 'vitest';
import { applyBoardMasterRegeneration, isTileActive, preserveTileStateOnRegenerate, regenerateCategoryWithMode } from './boardRegenerationService';
import { Category, Question } from '../types';

describe('boardRegenerationService', () => {
  it('preserves gameplay flags during tile content regeneration', () => {
    const existing: Question = {
      id: 'q1',
      text: 'Old',
      answer: 'Old A',
      points: 100,
      isRevealed: true,
      isAnswered: true,
      isVoided: true,
    };

    const next = preserveTileStateOnRegenerate(existing, {
      ...existing,
      text: 'New',
      answer: 'New A',
      isAnswered: false,
      isVoided: false,
      isRevealed: false,
    });

    expect(next.text).toBe('New');
    expect(next.answer).toBe('New A');
    expect(next.isAnswered).toBe(true);
    expect(next.isVoided).toBe(true);
    expect(next.isRevealed).toBe(true);
  });

  it('regenerates active-only tiles without changing inactive tile state', () => {
    const category: Category = {
      id: 'c1',
      title: 'Science',
      questions: [
        { id: 'q1', text: 'A', answer: 'A1', points: 100, isRevealed: false, isAnswered: false },
        { id: 'q2', text: 'B', answer: 'B1', points: 200, isRevealed: false, isAnswered: false, isVoided: true },
      ],
    };

    const generated: Question[] = [
      { id: 'g1', text: 'A2', answer: 'A2', points: 100, isRevealed: false, isAnswered: false },
      { id: 'g2', text: 'B2', answer: 'B2', points: 200, isRevealed: false, isAnswered: false },
    ];

    const result = regenerateCategoryWithMode(category, generated, 'active_only');

    expect(result.targetedTiles).toBe(1);
    expect(result.updatedTiles).toBe(1);
    expect(result.category.questions[0].text).toBe('A2');
    expect(result.category.questions[1].text).toBe('B');
    expect(result.category.questions[1].isVoided).toBe(true);
  });

  it('resets all tiles to active during board master regeneration', () => {
    const existing: Category[] = [
      {
        id: 'c1',
        title: 'Old Cat',
        questions: [
          { id: 'q1', text: 'Old 1', answer: 'Old A1', points: 100, isRevealed: true, isAnswered: true },
          { id: 'q2', text: 'Old 2', answer: 'Old A2', points: 200, isRevealed: false, isAnswered: false, isVoided: true },
        ],
      },
    ];

    const generated: Category[] = [
      {
        id: 'gc1',
        title: 'New Cat',
        questions: [
          { id: 'g1', text: 'New 1', answer: 'New A1', points: 100, isRevealed: false, isAnswered: false },
          { id: 'g2', text: 'New 2', answer: 'New A2', points: 200, isRevealed: false, isAnswered: false },
        ],
      },
    ];

    const next = applyBoardMasterRegeneration(existing, generated);

    expect(next[0].title).toBe('New Cat');
    expect(next[0].questions[0].id).toBe('q1');
    expect(next[0].questions[0].isAnswered).toBe(false);
    expect(next[0].questions[0].isRevealed).toBe(false);
    expect(next[0].questions[1].isVoided).toBe(false);
  });

  it('detects tile activity using answered/voided defaults', () => {
    expect(
      isTileActive({ id: 'q1', text: 'x', answer: 'y', points: 100, isRevealed: false, isAnswered: false })
    ).toBe(true);
    expect(
      isTileActive({ id: 'q2', text: 'x', answer: 'y', points: 100, isRevealed: false, isAnswered: true })
    ).toBe(false);
  });
});

