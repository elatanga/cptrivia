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

  const multipleChoiceQuestion: Question = {
    id: 'q2',
    text: 'A very long multiple-choice question prompt that must stay fully visible in one viewport without scrolling even on smaller screens.',
    points: 200,
    answer: 'Correct answer',
    options: [
      'A long option A that could otherwise overflow if sizing is not managed correctly.',
      'A long option B with additional explanatory wording for stress testing.',
      'A long option C that contains more than one clause and punctuation.',
      'A long option D with enough content to require safe wrapping and scaling.'
    ],
    isRevealed: false,
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

  it('keeps viewport locked and renders options in a polished 2x2 grid for four choices', () => {
    render(
      <QuestionModal
        question={multipleChoiceQuestion}
        categoryTitle="General"
        players={players}
        selectedPlayerId="p1"
        timer={timer}
        onClose={vi.fn()}
        onReveal={vi.fn()}
      />
    );

    const root = screen.getByTestId('reveal-root');
    expect(root.getAttribute('style')).toContain('100dvh');
    expect(root).toHaveClass('overflow-hidden');

    const optionGrid = screen.getByTestId('answer-options-grid');
    expect(optionGrid).toHaveClass('grid-cols-2');
    expect(screen.getByTestId('answer-option-0')).toBeInTheDocument();
    expect(screen.getByTestId('answer-option-1')).toBeInTheDocument();
    expect(screen.getByTestId('answer-option-2')).toBeInTheDocument();
    expect(screen.getByTestId('answer-option-3')).toBeInTheDocument();
  });

  it('handles ultra-long prompt/options on mobile without enabling scroll regions', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    window.dispatchEvent(new Event('resize'));

    const ultraLongQuestion: Question = {
      ...multipleChoiceQuestion,
      text: 'ULTRA LONG QUESTION '.repeat(80),
      options: [
        'Option A '.repeat(35),
        'Option B '.repeat(35),
        'Option C '.repeat(35),
        'Option D '.repeat(35)
      ]
    };

    render(
      <QuestionModal
        question={ultraLongQuestion}
        categoryTitle="General"
        players={players}
        selectedPlayerId="p1"
        timer={timer}
        onClose={vi.fn()}
        onReveal={vi.fn()}
      />
    );

    const root = screen.getByTestId('reveal-root');
    const container = screen.getByTestId('luxury-container');
    const viewport = screen.getByTestId('question-viewport');
    const optionsGrid = screen.getByTestId('answer-options-grid');
    const actionsRail = screen.getByTestId('reveal-actions-rail');

    expect(root).toHaveClass('overflow-hidden');
    expect(root.getAttribute('style')).toContain('100dvh');
    expect(container).toHaveClass('overflow-hidden');
    expect(viewport).toHaveClass('overflow-hidden');
    expect(optionsGrid).toHaveClass('grid');
    expect(actionsRail).toBeInTheDocument();

    expect(screen.getByTestId('answer-option-0')).toHaveClass('break-words');
    expect(screen.getByTestId('answer-option-3')).toHaveClass('break-words');
  });
});

