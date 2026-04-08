import { describe, expect, it } from 'vitest';
import {
  deriveResolvedSpecialMoveLabelsByTileId,
  deriveResolvedSpecialMoveTileIds,
  getTileSpecialMoveTagState,
  getTileSpecialMoveTagText,
} from './tileTagState';
import type { GameAnalyticsEvent } from '../../types';

const makeEvent = (overrides: Partial<GameAnalyticsEvent>): GameAnalyticsEvent => ({
  id: overrides.id || 'evt-1',
  ts: overrides.ts || Date.now(),
  iso: overrides.iso || new Date().toISOString(),
  type: overrides.type || 'POINTS_AWARDED',
  actor: overrides.actor || { role: 'director' },
  context: overrides.context || {},
});

describe('tileTagState helpers', () => {
  it('derives resolved tile ids for special-move resolution events', () => {
    const events: GameAnalyticsEvent[] = [
      makeEvent({ context: { tileId: 'q1', specialMoveType: 'DOUBLE_TROUBLE' } }),
      makeEvent({ type: 'TILE_OPENED', context: { tileId: 'q2', specialMoveType: 'TRIPLE_THREAT' } }),
    ];

    const resolved = deriveResolvedSpecialMoveTileIds(events);
    expect(resolved.has('q1')).toBe(true);
    expect(resolved.has('q2')).toBe(false);
  });

  it('derives resolved labels from specialMoveName and preserves move identity', () => {
    const events: GameAnalyticsEvent[] = [
      makeEvent({
        context: { tileId: 'q1', specialMoveType: 'DOUBLE_TROUBLE', specialMoveName: 'DOUBLE OR LOSE' },
      }),
    ];

    expect(deriveResolvedSpecialMoveLabelsByTileId(events).q1).toBe('DOUBLE OR LOSE');
  });

  it('returns move-specific resolved tag text when resolved label exists', () => {
    const state = getTileSpecialMoveTagState(false, true);
    expect(getTileSpecialMoveTagText(undefined, state, 'TRIPLE OR LOSE')).toBe('TRIPLE OR LOSE RESOLVED');
  });

  it('returns move-specific armed tag text for known move types', () => {
    const state = getTileSpecialMoveTagState(true, false);
    expect(getTileSpecialMoveTagText('DOUBLE_TROUBLE', state)).toBe('DOUBLE OR LOSE');
  });
});

