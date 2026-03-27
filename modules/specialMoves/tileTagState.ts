import { GameAnalyticsEvent } from '../../types';

const SPECIAL_MOVE_NOTE_REGEX = /special move|double or lose|triple or lose|safe bet|lockout|super save|golden gamble|shield boost|final shot|double_trouble|triple_threat/i;
const RESOLUTION_EVENT_TYPES = new Set(['POINTS_AWARDED', 'POINTS_STOLEN', 'TILE_VOIDED', 'QUESTION_RETURNED', 'SCORE_ADJUSTED']);
const SPECIAL_MOVE_LABEL = 'SPECIAL MOVE!' as const;

export type TileSpecialMoveTagState = 'none' | 'armed' | 'resolved';

export interface TileSpecialMoveBadgeModel {
  showTag: boolean;
  label: typeof SPECIAL_MOVE_LABEL;
  visualState: 'armed' | 'resolved' | null;
  tone: 'red' | 'grey' | null;
}

const isSpecialMoveContext = (event: GameAnalyticsEvent): boolean => {
  const context = event.context || {};
  if (typeof context.specialMoveType === 'string' && context.specialMoveType.trim()) return true;
  if (typeof context.specialMoveName === 'string' && context.specialMoveName.trim()) return true;
  if (typeof context.note === 'string' && SPECIAL_MOVE_NOTE_REGEX.test(context.note)) return true;
  return false;
};

export const deriveResolvedSpecialMoveTileIds = (events: GameAnalyticsEvent[] | undefined | null): Set<string> => {
  const resolved = new Set<string>();
  for (const event of events || []) {
    const tileId = event?.context?.tileId;
    if (!tileId) continue;
    if (!RESOLUTION_EVENT_TYPES.has(event.type)) continue;
    if (!isSpecialMoveContext(event)) continue;
    resolved.add(tileId);
  }
  return resolved;
};

export const getTileSpecialMoveBadgeModel = (isArmed: boolean, wasResolved: boolean): TileSpecialMoveBadgeModel => {
  if (wasResolved) {
    return {
      showTag: true,
      label: SPECIAL_MOVE_LABEL,
      visualState: 'resolved',
      tone: 'grey',
    };
  }

  if (isArmed) {
    return {
      showTag: true,
      label: SPECIAL_MOVE_LABEL,
      visualState: 'armed',
      tone: 'red',
    };
  }

  return {
    showTag: false,
    label: SPECIAL_MOVE_LABEL,
    visualState: null,
    tone: null,
  };
};

export const getTileSpecialMoveTagState = (isArmed: boolean, wasResolved: boolean): TileSpecialMoveTagState => {
  const model = getTileSpecialMoveBadgeModel(isArmed, wasResolved);
  if (model.visualState === 'resolved') return 'resolved';
  if (model.visualState === 'armed') return 'armed';
  return 'none';
};

