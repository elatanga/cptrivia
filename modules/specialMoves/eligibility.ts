import { Category, SpecialMoveType } from '../../types';

const GIFT_MOVE_TYPES: SpecialMoveType[] = ['SUPER_SAVE', 'GOLDEN_GAMBLE', 'SHIELD_BOOST', 'FINAL_SHOT'];

const isPlayableQuestion = (question: { isAnswered?: boolean; isVoided?: boolean }) => !question.isAnswered && !question.isVoided;

const getPointColumns = (categories: Category[]): number[] => {
  const set = new Set<number>();
  for (const category of categories || []) {
    for (const question of category.questions || []) {
      if (Number.isFinite(question.points)) set.add(Number(question.points));
    }
  }
  return Array.from(set).sort((a, b) => a - b);
};

export const getBoardPointColumns = (categories: Category[]): number => getPointColumns(categories).length;

export const getActiveTileCount = (categories: Category[]): number => {
  let count = 0;
  for (const category of categories || []) {
    for (const question of category.questions || []) {
      if (isPlayableQuestion(question)) count += 1;
    }
  }
  return count;
};

export const boardHasMinimumColumns = (categories: Category[], minimum: number): boolean => getBoardPointColumns(categories) >= minimum;

export const boardHasMinimumActiveTiles = (categories: Category[], minimum: number): boolean => getActiveTileCount(categories) >= minimum;

export const getTileColumnIndex = (categories: Category[], tileId: string): number => {
  const columns = getPointColumns(categories);
  if (!tileId || columns.length === 0) return -1;

  for (const category of categories || []) {
    const question = (category.questions || []).find((q) => q.id === tileId);
    if (!question) continue;
    return columns.indexOf(question.points);
  }

  return -1;
};

export const isTileInFirstNColumns = (categories: Category[], tileId: string, n: number): boolean => {
  const index = getTileColumnIndex(categories, tileId);
  if (index < 0) return false;
  return index < Math.max(0, n);
};

export const isTileInLastNColumns = (categories: Category[], tileId: string, n: number): boolean => {
  const columns = getBoardPointColumns(categories);
  const index = getTileColumnIndex(categories, tileId);
  if (index < 0 || columns === 0) return false;
  return index >= Math.max(0, columns - n);
};

export const isGiftActivatedMove = (moveType: SpecialMoveType): boolean => GIFT_MOVE_TYPES.includes(moveType);

export const getGiftMoveGlobalDisabledReason = (moveType: SpecialMoveType, categories: Category[]): string | null => {
  if (!isGiftActivatedMove(moveType)) return null;

  const columns = getBoardPointColumns(categories);
  const activeTiles = getActiveTileCount(categories);

  if (moveType === 'SUPER_SAVE') {
    if (columns < 6) return 'BOARD MIN 6 COLUMNS';
    if (activeTiles < 6) return 'MIN 6 ACTIVE TILES REQUIRED';
    return null;
  }

  if (moveType === 'GOLDEN_GAMBLE') {
    if (columns < 5) return 'BOARD MIN 5 COLUMNS';
    if (activeTiles < 5) return 'MIN 5 ACTIVE TILES REQUIRED';
    return null;
  }

  if (moveType === 'SHIELD_BOOST') {
    if (columns < 2) return 'BOARD LAYOUT NOT READY';
    if (activeTiles < 1) return 'NO ACTIVE TILES';
    return null;
  }

  if (moveType === 'FINAL_SHOT') {
    if (columns < 6) return 'BOARD MIN 6 COLUMNS';
    if (activeTiles < 4) return 'MIN 4 ACTIVE TILES REQUIRED';
    return null;
  }

  return null;
};

export const getGiftMoveTileDisabledReason = (moveType: SpecialMoveType, categories: Category[], tileId: string): string | null => {
  if (!isGiftActivatedMove(moveType)) return null;

  const globalReason = getGiftMoveGlobalDisabledReason(moveType, categories);
  if (globalReason) return globalReason;

  const tileColumn = getTileColumnIndex(categories, tileId);
  if (tileColumn < 0) return 'TILE COLUMN UNKNOWN';

  if (moveType === 'SUPER_SAVE') {
    if (!isTileInFirstNColumns(categories, tileId, 3)) return 'EARLY COLUMNS ONLY';
    if (isTileInLastNColumns(categories, tileId, 3)) return 'LAST 3 COLUMNS BLOCKED';
    return null;
  }

  if (moveType === 'GOLDEN_GAMBLE') {
    if (isTileInFirstNColumns(categories, tileId, 1) || isTileInLastNColumns(categories, tileId, 1)) {
      return 'MIDDLE COLUMNS ONLY';
    }
    return null;
  }

  if (moveType === 'SHIELD_BOOST') {
    if (isTileInLastNColumns(categories, tileId, 1)) return 'LAST COLUMN BLOCKED';
    return null;
  }

  if (moveType === 'FINAL_SHOT') {
    if (!isTileInLastNColumns(categories, tileId, 2)) return 'LAST 2 COLUMNS ONLY';
    return null;
  }

  return null;
};

