import { SpecialMoveType } from '../../types';
import { isStealBlockedForMove, normalizeSpecialMoveType } from './logic';

export interface QuestionModalSpecialMoveModel {
  moveId: SpecialMoveType | 'UNKNOWN';
  moveName: string;
  bannerTitle: string;
  rewardText: string;
  penaltyText?: string;
  stealText: 'NO STEAL' | 'STEAL ALLOWED';
  compactSummary: string;
}

const MODAL_DETAILS: Partial<Record<SpecialMoveType, Omit<QuestionModalSpecialMoveModel, 'moveId' | 'moveName' | 'compactSummary'>>> = {
  DOUBLE_TROUBLE: { bannerTitle: 'DOUBLE OR LOSE', rewardText: 'WIN: 2X POINTS', penaltyText: 'MISS: -TILE VALUE', stealText: 'NO STEAL' },
  TRIPLE_THREAT: { bannerTitle: 'TRIPLE OR LOSE', rewardText: 'WIN: 3X POINTS', penaltyText: 'MISS: -130%', stealText: 'NO STEAL' },
  SABOTAGE: { bannerTitle: 'SAFE BET', rewardText: 'WIN: +50%', penaltyText: 'MISS: NO PENALTY', stealText: 'NO STEAL' },
  SAFE_BET: { bannerTitle: 'SAFE BET', rewardText: 'WIN: +50%', penaltyText: 'MISS: NO PENALTY', stealText: 'NO STEAL' },
  MEGA_STEAL: { bannerTitle: 'LOCKOUT', rewardText: 'NORMAL POINTS', penaltyText: 'CURRENT PLAYER ONLY', stealText: 'NO STEAL' },
  LOCKOUT: { bannerTitle: 'LOCKOUT', rewardText: 'NORMAL POINTS', penaltyText: 'CURRENT PLAYER ONLY', stealText: 'NO STEAL' },
  SUPER_SAVE: { bannerTitle: 'SUPER SAVE', rewardText: 'WIN: 3X POINTS', penaltyText: 'MISS: NO BONUS', stealText: 'NO STEAL' },
  GOLDEN_GAMBLE: { bannerTitle: 'GOLDEN GAMBLE', rewardText: 'WIN: 225%', penaltyText: 'MISS: -50%', stealText: 'NO STEAL' },
  SHIELD_BOOST: { bannerTitle: 'SHIELD BOOST', rewardText: 'WIN: 2X POINTS', penaltyText: 'MISS: NO PENALTY', stealText: 'NO STEAL' },
  FINAL_SHOT: { bannerTitle: 'FINAL SHOT', rewardText: 'WIN: 3X POINTS', penaltyText: 'MISS: -TILE VALUE', stealText: 'NO STEAL' },
  DOUBLE_WINS_OR_NOTHING: { bannerTitle: 'DOUBLE WINS OR NOTHING', rewardText: 'ENDGAME SCORE MOVE', stealText: 'NO STEAL' },
  TRIPLE_WINS_OR_NOTHING: { bannerTitle: 'TRIPLE WINS OR NOTHING', rewardText: 'ENDGAME SCORE MOVE', stealText: 'NO STEAL' },
};

const asLabel = (moveType: string) => moveType.replace(/_/g, ' ');

const buildCompactSummary = (bannerTitle: string, rewardText: string, penaltyText: string | undefined, stealText: 'NO STEAL' | 'STEAL ALLOWED') => {
  const parts = [bannerTitle, rewardText];
  if (penaltyText) parts.push(penaltyText);
  parts.push(stealText);
  return parts.join(' • ');
};

export const getQuestionModalSpecialMoveModel = (rawMoveType?: string | SpecialMoveType): QuestionModalSpecialMoveModel | null => {
  if (!rawMoveType) return null;

  const normalized = normalizeSpecialMoveType(rawMoveType);
  if (normalized) {
    const details = MODAL_DETAILS[normalized];
    const bannerTitle = details?.bannerTitle || asLabel(normalized);
    const rewardText = details?.rewardText || 'SPECIAL RULE ACTIVE';
    const penaltyText = details?.penaltyText;
    const stealText = details?.stealText || (isStealBlockedForMove(normalized) ? 'NO STEAL' : 'STEAL ALLOWED');
    return {
      moveId: normalized,
      moveName: normalized,
      bannerTitle,
      rewardText,
      penaltyText,
      stealText,
      compactSummary: buildCompactSummary(bannerTitle, rewardText, penaltyText, stealText),
    };
  }

  const moveLabel = asLabel(String(rawMoveType).toUpperCase());
  const stealText: 'NO STEAL' | 'STEAL ALLOWED' = 'STEAL ALLOWED';
  return {
    moveId: 'UNKNOWN',
    moveName: String(rawMoveType),
    bannerTitle: moveLabel,
    rewardText: 'SPECIAL RULE ACTIVE',
    stealText,
    compactSummary: buildCompactSummary(moveLabel, 'SPECIAL RULE ACTIVE', undefined, stealText),
  };
};

export const getSpecialMoveDisplayName = (rawMoveType?: string | SpecialMoveType): string | undefined => {
  const model = getQuestionModalSpecialMoveModel(rawMoveType);
  return model?.bannerTitle;
};

