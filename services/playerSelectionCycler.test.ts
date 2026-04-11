import { describe, it, expect } from 'vitest';
import { getNextPlayerSelection, getInitialAutoSelectedPlayer } from './playerSelectionCycler';
import { Player } from '../types';

describe('playerSelectionCycler', () => {
  const createPlayer = (id: string, name: string): Player => ({
    id,
    name,
    score: 0,
    color: '#ffffff',
    wildcardsUsed: 0,
    wildcardActive: false,
    stealsCount: 0,
    specialMovesUsedCount: 0,
    specialMovesUsedNames: [],
  });

  describe('getNextPlayerSelection', () => {
    it('returns null if players array is empty', () => {
      const result = getNextPlayerSelection([], 'p1');
      expect(result).toBeNull();
    });

    it('returns null if players array is null/undefined', () => {
      const result = getNextPlayerSelection(null as any, 'p1');
      expect(result).toBeNull();
    });

    it('returns first player if no current selection', () => {
      const players = [createPlayer('p1', 'Alice'), createPlayer('p2', 'Bob')];
      const result = getNextPlayerSelection(players, null);
      expect(result).toBe('p1');
    });

    it('returns next player when current player is valid', () => {
      const players = [createPlayer('p1', 'Alice'), createPlayer('p2', 'Bob'), createPlayer('p3', 'Charlie')];
      const result = getNextPlayerSelection(players, 'p1');
      expect(result).toBe('p2');
    });

    it('wraps to first player when advancing from last player', () => {
      const players = [createPlayer('p1', 'Alice'), createPlayer('p2', 'Bob'), createPlayer('p3', 'Charlie')];
      const result = getNextPlayerSelection(players, 'p3');
      expect(result).toBe('p1');
    });

    it('falls back to first player if current selection id not found', () => {
      const players = [createPlayer('p1', 'Alice'), createPlayer('p2', 'Bob')];
      const result = getNextPlayerSelection(players, 'p-invalid');
      expect(result).toBe('p1');
    });

    it('handles single player list (returns same player)', () => {
      const players = [createPlayer('p1', 'Solo')];
      const result = getNextPlayerSelection(players, 'p1');
      expect(result).toBe('p1');
    });

    it('advances through all players in order', () => {
      const players = [createPlayer('p1', 'Alice'), createPlayer('p2', 'Bob'), createPlayer('p3', 'Charlie')];
      let current = 'p1';
      current = getNextPlayerSelection(players, current)!;
      expect(current).toBe('p2');
      current = getNextPlayerSelection(players, current)!;
      expect(current).toBe('p3');
      current = getNextPlayerSelection(players, current)!;
      expect(current).toBe('p1'); // Wraps back
    });
  });

  describe('getInitialAutoSelectedPlayer', () => {
    it('returns null if players array is empty', () => {
      const result = getInitialAutoSelectedPlayer([], null);
      expect(result).toBeNull();
    });

    it('returns null if players array is null/undefined', () => {
      const result = getInitialAutoSelectedPlayer(null as any, 'p1');
      expect(result).toBeNull();
    });

    it('returns first player if no current selection and players exist', () => {
      const players = [createPlayer('p1', 'Alice'), createPlayer('p2', 'Bob')];
      const result = getInitialAutoSelectedPlayer(players, null);
      expect(result).toBe('p1');
    });

    it('returns null if current selection is valid (do not override)', () => {
      const players = [createPlayer('p1', 'Alice'), createPlayer('p2', 'Bob')];
      const result = getInitialAutoSelectedPlayer(players, 'p2');
      expect(result).toBeNull();
    });

    it('returns first player if current selection id is invalid', () => {
      const players = [createPlayer('p1', 'Alice'), createPlayer('p2', 'Bob')];
      const result = getInitialAutoSelectedPlayer(players, 'p-invalid');
      expect(result).toBe('p1');
    });

    it('handles single player (returns that player when no selection)', () => {
      const players = [createPlayer('p1', 'Solo')];
      const result = getInitialAutoSelectedPlayer(players, null);
      expect(result).toBe('p1');
    });

    it('does not override existing valid selection with single player', () => {
      const players = [createPlayer('p1', 'Solo')];
      const result = getInitialAutoSelectedPlayer(players, 'p1');
      expect(result).toBeNull();
    });
  });
});

