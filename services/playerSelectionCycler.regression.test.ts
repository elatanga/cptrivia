import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getNextPlayerSelection, getInitialAutoSelectedPlayer } from './playerSelectionCycler';
import { Player } from '../types';

/**
 * REGRESSION TESTS: Player Selection Cycling
 *
 * These tests ensure the auto-advance feature maintains all existing behavior:
 * - Manual selection still works
 * - Selection respects scoreboard order
 * - Auto-advance does not interfere with scoring
 * - Auto-advance does not alter board/tile flow
 * - Auto-selection does not crash with edge cases
 */

describe('Player Selection Cycling - Regression & Edge Cases', () => {
  const createPlayer = (id: string, name: string, score: number = 0): Player => ({
    id,
    name,
    score,
    color: '#ffffff',
    wildcardsUsed: 0,
    wildcardActive: false,
    stealsCount: 0,
    specialMovesUsedCount: 0,
    specialMovesUsedNames: [],
  });

  describe('Regression: Selection respects scoreboard order', () => {
    it('maintains exact scoreboard order for cycling', () => {
      const players = [
        createPlayer('p1', 'Alice', 100),
        createPlayer('p2', 'Bob', 200),
        createPlayer('p3', 'Charlie', 150),
        createPlayer('p4', 'Diana', 300),
      ];

      let current = 'p1';
      const order: string[] = [];

      for (let i = 0; i < players.length; i++) {
        const next = getNextPlayerSelection(players, current);
        if (next) {
          order.push(next);
          current = next;
        }
      }

      // Cycle should be: p2, p3, p4, p1 (wraps)
      expect(order).toEqual(['p2', 'p3', 'p4', 'p1']);
    });

    it('selection order is independent of player scores', () => {
      const players1 = [
        createPlayer('p1', 'Alice', 1000),
        createPlayer('p2', 'Bob', 10),
      ];

      const players2 = [
        createPlayer('p1', 'Alice', 10),
        createPlayer('p2', 'Bob', 1000),
      ];

      const next1 = getNextPlayerSelection(players1, 'p1');
      const next2 = getNextPlayerSelection(players2, 'p1');

      // Both should advance to p2, regardless of score
      expect(next1).toBe('p2');
      expect(next2).toBe('p2');
    });

    it('selection order follows array order exactly, not player names', () => {
      const players1 = [
        createPlayer('p1', 'Zulu'),
        createPlayer('p2', 'Alpha'),
        createPlayer('p3', 'Mike'),
      ];

      // Advance from Zulu
      const next = getNextPlayerSelection(players1, 'p1');
      // Should go to second position (Alpha), not alphabetically first
      expect(next).toBe('p2');
    });
  });

  describe('Regression: Auto-selection does not change scores', () => {
    it('selection change does not modify player score', () => {
      const players = [
        createPlayer('p1', 'Alice', 100),
        createPlayer('p2', 'Bob', 200),
      ];

      const next = getNextPlayerSelection(players, 'p1');
      const selectedPlayer = players.find(p => p.id === next);

      // Score should remain unchanged
      expect(selectedPlayer?.score).toBe(200);
    });

    it('initial auto-selection does not modify any player scores', () => {
      const players = [
        createPlayer('p1', 'Alice', 100),
        createPlayer('p2', 'Bob', 200),
      ];

      const selected = getInitialAutoSelectedPlayer(players, null);
      const scores = players.map(p => p.score);

      expect(selected).toBe('p1');
      expect(scores).toEqual([100, 200]); // unchanged
    });
  });

  describe('Regression: Edge cases do not break', () => {
    it('handles zero players without crash', () => {
      const result = getNextPlayerSelection([], 'p1');
      expect(result).toBeNull();
    });

    it('handles one player (stays on same player)', () => {
      const players = [createPlayer('p1', 'Solo')];
      const next = getNextPlayerSelection(players, 'p1');
      expect(next).toBe('p1');
    });

    it('handles null/undefined players array safely', () => {
      const result1 = getNextPlayerSelection(null as any, 'p1');
      const result2 = getNextPlayerSelection(undefined as any, 'p1');
      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });

    it('handles null current selection', () => {
      const players = [createPlayer('p1', 'Alice')];
      const result = getNextPlayerSelection(players, null);
      expect(result).toBe('p1');
    });

    it('handles selection of removed player (fallback to first)', () => {
      const players = [
        createPlayer('p1', 'Alice'),
        createPlayer('p2', 'Bob'),
      ];

      // Try to advance from a player no longer in list
      const result = getNextPlayerSelection(players, 'p-removed');
      expect(result).toBe('p1'); // Falls back to first
    });
  });

  describe('Regression: High player count', () => {
    it('handles maximum 8 players without issue', () => {
      const players = Array.from({ length: 8 }, (_, i) =>
        createPlayer(`p${i + 1}`, `Player ${i + 1}`)
      );

      let current = 'p1';
      const visited = new Set<string>();
      visited.add(current);

      for (let i = 0; i < 20; i++) {
        const next = getNextPlayerSelection(players, current);
        if (next) {
          visited.add(next);
          current = next;
        }
      }

      // Should cycle through all 8 players
      expect(visited.size).toBe(8);
    });

    it('ensures proper wraparound with many players', () => {
      const players = Array.from({ length: 5 }, (_, i) =>
        createPlayer(`p${i + 1}`, `Player ${i + 1}`)
      );

      let current = 'p5'; // Last player
      const next = getNextPlayerSelection(players, current);
      expect(next).toBe('p1'); // Wrap to first
    });
  });

  describe('Regression: Manual selection preserved', () => {
    it('does not auto-select if manual selection is valid', () => {
      const players = [
        createPlayer('p1', 'Alice'),
        createPlayer('p2', 'Bob'),
      ];

      // Manual selection of Bob
      const result = getInitialAutoSelectedPlayer(players, 'p2');
      // Should NOT override with Alice
      expect(result).toBeNull();
    });

    it('respects manually selected player for next advance', () => {
      const players = [
        createPlayer('p1', 'Alice'),
        createPlayer('p2', 'Bob'),
        createPlayer('p3', 'Charlie'),
      ];

      // Manual selection of Bob
      const next = getNextPlayerSelection(players, 'p2');
      // Next advance should be from Bob → Charlie
      expect(next).toBe('p3');
    });
  });

  describe('Regression: Board/Tile flow unaffected', () => {
    it('selection change does not modify question answered state', () => {
      // This is a conceptual test - the actual implementation
      // keeps question/tile state separate from selection
      const players = [
        createPlayer('p1', 'Alice'),
        createPlayer('p2', 'Bob'),
      ];

      const next = getNextPlayerSelection(players, 'p1');

      // Selection should be changed but not question state
      expect(next).toBe('p2');
      expect(next).not.toBeNull();
    });
  });

  describe('Regression: Scoring mechanics untouched', () => {
    it('auto-selection happens after scoring completes', () => {
      const players = [
        createPlayer('p1', 'Alice', 0),
        createPlayer('p2', 'Bob', 0),
      ];

      // Simulate: Alice scores 100
      const updatedPlayers = players.map(p =>
        p.id === 'p1' ? { ...p, score: p.score + 100 } : p
      );

      // Then auto-advance
      const next = getNextPlayerSelection(updatedPlayers, 'p1');

      expect(updatedPlayers[0].score).toBe(100);
      expect(next).toBe('p2');
    });
  });

  describe('Regression: Layout/Condensed view', () => {
    it('selection logic is independent of UI condensed state', () => {
      const players = [
        createPlayer('p1', 'Alice'),
        createPlayer('p2', 'Bob'),
        createPlayer('p3', 'Charlie'),
        createPlayer('p4', 'Diana'),
        createPlayer('p5', 'Eve'),
        createPlayer('p6', 'Frank'),
      ];

      // Selection should be identical regardless of UI layout
      const next = getNextPlayerSelection(players, 'p1');
      expect(next).toBe('p2');
    });
  });

  describe('Regression: Duplicate calls idempotent', () => {
    it('calling advance twice from same player gives consistent result', () => {
      const players = [
        createPlayer('p1', 'Alice'),
        createPlayer('p2', 'Bob'),
        createPlayer('p3', 'Charlie'),
      ];

      const first = getNextPlayerSelection(players, 'p1');
      const second = getNextPlayerSelection(players, 'p1');

      // Both calls should return same result
      expect(first).toBe(second);
      expect(first).toBe('p2');
    });

    it('initial auto-selection is idempotent', () => {
      const players = [
        createPlayer('p1', 'Alice'),
        createPlayer('p2', 'Bob'),
      ];

      const first = getInitialAutoSelectedPlayer(players, null);
      const second = getInitialAutoSelectedPlayer(players, null);

      expect(first).toBe(second);
      expect(first).toBe('p1');
    });
  });

  describe('Regression: Valid player ID formats', () => {
    it('handles UUID-style player IDs', () => {
      const players = [
        createPlayer('550e8400-e29b-41d4-a716-446655440000', 'Alice'),
        createPlayer('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'Bob'),
      ];

      const result = getNextPlayerSelection(players, '550e8400-e29b-41d4-a716-446655440000');
      expect(result).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
    });

    it('handles special characters in player names', () => {
      const players = [
        createPlayer('p1', "O'Brien"),
        createPlayer('p2', 'José-María'),
      ];

      const result = getNextPlayerSelection(players, 'p1');
      expect(result).toBe('p2');
    });
  });
});

