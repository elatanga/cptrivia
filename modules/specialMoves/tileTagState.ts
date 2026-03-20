import { GameAnalyticsEvent } from '../../types';

const SPECIAL_MOVE_NOTE_REGEX = /double|triple|safe bet|lockout|super save|golden gamble|shield boost|final shot|special move failure/i;

export type TileSpecialMoveTagState = 'none' | 'armed' | 'resolved';

const isSpecialMoveContext = (event: GameAnalyticsEvent): boolean => {
  const context = event.context || {};
  if (context.specialMoveType || context.specialMoveName) return true;
  if (typeof context.note === 'string' && SPECIAL_MOVE_NOTE_REGEX.test(context.note)) return true;
  return false;
};

export const deriveResolvedSpecialMoveTileIds = (events: GameAnalyticsEvent[] | undefined | null): Set<string> => {
  const resolved = new Set<string>();
  for (const event of events || []) {
    const tileId = event?.context?.tileId;
    if (!tileId) continue;
    const isResolutionEvent = event.type === 'POINTS_AWARDED' || event.type === 'POINTS_STOLEN' || event.type === 'TILE_VOIDED' || event.type === 'QUESTION_RETURNED' || event.type === 'SCORE_ADJUSTED';
    if (!isResolutionEvent) continue;
    if (!isSpecialMoveContext(event)) continue;
    resolved.add(tileId);
  }
  return resolved;
};

export const getTileSpecialMoveTagState = (isArmed: boolean, wasResolved: boolean): TileSpecialMoveTagState => {
  if (wasResolved) return 'resolved';
  if (isArmed) return 'armed';
  return 'none';
};

