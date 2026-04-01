import { Player } from '../types';

const hasPlayerId = (players: Player[], playerId: string | null | undefined): boolean => {
  if (!playerId) return false;
  return players.some((player) => player.id === playerId);
};

export const getInitialAutoSelectedPlayer = (
  players: Player[],
  currentSelectedPlayerId: string | null | undefined
): string | null => {
  if (!players.length) return null;
  if (hasPlayerId(players, currentSelectedPlayerId)) return currentSelectedPlayerId || null;
  return players[0].id;
};

export const getNextPlayerSelection = (
  players: Player[],
  currentSelectedPlayerId: string | null | undefined
): string | null => {
  if (!players.length) return null;

  const currentIndex = players.findIndex((player) => player.id === currentSelectedPlayerId);
  if (currentIndex === -1) return players[0].id;

  const nextIndex = (currentIndex + 1) % players.length;
  return players[nextIndex].id;
};

