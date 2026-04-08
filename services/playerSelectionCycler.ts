import { Player } from '../types';

/**
 * Pure helper for automatic player selection cycling during gameplay.
 * Used to advance selection to the next player after a play completes,
 * or to initialize selection when game starts with no current selection.
 */

/**
 * Determines the initial player to select when game becomes active
 * with no valid current selection.
 *
 * Rules:
 * - If no players, return null
 * - If empty current selection and players exist, return first player id
 * - Otherwise return null (do not override existing selection)
 */
export const getInitialAutoSelectedPlayer = (
  players: Player[],
  currentSelectedPlayerId: string | null
): string | null => {
  if (!players || players.length === 0) {
    return null;
  }

  // If there is a valid selection already, do not override
  if (currentSelectedPlayerId && players.some(p => p.id === currentSelectedPlayerId)) {
    return null;
  }

  // No current selection and players exist → auto-select first player
  return players[0].id;
};

/**
 * Calculates the next player to select after the current play completes.
 *
 * Rules:
 * - If no players, return null
 * - If no current selection, return first player
 * - If current selected player not found, fall back to first player
 * - Otherwise, return next player in circular order
 */
export const getNextPlayerSelection = (
  players: Player[],
  currentSelectedPlayerId: string | null
): string | null => {
  if (!players || players.length === 0) {
    return null;
  }

  // If no current selection, select first player
  if (!currentSelectedPlayerId) {
    return players[0].id;
  }

  // Find current player index
  const currentIdx = players.findIndex(p => p.id === currentSelectedPlayerId);

  // If current player not found, fall back to first player
  if (currentIdx === -1) {
    return players[0].id;
  }

  // Advance to next player, wrap around if at end
  const nextIdx = (currentIdx + 1) % players.length;
  return players[nextIdx].id;
};

