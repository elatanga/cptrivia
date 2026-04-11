import { describe, expect, it } from 'vitest';
import { doesReturnResolveAsFail, isStealBlockedForMove, resolveSMS } from './logic';

describe('special move logic hardening', () => {
  it('blocks steal for risk tile moves', () => {
    expect(isStealBlockedForMove('DOUBLE_TROUBLE')).toBe(true);
    expect(isStealBlockedForMove('TRIPLE_THREAT')).toBe(true);
    expect(isStealBlockedForMove('SAFE_BET')).toBe(true);
    expect(isStealBlockedForMove('SUPER_SAVE')).toBe(true);
    expect(isStealBlockedForMove('FINAL_SHOT')).toBe(true);
    expect(isStealBlockedForMove(undefined)).toBe(false);
  });

  it('maps return to fail only for tile-bound risk moves', () => {
    expect(doesReturnResolveAsFail('DOUBLE_TROUBLE')).toBe(true);
    expect(doesReturnResolveAsFail('TRIPLE_THREAT')).toBe(true);
    expect(doesReturnResolveAsFail('GOLDEN_GAMBLE')).toBe(true);
    expect(doesReturnResolveAsFail('DOUBLE_WINS_OR_NOTHING')).toBe(false);
  });

  it('applies deterministic triple-or-lose fail penalty rounding', () => {
    const result = resolveSMS('TRIPLE_THREAT', 100, 'FAIL');
    expect(result.points).toBe(-130);
  });

  it('applies super save award multiplier', () => {
    const result = resolveSMS('SUPER_SAVE', 200, 'AWARD');
    expect(result.points).toBe(600);
  });

  it('applies final shot fail penalty', () => {
    const result = resolveSMS('FINAL_SHOT', 300, 'FAIL');
    expect(result.points).toBe(-300);
  });
});

