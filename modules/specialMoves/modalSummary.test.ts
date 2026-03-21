import { describe, expect, it } from 'vitest';
import { getQuestionModalSpecialMoveModel, getSpecialMoveDisplayName } from './modalSummary';

describe('modalSummary', () => {
  it('returns null when no move is active', () => {
    expect(getQuestionModalSpecialMoveModel(undefined)).toBeNull();
  });

  it('returns compact normalized details for a known move', () => {
    const model = getQuestionModalSpecialMoveModel('DOUBLE_TROUBLE');
    expect(model).not.toBeNull();
    expect(model?.bannerTitle).toBe('DOUBLE OR LOSE');
    expect(model?.rewardText).toBe('WIN: 2X POINTS');
    expect(model?.penaltyText).toBe('MISS: -TILE VALUE');
    expect(model?.stealText).toBe('NO STEAL');
    expect(model?.compactSummary).toContain('DOUBLE OR LOSE');
    expect(model?.compactSummary).toContain('NO STEAL');
  });

  it('accepts lower-case payloads from fallback/partial sources', () => {
    const model = getQuestionModalSpecialMoveModel('triple_threat');
    expect(model?.bannerTitle).toBe('TRIPLE OR LOSE');
    expect(model?.stealText).toBe('NO STEAL');
  });

  it('degrades gracefully for malformed move payload', () => {
    const model = getQuestionModalSpecialMoveModel('strange_move_payload');
    expect(model?.moveId).toBe('UNKNOWN');
    expect(model?.rewardText).toBe('SPECIAL RULE ACTIVE');
    expect(model?.stealText).toBe('STEAL ALLOWED');
    expect(model?.compactSummary).toContain('SPECIAL RULE ACTIVE');
  });

  it('returns display title helper for known and malformed moves', () => {
    expect(getSpecialMoveDisplayName('LOCKOUT')).toBe('LOCKOUT');
    expect(getSpecialMoveDisplayName('unknown')).toBe('UNKNOWN');
  });
});

