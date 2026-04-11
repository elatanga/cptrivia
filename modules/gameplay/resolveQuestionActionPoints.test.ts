import { describe, expect, it, vi } from 'vitest';
import { resolveQuestionActionPoints } from './resolveQuestionActionPoints';

const tileId = 'q-100';

describe('resolveQuestionActionPoints', () => {
  it('returns zero and skips decorator for VOID', () => {
    const decorator = vi.fn((points: number) => points);

    const points = resolveQuestionActionPoints({
      action: 'void',
      resolvesAsFail: false,
      basePoints: 100,
      tileId,
      applyDecorator: decorator,
    });

    expect(points).toBe(0);
    expect(decorator).not.toHaveBeenCalled();
  });

  it('returns decorated points for AWARD', () => {
    const decorator = vi.fn(() => 200);

    const points = resolveQuestionActionPoints({
      action: 'award',
      resolvesAsFail: false,
      basePoints: 100,
      tileId,
      applyDecorator: decorator,
    });

    expect(points).toBe(200);
    expect(decorator).toHaveBeenCalledWith(100, {
      tileId,
      moveType: undefined,
      outcome: 'AWARD',
    });
  });

  it('returns decorated points for STEAL', () => {
    const decorator = vi.fn(() => 150);

    const points = resolveQuestionActionPoints({
      action: 'steal',
      resolvesAsFail: false,
      basePoints: 100,
      tileId,
      applyDecorator: decorator,
    });

    expect(points).toBe(150);
    expect(decorator).toHaveBeenCalledWith(100, {
      tileId,
      moveType: undefined,
      outcome: 'STEAL',
    });
  });

  it('returns decorated FAIL points for return-as-fail', () => {
    const decorator = vi.fn(() => -100);

    const points = resolveQuestionActionPoints({
      action: 'return',
      resolvesAsFail: true,
      basePoints: 100,
      tileId,
      moveType: 'SAFE_BET',
      applyDecorator: decorator,
    });

    expect(points).toBe(-100);
    expect(decorator).toHaveBeenCalledWith(100, {
      tileId,
      moveType: 'SAFE_BET',
      outcome: 'FAIL',
    });
  });

  it('returns zero and skips decorator for plain RETURN', () => {
    const decorator = vi.fn((points: number) => points);

    const points = resolveQuestionActionPoints({
      action: 'return',
      resolvesAsFail: false,
      basePoints: 100,
      tileId,
      applyDecorator: decorator,
    });

    expect(points).toBe(0);
    expect(decorator).not.toHaveBeenCalled();
  });
});

