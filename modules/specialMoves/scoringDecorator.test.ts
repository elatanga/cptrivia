
import { describe, it, expect, vi } from 'vitest';
import { applySpecialMovesDecorator, ScoringContext } from './scoringDecorator';
import { logger } from '../../services/logger';

vi.mock('../../services/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

describe('Special Moves Scoring Decorator (Phase 2)', () => {
  it('A) FAIL-OPEN: returns baseDelta if moveType is missing', () => {
    const ctx: ScoringContext = { tileId: 'q1', outcome: 'AWARD' };
    const result = applySpecialMovesDecorator(100, ctx);
    expect(result).toBe(100);
  });

  it('B) FEATURE GATE: returns baseDelta if isGated is false', () => {
    const ctx: ScoringContext = { tileId: 'q1', moveType: 'DOUBLE_TROUBLE', outcome: 'AWARD', isGated: false };
    const result = applySpecialMovesDecorator(100, ctx);
    expect(result).toBe(100);
  });

  it('C) RESOLUTION: applies DOUBLE_TROUBLE multiplier on AWARD', () => {
    const ctx: ScoringContext = { tileId: 'q1', moveType: 'DOUBLE_TROUBLE', outcome: 'AWARD' };
    const result = applySpecialMovesDecorator(200, ctx);
    expect(result).toBe(400);
  });

  it('D) RESOLUTION: applies TRIPLE_THREAT penalty on FAIL', () => {
    const ctx: ScoringContext = { tileId: 'q1', moveType: 'TRIPLE_THREAT', outcome: 'FAIL' };
    // Base loss for a 200pt question is -200. 
    // Triple Threat resolution for FAIL is -Math.round(base * 1.3) = -260
    const result = applySpecialMovesDecorator(200, ctx);
    expect(result).toBe(-260); 
  });

  it('E) RESOLUTION: applies MEGA_STEAL block on AWARD (returns 0)', () => {
    const ctx: ScoringContext = { tileId: 'q1', moveType: 'MEGA_STEAL', outcome: 'AWARD' };
    const result = applySpecialMovesDecorator(100, ctx);
    expect(result).toBe(100);
  });

  it('F) SAFE BET: applies +50% on AWARD', () => {
    const ctx: ScoringContext = { tileId: 'q1', moveType: 'SAFE_BET', outcome: 'AWARD' };
    const result = applySpecialMovesDecorator(200, ctx);
    expect(result).toBe(300);
  });

  it('G) SAFE BET: applies zero penalty on FAIL', () => {
    const ctx: ScoringContext = { tileId: 'q1', moveType: 'SAFE_BET', outcome: 'FAIL' };
    const result = applySpecialMovesDecorator(200, ctx);
    expect(result).toBe(0);
  });

  it('H) LOCKOUT: blocks steal score impact', () => {
    const ctx: ScoringContext = { tileId: 'q1', moveType: 'LOCKOUT', outcome: 'STEAL' };
    const result = applySpecialMovesDecorator(100, ctx);
    expect(result).toBe(0);
  });

  it('I) SUPER SAVE: applies 3x on award', () => {
    const ctx: ScoringContext = { tileId: 'q1', moveType: 'SUPER_SAVE', outcome: 'AWARD' };
    const result = applySpecialMovesDecorator(100, ctx);
    expect(result).toBe(300);
  });

  it('J) GOLDEN GAMBLE: applies 50% loss on fail', () => {
    const ctx: ScoringContext = { tileId: 'q1', moveType: 'GOLDEN_GAMBLE', outcome: 'FAIL' };
    const result = applySpecialMovesDecorator(200, ctx);
    expect(result).toBe(-100);
  });

  it('K) FAIL-OPEN: returns baseDelta for unknown move types', () => {
    const ctx: ScoringContext = { tileId: 'q1', moveType: 'UNKNOWN' as any, outcome: 'AWARD' };
    const result = applySpecialMovesDecorator(100, ctx);
    expect(result).toBe(100);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
