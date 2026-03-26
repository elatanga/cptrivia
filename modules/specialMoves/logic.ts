
import { SMSType, SMSResolution } from './types';

const roundScore = (value: number) => Math.round(value);

const VALID_SMS_TYPES = new Set<SMSType>([
  'DOUBLE_TROUBLE',
  'TRIPLE_THREAT',
  'SABOTAGE',
  'MEGA_STEAL',
  'DOUBLE_WINS_OR_NOTHING',
  'TRIPLE_WINS_OR_NOTHING',
  'SAFE_BET',
  'LOCKOUT',
  'SUPER_SAVE',
  'GOLDEN_GAMBLE',
  'SHIELD_BOOST',
  'FINAL_SHOT',
]);

export const normalizeSpecialMoveType = (moveType?: unknown): SMSType | undefined => {
  if (typeof moveType !== 'string') return undefined;
  const normalized = moveType.trim().toUpperCase();
  if (!normalized) return undefined;
  return VALID_SMS_TYPES.has(normalized as SMSType) ? (normalized as SMSType) : undefined;
};

export const isStealBlockedForMove = (moveType?: SMSType): boolean => {
  const normalizedMoveType = normalizeSpecialMoveType(moveType);
  if (!normalizedMoveType) return false;
  return [
    'DOUBLE_TROUBLE',
    'TRIPLE_THREAT',
    'SABOTAGE',
    'MEGA_STEAL',
    'SAFE_BET',
    'LOCKOUT',
    'SUPER_SAVE',
    'GOLDEN_GAMBLE',
    'SHIELD_BOOST',
    'FINAL_SHOT',
    'DOUBLE_WINS_OR_NOTHING',
    'TRIPLE_WINS_OR_NOTHING',
  ].includes(normalizedMoveType);
};

export const doesReturnResolveAsFail = (moveType?: SMSType): boolean => {
  const normalizedMoveType = normalizeSpecialMoveType(moveType);
  if (!normalizedMoveType) return false;
  return [
    'DOUBLE_TROUBLE',
    'TRIPLE_THREAT',
    'SABOTAGE',
    'MEGA_STEAL',
    'SAFE_BET',
    'LOCKOUT',
    'SUPER_SAVE',
    'GOLDEN_GAMBLE',
    'SHIELD_BOOST',
    'FINAL_SHOT',
  ].includes(normalizedMoveType);
};

/**
 * Resolves the final point value based on the move type and outcome.
 * Pure function, easily testable.
 */
export const resolveSMS = (
  moveType: SMSType | undefined,
  basePoints: number,
  outcome: 'AWARD' | 'STEAL' | 'FAIL'
): SMSResolution => {
  const normalizedMoveType = normalizeSpecialMoveType(moveType);
  if (!normalizedMoveType) return { points: basePoints, label: '' };

  switch (normalizedMoveType) {
    case 'DOUBLE_TROUBLE':
      if (outcome === 'AWARD') return { points: basePoints * 2, label: 'DOUBLE OR LOSE: 2X' };
      if (outcome === 'STEAL') return { points: 0, label: 'STEAL BLOCKED', isBlocked: true };
      if (outcome === 'FAIL') return { points: -basePoints, label: 'DOUBLE OR LOSE: FAILED' };
      break;

    case 'TRIPLE_THREAT':
      if (outcome === 'AWARD') return { points: basePoints * 3, label: 'TRIPLE OR LOSE: 3X' };
      if (outcome === 'STEAL') return { points: 0, label: 'STEAL BLOCKED', isBlocked: true };
      if (outcome === 'FAIL') return { points: -roundScore(basePoints * 1.3), label: 'TRIPLE OR LOSE: FAILED' };
      break;

    case 'SABOTAGE':
    case 'SAFE_BET':
      if (outcome === 'AWARD') return { points: roundScore(basePoints * 1.5), label: 'SAFE BET: +50%' };
      if (outcome === 'STEAL') return { points: 0, label: 'STEAL BLOCKED', isBlocked: true };
      if (outcome === 'FAIL') return { points: 0, label: 'SAFE BET: NO PENALTY' };
      break;

    case 'MEGA_STEAL':
    case 'LOCKOUT':
      if (outcome === 'AWARD') return { points: basePoints, label: 'LOCKOUT: STANDARD AWARD' };
      if (outcome === 'STEAL') return { points: 0, label: 'STEAL BLOCKED', isBlocked: true };
      if (outcome === 'FAIL') return { points: 0, label: 'LOCKOUT: NO PENALTY' };
      break;

    case 'SUPER_SAVE':
      if (outcome === 'AWARD') return { points: basePoints * 3, label: 'SUPER SAVE: 3X' };
      if (outcome === 'STEAL') return { points: 0, label: 'STEAL BLOCKED', isBlocked: true };
      if (outcome === 'FAIL') return { points: 0, label: 'SUPER SAVE: NO BONUS' };
      break;

    case 'GOLDEN_GAMBLE':
      if (outcome === 'AWARD') return { points: roundScore(basePoints * 2.25), label: 'GOLDEN GAMBLE: +125%' };
      if (outcome === 'STEAL') return { points: 0, label: 'STEAL BLOCKED', isBlocked: true };
      if (outcome === 'FAIL') return { points: -roundScore(basePoints * 0.5), label: 'GOLDEN GAMBLE: -50%' };
      break;

    case 'SHIELD_BOOST':
      if (outcome === 'AWARD') return { points: basePoints * 2, label: 'SHIELD BOOST: 2X' };
      if (outcome === 'STEAL') return { points: 0, label: 'STEAL BLOCKED', isBlocked: true };
      if (outcome === 'FAIL') return { points: 0, label: 'SHIELD BOOST: NO PENALTY' };
      break;

    case 'FINAL_SHOT':
      if (outcome === 'AWARD') return { points: basePoints * 3, label: 'FINAL SHOT: 3X' };
      if (outcome === 'STEAL') return { points: 0, label: 'STEAL BLOCKED', isBlocked: true };
      if (outcome === 'FAIL') return { points: -basePoints, label: 'FINAL SHOT: LOST' };
      break;

    case 'DOUBLE_WINS_OR_NOTHING':
    case 'TRIPLE_WINS_OR_NOTHING':
      return { points: basePoints, label: 'ENDGAME TOTAL-SCORE MOVE' };
    default:
      break;
  }

  return { points: basePoints, label: '' };
};

export const getSMSColor = (type: SMSType): string => {
  const colors = {
    DOUBLE_TROUBLE: 'cyan',
    TRIPLE_THREAT: 'gold',
    SABOTAGE: 'emerald',
    MEGA_STEAL: 'violet',
    SAFE_BET: 'emerald',
    LOCKOUT: 'violet',
    SUPER_SAVE: 'sky',
    GOLDEN_GAMBLE: 'amber',
    SHIELD_BOOST: 'emerald',
    FINAL_SHOT: 'rose',
    DOUBLE_WINS_OR_NOTHING: 'amber',
    TRIPLE_WINS_OR_NOTHING: 'rose',
  };
  return colors[type] || 'gold';
};
