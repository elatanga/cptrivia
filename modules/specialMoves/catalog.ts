import { SpecialMoveType } from '../../types';

export type QuestionModalStealPolicy = 'NO STEAL' | 'STEAL ALLOWED';

export interface SpecialMoveCatalogEntry {
  moveType: SpecialMoveType;
  displayTitle: string;
  description: string;
  pointsEffect: string;
  penaltyEffect?: string;
  stealPolicy: QuestionModalStealPolicy;
  isGiftActivated: boolean;
  isEndgame: boolean;
}

export interface BuildGatedSpecialMoveCard {
  id: 'SECOND_CHANCE' | 'CATEGORY_FREEZE';
  displayTitle: string;
  description: string;
  disabledReason: string;
}

export const SPECIAL_MOVE_CATALOG: Record<SpecialMoveType, SpecialMoveCatalogEntry> = {
  DOUBLE_TROUBLE: {
    moveType: 'DOUBLE_TROUBLE',
    displayTitle: 'DOUBLE OR LOSE',
    description: 'Tile only. Correct = 2x. Fail/return = lose tile value. No steal.',
    pointsEffect: 'WIN: 2X POINTS',
    penaltyEffect: 'MISS: -TILE VALUE',
    stealPolicy: 'NO STEAL',
    isGiftActivated: false,
    isEndgame: false,
  },
  TRIPLE_THREAT: {
    moveType: 'TRIPLE_THREAT',
    displayTitle: 'TRIPLE OR LOSE',
    description: 'Tile only. Correct = 3x. Fail/return = lose 130% of tile value. No steal.',
    pointsEffect: 'WIN: 3X POINTS',
    penaltyEffect: 'MISS: -130%',
    stealPolicy: 'NO STEAL',
    isGiftActivated: false,
    isEndgame: false,
  },
  SABOTAGE: {
    moveType: 'SABOTAGE',
    displayTitle: 'SAFE BET',
    description: 'Legacy alias for Safe Bet.',
    pointsEffect: 'WIN: +50%',
    penaltyEffect: 'MISS: NO PENALTY',
    stealPolicy: 'NO STEAL',
    isGiftActivated: false,
    isEndgame: false,
  },
  MEGA_STEAL: {
    moveType: 'MEGA_STEAL',
    displayTitle: 'LOCKOUT',
    description: 'Legacy alias for Lockout.',
    pointsEffect: 'STANDARD AWARD',
    penaltyEffect: 'MISS: NO EXTRA PENALTY',
    stealPolicy: 'NO STEAL',
    isGiftActivated: false,
    isEndgame: false,
  },
  DOUBLE_WINS_OR_NOTHING: {
    moveType: 'DOUBLE_WINS_OR_NOTHING',
    displayTitle: 'DOUBLE YOUR WINS OR NOTHING',
    description: 'Endgame challenge. Top-2 only. Correct doubles total score, wrong resets to 0.',
    pointsEffect: 'ENDGAME SCORE MOVE',
    stealPolicy: 'NO STEAL',
    isGiftActivated: false,
    isEndgame: true,
  },
  TRIPLE_WINS_OR_NOTHING: {
    moveType: 'TRIPLE_WINS_OR_NOTHING',
    displayTitle: 'TRIPLE YOUR WINS OR NOTHING',
    description: 'Endgame challenge. Top-2 only. Correct triples total score, wrong resets to 0.',
    pointsEffect: 'ENDGAME SCORE MOVE',
    stealPolicy: 'NO STEAL',
    isGiftActivated: false,
    isEndgame: true,
  },
  SAFE_BET: {
    moveType: 'SAFE_BET',
    displayTitle: 'SAFE BET',
    description: 'Tile only. Correct = +50%. Wrong = no penalty. No steal.',
    pointsEffect: 'WIN: +50%',
    penaltyEffect: 'MISS: NO PENALTY',
    stealPolicy: 'NO STEAL',
    isGiftActivated: false,
    isEndgame: false,
  },
  LOCKOUT: {
    moveType: 'LOCKOUT',
    displayTitle: 'LOCKOUT',
    description: 'Tile only. No steal allowed. Normal award, no extra fail penalty.',
    pointsEffect: 'STANDARD AWARD',
    penaltyEffect: 'MISS: NO EXTRA PENALTY',
    stealPolicy: 'NO STEAL',
    isGiftActivated: false,
    isEndgame: false,
  },
  SUPER_SAVE: {
    moveType: 'SUPER_SAVE',
    displayTitle: 'SUPER SAVE',
    description: 'Gift required. First 3 columns only. Correct = 3x. No steal.',
    pointsEffect: 'WIN: 3X POINTS',
    penaltyEffect: 'MISS: NO BONUS',
    stealPolicy: 'NO STEAL',
    isGiftActivated: true,
    isEndgame: false,
  },
  GOLDEN_GAMBLE: {
    moveType: 'GOLDEN_GAMBLE',
    displayTitle: 'GOLDEN GAMBLE',
    description: 'Gift required. Middle columns only. Correct = +125%. Wrong = -50%. No steal.',
    pointsEffect: 'WIN: 225%',
    penaltyEffect: 'MISS: -50%',
    stealPolicy: 'NO STEAL',
    isGiftActivated: true,
    isEndgame: false,
  },
  SHIELD_BOOST: {
    moveType: 'SHIELD_BOOST',
    displayTitle: 'SHIELD BOOST',
    description: 'Gift required. Non-final column only. Correct = 2x. Wrong = no penalty. No steal.',
    pointsEffect: 'WIN: 2X POINTS',
    penaltyEffect: 'MISS: NO PENALTY',
    stealPolicy: 'NO STEAL',
    isGiftActivated: true,
    isEndgame: false,
  },
  FINAL_SHOT: {
    moveType: 'FINAL_SHOT',
    displayTitle: 'FINAL SHOT',
    description: 'Gift required. Last 2 columns only. Correct = 3x. Wrong = lose tile value. No steal.',
    pointsEffect: 'WIN: 3X POINTS',
    penaltyEffect: 'MISS: -TILE VALUE',
    stealPolicy: 'NO STEAL',
    isGiftActivated: true,
    isEndgame: false,
  },
};

