import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EndGameCelebrationModal } from './EndGameCelebrationModal';

vi.mock('../services/soundService', () => ({
  soundService: { playClick: vi.fn() },
}));

const baseWinnerResult = {
  mode: 'winner' as const,
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
    {
      id: 'p3',
      name: 'CASEY',
      score: 1000,
      rank: 3,
      stats: { questionsAnswered: 6, stealsMade: 0, bonusMovesGot: 0, lostOrVoided: 3 },
    },
  ],
  teamPlacements: [],
};

describe('EndGameCelebrationModal', () => {
  it('renders winner content and closes safely', () => {
    const onClose = vi.fn();

    render(
      <EndGameCelebrationModal
        isOpen={true}
        onClose={onClose}
        result={baseWinnerResult}
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
          ...baseWinnerResult,
          playerCount: 4,
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

  it('uses responsive stat-grid containment classes so stat boxes can reflow on narrow layouts', () => {
    render(
      <div style={{ width: '280px' }}>
        <EndGameCelebrationModal
          isOpen={true}
          onClose={vi.fn()}
          result={baseWinnerResult}
        />
      </div>
    );

    const firstStatGrid = screen.getAllByTestId('celebration-stats-grid')[0];
    expect(firstStatGrid.className).toContain('grid-cols-2');
    expect(firstStatGrid.className).toContain('lg:grid-cols-4');

    expect(screen.getAllByTestId('celebration-stat-lost-or-voided')[0].className).toContain('min-w-0');
    expect(screen.getAllByText(/Lost\/Voided/i)[0]).toBeInTheDocument();
  });

  it('keeps long player and team labels rendered without dropping critical text', () => {
    render(
      <EndGameCelebrationModal
        isOpen={true}
        onClose={vi.fn()}
        result={{
          ...baseWinnerResult,
          placements: [
            {
              id: 'p1',
              name: 'THE_ULTRA_LONG_PLAYER_NAME_THAT_USED_TO_CAUSE_COLLISIONS_IN_VICTORY_CARD_LAYOUT',
              score: 9999,
              rank: 1,
              stats: { questionsAnswered: 9, stealsMade: 3, bonusMovesGot: 2, lostOrVoided: 0 },
            },
            ...baseWinnerResult.placements.slice(1),
          ],
          winners: [
            {
              id: 'p1',
              name: 'THE_ULTRA_LONG_PLAYER_NAME_THAT_USED_TO_CAUSE_COLLISIONS_IN_VICTORY_CARD_LAYOUT',
              score: 9999,
            },
          ],
          teamPlacements: [
            {
              id: 't1',
              name: 'TEAM_NAME_THAT_IS_EXTREMELY_LONG_AND_SHOULD_STAY_INSIDE_THE_VICTORY_CARD',
              score: 3000,
              rank: 1,
              stats: { questionsAnswered: 12, stealsMade: 2, bonusMovesGot: 4, lostOrVoided: 1 },
              members: [
                {
                  id: 'm1',
                  name: 'MEMBER_NAME_THAT_IS_ALSO_LONG_FOR_LAYOUT_STRESS_TESTING',
                  score: 1500,
                  stats: { questionsAnswered: 6, stealsMade: 1, bonusMovesGot: 2, lostOrVoided: 0 },
                },
              ],
            },
          ],
        }}
      />
    );

    expect(screen.getByText(/THE_ULTRA_LONG_PLAYER_NAME_THAT_USED_TO_CAUSE_COLLISIONS_IN_VICTORY_CARD_LAYOUT/i)).toBeInTheDocument();
    expect(screen.getByText(/TEAM_NAME_THAT_IS_EXTREMELY_LONG_AND_SHOULD_STAY_INSIDE_THE_VICTORY_CARD/i)).toBeInTheDocument();
    expect(screen.getByText(/MEMBER_NAME_THAT_IS_ALSO_LONG_FOR_LAYOUT_STRESS_TESTING/i)).toBeInTheDocument();
  });
});
