/**
 * REGRESSION LOCK: Steal Overlay Premium Surface
 *
 * Locks the steal overlay UI so its premium, visible surface
 * cannot silently regress. Covers structure, hierarchy, contrast
 * markers, button presence, interaction, and layout stability.
 *
 * DOES NOT alter steal business logic.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

// ─── Fixtures ────────────────────────────────────────────────────────────────

const revealedQuestion: Question = {
  id: 'q-steal-overlay-test',
  text: 'Steal overlay regression question?',
  answer: 'Regression Answer',
  points: 300,
  isRevealed: true,
  isAnswered: false,
};

const players: Player[] = [
  { id: 'p1', name: 'Alice', score: 100, color: '#ff0000' },
  { id: 'p2', name: 'Bob',   score: 200, color: '#00ff00' },
  { id: 'p3', name: 'Carol', score: 150, color: '#0000ff' },
];

const mockTimer: GameTimer = { duration: 30, endTime: null, isRunning: false };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Renders the modal in a revealed state and triggers the steal overlay. */
const renderAndTriggerSteal = (onClose = vi.fn()) => {
  render(
    <QuestionModal
      question={revealedQuestion}
      categoryTitle="Regression"
      players={players}
      selectedPlayerId="p1"
      timer={mockTimer}
      allowSteal={true}
      onClose={onClose}
      onReveal={vi.fn()}
    />,
  );
  // The steal action button has title="Steal (S)" when no stealDisabledReason is set
  fireEvent.click(screen.getByTitle('Steal (S)'));
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('QuestionModal: Steal Overlay – Premium Surface Regression Lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1) STRUCTURE ──────────────────────────────────────────────────────────────

  it('1) STRUCTURE: steal overlay wrapper renders with data-testid="steal-overlay"', () => {
    renderAndTriggerSteal();
    expect(screen.getByTestId('steal-overlay')).toBeInTheDocument();
  });

  it('2) STRUCTURE: inner luxury panel renders with data-testid="steal-panel"', () => {
    renderAndTriggerSteal();
    expect(screen.getByTestId('steal-panel')).toBeInTheDocument();
  });

  it('3) STRUCTURE: steal panel is contained within the overlay wrapper', () => {
    renderAndTriggerSteal();
    const overlay = screen.getByTestId('steal-overlay');
    const panel = screen.getByTestId('steal-panel');
    expect(overlay).toContainElement(panel);
  });

  // 2) BACKDROP ───────────────────────────────────────────────────────────────

  it('4) BACKDROP: overlay is fixed and full-screen', () => {
    renderAndTriggerSteal();
    const overlay = screen.getByTestId('steal-overlay');
    expect(overlay.className).toContain('fixed');
    expect(overlay.className).toContain('inset-0');
  });

  it('5) BACKDROP: overlay has elevated z-index above main modal', () => {
    renderAndTriggerSteal();
    const overlay = screen.getByTestId('steal-overlay');
    // z-[10000] must be present to stack above the question modal (z-[9999])
    expect(overlay.className).toContain('z-[10000]');
  });

  // 3) SURFACE CONTRAST ───────────────────────────────────────────────────────

  it('6) CONTRAST: inner panel has a non-transparent background surface', () => {
    renderAndTriggerSteal();
    const panel = screen.getByTestId('steal-panel');
    // bg-zinc-900 is the solid surface – not bg-transparent or bg-black/0
    expect(panel.className).toContain('bg-zinc-900');
  });

  it('7) CONTRAST: inner panel has a visible purple-tinted border for separation', () => {
    renderAndTriggerSteal();
    const panel = screen.getByTestId('steal-panel');
    expect(panel.className).toContain('border');
    expect(panel.className).toContain('border-purple-500/40');
  });

  it('8) CONTRAST: inner panel has rounded premium corners', () => {
    renderAndTriggerSteal();
    const panel = screen.getByTestId('steal-panel');
    expect(panel.className).toContain('rounded-[2.5rem]');
  });

  // 4) TYPOGRAPHY / TITLE ─────────────────────────────────────────────────────

  it('9) TITLE: "Who is stealing?" heading is present and visible', () => {
    renderAndTriggerSteal();
    expect(screen.getByText(/Who is stealing\?/i)).toBeInTheDocument();
  });

  it('10) TITLE: heading is rendered inside the luxury panel', () => {
    renderAndTriggerSteal();
    const panel = screen.getByTestId('steal-panel');
    const heading = screen.getByText(/Who is stealing\?/i);
    expect(panel).toContainElement(heading);
  });

  it('11) TITLE: heading has premium purple color class', () => {
    renderAndTriggerSteal();
    const heading = screen.getByText(/Who is stealing\?/i);
    expect(heading.className).toContain('text-purple-300');
  });

  it('12) TITLE: heading has uppercase and font-black for strong weight', () => {
    renderAndTriggerSteal();
    const heading = screen.getByText(/Who is stealing\?/i);
    expect(heading.className).toContain('uppercase');
    expect(heading.className).toContain('font-black');
  });

  // 5) PLAYER BUTTONS ─────────────────────────────────────────────────────────

  it('13) PLAYERS: non-selected players appear as buttons inside panel', () => {
    renderAndTriggerSteal();
    const panel = screen.getByTestId('steal-panel');
    // p1 is selected – Bob and Carol should be listed
    expect(within(panel).getByText('Bob')).toBeInTheDocument();
    expect(within(panel).getByText('Carol')).toBeInTheDocument();
  });

  it('14) PLAYERS: selected player (Alice) does NOT appear in the steal list', () => {
    renderAndTriggerSteal();
    const panel = screen.getByTestId('steal-panel');
    expect(within(panel).queryByText('Alice')).not.toBeInTheDocument();
  });

  it('15) PLAYERS: player buttons have visible border contrast treatment', () => {
    renderAndTriggerSteal();
    const panel = screen.getByTestId('steal-panel');
    const bobBtn = within(panel).getByText('Bob').closest('button');
    expect(bobBtn).not.toBeNull();
    expect(bobBtn!.className).toContain('border-purple-500/50');
    expect(bobBtn!.className).toContain('bg-zinc-800');
  });

  it('16) PLAYERS: player buttons are uppercase and font-black for readability', () => {
    renderAndTriggerSteal();
    const panel = screen.getByTestId('steal-panel');
    const bobBtn = within(panel).getByText('Bob').closest('button');
    expect(bobBtn!.className).toContain('font-black');
    expect(bobBtn!.className).toContain('uppercase');
  });

  // 6) CANCEL BUTTON ──────────────────────────────────────────────────────────

  it('17) CANCEL: cancel steal button is present inside the panel', () => {
    renderAndTriggerSteal();
    const panel = screen.getByTestId('steal-panel');
    expect(within(panel).getByRole('button', { name: /cancel steal/i })).toBeInTheDocument();
  });

  it('18) CANCEL: cancel button has pill/rounded outline treatment (not bare text)', () => {
    renderAndTriggerSteal();
    const panel = screen.getByTestId('steal-panel');
    const cancelBtn = within(panel).getByRole('button', { name: /cancel steal/i });
    expect(cancelBtn.className).toContain('rounded-full');
    expect(cancelBtn.className).toContain('border');
  });

  // 7) INTERACTION ────────────────────────────────────────────────────────────

  it('19) INTERACTION: clicking cancel button dismisses the overlay', () => {
    renderAndTriggerSteal();
    expect(screen.getByTestId('steal-overlay')).toBeInTheDocument();

    const panel = screen.getByTestId('steal-panel');
    fireEvent.click(within(panel).getByRole('button', { name: /cancel steal/i }));

    expect(screen.queryByTestId('steal-overlay')).not.toBeInTheDocument();
  });

  it('20) INTERACTION: clicking a player button calls onClose("steal", playerId)', () => {
    const mockOnClose = vi.fn();
    renderAndTriggerSteal(mockOnClose);

    const panel = screen.getByTestId('steal-panel');
    fireEvent.click(within(panel).getByText('Bob').closest('button')!);

    expect(mockOnClose).toHaveBeenCalledWith('steal', 'p2');
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('21) INTERACTION: clicking a second player calls onClose with their id', () => {
    const mockOnClose = vi.fn();
    renderAndTriggerSteal(mockOnClose);

    const panel = screen.getByTestId('steal-panel');
    fireEvent.click(within(panel).getByText('Carol').closest('button')!);

    expect(mockOnClose).toHaveBeenCalledWith('steal', 'p3');
  });

  // 8) LAYOUT STABILITY ───────────────────────────────────────────────────────

  it('22) LAYOUT: overlay does NOT appear before steal button is clicked', () => {
    render(
      <QuestionModal
        question={revealedQuestion}
        categoryTitle="Regression"
        players={players}
        selectedPlayerId="p1"
        timer={mockTimer}
        allowSteal={true}
        onClose={vi.fn()}
        onReveal={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('steal-overlay')).not.toBeInTheDocument();
    expect(screen.queryByTestId('steal-panel')).not.toBeInTheDocument();
  });

  it('23) LAYOUT: overlay does NOT appear when steal is disabled', () => {
    render(
      <QuestionModal
        question={revealedQuestion}
        categoryTitle="Regression"
        players={players}
        selectedPlayerId="p1"
        timer={mockTimer}
        allowSteal={false}
        onClose={vi.fn()}
        onReveal={vi.fn()}
      />,
    );
    // The steal button is disabled – keyboard shortcut should also be blocked
    fireEvent.keyDown(window, { code: 'KeyS' });
    expect(screen.queryByTestId('steal-overlay')).not.toBeInTheDocument();
  });

  it('24) LAYOUT: main question root remains in DOM while overlay is shown', () => {
    renderAndTriggerSteal();
    expect(screen.getByTestId('steal-overlay')).toBeInTheDocument();
    // The underlying question modal root must still be present
    expect(screen.getByTestId('reveal-root')).toBeInTheDocument();
  });
});

