import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EndGameCelebrationModal } from './EndGameCelebrationModal';

vi.mock('../services/soundService', () => ({
  soundService: { playClick: vi.fn() },
}));

describe('EndGameCelebrationModal', () => {
  it('renders winner content and closes safely', () => {
    const onClose = vi.fn();

    render(
      <EndGameCelebrationModal
        isOpen={true}
        onClose={onClose}
        result={{
          mode: 'winner',
          title: 'WINNER',
          subtitle: 'Game Complete',
          scoreLabel: 'Score',
          winners: [{ id: 'p1', name: 'ALEX', score: 1400 }],
          topScore: 1400,
          playerCount: 3,
          placements: [
            {
              id: 'p1',
              name: 'ALEX',
              score: 1400,
              rank: 1,
              stats: { questionsAnswered: 8, stealsMade: 1, bonusMovesGot: 2, lostOrVoided: 1 },
            },
            {
              id: 'p2',
              name: 'BLAIR',
              score: 1200,
              rank: 2,
              stats: { questionsAnswered: 7, stealsMade: 0, bonusMovesGot: 1, lostOrVoided: 2 },
            },
          ],
          teamPlacements: [],
        }}
      />
    );

    expect(screen.getByText('WINNER')).toBeInTheDocument();
    expect(screen.getByText('ALEX')).toBeInTheDocument();
    expect(screen.getByText('Score: 1400')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close celebration modal/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders placement and team member stats when provided', () => {
    render(
      <EndGameCelebrationModal
        isOpen={true}
        onClose={vi.fn()}
        result={{
          mode: 'winner',
          title: 'WINNER',
          subtitle: 'Game Complete',
          scoreLabel: 'Score',
          winners: [{ id: 'p1', name: 'ALEX', score: 1400 }],
          topScore: 1400,
          playerCount: 4,
          placements: [
            { id: 'p1', name: 'ALEX', score: 1400, rank: 1, stats: { questionsAnswered: 8, stealsMade: 2, bonusMovesGot: 1, lostOrVoided: 1 } },
            { id: 'p2', name: 'BLAIR', score: 1200, rank: 2, stats: { questionsAnswered: 7, stealsMade: 1, bonusMovesGot: 1, lostOrVoided: 2 } },
            { id: 'p3', name: 'CASEY', score: 1000, rank: 3, stats: { questionsAnswered: 6, stealsMade: 0, bonusMovesGot: 0, lostOrVoided: 3 } },
          ],
          teamPlacements: [
            {
              id: 't1',
              name: 'TEAM ONE',
              score: 2500,
              rank: 1,
              stats: { questionsAnswered: 12, stealsMade: 3, bonusMovesGot: 2, lostOrVoided: 2 },
              members: [
                { id: 'm1', name: 'AVA', score: 1300, stats: { questionsAnswered: 6, stealsMade: 2, bonusMovesGot: 1, lostOrVoided: 1 } },
                { id: 'm2', name: 'NOAH', score: 1200, stats: { questionsAnswered: 6, stealsMade: 1, bonusMovesGot: 1, lostOrVoided: 1 } },
              ],
            },
          ],
        }}
      />
    );

    expect(screen.getByText(/2nd Place/i)).toBeInTheDocument();
    expect(screen.getByText(/3rd Place/i)).toBeInTheDocument();
    expect(screen.getByText(/Team Mode Standings/i)).toBeInTheDocument();
    expect(screen.getByText(/AVA/i)).toBeInTheDocument();
    expect(screen.getByText(/NOAH/i)).toBeInTheDocument();
  });
});

