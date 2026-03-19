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
        }}
      />
    );

    expect(screen.getByText('WINNER')).toBeInTheDocument();
    expect(screen.getByText('ALEX')).toBeInTheDocument();
    expect(screen.getByText('Score: 1400')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close celebration modal/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

