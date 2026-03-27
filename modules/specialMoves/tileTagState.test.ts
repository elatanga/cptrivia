import { describe, it, expect } from 'vitest';
import { deriveResolvedSpecialMoveTileIds, getTileSpecialMoveBadgeModel, getTileSpecialMoveTagState } from './tileTagState';
import { GameAnalyticsEvent } from '../../types';

const makeEvent = (partial: Partial<GameAnalyticsEvent>): GameAnalyticsEvent => ({
  id: partial.id || 'e1',
  ts: partial.ts || Date.now(),
  iso: partial.iso || new Date().toISOString(),
  type: partial.type || 'POINTS_AWARDED',
  actor: partial.actor,
  context: partial.context || {},
});

describe('tileTagState', () => {
  it('returns hidden model for tiles without special moves', () => {
    const model = getTileSpecialMoveBadgeModel(false, false);
    expect(model).toEqual({
      showTag: false,
      label: 'SPECIAL MOVE!',
      visualState: null,
      tone: null,
    });
    expect(getTileSpecialMoveTagState(false, false)).toBe('none');
  });

  it('returns armed/red model for armed tiles', () => {
    const model = getTileSpecialMoveBadgeModel(true, false);
    expect(model.showTag).toBe(true);
    expect(model.visualState).toBe('armed');
    expect(model.tone).toBe('red');
    expect(model.label).toBe('SPECIAL MOVE!');
    expect(getTileSpecialMoveTagState(true, false)).toBe('armed');
  });

  it('returns resolved/grey model and resolved wins over armed', () => {
    const model = getTileSpecialMoveBadgeModel(true, true);
    expect(model.showTag).toBe(true);
    expect(model.visualState).toBe('resolved');
    expect(model.tone).toBe('grey');
    expect(getTileSpecialMoveTagState(true, true)).toBe('resolved');
  });

  it('derives resolved tile IDs only from special-move resolution events', () => {
    const resolved = deriveResolvedSpecialMoveTileIds([
      makeEvent({
        id: 'sm1',
        type: 'POINTS_AWARDED',
        context: { tileId: 'q1', specialMoveType: 'DOUBLE_TROUBLE' },
      }),
      makeEvent({
        id: 'sm2',
        type: 'QUESTION_RETURNED',
        context: { tileId: 'q2', note: 'Special move failure (DOUBLE_TROUBLE)' },
      }),
      makeEvent({
        id: 'no-sm-void',
        type: 'TILE_VOIDED',
        context: { tileId: 'q3', note: 'Question voided by producer' },
      }),
      makeEvent({
        id: 'non-resolution',
        type: 'SPECIAL_MOVE_ARMED',
        context: { tileId: 'q4', specialMoveType: 'DOUBLE_TROUBLE' },
      }),
      makeEvent({
        id: 'missing-tile',
        type: 'POINTS_AWARDED',
        context: { specialMoveType: 'DOUBLE_TROUBLE' },
      }),
    ]);

    expect(resolved.has('q1')).toBe(true);
    expect(resolved.has('q2')).toBe(true);
    expect(resolved.has('q3')).toBe(false);
    expect(resolved.has('q4')).toBe(false);
    expect(resolved.size).toBe(2);
  });

  it('handles malformed events defensively', () => {
    const brokenEvents = [
      undefined,
      null,
      { context: {} },
      makeEvent({ type: 'SCORE_ADJUSTED', context: { tileId: 'q9', note: '' } }),
    ] as any;

    const resolved = deriveResolvedSpecialMoveTileIds(brokenEvents);
    expect(resolved.size).toBe(0);
  });
});

