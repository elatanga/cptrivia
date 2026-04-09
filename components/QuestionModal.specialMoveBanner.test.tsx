import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuestionModal } from './QuestionModal';
import type { GameTimer, Player, Question } from '../types';

vi.mock('../services/soundService', () => ({
  soundService: {
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

const baseQuestion: Question = {
  id: 'q1',
  text: 'What is the capital of France?',
  answer: 'Paris',
  points: 100,
  isRevealed: false,
  isAnswered: false,
  options: ['Paris', 'Berlin', 'Rome', 'Madrid'],
};

const players: Player[] = [{ id: 'p1', name: 'Alice', score: 0, color: '#fff' }];
const baseTimer: GameTimer = { duration: 30, endTime: null, isRunning: false };

const renderModal = (props?: Partial<React.ComponentProps<typeof QuestionModal>>) =>
  render(
    <QuestionModal
      question={baseQuestion}
      categoryTitle="Geography"
      players={players}
      selectedPlayerId="p1"
      timer={baseTimer}
      onClose={vi.fn()}
      onReveal={vi.fn()}
      {...props}
    />
  );

describe('QuestionModal special move banner visibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-07T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders special move label when active tile has a special move', () => {
    renderModal({
      specialMoveSummary: {
        moveType: 'DOUBLE_TROUBLE',
        displayTitle: 'DOUBLE OR LOSE',
        pointsEffect: 'WIN: 2X POINTS',
        penaltyEffect: 'MISS: -TILE VALUE',
        stealPolicy: 'NO STEAL',
      },
    });

    expect(screen.getByTestId('special-move-banner')).toBeInTheDocument();
    expect(screen.getByText('DOUBLE OR LOSE')).toBeInTheDocument();
  });

  it('renders a centered top banner container for special moves', () => {
    renderModal({
      specialMoveSummary: {
        moveType: 'TRIPLE_THREAT',
        displayTitle: 'TRIPLE OR LOSE',
        pointsEffect: 'WIN: 3X POINTS',
        penaltyEffect: 'MISS: -130%',
        stealPolicy: 'NO STEAL',
      },
    });

    const banner = screen.getByTestId('special-move-banner');
    expect(banner.className).toContain('text-center');
    expect(banner.className).toContain('max-w-5xl');
    expect(banner.className).toContain('border-red-500/45');
  });

  it('renders Double Or Nothing with the new visible treatment', () => {
    renderModal({
      question: { ...baseQuestion, isDoubleOrNothing: true },
    });

    const label = screen.getByTestId('double-label');
    expect(label).toBeInTheDocument();
    expect(label).toHaveTextContent('DOUBLE OR NOTHING');
    expect(label.className).toContain('text-red-400');
    expect(label.className).toContain('font-black');
  });

  it('renders other special moves through the same styling path', () => {
    renderModal({
      specialMoveSummary: {
        moveType: 'LOCKOUT',
        displayTitle: 'LOCKOUT',
        pointsEffect: 'STANDARD AWARD',
        stealPolicy: 'NO STEAL',
      },
    });

    const banner = screen.getByTestId('special-move-banner');
    expect(banner).toHaveTextContent('LOCKOUT');
    expect(banner).toHaveTextContent('STANDARD AWARD');
    expect(banner).toHaveTextContent('NO STEAL');
  });

  it('renders no banner when no special move exists', () => {
    renderModal();
    expect(screen.queryByTestId('special-move-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('double-label')).not.toBeInTheDocument();
  });

  it('keeps existing question content, timer, and options visible', () => {
    renderModal({
      timer: {
        duration: 30,
        endTime: Date.now() + 5000,
        isRunning: true,
      },
      specialMoveSummary: {
        moveType: 'DOUBLE_TROUBLE',
        displayTitle: 'DOUBLE OR LOSE',
        pointsEffect: 'WIN: 2X POINTS',
        penaltyEffect: 'MISS: -TILE VALUE',
        stealPolicy: 'NO STEAL',
      },
    });

    expect(screen.getByTestId('question-text')).toBeInTheDocument();
    expect(screen.getByTestId('answer-options-grid')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('does not crash when specialMoveSummary is missing or undefined', () => {
    renderModal({ specialMoveSummary: undefined });
    expect(screen.getByTestId('reveal-root')).toBeInTheDocument();
    expect(screen.queryByTestId('special-move-banner')).not.toBeInTheDocument();
  });
});

