import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QuestionModal } from './QuestionModal';
import { Question, Player, GameTimer } from '../types';

vi.mock('../services/soundService', () => ({
  soundService: {
    playClick: vi.fn(),
    playReveal: vi.fn(),
    playAward: vi.fn(),
    playSteal: vi.fn(),
    playVoid: vi.fn(),
    playDoubleOrNothing: vi.fn(),
    playTimerTick: vi.fn(),
    playTimerAlarm: vi.fn(),
  },
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('QuestionModal Countdown Regression', () => {
  const players: Player[] = [
    { id: 'p1', name: 'Alice', score: 0, color: '#fff' },
    { id: 'p2', name: 'Bob', score: 0, color: '#fff' },
  ];

  const timer: GameTimer = {
    duration: 30,
    endTime: null,
    isRunning: false,
  };

  const revealedQuestion: Question = {
    id: 'q1',
    text: 'Revealed question',
    points: 100,
    answer: 'Answer',
    isRevealed: true,
    isAnswered: false,
    isDoubleOrNothing: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks award/steal/void while question countdown is active', () => {
    const onClose = vi.fn();

    render(
      <QuestionModal
        question={revealedQuestion}
        categoryTitle="General"
        players={players}
        selectedPlayerId="p1"
        timer={timer}
        questionCountdownActive={true}
        questionCountdownDuration={5}
        onClose={onClose}
        onReveal={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /award/i }));
    fireEvent.click(screen.getByRole('button', { name: /steal/i }));
    fireEvent.click(screen.getByRole('button', { name: /void/i }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('allows resolving actions after countdown is manually stopped', () => {
    const onClose = vi.fn();

    render(
      <QuestionModal
        question={revealedQuestion}
        categoryTitle="General"
        players={players}
        selectedPlayerId="p1"
        timer={timer}
        questionCountdownActive={true}
        questionCountdownDuration={5}
        onClose={onClose}
        onReveal={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    fireEvent.click(screen.getByRole('button', { name: /award/i }));

    expect(onClose).toHaveBeenCalledWith('award', 'p1');
  });

  it('fires completion callback when countdown finishes', async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();

    render(
      <QuestionModal
        question={revealedQuestion}
        categoryTitle="General"
        players={players}
        selectedPlayerId="p1"
        timer={timer}
        questionCountdownActive={true}
        questionCountdownDuration={3}
        onQuestionCountdownComplete={onComplete}
        onClose={vi.fn()}
        onReveal={vi.fn()}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(3500);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