export const STANDARD_SPECIAL_MOVE_TYPES: SpecialMoveType[] = [
  'DOUBLE_TROUBLE',
  'TRIPLE_THREAT',
  'SAFE_BET',
  'LOCKOUT',
  'DOUBLE_WINS_OR_NOTHING',
  'TRIPLE_WINS_OR_NOTHING',
];

export const GIFT_SPECIAL_MOVE_TYPES: SpecialMoveType[] = [
  'SUPER_SAVE',
  'GOLDEN_GAMBLE',
  'SHIELD_BOOST',
  'FINAL_SHOT',
];

export const BUILD_GATED_SPECIAL_MOVES: BuildGatedSpecialMoveCard[] = [
  {
    id: 'SECOND_CHANCE',
    displayTitle: 'SECOND CHANCE',
    description: 'Guide move. One retry after first miss, then fail closes tile with no steal.',
    disabledReason: 'Build-gated: enable only when retry-turn rules are active for this show.',
  },
  {
    id: 'CATEGORY_FREEZE',
    displayTitle: 'CATEGORY FREEZE',
    description: 'Guide move. Selected category is frozen for the next turn window.',
    disabledReason: 'Build-gated: requires turn-order category lock rules.',
  },
];

export const getSpecialMoveCatalogEntry = (moveType?: SpecialMoveType): SpecialMoveCatalogEntry | null => {
  if (!moveType) return null;
  return SPECIAL_MOVE_CATALOG[moveType] || null;
};

export const getSpecialMoveDisplayTitle = (moveType?: SpecialMoveType): string | undefined => {
  if (!moveType) return undefined;
  return SPECIAL_MOVE_CATALOG[moveType]?.displayTitle || moveType.replace(/_/g, ' ');
};

