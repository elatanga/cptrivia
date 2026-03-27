import { describe, expect, it } from 'vitest';
import type { Category } from '../../types';
import {
  getActiveTileCount,
  getBoardPointColumns,
  getGiftMoveGlobalDisabledReason,
  getGiftMoveTileDisabledReason,
  getTileColumnIndex,
} from './eligibility';

const makeBoard = (columns: number, rows = 2): Category[] => {
  const points = Array.from({ length: columns }, (_, idx) => (idx + 1) * 100);
  return [
    {
      id: 'cat-1',
      title: 'Category 1',
      questions: points.map((point, idx) => ({
        id: `c1-q${idx + 1}`,
        text: `Q${idx + 1}`,
        answer: 'A',
        points: point,
        isRevealed: false,
        isAnswered: false,
      })),
    },
    {
      id: 'cat-2',
      title: 'Category 2',
      questions: points.map((point, idx) => ({
        id: `c2-q${idx + 1}`,
        text: `Q${idx + 1}`,
        answer: 'A',
        points: point,
        isRevealed: false,
        isAnswered: false,
      })),
    },
  ].slice(0, rows);
};

describe('gift move eligibility helpers', () => {
  it('derives board point columns and active tiles safely', () => {
    const board = makeBoard(6, 2);
    expect(getBoardPointColumns(board)).toBe(6);
    expect(getActiveTileCount(board)).toBe(12);
  });

  it('blocks super save globally on small boards', () => {
    const board = makeBoard(4, 2);
    expect(getGiftMoveGlobalDisabledReason('SUPER_SAVE', board)).toBe('BOARD MIN 6 COLUMNS');
  });

  it('enforces super save first-three-columns rule', () => {
    const board = makeBoard(6, 2);
    expect(getTileColumnIndex(board, 'c1-q2')).toBe(1);
    expect(getGiftMoveTileDisabledReason('SUPER_SAVE', board, 'c1-q2')).toBeNull();
    expect(getGiftMoveTileDisabledReason('SUPER_SAVE', board, 'c1-q6')).toBe('EARLY COLUMNS ONLY');
  });

  it('enforces final shot last-two-columns rule', () => {
    const board = makeBoard(6, 2);
    expect(getGiftMoveTileDisabledReason('FINAL_SHOT', board, 'c1-q1')).toBe('LAST 2 COLUMNS ONLY');
    expect(getGiftMoveTileDisabledReason('FINAL_SHOT', board, 'c1-q6')).toBeNull();
  });
});

