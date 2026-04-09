import { GameAnalyticsEvent, SpecialMoveType } from '../../types';
import { getSpecialMoveDisplayTitle } from './catalog';

const SPECIAL_MOVE_NOTE_REGEX = /double|triple|safe bet|lockout|super save|golden gamble|shield boost|final shot|second chance|category freeze|wins or nothing|special move failure/i;

export type TileSpecialMoveTagState = 'none' | 'armed' | 'resolved';

const getCatalogLabel = (moveType?: string): string | undefined => {
  if (!moveType) return undefined;
  return getSpecialMoveDisplayTitle(moveType as SpecialMoveType);
};

const SPECIAL_MOVE_LABELS: Record<string, string> = {
  DOUBLE_TROUBLE: 'DOUBLE OR LOSE',
  TRIPLE_THREAT: 'TRIPLE OR LOSE',
  SABOTAGE: 'SAFE BET',
  SAFE_BET: 'SAFE BET',
  MEGA_STEAL: 'LOCKOUT',
  LOCKOUT: 'LOCKOUT',
  SUPER_SAVE: 'SUPER SAVE',
  GOLDEN_GAMBLE: 'GOLDEN GAMBLE',
  SHIELD_BOOST: 'SHIELD BOOST',
  FINAL_SHOT: 'FINAL SHOT',
  DOUBLE_WINS_OR_NOTHING: 'DOUBLE YOUR WINS OR NOTHING',
  TRIPLE_WINS_OR_NOTHING: 'TRIPLE YOUR WINS OR NOTHING',
};

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

export const deriveResolvedSpecialMoveLabelsByTileId = (
  events: GameAnalyticsEvent[] | undefined | null
): Record<string, string> => {
  const labelsByTileId: Record<string, string> = {};
  for (const event of events || []) {
    const tileId = event?.context?.tileId;
    if (!tileId) continue;
    const isResolutionEvent = event.type === 'POINTS_AWARDED' || event.type === 'POINTS_STOLEN' || event.type === 'TILE_VOIDED' || event.type === 'QUESTION_RETURNED' || event.type === 'SCORE_ADJUSTED';
    if (!isResolutionEvent) continue;
    if (!isSpecialMoveContext(event)) continue;

    const explicitName = String(event.context?.specialMoveName || '').trim();
    const moveType = String(event.context?.specialMoveType || '').trim();
    if (explicitName) {
      labelsByTileId[tileId] = explicitName;
      continue;
    }
    if (moveType) {
      labelsByTileId[tileId] = getCatalogLabel(moveType) || SPECIAL_MOVE_LABELS[moveType] || moveType.replace(/_/g, ' ');
    }
  }
  return labelsByTileId;
};

export const getTileSpecialMoveTagState = (isArmed: boolean, wasResolved: boolean): TileSpecialMoveTagState => {
  if (wasResolved) return 'resolved';
  if (isArmed) return 'armed';
  return 'none';
};

export const getTileSpecialMoveTagText = (
  moveType: string | undefined,
  state: TileSpecialMoveTagState,
  resolvedLabel?: string
): string => {
  if (state === 'resolved') {
    if (resolvedLabel) return `${resolvedLabel} RESOLVED`;
    if (moveType) return `${getCatalogLabel(moveType) || SPECIAL_MOVE_LABELS[moveType] || moveType.replace(/_/g, ' ')} RESOLVED`;
    return 'MOVE RESOLVED';
  }
  if (!moveType) return 'SPECIAL MOVE';
  return getCatalogLabel(moveType) || SPECIAL_MOVE_LABELS[moveType] || moveType.replace(/_/g, ' ');
};

