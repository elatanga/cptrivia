
import React from 'react';
import { render, screen } from '@testing-library/react';
import { QuestionModal } from './QuestionModal';
import { Question, Player, GameTimer } from '../types';
import { logger } from '../services/logger';
import { DEFAULT_BOARD_VIEW_SETTINGS } from '../services/boardViewSettings';

// Mock types for tests
declare const jest: any;
declare const describe: any;
declare const test: any;
declare const expect: any;
declare const beforeEach: any;

// Mock sound service
jest.mock('../services/soundService', () => ({
  soundService: {
    playClick: jest.fn(),
    playReveal: jest.fn(),
    playAward: jest.fn(),
    playSteal: jest.fn(),
    playVoid: jest.fn(),
    playDoubleOrNothing: jest.fn(),
    playTimerTick: jest.fn(),
    playTimerAlarm: jest.fn(),
  },
}));

// Mock logger
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockPlayers: Player[] = [
  { id: 'p1', name: 'Alice', score: 0, color: '#fff' },
  { id: 'p2', name: 'Bob', score: 0, color: '#fff' },
];

const mockTimer: GameTimer = {
  duration: 30,
  endTime: null,
  isRunning: false,
};

const setupModal = (questionOverrides: Partial<Question> = {}, viewSettingsOverrides: any = null) => {
  const mockQuestion: Question = {
    id: 'q1',
    text: 'Standard Question?',
    points: 100,
    answer: 'Standard Answer',
    isRevealed: false,
    isAnswered: false,
    isDoubleOrNothing: false,
    ...questionOverrides
  };

  return render(
    <QuestionModal
      question={mockQuestion}
      categoryTitle="General"
      players={mockPlayers}
      selectedPlayerId="p1"
      timer={mockTimer}
      viewSettings={viewSettingsOverrides}
      onClose={jest.fn()}
      onReveal={jest.fn()}
    />
  );
};

describe('QuestionModal: Layout & Reveal UI Health (Card 1)', () => {
  beforeEach(() => {
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    jest.clearAllMocks();
  });

  test('A) LAYOUT: Root uses fixed position and overflow-hidden', () => {
    setupModal();
    const root = screen.getByTestId('reveal-root');
    expect(root).toHaveClass('fixed');
    expect(root).toHaveClass('inset-0');
    expect(root).toHaveClass('overflow-hidden');
  });

  test('B) CONTAINER: Reveal content is wrapped in a luxury card (Card 1)', () => {
    setupModal();
    const container = screen.getByTestId('luxury-container');
    expect(container).toBeInTheDocument();
    expect(container).toHaveClass('max-w-7xl');
    expect(container).toHaveClass('backdrop-blur-2xl');
    expect(container).toHaveClass('md:rounded-[2.5rem]');
    expect(container).toHaveClass('grid');
  });

  test('C) TYPOGRAPHY: Question text uses adaptive clamp sizing and remains bold/readable', () => {
    setupModal();
    const qText = screen.getByTestId('question-text');
    expect(qText).toHaveClass('font-roboto-bold');
    expect(qText.getAttribute('style')).toContain('line-height');
  });

  test('D) VISIBILITY: Question viewport and actions rail are separated inside container', () => {
    setupModal();
    const container = screen.getByTestId('luxury-container');
    const actions = screen.getByTestId('reveal-actions');
    const viewport = screen.getByTestId('question-viewport');
    const rail = screen.getByTestId('reveal-actions-rail');
    expect(container).toContainElement(actions);
    expect(container).toContainElement(viewport);
    expect(container).toContainElement(rail);
  });

  test('E) LONG QUESTION STRESS: Container remains centered without scrolling', () => {
    const longText = 'LOOOOONG '.repeat(100);
    setupModal({ text: longText, isRevealed: true });

    const container = screen.getByTestId('luxury-container');
    expect(container).toHaveClass('grid');
    expect(container).not.toHaveClass('overflow-auto');
    expect(container).toHaveClass('overflow-hidden');

    const qText = screen.getByTestId('question-text');
    expect(qText).toHaveClass('break-words');
  });

  test('F) LOGGING: Logs reveal UI render event', () => {
    const infoSpy = jest.spyOn(logger, 'info');
    setupModal();
    expect(infoSpy).toHaveBeenCalledWith(
      "reveal_ui_rendered",
      expect.objectContaining({ tileId: 'q1', ts: expect.any(String) })
    );
  });

  test('G) SETTINGS FLOW: Applies dynamic modal size and content width from live settings', () => {
    setupModal({}, {
      ...DEFAULT_BOARD_VIEW_SETTINGS,
      questionModalSize: 'Small',
      questionMaxWidthPercent: 70,
    });

    const container = screen.getByTestId('luxury-container') as HTMLElement;
    const viewport = screen.getByTestId('question-viewport') as HTMLElement;
    expect(container.style.maxWidth).toBe('920px');
    expect(viewport.style.maxWidth).toBe('70%');
  });

  test('H) HARDENING: Falls back safely when malformed display settings are supplied', () => {
    setupModal(
      {
        options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
      },
      {
        questionModalSize: 'MASSIVE',
        questionMaxWidthPercent: 500,
        questionFontScale: -4,
        questionContentPadding: -10,
        multipleChoiceColumns: 'wat',
      }
    );

    const container = screen.getByTestId('luxury-container') as HTMLElement;
    const viewport = screen.getByTestId('question-viewport') as HTMLElement;
    const grid = screen.getByTestId('answer-options-grid');
    expect(container.style.maxWidth).toBe('1280px');
    expect(viewport.style.maxWidth).toBe('100%');
    expect(viewport.style.paddingLeft).toBe('4px');
    expect(grid.className).toContain('sm:grid-cols-2');
  });
});
