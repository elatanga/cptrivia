import { describe, expect, it } from 'vitest';
import { doesReturnResolveAsFail, isStealBlockedForMove, normalizeSpecialMoveType, resolveSMS } from './logic';

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

  it('normalizes known move ids and rejects malformed payloads', () => {
    expect(normalizeSpecialMoveType('double_trouble')).toBe('DOUBLE_TROUBLE');
    expect(normalizeSpecialMoveType('   SAFE_BET   ')).toBe('SAFE_BET');
    expect(normalizeSpecialMoveType('')).toBeUndefined();
    expect(normalizeSpecialMoveType('not_a_real_move')).toBeUndefined();
    expect(normalizeSpecialMoveType(undefined)).toBeUndefined();
  });

  it('fails open for unknown move payloads', () => {
    expect(isStealBlockedForMove('NOT_REAL' as any)).toBe(false);
    expect(doesReturnResolveAsFail('NOT_REAL' as any)).toBe(false);
    expect(resolveSMS('NOT_REAL' as any, 200, 'AWARD').points).toBe(200);
  });
});

